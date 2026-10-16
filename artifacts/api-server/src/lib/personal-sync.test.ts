import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, pool, personalServicesTable as services, personalSessionsTable as sessions,
  personalSettingsTable as settings, serviceTypesTable as types, serviceSessionsTable as visits, membersTable } from "@workspace/db";
import { savePersonalService, savePersonalSession, getPersonalNotebook, updatePersonalSettings } from "./personal-notebook";
import { comparePersonalVisits, getPersonalComparison, syncPersonalNotebook } from "./personal-comparison";
import { createEmployee } from "./employee-history";
import { MassageError } from "./massage";

test("personal live rates, idempotency, scope replacement, detailed mismatches and account isolation", async () => {
  const marker = randomUUID(), a = `sync-a-${marker}`, b = `sync-b-${marker}`;
  const day = "2092-03-02", month = "2092-03";
  let memberId: number | undefined, typeId: number | undefined;
  const rejected = (e: unknown) => e instanceof MassageError && e.status === 409;
  try {
    const own = await savePersonalService(a, { name: "Private old", hourlyRate: 100000 });
    const other = await savePersonalService(b, { name: "Private B", hourlyRate: 50000 });
    const input = { serviceId: own.id, workDate: day, minutes: 60, note: "", customerName: "Khách A", requestId: randomUUID() };
    const [first, retry] = await Promise.all([savePersonalSession(a, input), savePersonalSession(a, input)]);
    assert.equal(first.id, retry.id, "double click or network retry must not create two shifts");
    await savePersonalSession(a, { ...input, workDate: "2092-02-28", requestId: randomUUID() });
    await savePersonalSession(a, { ...input, workDate: "2092-03-03", requestId: randomUUID() });
    await savePersonalSession(b, { ...input, serviceId: other.id, requestId: randomUUID() });
    const otherBefore = await getPersonalNotebook(b, month, day);
    const [type] = await db.insert(types).values({ name: `Live ${marker}`, hourlyRate: 70000, customerHourlyRate: 200000 }).returning();
    typeId = type.id;
    await updatePersonalSettings(a, true);
    let nb = await getPersonalNotebook(a, month, day);
    const live = nb.services.find((s) => s.facilityServiceId === typeId)!;
    assert.equal(live.name, type.name);
    assert.equal(live.hourlyRate, 70000, "must use employee wages, not customer service price");
    assert.ok(!nb.services.some((s) => s.id === own.id));
    await db.update(types).set({ name: `Updated ${marker}`, hourlyRate: 90000 }).where(eq(types.id, typeId));
    nb = await getPersonalNotebook(a, month, day);
    assert.equal(nb.services.find((s) => s.id === live.id)?.hourlyRate, 90000);
    const latest = await savePersonalSession(a, { ...input, serviceId: live.id, requestId: randomUUID() });
    assert.equal(latest.hourlyRate, 90000);
    assert.equal((await getPersonalNotebook(a, month, day)).sessions.find((s) => s.id === first.id)?.hourlyRate, 100000,
      "live rate changes must not reprice historical entries");
    await assert.rejects(savePersonalService(a, { name: "Forbidden", hourlyRate: 1 }, live.id), rejected);

    const member = await createEmployee({ name: `Compare ${marker}`, hourlyRate: 60000 }); memberId = member.id;
    const central = await db.insert(visits).values([
      { memberId, employeeName: member.name, serviceTypeId: typeId, serviceType: type.name, customerName: "Khách một",
        workDate: day, minutes: 60, hourlyRate: 60000, earnings: 60000, note: "Cũ" },
      { memberId, employeeName: member.name, serviceTypeId: typeId, serviceType: type.name, customerName: "Khách hai",
        workDate: "2092-03-03", minutes: 90, hourlyRate: 60000, earnings: 90000, note: "" },
    ]).returning();
    let cmp = await getPersonalComparison(a, memberId, month, day);
    assert.ok(cmp.discrepancies.length > 0);
    assert.equal(cmp.referenceVisits[0].customerName, "Khách một");
    assert.ok(!("phone" in cmp.referenceVisits[0]) && !("customerCharge" in cmp.referenceVisits[0]));
    const syncInput = { memberId, month, date: day, scope: "day" as const, revision: cmp.revisionDay };
    await savePersonalSession(a, { ...input, serviceId: live.id, minutes: 30, requestId: randomUUID() });
    await assert.rejects(syncPersonalNotebook(a, syncInput), rejected);
    cmp = await getPersonalComparison(a, memberId, month, day);
    const validInput = { ...syncInput, revision: cmp.revisionDay };
    assert.deepEqual(await syncPersonalNotebook(a, validInput), { removed: 3, imported: 1 });
    await assert.rejects(syncPersonalNotebook(a, validInput), rejected, "replay of a confirmed destructive request must not run again");
    nb = await getPersonalNotebook(a, month, day);
    assert.equal(nb.totalDay, 60000);
    assert.equal(nb.totalMonth, 160000, "day replacement leaves the other day untouched");
    assert.equal(nb.sessions.find((s) => s.workDate === day)?.customerName, "Khách một");
    cmp = await getPersonalComparison(a, memberId, month, day);
    assert.equal(cmp.discrepancies.filter((d) => [...d.personal, ...d.reference].some((v) => v.workDate === day)).length, 0);
    await assert.rejects(syncPersonalNotebook(b, { ...validInput, revision: cmp.revisionDay }), rejected,
      "confirmation revision is bound to the authenticated account");
    assert.deepEqual(await syncPersonalNotebook(a, { ...validInput, scope: "month", revision: cmp.revisionMonth }),
      { removed: 2, imported: 2 });
    cmp = await getPersonalComparison(a, memberId, month, day);
    assert.equal(cmp.discrepancies.length, 0);
    assert.equal(cmp.differenceMonth, 0);
    assert.equal((await getPersonalNotebook(a, "2092-02", "2092-02-28")).totalMonth, 100000);
    assert.deepEqual(await getPersonalNotebook(b, month, day), otherBefore);
    assert.deepEqual(await db.select().from(visits).where(eq(visits.memberId, memberId)).orderBy(visits.id), central,
      "import never edits the facility");
    await updatePersonalSettings(a, false);
    assert.ok((await getPersonalNotebook(a, month, day)).services.some((s) => s.id === own.id), "own catalog survives turning sync off");
    const row = cmp.referenceVisits[0];
    const diffs = comparePersonalVisits([{ ...row, minutes: 30, earnings: 30000 }], [row]);
    assert.match(diffs[0].reason, /thời lượng.*tiền công/);
    assert.equal(comparePersonalVisits([row, { ...row, id: 99999 }], [row]).length, 1, "legitimate same-day visits use multiset comparison");
  } finally {
    await db.delete(sessions).where(inArray(sessions.userId, [a, b]));
    await db.delete(services).where(inArray(services.userId, [a, b]));
    await db.delete(settings).where(inArray(settings.userId, [a, b]));
    if (memberId) {
      await db.delete(visits).where(eq(visits.memberId, memberId));
      await db.delete(membersTable).where(eq(membersTable.id, memberId));
    }
    if (typeId) await db.delete(types).where(eq(types.id, typeId));
    await pool.end();
  }
});
