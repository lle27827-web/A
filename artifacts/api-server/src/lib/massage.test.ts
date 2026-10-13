import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { db, pool, membersTable, serviceSessionsTable, treatmentCardsTable, serviceTypesTable } from "@workspace/db";
import { addCardHours, cardResponse, createCard, deleteCard, deleteSession, MassageError, saveSession, updateCard } from "./massage";

test("card balance and service payroll stay consistent through edits and concurrent use", async () => {
  const marker = `Verify-${randomUUID()}`;
  const cards: number[] = [];
  const sessions: number[] = [];
  const services: number[] = [];
  let memberId: number | undefined;
  const record = async (input: Parameters<typeof saveSession>[0], id?: number) => {
    const session = await saveSession(input, id);
    if (!sessions.includes(session.id)) sessions.push(session.id);
    return session;
  };
  const balance = async (cardId: number) => {
    const [row] = await db.select({ used: sql<number>`coalesce(sum(${serviceSessionsTable.minutes}), 0)` })
      .from(serviceSessionsTable).where(eq(serviceSessionsTable.cardId, cardId));
    return Number(row.used);
  };
  const fails = (status: number) => (error: unknown) => error instanceof MassageError && error.status === status;
  try {
    const [member] = await db.insert(membersTable).values({ name: marker, hourlyRate: 0 }).returning();
    memberId = member.id;
    const [service] = await db.insert(serviceTypesTable).values({ name: marker, hourlyRate: 100000 }).returning();
    const [otherService] = await db.insert(serviceTypesTable).values({ name: `${marker}-other`, hourlyRate: 150000 }).returning();
    services.push(service.id, otherService.id);
    const makeCard = async (minutes: number) => {
      const card = await createCard({
        customerName: marker, phone: "0000000000", serviceType: "Dịch vụ kiểm tra",
        totalMinutes: minutes, purchaseAmount: 1000000, purchaseDate: "2099-10-13",
      });
      cards.push(card.id);
      return card;
    };
    const a = await makeCard(600);
    const b = await makeCard(120);
    const c = await makeCard(30);
    const topupCard = await makeCard(120);
    const before = await addCardHours(topupCard.id, 90);
    assert.equal(before.totalMinutes, 210);
    assert.equal(before.remainingMinutes, 210);
    assert.equal(before.purchaseAmount, 1000000);
    assert.equal(before.purchaseDate, "2099-10-13");
    await Promise.all([addCardHours(topupCard.id, 30), addCardHours(topupCard.id, 60)]);
    const after = await addCardHours(topupCard.id, 1);
    assert.equal(after.totalMinutes, 301, "concurrent top-ups add, rather than overwrite");
    await assert.rejects(addCardHours(topupCard.id, 0), fails(400));
    await assert.rejects(addCardHours(topupCard.id, -1), fails(400));
    await assert.rejects(addCardHours(topupCard.id, 1.5), fails(400));
    await assert.rejects(addCardHours(topupCard.id, 600000), fails(400));
    const topupVisit = await record({ memberId, serviceTypeId: service.id, cardId: topupCard.id, workDate: "2099-10-13", minutes: 60, note: marker });
    const toppedWithHistory = await addCardHours(topupCard.id, 30);
    assert.equal(toppedWithHistory.totalMinutes, 331);
    assert.equal(toppedWithHistory.usedMinutes, 60);
    assert.equal(toppedWithHistory.remainingMinutes, 271);
    const changedVisit = await record({ memberId, serviceTypeId: service.id, cardId: topupCard.id, workDate: "2099-10-13", minutes: 90, note: marker }, topupVisit.id);
    assert.equal(changedVisit.earnings, 150000);
    assert.equal(await balance(topupCard.id), 90);
    await deleteSession(topupVisit.id);
    assert.equal(await balance(topupCard.id), 0, "deleting a visit refunds its hours");
    const input = { memberId, serviceTypeId: service.id, cardId: a.id, workDate: "2026-10-13", minutes: 60, note: marker };
    const first = await record(input);
    assert.equal(first.earnings, 100000);
    assert.equal(await balance(a.id), 60);
    await db.update(membersTable).set({ hourlyRate: 9000000 }).where(eq(membersTable.id, memberId));
    await db.update(serviceTypesTable).set({ name: `${marker}-new`, hourlyRate: 200000 }).where(eq(serviceTypesTable.id, service.id));
    const edited = await record({ ...input, minutes: 90 }, first.id);
    assert.equal(edited.hourlyRate, 100000, "historical hourly rate must not change");
    assert.equal(edited.earnings, 150000);
    assert.equal(edited.serviceType, marker, "historical service name must not change");
    const second = await record({ ...input, minutes: 30 });
    assert.equal(second.hourlyRate, 200000);
    assert.equal(second.earnings, 100000);
    assert.equal(second.serviceType, `${marker}-new`);
    assert.equal(await balance(a.id), 120);
    await deleteSession(second.id);
    assert.equal(await balance(a.id), 90, "deleting a visit restores card hours");
    await assert.rejects(record({ ...input, minutes: 600 }), fails(409));
    await assert.rejects(updateCard(a.id, { totalMinutes: 80 }), fails(409));
    await assert.rejects(record({ ...input, workDate: "2026-02-31" }), fails(400));
    await assert.rejects(record({ ...input, cardId: c.id, minutes: 90 }, first.id), fails(409));
    assert.equal(await balance(a.id), 90, "failed card transfer must roll back");
    assert.equal(await balance(c.id), 0);
    await record({ ...input, cardId: b.id, minutes: 90 }, first.id);
    assert.equal(await balance(a.id), 0);
    assert.equal(await balance(b.id), 90);
    const concurrent = await Promise.allSettled([
      record({ ...input, cardId: b.id, minutes: 30 }),
      record({ ...input, cardId: b.id, minutes: 30 }),
    ]);
    assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1);
    const rejected = concurrent.find((r) => r.status === "rejected");
    assert.ok(rejected?.status === "rejected" && fails(409)(rejected.reason));
    assert.equal(await balance(b.id), 120, "concurrent uses cannot overdraw the card");
    const [row] = await db.select().from(treatmentCardsTable).where(eq(treatmentCardsTable.id, b.id));
    assert.equal(cardResponse(row, 120).phone, "•••• 0000");
    assert.equal(cardResponse(row, 120, true).phone, "0000000000");
    await assert.rejects(record({ ...input, cardId: null, serviceTypeId: null }), fails(400));
    await assert.rejects(record({ ...input, cardId: null, serviceTypeId: 999999999 }), fails(404));
    const standalone = await record({ ...input, cardId: null, workDate: "2026-09-30" });
    const switched = await record({ ...input, cardId: null, serviceTypeId: otherService.id, workDate: "2026-09-30" }, standalone.id);
    assert.equal(switched.hourlyRate, 150000, "changing service uses that service's current rate");
    assert.equal(switched.earnings, 150000);
    const [legacy] = await db.insert(serviceSessionsTable).values({
      memberId, employeeName: marker, serviceType: "Dịch vụ cũ",
      workDate: "2026-09-29", minutes: 60, hourlyRate: 50000, earnings: 50000,
    }).returning();
    sessions.push(legacy.id);
    const legacyEdit = await record({ ...input, cardId: null, serviceTypeId: null, workDate: "2026-09-29", minutes: 90 }, legacy.id);
    assert.equal(legacyEdit.serviceType, "Dịch vụ cũ");
    assert.equal(legacyEdit.hourlyRate, 50000);
    assert.equal(legacyEdit.earnings, 75000);
    const archived = await createCard({
      customerName: marker, phone: "0000", serviceType: "test", totalMinutes: 120,
      purchaseAmount: 50, purchaseDate: "2099-12-01", note: "",
    });
    cards.push(archived.id);
    const archivedSession = await record({ ...input, cardId: archived.id, minutes: 60, workDate: "2099-12-01" });
    await deleteCard(archived.id);
    const [deleted] = await db.select().from(treatmentCardsTable).where(eq(treatmentCardsTable.id, archived.id));
    assert.ok(deleted.deletedAt);
    const [saved] = await db.select().from(serviceSessionsTable).where(eq(serviceSessionsTable.id, archivedSession.id));
    assert.equal(saved.cardId, archived.id);
    assert.equal(saved.earnings, archivedSession.earnings);
    await assert.rejects(addCardHours(archived.id, 60), fails(404));
    await assert.rejects(updateCard(archived.id, { customerName: marker }), fails(404));
    await assert.rejects(record({ ...input, cardId: archived.id, minutes: 60, workDate: "2099-12-01" }), fails(404));
    const editedArchive = await record({ ...input, cardId: archived.id, minutes: 90, workDate: "2099-12-01" }, archivedSession.id);
    assert.equal(editedArchive.cardDeleted, true);
    assert.equal(editedArchive.minutes, 90);
    await db.delete(membersTable).where(eq(membersTable.id, memberId));
    const [retained] = await db.select().from(serviceSessionsTable).where(eq(serviceSessionsTable.id, first.id));
    assert.equal(retained.memberId, null);
    assert.equal(retained.employeeName, marker);
    assert.equal(retained.earnings, 150000);
  } finally {
    if (sessions.length) await db.delete(serviceSessionsTable).where(inArray(serviceSessionsTable.id, sessions));
    if (cards.length) await db.delete(treatmentCardsTable).where(inArray(treatmentCardsTable.id, cards));
    if (memberId) await db.delete(membersTable).where(eq(membersTable.id, memberId));
    if (services.length) await db.delete(serviceTypesTable).where(inArray(serviceTypesTable.id, services));
    await pool.end();
  }
});
