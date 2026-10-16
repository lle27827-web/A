import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool, membersTable, serviceSessionsTable, personalServicesTable, personalSessionsTable } from "@workspace/db";
import { createEmployee } from "./employee-history";
import { MassageError } from "./massage";
import { getPersonalNotebook, getPersonalComparison, savePersonalService, deletePersonalService,
  savePersonalSession, deletePersonalSession } from "./personal-notebook";

const rejects = (status: number) => (error: unknown) => error instanceof MassageError && error.status === status;
test("personal data stays account-scoped, snapshots pay, and compares central salary read-only", async () => {
  const marker = randomUUID(), a = `test_personal_a_${marker}`, b = `test_personal_b_${marker}`;
  const day = "2090-01-02", month = "2090-01";
  let memberId: number | undefined;
  const centralIds: number[] = [];
  try {
    const sa = await savePersonalService(a, { name: "Dịch vụ riêng A", hourlyRate: 100000 });
    const sb = await savePersonalService(b, { name: "Dịch vụ riêng B", hourlyRate: 70000 });
    const input = { serviceId: sa.id, workDate: day, minutes: 90, note: "Ghi chú riêng A" };
    const first = await savePersonalSession(a, input);
    const other = await savePersonalSession(b, { ...input, serviceId: sb.id, minutes: 45, note: "Chỉ B thấy" });
    assert.equal(first.earnings, 150000);
    assert.ok(!("userId" in first), "responses never expose provider account IDs");
    let report = await getPersonalNotebook(a, month, day);
    assert.equal(report.totalDay, 150000);
    assert.equal(report.totalMonth, 150000);
    assert.deepEqual(report.services.map((s) => s.id), [sa.id]);
    assert.deepEqual(report.sessions.map((s) => s.id), [first.id]);
    const bBefore = await getPersonalNotebook(b, month, day);
    assert.equal(bBefore.totalMonth, 52500);
    await assert.rejects(savePersonalSession(a, { ...input, serviceId: sb.id }), rejects(404));
    await assert.rejects(savePersonalSession(a, input, other.id), rejects(404));
    await assert.rejects(deletePersonalSession(a, other.id), rejects(404));
    await assert.rejects(savePersonalService(a, { name: "Attack", hourlyRate: 0 }, sb.id), rejects(404));
    await assert.rejects(deletePersonalService(a, sb.id), rejects(404));
    assert.deepEqual(await getPersonalNotebook(b, month, day), bBefore);
    // Even a missing application-level filter cannot link a session to another account's service.
    await assert.rejects(db.insert(personalSessionsTable).values({
      userId: a, serviceId: sb.id, serviceName: "Invalid", workDate: day,
      minutes: 1, hourlyRate: 0, earnings: 0, note: "",
    }));
    await savePersonalService(a, { name: "Đổi tên, giá mới", hourlyRate: 200000 }, sa.id);
    const editOld = await savePersonalSession(a, { ...input, minutes: 60 }, first.id);
    assert.equal(editOld.hourlyRate, 100000);
    assert.equal(editOld.serviceName, "Dịch vụ riêng A");
    assert.equal(editOld.earnings, 100000);
    const newer = await savePersonalSession(a, { ...input, minutes: 30, workDate: "2090-01-03" });
    assert.equal(newer.hourlyRate, 200000);
    assert.equal(newer.earnings, 100000);
    await deletePersonalService(a, sa.id);
    await assert.rejects(savePersonalSession(a, input), rejects(404));
    assert.equal((await savePersonalSession(a, { ...input, minutes: 30 }, first.id)).earnings, 50000);
    const replacement = await savePersonalService(a, { name: "Thay dịch vụ", hourlyRate: 120000 });
    const moved = await savePersonalSession(a, { ...input, serviceId: replacement.id, minutes: 30 }, first.id);
    assert.equal(moved.earnings, 60000);
    assert.equal(moved.hourlyRate, 120000);
    const older = await savePersonalSession(a, { ...input, serviceId: replacement.id, workDate: "2089-12-31", minutes: 30 });
    report = await getPersonalNotebook(a, month, day);
    assert.equal(report.totalDay, 60000);
    assert.equal(report.totalMonth, 160000);
    assert.deepEqual(report.months, ["2090-01", "2089-12"]);
    assert.equal((await getPersonalNotebook(a, "2089-12", "2089-12-31")).totalMonth, 60000);
    await assert.rejects(savePersonalSession(a, { ...input, workDate: "2090-02-30" }), rejects(400));
    await assert.rejects(savePersonalSession(a, { ...input, minutes: 0 }), rejects(400));
    await assert.rejects(savePersonalService(a, { name: " ", hourlyRate: 0 }), rejects(400));
    await assert.rejects(getPersonalNotebook(a, month, "2090-02-01"), rejects(400));
    await assert.rejects(getPersonalNotebook("", month, day), rejects(401));

    const member = await createEmployee({ name: `Personal comparison ${marker}`, hourlyRate: 40000 });
    memberId = member.id;
    const central = await db.insert(serviceSessionsTable).values([
      { memberId, employeeName: member.name, serviceType: "Fixture", workDate: day, minutes: 60, hourlyRate: 40000, earnings: 40000 },
      { memberId, employeeName: member.name, serviceType: "Fixture", workDate: "2090-01-03", minutes: 30, hourlyRate: 40000, earnings: 20000 },
    ]).returning();
    centralIds.push(...central.map((row) => row.id));
    const comparison = await getPersonalComparison(a, memberId, month, day);
    assert.deepEqual(comparison, { memberName: member.name, personalDay: 60000, personalMonth: 160000,
      referenceDay: 40000, referenceMonth: 60000, differenceDay: 20000, differenceMonth: 100000 });
    const compareB = await getPersonalComparison(b, memberId, month, day);
    assert.equal(compareB.personalMonth, 52500);
    assert.equal(compareB.differenceMonth, -7500);
    assert.deepEqual(await db.select().from(serviceSessionsTable).where(inArray(serviceSessionsTable.id, centralIds)), central,
      "comparison never synchronizes or mutates facility shifts");
    await deletePersonalSession(a, first.id);
    assert.equal((await getPersonalNotebook(a, month, day)).totalDay, 0);
    assert.equal((await getPersonalNotebook(a, month, day)).totalMonth, 100000);
    assert.equal((await getPersonalNotebook(b, month, day)).totalMonth, 52500);
    await deletePersonalSession(a, older.id);
    assert.deepEqual((await getPersonalNotebook(a, month, day)).months, [month]);
    const highRate = await savePersonalService(a, { name: "Giới hạn giá hợp lệ", hourlyRate: 100000000 });
    const longShift = await savePersonalSession(a, { serviceId: highRate.id, workDate: day, minutes: 1440, note: "" });
    assert.equal(longShift.earnings, 2400000000, "valid pay must not overflow PostgreSQL int32");
    await deletePersonalSession(a, longShift.id);
  } finally {
    await db.delete(personalSessionsTable).where(inArray(personalSessionsTable.userId, [a, b]));
    await db.delete(personalServicesTable).where(inArray(personalServicesTable.userId, [a, b]));
    if (centralIds.length) await db.delete(serviceSessionsTable).where(inArray(serviceSessionsTable.id, centralIds));
    if (memberId) await db.delete(membersTable).where(eq(membersTable.id, memberId));
    await pool.end();
  }
});
