import pg from "pg";

const stores = [
  {
    backend: "database_url_1",
    url: process.env.NEON_DB1_DIRECT_URL?.trim() || process.env.DATABASE_URL_1?.trim(),
  },
  {
    backend: "database_url",
    url: process.env.NEON_SOURCE_DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim(),
  },
  {
    backend: "database_url_3",
    url: process.env.MIGRATE_DATABASE_URL_3_DIRECT?.trim() || process.env.DATABASE_URL_3?.trim(),
  },
  {
    backend: "database_url_4",
    url: process.env.MIGRATE_DATABASE_URL_4_DIRECT?.trim() || process.env.DATABASE_URL_4?.trim(),
  },
];

function directProjectHost(connectionString, backend) {
  let host;
  try {
    host = new URL(connectionString).hostname.toLowerCase();
  } catch {
    throw new Error(`The connection URL for ${backend} is invalid.`);
  }
  if (/-pooler(?:\.|$)/i.test(host)) {
    throw new Error(`Use the direct Neon endpoint for ${backend} migrations.`);
  }
  return host;
}

if (stores.some((store) => !store.url)) {
  const missing = stores.filter((store) => !store.url).map((store) => store.backend);
  throw new Error(`Storage partition migration requires all four stores: ${missing.join(", ")}.`);
}

const projectHosts = stores.map((store) => directProjectHost(store.url, store.backend));
if (new Set(projectHosts).size !== stores.length) {
  throw new Error("Each configured partition store must be a distinct Neon project.");
}

const eventTableSql = `
  CREATE TABLE IF NOT EXISTS public.storage_partition_events (
    event_id uuid PRIMARY KEY,
    operation_id uuid NOT NULL,
    revision bigint NOT NULL,
    source_backend text NOT NULL,
    entity_type text NOT NULL,
    entity_key text NOT NULL,
    action text NOT NULL,
    payload jsonb,
    committed boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT storage_partition_events_source_backend_check CHECK (
      source_backend IN ('database_url_1', 'database_url', 'database_url_3', 'database_url_4')
    ),
    CONSTRAINT storage_partition_events_action_check CHECK (action IN ('upsert', 'delete')),
    CONSTRAINT storage_partition_events_payload_check CHECK (
      (action = 'delete' AND payload IS NULL) OR
      (action = 'upsert' AND payload IS NOT NULL)
    )
  );
  ALTER TABLE public.storage_partition_events
    ADD COLUMN IF NOT EXISTS committed boolean NOT NULL DEFAULT false;
  CREATE INDEX IF NOT EXISTS storage_partition_events_committed_entity_idx
    ON public.storage_partition_events (committed, entity_type, revision);
  CREATE UNIQUE INDEX IF NOT EXISTS storage_partition_events_entity_revision_unique
    ON public.storage_partition_events (entity_type, entity_key, revision);
  CREATE INDEX IF NOT EXISTS storage_partition_events_operation_idx
    ON public.storage_partition_events (operation_id);
  CREATE INDEX IF NOT EXISTS storage_partition_events_entity_idx
    ON public.storage_partition_events (entity_type, entity_key, revision);
`;

