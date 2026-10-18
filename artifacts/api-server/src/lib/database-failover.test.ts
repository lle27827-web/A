import assert from "node:assert/strict";
import test from "node:test";
import {
  hasReachedDatabaseCapacity,
  isDatabaseCapacityError,
  parseDatabaseCapacityLimit,
} from "../../../../lib/db/src/failover-utils";

test("database full SQLSTATE is recognized", () => {
  assert.equal(isDatabaseCapacityError({ code: "53100" }), true);
});

test("disk-full messages are recognized without exposing details", () => {
  assert.equal(
    isDatabaseCapacityError(new Error("No space left on device")),
    true,
  );
  assert.equal(isDatabaseCapacityError({ code: "53300" }), false);
});

test("capacity limit is optional and must be a positive integer", () => {
  assert.equal(parseDatabaseCapacityLimit(undefined), null);
  assert.equal(parseDatabaseCapacityLimit("1048576"), 1_048_576n);
  assert.throws(() => parseDatabaseCapacityLimit("0"));
  assert.throws(() => parseDatabaseCapacityLimit("1GB"));
});

test("database usage triggers at or above the configured limit", () => {
  assert.equal(hasReachedDatabaseCapacity("1024", 1024n), true);
  assert.equal(hasReachedDatabaseCapacity("1023", 1024n), false);
});
