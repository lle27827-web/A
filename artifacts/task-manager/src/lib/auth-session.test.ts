import assert from 'node:assert/strict';
import test from 'node:test';
import { retrySessionCheck, SessionRestoringError, validateRestoredSession } from './auth-session';

const guest = { authConfigured: true, authenticated: false, isOwner: false };
const owner = { authConfigured: true, authenticated: true, isOwner: true };
const viewer = { authConfigured: true, authenticated: true, isOwner: false };

test('restored sessions retain verified owner/viewer roles; anonymous visitors stay guests', () => {
  assert.deepEqual(validateRestoredSession(owner, true), owner);
  assert.deepEqual(validateRestoredSession(viewer, true), viewer);
  assert.deepEqual(validateRestoredSession(guest, false), guest);
});

test('cookie synchronization cannot silently demote a signed-in account to guest', () => {
  assert.throws(() => validateRestoredSession(guest, true), SessionRestoringError);
  assert.equal(retrySessionCheck(0, new SessionRestoringError()), true);
  assert.equal(retrySessionCheck(2, new SessionRestoringError()), true);
  assert.equal(retrySessionCheck(3, new SessionRestoringError()), false);
  assert.deepEqual(validateRestoredSession(owner, true), owner);
});

test('a stale owner response cannot restore privileges after sign-out', () => {
  assert.throws(() => validateRestoredSession(owner, false), SessionRestoringError);
  assert.equal(retrySessionCheck(0, new Error('network')), true);
  assert.equal(retrySessionCheck(1, new Error('network')), false);
});
