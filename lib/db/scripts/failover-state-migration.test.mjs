import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationScripts = [
  "apply-database-failover-state.mjs",
  "apply-database-failover-state-to-db4.mjs",
  "apply-database-failover-coordinator.mjs",
];
const recoveryColumns = [
  "switch_started_at",
  "switch_source_backend",
  "switch_target_backend",
  "manual_recovery_required",
];

test("failover recovery migrations are idempotent and preserve interrupted switch context", async () => {
  for (const scriptName of migrationScripts) {
    const sql = await readFile(new URL(scriptName, import.meta.url), "utf8");
    for (const column of recoveryColumns) {
      assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`), scriptName);
      assert.match(sql, new RegExp(`\\["${column}"`), scriptName);
    }
    assert.match(sql, /manual_recovery_required = true/);
    assert.match(sql, /active_backend = 'switching'/);
  }
});

test("the DB2 failover-state migration uses the numbered DB2 variable on Vercel", async () => {
  const script = await readFile(
    new URL("apply-database-failover-state.mjs", import.meta.url),
    "utf8",
  );
  assert.match(script, /process\.env\.DATABASE_URL_2/);
  assert.match(script, /process\.env\.VERCEL !== "1" \? process\.env\.DATABASE_URL/);
  assert.match(script, /DATABASE_URL_2 must be set for the DB2 failover-state migration/);
});
