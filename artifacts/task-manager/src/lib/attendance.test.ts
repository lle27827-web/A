import assert from 'node:assert/strict';
import test from 'node:test';
import { formatShortDayMonth } from './attendance';

test('formats a date as day and month without a year', () => {
  assert.equal(formatShortDayMonth('2026-02-05'), '05/02');
});

test('preserves an unrecognized date value', () => {
  assert.equal(formatShortDayMonth(''), '');
  assert.equal(formatShortDayMonth('2026-02'), '2026-02');
});
