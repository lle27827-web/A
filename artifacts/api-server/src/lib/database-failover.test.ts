import assert from "node:assert/strict";
import test from "node:test";
import {
  DATABASE_COMPUTE_LIMIT_SECONDS,
  DATABASE_STORAGE_LIMIT_BYTES,
  hasReachedDatabaseCapacity,
  hasReachedComputeTimeLimit,
  isDatabaseAvailabilityError,
  isDatabaseCapacityError,
  isDatabaseFailoverTriggerError,
  isSameDatabaseFailureDomain,
  parseNeonComputeTimeSeconds,
  parseDatabaseCapacityLimit,
} from "../../../../lib/db/src/failover-utils";
import {
  areAdjacentBackends,
  failoverStateConstraintSupports,
  getNextBackend,
  getReplicationEdge,
  replicationTableSetsMatch,
  resolveDatabaseNodes,
} from "../../../../lib/db/src/failover-topology";
import {
  planSequenceSync,
  type SequenceSnapshot,
} from "../../../../lib/db/src/failover-sequences";
import { getCapacityProbeReadiness } from "./database-failover-readiness";

function sequenceSnapshot(
  overrides: Partial<SequenceSnapshot> = {},
): SequenceSnapshot {
  return {
    sequenceSchema: "public",
    sequenceName: "members_id_seq",
    tableSchema: "public",
    tableName: "members",
    columnName: "id",
    startValue: "1",
    incrementBy: "1",
    minValue: "1",
    maxValue: "2147483647",
    cycle: false,
    lastValue: "5",
    isCalled: true,
    tableMaxValue: "5",
    ...overrides,
  };
}

test("database full SQLSTATE is recognized", () => {
  assert.equal(isDatabaseCapacityError({ code: "53100" }), true);
});

test("disk-full messages are recognized without exposing details", () => {
  assert.equal(
    isDatabaseCapacityError(new Error("No space left on device")),
    true,
  );
  assert.equal(isDatabaseFailoverTriggerError({ code: "53100" }), true);
  assert.equal(isDatabaseCapacityError({ code: "53300" }), false);
});

test("database connectivity failures are recognized as failover triggers", () => {
  for (const code of ["08006", "25006", "57P01", "57P03", "53300", "58030", "ECONNRESET", "ETIMEDOUT"]) {
    assert.equal(isDatabaseAvailabilityError({ code }), true, code);
    assert.equal(isDatabaseFailoverTriggerError({ code }), true, code);
  }
  assert.equal(
    isDatabaseAvailabilityError({ cause: { code: "ECONNREFUSED" } }),
    true,
  );
  assert.equal(
    isDatabaseAvailabilityError(new Error("server closed the connection unexpectedly")),
    true,
  );
});

test("ordinary SQL and validation errors never trigger automatic failover", () => {
  for (const error of [
    { code: "23505", message: "duplicate key" },
    { code: "23503", message: "foreign key violation" },
    { code: "42601", message: "syntax error" },
    { code: "40001", message: "serialization failure" },
    { code: "40P01", message: "deadlock detected" },
  ]) {
    assert.equal(isDatabaseFailoverTriggerError(error), false, error.code);
  }
});

