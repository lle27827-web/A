import assert from "node:assert/strict";
import test from "node:test";
import {
  BusinessLeaveError,
  performEmployeeBusinessLeave,
  type BusinessLeaveDependencies,
  type BusinessLeaveGrant,
  type BusinessLeaveMembership,
} from "./business-leave-policy";

const input = {
  businessId: "business-a",
  selectedBusinessId: "business-a",
  userId: "employee-1",
  email: " EMPLOYEE@example.com ",
  role: "employee",
  isOwner: false,
  isPlatformAdmin: false,
  operationId: "leave-operation",
};

function fixture(options?: { membership?: BusinessLeaveMembership | null; grant?: BusinessLeaveGrant | null }) {
  const selectedMembership = options && "membership" in options
    ? options.membership ?? null
    : { role: "employee" as const, active: true };
  const selectedGrant = options && "grant" in options
    ? options.grant ?? null
    : { id: 11 };
  const memberships = new Map<string, BusinessLeaveMembership>([
    ...(selectedMembership ? [["business-a", selectedMembership] as const] : []),
    ["business-b", { role: "employee", active: true }],
  ]);
  const grants = new Map<string, BusinessLeaveGrant>([
    ...(selectedGrant ? [["business-a", selectedGrant] as const] : []),
    ["business-b", { id: 22 }],
  ]);
  const calls: string[] = [];
  const dependencies: BusinessLeaveDependencies = {
    findMembership: async (businessId) => memberships.get(businessId) ?? null,
    findGrant: async (businessId) => grants.get(businessId) ?? null,
    revokeGrant: async ({ businessId, email, grantId, operationId }) => {
      calls.push(`revoke:${businessId}:${email}:${grantId}:${operationId}`);
      grants.delete(businessId);
    },
    deactivateMembership: async (businessId) => {
      calls.push(`deactivate:${businessId}`);
      const membership = memberships.get(businessId);
      if (!membership || !membership.active) return false;
      memberships.set(businessId, { ...membership, active: false });
      return true;
    },
  };
  return { dependencies, memberships, grants, calls };
}

test("employee leave removes only the selected business grant and membership", async () => {
  const state = fixture();
  await performEmployeeBusinessLeave(input, state.dependencies);

  assert.deepEqual(state.calls, [
    "revoke:business-a:employee@example.com:11:leave-operation",
    "deactivate:business-a",
  ]);
  assert.deepEqual(state.memberships.get("business-a"), { role: "employee", active: false });
  assert.deepEqual(state.memberships.get("business-b"), { role: "employee", active: true });
  assert.equal(state.grants.has("business-a"), false);
  assert.equal(state.grants.get("business-b")?.id, 22);
  assert.equal(state.calls.some((call) => call.includes("delete-business-data")), false);
});

test("owner, platform-admin, and non-selected business leave attempts are rejected before mutation", async () => {
  const state = fixture();
  await assert.rejects(
    performEmployeeBusinessLeave({ ...input, role: "owner", isOwner: true }, state.dependencies),
    (error) => error instanceof BusinessLeaveError && error.statusCode === 409,
  );
  await assert.rejects(
    performEmployeeBusinessLeave({ ...input, isPlatformAdmin: true }, state.dependencies),
    (error) => error instanceof BusinessLeaveError && error.statusCode === 403,
  );
  await assert.rejects(
    performEmployeeBusinessLeave({ ...input, businessId: "business-b" }, state.dependencies),
    (error) => error instanceof BusinessLeaveError && error.statusCode === 403,
  );
  assert.deepEqual(state.calls, []);
  assert.equal(state.grants.size, 2);
});

test("a registry owner membership cannot be left even if the request says employee", async () => {
  const state = fixture({ membership: { role: "owner", active: true } });
  await assert.rejects(
    performEmployeeBusinessLeave(input, state.dependencies),
    (error) => error instanceof BusinessLeaveError && error.statusCode === 409,
  );
  assert.deepEqual(state.calls, []);
});

test("legacy grant-only access can be revoked without touching another membership", async () => {
  const state = fixture({ membership: null });
  await performEmployeeBusinessLeave(input, state.dependencies);
  assert.deepEqual(state.calls, [
    "revoke:business-a:employee@example.com:11:leave-operation",
  ]);
  assert.deepEqual(state.memberships.get("business-b"), { role: "employee", active: true });
  assert.equal(state.grants.get("business-b")?.id, 22);
});

test("a partial leave is retryable after grant revocation without restoring the grant", async () => {
  const state = fixture();
  state.dependencies.deactivateMembership = async () => {
    state.calls.push("deactivate-failed");
    throw new Error("temporary registry failure");
  };
  await assert.rejects(performEmployeeBusinessLeave(input, state.dependencies), /temporary registry failure/);
  assert.equal(state.grants.has("business-a"), false, "the management grant stays revoked");
  assert.deepEqual(state.memberships.get("business-a"), { role: "employee", active: true });

  state.dependencies.deactivateMembership = async (businessId) => {
    state.calls.push(`deactivate:${businessId}`);
    const membership = state.memberships.get(businessId);
    if (!membership || !membership.active) return false;
    state.memberships.set(businessId, { ...membership, active: false });
    return true;
  };
  await performEmployeeBusinessLeave(input, state.dependencies);
  assert.deepEqual(state.memberships.get("business-a"), { role: "employee", active: false });
  assert.equal(state.grants.has("business-a"), false);
  assert.deepEqual(state.memberships.get("business-b"), { role: "employee", active: true });
});

test("no active membership or grant returns not found and performs no deletion", async () => {
  const state = fixture({ membership: null, grant: null });
  await assert.rejects(
    performEmployeeBusinessLeave(input, state.dependencies),
    (error) => error instanceof BusinessLeaveError && error.statusCode === 404,
  );
  assert.deepEqual(state.calls, []);
});
