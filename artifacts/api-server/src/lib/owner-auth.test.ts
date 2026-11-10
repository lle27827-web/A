import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import {
  apiAuthorizationGate,
  createRequirePlatformAdmin,
  isPublicEmployeeRead,
  managerRequestAllowed,
  normalizeApiRoutePath,
} from "./owner-auth";
import { noPermissions, ownerPermissions } from "./facility-permissions";
import { createAsyncTtlCache } from "./user-identity-cache";

function request(method: string, path: string, query: Record<string, unknown> = {}): Request {
  return { method, path, query } as Request;
}

test("guests can read only health and auth status, never employee data", () => {
  for (const path of [
    "/healthz",
    "/auth/status",
  ]) {
    assert.equal(isPublicEmployeeRead(request("GET", path)), true, `${path} should be public`);
  }

  assert.equal(
    isPublicEmployeeRead(request("GET", "/member-payroll", { memberId: "7", month: "2026-10" })),
    false,
  );
  assert.equal(
    isPublicEmployeeRead(request("GET", "/service-sessions", { memberId: "7" })),
    false,
  );
  for (const path of ["/members", "/history-months", "/attendance", "/attendance/summary"]) {
    assert.equal(isPublicEmployeeRead(request("GET", path)), false);
    assert.equal(isPublicEmployeeRead(request("HEAD", path)), false);
  }
});

test("personal routes require a verified session but never require facility ownership", async () => {
  for (const userId of [null, "synthetic_verified_account"]) {
    let status = 200, nextCalled = false;
    const req = {
      method: "GET", path: "/personal/notebook",
      get: (header: string) => header === "host" ? "app.test" : undefined,
      // Simulates the AuthObject produced by Clerk middleware, not a user-supplied field.
      auth: Object.assign(
        () => ({ userId, sessionId: userId ? "synthetic_session" : null, tokenType: "session_token" }),
        { [Symbol.for("@clerk/express.auth")]: true },
      ),
    } as unknown as Request;
    const res = { locals: {}, set() { return this; }, status(code: number) { status = code; return this; }, json() { return this; } } as unknown as Response;
    await apiAuthorizationGate(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, Boolean(userId));
    assert.equal(status, userId ? 200 : 401);
    assert.equal(res.locals.personalUserId, userId ?? undefined);
  }
});

test("guests cannot query cards, facility revenue, or unscoped service sessions", () => {
  for (const path of [
    "/treatment-cards",
    "/service-types",
    "/massage-summary",
    "/payment-details",
    "/member-payroll",
    "/service-sessions",
  ]) {
    assert.equal(isPublicEmployeeRead(request("GET", path)), false, `${path} should be private`);
  }

  assert.equal(
    isPublicEmployeeRead(request("GET", "/service-sessions", { memberId: "7", cardId: "3" })),
    false,
  );
  assert.equal(
    isPublicEmployeeRead(request("GET", "/member-payroll", { month: "2026-10" })),
    false,
  );
});

test("payment transaction details require the revenue grant", async () => {
  const none = noPermissions();
  assert.equal(await managerRequestAllowed(request("GET", "/payment-details"), none), false);
  assert.equal(await managerRequestAllowed(request("GET", "/payment-details"), { ...none, viewRevenue: true }), true);
  assert.equal(await managerRequestAllowed(request("POST", "/payment-details"), { ...none, viewRevenue: true }), false);
});

test("all guest write methods remain private", () => {
  assert.equal(isPublicEmployeeRead(request("POST", "/members")), false);
  assert.equal(isPublicEmployeeRead(request("PATCH", "/attendance/4")), false);
  assert.equal(isPublicEmployeeRead(request("DELETE", "/service-sessions/12")), false);
});

test("yearly history deletion is reserved for the owner", async () => {
  const maximumManagerPermissions = ownerPermissions();
  assert.equal(await managerRequestAllowed(request("GET", "/retention/years"), maximumManagerPermissions), false);
  assert.equal(await managerRequestAllowed(request("DELETE", "/retention/years/2025"), maximumManagerPermissions), false);
  assert.equal(await managerRequestAllowed(request("GET", "/retention/range"), maximumManagerPermissions), false);
  assert.equal(await managerRequestAllowed(request("DELETE", "/retention/range"), maximumManagerPermissions), false);
});

