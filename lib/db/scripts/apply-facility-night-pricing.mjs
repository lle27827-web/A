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
    ALTER TABLE public.service_types
      ADD COLUMN IF NOT EXISTS night_customer_hourly_rate integer
        CHECK (night_customer_hourly_rate BETWEEN 1 AND 10000000),
      ADD COLUMN IF NOT EXISTS night_hourly_rate integer
        CHECK (night_hourly_rate BETWEEN 1 AND 10000000)
  `);
  await client.query(`
    ALTER TABLE public.service_sessions
      ADD COLUMN IF NOT EXISTS is_night_shift boolean NOT NULL DEFAULT false
  `);
  await client.query(`
    ALTER TABLE public.card_usage_history
      ADD COLUMN IF NOT EXISTS is_night_shift boolean NOT NULL DEFAULT false
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.facility_night_settings (
      id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      enabled boolean NOT NULL DEFAULT false,
      start_time text NOT NULL DEFAULT '22:00',
      end_time text NOT NULL DEFAULT '06:00',
      updated_at timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT facility_night_settings_time_format CHECK (
        start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND start_time <> end_time
      )
    )
  `);
  await client.query(`
    INSERT INTO public.facility_night_settings (id, enabled, start_time, end_time)
    VALUES (1, false, '22:00', '06:00')
    ON CONFLICT (id) DO NOTHING
  `);

  const expected = {
    service_types: {
      night_customer_hourly_rate: ["integer", "YES"],
      night_hourly_rate: ["integer", "YES"],
    },
    service_sessions: {
      is_night_shift: ["boolean", "NO"],
    },
    card_usage_history: {
      is_night_shift: ["boolean", "NO"],
    },
    facility_night_settings: {
      id: ["integer", "NO"],
      enabled: ["boolean", "NO"],
      start_time: ["text", "NO"],
      end_time: ["text", "NO"],
      updated_at: ["timestamp with time zone", "NO"],
    },
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
        throw new Error(`Night-service pricing schema is missing ${tableName}.${columnName}.`);
      }
    }
  }
  await client.query("COMMIT");
  console.log("Night-shift pricing schema ready. Existing service and session history was preserved.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
