import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set.");
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15000,
  max: 1,
});

let client;
try {
  client = await pool.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '15s'");
  await client.query("SET LOCAL statement_timeout = '30s'");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('so-cong:database-failover-state', 0))",
  );
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.db_failover_state (
      id smallint PRIMARY KEY CHECK (id = 1),
      active_backend text NOT NULL
        CHECK (active_backend IN ('database_url_1', 'database_url', 'switching')),
      updated_at timestamptz NOT NULL DEFAULT now(),
      reason text
    )
  `);

  const columns = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'db_failover_state'
  `);
  const actual = new Map(columns.rows.map((column) => [column.column_name, column]));
  const expected = [
    ["id", "smallint", "NO"],
    ["active_backend", "text", "NO"],
    ["updated_at", "timestamp with time zone", "NO"],
    ["reason", "text", "YES"],
  ];
  for (const [name, type, nullable] of expected) {
    const column = actual.get(name);
    if (!column || column.data_type !== type || column.is_nullable !== nullable) {
      throw new Error(`Failover state schema mismatch in column: ${name}`);
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

  await client.query(`
    INSERT INTO public.db_failover_state (id, active_backend, reason)
    VALUES (1, 'database_url', 'Keep the existing Vercel database active until cutover.')
    ON CONFLICT (id) DO NOTHING
  `);
  await client.query("COMMIT");
  console.log("Database failover state table is ready.");
} catch (error) {
  if (client) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client?.release();
  await pool.end();
}
