import assert from 'node:assert/strict';
import test from 'node:test';
import type { MemberRecord, PersonalComparisonVisit } from '@workspace/api-client-react';
import { compareServiceHours, comparisonMemberParams, comparisonResult, comparisonRoster } from './comparison-display';

test('current comparison uses the same active roster query as facility; history stays period-scoped', () => {
  assert.equal(comparisonMemberParams('2026-10', '2026-10'), undefined);
  assert.deepEqual(comparisonMemberParams('2026-09', '2026-10'), { month: '2026-09' });
});
test('one row per employee id, but real same-name employees retain distinct identities', () => {
  const first = { id: 1, name: 'Anh An', hourlyRate: 0, createdAt: '', deletedAt: null } satisfies MemberRecord;
  const second = { ...first, id: 2, name: ' anh  an ', deletedAt: '2026-10-01T00:00:00Z' };
  const rows = comparisonRoster([first, first, second]);
  assert.equal(rows.length, 2);
  assert.match(rows[0].label, /#1/);
  assert.match(rows[1].label, /#2.*Đã nghỉ/);
  assert.deepEqual(rows.map((row) => row.id), [1, 2]);
});
test('matched data replaces discrepancy history; an empty range is not reported as matched', () => {
  assert.equal(comparisonResult(4, 4, 0), 'matched');
  assert.equal(comparisonResult(1, 1, 1), 'mismatches');
  assert.equal(comparisonResult(0, 0, 0), 'empty');
});

test('comparison totals hours per service and displays only services with a total-hours difference', () => {
  const base = { id: 1, serviceName: 'Trị liệu', customerName: '', workDate: '2026-10-17', minutes: 60, hourlyRate: 60000, earnings: 60000, note: '' } satisfies PersonalComparisonVisit;
  const personal = [{ ...base, id: 1, minutes: 180 }, { ...base, id: 2, serviceName: 'Massage', minutes: 60 }];
  const reference = [{ ...base, id: 3, minutes: 300 }, { ...base, id: 4, serviceName: ' massage ', minutes: 60 }];
  assert.deepEqual(compareServiceHours(personal, reference), [
    { serviceName: 'Trị liệu', workDate: '2026-10-17', personalMinutes: 180, referenceMinutes: 300 },
  ]);
  assert.deepEqual(compareServiceHours([{ ...base, minutes: 60 }, { ...base, id: 2, minutes: 120 }], [{ ...base, minutes: 180 }]), []);
  assert.deepEqual(compareServiceHours([], [base]), [
    { serviceName: 'Trị liệu', workDate: '2026-10-17', personalMinutes: 0, referenceMinutes: 60 },
  ]);
  const nextDay = { ...base, workDate: '2026-10-18' };
  assert.deepEqual(compareServiceHours(
    [{ ...base, minutes: 120 }, { ...nextDay, minutes: 60 }],
    [{ ...base, minutes: 60 }, { ...nextDay, minutes: 120 }],
  ), [
    { serviceName: 'Trị liệu', workDate: '2026-10-17', personalMinutes: 120, referenceMinutes: 60 },
    { serviceName: 'Trị liệu', workDate: '2026-10-18', personalMinutes: 60, referenceMinutes: 120 },
  ]);
});
