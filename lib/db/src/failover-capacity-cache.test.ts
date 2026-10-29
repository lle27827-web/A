import assert from "node:assert/strict";
import test from "node:test";
import { FailoverCapacityCache, FAILOVER_COMPUTE_CACHE_TTL_MS } from "./failover-capacity-cache";

test("failover CU readings remain available for at most ten minutes after API failures", () => {
  const cache = new FailoverCapacityCache();
  cache.setComputeSeconds("database_url", 300_000, 1_000);
  assert.equal(cache.getComputeSeconds("database_url", 1_000 + FAILOVER_COMPUTE_CACHE_TTL_MS), 300_000);
  assert.equal(cache.getComputeSeconds("database_url", 1_001 + FAILOVER_COMPUTE_CACHE_TTL_MS), undefined);
});

test("Neon API failures use bounded exponential backoff and success resets it", () => {
  const cache = new FailoverCapacityCache();
  assert.equal(cache.recordApiFailure("database_url", 1_000), 1_000);
  assert.equal(cache.retryAfterMs("database_url", 1_500), 500);
  assert.equal(cache.recordApiFailure("database_url", 2_000), 2_000);
  assert.equal(cache.retryAfterMs("database_url", 2_500), 1_500);
  cache.setComputeSeconds("database_url", 12_000, 3_000);
  assert.equal(cache.retryAfterMs("database_url", 3_001), 0);
});