test("independent coordinator URLs cannot share a database failure domain", () => {
  assert.equal(
    isSameDatabaseFailureDomain(
      "postgres://user:pass@ep-example-pooler.us-east-2.aws.neon.tech/app?sslmode=require",
      "postgres://user:pass@ep-example.us-east-2.aws.neon.tech/app?sslmode=require",
    ),
    true,
  );
  assert.equal(
    isSameDatabaseFailureDomain(
      "postgres://user:pass@ep-coordinator.us-east-2.aws.neon.tech/app",
      "postgres://user:pass@ep-data.us-east-2.aws.neon.tech/app",
    ),
    false,
  );
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

test("four-database failover order preserves the existing DATABASE_URL slot", () => {
  const nodes = resolveDatabaseNodes({
    DATABASE_URL_1: "postgres://primary",
    DATABASE_URL: "postgres://fallback",
    DATABASE_URL_DIRECT: "postgres://fallback-direct",
    DATABASE_URL_3: "postgres://replica3",
    DATABASE_URL_4: "postgres://replica4",
    NEON_PROJECT_ID_3: "project-3",
    NEON_PROJECT_ID_4: "project-4",
  });

  assert.deepEqual(
    nodes.map((node) => node.backend),
    ["database_url_1", "database_url", "database_url_3", "database_url_4"],
  );
  assert.equal(
    getNextBackend("database_url", nodes)?.backend,
    "database_url_3",
  );
  assert.equal(
    getNextBackend("database_url_3", nodes)?.backend,
    "database_url_4",
  );
  assert.equal(nodes[1]?.adminUrl, "postgres://fallback-direct");
  assert.equal(nodes[2]?.projectId, "project-3");
  assert.equal(nodes[3]?.projectId, "project-4");
});

test("manual switching is limited to adjacent configured databases in either direction", () => {
  const nodes = resolveDatabaseNodes({
    DATABASE_URL_1: "postgres://primary",
    DATABASE_URL: "postgres://fallback",
    DATABASE_URL_3: "postgres://replica3",
    DATABASE_URL_4: "postgres://replica4",
  });
  assert.equal(areAdjacentBackends("database_url_1", "database_url", nodes), true);
  assert.equal(areAdjacentBackends("database_url", "database_url_1", nodes), true);
  assert.equal(areAdjacentBackends("database_url", "database_url_3", nodes), true);
  assert.equal(areAdjacentBackends("database_url_3", "database_url_4", nodes), true);
  assert.equal(areAdjacentBackends("database_url_1", "database_url_3", nodes), false);
  assert.equal(areAdjacentBackends("database_url_1", "database_url_4", nodes), false);
});

test("capacity probe reports the next database's exact readiness blocker", () => {
  const readiness = getCapacityProbeReadiness("database_url", [
    {
      backend: "database_url_3",
      configured: true,
      canSwitch: false,
      message: "Replication chưa sẵn sàng hoặc chưa đồng bộ.",
    },
  ]);
  assert.deepEqual(readiness, {
    canRun: false,
    targetBackend: "database_url_3",
    message: "DB3 chưa sẵn sàng: Replication chưa sẵn sàng hoặc chưa đồng bộ.",
  });
});

test("capacity probe explains why it cannot continue past the last database", () => {
  const readiness = getCapacityProbeReadiness("database_url_4", []);
  assert.equal(readiness.canRun, false);
  assert.match(readiness.message ?? "", /DB4 là kho cuối/);
});

test("capacity probe refuses to run while a switch is in progress", () => {
  const readiness = getCapacityProbeReadiness("switching", []);
  assert.equal(readiness.canRun, false);
  assert.match(readiness.message ?? "", /Đang có thao tác chuyển/);
});

test("capacity probe permits only a ready adjacent target", () => {
  const readiness = getCapacityProbeReadiness("database_url_1", [
    {
      backend: "database_url",
      configured: true,
      canSwitch: true,
      message: "Đã đồng bộ; có thể chuyển an toàn.",
    },
  ]);
  assert.deepEqual(readiness, {
    canRun: true,
    targetBackend: "database_url",
    message: null,
  });
});

test("additional replica cannot skip a missing link in the failover order", () => {
  assert.throws(
    () =>
      resolveDatabaseNodes({
        DATABASE_URL_1: "postgres://primary",
        DATABASE_URL: "postgres://fallback",
        DATABASE_URL_4: "postgres://replica4",
      }),
    /requires DATABASE_URL_3/,
  );
});

test("development with only DATABASE_URL keeps its existing database", () => {
  const nodes = resolveDatabaseNodes({
    DATABASE_URL: "postgres://development",
  });
  assert.deepEqual(
    nodes.map((node) => node.backend),
    ["database_url"],
  );
});

test("replication checks define forward and reverse names for each adjacent link", () => {
  assert.equal(
    getReplicationEdge("database_url_1", "database_url")?.subscriptionName,
    "socong_source_from_db1_v1",
  );
  assert.equal(
    getReplicationEdge("database_url", "database_url_3")?.publicationName,
    "socong_source_to_db3_v1",
  );
  assert.equal(
    getReplicationEdge("database_url_3", "database_url_4")?.subscriptionName,
    "socong_db4_from_db3_v1",
  );
  assert.equal(
    getReplicationEdge("database_url", "database_url_1")?.subscriptionName,
    "socong_db1_from_db2_v1",
  );
  assert.equal(
    getReplicationEdge("database_url_3", "database_url")?.publicationName,
    "socong_db3_to_db2_v1",
  );
  assert.equal(
    getReplicationEdge("database_url_4", "database_url_3")?.subscriptionName,
    "socong_db3_from_db4_v1",
  );
  assert.equal(getReplicationEdge("database_url_1", "database_url_3"), undefined);
});

test("replication table validation requires the exact application table set", () => {
  const expected = [
    { schemaName: "public", tableName: "members" },
    { schemaName: "public", tableName: "attendance" },
  ];
  assert.equal(replicationTableSetsMatch(expected, [...expected]), true);
  assert.equal(
    replicationTableSetsMatch(expected, [expected[0]!, { schemaName: "public", tableName: "other" }]),
    false,
  );
  assert.equal(replicationTableSetsMatch(expected, [expected[0]!]), false);
  assert.equal(
    replicationTableSetsMatch(expected, [expected[0]!, expected[0]!]),
    false,
  );
});

test("failover-state migration must allow every configured backend", () => {
  assert.equal(
    failoverStateConstraintSupports(
      "CHECK (active_backend IN ('database_url_1', 'database_url', 'database_url_3', 'database_url_4', 'switching'))",
      ["database_url_1", "database_url", "database_url_3", "database_url_4"],
    ),
    true,
  );
  assert.equal(
    failoverStateConstraintSupports(
      "CHECK (active_backend IN ('database_url_1', 'database_url', 'database_url_3', 'switching'))",
      ["database_url_4"],
    ),
    false,
  );
});

test("sequence promotion plans choose the greatest source or target cursor", () => {
  const plan = planSequenceSync(
    [sequenceSnapshot({ lastValue: "12", tableMaxValue: "9" })],
    [sequenceSnapshot({ lastValue: "8", tableMaxValue: "15" })],
  );
  assert.deepEqual(plan, [
    {
      sequenceSchema: "public",
      sequenceName: "members_id_seq",
      value: "15",
      isCalled: true,
    },
  ]);
});

test("unused sequences keep their first value and missing sequences block promotion", () => {
  assert.deepEqual(
    planSequenceSync(
      [sequenceSnapshot({ lastValue: null, isCalled: false, tableMaxValue: null })],
      [sequenceSnapshot({ lastValue: null, isCalled: false, tableMaxValue: null })],
    ),
    [
      {
        sequenceSchema: "public",
        sequenceName: "members_id_seq",
        value: "1",
        isCalled: false,
      },
    ],
  );
  assert.equal(planSequenceSync([sequenceSnapshot()], []), null);
});

test("sequence configurations that cannot be safely synchronized block promotion", () => {
  assert.equal(
    planSequenceSync(
      [sequenceSnapshot()],
      [sequenceSnapshot({ incrementBy: "2" })],
    ),
    null,
  );
  assert.equal(
    planSequenceSync(
      [sequenceSnapshot({ cycle: true })],
      [sequenceSnapshot({ cycle: true })],
    ),
    null,
  );
});

