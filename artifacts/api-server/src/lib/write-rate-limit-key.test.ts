import assert from "node:assert/strict";
import test from "node:test";
import { writeRateLimitKey } from "./write-rate-limit-key";

test("write rate limits follow the signed-in account and use IP only as a fallback", () => {
  assert.equal(writeRateLimitKey(" Owner@Example.com ", "192.0.2.1"), "account:owner@example.com");
  assert.equal(writeRateLimitKey(null, "192.0.2.1"), "ip:192.0.2.1");
  assert.equal(writeRateLimitKey(undefined, undefined), "ip:unknown");
});
