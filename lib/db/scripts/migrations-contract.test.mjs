import assert from "node:assert/strict";
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
