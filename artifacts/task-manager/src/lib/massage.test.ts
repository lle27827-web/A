import assert from 'node:assert/strict';
import test from 'node:test';
import { treatmentCardLimitError } from './treatment-card-limits';

test('card sales enforce the same maximum hours and amount as the API', () => {
  assert.equal(treatmentCardLimitError(600_000, 1_000_000_000), null);
  assert.equal(treatmentCardLimitError(600_001, 100), 'Tổng số giờ của thẻ không được vượt quá 10.000 giờ.');
  assert.equal(treatmentCardLimitError(60, 1_000_000_001), 'Số tiền thẻ không được vượt quá 1 tỷ đồng.');
});
