/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ServiceSession } from '@workspace/api-client-react';
import { summarizeEmployeeSessions } from './employee-list-summary';

function session(overrides: Partial<ServiceSession> & Pick<ServiceSession, 'id' | 'memberId' | 'workDate' | 'serviceType' | 'earnings'>): ServiceSession {
  return {
    id: overrides.id,
    cardId: null,
    memberId: overrides.memberId,
    serviceTypeId: 1,
    employeeName: 'TEST',
    customerName: 'TEST',
    serviceType: overrides.serviceType,
    workDate: overrides.workDate,
    minutes: 60,
    customerHourlyRate: 0,
    customerCharge: 0,
    hourlyRate: 0,
    earnings: overrides.earnings,
    note: '',
    createdAt: '2026-10-17T00:00:00.000Z',
    archived: false,
  };
}

test('employee summaries total month pay and show per-service counts for the selected day', () => {
  const summaries = summarizeEmployeeSessions([
    session({ id: 1, memberId: 5, workDate: '2026-10-17', serviceType: 'Mát-xa', earnings: 100_000 }),
    session({ id: 2, memberId: 5, workDate: '2026-10-17', serviceType: 'Trị liệu', earnings: 150_000 }),
    session({ id: 3, memberId: 5, workDate: '2026-10-11', serviceType: 'Mát-xa', earnings: 80_000 }),
    session({ id: 4, memberId: 8, workDate: '2026-10-17', serviceType: 'Gội đầu', earnings: 50_000 }),
    session({ id: 5, memberId: null, workDate: '2026-10-17', serviceType: 'Mát-xa', earnings: 900_000 }),
  ], '2026-10-17');

  assert.deepEqual(summaries.get(5), {
    monthEarnings: 330_000,
    monthSessionCount: 3,
    monthServices: [{ serviceType: 'Mát-xa', minutes: 60, visits: 2 }, { serviceType: 'Trị liệu', minutes: 60, visits: 1 }],
    dayEarnings: 250_000,
    daySessionCount: 2,
    dayServices: [{ serviceType: 'Mát-xa', minutes: 60, visits: 1 }, { serviceType: 'Trị liệu', minutes: 60, visits: 1 }],
  });
  assert.equal(summaries.get(8)?.monthEarnings, 50_000);
  assert.equal(summaries.has(0), false);
});
