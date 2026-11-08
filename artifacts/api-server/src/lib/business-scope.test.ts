import assert from "node:assert/strict";
import test from "node:test";
import type { Response } from "express";
import { currentFacilityBusinessId } from "./owner-auth";

function responseWithFacilityAuth(facilityAuth: unknown): Response {
  return { locals: { facilityAuth } } as unknown as Response;
}

test("facility queries use the business selected by verified server-side auth", () => {
  const response = responseWithFacilityAuth({
    authenticated: true,
    businessId: "tenant-verified-by-membership",
  });

  assert.equal(currentFacilityBusinessId(response), "tenant-verified-by-membership");
});

test("facility queries fail closed instead of falling back to the legacy default tenant", () => {
  assert.throws(
    () => currentFacilityBusinessId(responseWithFacilityAuth({ authenticated: true, businessId: null })),
    /Verified business scope is required/,
  );
  assert.throws(
    () => currentFacilityBusinessId(responseWithFacilityAuth(undefined)),
    /Verified business scope is required/,
  );
});

test("a business ID alone is not authorization when the session is unauthenticated", () => {
  assert.throws(
    () => currentFacilityBusinessId(responseWithFacilityAuth({
      authenticated: false,
      businessId: "tenant-verified-by-membership",
    })),
    /Verified business scope is required/,
  );
});

test("a client-supplied tenant value cannot replace the verified facility scope", () => {
  const response = {
    locals: {
      businessId: "tenant-from-client",
      facilityAuth: { authenticated: true, businessId: "tenant-verified-by-membership" },
    },
  } as unknown as Response;

  assert.equal(currentFacilityBusinessId(response), "tenant-verified-by-membership");
});
