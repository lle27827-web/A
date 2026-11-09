import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadMigrations } from "./migrations.mjs";

test("API idempotency migration is appended and matches the declared schema", async () => {
  const migrations = await loadMigrations();
  const migration = migrations.find(({ tag }) => tag === "0012_api_write_operations");
  assert.ok(migration);
  assert.equal(migration.idx, migrations.length - 1);
  assert.match(migration.sql, /ADD COLUMN IF NOT EXISTS "granted_by" text/);
  assert.match(migration.sql, /CREATE TABLE IF NOT EXISTS "api_write_operations"/);
  assert.match(migration.sql, /"operation_id" uuid PRIMARY KEY NOT NULL/);
  assert.match(migration.sql, /"request_hash" text NOT NULL/);
  assert.match(migration.sql, /"result" jsonb NOT NULL/);
  assert.match(migration.sql, /"created_at" timestamp with time zone DEFAULT now\(\) NOT NULL/);
});

test("business tenancy migration adds durable join-attempt storage idempotently on the registry", async () => {
  const script = await readFile(new URL("./apply-business-tenancy.mjs", import.meta.url), "utf8");
  assert.match(script, /CREATE TABLE IF NOT EXISTS public\.business_join_attempts/);
  assert.match(script, /CREATE INDEX IF NOT EXISTS business_join_attempts_key_time_idx/);
  assert.match(script, /CREATE INDEX IF NOT EXISTS business_join_attempts_time_idx/);
  assert.match(script, /if \(store\.backend === "database_url_4"\) \{\s*await client\.query\(registrySql\)/);
  assert.match(script, /id uuid PRIMARY KEY,\s*key_hash text NOT NULL,\s*attempted_at timestamptz NOT NULL DEFAULT now\(\)/);
});

test("Vercel preflight verifies tenant scope columns and scoped indexes on every data store", async () => {
  const verifier = await readFile(new URL("./verify-vercel-stores.mjs", import.meta.url), "utf8");
  assert.match(verifier, /const tenantTables = \[/);
  assert.match(verifier, /column === "business_id"/);
  assert.match(verifier, /expected NOT NULL text/);
  assert.match(verifier, /_business_id_idx/);
  assert.match(verifier, /manager_grants_business_email_unique/);
  assert.match(verifier, /employee_service_bonus_rates_member_service_uidx/);
});

test("Vercel preflight does not query the disabled whole-database failover state", async () => {
  const verifier = await readFile(new URL("./verify-vercel-stores.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(verifier, /verifyFailoverState|db_failover_state|switch_started_at/);
});
