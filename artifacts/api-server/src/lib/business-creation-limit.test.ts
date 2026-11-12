import assert from "node:assert/strict";
import test from "node:test";
import {
  BusinessCreationLimitError,
  ensureBusinessCreationCapacity,
  MAX_BUSINESSES_PER_OWNER,
} from "./business-tenancy";

function clientWithActiveCount(activeCount: number) {
  const sqlCalls: string[] = [];
  return {
    sqlCalls,
    async query(text: string) {
      sqlCalls.push(text.replace(/\s+/g, " ").trim());
      if (text.includes("COUNT(*)")) return { rows: [{ owned_count: activeCount }] };
      return { rows: [] };
    },
  };
}

test("business creation takes a per-owner advisory lock and allows the first business", async () => {
  const client = clientWithActiveCount(MAX_BUSINESSES_PER_OWNER - 1);
  await ensureBusinessCreationCapacity(client, "verified-user");
  assert.match(client.sqlCalls[0]!, /pg_advisory_xact_lock/);
  assert.match(client.sqlCalls[1]!, /owner_user_id = \$1/);
  assert.doesNotMatch(client.sqlCalls[1]!, /active = true/);
});

test("business creation stops after one owned business", async () => {
  const client = clientWithActiveCount(MAX_BUSINESSES_PER_OWNER);
  await assert.rejects(
    ensureBusinessCreationCapacity(client, "verified-user"),
    BusinessCreationLimitError,
  );
});

test("inactive owned businesses still count toward the one-business limit", async () => {
  const client = clientWithActiveCount(1);
  await assert.rejects(
    ensureBusinessCreationCapacity(client, "verified-user"),
    BusinessCreationLimitError,
  );
  assert.doesNotMatch(client.sqlCalls[1]!, /active = true/);
});
