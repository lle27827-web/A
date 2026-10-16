import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, pool, treatmentCardsTable as cards, cardTopUpsTable as payments,
  serviceSessionsTable as visits, membersTable, serviceTypesTable } from "@workspace/db";
import { addCardHours, createCard, updateCard, saveSession, deleteCard, MassageError } from "./massage";
import { getFacilityRevenue } from "./facility-revenue";

test("editing duplicate identity requires consent and preserves receipts, balances, used flag and payroll", async () => {
  const marker = randomUUID(), ids: number[] = [];
  let memberId: number | undefined, serviceTypeId: number | undefined;
  const input = { customerName: `Merge ${marker}`, phone: "0901234567", serviceType: `Service ${marker}`,
    totalMinutes: 180, purchaseAmount: 300000, purchaseDate: "2091-02-03", note: "Source note" };
  try {
    const target = await createCard(input); ids.push(target.id);
    const source = await createCard({ ...input, customerName: `Other ${marker}`, purchaseDate: "2091-01-05" }); ids.push(source.id);
    await addCardHours(source.id, 60, 100000);
    await addCardHours(target.id, 30, 50000);
    const [member] = await db.insert(membersTable).values({ name: `Merge fixture ${marker}` }).returning();
    memberId = member.id;
    const [service] = await db.insert(serviceTypesTable).values({ name: input.serviceType, hourlyRate: 40000 }).returning();
    serviceTypeId = service.id;
    const visit = await saveSession({ cardId: source.id, memberId, serviceTypeId,
      workDate: "2091-01-06", minutes: 60, note: "old visit" });
    const beforeJanuary = await getFacilityRevenue("2091-01", "2091-01-05");
    const beforeFebruary = await getFacilityRevenue("2091-02", "2091-02-03");
    const draft = { customerName: `  ${input.customerName.toUpperCase()} `, phone: "090 123-4567",
      serviceType: ` ${input.serviceType.toUpperCase()} ` };
    const before = await db.select().from(cards).where(inArray(cards.id, ids)).orderBy(cards.id);
    await assert.rejects(updateCard(source.id, draft), (e: unknown) =>
      e instanceof MassageError && e.status === 409 && e.details?.mergeTargetId === target.id);
    assert.deepEqual(await db.select().from(cards).where(inArray(cards.id, ids)).orderBy(cards.id), before,
      "preview/cancel must not change money, balances or history");
    await assert.rejects(updateCard(source.id, { ...draft, mergeTargetId: target.id + 99999 }),
      (e: unknown) => e instanceof MassageError && e.status === 409);
    const merged = await updateCard(source.id, { ...draft, mergeTargetId: target.id });
    assert.equal(merged.id, target.id);
    assert.equal(merged.totalMinutes, 450);
    assert.equal(merged.usedMinutes, 60);
    assert.equal(merged.remainingMinutes, 390);
    assert.equal(merged.totalPaidAmount, 750000);
    assert.equal(merged.hasBeenUsed, true);
    assert.equal(merged.topUps.length, 3);
    assert.ok(merged.topUps.some((p) => p.source === "merged_card" && p.paymentDate === "2091-01-05" && p.amount === 300000));
    const [moved] = await db.select().from(visits).where(eq(visits.id, visit.id));
    assert.equal(moved.cardId, target.id);
    assert.equal(moved.earnings, visit.earnings);
    assert.equal(moved.employeeName, visit.employeeName);
    const afterJanuary = await getFacilityRevenue("2091-01", "2091-01-05");
    assert.equal(afterJanuary.cardRevenue, beforeJanuary.cardRevenue);
    assert.equal(afterJanuary.netRevenue, beforeJanuary.netRevenue);
    assert.equal(afterJanuary.payroll, beforeJanuary.payroll);
    // The receipt is now a merged payment rather than a *second* sold card.
    const afterFebruary = await getFacilityRevenue("2091-02", "2091-02-03");
    assert.equal(afterFebruary.cardRevenue, beforeFebruary.cardRevenue);
    assert.equal(afterFebruary.netRevenue, beforeFebruary.netRevenue);
    assert.equal(afterFebruary.payroll, beforeFebruary.payroll);
    await assert.rejects(deleteCard(target.id), (e: unknown) => e instanceof MassageError && e.status === 409);
    await assert.rejects(updateCard(source.id, { ...draft, mergeTargetId: target.id }),
      (e: unknown) => e instanceof MassageError && e.status === 404);

    // Base hours can be zero after a legitimate old edit; its receipt must not disappear.
    const zero = await createCard({ ...input, customerName: `Zero ${marker}`, totalMinutes: 60 }); ids.push(zero.id);
    await addCardHours(zero.id, 60, 20000);
    await updateCard(zero.id, { totalMinutes: 60 });
    const zeroMerge = await updateCard(zero.id, { ...draft, mergeTargetId: target.id });
    assert.ok(zeroMerge.topUps.some((p) => p.source === "merged_card" && p.minutes === 0 && p.amount === 300000));
    assert.equal(zeroMerge.totalPaidAmount, 1070000);
  } finally {
    if (ids.length) {
      await db.delete(visits).where(inArray(visits.cardId, ids));
      await db.delete(payments).where(inArray(payments.cardId, ids));
      await db.delete(cards).where(inArray(cards.id, ids));
    }
    if (memberId) await db.delete(membersTable).where(eq(membersTable.id, memberId));
    if (serviceTypeId) await db.delete(serviceTypesTable).where(eq(serviceTypesTable.id, serviceTypeId));
    await pool.end();
  }
});
