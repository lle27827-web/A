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
    CREATE TABLE IF NOT EXISTS public.employee_availability (
      member_id integer PRIMARY KEY,
      employee_name text NOT NULL,
      status_date date NOT NULL,
      state text NOT NULL DEFAULT 'off' CHECK (state = 'off'),
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS employee_availability_status_date_idx
    ON public.employee_availability USING btree (status_date)
  `);
  const columns = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employee_availability'
  `);
  const actual = new Map(columns.rows.map((column) => [column.column_name, column]));
  const expected = [
    ["member_id", "integer", "NO"],
    ["employee_name", "text", "NO"],
    ["status_date", "date", "NO"],
    ["state", "text", "NO"],
    ["updated_at", "timestamp with time zone", "NO"],
  ];
  for (const [name, type, nullable] of expected) {
    const column = actual.get(name);
    if (!column || column.data_type !== type || column.is_nullable !== nullable) {
      throw new Error(`Existing employee availability schema does not match expected column: ${name}`);
    }
  }
  await client.query("COMMIT");
  console.log("Employee availability schema ready.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
