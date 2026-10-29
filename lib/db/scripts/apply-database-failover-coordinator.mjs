import pg from "pg";

const coordinatorUrl = process.env.DATABASE_FAILOVER_COORDINATOR_URL?.trim();
const legacyStateUrl =
  process.env.DATABASE_FAILOVER_STATE_SOURCE_URL?.trim();

if (!coordinatorUrl || !legacyStateUrl) {
  throw new Error(
    "Set DATABASE_FAILOVER_COORDINATOR_URL and DATABASE_FAILOVER_STATE_SOURCE_URL to migrate failover coordination.",
  );
}

function connectionIdentity(connectionString) {
  const url = new URL(connectionString);
  const host = url.hostname.toLowerCase().replace(/-pooler(?=\.|$)/, "");
  return `${host}:${url.port || "5432"}${url.pathname}`;
}

function sameFailureDomain(first, second) {
  const firstUrl = new URL(first);
  const secondUrl = new URL(second);
  const firstNeonProject =
    firstUrl.hostname.toLowerCase().endsWith(".neon.tech")
      ? firstUrl.hostname.split(".")[0].replace(/-pooler$/, "")
      : null;
  const secondNeonProject =
    secondUrl.hostname.toLowerCase().endsWith(".neon.tech")
      ? secondUrl.hostname.split(".")[0].replace(/-pooler$/, "")
      : null;

  if (firstNeonProject && secondNeonProject) {
    return firstNeonProject === secondNeonProject;
  }
  return connectionIdentity(first) === connectionIdentity(second);
}

const applicationDatabaseUrls = [
  process.env.DATABASE_URL_1,
  process.env.DATABASE_URL,
  process.env.DATABASE_URL_3,
  process.env.DATABASE_URL_4,
].filter((value) => typeof value === "string" && value.trim() !== "");

if (
  [legacyStateUrl, ...applicationDatabaseUrls].some((dataUrl) =>
    sameFailureDomain(coordinatorUrl, dataUrl),
  )
) {
  throw new Error(
    "The failover coordinator must be in a separate database failure domain from the legacy state database and every configured application database.",
  );
}

const sourcePool = new pg.Pool({
  connectionString: legacyStateUrl,
  application_name: "so-cong-failover-state-migration-source",
  connectionTimeoutMillis: 15_000,
  max: 1,
});
const coordinatorPool = new pg.Pool({
  connectionString: coordinatorUrl,
  application_name: "so-cong-failover-coordinator-migration",
  connectionTimeoutMillis: 15_000,
  max: 1,
});

let client;
try {
  const sourceResult = await sourcePool.query(
    "SELECT active_backend, reason FROM public.db_failover_state WHERE id = 1",
  );
  const sourceState = sourceResult.rows[0];
  const allowedBackends = new Set([
    "database_url_1",
    "database_url",
    "database_url_3",
    "database_url_4",
  ]);
  if (!sourceState || !allowedBackends.has(sourceState.active_backend)) {
    throw new Error(
      "The existing failover state is missing or currently switching; resolve it before migrating the coordinator.",
    );
  }

  client = await coordinatorPool.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '15s'");
  await client.query("SET LOCAL statement_timeout = '30s'");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('so-cong:database-failover-coordinator', 0))",
  );
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.db_failover_state (
      id smallint PRIMARY KEY CHECK (id = 1),
      active_backend text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      reason text,
      switch_started_at timestamptz,
      switch_source_backend text,
      switch_target_backend text,
      manual_recovery_required boolean NOT NULL DEFAULT false
    )
  `);
  await client.query(`
    ALTER TABLE public.db_failover_state
      ADD COLUMN IF NOT EXISTS switch_started_at timestamptz,
      ADD COLUMN IF NOT EXISTS switch_source_backend text,
      ADD COLUMN IF NOT EXISTS switch_target_backend text,
      ADD COLUMN IF NOT EXISTS manual_recovery_required boolean NOT NULL DEFAULT false;
    UPDATE public.db_failover_state
    SET manual_recovery_required = true
    WHERE active_backend = 'switching'
      AND (switch_source_backend IS NULL OR switch_target_backend IS NULL)
  `);

  const columns = await client.query(`
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
    ["switch_started_at", "timestamp with time zone", "YES"],
    ["switch_source_backend", "text", "YES"],
    ["switch_target_backend", "text", "YES"],
    ["manual_recovery_required", "boolean", "NO"],
  ];
  for (const [name, type, nullable] of expected) {
    const column = actual.get(name);
    if (!column || column.data_type !== type || column.is_nullable !== nullable) {
      throw new Error(`Failover coordinator schema mismatch in column: ${name}`);
    }
  }

  await client.query(`
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
  await client.query(
    `INSERT INTO public.db_failover_state (id, active_backend, reason)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [sourceState.active_backend, sourceState.reason ?? null],
  );

  const coordinatorResult = await client.query(
    "SELECT active_backend FROM public.db_failover_state WHERE id = 1",
  );
  if (coordinatorResult.rows[0]?.active_backend !== sourceState.active_backend) {
    throw new Error(
      "The coordinator already contains a different active database. Resolve the state mismatch manually; no state was overwritten.",
    );
  }

  await client.query("COMMIT");
  console.log(
    `Failover coordinator is ready and matches the existing active backend (${sourceState.active_backend}).`,
  );
} catch (error) {
  if (client) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client?.release();
  await Promise.all([sourcePool.end(), coordinatorPool.end()]);
}
