import assert from "node:assert/strict";
import test from "node:test";
import { PartitionReadCache } from "./partition-read-cache";

test("partition read cache expires quickly and invalidates only changed tables", () => {
  const cache = new PartitionReadCache(3_000);
  cache.set("members", "{}", [{ id: 1 }], 1_000);
  cache.set("attendance", "{}", [{ id: 2 }], 1_000);
  assert.deepEqual(cache.get("members", "{}", 3_999), [{ id: 1 }]);
  assert.equal(cache.get("members", "{}", 4_000), undefined);
  cache.set("members", "{}", [{ id: 3 }], 4_000);
  cache.invalidate(["members"]);
  assert.equal(cache.get("members", "{}"), undefined);
  assert.deepEqual(cache.get("attendance", "{}", 3_999), [{ id: 2 }]);
});

test("partition cache returns cloned rows so consumer sorting cannot mutate cached data", () => {
  const cache = new PartitionReadCache();
  const original = [{ id: 2 }, { id: 1 }];
  cache.set("members", "{}", original);
  const read = cache.get<{ id: number }>("members", "{}")!;
  read.sort((a, b) => a.id - b.id);
  assert.deepEqual(cache.get("members", "{}"), original);
});
