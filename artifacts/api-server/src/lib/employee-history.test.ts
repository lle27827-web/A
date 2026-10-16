import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { db, pool, membersTable, memberVersionsTable, serviceSessionsTable, serviceTypesTable, treatmentCardsTable } from "@workspace/db";
import { createEmployee, listMembersForPeriod, updateEmployee } from "./employee-history";
import { createCard, deleteMember, MassageError, saveSession } from "./massage";
import { getFacilityRevenue } from "./facility-revenue";

test("archiving employees preserves card visits, historical names, wages and monthly rosters", async () => {
  const marker = `History-${randomUUID()}`;
  const employees: number[] = [];
  const cards: number[] = [];
  const services: number[] = [];
  const sessionIds: number[] = [];
  const makeEmployee = async (name: string, createdAt?: string) => {
    const member = await createEmployee({ name });
    employees.push(member.id);
    if (createdAt) {
      await db.update(membersTable).set({ createdAt: new Date(createdAt) }).where(eq(membersTable.id, member.id));
      await db.update(memberVersionsTable).set({ recordedAt: new Date(createdAt) }).where(eq(memberVersionsTable.memberId, member.id));
    }
    return member;
  };
  const used = async (id: number) => {
    const [row] = await db.select({ minutes: sql<number>`coalesce(sum(${serviceSessionsTable.minutes}),0)` })
      .from(serviceSessionsTable).where(eq(serviceSessionsTable.cardId, id));
    return Number(row.minutes);
  };
  const status = (code: number) => (error: unknown) => error instanceof MassageError && error.status === code;
  try {
    const original = await makeEmployee(`${marker}-old`, "2025-01-05T03:00:00Z");
    const later = await makeEmployee(`${marker}-new`);
    const [service] = await db.insert(serviceTypesTable).values({
      name: marker, hourlyRate: 100000, customerHourlyRate: 200000,
    }).returning();
    services.push(service.id);
    const card = await createCard({
      customerName: marker, phone: "0990000001", serviceType: marker,
      totalMinutes: 240, purchaseAmount: 1000000, purchaseDate: "2025-02-01",
    });
    cards.push(card.id);
    const input = { memberId: original.id, serviceTypeId: service.id, cardId: card.id, workDate: "2025-02-10", minutes: 30, note: "Original note" };
    const visit = await saveSession(input);
    const walkIn = await saveSession({ ...input, cardId: null, customerName: marker, workDate: "2025-02-11" });
    sessionIds.push(visit.id, walkIn.id);
    const reportBefore = await getFacilityRevenue("2025-02", "2025-02-10");
    await updateEmployee(original.id, { name: `${marker}-renamed`, hourlyRate: 800000 });
    const historic = (await listMembersForPeriod("2025-02")).find((m) => m.id === original.id);
    assert.equal(historic?.name, `${marker}-old`);
    assert.equal(historic?.historicalNameSource, "version");
    assert.ok(!(await listMembersForPeriod("2025-02")).some((m) => m.id === later.id));
    assert.equal((await listMembersForPeriod()).find((m) => m.id === original.id)?.name, `${marker}-renamed`);

    await deleteMember(original.id);
    assert.ok(!(await listMembersForPeriod()).some((m) => m.id === original.id));
    const archived = (await listMembersForPeriod("2025-02")).find((m) => m.id === original.id);
    assert.equal(archived?.name, `${marker}-old`);
    assert.ok(archived?.deletedAt);
    assert.equal(await used(card.id), 30);
    const [retained] = await db.select().from(serviceSessionsTable).where(eq(serviceSessionsTable.id, visit.id));
    assert.equal(retained.memberId, original.id);
    assert.equal(retained.employeeName, `${marker}-old`);
    assert.equal(retained.note, "Original note");
    assert.equal(retained.earnings, 50000);
    assert.equal(retained.customerCharge, 100000);
    assert.deepEqual(await getFacilityRevenue("2025-02", "2025-02-10"), reportBefore);
    await deleteMember(original.id);
    assert.equal((await listMembersForPeriod("2025-02")).find((m) => m.id === original.id)?.deletedAt, archived?.deletedAt);
    await assert.rejects(updateEmployee(original.id, { name: "Should not rename" }), status(404));
    await assert.rejects(saveSession({ ...input, minutes: 60 }), status(404));
    // An explicit correction can retain an archived employee on that same visit.
    const corrected = await saveSession({ ...input, note: "Corrected note" }, visit.id);
    assert.equal(corrected.employeeName, `${marker}-old`);
    assert.equal(corrected.hourlyRate, 100000);
    assert.equal(await used(card.id), 30);

    // Vietnam midnight boundaries, not UTC month boundaries.
    const boundary = await makeEmployee(`${marker}-boundary`, "2025-02-01T03:00:00Z");
    await db.insert(memberVersionsTable).values([
      { memberId: boundary.id, name: `${marker}-Feb`, hourlyRate: 100, recordedAt: new Date("2025-02-28T16:59:59Z") },
      { memberId: boundary.id, name: `${marker}-March`, hourlyRate: 200, recordedAt: new Date("2025-02-28T17:00:00Z") },
    ]);
    assert.equal((await listMembersForPeriod("2025-02", boundary.id))[0]?.name, `${marker}-Feb`);
    assert.equal((await listMembersForPeriod("2025-03", boundary.id))[0]?.name, `${marker}-March`);
    const afterMonth = await makeEmployee(`${marker}-March-only`, "2025-02-28T17:00:00Z");
    assert.equal((await listMembersForPeriod("2025-02", afterMonth.id)).length, 0);
    const retired = await makeEmployee(`${marker}-retired`, "2024-01-01T03:00:00Z");
    await db.update(membersTable).set({ deletedAt: new Date("2025-01-15T03:00:00Z") }).where(eq(membersTable.id, retired.id));
    assert.equal((await listMembersForPeriod("2025-02", retired.id)).length, 0);

    // Legacy names are recovered only from actual recorded visits, never invented.
    const legacy = await makeEmployee(`${marker}-legacy-old`, "2025-01-01T03:00:00Z");
    const legacyVisit = await saveSession({ ...input, memberId: legacy.id, cardId: null, workDate: "2025-02-12" });
    sessionIds.push(legacyVisit.id);
    await db.delete(memberVersionsTable).where(eq(memberVersionsTable.memberId, legacy.id));
    await updateEmployee(legacy.id, { name: `${marker}-legacy-now` });
    const legacyHistory = (await listMembersForPeriod("2025-02", legacy.id))[0];
    assert.equal(legacyHistory?.name, `${marker}-legacy-old`);
    assert.equal(legacyHistory?.historicalNameSource, "session");
    const unknown = await makeEmployee(`${marker}-unknown`, "2025-01-01T03:00:00Z");
    await db.update(memberVersionsTable).set({ recordedAt: new Date() }).where(eq(memberVersionsTable.memberId, unknown.id));
    assert.equal((await listMembersForPeriod("2025-02", unknown.id))[0]?.historicalNameSource, "unverified");

    // Backdated recorded visits still make a later-created employee visible.
    const backdated = await saveSession({ ...input, memberId: later.id, cardId: null, workDate: "2025-02-13" });
    sessionIds.push(backdated.id);
    assert.equal((await listMembersForPeriod("2025-02", later.id))[0]?.historicalNameSource, "session");

    const raced = await makeEmployee(`${marker}-race`);
    const raceResults = await Promise.allSettled([
      saveSession({ ...input, memberId: raced.id, workDate: "2025-02-14" }),
      deleteMember(raced.id),
    ]);
    if (raceResults[0].status === "fulfilled") {
      sessionIds.push(raceResults[0].value.id);
      assert.equal((await db.select().from(serviceSessionsTable).where(eq(serviceSessionsTable.id, raceResults[0].value.id))).length, 1);
    } else {
      assert.ok(status(404)(raceResults[0].reason));
    }
    assert.equal(raceResults[1].status, "fulfilled");

    if (process.env.TEST_APP_HTTP === "1") {
      const base = "http://localhost:80/api";
      const listResponse = await fetch(`${base}/members?month=2025-02`);
      assert.equal(listResponse.status, 200);
      const list = await listResponse.json() as { id: number; name: string }[];
      assert.equal(list.find((m) => m.id === original.id)?.name, `${marker}-old`);
      const payResponse = await fetch(`${base}/member-payroll?month=2025-02&memberId=${original.id}`);
      assert.equal(payResponse.status, 200);
      const pay = await payResponse.json() as { totalMinutes: number; totalSalary: number; member: { name: string } };
      assert.equal(pay.member.name, `${marker}-old`);
      assert.equal(pay.totalMinutes, 60);
      assert.equal(pay.totalSalary, 100000);
      const visitsResponse = await fetch(`${base}/service-sessions?month=2025-02&memberId=${original.id}`);
      assert.equal(visitsResponse.status, 200);
      const visits = await visitsResponse.json() as { id: number; employeeName: string }[];
      assert.ok(visits.some((v) => v.id === visit.id && v.employeeName === `${marker}-old`));
      const currentResponse = await fetch(`${base}/members`);
      const current = await currentResponse.json() as { id: number }[];
      assert.ok(!current.some((m) => m.id === original.id));
      assert.equal((await fetch(`${base}/members?month=2025-13`)).status, 400);
    }
  } finally {
    if (sessionIds.length) await db.delete(serviceSessionsTable).where(inArray(serviceSessionsTable.id, sessionIds));
    if (cards.length) await db.delete(treatmentCardsTable).where(inArray(treatmentCardsTable.id, cards));
    if (employees.length) await db.delete(membersTable).where(inArray(membersTable.id, employees));
    if (services.length) await db.delete(serviceTypesTable).where(inArray(serviceTypesTable.id, services));
    await pool.end();
  }
});
