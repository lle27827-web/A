import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  APPLICATION_TABLES, REVIEWED_MIGRATION_COUNT, applySql, catalogDifferences, quoteIdentifier,
  readCatalog, referenceProfiles, verifyBackfills,
} from "./migration-catalog.mjs";

export async function loadMigrations() {
  const dir = new URL("../drizzle/", import.meta.url);
  const journal = JSON.parse(await readFile(new URL("meta/_journal.json", dir), "utf8"));
  const migrations = [];
  for (const [index, entry] of journal.entries.entries()) {
    if (entry.idx !== index || !/^[0-9]{4}_[a-z0-9_]+$/.test(entry.tag)
      || !Number.isSafeInteger(entry.when) || entry.when <= (migrations.at(-1)?.when ?? 0)) {
      throw new Error("Invalid migration ordering or filename in meta/_journal.json.");
    }
    const sql = await readFile(new URL(`${entry.tag}.sql`, dir), "utf8");
    migrations.push({ ...entry, sql, hash: createHash("sha256").update(sql).digest("hex") });
  }
  return migrations;
}

export function validateJournal(rows, migrations) {
  for (const [index, row] of rows.entries()) {
    if (row.hash !== migrations[index]?.hash || Number(row.created_at) !== migrations[index]?.when) {
      throw new Error(`Migration journal is not an exact contiguous prefix at row ${index + 1}; no changes made.`);
    }
  }
}

// schema/journalSchema overrides are for isolated integration tests, not CLI options.
export async function runMigrations(client, {
  mode = "migrate", schema = "public", journalSchema = "drizzle", migrations,
} = {}) {
  if (!["migrate", "audit", "baseline"].includes(mode)) throw new Error("Expected migrate, audit or baseline.");
  migrations ??= await loadMigrations();
  const q = quoteIdentifier;
  const journalTable = `${q(journalSchema)}."__drizzle_migrations"`;
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('so-cong:migrations', 0))");
    let actual = await readCatalog(client, schema);
    const present = APPLICATION_TABLES.filter((table) => actual[`table:${table}`]);
    if (mode !== "audit") {
      const tables = present.filter((table) => ["r", "p"].includes(actual[`table:${table}`].kind));
      if (tables.length) {
        await client.query(`LOCK TABLE ${tables.map((table) => `${q(schema)}.${q(table)}`).join(", ")} IN SHARE MODE`);
        actual = await readCatalog(client, schema);
      }
    }
    const exists = await client.query("SELECT to_regclass($1) IS NOT NULL AS exists", [journalTable]);
    const rows = exists.rows[0].exists
      ? (await client.query(`SELECT id, hash, created_at FROM ${journalTable} ORDER BY created_at, id`)).rows : [];
    validateJournal(rows, migrations);
    if (mode === "migrate" && !rows.length && present.length) {
      throw new Error("Existing application tables have no migration baseline. Run migrate:audit, then migrate:baseline only after reviewing equivalence. No application data or migration history changed.");
    }
    let verifiedIndex = -1;
    let differences = [];
    if (mode !== "migrate" || (rows.length > 0 && rows.length <= REVIEWED_MIGRATION_COUNT)) {
      const profiles = await referenceProfiles(client, migrations);
      const audits = profiles.map(({ catalog }, index) => ({ index, differences: catalogDifferences(catalog, actual) }));
      verifiedIndex = audits.findLast((audit) => !audit.differences.length)?.index ?? -1;
      differences = audits.sort((a, b) => a.differences.length - b.differences.length)[0]?.differences ?? [];
      if (verifiedIndex >= 0) await verifyBackfills(client, schema, verifiedIndex);
      if (mode === "baseline" && verifiedIndex < rows.length - 1) {
        throw new Error(`Schema cannot be baselined: ${differences.join("; ")}`);
      }
      if (mode === "migrate" && verifiedIndex !== rows.length - 1) {
        throw new Error(`Schema differs from its recorded migration state. Audit before upgrading: ${differences.join("; ") || "targeted changes require an explicit verified baseline"}`);
      }
    }
    const result = {
      mode, applicationTables: present.length, journalEntriesBefore: rows.length,
      equivalentThrough: verifiedIndex >= 0 ? migrations[verifiedIndex].tag : null,
      differences, recorded: [], applied: [],
    };
    if (mode === "audit") {
      await client.query("ROLLBACK");
      return result;
    }
    if (mode === "baseline" && verifiedIndex < 0) {
      throw new Error(`No reviewed schema matches; baseline refused: ${differences.join("; ")}`);
    }
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${q(journalSchema)}`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${journalTable} (
      id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint
    )`);
    const pending = mode === "baseline"
      ? migrations.slice(rows.length, verifiedIndex + 1) : migrations.slice(rows.length);
    for (const migration of pending) {
      if (mode === "migrate") {
        await applySql(client, migration.sql, schema);
        result.applied.push(migration.tag);
      } else result.recorded.push(migration.tag);
      await client.query(`INSERT INTO ${journalTable} (hash,created_at) VALUES ($1,$2)`, [migration.hash, migration.when]);
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2] ?? "migrate";
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
  let client;
  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
    client = await pool.connect();
    console.log(JSON.stringify(await runMigrations(client, { mode }), null, 2));
  } catch (error) {
    console.error(`Migration stopped: ${error.message.replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted connection]")}`);
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool.end();
  }
}
