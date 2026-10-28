import assert from "node:assert/strict";
import test from "node:test";
import { canDeleteEmployee, canManageGrant, noPermissions, ownerPermissions, safePermissions } from "./facility-permissions";

test("legacy grants cannot delete employees or be changed by managers", () => {
  const old = { allEmployees: true, employeeIds: [], viewCards: true, viewRevenue: true, editEmployees: true };
  const permissions = safePermissions(old);
  assert.equal(permissions.deleteEmployees, false);
  assert.equal(canDeleteEmployee(permissions, 4), false);
  assert.equal(canManageGrant(
    { email: "manager@example.com", isOwner: false, permissions: ownerPermissions() },
    { email: "staff@example.com", grantedBy: null, permissions },
  ), false);
});

test("a manager may only manage grants they created within their delegated scope", () => {
  const scope = { ...noPermissions(), allEmployees: true, editEmployees: true };
  const manager = { email: "manager@example.com", isOwner: false, permissions: scope };
  assert.equal(canManageGrant(manager, {
    email: "staff@example.com", grantedBy: "MANAGER@example.com", permissions: { ...noPermissions(), allEmployees: true },
  }), true);
  assert.equal(canManageGrant(manager, {
    email: "staff@example.com", grantedBy: "owner@example.com", permissions: { ...noPermissions(), allEmployees: true },
  }), false);
  assert.equal(canManageGrant(manager, {
    email: "other@example.com", grantedBy: "manager@example.com", permissions: { ...noPermissions(), viewRevenue: true },
  }), false);
});

test("owner always retains authority over every grant and employee", () => {
  const owner = { email: "owner@example.com", isOwner: true, permissions: ownerPermissions() };
  assert.equal(canManageGrant(owner, { email: "legacy@example.com", grantedBy: null, permissions: {} }), true);
  assert.equal(canDeleteEmployee(ownerPermissions(), 4), true);
});
