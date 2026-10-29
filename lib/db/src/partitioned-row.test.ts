import assert from "node:assert/strict";
import test from "node:test";
import { normalizePartitionDatabaseRow, personalTableReadPredicates } from "./partitioned-row";

test("raw partition base rows use Drizzle property names and preserve driver date values", () => {
  const createdAt = new Date("2026-10-29T06:30:00.000Z");
  const row = normalizePartitionDatabaseRow({
    source_session_id: 21,
    work_date: "2026-10-29",
    created_at: createdAt,
    deleted_at: null,
  });

  assert.deepEqual(row, {
    sourceSessionId: 21,
    workDate: "2026-10-29",
    createdAt,
    deletedAt: null,
  });
});

test("personal partition reads scope both raw snapshots and event overlays to one user", () => {
  const predicates = personalTableReadPredicates("personal_sessions");
  assert.match(predicates.baseSql, /user_id = \$1/);
  assert.match(predicates.eventSql, /payload->>'userId' = \$2/);
  assert.throws(() => personalTableReadPredicates("service_sessions"));
});
