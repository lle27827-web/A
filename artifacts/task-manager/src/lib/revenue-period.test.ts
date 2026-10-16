import assert from 'node:assert/strict';
import test from 'node:test';
import { monthLastDate, previousRevenueMonth, resolveRevenuePeriod, vietnamToday } from './revenue-period';

test('Vietnam business dates and previous month handle midnight and year rollover', () => {
  assert.equal(vietnamToday(new Date('2026-12-31T18:00:00Z')), '2027-01-01');
  assert.equal(previousRevenueMonth('2027-01-01'), '2026-12');
  assert.equal(previousRevenueMonth('2026-10-16'), '2026-09');
});

test('history defaults to a real last day and keeps a selected day after reload', () => {
  assert.equal(monthLastDate('2024-02'), '2024-02-29');
  assert.equal(monthLastDate('2025-02'), '2025-02-28');
  assert.equal(resolveRevenuePeriod('?month=2024-02', '2026-10-16').date, '2024-02-29');
  const period = resolveRevenuePeriod('?month=2026-09&date=2026-09-10', '2026-10-16');
  assert.equal(period.month, '2026-09');
  assert.equal(period.date, '2026-09-10');
  assert.equal(period.isHistory, true);
});

test('invalid, future or mismatched inputs never send invalid API dates', () => {
  for (const month of ['2026-13', 'garbage', '2027-01', '0000-01']) {
    assert.equal(resolveRevenuePeriod(`month=${month}`, '2026-10-16').month, '2026-10');
  }
  for (const date of ['2025-02-29', '2025-02-31', '2025-02-00', '2025-03-01']) {
    assert.equal(resolveRevenuePeriod(`month=2025-02&date=${date}`, '2026-10-16').date, '2025-02-28');
  }
  assert.equal(resolveRevenuePeriod('date=2026-10-17', '2026-10-16').date, '2026-10-16');
  assert.equal(resolveRevenuePeriod('', '2026-10-16').isHistory, false);
});
