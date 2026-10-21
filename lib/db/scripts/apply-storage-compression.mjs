import pg from "pg";

const stores = [
  { label: "DB1", envKey: "NEON_DB1_DIRECT_URL" },
  { label: "DB2", envKey: "NEON_SOURCE_DIRECT_URL" },
  { label: "DB3", envKey: "MIGRATE_DATABASE_URL_3_DIRECT" },
  { label: "DB4", envKey: "MIGRATE_DATABASE_URL_4_DIRECT" },
];
const apply = process.argv.includes("--apply");
const targetCompression = "lz4";

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function poolFor(connectionString, label) {
  return new pg.Pool({
    connectionString,
    application_name: `so-cong-storage-compression-${label.toLowerCase()}`,
    max: 1,
    connectionTimeoutMillis: 8_000,
    idleTimeoutMillis: 1_000,
  });
}

const configured = stores.map((store) => ({
  ...store,
  connectionString: process.env[store.envKey]?.trim(),
}));
const missing = configured.filter((store) => !store.connectionString);
if (missing.length > 0) {
  throw new Error(`Missing direct database URLs for ${missing.map((store) => store.label).join(", ")}.`);
}
if (new Set(configured.map((store) => store.connectionString)).size !== configured.length) {
  throw new Error("The four storage connection variables must point to four distinct connections.");
}

const snapshots = [];
for (const store of configured) {
  const pool = poolFor(store.connectionString, store.label);
  try {
    const result = await pool.query(`
      SELECT current_database() AS database_name,
        current_setting('default_toast_compression') AS current_compression,
        (SELECT enumvals @> ARRAY['lz4']::text[]
         FROM pg_settings WHERE name = 'default_toast_compression') AS lz4_supported
    `);
    const row = result.rows[0];
    if (!row?.lz4_supported) {
      throw new Error(`${store.label} does not report LZ4 support.`);
    }
    snapshots.push({
      ...store,
      databaseName: row.database_name,
      previousCompression: row.current_compression,
    });
  } catch (error) {
    const code = error?.code ? ` (${error.code})` : "";
    throw new Error(`Compression preflight failed for ${store.label}${code}.`);
  } finally {
    await pool.end();
  }
}

for (const snapshot of snapshots) {
  console.log(
    `${snapshot.label}: supports LZ4; current default is ${snapshot.previousCompression}.`,
  );
}

if (!apply) {
  console.log("Read-only check only. Pass --apply to set LZ4 for new database sessions.");
  process.exit(0);
}

const changed = [];
try {
  for (const snapshot of snapshots) {
    if (snapshot.previousCompression === targetCompression) continue;
    const pool = poolFor(snapshot.connectionString, snapshot.label);
    try {
      await pool.query(
        `ALTER DATABASE ${quoteIdentifier(snapshot.databaseName)}
         SET default_toast_compression = '${targetCompression}'`,
      );
      changed.push(snapshot);
      console.log(`${snapshot.label}: LZ4 default configured.`);
    } finally {
      await pool.end();
    }
  }

  for (const snapshot of snapshots) {
    const pool = poolFor(snapshot.connectionString, snapshot.label);
    try {
      const result = await pool.query(
        "SELECT current_setting('default_toast_compression') AS compression",
      );
      if (result.rows[0]?.compression !== targetCompression) {
        throw new Error(`Verification failed for ${snapshot.label}.`);
      }
      console.log(`${snapshot.label}: verified LZ4 on a new connection.`);
    } finally {
      await pool.end();
    }
  }
} catch (error) {
  for (const snapshot of changed.reverse()) {
    const pool = poolFor(snapshot.connectionString, snapshot.label);
    try {
      await pool.query(
        `ALTER DATABASE ${quoteIdentifier(snapshot.databaseName)}
         SET default_toast_compression = '${snapshot.previousCompression}'`,
      );
      console.log(`${snapshot.label}: restored its previous compression default after a failure.`);
    } catch {
      console.error(`${snapshot.label}: automatic restore failed; inspect the database setting.`);
    } finally {
      await pool.end();
    }
  }
  const code = error?.code ? ` (${error.code})` : "";
  throw new Error(`Could not configure and verify LZ4 on all four stores${code}.`);
}
