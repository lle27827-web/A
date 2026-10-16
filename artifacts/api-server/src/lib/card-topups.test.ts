import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { cardTopUpsTable, db, membersTable, pool, serviceSessionsTable, serviceTypesTable, treatmentCardsTable } from "@workspace/db";
import { AddTreatmentCardHoursBody, GetMassageSummaryResponse } from "@workspace/api-zod";
import { addCardHours, createCard, currentBusinessDate, deleteCard, MassageError, saveSession } from "./massage";
import { getFacilityRevenue } from "./facility-revenue";

test("paid top-ups and duplicate sales retain history and recognize cash once on their own dates", async () => {
  const marker = `Topup-${randomUUID()}`;
  const cardIds = new Set<number>();
  const sessionIds: number[] = [];
  let memberId: number | undefined;
  let serviceId: number | undefined;
  const today = currentBusinessDate();
  const month = today.slice(0, 7);
  const oldDate = "2097-01-05";
  const make = async (overrides: Partial<Parameters<typeof createCard>[0]> = {}) => {
    const input = {
      customerName: marker, phone: "0900 000-001", serviceType: `${marker} Service`,
      totalMinutes: 120, purchaseAmount: 1000000, purchaseDate: oldDate, ...overrides,
    };
    let card;
    try { card = await createCard(input); } catch (e) {
      assert.ok(e instanceof MassageError && e.status === 409 && e.details?.mergeTargetId,
        "duplicates must require consent before being credited");
      card = await createCard({ ...input, mergeTargetId: e.details.mergeTargetId });
    }
    cardIds.add(card.id);
    return card;
  };
  const isInvalid = (e: unknown) => e instanceof MassageError && e.status === 400;
  try {
    const baseline = await getFacilityRevenue(month, today);
    const oldBaseline = await getFacilityRevenue("2097-01", oldDate);
    const original = await make();
    const paid = await addCardHours(original.id, 60, 300000);
    assert.equal(paid.purchaseDate, oldDate);
    assert.equal(paid.purchaseAmount, 1000000);
    assert.equal(paid.totalPaidAmount, 1300000);
    assert.equal(paid.topUps[0].paymentDate, today);
    assert.equal(paid.totalMinutes, 180);
    const merged = await make({
      customerName: `  ${marker.toUpperCase()}  `, phone: "0900000001",
      serviceType: `  ${marker.toUpperCase()}   SERVICE `, totalMinutes: 30, purchaseAmount: 150000,
      purchaseDate: today, note: "automatic merge",
    });
    assert.equal(merged.id, original.id);
    assert.equal(merged.mergedIntoExisting, true);
    assert.equal(merged.totalMinutes, 210);
    assert.equal(merged.purchaseDate, oldDate);
    assert.equal(merged.topUps.length, 2);
    assert.ok(merged.topUps.some((p) => p.source === "merged_sale" && p.amount === 150000 && p.note === "automatic merge"));
    await Promise.all([
      make({ totalMinutes: 15, purchaseAmount: 50000, purchaseDate: today }),
      make({ totalMinutes: 15, purchaseAmount: 50000, purchaseDate: today }),
    ]);
    await Promise.all([addCardHours(original.id, 5, 10000), addCardHours(original.id, 5, 10000)]);
    const [stored] = await db.select().from(treatmentCardsTable).where(eq(treatmentCardsTable.id, original.id));
    assert.equal(stored.totalMinutes, 250, "simultaneous merges and top-ups must not lose hours");
    const history = await db.select().from(cardTopUpsTable).where(eq(cardTopUpsTable.cardId, original.id));
    assert.equal(history.length, 6);
    assert.equal(history.reduce((sum, p) => sum + p.amount, 0), 570000);
    for (const amount of [-1, 1000000001, 1.5, Number.NaN]) {
      await assert.rejects(addCardHours(original.id, 5, amount), isInvalid);
    }
    await assert.rejects(addCardHours(original.id, 600000, 1000), isInvalid);
    await assert.rejects(make({ totalMinutes: 600000, purchaseAmount: 1000, purchaseDate: today }), isInvalid);
    assert.equal((await db.select().from(cardTopUpsTable).where(eq(cardTopUpsTable.cardId, original.id))).length, 6);
    assert.equal(AddTreatmentCardHoursBody.safeParse({ minutes: 60 }).success, false);
    const oldReport = await getFacilityRevenue("2097-01", oldDate);
    assert.equal(oldReport.cardRevenue - oldBaseline.cardRevenue, 1000000, "new money cannot rewrite the original sale date");
    const [member] = await db.insert(membersTable).values({ name: marker }).returning();
    memberId = member.id;
    const [service] = await db.insert(serviceTypesTable).values({
      name: marker, customerHourlyRate: 200000, hourlyRate: 100000,
    }).returning();
    serviceId = service.id;
    for (const cardId of [original.id, null]) {
      const session = await saveSession({ memberId, serviceTypeId: serviceId, cardId, minutes: 30, workDate: today });
      sessionIds.push(session.id);
    }
    const report = GetMassageSummaryResponse.parse(await getFacilityRevenue(month, today));
    assert.equal(report.cardRevenue - baseline.cardRevenue, 570000);
    assert.equal(report.serviceRevenue - baseline.serviceRevenue, 100000);
    assert.equal(report.payroll - baseline.payroll, 100000);
    assert.equal(report.netRevenue - baseline.netRevenue, 620000);
    assert.equal(report.today.cardRevenue - baseline.today.cardRevenue, 570000);
    assert.equal(report.today.netRevenue - baseline.today.netRevenue, 620000);
    assert.equal(report.cardsSold, baseline.cardsSold, "top-ups must not create extra card-sale counts");
    const creditedUsedCard = await make({ totalMinutes: 60, purchaseAmount: 10000, purchaseDate: today });
    assert.equal(creditedUsedCard.id, original.id, "used cards still receive matching new sales as top-ups");
    assert.equal(creditedUsedCard.hasBeenUsed, true);
    assert.equal(creditedUsedCard.usedMinutes, 30);
    assert.equal(creditedUsedCard.topUps.length, 7);
    const creditedReport = await getFacilityRevenue(month, today);
    assert.equal(creditedReport.netRevenue - report.netRevenue, 10000);
    assert.equal(creditedReport.payroll, report.payroll);
    await assert.rejects(deleteCard(original.id),
      (error: unknown) => error instanceof MassageError && error.status === 409);
    assert.deepEqual(await getFacilityRevenue(month, today), creditedReport);
    // A legacy archive is seeded directly to verify old archived rows remain excluded.
    await db.update(treatmentCardsTable).set({ deletedAt: new Date() })
      .where(eq(treatmentCardsTable.id, original.id));
    const archived = await getFacilityRevenue(month, today);
    assert.equal(archived.cardRevenue, baseline.cardRevenue);
    assert.equal(archived.netRevenue - baseline.netRevenue, 50000);
    assert.equal((await db.select().from(cardTopUpsTable).where(eq(cardTopUpsTable.cardId, original.id))).length, 7);
    const replacement = await make({ purchaseDate: today });
    assert.notEqual(replacement.id, original.id, "archived cards cannot receive automatic merges");
    for (const overrides of [
      { phone: "0900000002" }, { customerName: `${marker} Different` }, { serviceType: `${marker} Different` },
    ]) {
      assert.notEqual((await make(overrides)).id, replacement.id, "all three identity fields must match");
    }
    const raced = await Promise.all([
      make({ customerName: `${marker} Race`, totalMinutes: 30, purchaseAmount: 20000, purchaseDate: today }),
      make({ customerName: `${marker} Race`, totalMinutes: 30, purchaseAmount: 20000, purchaseDate: today }),
    ]);
    assert.equal(raced[0].id, raced[1].id, "concurrent first sales must create only one card");
    assert.deepEqual(raced.map((c) => c.totalMinutes).sort((a, b) => a - b), [30, 60]);
  } finally {
    if (sessionIds.length) await db.delete(serviceSessionsTable).where(inArray(serviceSessionsTable.id, sessionIds));
    if (cardIds.size) await db.delete(treatmentCardsTable).where(inArray(treatmentCardsTable.id, [...cardIds]));
    if (memberId) await db.delete(membersTable).where(eq(membersTable.id, memberId));
    if (serviceId) await db.delete(serviceTypesTable).where(eq(serviceTypesTable.id, serviceId));
    await pool.end();
  }
});
