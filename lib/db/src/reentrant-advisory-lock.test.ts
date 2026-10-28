import assert from "node:assert/strict";
import test from "node:test";
import { withReentrantAdvisoryLock } from "./reentrant-advisory-lock";

function mockClient() {
  const held = new Set<string>();
  const trace: string[] = [];
  return {
    held,
    trace,
    async query(_query: string, values?: unknown[]) {
      const key = String(values?.[0]);
      if (_query.includes("pg_advisory_lock")) {
        assert.equal(held.has(key), false);
        held.add(key);
        trace.push(`lock:${key}`);
      } else {
        assert.equal(held.has(key), true);
        held.delete(key);
        trace.push(`unlock:${key}`);
      }
      return {};
    },
  };
}

test("two concurrent writes keep nested coordinator locks on one connection per request", async () => {
  const clients = [mockClient(), mockClient()];
  let nextClient = 0;
  let activeConnections = 0;
  let maxConnections = 0;
  const request = async (label: string) => {
    const client = clients[nextClient++];
    activeConnections += 1;
    maxConnections = Math.max(maxConnections, activeConnections);
    try {
      return await withReentrantAdvisoryLock(client, "card-identities", async () =>
        withReentrantAdvisoryLock(client, "card-ledger", async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return label;
        }),
      );
    } finally {
      activeConnections -= 1;
    }
  };

  assert.deepEqual(await Promise.all([request("one"), request("two")]), ["one", "two"]);
  assert.equal(maxConnections, 2, "two overlapping requests should hold only two connections total");
  for (const client of clients) {
    assert.equal(client.held.size, 0, "all advisory locks should be released");
    assert.equal(client.trace.length, 4, "each request should acquire and release two locks on one connection");
  }
});

test("reentrant acquisition of the same lock does not acquire a second session lock", async () => {
  const client = mockClient();
  await withReentrantAdvisoryLock(client, "card-ledger", () =>
    withReentrantAdvisoryLock(client, "card-ledger", async () => "done"),
  );
  assert.deepEqual(client.trace.map((entry) => entry.split(":")[0]), ["lock", "unlock"]);
});
