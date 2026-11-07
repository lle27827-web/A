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
    [
      { memberId: 2, scheduledAt: "2026-11-07T04:20:00.000Z", status: "scheduled", customerName: "Khách cũ" },
      {
        memberId: 2,
        scheduledAt: "2026-11-07T07:30:00.000Z",
        status: "scheduled",
        customerName: "Khách Mai",
        request: "Mát xa",
        note: "Hẹn đến sớm",
      },
      { memberId: 2, scheduledAt: "2026-11-07T08:30:00.000Z", status: "scheduled", customerName: "Khách sau" },
    ],
  );

  assert.deepEqual(result, [
    {
      memberId: 2, employeeName: "Mai", state: "available", endsAt: null,
      lastFinishedAt: "2026-11-07T03:30:00.000Z", serviceType: null,
      nextAppointmentAt: "2026-11-07T07:30:00.000Z",
      nextAppointmentCustomerName: "Khách Mai",
      nextAppointmentRequest: "Mát xa",
      nextAppointmentNote: "Hẹn đến sớm",
    },
    {
      memberId: 3, employeeName: "An", state: "off", endsAt: null,
      lastFinishedAt: null, serviceType: null, nextAppointmentAt: null,
      nextAppointmentCustomerName: null, nextAppointmentRequest: null, nextAppointmentNote: null,
    },
    {
      memberId: 1, employeeName: "Lan", state: "working", endsAt: "2026-11-07T05:00:00.000Z",
      lastFinishedAt: null, serviceType: "Mát xa", nextAppointmentAt: null,
      nextAppointmentCustomerName: null, nextAppointmentRequest: null, nextAppointmentNote: null,
    },
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
  assert.equal(result.lastFinishedAt, "2026-11-07T05:00:00.000Z");
});

test("staff roster sorts by yesterday's shift count then compares earlier days", () => {
  const result = deriveStaffActivity(
    [{ id: 1, name: "An" }, { id: 2, name: "Bình" }, { id: 3, name: "Chi" }],
    [
      { memberId: 3, serviceType: "A", minutes: 30, workDate: "2026-11-06", createdAt: "2026-11-06T03:00:00Z" },
      { memberId: 1, serviceType: "A", minutes: 30, workDate: "2026-11-05", createdAt: "2026-11-05T03:00:00Z" },
      { memberId: 1, serviceType: "A", minutes: 30, workDate: "2026-11-05", createdAt: "2026-11-05T04:00:00Z" },
      { memberId: 2, serviceType: "A", minutes: 30, workDate: "2026-11-05", createdAt: "2026-11-05T03:00:00Z" },
    ],
    [],
    new Date("2026-11-07T04:30:00.000Z"),
  );
  assert.deepEqual(result.map((row) => row.memberId), [2, 1, 3]);
});

test("the employee who started the latest active shift is placed last among working staff", () => {
  const now = new Date("2026-11-07T04:30:00.000Z");
  const today = hoChiMinhDate(now);
  const result = deriveStaffActivity(
    [{ id: 1, name: "An" }, { id: 2, name: "Bình" }, { id: 3, name: "Chi" }],
    [
      { memberId: 1, serviceType: "Mát xa", minutes: 120, workDate: today, createdAt: "2026-11-07T04:00:00.000Z" },
      { memberId: 2, serviceType: "Trị liệu", minutes: 90, workDate: today, createdAt: "2026-11-07T04:15:00.000Z" },
    ],
    [],
    now,
  );

  assert.deepEqual(result.map((row) => row.memberId), [3, 1, 2]);
  assert.equal(result.at(-1)?.serviceType, "Trị liệu");
});
