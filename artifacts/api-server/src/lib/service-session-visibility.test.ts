import assert from "node:assert/strict";
import test from "node:test";
import { noPermissions, ownerPermissions } from "./facility-permissions";
import { maskSessionForEmployeePermissions } from "./service-session-visibility";

const row = {
  id: 3,
  memberId: 12,
  employeeName: "Nhân viên A",
  hourlyRate: 100_000,
  earnings: 50_000,
  minutes: 30,
  archived: false,
};

test("service-session card history hides employee identity and compensation without employee-view rights", () => {
  const masked = maskSessionForEmployeePermissions(row, false, noPermissions());
  assert.equal(masked.memberId, null);
  assert.equal(masked.employeeName, "Nhân viên");
  assert.equal(masked.hourlyRate, 0);
  assert.equal(masked.earnings, 0);
  assert.equal(masked.minutes, row.minutes);
});

test("service-session details remain visible to owners and managers granted that employee", () => {
  assert.equal(maskSessionForEmployeePermissions(row, true, noPermissions()), row);
  assert.equal(maskSessionForEmployeePermissions(row, false, {
    ...noPermissions(),
    employeeIds: [12],
  }), row);
  assert.equal(maskSessionForEmployeePermissions(row, false, ownerPermissions()), row);
});

test("legacy card-use rows with no member id do not leak a retained employee name", () => {
  const masked = maskSessionForEmployeePermissions({ ...row, memberId: null }, false, noPermissions());
  assert.equal(masked.employeeName, "Nhân viên");
  assert.equal(masked.earnings, 0);
});
