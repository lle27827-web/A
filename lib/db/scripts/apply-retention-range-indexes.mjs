import pg from "pg";

const stores = [
  {
    backend: "database_url_1",
    url: process.env.NEON_DB1_DIRECT_URL?.trim() || process.env.DATABASE_URL_1?.trim(),
  },
  {
    backend: "database_url",
    url: process.env.NEON_SOURCE_DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim(),
  },
  {
    backend: "database_url_3",
    url: process.env.MIGRATE_DATABASE_URL_3_DIRECT?.trim() || process.env.DATABASE_URL_3?.trim(),
  },
  {
    backend: "database_url_4",
    url: process.env.MIGRATE_DATABASE_URL_4_DIRECT?.trim() || process.env.DATABASE_URL_4?.trim(),
  },
];

if (stores.some((store) => !store.url)) {
  const missing = stores.filter((store) => !store.url).map((store) => store.backend);
  throw new Error(`Date-range index setup requires all four direct database URLs: ${missing.join(", ")}.`);
}

const hosts = stores.map(({ url, backend }) => {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error(`The connection URL for ${backend} is invalid.`);
  }
  if (/-pooler(?:\.|$)/i.test(host)) {
    throw new Error(`Use the direct Neon endpoint for ${backend} index setup.`);
  }
  return host;
});
if (new Set(hosts).size !== stores.length) {
  throw new Error("Each configured database must be a distinct Neon project.");
}

const indexes = [
  {
    name: "attendance_work_date_idx",
    table: "attendance",
    definition: "CREATE INDEX CONCURRENTLY IF NOT EXISTS attendance_work_date_idx ON public.attendance USING btree (work_date)",
  },
  {
    name: "service_sessions_work_date_idx",
    table: "service_sessions",
    definition: "CREATE INDEX CONCURRENTLY IF NOT EXISTS service_sessions_work_date_idx ON public.service_sessions USING btree (work_date)",
  },
];

for (const store of stores) {
  const pool = new pg.Pool({
    connectionString: store.url,
    application_name: `so-cong-retention-indexes-${store.backend}`,
    connectionTimeoutMillis: 15_000,
    max: 1,
  });
  const client = await pool.connect();
  try {
    await client.query("SET statement_timeout = 0");
    for (const index of indexes) {
      const tableCheck = await client.query("SELECT to_regclass($1) AS table_name", [`public.${index.table}`]);
      if (!tableCheck.rows[0]?.table_name) {
        throw new Error(`${store.backend} is missing public.${index.table}; no index was created.`);
      }

      const existing = await client.query(`
        SELECT i.indisvalid AS valid, pg_get_indexdef(i.indexrelid) AS definition
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1
      `, [index.name]);
      if (existing.rows[0] && !existing.rows[0].valid) {
        await client.query(`DROP INDEX CONCURRENTLY IF EXISTS public.${index.name}`);
      } else if (existing.rows[0]) {
        if (!existing.rows[0].definition.includes(`ON public.${index.table} USING btree (work_date)`)) {
          throw new Error(`${store.backend} has an unexpected definition for ${index.name}; stopped without replacing it.`);
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
        throw new Error(`${store.backend} index verification failed for ${index.name}.`);
      }
    }
    console.log(`Verified date-range indexes on ${store.backend}.`);
  } finally {
    client.release();
    await pool.end();
  }
}

console.log("Date-range indexes are ready on all four configured databases.");
