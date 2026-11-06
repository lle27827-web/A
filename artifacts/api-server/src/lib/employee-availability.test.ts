import assert from "node:assert/strict";
import test from "node:test";
import { deriveStaffActivity, hoChiMinhDate } from "./employee-availability";

test("staff activity derives work end time, idle, and daily leave in Ho Chi Minh time", () => {
  const now = new Date("2026-11-07T04:30:00.000Z"); // 11:30 in Ho Chi Minh
  const today = hoChiMinhDate(now);
  const result = deriveStaffActivity(
    [{ id: 1, name: "Lan" }, { id: 2, name: "Mai" }, { id: 3, name: "An" }],
    [
      { memberId: 1, serviceType: "Mát xa", minutes: 60, workDate: today, createdAt: "2026-11-07T04:00:00.000Z" },
      { memberId: 2, serviceType: "Trị liệu", minutes: 30, workDate: today, createdAt: "2026-11-07T03:00:00.000Z" },
      { memberId: 3, serviceType: "Mát xa", minutes: 60, workDate: "2026-11-06", createdAt: "2026-11-07T04:00:00.000Z" },
    ],
    [{ memberId: 3, statusDate: today, state: "off" }],
    now,
  );

  assert.deepEqual(result, [
    { memberId: 3, employeeName: "An", state: "off", endsAt: null, serviceType: null },
    { memberId: 1, employeeName: "Lan", state: "working", endsAt: "2026-11-07T05:00:00.000Z", serviceType: "Mát xa" },
    { memberId: 2, employeeName: "Mai", state: "available", endsAt: null, serviceType: null },
  ]);
});

test("a completed session stops marking an employee as busy", () => {
  const now = new Date("2026-11-07T05:01:00.000Z");
  const today = hoChiMinhDate(now);
  const [result] = deriveStaffActivity(
    [{ id: 1, name: "Lan" }],
    [{ memberId: 1, serviceType: "Mát xa", minutes: 60, workDate: today, createdAt: "2026-11-07T04:00:00.000Z" }],
    [],
    now,
  );
  assert.equal(result.state, "available");
  assert.equal(result.endsAt, null);
});
