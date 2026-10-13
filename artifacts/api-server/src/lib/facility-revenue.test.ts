import assert from "node:assert/strict";
import test from "node:test";
import { inArray } from "drizzle-orm";
import { db, pool, serviceSessionsTable, treatmentCardsTable } from "@workspace/db";
import { getFacilityRevenue } from "./facility-revenue";

test("facility report sums service pay and card sales without joining or changing history", async () => {
  const cardIds: number[] = [];
  const sessionIds: number[] = [];
  const month = "2099-02";
  try {
    const baseline = await getFacilityRevenue(month);
    assert.equal(baseline.revenue, baseline.serviceRevenue + baseline.cardRevenue);
    const cards = await db.insert(treatmentCardsTable).values([
      { customerName: "__facility_report_test", phone: "", serviceType: "test", totalMinutes: 120, purchaseAmount: 800, purchaseDate: "2099-02-01", note: "" },
      { customerName: "__facility_report_test", phone: "", serviceType: "test", totalMinutes: 60, purchaseAmount: 1200, purchaseDate: "2099-02-28", note: "" },
      { customerName: "__facility_report_test", phone: "", serviceType: "test", totalMinutes: 60, purchaseAmount: 10000, purchaseDate: "2099-03-01", note: "" },
    ]).returning();
    cardIds.push(...cards.map((c) => c.id));
    const rows = await db.insert(serviceSessionsTable).values([
      { memberId: null, employeeName: "__facility_report_test", cardId: cards[0].id, customerName: "", serviceType: "test", workDate: "2099-02-01", minutes: 60, hourlyRate: 150, earnings: 150, note: "" },
      { memberId: null, employeeName: "__facility_report_test", cardId: cards[0].id, customerName: "", serviceType: "test", workDate: "2099-02-02", minutes: 30, hourlyRate: 100, earnings: 50, note: "" },
      { memberId: null, employeeName: "__facility_report_test", cardId: null, customerName: "", serviceType: "test", workDate: "2099-02-28", minutes: 30, hourlyRate: 100, earnings: 50, note: "" },
      { memberId: null, employeeName: "__facility_report_test", cardId: null, customerName: "", serviceType: "test", workDate: "2099-01-31", minutes: 60, hourlyRate: 10000, earnings: 10000, note: "" },
    ]).returning();
    sessionIds.push(...rows.map((s) => s.id));
    const after = await getFacilityRevenue(month);
    assert.equal(after.serviceRevenue - baseline.serviceRevenue, 250);
    assert.equal(after.cardRevenue - baseline.cardRevenue, 2000);
    assert.equal(after.revenue - baseline.revenue, 2250);
    assert.equal(after.cardsSold - baseline.cardsSold, 2);
    await db.delete(treatmentCardsTable).where(inArray(treatmentCardsTable.id, [cards[1].id]));
    cardIds.splice(cardIds.indexOf(cards[1].id), 1);
    const updated = await getFacilityRevenue(month);
    assert.equal(updated.serviceRevenue, after.serviceRevenue);
    assert.equal(updated.cardRevenue, after.cardRevenue - 1200);
    assert.equal(updated.revenue, after.revenue - 1200);
    await db.delete(serviceSessionsTable).where(inArray(serviceSessionsTable.id, sessionIds));
    sessionIds.length = 0;
    await db.delete(treatmentCardsTable).where(inArray(treatmentCardsTable.id, cardIds));
    cardIds.length = 0;
    assert.deepEqual(await getFacilityRevenue(month), baseline);
  } finally {
    if (sessionIds.length) await db.delete(serviceSessionsTable).where(inArray(serviceSessionsTable.id, sessionIds));
    if (cardIds.length) await db.delete(treatmentCardsTable).where(inArray(treatmentCardsTable.id, cardIds));
    await pool.end();
  }
});
