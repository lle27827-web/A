import assert from "node:assert/strict";
import test from "node:test";
import {
  BusinessCreationLimitError,
  ensureBusinessCreationCapacity,
  MAX_ACTIVE_BUSINESSES_PER_OWNER,
} from "./business-tenancy";

function clientWithActiveCount(activeCount: number) {
  const sqlCalls: string[] = [];
  return {
    sqlCalls,
    async query(text: string) {
      sqlCalls.push(text.replace(/\s+/g, " ").trim());
      if (text.includes("COUNT(*)")) return { rows: [{ active_count: activeCount }] };
      return { rows: [] };
    },
  };
}

test("business creation takes a per-owner advisory lock and allows below the cap", async () => {
  const client = clientWithActiveCount(MAX_ACTIVE_BUSINESSES_PER_OWNER - 1);
  await ensureBusinessCreationCapacity(client, "verified-user");
  assert.match(client.sqlCalls[0]!, /pg_advisory_xact_lock/);
  assert.match(client.sqlCalls[1]!, /owner_user_id = \$1 AND active = true/);
});

test("business creation stops at ten active businesses for one owner", async () => {
  const client = clientWithActiveCount(MAX_ACTIVE_BUSINESSES_PER_OWNER);
  await assert.rejects(
    ensureBusinessCreationCapacity(client, "verified-user"),
    BusinessCreationLimitError,
  );
});
