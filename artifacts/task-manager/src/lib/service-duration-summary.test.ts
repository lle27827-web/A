/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeServiceDurations, serviceDurationLabel } from './service-duration-summary';

test('keeps each service duration separate and counts identical sessions', () => {
  const details = summarizeServiceDurations([
    { serviceType: 'Mát-xa', minutes: 90 },
    { serviceType: 'Trị liệu', minutes: 120 },
    { serviceType: 'Mát-xa', minutes: 30 },
    { serviceType: 'Mát-xa', minutes: 90 },
  ]);
  assert.deepEqual(details, [
    { serviceType: 'Mát-xa', minutes: 30, visits: 1 },
    { serviceType: 'Mát-xa', minutes: 90, visits: 2 },
    { serviceType: 'Trị liệu', minutes: 120, visits: 1 },
  ]);
  assert.equal(serviceDurationLabel(details[1], (minutes) => `${minutes} phút`), 'Mát-xa · 2 ca × 90 phút');
});
