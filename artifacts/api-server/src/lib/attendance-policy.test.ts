import assert from "node:assert/strict";
import test from "node:test";
import { isActiveAttendanceMember, isEditableAttendanceDate } from "./attendance-policy";

test("attendance rejects deleted employees and records outside the five-year window", () => {
  assert.equal(isActiveAttendanceMember({ deletedAt: null }), true);
  assert.equal(isActiveAttendanceMember({ deletedAt: new Date() }), false);
  assert.equal(isActiveAttendanceMember(null), false);
  assert.equal(isEditableAttendanceDate(new Date().toISOString().slice(0, 10)), true);
  assert.equal(isEditableAttendanceDate("2000-01-01"), false);
});
