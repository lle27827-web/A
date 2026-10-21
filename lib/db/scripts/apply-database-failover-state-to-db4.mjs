import pg from "pg";

const sourceUrl = process.env.DATABASE_FAILOVER_STATE_SOURCE_URL?.trim();
const targetUrl = process.env.DATABASE_FAILOVER_STATE_TARGET_URL?.trim();
const allowedBackends = new Set([
  "database_url_1",
  "database_url",
  "database_url_3",
  "database_url_4",
]);

if (!sourceUrl || !targetUrl) {
  throw new Error(
    "Set DATABASE_FAILOVER_STATE_SOURCE_URL (DB2 direct URL) and DATABASE_FAILOVER_STATE_TARGET_URL (DB4 direct URL).",
  );
}

function projectHost(connectionString) {
  const host = new URL(connectionString).hostname.toLowerCase();
  if (host.includes("-pooler.")) {
    throw new Error("Use direct PostgreSQL URLs for the coordinator migration.");
  }
  return host.replace(/-pooler(?=\.|$)/, "");
}

if (projectHost(sourceUrl) === projectHost(targetUrl)) {
  throw new Error(
    "DB2 and DB4 must be different Neon projects for this migration.",
  );
}

const sourcePool = new pg.Pool({
  connectionString: sourceUrl,
  application_name: "so-cong-failover-state-db4-source",
  connectionTimeoutMillis: 15_000,
  max: 1,
});
const targetPool = new pg.Pool({
  connectionString: targetUrl,
  application_name: "so-cong-failover-state-db4-target",
  connectionTimeoutMillis: 15_000,
  max: 1,
});

let sourceClient;
let targetClient;
let targetCommitted = false;

try {
  sourceClient = await sourcePool.connect();
  await sourceClient.query("BEGIN");
  await sourceClient.query("SET LOCAL lock_timeout = '15s'");
  await sourceClient.query("SET LOCAL statement_timeout = '30s'");
  const sourceResult = await sourceClient.query(
    `SELECT active_backend, reason
     FROM public.db_failover_state
     WHERE id = 1
     FOR UPDATE`,
  );
  const sourceState = sourceResult.rows[0];
  if (!sourceState || !allowedBackends.has(sourceState.active_backend)) {
    throw new Error(
      "DB2 failover state is missing, switching, or unsupported; resolve it before migration.",
    );
  }

  targetClient = await targetPool.connect();
  await targetClient.query("BEGIN");
  await targetClient.query("SET LOCAL lock_timeout = '15s'");
  await targetClient.query("SET LOCAL statement_timeout = '30s'");
  await targetClient.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('so-cong:database-failover-state-db4', 0))",
  );
  await targetClient.query(`
    CREATE TABLE IF NOT EXISTS public.db_failover_state (
      id smallint PRIMARY KEY CHECK (id = 1),
      active_backend text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      reason text
    )
  `);

  const columns = await targetClient.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'db_failover_state'
  `);
  const actual = new Map(
    columns.rows.map((column) => [column.column_name, column]),
  );
  const expected = [
    ["id", "smallint", "NO"],
    ["active_backend", "text", "NO"],
    ["updated_at", "timestamp with time zone", "NO"],
    ["reason", "text", "YES"],
  ];
  for (const [name, type, nullable] of expected) {
    const column = actual.get(name);
    if (
      !column ||
      column.data_type !== type ||
      column.is_nullable !== nullable
    ) {
      throw new Error(`DB4 failover-state schema mismatch in column: ${name}`);
    }
  }

  await targetClient.query(`
    ALTER TABLE public.db_failover_state
      DROP CONSTRAINT IF EXISTS db_failover_state_active_backend_check;
    ALTER TABLE public.db_failover_state
      ADD CONSTRAINT db_failover_state_active_backend_check
      CHECK (
        active_backend IN (
          'database_url_1',
          'database_url',
          'database_url_3',
          'database_url_4',
          'switching'
        )
      )
  `);
  await targetClient.query(
    `INSERT INTO public.db_failover_state (id, active_backend, reason)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [sourceState.active_backend, sourceState.reason ?? null],
  );

  const targetResult = await targetClient.query(
    "SELECT active_backend FROM public.db_failover_state WHERE id = 1",
  );
  if (targetResult.rows[0]?.active_backend !== sourceState.active_backend) {
    throw new Error(
      "DB4 already has a different active backend; no state was overwritten.",
    );
  }

  await targetClient.query("COMMIT");
  targetCommitted = true;
  await sourceClient.query("COMMIT");
  console.log(
    `DB4 coordinator state is ready and matches DB2 (${sourceState.active_backend}).`,
  );
} catch (error) {
  if (targetClient && !targetCommitted) {
    await targetClient.query("ROLLBACK").catch(() => undefined);
  }
  if (sourceClient) {
    await sourceClient.query("ROLLBACK").catch(() => undefined);
  }
  throw error;
} finally {
  sourceClient?.release();
  targetClient?.release();
  await Promise.all([sourcePool.end(), targetPool.end()]);
}
