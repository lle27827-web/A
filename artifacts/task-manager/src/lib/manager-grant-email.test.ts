import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasDuplicateManagerGrantEmail,
  managerGrantEmailInputValue,
  normalizeManagerGrantEmail,
} from './manager-grant-email.ts';

test('new manager grants accept a Gmail account name and append the domain once', () => {
  assert.equal(normalizeManagerGrantEmail('Lan.Nguyen', true), 'lan.nguyen@gmail.com');
  assert.equal(normalizeManagerGrantEmail('LAN.NGUYEN@GMAIL.COM', true), 'lan.nguyen@gmail.com');
});

test('new manager grants reject malformed Gmail account names', () => {
  for (const value of ['', '   ', '.lan', 'lan.', 'lan..nguyen', 'lan nguyen', 'lan@other.com', 'a'.repeat(65)]) {
    assert.equal(normalizeManagerGrantEmail(value, true), null, value);
  }
});

test('existing grant email addresses are normalized and preserved without forcing Gmail', () => {
  assert.equal(normalizeManagerGrantEmail(' Manager@Example.com ', false), 'manager@example.com');
  assert.equal(normalizeManagerGrantEmail('not-an-email', false), null);
});

test('duplicate checks compare normalized full addresses', () => {
  const newAddress = normalizeManagerGrantEmail('Manager.Name', true);
  assert.ok(newAddress);
  assert.equal(hasDuplicateManagerGrantEmail(newAddress, [' MANAGER.NAME@gmail.com ']), true);
  assert.equal(hasDuplicateManagerGrantEmail(newAddress, ['other@gmail.com']), false);
});

test('the input removes only a pasted Gmail suffix from new-grant values', () => {
  assert.equal(managerGrantEmailInputValue('user@gmail.com', true), 'user');
  assert.equal(managerGrantEmailInputValue('user@example.com', true), 'user@example.com');
  assert.equal(managerGrantEmailInputValue('user@gmail.com', false), 'user@gmail.com');
});
