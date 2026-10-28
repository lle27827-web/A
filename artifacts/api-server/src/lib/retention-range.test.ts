import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPartitionedHistoryDeleteMutations,
  isWithinRetentionDateRange,
  validateRetentionDateRange,
} from "./retention";

test("retention date ranges use inclusive ISO calendar dates", () => {
  assert.deepEqual(
    validateRetentionDateRange({ fromDate: "2026-10-01", toDate: "2026-10-31" }),
    { fromDate: "2026-10-01", toDate: "2026-10-31" },
  );
});

test("retention date ranges reject invalid dates and reversed bounds", () => {
  assert.throws(() => validateRetentionDateRange({ fromDate: "2026-02-30", toDate: "2026-03-01" }));
  assert.throws(() => validateRetentionDateRange({ fromDate: "2026-10-02", toDate: "2026-10-01" }));
});

test("retention date range includes both boundary days", () => {
  const range = validateRetentionDateRange({ fromDate: "2026-10-11", toDate: "2026-10-15" });
  assert.equal(isWithinRetentionDateRange("2026-10-10", range), false);
  assert.equal(isWithinRetentionDateRange("2026-10-11", range), true);
  assert.equal(isWithinRetentionDateRange("2026-10-15", range), true);
  assert.equal(isWithinRetentionDateRange("2026-10-16", range), false);
});

test("partitioned history deletion archives card use before tombstoning selected rows", () => {
  const range = { fromDate: "2026-10-11", toDate: "2026-10-15" };
  const baseSession = {
    memberId: 7,
    employeeName: "Technician",
    customerName: "Customer",
    serviceType: "Massage",
    serviceTypeId: 4,
    workDate: "2026-10-12",
    minutes: 60,
    customerHourlyRate: 80000,
    customerCharge: 40000,
    hourlyRate: 30000,
    earnings: 15000,
    note: "keep snapshot",
    createdAt: new Date("2026-10-12T03:00:00.000Z"),
  };
  const result = buildPartitionedHistoryDeleteMutations(
    [
      { id: 1, workDate: "2026-10-11" },
      { id: 2, workDate: "2026-10-20" },
    ],
    [
      { ...baseSession, id: 10, cardId: 21 },
      { ...baseSession, id: 11, cardId: null },
      { ...baseSession, id: 12, cardId: 22, workDate: "2026-10-20" },
      { ...baseSession, id: 13, cardId: 23 },
    ],
    [{ sourceSessionId: 13 }],
    range,
  );

  assert.deepEqual(
    {
      deletedAttendance: result.deletedAttendance,
      deletedServiceSessions: result.deletedServiceSessions,
      archivedCardUses: result.archivedCardUses,
    },
    { deletedAttendance: 1, deletedServiceSessions: 3, archivedCardUses: 1 },
  );
  assert.deepEqual(result.mutations.map(({ entityType, action }) => [entityType, action]), [
    ["card_usage_history", "upsert"],
    ["service_sessions", "delete"],
    ["service_sessions", "delete"],
    ["service_sessions", "delete"],
    ["attendance", "delete"],
  ]);
  assert.deepEqual(result.mutations[0]?.payload, {
    sourceSessionId: 10,
    cardId: 21,
    ...baseSession,
  });
});
