import test from "node:test";
import assert from "node:assert/strict";
import { resolveSubscriptionAccess } from "./subscription-access";

const now = Date.parse("2026-11-12T00:00:00.000Z");

test("billing toggle off preserves app access while leaving manual revocation in force", () => {
  assert.equal(resolveSubscriptionAccess(null, false, now).accessAllowed, true);
  assert.equal(resolveSubscriptionAccess({ manual_access: false }, false, now).accessAllowed, false);
});

test("first verified login gets a 30-day trial and expiry blocks access", () => {
  assert.equal(
    resolveSubscriptionAccess({ trial_ends_at: new Date(now + 1_000) }, true, now).status,
    "trial",
  );
  assert.equal(
    resolveSubscriptionAccess({ trial_ends_at: new Date(now - 1_000) }, true, now).status,
    "expired",
  );
});

test("paid and manual grants allow access; manual deny overrides paid time", () => {
  assert.equal(
    resolveSubscriptionAccess({ paid_until: new Date(now + 1_000) }, true, now).status,
    "paid",
  );
  assert.equal(
    resolveSubscriptionAccess({ manual_access: true, trial_ends_at: new Date(now - 1_000) }, true, now).status,
    "manual",
  );
  assert.equal(
    resolveSubscriptionAccess({ manual_access: false, paid_until: new Date(now + 1_000) }, true, now).status,
    "blocked",
  );
});

test("missing trial remains accessible until first verified login can start it", () => {
  const access = resolveSubscriptionAccess(null, true, now);
  assert.equal(access.status, "free");
  assert.equal(access.accessAllowed, true);
});
