import pg from "pg";
import { rowsEquivalent, transformRow } from "./db4-to-db3-data.mjs";
import { resolveDirectConfiguredStores } from "./vercel-stores.mjs";

const TABLES = [
  "businesses",
  "business_users",
  "business_memberships",
  "business_join_attempts",
  "members",
  "service_types",
  "member_versions",
  "manager_grants",
  "treatment_cards",
  "card_top_ups",
  "attendance",
  "service_sessions",
  "card_usage_history",
  "appointments",
  "employee_availability",
  "facility_bonus_settings",
  "employee_service_bonus_rates",
  "facility_night_settings",
  "personal_services",
  "personal_settings",
  "personal_sessions",
  "tasks",
  "audit_logs",
  "api_write_operations",
  "storage_partition_events",
  "storage_partition_operations",
  "storage_partition_id_sequences",
  "storage_partition_state",
  "db_failover_state",
];
const batchSize = 200;
const failoverStateSchemaSql = `
  CREATE TABLE IF NOT EXISTS public.db_failover_state (
    id smallint PRIMARY KEY CHECK (id = 1),
    active_backend text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    reason text,
    switch_started_at timestamptz,
    switch_source_backend text,
    switch_target_backend text,
    manual_recovery_required boolean NOT NULL DEFAULT false
  );
  ALTER TABLE public.db_failover_state
    ADD COLUMN IF NOT EXISTS reason text,
    ADD COLUMN IF NOT EXISTS switch_started_at timestamptz,
    ADD COLUMN IF NOT EXISTS switch_source_backend text,
    ADD COLUMN IF NOT EXISTS switch_target_backend text,
    ADD COLUMN IF NOT EXISTS manual_recovery_required boolean NOT NULL DEFAULT false;
  ALTER TABLE public.db_failover_state
    DROP CONSTRAINT IF EXISTS db_failover_state_active_backend_check;
`;

