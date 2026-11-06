import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseEmployeeHourlyRate,
  monthDateBounds,
  shouldKeepRecordedHourlyRate,
} from "./employee-bonus-pay";

test("higher employee rate begins on the shift after the monthly threshold is reached", () => {
  const base = {
    enabled: true,
    thresholdMinutes: 1800,
    standardHourlyRate: 80_000,
    bonusHourlyRate: 110_000,
  };
  assert.equal(chooseEmployeeHourlyRate({ ...base, minutesWorkedEarlierThisMonth: 1740 }), 80_000);
  assert.equal(chooseEmployeeHourlyRate({ ...base, minutesWorkedEarlierThisMonth: 1800 }), 110_000);
});

test("bonus rates do not apply when disabled, unconfigured, or no threshold is set", () => {
  assert.equal(chooseEmployeeHourlyRate({
    enabled: false, thresholdMinutes: 1800, minutesWorkedEarlierThisMonth: 2400,
    standardHourlyRate: 80_000, bonusHourlyRate: 110_000,
  }), 80_000);
  assert.equal(chooseEmployeeHourlyRate({
    enabled: true, thresholdMinutes: 1800, minutesWorkedEarlierThisMonth: 2400,
    standardHourlyRate: 80_000, bonusHourlyRate: null,
  }), 80_000);
  assert.equal(chooseEmployeeHourlyRate({
    enabled: true, thresholdMinutes: 0, minutesWorkedEarlierThisMonth: 2400,
    standardHourlyRate: 80_000, bonusHourlyRate: 110_000,
  }), 80_000);
  assert.equal(chooseEmployeeHourlyRate({
    enabled: true, thresholdMinutes: 1800, minutesWorkedEarlierThisMonth: 2400,
    standardHourlyRate: 120_000, bonusHourlyRate: 110_000,
  }), 120_000);
});

test("monthly bounds preserve the service date and handle December rollover", () => {
  assert.deepEqual(monthDateBounds("2026-11-17"), { start: "2026-11-01", end: "2026-12-01" });
  assert.deepEqual(monthDateBounds("2026-12-31"), { start: "2026-12-01", end: "2027-01-01" });
});

test("editing an existing employee and service keeps that session's recorded rate", () => {
  const existing = { memberId: 5, serviceTypeId: 9, hourlyRate: 95_000 };
  assert.equal(shouldKeepRecordedHourlyRate(existing, 5, 9), true);
  assert.equal(shouldKeepRecordedHourlyRate(existing, 6, 9), false);
  assert.equal(shouldKeepRecordedHourlyRate(existing, 5, 10), false);
});
