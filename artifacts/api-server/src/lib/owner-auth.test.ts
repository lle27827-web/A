import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { apiAuthorizationGate, isPublicEmployeeRead } from "./owner-auth";

function request(method: string, path: string, query: Record<string, unknown> = {}): Request {
  return { method, path, query } as Request;
}

test("guest reads are limited to employee-management endpoints", () => {
  for (const path of [
    "/healthz",
    "/auth/status",
    "/history-months",
    "/members",
    "/attendance",
    "/attendance/summary",
  ]) {
    assert.equal(isPublicEmployeeRead(request("GET", path)), true, `${path} should be public`);
  }

  assert.equal(
    isPublicEmployeeRead(request("GET", "/member-payroll", { memberId: "7", month: "2026-10" })),
    true,
  );
  assert.equal(
    isPublicEmployeeRead(request("GET", "/service-sessions", { memberId: "7" })),
    true,
  );
  assert.equal(isPublicEmployeeRead(request("HEAD", "/members")), true);
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
