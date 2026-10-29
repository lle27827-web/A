import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPartitionMutations,
  buildPartitionEventInsertBatch,
  comparePartitionRevisions,
  hashPartitionRequest,
  makePartitionEntityKey,
  nextPartitionWriteBackend,
  resolvePartitionWritePair,
  resolvePartitionWriteBackend,
  shouldAdvancePartitionCursor,
  normalizePartitionDatabaseRow,
  personalTableReadPredicates,
  resolvePartitionComputeState,
  PartitionRoutingError,
  type PartitionCapacityState,
  type PartitionMutation,
} from "@workspace/db";

const fourShards = [
  { backend: "database_url_1" as const },
  { backend: "database_url" as const },
  { backend: "database_url_3" as const },
  { backend: "database_url_4" as const },
];

test("partition keys keep equal local IDs distinct across stores", () => {
  assert.equal(makePartitionEntityKey("database_url_1", 27), "database_url_1:27");
  assert.equal(makePartitionEntityKey("database_url_3", "27"), "database_url_3:27");
  assert.throws(() => makePartitionEntityKey("database_url_1", 0));
  assert.throws(() => makePartitionEntityKey("database_url_1", " 27 "));
});

test("raw base rows map PostgreSQL snake_case columns to application fields", () => {
  const createdAt = new Date("2026-10-29T06:30:00.000Z");
  assert.deepEqual(normalizePartitionDatabaseRow({
    source_session_id: 21,
    work_date: "2026-10-29",
    created_at: createdAt,
  }), {
    sourceSessionId: 21,
    workDate: "2026-10-29",
    createdAt,
  });
});

test("personal notebook partition filters restrict both event and base data by user", () => {
  const predicates = personalTableReadPredicates("personal_sessions");
  assert.match(predicates.baseSql, /user_id = \$1/);
  assert.match(predicates.eventSql, /payload->>'userId' = \$2/);
  assert.throws(() => personalTableReadPredicates("members"));
});

test("partition request hashes are stable across object key order", () => {
  assert.equal(
    hashPartitionRequest({ member: { name: "A", rate: 12 }, action: "update" }),
    hashPartitionRequest({ action: "update", member: { rate: 12, name: "A" } }),
  );
  assert.notEqual(hashPartitionRequest({ amount: 100 }), hashPartitionRequest({ amount: 101 }));
});

test("partition event batch maps each mutation into aligned PostgreSQL arrays", () => {
  const batch = buildPartitionEventInsertBatch([
    {
      eventId: "00000000-0000-5000-8000-000000000001",
      operationId: "00000000-0000-5000-8000-000000000002",
      revision: "10",
      entityType: "attendance",
      entityKey: "attendance:1",
      action: "delete",
      payload: null,
    },
    {
      eventId: "00000000-0000-5000-8000-000000000003",
      operationId: "00000000-0000-5000-8000-000000000002",
      revision: "10",
      entityType: "members",
      entityKey: "members:2",
      action: "upsert",
      payload: { id: 2, name: "An" },
    },
  ]);
  assert.deepEqual(batch.eventIds, [
    "00000000-0000-5000-8000-000000000001",
    "00000000-0000-5000-8000-000000000003",
  ]);
  assert.deepEqual(batch.payloads, [null, JSON.stringify({ id: 2, name: "An" })]);
  for (const values of Object.values(batch)) assert.equal(values.length, 2);
});

test("write routing advances only to the next configured store", () => {
  assert.equal(nextPartitionWriteBackend("database_url_1", fourShards), "database_url");
  assert.equal(nextPartitionWriteBackend("database_url", fourShards), "database_url_3");
  assert.equal(nextPartitionWriteBackend("database_url_3", fourShards), "database_url_4");
  assert.equal(nextPartitionWriteBackend("database_url_4", fourShards), undefined);
  assert.equal(nextPartitionWriteBackend("database_url", fourShards.slice(0, 2)), undefined);
});

