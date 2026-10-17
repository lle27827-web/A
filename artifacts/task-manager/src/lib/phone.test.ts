import assert from 'node:assert/strict';
import test from 'node:test';
import { phoneCallHref } from './phone';

test('phone call links keep a leading country prefix and remove display separators', () => {
  assert.equal(phoneCallHref(' +84 903-123-456 '), 'tel:+84903123456');
  assert.equal(phoneCallHref('0903 123 456'), 'tel:0903123456');
  assert.equal(phoneCallHref('12'), null);
});
