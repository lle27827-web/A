import assert from "node:assert/strict";
import test from "node:test";
import { isValidRetentionCronAuthorization, retentionCronAuthorizationStatus } from "./retention-auth";

test("retention cron authorization requires the configured bearer secret", () => {
  assert.equal(isValidRetentionCronAuthorization(undefined, "secret"), false);
  assert.equal(isValidRetentionCronAuthorization("Bearer wrong", "secret"), false);
  assert.equal(isValidRetentionCronAuthorization("secret", "secret"), false);
  assert.equal(isValidRetentionCronAuthorization("Bearer secret", undefined), false);
  assert.equal(isValidRetentionCronAuthorization("Bearer secret", "secret"), true);
});

test("cron endpoint status denies a missing authorization header and a missing secret", () => {
  assert.equal(retentionCronAuthorizationStatus(undefined, "secret"), 401);
  assert.equal(retentionCronAuthorizationStatus("Bearer secret", undefined), 503);
  assert.equal(retentionCronAuthorizationStatus("Bearer secret", "secret"), 200);
});