test("partition routing skips full or unavailable stores and never wraps", () => {
  const capacity = new Map([
    ["database_url_1", "full"],
    ["database_url", "unavailable"],
    ["database_url_3", "available"],
    ["database_url_4", "available"],
  ]) as Map<"database_url_1" | "database_url" | "database_url_3" | "database_url_4", PartitionCapacityState>;
  assert.equal(
    resolvePartitionWriteBackend("database_url_1", fourShards.map(({ backend }) => backend), capacity),
    "database_url_3",
  );
  const allRemainingFull = new Map(capacity);
  allRemainingFull.set("database_url_4", "full");
  assert.throws(
    () => resolvePartitionWriteBackend(
      "database_url_4",
      fourShards.map(({ backend }) => backend),
      allRemainingFull,
    ),
    (error) => error instanceof PartitionRoutingError && error.code === "no_writable_store",
  );
});

test("partition routing fails closed when candidate capacity is unknown", () => {
  const capacity = new Map([
    ["database_url_1", "full"],
    ["database_url", "unknown"],
    ["database_url_3", "available"],
    ["database_url_4", "available"],
  ]) as Map<"database_url_1" | "database_url" | "database_url_3" | "database_url_4", PartitionCapacityState>;
  assert.throws(
    () => resolvePartitionWriteBackend("database_url_1", fourShards.map(({ backend }) => backend), capacity),
    (error) => error instanceof PartitionRoutingError && error.code === "capacity_unknown",
  );
});

test("two-copy routing selects a forward primary and a distinct writable replica", () => {
  const capacity = new Map([
    ["database_url_1", "available"],
    ["database_url", "available"],
    ["database_url_3", "available"],
    ["database_url_4", "available"],
  ]) as Map<"database_url_1" | "database_url" | "database_url_3" | "database_url_4", PartitionCapacityState>;
  assert.deepEqual(
    resolvePartitionWritePair("database_url_1", fourShards.map(({ backend }) => backend), capacity),
    { primary: "database_url_1", replica: "database_url" },
  );
});

test("two-copy routing moves forward when full and can wrap only for the replica", () => {
  const capacity = new Map([
    ["database_url_1", "full"],
    ["database_url", "unavailable"],
    ["database_url_3", "available"],
    ["database_url_4", "available"],
  ]) as Map<"database_url_1" | "database_url" | "database_url_3" | "database_url_4", PartitionCapacityState>;
  const order = fourShards.map(({ backend }) => backend);
  assert.deepEqual(resolvePartitionWritePair("database_url_1", order, capacity), {
    primary: "database_url_3",
    replica: "database_url_4",
  });

  const edgeCapacity = new Map([
    ["database_url_1", "available"],
    ["database_url", "unavailable"],
    ["database_url_3", "unavailable"],
    ["database_url_4", "available"],
  ]) as Map<"database_url_1" | "database_url" | "database_url_3" | "database_url_4", PartitionCapacityState>;
  assert.deepEqual(resolvePartitionWritePair("database_url_4", order, edgeCapacity), {
    primary: "database_url_4",
    replica: "database_url_1",
  });
});

test("the persisted cursor advances only for a genuinely full store", () => {
  const order = fourShards.map(({ backend }) => backend);
  assert.equal(shouldAdvancePartitionCursor("full", "database_url_1", "database_url", order), true);
  assert.equal(shouldAdvancePartitionCursor("unavailable", "database_url_1", "database_url", order), false);
  assert.equal(shouldAdvancePartitionCursor("full", "database_url_1", "database_url_1", order), false);
});

test("partition CU checks reuse a recent value and fail open only when configured", () => {
  const cached = { seconds: 1_000, checkedAt: 10_000 };
  assert.equal(resolvePartitionComputeState({
    now: 11_000, cached, requireCheck: true, limitSeconds: 3_600,
  }), "available");
  assert.equal(resolvePartitionComputeState({
    now: 11_000, cached: { seconds: 4_000, checkedAt: 10_000 },
    requireCheck: false, limitSeconds: 3_600,
  }), "unavailable");
  assert.equal(resolvePartitionComputeState({
    now: 30_000_000, cached, requireCheck: true, limitSeconds: 3_600,
  }), "unknown");
  assert.equal(resolvePartitionComputeState({
    now: 30_000_000, requireCheck: false, limitSeconds: 3_600,
  }), "available");
});

