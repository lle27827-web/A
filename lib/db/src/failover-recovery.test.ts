import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateStaleFailoverRecovery,
  FAILOVER_SWITCH_STALE_AFTER_MS,
  getForcedFailoverBlocker,
} from "./failover-recovery";

const configuredBackends = [
  { backend: "database_url_1" },
  { backend: "database_url" },
  { backend: "database_url_3" },
] as const;

function decision(overrides: Partial<Parameters<typeof evaluateStaleFailoverRecovery>[0]> = {}) {
  return evaluateStaleFailoverRecovery({
    now: 1_000_000,
    startedAt: 1_000_000 - FAILOVER_SWITCH_STALE_AFTER_MS - 1,
    sourceBackend: "database_url",
    targetBackend: "database_url_3",
    manualRecoveryRequired: false,
    sourceReachable: true,
    forwardSubscriptionEnabled: true,
    reverseSubscriptionEnabled: false,
    configuredBackends,
    ...overrides,
  });
}

test("stale interrupted switching restores source only after safe checks", () => {
  assert.equal(decision().action, "restore_source");
});

test("recent, unreachable, non-adjacent, or ambiguous switches do not auto-restore", () => {
  assert.equal(decision({ startedAt: 1_000_000 - 1_000 }).action, "wait");
  assert.equal(decision({ sourceReachable: false }).action, "manual");
  assert.equal(decision({ reverseSubscriptionEnabled: true }).action, "manual");
  assert.equal(decision({ forwardSubscriptionEnabled: null }).action, "manual");
  assert.equal(decision({ targetBackend: "database_url_4" }).action, "manual");
  assert.equal(decision({ manualRecoveryRequired: true }).action, "manual");
});

test("forced promotion requires explicit production enablement, a failed source probe, and a healthy adjacent target", () => {
  const preflight = {
    enabled: true,
    production: true,
    sourceBackend: "database_url" as const,
    targetBackend: "database_url_3" as const,
    configuredBackends,
    coordinatorAvailable: true,
    independentCoordinator: false,
    coordinatorBackend: "database_url_4" as const,
    sourceReachable: false,
    targetReachable: true,
    targetHasCapacity: true,
  };
  assert.equal(getForcedFailoverBlocker(preflight), null);
  assert.match(
    getForcedFailoverBlocker({ ...preflight, enabled: false }) ?? "",
    /chưa được bật/,
  );
  assert.match(
    getForcedFailoverBlocker({ ...preflight, sourceReachable: true }) ?? "",
    /vẫn phản hồi/,
  );
  assert.match(
    getForcedFailoverBlocker({ ...preflight, coordinatorBackend: "database_url" }) ?? "",
    /bộ điều phối/,
  );
  assert.match(
    getForcedFailoverBlocker({ ...preflight, targetHasCapacity: false }) ?? "",
    /dung lượng và CU/,
  );
});
