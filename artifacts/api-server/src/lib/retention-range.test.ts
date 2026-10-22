import assert from "node:assert/strict";
import test from "node:test";
import { validateRetentionDateRange } from "./retention";

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
