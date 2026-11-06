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
    CREATE TABLE IF NOT EXISTS public.facility_bonus_settings (
      id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      enabled boolean NOT NULL DEFAULT false,
      threshold_minutes integer NOT NULL DEFAULT 0 CHECK (threshold_minutes BETWEEN 0 AND 44640),
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.employee_service_bonus_rates (
      id text PRIMARY KEY,
      member_id integer NOT NULL CHECK (member_id > 0),
      service_type_id integer NOT NULL CHECK (service_type_id > 0),
      hourly_rate integer NOT NULL CHECK (hourly_rate BETWEEN 1 AND 10000000),
      updated_at timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT employee_service_bonus_rates_member_service_unique UNIQUE (member_id, service_type_id)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS employee_service_bonus_rates_member_idx
    ON public.employee_service_bonus_rates USING btree (member_id)
  `);
  const expectedTables = {
    facility_bonus_settings: {
      id: ["integer", "NO"],
      enabled: ["boolean", "NO"],
      threshold_minutes: ["integer", "NO"],
      updated_at: ["timestamp with time zone", "NO"],
    },
    employee_service_bonus_rates: {
      id: ["text", "NO"],
      member_id: ["integer", "NO"],
      service_type_id: ["integer", "NO"],
      hourly_rate: ["integer", "NO"],
      updated_at: ["timestamp with time zone", "NO"],
    },
  };
  for (const [tableName, expected] of Object.entries(expectedTables)) {
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
    `, [tableName]);
    const actual = new Map(result.rows.map((column) => [column.column_name, column]));
    for (const [columnName, [dataType, nullable]] of Object.entries(expected)) {
      const column = actual.get(columnName);
      if (!column || column.data_type !== dataType || column.is_nullable !== nullable) {
        throw new Error(`Existing ${tableName} schema does not match expected column: ${columnName}`);
      }
    }
  }
  await client.query("COMMIT");
  console.log("Employee bonus pay schema ready.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