function getUrl(keys, label) {
  const candidate = keys
    .map((key) => ({ key, value: process.env[key]?.trim() }))
    .find(({ value }) => value);
  if (!candidate) throw new Error(`Set a direct URL for ${label} (${keys.join(" or ")}).`);
  let url;
  try {
    url = new URL(candidate.value);
  } catch {
    throw new Error(`${label} URL is invalid.`);
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || /-pooler(?:\.|$)/i.test(url.hostname)) {
    throw new Error(`${label} must use a direct PostgreSQL endpoint without -pooler.`);
  }
  return {
    key: candidate.key,
    value: candidate.value,
    hostname: url.hostname.toLowerCase(),
    database: url.pathname,
  };
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function stableJson(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${stableJson(value[key])}`,
  ).join(",")}}`;
}

async function getTableInfo(client, table) {
  const columns = await client.query(
    `SELECT column_name, udt_name, is_nullable, is_generated, is_identity
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table],
  );
  if (!columns.rows.length) throw new Error(`Required table public.${table} is missing.`);
  const primaryKey = await client.query(
    `SELECT a.attname AS column_name, ord.ordinality
     FROM pg_index i
     JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS ord(attnum, ordinality) ON true
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ord.attnum
     WHERE i.indrelid = format('public.%I', $1::text)::regclass AND i.indisprimary
     ORDER BY ord.ordinality`,
    [table],
  );
  if (!primaryKey.rows.length) throw new Error(`Table public.${table} has no primary key.`);
  return {
    columns: columns.rows
      .filter((column) => column.is_generated === "NEVER")
      .map((column) => column.column_name),
    schemaColumns: columns.rows.map((column) => ({
      column_name: column.column_name,
      udt_name: column.udt_name,
      is_nullable: column.is_nullable,
      is_generated: column.is_generated,
      is_identity: column.is_identity,
    })).sort((left, right) => left.column_name.localeCompare(right.column_name)),
    hasIdentity: columns.rows.some((column) => column.is_identity === "YES"),
    primaryKey: primaryKey.rows.map((column) => column.column_name),
  };
}

async function assertSchemaMatches(source, target, table) {
  const [sourceInfo, targetInfo] = await Promise.all([
    getTableInfo(source, table),
    getTableInfo(target, table),
  ]);
  if (
    stableJson([...sourceInfo.columns].sort()) !== stableJson([...targetInfo.columns].sort()) ||
    stableJson(sourceInfo.schemaColumns) !== stableJson(targetInfo.schemaColumns) ||
    sourceInfo.hasIdentity !== targetInfo.hasIdentity ||
    stableJson(sourceInfo.primaryKey) !== stableJson(targetInfo.primaryKey)
  ) {
    throw new Error(`DB4 and DB3 schema differs for public.${table}; no data was copied.`);
  }
  return sourceInfo;
}

async function assertNoOpenOperations(client, label) {
  const result = await client.query(
    `SELECT state, count(*)::int AS count
     FROM public.storage_partition_operations
     WHERE state <> 'committed'
     GROUP BY state`,
  );
  if (result.rows.length) {
    throw new Error(`${label} has unfinished partition operations; reconcile them before migration.`);
  }
}

async function repairTargetSequences(client) {
  const sequenceColumns = await client.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])
       AND (column_default LIKE 'nextval(%' OR is_identity = 'YES')
     ORDER BY table_name, ordinal_position`,
    [TABLES],
  );
  for (const { table_name: table, column_name: column } of sequenceColumns.rows) {
    const maxResult = await client.query(
      `SELECT max(${quoteIdentifier(column)})::text AS max_value
       FROM public.${quoteIdentifier(table)}`,
    );
    if (maxResult.rows[0]?.max_value === null) continue;
    const sequence = await client.query(
      "SELECT pg_get_serial_sequence($1, $2) AS name",
      [`public.${table}`, column],
    );
    const sequenceName = sequence.rows[0]?.name;
    if (!sequenceName) continue;
    const existing = await client.query(
      `SELECT last_value::text AS last_value
       FROM pg_sequences
       WHERE to_regclass(format('%I.%I', schemaname, sequencename)) = $1::regclass`,
      [sequenceName],
    );
    const nextValue = [maxResult.rows[0].max_value, existing.rows[0]?.last_value]
      .filter(Boolean)
      .map(BigInt)
      .reduce((maximum, value) => value > maximum ? value : maximum, 1n);
    await client.query(
      "SELECT setval($1::regclass, $2::bigint, true)",
      [sequenceName, nextValue.toString()],
    );
  }
}

async function copyTable(source, target, table, info) {
  const columns = info.columns.map(quoteIdentifier).join(", ");
  const identityOverride = info.hasIdentity ? "OVERRIDING SYSTEM VALUE" : "";
  const keys = info.primaryKey.map(quoteIdentifier);
  const cursor = quoteIdentifier(`migrate_${table}`);
  await source.query(
    `DECLARE ${cursor} NO SCROLL CURSOR FOR
     SELECT ${columns} FROM public.${quoteIdentifier(table)}
     ORDER BY ${keys.join(", ")}`,
  );
  let copied = 0;
  while (true) {
    const page = await source.query(`FETCH FORWARD ${batchSize} FROM ${cursor}`);
    if (!page.rows.length) break;
    const rows = page.rows.map((row) => transformRow(table, row));
    const params = [];
    const valueTuples = rows.map((row) => {
      const values = info.columns.map((column) => row[column]);
      const placeholders = values.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    const keySql = keys.join(", ");
    if (table === "storage_partition_state") {
      const targetState = await target.query(
        `SELECT write_backend, next_revision::text FROM public.storage_partition_state WHERE id = 1`,
      );
      const incoming = rows[0];
      const current = targetState.rows[0];
      const isEmptySeed = current?.write_backend === "database_url_1" &&
        current.next_revision === "1" &&
        Number((await target.query(
          "SELECT count(*)::int AS count FROM public.storage_partition_operations",
        )).rows[0]?.count ?? 0) === 0;
      if (current && !isEmptySeed &&
          (current.write_backend !== incoming.write_backend ||
            current.next_revision !== String(incoming.next_revision))) {
        throw new Error("DB3 already has a different partition coordinator state; no state was overwritten.");
      }
      await target.query(
        `INSERT INTO public.${quoteIdentifier(table)} (${columns}) ${identityOverride}
         VALUES ${valueTuples.join(", ")}
         ON CONFLICT (${keySql}) DO UPDATE SET
           write_backend = EXCLUDED.write_backend,
           next_revision = GREATEST(public.storage_partition_state.next_revision, EXCLUDED.next_revision),
           updated_at = GREATEST(public.storage_partition_state.updated_at, EXCLUDED.updated_at)`,
        params,
      );
    } else if (table === "storage_partition_id_sequences") {
      await target.query(
        `INSERT INTO public.${quoteIdentifier(table)} (${columns}) ${identityOverride}
         VALUES ${valueTuples.join(", ")}
         ON CONFLICT (${keySql}) DO UPDATE SET
           next_id = GREATEST(public.storage_partition_id_sequences.next_id, EXCLUDED.next_id),
           updated_at = GREATEST(public.storage_partition_id_sequences.updated_at, EXCLUDED.updated_at)`,
        params,
      );
    } else {
      await target.query(
        `INSERT INTO public.${quoteIdentifier(table)} (${columns}) ${identityOverride}
         VALUES ${valueTuples.join(", ")}
         ON CONFLICT (${keySql}) DO NOTHING`,
        params,
      );
    }

    const keyParams = [];
    const predicates = rows.map((row) => {
      const terms = info.primaryKey.map((column) => {
        keyParams.push(row[column]);
        return `${quoteIdentifier(column)} = $${keyParams.length}`;
      });
      return `(${terms.join(" AND ")})`;
    });
    const existing = await target.query(
      `SELECT ${columns} FROM public.${quoteIdentifier(table)}
       WHERE ${predicates.join(" OR ")}`,
      keyParams,
    );
    const byKey = new Map(existing.rows.map((row) => [
      stableJson(info.primaryKey.map((column) => row[column])),
      row,
    ]));
    for (const row of rows) {
      const key = stableJson(info.primaryKey.map((column) => row[column]));
      const targetRow = byKey.get(key);
      const matches = table === "storage_partition_id_sequences"
        ? targetRow && BigInt(targetRow.next_id) >= BigInt(row.next_id)
        : table === "storage_partition_state"
          ? targetRow &&
            targetRow.write_backend === row.write_backend &&
            BigInt(targetRow.next_revision) >= BigInt(row.next_revision)
          : targetRow && rowsEquivalent(table, row, targetRow);
      if (!matches) {
        throw new Error(`Conflicting DB4/DB3 data detected in public.${table}; migration rolled back.`);
      }
    }
    copied += rows.length;
  }
  await source.query(`CLOSE ${cursor}`);
  return copied;
}

const sourceUrl = getUrl(
  ["NEON_DB4_DIRECT_URL", "MIGRATE_DATABASE_URL_4_DIRECT", "DATABASE_URL_4_DIRECT", "DATABASE_URL_4"],
  "DB4 source",
);
const targetUrl = getUrl(
  ["NEON_DB3_DIRECT_URL", "MIGRATE_DATABASE_URL_3_DIRECT", "DATABASE_URL_3_DIRECT", "DATABASE_URL_3"],
  "DB3 destination",
);
const activeStores = resolveDirectConfiguredStores(process.env);
const sourceIdentity = `${sourceUrl.hostname}${sourceUrl.database}`;
for (const store of activeStores) {
  const activeUrl = new URL(store.url);
  if (sourceIdentity === `${activeUrl.hostname.toLowerCase()}${activeUrl.pathname}`) {
    throw new Error(`DB4 source duplicates ${store.label}; no data was copied.`);
  }
}
if (process.env.CONFIRM_DB4_TO_DB3_MIGRATION !== "I_HAVE_PAUSED_WRITES") {
  throw new Error(
    "Pause application writes, then set CONFIRM_DB4_TO_DB3_MIGRATION=I_HAVE_PAUSED_WRITES to run this one-time copy.",
  );
}

const source = new pg.Client({
  connectionString: sourceUrl.value,
  application_name: "so-cong-db4-to-db3-source-snapshot",
  connectionTimeoutMillis: 15_000,
  statement_timeout: 0,
});
const target = new pg.Client({
  connectionString: targetUrl.value,
  application_name: "so-cong-db4-to-db3-migration",
  connectionTimeoutMillis: 15_000,
  statement_timeout: 0,
});

let sourceTransaction = false;
let targetTransaction = false;
try {
  await source.connect();
  await target.connect();
  await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  sourceTransaction = true;
  await target.query("BEGIN");
  targetTransaction = true;
  await source.query("SET LOCAL lock_timeout = '30s'");
  await target.query("SET LOCAL lock_timeout = '30s'");
  await target.query(failoverStateSchemaSql);

  // Lock before the first data read so the repeatable-read source snapshot
  // includes all writes committed before the pause and excludes no later ones.
  for (const table of TABLES) {
    await source.query(`LOCK TABLE public.${quoteIdentifier(table)} IN SHARE MODE`);
    await target.query(`LOCK TABLE public.${quoteIdentifier(table)} IN SHARE ROW EXCLUSIVE MODE`);
  }

  await target.query(
    `UPDATE public.db_failover_state
     SET active_backend = CASE WHEN active_backend = 'database_url_4' THEN 'database_url_3' ELSE active_backend END,
         switch_source_backend = CASE WHEN switch_source_backend = 'database_url_4' THEN 'database_url_3' ELSE switch_source_backend END,
         switch_target_backend = CASE WHEN switch_target_backend = 'database_url_4' THEN 'database_url_3' ELSE switch_target_backend END
     WHERE active_backend = 'database_url_4'
        OR switch_source_backend = 'database_url_4'
        OR switch_target_backend = 'database_url_4'`,
  );
  await target.query(
    `ALTER TABLE public.db_failover_state
     ADD CONSTRAINT db_failover_state_active_backend_check
     CHECK (active_backend IN ('database_url_1', 'database_url', 'database_url_3', 'switching'))`,
  );
  const destinationFailoverState = await target.query(
    "SELECT active_backend FROM public.db_failover_state WHERE active_backend = 'switching'",
  );
  if (destinationFailoverState.rows.length) {
    throw new Error("DB3 failover state is switching; resolve it before migration.");
  }

  for (const table of TABLES) {
    await assertSchemaMatches(source, target, table);
  }
  await assertNoOpenOperations(source, "DB4");
  await assertNoOpenOperations(target, "DB3");

  const counts = [];
  for (const table of TABLES) {
    const info = await assertSchemaMatches(source, target, table);
    const count = await copyTable(source, target, table, info);
    counts.push({ table, count });
  }
  await repairTargetSequences(target);

  const state = await target.query(
    `SELECT write_backend, next_revision::text
     FROM public.storage_partition_state WHERE id = 1`,
  );
  if (!state.rows[0]) throw new Error("DB3 coordinator state is missing after the copy.");
  const openState = await target.query(
    `SELECT count(*)::int AS count
     FROM public.storage_partition_operations
     WHERE state <> 'committed'`,
  );
  if (openState.rows[0]?.count !== 0) {
    throw new Error("DB3 has unfinished operations after copying; transaction rolled back.");
  }

  await target.query("COMMIT");
  targetTransaction = false;
  await source.query("COMMIT");
  sourceTransaction = false;
  for (const { table, count } of counts) console.log(`${table}: ${count} DB4 rows verified/copied.`);
  console.log("DB4 → DB3 additive copy completed. DB4 was not modified or deleted.");
} catch (error) {
  if (targetTransaction) await target.query("ROLLBACK").catch(() => undefined);
  if (sourceTransaction) await source.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await Promise.all([
    source.end().catch(() => undefined),
    target.end().catch(() => undefined),
  ]);
}
