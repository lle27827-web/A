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

test("comparison totals hours by date and service and shows only differing groups", () => {
  const row = { id: 1, serviceName: "Trị liệu", customerName: "", workDate: "2022-11-11", minutes: 60, hourlyRate: 60000, earnings: 60000, note: "" };
  const reference = Array.from({ length: 5 }, (_, i) => ({ ...row, id: i + 1 }));
  const personal = Array.from({ length: 4 }, (_, i) => ({ ...row, id: i + 11 }));
  personal.push({ ...row, id: 15, minutes: 90, earnings: 90000 });
  const differences = comparePersonalVisits(personal, reference);
  assert.equal(differences.length, 1);
  assert.equal(differences[0].personal.reduce((sum, visit) => sum + visit.minutes, 0), 330);
  assert.equal(differences[0].reference.reduce((sum, visit) => sum + visit.minutes, 0), 300);
  assert.equal(differences[0].personal.length, 5);
  assert.equal(differences[0].reference.length, 5);
  assert.equal(reference.length, 5, "input rows are never mutated");
  assert.equal(comparePersonalVisits([{ ...row, customerName: "Different", hourlyRate: 99999, earnings: 1000, note: "Old note" }], [row]).length, 0,
    "same service and daily hours match despite different pay, notes or customer text");
  assert.equal(comparePersonalVisits([{ ...row, minutes: 90 }], [row]).length, 1, "same pay but different duration does not match");
  assert.equal(comparePersonalVisits([{ ...row, workDate: "2022-11-12" }], [row]).length, 2, "never match across dates");
  assert.equal(comparePersonalVisits([{ ...row, serviceName: "Massage" }], [row]).length, 2, "never match across services");
  assert.equal(comparePersonalVisits([row, { ...row, id: 2 }], [row])[0].personal.length, 2, "totals include every shift in a service/day group");
  assert.equal(comparePersonalVisits([row, { ...row, id: 2, minutes: 120 }], [{ ...row, minutes: 180 }]).length, 0,
    "different shift splits match when service/day totals are equal");
  assert.equal(comparePersonalVisits([row], [{ ...row, earnings: 90000 }]).length, 0, "pay differences do not change hour totals");
  const offsettingDays = comparePersonalVisits(
    [{ ...row, minutes: 120 }, { ...row, id: 3, workDate: "2022-11-12", minutes: 60 }],
    [{ ...row, minutes: 60 }, { ...row, id: 4, workDate: "2022-11-12", minutes: 120 }],
  );
  assert.equal(offsettingDays.length, 2, "opposite daily differences must not cancel in a month view");
  assert.deepEqual(offsettingDays.map((group) => [group.personal[0]?.workDate ?? group.reference[0]?.workDate,
    group.personal.reduce((sum, visit) => sum + visit.minutes, 0), group.reference.reduce((sum, visit) => sum + visit.minutes, 0)]),
  [["2022-11-11", 120, 60], ["2022-11-12", 60, 120]]);
});

test("comparison groups repeated visits by date and service totals", () => {
  const row = { id: 1, serviceName: "Massage", customerName: "", workDate: "2022-11-11", minutes: 60, hourlyRate: 75000, earnings: 75000, note: "" };
  const facility = Array.from({ length: 4 }, (_, i) => ({ ...row, id: i + 1 }));
  const personalTwoMatches = [{ ...row, id: 10 }, { ...row, id: 11 }, { ...row, id: 12, minutes: 90 }, { ...row, id: 13, minutes: 120 }];
  const mismatches = comparePersonalVisits(personalTwoMatches, facility);
  assert.equal(mismatches.length, 1, "one service/date produces one total discrepancy");
  assert.equal(mismatches[0].personal.reduce((sum, visit) => sum + visit.minutes, 0), 330);
  assert.equal(mismatches[0].reference.reduce((sum, visit) => sum + visit.minutes, 0), 240);
  const noneAdded = comparePersonalVisits([], facility);
  assert.equal(noneAdded.length, 1, "an absent side produces one service/date discrepancy");
  assert.equal(noneAdded[0].personal.length, 0);
  assert.equal(noneAdded[0].reference.length, 4);
  assert.equal(comparePersonalVisits([{ ...row, minutes: 60 }, { ...row, id: 2, minutes: 60 }], [{ ...row, minutes: 120 }]).length, 0,
    "different counts match when the service/date totals are equal");
});

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
    assert.match(diffs[0].reason, /thời lượng/);
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
