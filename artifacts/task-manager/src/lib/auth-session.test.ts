import assert from 'node:assert/strict';
import test from 'node:test';
import { postAuthPath, retrySessionCheck, sessionScreen, SessionRestoringError, validateRestoredSession } from './auth-session';

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

test('only supported local post-login destinations are accepted', () => {
  assert.equal(postAuthPath(''), '/');
  assert.equal(postAuthPath('?next=personal'), '/personal');
  assert.equal(postAuthPath('?next=https://untrusted.test'), '/');
  assert.equal(postAuthPath('?next=//untrusted.test'), '/');
  assert.equal(postAuthPath('?next=/cards'), '/');
});

test('restoration and verification failures have visible screens on every protected/auth route', () => {
  const signedIn = { loaded: true, signedIn: true, pending: false, error: false, publicPath: false };
  assert.equal(sessionScreen(signedIn), 'ready');
  assert.equal(sessionScreen({ ...signedIn, loaded: false }), 'loading');
  assert.equal(sessionScreen({ ...signedIn, pending: true }), 'loading');
  assert.equal(sessionScreen({ ...signedIn, error: true }), 'error');
  assert.equal(sessionScreen({ ...signedIn, error: true, publicPath: true }), 'error');
  assert.equal(sessionScreen({ ...signedIn, signedIn: false, pending: true }), 'loading');
  assert.equal(sessionScreen({ ...signedIn, signedIn: false, pending: true, publicPath: true }), 'ready');
  assert.equal(sessionScreen({ ...signedIn, signedIn: false, error: true, publicPath: true }), 'ready');
});
