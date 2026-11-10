import assert from "node:assert/strict";
import test from "node:test";
import { isWorkDateWithinFutureLimit } from "./work-date";

const now = new Date("2026-11-10T02:00:00.000Z");

test("work dates allow history and limit future dates to 30 Vietnam calendar days", () => {
  assert.equal(isWorkDateWithinFutureLimit("2026-11-10", now), true);
  assert.equal(isWorkDateWithinFutureLimit("2026-12-10", now), true);
  assert.equal(isWorkDateWithinFutureLimit("2026-12-11", now), false);
  assert.equal(isWorkDateWithinFutureLimit("2026-02-30", now), false);
});
