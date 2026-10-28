import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '15s'");
  await client.query("SET LOCAL statement_timeout = '30s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('so-cong:migrations', 0))");
  await client.query("ALTER TABLE manager_grants ADD COLUMN IF NOT EXISTS granted_by text");
  await client.query(`
    CREATE TABLE IF NOT EXISTS api_write_operations (
      operation_id uuid PRIMARY KEY,
      request_hash text NOT NULL,
      result jsonb NOT NULL,
      created_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
  const columns = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'api_write_operations'
  `);
  const actual = new Map(columns.rows.map((column) => [column.column_name, column]));
  const expected = [
    ["operation_id", "uuid", "NO"],
    ["request_hash", "text", "NO"],
    ["result", "jsonb", "NO"],
    ["created_at", "timestamp with time zone", "NO"],
  ];
  for (const [name, type, nullable] of expected) {
    const column = actual.get(name);
    if (!column || column.data_type !== type || column.is_nullable !== nullable) {
      throw new Error(`Existing idempotency schema does not match expected column: ${name}`);
    }
  }
  await client.query("COMMIT");
  console.log("API idempotency and grant ownership schema ready.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
