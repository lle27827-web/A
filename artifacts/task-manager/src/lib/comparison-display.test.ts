import assert from 'node:assert/strict';
import test from 'node:test';
import type { MemberRecord, PersonalComparisonVisit } from '@workspace/api-client-react';
import { comparisonMemberParams, comparisonRoster, visitGroups } from './comparison-display';

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
test('summary keeps real occurrence counts and separates unmatched durations and amounts', () => {
  const row = { id: 1, serviceName: 'Trị liệu', customerName: '', workDate: '2022-11-11', minutes: 60, hourlyRate: 60000, earnings: 60000, note: '' } satisfies PersonalComparisonVisit;
  const rows = [row, { ...row, id: 2 }, { ...row, id: 3, minutes: 90, earnings: 90000 }];
  assert.equal(visitGroups(rows).length, 1);
  assert.deepEqual(visitGroups(rows).map((g) => [g.count, g.minutes, g.earnings]), [[3, 210, 210000]]);
  assert.deepEqual(visitGroups(rows, true).map((g) => [g.count, g.eachMinutes, g.eachPay]), [[2, 60, 60000], [1, 90, 90000]]);
});
