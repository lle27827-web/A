import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '15s'");
  await client.query("SET LOCAL statement_timeout = '30s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('so-cong:migrations', 0))");
  await client.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id serial PRIMARY KEY,
      customer_name text NOT NULL,
      phone text NOT NULL,
      scheduled_at timestamp with time zone NOT NULL,
      status text NOT NULL DEFAULT 'scheduled',
      request text NOT NULL DEFAULT '',
      note text NOT NULL DEFAULT '',
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'scheduled'
  `);
  await client.query(`
    ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS request text NOT NULL DEFAULT ''
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS appointments_scheduled_at_idx
    ON appointments USING btree (scheduled_at)
  `);
  const columns = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'appointments'
  `);
  const actual = new Map(columns.rows.map((column) => [column.column_name, column]));
  const expected = [
    ["id", "integer", "NO"],
    ["customer_name", "text", "NO"],
    ["phone", "text", "NO"],
    ["scheduled_at", "timestamp with time zone", "NO"],
    ["status", "text", "NO"],
    ["request", "text", "NO"],
    ["note", "text", "NO"],
    ["created_at", "timestamp with time zone", "NO"],
    ["updated_at", "timestamp with time zone", "NO"],
  ];
  for (const [name, type, nullable] of expected) {
    const column = actual.get(name);
    if (!column || column.data_type !== type || column.is_nullable !== nullable) {
      throw new Error(`Existing appointments schema does not match expected column: ${name}`);
    }
  }
  await client.query("COMMIT");
  console.log("Appointments schema ready.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
