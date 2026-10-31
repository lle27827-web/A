import pg from "pg";
import { resolveMigrationTargetUrl } from "./vercel-stores.mjs";

// apply-vercel-stores.mjs invokes this script once per unique configured store,
// setting DATABASE_URL to that store. Do not resolve every store again here:
// the orchestration process retains the other database variables, so doing so
// would duplicate work and can miscount the current target after URL override.
const targetUrl = resolveMigrationTargetUrl(process.env);

// Use transactional CREATE INDEX so the migration also works through Neon poolers.
// This briefly blocks writes to the indexed table while the index is being built.
const indexes = [
  {
    name: "attendance_work_date_idx",
    table: "attendance",
    definition: "CREATE INDEX IF NOT EXISTS attendance_work_date_idx ON public.attendance USING btree (work_date)",
  },
  {
    name: "service_sessions_work_date_idx",
    table: "service_sessions",
    definition: "CREATE INDEX IF NOT EXISTS service_sessions_work_date_idx ON public.service_sessions USING btree (work_date)",
  },
];

const pool = new pg.Pool({
  connectionString: targetUrl,
  application_name: "so-cong-retention-indexes",
  connectionTimeoutMillis: 15_000,
  max: 1,
});
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL statement_timeout = 0");
  for (const index of indexes) {
    const tableCheck = await client.query("SELECT to_regclass($1) AS table_name", [`public.${index.table}`]);
    if (!tableCheck.rows[0]?.table_name) {
      throw new Error(`Migration target is missing public.${index.table}; no index was created.`);
    }

    const existing = await client.query(`
        SELECT i.indisvalid AS valid, pg_get_indexdef(i.indexrelid) AS definition
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1
      `, [index.name]);
    if (existing.rows[0] && !existing.rows[0].valid) {
      await client.query(`DROP INDEX IF EXISTS public.${index.name}`);
    } else if (existing.rows[0]) {
      if (!existing.rows[0].definition.includes(`ON public.${index.table} USING btree (work_date)`)) {
        throw new Error(`Migration target has an unexpected definition for ${index.name}; stopped without replacing it.`);
      }
      continue;
    }

    await client.query(index.definition);
    const verified = await client.query(`
        SELECT i.indisvalid AS valid, pg_get_indexdef(i.indexrelid) AS definition
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1
      `, [index.name]);
    if (!verified.rows[0]?.valid || !verified.rows[0].definition.includes(`ON public.${index.table} USING btree (work_date)`)) {
      throw new Error(`Migration target index verification failed for ${index.name}.`);
    }
  }
  await client.query("COMMIT");
  console.log("Verified date-range indexes on the migration target.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}

console.log("Date-range indexes are ready on the migration target.");
