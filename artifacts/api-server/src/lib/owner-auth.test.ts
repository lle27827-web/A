import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { apiAuthorizationGate, isPublicEmployeeRead, managerRequestAllowed } from "./owner-auth";
import { ownerPermissions } from "./facility-permissions";
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

test("personal routes require a verified session but never require facility ownership", () => {
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
    apiAuthorizationGate(req, res, () => { nextCalled = true; });
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
