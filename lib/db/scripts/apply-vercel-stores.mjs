import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { resolveConfiguredStores } from "./vercel-stores.mjs";

const dbRoot = fileURLToPath(new URL("../", import.meta.url));
const targetedMigrations = [
  "apply-card-topups.mjs",
  "apply-employee-history.mjs",
  "apply-card-usage-lock.mjs",
  "apply-personal-notebook.mjs",
  "apply-personal-sync.mjs",
  "apply-facility-permissions.mjs",
  "apply-appointments.mjs",
  "apply-card-usage-history.mjs",
  "apply-api-write-operations.mjs",
  "apply-retention-range-indexes.mjs",
];
const redact = (text) =>
  text.replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, "[redacted database URL]");

function runMigration(script, store) {
  const env = { ...process.env, DATABASE_URL: store.url };
  const result = spawnSync(
    process.execPath,
    [`./scripts/${script}`],
    { cwd: dbRoot, env, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.stdout) process.stdout.write(redact(result.stdout));
  if (result.stderr) process.stderr.write(redact(result.stderr));
  if (result.status !== 0) {
    throw new Error(
      `${store.label} migration ${script} failed with exit ${result.status ?? "signal"}.`,
    );
  }
}

async function isCompletelyEmpty(url) {
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 5_000,
  });
  try {
    await client.connect();
    const result = await client.query(`
      SELECT count(*)::int AS count
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename NOT LIKE 'pg_%'
        AND tablename <> 'spatial_ref_sys'
    `);
    return result.rows[0]?.count === 0;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const stores = resolveConfiguredStores(process.env);
if (!stores.some((store) => store.backend === "database_url")) {
  throw new Error("DB2 connection could not be resolved.");
}

for (const store of stores) {
  console.log(`Preparing application schema on ${store.label}.`);
  if (await isCompletelyEmpty(store.url)) {
    console.log(`${store.label} is empty; initializing the reviewed schema.`);
    runMigration("migrations.mjs", store);
  }
  for (const script of targetedMigrations) {
    runMigration(script, store);
  }
}
console.log(`Application schema updates completed on ${stores.length} unique store(s).`);