test("database failover status and promotion are reserved for the owner", async () => {
  const maximumManagerPermissions = ownerPermissions();
  assert.equal(await managerRequestAllowed(request("GET", "/database/failover"), maximumManagerPermissions), false);
  assert.equal(await managerRequestAllowed(request("POST", "/database/failover"), maximumManagerPermissions), false);
});

test("platform database guard rejects an owner and admits only a verified platform administrator", async () => {
  const statusBase = {
    authConfigured: true,
    authenticated: true,
    isOwner: true,
    isPlatformAdmin: false,
    userId: "owner-user",
    email: "owner@example.com",
    businessId: "business-id",
    businessName: "Example",
    role: "owner" as const,
    businesses: [],
    permissions: ownerPermissions(),
    businessAccessAvailable: true,
  };
  const runGuard = async (isPlatformAdmin: boolean) => {
    let statusCode = 200;
    let nextCalled = false;
    const status = { ...statusBase, isPlatformAdmin };
    const req = {
      get: (name: string) => name.toLowerCase() === "host" ? "app.test" : undefined,
      log: undefined,
    } as unknown as Request;
    const res = {
      locals: {},
      status(code: number) { statusCode = code; return this; },
      json() { return this; },
    } as unknown as Response;
    const guard = createRequirePlatformAdmin({
      authConfigured: () => true,
      loadStatus: async () => status,
    });
    await guard(req, res, () => { nextCalled = true; });
    return { statusCode, nextCalled, attachedStatus: res.locals.facilityAuth };
  };

  const owner = await runGuard(false);
  assert.equal(owner.statusCode, 403);
  assert.equal(owner.nextCalled, false);
  const admin = await runGuard(true);
  assert.equal(admin.statusCode, 200);
  assert.equal(admin.nextCalled, true);
  assert.ok(admin.attachedStatus);
});

test("authorization paths are case-insensitive and ignore trailing or repeated slashes", async () => {
  assert.equal(normalizeApiRoutePath("/Retention//cleanup/"), "/retention/cleanup");
  assert.equal(normalizeApiRoutePath("/PERSONAL/comparison/"), "/personal/comparison");
  const permissions = { ...ownerPermissions(), viewRevenue: true };
  assert.equal(await managerRequestAllowed(request("GET", "/PAYMENT-DETAILS/"), permissions), true);
});

test("cron cleanup path variants are checked and missing authorization is rejected", async () => {
  const previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-cron-secret";
  try {
    for (const path of ["/retention/cleanup", "/Retention/cleanup", "/retention/cleanup/"]) {
      let statusCode = 200;
      let nextCalled = false;
      const req = {
        method: "GET",
        path,
        get: (name: string) => name.toLowerCase() === "host" ? "app.test" : undefined,
      } as unknown as Request;
      const res = {
        set() { return this; },
        status(code: number) { statusCode = code; return this; },
        json() { return this; },
      } as unknown as Response;
      await apiAuthorizationGate(req, res, () => { nextCalled = true; });
      assert.equal(statusCode, 401, path);
      assert.equal(nextCalled, false, path);
    }
  } finally {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  }
});

test("employee bonus pay configuration is reserved for the owner", async () => {
  const maximumManagerPermissions = ownerPermissions();
  assert.equal(await managerRequestAllowed(request("GET", "/employee-bonus-config"), maximumManagerPermissions), false);
  assert.equal(await managerRequestAllowed(request("PATCH", "/employee-bonus-config"), maximumManagerPermissions), false);
});

test("Clerk identity cache coalesces fetches, bounds entries, and evicts failed lookups", async () => {
  const cache = createAsyncTtlCache<string>(60_000, 2);
  let loads = 0;
  const load = async () => { loads += 1; return "verified@example.com"; };

  const [first, concurrent] = await Promise.all([
    cache.get("user-1", load),
    cache.get("user-1", load),
  ]);
  assert.equal(first, "verified@example.com");
  assert.equal(concurrent, first);
  assert.equal(loads, 1);

  await cache.get("user-2", async () => "two");
  await cache.get("user-3", async () => "three");
  assert.equal(cache.size, 2);
  assert.equal(await cache.get("user-1", load), "verified@example.com");
  assert.equal(loads, 2, "least recently used identity should be evicted");

  let failedLoads = 0;
  const failingLookup = async () => {
    failedLoads += 1;
    throw new Error("temporary Clerk failure");
  };
  await assert.rejects(cache.get("failed-user", failingLookup));
  await assert.rejects(cache.get("failed-user", failingLookup));
  assert.equal(failedLoads, 2, "failed identity lookups must be retried, not cached");
});
