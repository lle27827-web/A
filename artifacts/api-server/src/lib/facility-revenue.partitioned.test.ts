import assert from "node:assert/strict";
import test from "node:test";
import { aggregatePartitionedFacilityRevenue } from "./facility-revenue";

test("partitioned revenue counts card funding and walk-ins, but not card redemption charges", () => {
  const result = aggregatePartitionedFacilityRevenue(
    "2026-10",
    "2026-10-21",
    "2026-10-01",
    "2026-11-01",
    [
      {
        id: 1,
        deletedAt: null,
        purchaseDate: "2026-10-21",
        purchaseAmount: 100_000,
        purchasePaymentMethod: "transfer",
        sellerName: "Minh",
        totalMinutes: 120,
        serviceType: "Massage",
      },
      {
        id: 2,
        deletedAt: new Date("2026-10-21T12:00:00Z"),
        purchaseDate: "2026-10-21",
        purchaseAmount: 999_000,
        purchasePaymentMethod: "cash",
        sellerName: "Test",
        totalMinutes: 120,
        serviceType: "Deleted",
      },
    ] as never,
    [
      { id: 1, cardId: 1, paymentDate: "2026-10-21", amount: 50_000, paymentMethod: "cash", sellerName: "Lan", source: "topup" },
      { id: 2, cardId: 2, paymentDate: "2026-10-21", amount: 999_000, paymentMethod: "transfer", sellerName: "Test", source: "topup" },
    ] as never,
    [
      {
        id: 1,
        memberId: 1,
        workDate: "2026-10-21",
        cardId: null,
        customerName: "Walk-in",
        employeeName: "A",
        serviceType: "Massage",
        customerCharge: 200_000,
        earnings: 50_000,
        minutes: 60,
        paymentMethod: "cash",
        isNightShift: true,
      },
      {
        id: 2,
        memberId: 1,
        workDate: "2026-10-21",
        cardId: 1,
        customerName: "Card customer",
        employeeName: "A",
        serviceType: "Massage",
        customerCharge: 0,
        earnings: 30_000,
        minutes: 60,
        paymentMethod: null,
        isNightShift: false,
      },
      {
        id: 3,
        memberId: 2,
        workDate: "2026-10-21",
        cardId: 2,
        customerName: "Deleted customer",
        employeeName: "B",
        serviceType: "Massage",
        customerCharge: 0,
        earnings: 30_000,
        minutes: 90,
        paymentMethod: null,
        isNightShift: true,
      },
    ] as never,
  );

  assert.equal(result.revenue, 350_000);
  assert.equal(result.netRevenue, 300_000);
  assert.equal(result.payroll, 110_000, "payroll remains unchanged and includes the deleted-card service shift");
  assert.equal(result.cardRevenue, 150_000);
  assert.equal(result.cardsSold, 1);
  assert.equal(result.mostUsedService?.visits, 2);
  assert.equal(result.mostUsedService?.minutes, 120);
  assert.deepEqual(result.serviceBreakdown, [{ serviceType: "Massage", minutes: 60, visits: 2 }]);
  assert.deepEqual(result.nightShiftBreakdown, [{ serviceType: "Massage", minutes: 60, visits: 1 }],
    "night summary excludes a night-marked use of a deleted card and does not change revenue");
  assert.deepEqual(result.paymentBreakdown, {
    cash: { total: 250_000, walkInServices: 200_000, cardSales: 0, cardTopUps: 50_000 },
    transfer: { total: 100_000, walkInServices: 0, cardSales: 100_000, cardTopUps: 0 },
    unrecorded: { total: 0, walkInServices: 0, cardSales: 0, cardTopUps: 0 },
  });
  assert.equal(result.today.revenue, 350_000);
  assert.equal(result.today.netRevenue, 300_000);
  assert.equal(result.today.cardVisits, 1);
  assert.deepEqual(result.today.serviceBreakdown, [{ serviceType: "Massage", minutes: 60, visits: 2 }]);
  assert.deepEqual(result.today.nightShiftBreakdown, [{ serviceType: "Massage", minutes: 60, visits: 1 }]);
  assert.deepEqual(result.today.paymentBreakdown, result.paymentBreakdown);
});

test("partitioned duration summaries normalize service names before totaling", () => {
  const result = aggregatePartitionedFacilityRevenue(
    "2026-10",
    "2026-10-21",
    "2026-10-01",
    "2026-11-01",
    [{ id: 1, deletedAt: null, purchaseDate: "2026-10-01", purchaseAmount: 0, serviceType: " Massage ",
      purchasePaymentMethod: null, sellerName: null, totalMinutes: 60 }] as never,
    [] as never,
    [
      { id: 1, memberId: 1, workDate: "2026-10-21", cardId: null, serviceType: "Massage", customerCharge: 0, earnings: 0, minutes: 60, paymentMethod: "transfer", customerName: "A", employeeName: "E" },
      { id: 2, memberId: 1, workDate: "2026-10-21", cardId: 1, serviceType: " Massage ", customerCharge: 0, earnings: 0, minutes: 90, paymentMethod: null, customerName: "B", employeeName: "E" },
    ] as never,
  );

  assert.deepEqual(result.mostUsedService, { serviceType: "Massage", visits: 2, minutes: 150 });
  assert.deepEqual(result.mostUsedCardService, { serviceType: "Massage", visits: 1, minutes: 90 });
  assert.deepEqual(result.serviceBreakdown, [
    { serviceType: "Massage", minutes: 60, visits: 1 },
    { serviceType: "Massage", minutes: 90, visits: 1 },
  ]);
});
