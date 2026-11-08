import assert from "node:assert/strict";
import test from "node:test";
import { personalOnlyBusinessAccess } from "./business-access-policy";

test("business registry failure leaves no stale business membership or permissions", () => {
  const fallback = personalOnlyBusinessAccess({
    allEmployees: false,
    employeeIds: [],
    viewCards: false,
    viewRevenue: false,
    editEmployees: false,
    deleteEmployees: false,
    editCards: false,
    editServices: false,
    viewAppointments: false,
    editAppointments: false,
  });
  assert.deepEqual(fallback, {
    businessAccessAvailable: false,
    businesses: [],
    businessId: null,
    businessName: null,
    role: null,
    isOwner: false,
    permissions: {
      allEmployees: false,
      employeeIds: [],
      viewCards: false,
      viewRevenue: false,
      editEmployees: false,
      deleteEmployees: false,
      editCards: false,
      editServices: false,
      viewAppointments: false,
      editAppointments: false,
    },
  });
});
