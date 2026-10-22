import assert from "node:assert/strict";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, pool, serviceSessionsTable, treatmentCardsTable } from "@workspace/db";
import { GetMassageSummaryQueryParams, GetMassageSummaryResponse } from "@workspace/api-zod";
import { getFacilityRevenue } from "./facility-revenue";
import { deleteCard } from "./massage";

test("daily and monthly reports exclude archived card revenue while preserving employee payroll", async () => {
  const cardIds: number[] = [];
  const sessionIds: number[] = [];
  const month = "2099-02";
  const date = "2099-02-01";
  try {
    assert.equal(GetMassageSummaryQueryParams.parse({ month, date }).date, date);
    const baseline = await getFacilityRevenue(month, date);
    const redemptionDayBaseline = await getFacilityRevenue(month, "2099-02-02");
    assert.equal(baseline.revenue, baseline.serviceRevenue + baseline.cardRevenue);
    const popularService = `__facility_report_${Date.now()}`;
    const noSalesMonth = "2098-03";
    const noSalesDay = "2098-03-12";
    const [walkIn] = await db.insert(serviceSessionsTable).values({
      memberId: null, employeeName: "__no_sales_month_test", cardId: null, customerName: "",
      serviceType: popularService, workDate: noSalesDay, minutes: 30, customerHourlyRate: 20000, customerCharge: 10000, hourlyRate: 10000,
      earnings: 5000, note: "",
    }).returning();
    sessionIds.push(walkIn.id);
    const serviceOnly = await getFacilityRevenue(noSalesMonth, noSalesDay);
    const validatedServiceOnly = GetMassageSummaryResponse.parse(serviceOnly);
    assert.equal(serviceOnly.serviceRevenue, 10000);
    assert.equal(serviceOnly.walkInServiceRevenue, 10000);
    assert.equal(serviceOnly.walkInServiceMinutes, 30);
    assert.equal(serviceOnly.cardRevenue, 0);
    assert.equal(serviceOnly.payroll, 5000);
    assert.equal(serviceOnly.revenue, 10000);
    assert.equal(serviceOnly.netRevenue, 5000);
    assert.equal(serviceOnly.today.netRevenue, 5000);
    assert.equal(serviceOnly.revenueExcludingCardSessions, 10000);
    assert.equal(validatedServiceOnly.revenueExcludingCardSessions, 10000);
    assert.equal(validatedServiceOnly.today.revenueExcludingCardSessions, 10000);
    assert.equal(validatedServiceOnly.today.payroll, 5000);
    assert.equal(validatedServiceOnly.today.walkInServiceMinutes, 30);
    assert.equal(serviceOnly.walkInVisits, 1);
    assert.equal(validatedServiceOnly.topSoldCardService, null);
    assert.equal(validatedServiceOnly.mostUsedCardService, null);
    assert.deepEqual(validatedServiceOnly.mostUsedWalkInService, { serviceType: popularService, visits: 1 });
    assert.deepEqual(validatedServiceOnly.mostUsedService, { serviceType: popularService, visits: 1, minutes: 30 });
    assert.deepEqual(validatedServiceOnly.serviceBreakdown, [{ serviceType: popularService, minutes: 30, visits: 1 }]);
    assert.deepEqual(validatedServiceOnly.today.serviceBreakdown, [{ serviceType: popularService, minutes: 30, visits: 1 }]);
    const cards = await db.insert(treatmentCardsTable).values([
      { customerName: "__facility_report_test", phone: "", serviceType: popularService, totalMinutes: 120, purchaseAmount: 800, purchaseDate: "2099-02-01", note: "" },
      { customerName: "__facility_report_test", phone: "", serviceType: popularService, totalMinutes: 60, purchaseAmount: 1200, purchaseDate: "2099-02-28", note: "" },
      { customerName: "__facility_report_test", phone: "", serviceType: popularService, totalMinutes: 60, purchaseAmount: 10000, purchaseDate: "2099-03-01", note: "" },
    ]).returning();
    cardIds.push(...cards.map((c) => c.id));
    const rows = await db.insert(serviceSessionsTable).values([
      { memberId: null, employeeName: "__facility_report_test", cardId: cards[0].id, customerName: "", serviceType: popularService, workDate: "2099-02-01", minutes: 60, customerHourlyRate: 200, customerCharge: 200, hourlyRate: 150, earnings: 150, note: "" },
      { memberId: null, employeeName: "__facility_report_test", cardId: cards[0].id, customerName: "", serviceType: popularService, workDate: "2099-02-02", minutes: 30, customerHourlyRate: 200, customerCharge: 100, hourlyRate: 100, earnings: 50, note: "" },
      { memberId: null, employeeName: "__facility_report_test", cardId: null, customerName: "", serviceType: `${popularService}_walkin`, workDate: "2099-02-28", minutes: 30, customerHourlyRate: 200, customerCharge: 100, hourlyRate: 100, earnings: 50, note: "" },
      { memberId: null, employeeName: "__facility_report_test", cardId: null, customerName: "", serviceType: "test", workDate: "2099-01-31", minutes: 60, customerHourlyRate: 20000, customerCharge: 20000, hourlyRate: 10000, earnings: 10000, note: "" },
    ]).returning();
    sessionIds.push(...rows.map((s) => s.id));
    const after = await getFacilityRevenue(month, date);
    assert.deepEqual(after.topSoldCardService, { serviceType: popularService, cardsSold: 2 });
    assert.deepEqual(after.mostUsedCardService, { serviceType: popularService, visits: 2, minutes: 90 });
    assert.deepEqual(after.mostUsedWalkInService, { serviceType: `${popularService}_walkin`, visits: 1 });
    assert.deepEqual(after.mostUsedService, { serviceType: popularService, visits: 2, minutes: 90 });
    assert.deepEqual(after.serviceBreakdown.find((item) => item.serviceType === popularService), { serviceType: popularService, minutes: 30, visits: 1 });
    assert.deepEqual(after.serviceBreakdown.find((item) => item.serviceType === popularService && item.minutes === 60), { serviceType: popularService, minutes: 60, visits: 1 });
    assert.deepEqual(after.today.serviceBreakdown, [{ serviceType: popularService, minutes: 60, visits: 1 }]);
    assert.equal(after.walkInVisits, baseline.walkInVisits + 1);
    assert.equal(after.cardVisits, baseline.cardVisits + 2);
    assert.equal(after.today.walkInVisits, baseline.today.walkInVisits);
    assert.equal(after.today.cardVisits, baseline.today.cardVisits + 1);
    assert.equal(after.today.serviceRevenue, baseline.today.serviceRevenue);
    assert.equal(after.today.cardRevenue, baseline.today.cardRevenue + 800);
    assert.equal(after.today.revenue, baseline.today.revenue + 800);
    assert.equal(after.today.payroll, baseline.today.payroll + 150);
    assert.equal(after.serviceRevenue - baseline.serviceRevenue, 100);
    assert.equal(after.payroll - baseline.payroll, 250);
    assert.equal(after.cardRevenue - baseline.cardRevenue, 2000);
    assert.equal(after.revenue - baseline.revenue, 2100);
    assert.equal(after.walkInServiceRevenue - baseline.walkInServiceRevenue, 100);
    assert.equal(after.walkInServiceMinutes - baseline.walkInServiceMinutes, 30);
    assert.equal(after.today.walkInServiceMinutes - baseline.today.walkInServiceMinutes, 0);
    assert.equal(after.revenueExcludingCardSessions - baseline.revenueExcludingCardSessions, 2100);
    assert.equal(after.today.revenueExcludingCardSessions - baseline.today.revenueExcludingCardSessions, 800);
    assert.equal(after.cardsSold - baseline.cardsSold, 2);
    assert.equal(after.netRevenue - baseline.netRevenue, 2050);
    assert.equal(after.today.netRevenue - baseline.today.netRevenue, 800);
    const redemptionDay = await getFacilityRevenue(month, "2099-02-02");
    assert.equal(redemptionDay.today.revenue - redemptionDayBaseline.today.revenue, 0);
    assert.equal(redemptionDay.today.netRevenue - redemptionDayBaseline.today.netRevenue, 0,
      "using a card does not change revenue even on a day without a sale");
    assert.equal(redemptionDay.today.payroll - redemptionDayBaseline.today.payroll, 50,
      "card-session wages must still be recorded in employee payroll");

    // A stored redemption price must never be counted, even alongside cash-paying visits.
    await db.update(serviceSessionsTable).set({ customerCharge: 999999 })
      .where(eq(serviceSessionsTable.id, rows[0].id));
    assert.deepEqual(await getFacilityRevenue(month, date), after);
    const [extraWalkIn] = await db.insert(serviceSessionsTable).values({
      memberId: null, employeeName: "__facility_net_test", cardId: null, customerName: "",
      serviceType: `${popularService}_walkin`, workDate: date, minutes: 60, customerHourlyRate: 300000,
      customerCharge: 300000, hourlyRate: 100000, earnings: 100000, note: "",
    }).returning();
    sessionIds.push(extraWalkIn.id);
    assert.equal((await db.select().from(serviceSessionsTable)
      .where(eq(serviceSessionsTable.serviceType, `${popularService}_walkin`))).length, 2);
    const mixed = GetMassageSummaryResponse.parse(await getFacilityRevenue(month, date));
    assert.deepEqual(mixed.mostUsedWalkInService, { serviceType: `${popularService}_walkin`, visits: 2 });
    assert.deepEqual(mixed.mostUsedService, { serviceType: popularService, visits: 2, minutes: 90 });
    assert.equal(mixed.netRevenue - after.netRevenue, 200000);
    assert.equal(mixed.today.netRevenue - after.today.netRevenue, 200000);
    assert.equal(mixed.today.revenue - after.today.revenue, 300000);
    await db.update(serviceSessionsTable).set({ customerCharge: 400000, earnings: 150000 })
      .where(eq(serviceSessionsTable.id, extraWalkIn.id));
    const edited = await getFacilityRevenue(month, date);
    assert.equal(edited.netRevenue - after.netRevenue, 250000);
    assert.equal(edited.today.netRevenue - after.today.netRevenue, 250000);
    await db.update(serviceSessionsTable).set({ earnings: 500000 })
      .where(eq(serviceSessionsTable.id, extraWalkIn.id));
    const walkInLoss = await getFacilityRevenue(month, date);
    assert.equal(walkInLoss.netRevenue - after.netRevenue, -100000);
    assert.equal(walkInLoss.today.netRevenue - after.today.netRevenue, -100000,
      "cash-paying visits still deduct wages, even if wages exceed their charge");
    await db.delete(serviceSessionsTable).where(eq(serviceSessionsTable.id, extraWalkIn.id));
    sessionIds.splice(sessionIds.indexOf(extraWalkIn.id), 1);
    assert.deepEqual(await getFacilityRevenue(month, date), after,
      "removing a cash visit removes both its customer charge and its wage");

    await db.update(serviceSessionsTable).set({ earnings: 1000000 })
      .where(eq(serviceSessionsTable.id, rows[0].id));
    const changedCardWage = await getFacilityRevenue(month, date);
    assert.equal(changedCardWage.netRevenue, after.netRevenue);
    assert.equal(changedCardWage.today.netRevenue, after.today.netRevenue,
      "editing a card-session wage must not affect net revenue");
    assert.equal(changedCardWage.payroll - after.payroll, 999850);
    assert.equal(changedCardWage.today.payroll - after.today.payroll, 999850);
    await db.update(serviceSessionsTable).set({ customerCharge: 200, earnings: 150 })
      .where(eq(serviceSessionsTable.id, rows[0].id));
    assert.deepEqual(await getFacilityRevenue(month, date), after);
    await db.delete(treatmentCardsTable).where(inArray(treatmentCardsTable.id, [cards[1].id]));
    cardIds.splice(cardIds.indexOf(cards[1].id), 1);
    const updated = await getFacilityRevenue(month, date);
    assert.deepEqual(updated.topSoldCardService, { serviceType: popularService, cardsSold: 1 });
    assert.deepEqual(updated.mostUsedCardService, { serviceType: popularService, visits: 2, minutes: 90 });
    assert.equal(updated.serviceRevenue, after.serviceRevenue);
    assert.equal(updated.cardRevenue, after.cardRevenue - 1200);
    assert.equal(updated.payroll, after.payroll);
    assert.equal(updated.revenueExcludingCardSessions, after.revenueExcludingCardSessions - 1200);
    assert.equal(updated.revenue, after.revenue - 1200);
    await deleteCard(cards[0].id);
    // Archiving a used card excludes card revenue but retains its employee wages.
    const removedReport = await getFacilityRevenue(month, date);
    assert.equal(removedReport.topSoldCardService, null);
    assert.equal(removedReport.mostUsedCardService, null);
    assert.deepEqual(removedReport.mostUsedWalkInService, { serviceType: `${popularService}_walkin`, visits: 1 });
    assert.deepEqual(removedReport.mostUsedService, { serviceType: `${popularService}_walkin`, visits: 1, minutes: 30 });
    assert.equal(removedReport.cardRevenue, updated.cardRevenue - 800);
    assert.equal(removedReport.serviceRevenue, updated.serviceRevenue);
    assert.equal(removedReport.payroll, updated.payroll,
      "archiving a card must not change wages from recorded employee visits");
    assert.equal(removedReport.revenueExcludingCardSessions, updated.revenueExcludingCardSessions - 800);
    assert.equal(removedReport.revenue, updated.revenue - 800);
    assert.equal(removedReport.cardVisits, updated.cardVisits - 2);
    assert.equal(removedReport.walkInVisits, updated.walkInVisits);
    assert.equal(removedReport.cardsSold, updated.cardsSold - 1);
    assert.equal(removedReport.today.cardRevenue, baseline.today.cardRevenue);
    assert.equal(removedReport.today.serviceRevenue, baseline.today.serviceRevenue);
    assert.equal(removedReport.today.cardVisits, baseline.today.cardVisits);
    await assert.rejects(getFacilityRevenue(month, "2099-02-30"));
    await db.delete(serviceSessionsTable).where(inArray(serviceSessionsTable.id, sessionIds));
    sessionIds.length = 0;
    await db.delete(treatmentCardsTable).where(inArray(treatmentCardsTable.id, cardIds));
    cardIds.length = 0;
    assert.deepEqual(await getFacilityRevenue(month, date), baseline);
  } finally {
    if (sessionIds.length) await db.delete(serviceSessionsTable).where(inArray(serviceSessionsTable.id, sessionIds));
    if (cardIds.length) await db.delete(treatmentCardsTable).where(inArray(treatmentCardsTable.id, cardIds));
    await pool.end();
  }
});
