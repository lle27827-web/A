import assert from 'node:assert/strict';
import test from 'node:test';
import type { MemberRecord, ServiceSession, ServiceTypeRecord } from '@workspace/api-client-react';
import { buildMonthlyPayrollReport } from './monthly-payroll-report.ts';

const members: MemberRecord[] = [
  { id: 1, name: 'An', hourlyRate: 0, createdAt: '2026-01-01' },
  { id: 2, name: 'Bình', hourlyRate: 0, createdAt: '2026-01-01' },
];

const services: ServiceTypeRecord[] = [
  { id: 10, name: 'Mát-xa', customerHourlyRate: 300_000, hourlyRate: 100_000, createdAt: '2026-01-01' },
  { id: 11, name: 'Trị liệu', customerHourlyRate: 400_000, hourlyRate: 150_000, createdAt: '2026-01-01' },
];

function session(overrides: Partial<ServiceSession> & Pick<ServiceSession, 'id' | 'memberId' | 'serviceTypeId' | 'serviceType' | 'workDate' | 'minutes' | 'earnings'>): ServiceSession {
  return {
    cardId: null,
    employeeName: 'An',
    customerName: '',
    customerHourlyRate: 0,
    customerCharge: 0,
    paymentMethod: null,
    hourlyRate: 0,
    note: '',
    createdAt: '2026-01-01T00:00:00Z',
    archived: false,
    ...overrides,
  };
}

test('monthly payroll groups services and calculates shifts, hours, wages and totals', () => {
  const report = buildMonthlyPayrollReport(members, [
    session({ id: 1, memberId: 1, serviceTypeId: 10, serviceType: 'Mát-xa', workDate: '2026-03-02', minutes: 90, earnings: 150_000, hourlyRate: 100_000 }),
    session({ id: 2, memberId: 1, serviceTypeId: 10, serviceType: 'Mát-xa', workDate: '2026-03-08', minutes: 60, earnings: 100_000, hourlyRate: 120_000 }),
    session({ id: 3, memberId: 2, serviceTypeId: 11, serviceType: 'Trị liệu', workDate: '2026-03-09', minutes: 120, earnings: 300_000, hourlyRate: 150_000 }),
    session({ id: 4, memberId: 2, serviceTypeId: 11, serviceType: 'Trị liệu', workDate: '2026-04-01', minutes: 60, earnings: 150_000 }),
  ], services, '2026-03');

  assert.deepEqual(report.services.map((service) => service.name), ['Mát-xa', 'Trị liệu']);
  assert.deepEqual(report.services.map((service) => service.hourlyRates), [[100_000, 120_000], [150_000]]);
  assert.equal(report.rows.length, 2);
  assert.deepEqual(report.rows[0]?.services[0], { sessions: 2, minutes: 150, earnings: 250_000 });
  assert.deepEqual(report.rows[0]?.total, { sessions: 2, minutes: 150, earnings: 250_000 });
  assert.deepEqual(report.rows[1]?.services[1], { sessions: 1, minutes: 120, earnings: 300_000 });
  assert.deepEqual(report.total, { sessions: 3, minutes: 270, earnings: 550_000 });
});

test('deleted catalog services remain visible from the month snapshot, without merging recreated IDs', () => {
  const report = buildMonthlyPayrollReport(members, [
    session({ id: 1, memberId: 1, serviceTypeId: 20, serviceType: 'Dịch vụ cũ', workDate: '2026-03-02', minutes: 60, earnings: 80_000 }),
  ], services, '2026-03');

  assert.deepEqual(report.services.map((service) => service.name), ['Dịch vụ cũ', 'Mát-xa', 'Trị liệu']);
  assert.deepEqual(report.rows[0]?.services[0], { sessions: 1, minutes: 60, earnings: 80_000 });
});

test('service columns without sessions show the current configured wage rate', () => {
  const report = buildMonthlyPayrollReport(members, [], services, '2026-03');
  assert.deepEqual(report.services.map((service) => service.hourlyRates), [[100_000], [150_000]]);
});