test("two-copy routing blocks when fewer than two stores are verified writable", () => {
  const capacity = new Map([
    ["database_url_1", "available"],
    ["database_url", "full"],
    ["database_url_3", "unknown"],
    ["database_url_4", "unavailable"],
  ]) as Map<"database_url_1" | "database_url" | "database_url_3" | "database_url_4", PartitionCapacityState>;
  assert.throws(
    () => resolvePartitionWritePair(
      "database_url_1",
      fourShards.map(({ backend }) => backend),
      capacity,
    ),
    (error) => error instanceof PartitionRoutingError && error.code === "capacity_unknown",
  );
});

test("two-copy routing does not advance past an unknown store", () => {
  const capacity = new Map([
    ["database_url_1", "available"],
    ["database_url", "unknown"],
    ["database_url_3", "available"],
    ["database_url_4", "available"],
  ]) as Map<"database_url_1" | "database_url" | "database_url_3" | "database_url_4", PartitionCapacityState>;
  assert.throws(
    () => resolvePartitionWritePair("database_url_1", fourShards.map(({ backend }) => backend), capacity),
    (error) => error instanceof PartitionRoutingError && error.code === "capacity_unknown",
  );
});

test("partition revisions compare as integers, not lexicographic strings", () => {
  assert.equal(comparePartitionRevisions("100", "99"), 1);
  assert.equal(comparePartitionRevisions("9007199254740993", "9007199254740992"), 1);
  assert.throws(() => comparePartitionRevisions("1x", "2"));
});

test("append-only upserts overlay the base snapshot in revision order", () => {
  const base = new Map([["database_url_1:27", { name: "Old name", rate: 10 }]]);
  const changes: PartitionMutation[] = [
    {
      eventId: "event-2",
      operationId: "operation-2",
      revision: "12",
      entityType: "member",
      entityKey: "database_url_1:27",
      action: "upsert",
      payload: { name: "Latest name", rate: 12 },
    },
    {
      eventId: "event-1",
      operationId: "operation-1",
      revision: "11",
      entityType: "member",
      entityKey: "database_url_1:27",
      action: "upsert",
      payload: { name: "Edited name", rate: 11 },
    },
    {
      eventId: "event-2",
      operationId: "operation-2",
      revision: "12",
      entityType: "member",
      entityKey: "database_url_1:27",
      action: "upsert",
      payload: { name: "Latest name", rate: 12 },
    },
  ];

  assert.deepEqual(
    applyPartitionMutations(base, changes).get("database_url_1:27"),
    { name: "Latest name", rate: 12 },
  );
});

test("delete events hide old rows and a later upsert can restore them", () => {
  const base = new Map([["database_url_1:27", { name: "Old name" }]]);
  const deleted: PartitionMutation = {
    eventId: "delete-1",
    operationId: "operation-delete",
    revision: "20",
    entityType: "member",
    entityKey: "database_url_1:27",
    action: "delete",
    payload: null,
  };
  assert.equal(applyPartitionMutations(base, [deleted]).has("database_url_1:27"), false);
  assert.deepEqual(
    applyPartitionMutations(base, [
      deleted,
      {
        ...deleted,
        eventId: "restore-1",
        operationId: "operation-restore",
        revision: "21",
        action: "upsert",
        payload: { name: "Restored name" },
      },
    ]).get("database_url_1:27"),
    { name: "Restored name" },
  );
});

test("invalid mutation payloads fail explicitly", () => {
  const base = new Map<string, Record<string, unknown>>();
  assert.throws(() => applyPartitionMutations(base, [{
    eventId: "bad-delete",
    operationId: "operation-1",
    revision: "1",
    entityType: "member",
    entityKey: "database_url_1:27",
    action: "delete",
    payload: { name: "not allowed" },
  }]));
});
