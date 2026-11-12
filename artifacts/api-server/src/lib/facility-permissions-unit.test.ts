import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import {
  canCompareEmployee,
  canDeleteEmployee,
  canViewEmployee,
  canManageGrant,
  hasOnlyActiveGrantEmployees,
  noPermissions,
  ownerPermissions,
  permissionsWithinDelegationScope,
  safePermissions,
} from "./facility-permissions";
import { managerRequestAllowed } from "./owner-auth";

function request(method: string, path: string): Request {
  return { method, path } as Request;
}

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

test("comparison-only grants do not grant employee-list visibility and remain separately delegated", () => {
  const scope = { ...noPermissions(), compareEmployeeIds: [7] };
  assert.equal(canCompareEmployee(scope, 7), true);
  assert.equal(canCompareEmployee(scope, 8), false);
  assert.equal(canViewEmployee(scope, 7), false);
  assert.equal(permissionsWithinDelegationScope(scope, { ...noPermissions(), compareEmployeeIds: [7] }), true);
  assert.equal(permissionsWithinDelegationScope(scope, { ...noPermissions(), compareEmployeeIds: [8] }), false);
  assert.equal(permissionsWithinDelegationScope(scope, { ...noPermissions(), compareAllEmployees: true }), false);
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
  const permissions = ownerPermissions();
  const owner = { email: "owner@example.com", isOwner: true, permissions };
  for (const capability of [
    "allEmployees", "compareAllEmployees", "viewCards", "viewRevenue",
    "editEmployees", "editCards", "editServices", "deleteEmployees",
    "viewAppointments", "editAppointments",
  ] as const) {
    assert.equal(permissions[capability], true, `owner must have ${capability}`);
  }
  assert.equal(canManageGrant(owner, { email: "legacy@example.com", grantedBy: null, permissions: {} }), true);
  assert.equal(canDeleteEmployee(permissions, 4), true);
});

test("manager access grants cannot assign deleted employees", () => {
  assert.equal(hasOnlyActiveGrantEmployees([4], [{ id: 4, deletedAt: null }]), true);
  assert.equal(hasOnlyActiveGrantEmployees([4], [{ id: 4, deletedAt: new Date() }]), false);
  assert.equal(hasOnlyActiveGrantEmployees([4], []), false);
});

test("employee activity in appointments follows dedicated view and edit grants", async () => {
  const none = noPermissions();
  const appointmentsViewer = { ...none, viewAppointments: true };
  const appointmentsEditor = { ...appointmentsViewer, editAppointments: true };
  assert.equal(await managerRequestAllowed(request("GET", "/appointments/staff-activity"), none), false);
  assert.equal(await managerRequestAllowed(request("GET", "/appointments/staff-activity"), appointmentsViewer), true);
  assert.equal(await managerRequestAllowed(request("PATCH", "/appointments/staff-activity/7"), appointmentsViewer), false);
  assert.equal(await managerRequestAllowed(request("PATCH", "/appointments/staff-activity/7"), appointmentsEditor), true);
  assert.equal(await managerRequestAllowed(request("PATCH", "/appointments/staff-activity/not-an-id"), ownerPermissions()), false);
});
