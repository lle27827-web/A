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
    ALTER TABLE public.personal_services
      ADD COLUMN IF NOT EXISTS night_hourly_rate integer
        CHECK (night_hourly_rate BETWEEN 1 AND 100000000)
  `);
  await client.query(`
    ALTER TABLE public.personal_sessions
      ADD COLUMN IF NOT EXISTS is_night_shift boolean NOT NULL DEFAULT false
  `);

  const expected = {
    personal_services: { night_hourly_rate: ["integer", "YES"] },
    personal_sessions: { is_night_shift: ["boolean", "NO"] },
  };
  for (const [tableName, columns] of Object.entries(expected)) {
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
    `, [tableName]);
    const actual = new Map(result.rows.map((row) => [
      row.column_name,
      [row.data_type, row.is_nullable],
    ]));
    for (const [columnName, shape] of Object.entries(columns)) {
      const found = actual.get(columnName);
      if (!found || found[0] !== shape[0] || found[1] !== shape[1]) {
        throw new Error(`Personal night-pricing schema is missing ${tableName}.${columnName}.`);
      }
    }
  }
  await client.query("COMMIT");
  console.log("Personal night-pricing schema ready; existing shifts and recorded pay preserved.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
