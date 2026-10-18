import assert from "node:assert/strict";
import test from "node:test";
import { isValidRetentionCronAuthorization } from "./retention-auth";

test("retention cron authorization requires the configured bearer secret", () => {
  assert.equal(isValidRetentionCronAuthorization(undefined, "secret"), false);
  assert.equal(isValidRetentionCronAuthorization("Bearer wrong", "secret"), false);
  assert.equal(isValidRetentionCronAuthorization("secret", "secret"), false);
  assert.equal(isValidRetentionCronAuthorization("Bearer secret", undefined), false);
  assert.equal(isValidRetentionCronAuthorization("Bearer secret", "secret"), true);
});
