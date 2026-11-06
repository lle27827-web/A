import assert from "node:assert/strict";
import test from "node:test";
import { resolvePersonalShiftPricing } from "./personal-night-pricing";

const nightConfig = { enabled: true, startTime: "22:00", endTime: "06:00" };

test("synced personal shifts use the facility night wage only within its enabled window", () => {
  const night = resolvePersonalShiftPricing({
    now: new Date("2026-11-02T16:30:00.000Z"),
    previous: undefined,
    serviceId: 1,
    serviceHourlyRate: 70000,
    serviceNightHourlyRate: 95000,
    facilityServiceId: 4,
    useFacilityRates: true,
    nightConfig,
  });
  assert.deepEqual(night, { isNightShift: true, sameService: false, useNightRate: true, hourlyRate: 95000 });

  const daytime = resolvePersonalShiftPricing({
    now: new Date("2026-11-02T10:00:00.000Z"),
    previous: undefined,
    serviceId: 1,
    serviceHourlyRate: 70000,
    serviceNightHourlyRate: 95000,
    facilityServiceId: 4,
    useFacilityRates: true,
    nightConfig,
  });
  assert.deepEqual(daytime, { isNightShift: false, sameService: false, useNightRate: false, hourlyRate: 70000 });
});

test("custom personal services keep standard pay and saved shifts retain their original rate", () => {
  const custom = resolvePersonalShiftPricing({
    now: new Date("2026-11-02T16:30:00.000Z"),
    previous: undefined,
    serviceId: 1,
    serviceHourlyRate: 70000,
    serviceNightHourlyRate: null,
    facilityServiceId: null,
    useFacilityRates: false,
    nightConfig,
  });
  assert.equal(custom.isNightShift, false, "personal-only services do not inherit the facility's night-shift label");
  assert.equal(custom.useNightRate, false);
  assert.equal(custom.hourlyRate, 70000);

  const edited = resolvePersonalShiftPricing({
    now: new Date("2026-11-03T04:00:00.000Z"),
    previous: { serviceId: 1, hourlyRate: 88000, isNightShift: true },
    serviceId: 1,
    serviceHourlyRate: 70000,
    serviceNightHourlyRate: null,
    facilityServiceId: 4,
    useFacilityRates: true,
    nightConfig: { ...nightConfig, enabled: false },
  });
  assert.deepEqual(edited, { isNightShift: true, sameService: true, useNightRate: false, hourlyRate: 88000 });
});
