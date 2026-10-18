import assert from "node:assert/strict";
import test from "node:test";
import {
  DATABASE_COMPUTE_LIMIT_SECONDS,
  DATABASE_STORAGE_LIMIT_BYTES,
  decideFailoverAction,
  hasReachedDatabaseCapacity,
  hasReachedComputeTimeLimit,
  isDatabaseCapacityError,
  parseComputeTimeLimitSeconds,
  parseNeonComputeTimeSeconds,
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
  assert.equal(DATABASE_STORAGE_LIMIT_BYTES, 1_000_000_000n);
});

test("Neon compute usage uses the 100 CU-hour threshold", () => {
  assert.equal(DATABASE_COMPUTE_LIMIT_SECONDS, 360_000);
  assert.equal(
    parseNeonComputeTimeSeconds({
      project: { compute_time_seconds: 360_000 },
    }),
    360_000,
  );
  assert.equal(hasReachedComputeTimeLimit(360_000), true);
  assert.equal(hasReachedComputeTimeLimit(359_999), false);
  assert.throws(() => parseNeonComputeTimeSeconds({ project: {} }));
});

test("compute failover limit can be lowered with a safe positive integer", () => {
  assert.equal(parseComputeTimeLimitSeconds(undefined), null);
  assert.equal(parseComputeTimeLimitSeconds("1"), 1);
  assert.equal(parseComputeTimeLimitSeconds("3600"), 3600);
  assert.throws(() => parseComputeTimeLimitSeconds("0"));
  assert.throws(() => parseComputeTimeLimitSeconds("-1"));
  assert.throws(() => parseComputeTimeLimitSeconds("1.5"));
  assert.throws(() =>
    parseComputeTimeLimitSeconds("9007199254740992"),
  );
});

test("bounded failover simulation never queries Neon or changes a database", () => {
  const simulate = (usedComputeSeconds: number, standbySynchronized: boolean) => {
    const thresholdReached = hasReachedComputeTimeLimit(usedComputeSeconds);
    return decideFailoverAction(thresholdReached, standbySynchronized);
  };

  assert.equal(
    simulate(DATABASE_COMPUTE_LIMIT_SECONDS - 1, true),
    "stay_primary",
    "usage below 100 CU-hours stays on the primary",
  );
  assert.equal(
    simulate(DATABASE_COMPUTE_LIMIT_SECONDS, true),
    "switch_to_fallback",
    "at 100 CU-hours, a synchronized fallback is eligible",
  );
  assert.equal(
    simulate(DATABASE_COMPUTE_LIMIT_SECONDS + 1, false),
    "blocked_not_synchronized",
    "at or above the limit, an unsynchronized fallback must not be used",
  );
  assert.equal(
    decideFailoverAction(false, false),
    "stay_primary",
    "no capacity threshold means no switch, regardless of replication status",
  );
});
