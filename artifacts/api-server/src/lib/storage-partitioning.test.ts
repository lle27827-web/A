import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPartitionMutations,
  buildPartitionEventInsertBatch,
  comparePartitionRevisions,
  getPartitionActionEntityTypes,
  getDomainAvailabilityFallbackRoutes,
  getPartitionDataDomain,
  hashPartitionRequest,
  makePartitionEntityKey,
  resolveDomainWriteRoutes,
  normalizePartitionDatabaseRow,
  personalTableReadPredicates,
  readWithMinimumReplicaCount,
  type PartitionMutation,
} from "@workspace/db";

test("partition domains assign each application table to the requested store group", () => {
  assert.equal(getPartitionDataDomain("attendance"), "facility");
  assert.equal(getPartitionDataDomain("service_sessions"), "facility");
  assert.equal(getPartitionDataDomain("treatment_cards"), "cards");
  assert.equal(getPartitionDataDomain("card_usage_history"), "cards");
  assert.equal(getPartitionDataDomain("personal_sessions"), "personal");
  assert.equal(getPartitionDataDomain("members"), "shared");
  assert.equal(getPartitionDataDomain("appointments"), "shared");
  assert.equal(getPartitionDataDomain("employee_availability"), "shared");
  assert.equal(getPartitionDataDomain("facility_bonus_settings"), "shared");
  assert.equal(getPartitionDataDomain("employee_service_bonus_rates"), "shared");
  assert.equal(getPartitionDataDomain("facility_night_settings"), "shared");
  assert.equal(getPartitionDataDomain("unlisted_table"), undefined);
  for (const table of [
    "members",
    "member_versions",
    "attendance",
    "treatment_cards",
    "card_top_ups",
    "card_usage_history",
    "service_sessions",
    "service_types",
    "manager_grants",
    "personal_services",
    "personal_sessions",
    "personal_settings",
    "appointments",
    "employee_availability",
    "facility_bonus_settings",
    "employee_service_bonus_rates",
    "tasks",
  ]) {
    assert.ok(getPartitionDataDomain(table), `Missing data-domain assignment for ${table}`);
  }
});

test("partition actions declare all data groups they can update", () => {
  assert.deepEqual(getPartitionActionEntityTypes("attendance.create"), ["attendance"]);
  assert.deepEqual(getPartitionActionEntityTypes("employee-availability.update"), ["employee_availability"]);
  assert.deepEqual(getPartitionActionEntityTypes("employee-bonus-config.update"), [
    "facility_bonus_settings", "employee_service_bonus_rates",
  ]);
  assert.deepEqual(getPartitionActionEntityTypes("card.topup"), ["treatment_cards", "card_top_ups"]);
  assert.deepEqual(getPartitionActionEntityTypes("service-session.save"), [
    "service_sessions", "treatment_cards", "appointments",
  ]);
  assert.deepEqual(getPartitionActionEntityTypes("retention.cleanup"), [
    "attendance", "service_sessions", "card_usage_history", "personal_sessions",
  ]);
  assert.equal(getPartitionActionEntityTypes("unknown.action"), undefined);
  for (const action of [
    "attendance.create", "attendance.update", "attendance.delete",
    "appointment.create", "appointment.update", "appointment.delete",
    "employee-availability.update",
    "employee-bonus-config.update",
    "access-grant.create", "access-grant.update", "access-grant.delete",
    "card.create", "card.update", "card.merge", "card.delete", "card.topup",
    "member.create", "member.update", "member.delete",
    "personal-service.create", "personal-service.update", "personal-service.delete",
    "personal-session.create", "personal-session.update", "personal-session.delete",
    "personal-settings.update", "personal-sync.replace",
    "retention.manual-delete-range", "retention.cleanup",
    "service-type.create", "service-type.update", "service-type.delete",
    "service-session.save", "service-session.delete",
  ]) {
    assert.ok(getPartitionActionEntityTypes(action), `Missing mutation policy for ${action}`);
  }
});

test("domain routing keeps each data group on its fixed store pair", () => {
  const routes = resolveDomainWriteRoutes([
    "attendance",
    "treatment_cards",
    "personal_sessions",
    "appointments",
  ]);
  assert.deepEqual(routes.attendance, {
    domain: "facility",
    primary: "database_url_1",
    replica: "database_url",
  });
  assert.deepEqual(routes.treatment_cards, {
    domain: "cards",
    primary: "database_url",
    replica: "database_url_3",
  });
  assert.deepEqual(routes.personal_sessions, {
    domain: "personal",
    primary: "database_url_3",
    replica: "database_url_4",
  });
  assert.deepEqual(routes.appointments, {
    domain: "shared",
    primary: "database_url_4",
    replica: "database_url_3",
  });
});

test("domain routing does not choose a different pair based on capacity", () => {
  const routes = resolveDomainWriteRoutes(["treatment_cards"]);
  assert.deepEqual(routes.treatment_cards, {
    domain: "cards",
    primary: "database_url",
    replica: "database_url_3",
  });
});

test("only a failed connection may move a domain operation to a fixed alternate pair", () => {
  const preferred = resolveDomainWriteRoutes(["treatment_cards"]);
  const fallback = getDomainAvailabilityFallbackRoutes(
    ["treatment_cards"],
    "database_url",
    preferred,
  );
  assert.deepEqual(fallback.treatment_cards, {
    domain: "cards",
    primary: "database_url_3",
    replica: "database_url_4",
  });
});

test("partition reads query only three stores when all are healthy", async () => {
  const queried: string[] = [];
  const reads = await readWithMinimumReplicaCount(
    ["db1", "db2", "db3", "db4"],
    3,
    async (node) => {
      queried.push(node);
      return node;
    },
  );

  assert.deepEqual(queried, ["db1", "db2", "db3"]);
  assert.deepEqual(reads.map((entry) => entry.result), ["db1", "db2", "db3"]);
  for (const pair of [
    ["db1", "db2"], ["db1", "db3"], ["db1", "db4"],
    ["db2", "db3"], ["db2", "db4"], ["db3", "db4"],
  ]) {
    assert.ok(reads.some((entry) => pair.includes(entry.node)));
  }
});

test("partition reads try the fourth store only to replace an unavailable replica", async () => {
  for (const failedNode of ["db1", "db2", "db3", "db4"]) {
    const queried: string[] = [];
    const reads = await readWithMinimumReplicaCount(
      ["db1", "db2", "db3", "db4"],
      3,
      async (node) => {
        queried.push(node);
        if (node === failedNode) throw new Error("store unavailable");
        return node;
      },
    );

    assert.equal(reads.length, 3, `Expected three healthy replicas when ${failedNode} is unavailable.`);
    assert.ok(!reads.some((entry) => entry.node === failedNode));
    assert.equal(queried.includes("db4"), failedNode !== "db4");
  }
});

test("partition reads return fewer than three replicas when multiple stores fail", async () => {
  const reads = await readWithMinimumReplicaCount(
    ["db1", "db2", "db3", "db4"],
    3,
    async (node) => {
      if (node === "db1" || node === "db2") throw new Error("store unavailable");
      return node;
    },
  );

  assert.deepEqual(reads.map((entry) => entry.result), ["db3", "db4"]);
});

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
