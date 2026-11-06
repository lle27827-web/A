import assert from "node:assert/strict";
import test from "node:test";
import { isWithinNightWindow, parseClockMinutes } from "./night-service-pricing";

test("night window supports cross-midnight times in Vietnam", () => {
  assert.equal(isWithinNightWindow(new Date("2026-04-01T15:00:00.000Z"), "22:00", "06:00"), true);
  assert.equal(isWithinNightWindow(new Date("2026-04-01T21:00:00.000Z"), "22:00", "06:00"), true);
  assert.equal(isWithinNightWindow(new Date("2026-04-01T23:00:00.000Z"), "22:00", "06:00"), false);
});

test("night window uses a start-inclusive and end-exclusive range", () => {
  assert.equal(isWithinNightWindow(new Date("2026-04-01T14:00:00.000Z"), "21:00", "23:00"), true);
  assert.equal(isWithinNightWindow(new Date("2026-04-01T16:00:00.000Z"), "21:00", "23:00"), false);
});

test("invalid and equal hour bounds never create a night shift", () => {
  assert.equal(parseClockMinutes("24:00"), null);
  assert.equal(parseClockMinutes("09:60"), null);
  assert.equal(isWithinNightWindow(new Date(), "22:00", "22:00"), false);
});
