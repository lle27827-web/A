import assert from "node:assert/strict";
import test from "node:test";
import {
  isDatabaseAvailabilityError,
  isDatabaseCapacityError,
  isDatabaseFailoverTriggerError,
  isDatabasePoolExhaustionError,
  hasAvailabilityFailureThreshold,
  isSameDatabaseFailureDomain,
} from "../../../../lib/db/src/failover-utils";
import {
  areAdjacentBackends,
  failoverStateConstraintSupports,
  getNextBackend,
  getReplicationEdge,
  replicationTableSetsMatch,
  resolveFailoverCoordinatorBackend,
  resolveDatabaseNodes,
} from "../../../../lib/db/src/failover-topology";
import {
  planSequenceSync,
  planSequenceRepairToRows,
  type SequenceSnapshot,
} from "../../../../lib/db/src/failover-sequences";
import { describeReplicationBlocker } from "../../../../lib/db/src/failover-replication-readiness";

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
  assert.equal(isDatabaseFailoverTriggerError({ code: "53100" }), false);
  assert.equal(isDatabaseCapacityError({ code: "53300" }), false);
});

test("only database connectivity failures are recognized as failover triggers", () => {
  for (const code of ["08006", "57P01", "57P02", "57P03", "ECONNRESET", "ETIMEDOUT"]) {
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

test("capacity, I/O, and configuration-limit errors are not connection fallback triggers", () => {
  for (const error of [
    { code: "53100" },
    new Error("database is full"),
    { code: "58030" },
    { code: "53400" },
    { code: "25006" },
  ]) {
    assert.equal(isDatabaseAvailabilityError(error), false);
    assert.equal(isDatabaseFailoverTriggerError(error), false);
  }
});

test("pool exhaustion never triggers failover and availability needs three recent failures", () => {
  for (const error of [
    { code: "53300" },
    new Error("connection acquisition timed out"),
    new Error("timeout expired"),
    new Error("too many clients already"),
  ]) {
    assert.equal(isDatabasePoolExhaustionError(error), true);
    assert.equal(isDatabaseAvailabilityError(error), false);
    assert.equal(isDatabaseFailoverTriggerError(error), false);
  }
  assert.equal(hasAvailabilityFailureThreshold([10_000, 20_000], 20_000), false);
  assert.equal(hasAvailabilityFailureThreshold([10_000, 15_000, 20_000], 20_000), true);
  assert.equal(hasAvailabilityFailureThreshold([1_000, 20_000, 20_001], 50_000), false);
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

test("four-database failover order maps DATABASE_URL to DB1 and DATABASE_URL_1 to DB2", () => {
  const nodes = resolveDatabaseNodes({
    DATABASE_URL: "postgres://primary",
    DATABASE_URL_1: "postgres://fallback",
    NEON_DB1_DIRECT_URL: "postgres://primary-direct",
    DATABASE_URL_3: "postgres://replica3",
    DATABASE_URL_4: "postgres://replica4",
  });

  assert.deepEqual(
    nodes.map((node) => node.backend),
    ["database_url_1", "database_url", "database_url_3", "database_url_4"],
  );
  assert.deepEqual(
    nodes.map(({ backend, url }) => [backend, url]),
    [
      ["database_url_1", "postgres://primary"],
      ["database_url", "postgres://fallback"],
      ["database_url_3", "postgres://replica3"],
      ["database_url_4", "postgres://replica4"],
    ],
  );
  assert.equal(
    getNextBackend("database_url", nodes)?.backend,
    "database_url_3",
  );
  assert.equal(
    getNextBackend("database_url_3", nodes)?.backend,
    "database_url_4",
  );
  assert.equal(nodes[0]?.adminUrl, "postgres://primary-direct");
});

test("DB4 can be selected as the coordinator only when its node is configured", () => {
  const nodes = resolveDatabaseNodes({
    DATABASE_URL: "postgres://primary",
    DATABASE_URL_1: "postgres://fallback",
    DATABASE_URL_3: "postgres://replica3",
    DATABASE_URL_4: "postgres://replica4",
  });
  assert.equal(resolveFailoverCoordinatorBackend(undefined, nodes), "database_url_4");
  assert.equal(
    resolveFailoverCoordinatorBackend(undefined, nodes.slice(0, 3)),
    "database_url",
  );
  assert.equal(
    resolveFailoverCoordinatorBackend("database_url_4", nodes),
    "database_url_4",
  );
  assert.throws(
    () => resolveFailoverCoordinatorBackend("database_url_4", nodes.slice(0, 3)),
    /requires that database URL to be configured/,
  );
});

test("manual switching is limited to adjacent configured databases in either direction", () => {
  const nodes = resolveDatabaseNodes({
    DATABASE_URL: "postgres://primary",
    DATABASE_URL_1: "postgres://fallback",
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

test("replication blockers identify subscription and table setup problems", () => {
  assert.match(
    describeReplicationBlocker({
      kind: "subscription_disabled",
      subscriptionName: "socong_db3_from_source_v1",
    }),
    /đang bị tắt/,
  );
  assert.match(
    describeReplicationBlocker({
      kind: "subscription_mismatch",
      missingTables: [{ schemaName: "public", tableName: "attendance" }],
      hasExtraTables: false,
    }),
    /public\.attendance/,
  );
  assert.match(
    describeReplicationBlocker({
      kind: "pending_tables",
      tables: [{ schemaName: "public", tableName: "service_sessions" }],
    }),
    /Đồng bộ ban đầu chưa xong.*public\.service_sessions/,
  );
});

test("replication blockers report apply-worker and lag details", () => {
  assert.match(
    describeReplicationBlocker({
      kind: "apply_worker_missing",
      subscriptionName: "socong_db3_from_source_v1",
    }),
    /worker apply/,
  );
  assert.match(
    describeReplicationBlocker({ kind: "lag", bytes: "2048" }),
    /2048 byte/,
  );
  assert.match(
    describeReplicationBlocker({ kind: "query_failed" }),
    /kết nối trực tiếp và quyền PostgreSQL/,
  );
});

test("additional replica cannot skip a missing link in the failover order", () => {
  assert.throws(
    () =>
      resolveDatabaseNodes({
        DATABASE_URL: "postgres://primary",
        DATABASE_URL_1: "postgres://fallback",
        DATABASE_URL_4: "postgres://replica4",
      }),
    /requires DATABASE_URL_3/,
  );
});

test("DATABASE_URL alone resolves to the DB1 backend", () => {
  const nodes = resolveDatabaseNodes({
    DATABASE_URL: "postgres://development",
  });
  assert.deepEqual(
    nodes.map((node) => node.backend),
    ["database_url_1"],
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

test("forced-promotion sequence repair advances only to the surviving rows", () => {
  assert.deepEqual(
    planSequenceRepairToRows([
      sequenceSnapshot({ tableMaxValue: "8", lastValue: "5", isCalled: true }),
      sequenceSnapshot({
        sequenceName: "already_ahead_seq",
        tableName: "other",
        columnName: "id",
        tableMaxValue: "5",
        lastValue: "9",
        isCalled: true,
      }),
    ]),
    [{ sequenceSchema: "public", sequenceName: "members_id_seq", value: "8", isCalled: true }],
  );
  assert.equal(
    planSequenceRepairToRows([
      sequenceSnapshot({ cycle: true, tableMaxValue: "8" }),
    ]),
    null,
  );
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

