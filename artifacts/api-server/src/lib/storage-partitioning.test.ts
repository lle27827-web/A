import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPartitionMutations,
  comparePartitionRevisions,
  hashPartitionRequest,
  makePartitionEntityKey,
  nextPartitionWriteBackend,
  resolvePartitionWriteBackend,
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

test("partition request hashes are stable across object key order", () => {
  assert.equal(
    hashPartitionRequest({ member: { name: "A", rate: 12 }, action: "update" }),
    hashPartitionRequest({ action: "update", member: { rate: 12, name: "A" } }),
  );
  assert.notEqual(hashPartitionRequest({ amount: 100 }), hashPartitionRequest({ amount: 101 }));
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
