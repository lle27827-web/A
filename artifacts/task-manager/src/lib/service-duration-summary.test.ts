/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  serviceAttendanceLabel,
  serviceDurationLabel,
  serviceHoursLabel,
  summarizeServiceAttendance,
  summarizeServiceDurations,
  summarizeServiceHours,
} from './service-duration-summary';

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

test('totals all time per service without displaying session counts', () => {
  const totals = summarizeServiceHours([
    { serviceType: 'Mát-xa', minutes: 90 },
    { serviceType: 'Trị liệu', minutes: 120 },
    { serviceType: 'Mát-xa', minutes: 30 },
    { serviceType: 'Mát-xa', minutes: 90 },
  ]);
  assert.deepEqual(totals, [
    { serviceType: 'Mát-xa', minutes: 210 },
    { serviceType: 'Trị liệu', minutes: 120 },
  ]);
  assert.equal(serviceHoursLabel(totals[0], (minutes) => `${minutes} phút`), 'Mát-xa · 210 phút');
});

test('service attendance totals combine duration groups into per-service counts and hours', () => {
  const totals = summarizeServiceAttendance([
    { serviceType: 'Dịch vụ A', minutes: 60, visits: 2 },
    { serviceType: 'Dịch vụ A', minutes: 30, visits: 1 },
    { serviceType: 'Dịch vụ B', minutes: 120, visits: 1 },
  ]);
  assert.deepEqual(totals, [
    { serviceType: 'Dịch vụ A', visits: 3, minutes: 150 },
    { serviceType: 'Dịch vụ B', visits: 1, minutes: 120 },
  ]);
  assert.equal(serviceAttendanceLabel(totals[0]!, (minutes) => `${Math.floor(minutes / 60)}h${minutes % 60 || ''}`), 'Dịch vụ A · 3 ca · 2h30');
});
