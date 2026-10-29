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
        serviceType: "Massage",
      },
      {
        id: 2,
        deletedAt: new Date("2026-10-21T12:00:00Z"),
        purchaseDate: "2026-10-21",
        purchaseAmount: 999_000,
        serviceType: "Deleted",
      },
    ] as never,
    [
      { cardId: 1, paymentDate: "2026-10-21", amount: 50_000 },
      { cardId: 2, paymentDate: "2026-10-21", amount: 999_000 },
    ] as never,
    [
      {
        workDate: "2026-10-21",
        cardId: null,
        serviceType: "Massage",
        customerCharge: 200_000,
        earnings: 50_000,
        minutes: 60,
      },
      {
        workDate: "2026-10-21",
        cardId: 1,
        serviceType: "Massage",
        customerCharge: 0,
        earnings: 30_000,
        minutes: 60,
      },
      {
        workDate: "2026-10-21",
        cardId: 2,
        serviceType: "Massage",
        customerCharge: 0,
        earnings: 30_000,
        minutes: 90,
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
  assert.equal(result.today.revenue, 350_000);
  assert.equal(result.today.netRevenue, 300_000);
  assert.equal(result.today.cardVisits, 1);
  assert.deepEqual(result.today.serviceBreakdown, [{ serviceType: "Massage", minutes: 60, visits: 2 }]);
});
