import assert from "node:assert/strict";
import test from "node:test";
import { isWithinRetention, retentionCutoffDate } from "./retention-window";

test("retention cutoff follows the Vietnam calendar date", () => {
  assert.equal(retentionCutoffDate(new Date("2026-10-17T17:00:00.000Z")), "2021-10-18");
  assert.equal(retentionCutoffDate(new Date("2026-10-17T16:59:59.000Z")), "2021-10-17");
});

test("five-year cutoff clamps leap day to the last valid day of February", () => {
  assert.equal(retentionCutoffDate(new Date("2024-02-28T17:00:00.000Z")), "2019-02-28");
});

test("cutoff date is retained inclusively", () => {
  const now = new Date("2026-10-17T17:00:00.000Z");
  assert.equal(isWithinRetention("2021-10-17", now), false);
  assert.equal(isWithinRetention("2021-10-18", now), true);
});