const coordinatorSql = `
  CREATE TABLE IF NOT EXISTS public.storage_partition_state (
    id smallint PRIMARY KEY,
    write_backend text NOT NULL,
    next_revision bigint NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT storage_partition_state_singleton_check CHECK (id = 1),
    CONSTRAINT storage_partition_state_backend_check CHECK (
      write_backend IN ('database_url_1', 'database_url', 'database_url_3', 'database_url_4')
    )
  );
  CREATE TABLE IF NOT EXISTS public.storage_partition_operations (
    operation_id uuid PRIMARY KEY,
    target_backend text NOT NULL,
    revision bigint NOT NULL,
    expected_event_count smallint NOT NULL,
    state text NOT NULL,
    request_hash text NOT NULL,
    result jsonb,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT storage_partition_operations_backend_check CHECK (
      target_backend IN ('database_url_1', 'database_url', 'database_url_3', 'database_url_4')
    ),
    CONSTRAINT storage_partition_operations_state_check CHECK (
      state IN ('pending', 'committed', 'needs_reconciliation')
    ),
    CONSTRAINT storage_partition_operations_event_count_check CHECK (expected_event_count > 0)
  );
  CREATE INDEX IF NOT EXISTS storage_partition_operations_state_idx
    ON public.storage_partition_operations (state, updated_at);
  CREATE TABLE IF NOT EXISTS public.storage_partition_id_sequences (
    entity_type text PRIMARY KEY,
    next_id bigint NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT storage_partition_id_sequences_positive_check CHECK (next_id > 0)
  );
`;

const sequenceTables = [
  "members",
  "member_versions",
  "attendance",
  "treatment_cards",
  "card_top_ups",
  "service_sessions",
  "service_types",
  "manager_grants",
  "personal_services",
  "personal_sessions",
  "appointments",
  "tasks",
];

async function readCanonicalIdCounters() {
  const source = stores[0];
  const pool = new pg.Pool({
    connectionString: source.url,
    application_name: "so-cong-storage-partition-id-preflight",
    connectionTimeoutMillis: 15_000,
    max: 1,
  });
  const client = await pool.connect();
  try {
    const counters = [];
    for (const entityType of sequenceTables) {
      const result = await client.query(
        `SELECT coalesce(max(id), 0)::text AS max_id FROM public."${entityType}"`,
      );
      const nextId = BigInt(result.rows[0]?.max_id ?? "0") + 1n;
      if (nextId > 2_147_483_647n) {
        throw new Error(`DB1 numeric IDs are exhausted for ${entityType}; partition migration stopped.`);
      }
      counters.push({ entityType, nextId: nextId.toString() });
    }
    return counters;
  } finally {
    client.release();
    await pool.end();
  }
}

async function applyStoreMigration(store, index) {
  const pool = new pg.Pool({
    connectionString: store.url,
    application_name: `so-cong-storage-partition-migration-${index + 1}`,
    connectionTimeoutMillis: 15_000,
    max: 1,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SET LOCAL statement_timeout = '45s'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('so-cong:storage-partition-schema-v1', 0))",
    );
    await client.query(eventTableSql);
    if (store.backend === "database_url_4") {
      await client.query(coordinatorSql);
      await client.query(
        `INSERT INTO public.storage_partition_state (id, write_backend, next_revision)
         VALUES (1, 'database_url_1', 1)
         ON CONFLICT (id) DO NOTHING`,
      );
      const result = await client.query(
        "SELECT write_backend FROM public.storage_partition_state WHERE id = 1",
      );
      if (!result.rows[0]) {
        throw new Error("DB4 partition coordinator row was not initialized.");
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const canonicalIdCounters = await readCanonicalIdCounters();
for (const [index, store] of stores.entries()) {
  await applyStoreMigration(store, index);
  console.log(`Partition event schema is ready on ${store.backend}.`);
}
const coordinatorPool = new pg.Pool({
  connectionString: stores[3].url,
  application_name: "so-cong-storage-partition-id-seed",
  connectionTimeoutMillis: 15_000,
  max: 1,
});
try {
  for (const counter of canonicalIdCounters) {
    await coordinatorPool.query(
      `INSERT INTO public.storage_partition_id_sequences (entity_type, next_id)
       VALUES ($1, $2)
       ON CONFLICT (entity_type) DO UPDATE
       SET next_id = GREATEST(
         public.storage_partition_id_sequences.next_id,
         EXCLUDED.next_id
       ),
       updated_at = now()`,
      [counter.entityType, counter.nextId],
    );
  }
} finally {
  await coordinatorPool.end();
}
console.log("DB4 coordinator schema is ready; no business rows were copied or changed.");
