import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadMigrations } from "./migrations.mjs";

test("API idempotency migration remains intact before the later audit migration", async () => {
  const migrations = await loadMigrations();
  const migration = migrations.find(({ tag }) => tag === "0012_api_write_operations");
  assert.ok(migration);
  assert.equal(migration.idx, migrations.length - 2);
  assert.match(migration.sql, /ADD COLUMN IF NOT EXISTS "granted_by" text/);
  assert.match(migration.sql, /CREATE TABLE IF NOT EXISTS "api_write_operations"/);
  assert.match(migration.sql, /"operation_id" uuid PRIMARY KEY NOT NULL/);
  assert.match(migration.sql, /"request_hash" text NOT NULL/);
  assert.match(migration.sql, /"result" jsonb NOT NULL/);
  assert.match(migration.sql, /"created_at" timestamp with time zone DEFAULT now\(\) NOT NULL/);
});

test("audit log migration is additive and indexes each business's history", async () => {
  const migrations = await loadMigrations();
  const migration = migrations.find(({ tag }) => tag === "0013_audit_logs");
  assert.ok(migration);
  assert.equal(migration.idx, migrations.length - 1);
  assert.match(migration.sql, /CREATE TABLE IF NOT EXISTS "audit_logs"/);
  assert.match(migration.sql, /"business_id" text NOT NULL/);
  assert.match(migration.sql, /"actor_email" text/);
  assert.match(migration.sql, /"before_json" jsonb/);
  assert.match(migration.sql, /"after_json" jsonb/);
  assert.match(migration.sql, /audit_logs_business_created_idx/);
});

test("business tenancy migration adds durable join-attempt storage idempotently on the registry", async () => {
  const script = await readFile(new URL("./apply-business-tenancy.mjs", import.meta.url), "utf8");
  assert.match(script, /CREATE TABLE IF NOT EXISTS public\.business_join_attempts/);
  assert.match(script, /ALTER TABLE public\.businesses[\s\S]*ADD COLUMN IF NOT EXISTS facility_phone text NOT NULL DEFAULT ''/);
  assert.match(script, /ADD COLUMN IF NOT EXISTS print_profile_updated_at timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(script, /CREATE INDEX IF NOT EXISTS business_join_attempts_key_time_idx/);
  assert.match(script, /CREATE INDEX IF NOT EXISTS business_join_attempts_time_idx/);
  assert.match(script, /if \(store\.backend === "database_url_4"\) \{\s*await client\.query\(registrySql\)/);
  assert.match(script, /id uuid PRIMARY KEY,\s*key_hash text NOT NULL,\s*attempted_at timestamptz NOT NULL DEFAULT now\(\)/);
});

test("business tenancy owner backfill deduplicates users before upsert", async () => {
  const script = await readFile(new URL("./apply-business-tenancy.mjs", import.meta.url), "utf8");
  assert.match(
    script,
    /INSERT INTO public\.business_users \(user_id, email\)\s+SELECT owner_user_id, lower\(min\(btrim\(owner_email\)\)\)\s+FROM public\.businesses\s+WHERE owner_user_id <> '' AND owner_user_id NOT LIKE 'pending-owner:%'\s+GROUP BY owner_user_id\s+ON CONFLICT \(user_id\) DO UPDATE/,
  );
});

test("night-pricing singleton seed works with tenant-scoped composite primary keys", async () => {
  const script = await readFile(new URL("./apply-facility-night-pricing.mjs", import.meta.url), "utf8");
  assert.match(
    script,
    /INSERT INTO public\.facility_night_settings[\s\S]*?ON CONFLICT DO NOTHING/,
  );
  assert.doesNotMatch(
    script,
    /INSERT INTO public\.facility_night_settings[\s\S]*?ON CONFLICT\s*\(id\)/,
  );
});

test("Vercel preflight verifies tenant scope columns and scoped indexes on every data store", async () => {
  const verifier = await readFile(new URL("./verify-vercel-stores.mjs", import.meta.url), "utf8");
  assert.match(verifier, /const tenantTables = \[/);
  assert.match(verifier, /column === "business_id"/);
  assert.match(verifier, /expected NOT NULL text/);
  assert.match(verifier, /_business_id_idx/);
  assert.match(verifier, /manager_grants_business_email_unique/);
  assert.match(verifier, /employee_service_bonus_rates_member_service_uidx/);
  assert.match(verifier, /businesses\.facility_phone/);
  assert.match(verifier, /businesses\.print_profile_updated_at/);
});

test("Vercel preflight does not query the disabled whole-database failover state", async () => {
  const verifier = await readFile(new URL("./verify-vercel-stores.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(verifier, /verifyFailoverState|db_failover_state|switch_started_at/);
});
