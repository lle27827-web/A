import assert from 'node:assert/strict';
import test from 'node:test';
import { customFetch, setAuthTokenGetter } from '../../../../lib/api-client-react/src/custom-fetch';
import { SessionRestoringError } from './auth-session';
import { createWebSessionTokenGetter } from './web-session-token';

const origin = 'https://app.example.test';

test('session credentials are scoped to this application API only', async () => {
  let calls = 0;
  const getter = createWebSessionTokenGetter(async () => { calls++; return 'synthetic-session'; }, origin, () => true);
  for (const url of ['/api/auth/status', '/api/personal/notebook', `${origin}/api/members`]) {
    assert.equal(await getter(url), 'synthetic-session');
  }
  for (const url of ['/employees', '/assets/app.js', '/apiculture', '//outside.test/api/members',
    'https://outside.test/api/members', 'https://app.example.test@outside.test/api/members']) {
    assert.equal(await getter(url), null);
  }
  assert.equal(calls, 3);
});

test('missing credentials and obsolete account sessions fail explicitly', async () => {
  await assert.rejects(createWebSessionTokenGetter(async () => null, origin, () => true)('/api/auth/status'), SessionRestoringError);
  let calls = 0;
  const stale = createWebSessionTokenGetter(async () => { calls++; return 'old-session'; }, origin, () => false);
  await assert.rejects(stale('/api/members'), SessionRestoringError);
  assert.equal(calls, 0);
  let active = true;
  const switched = createWebSessionTokenGetter(async () => { active = false; return 'old-session'; }, origin, () => active);
  await assert.rejects(switched('/api/members'), SessionRestoringError);
});

test('API requests forward Clerk session tokens, preserve explicit headers and clear on sign-out', async () => {
  const originalFetch = globalThis.fetch;
  const received: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    received.push({ url: String(input), authorization: new Headers(init?.headers).get('authorization') });
    return Response.json({ ok: true });
  };
  try {
    setAuthTokenGetter(createWebSessionTokenGetter(async () => 'synthetic-session', origin, () => true));
    await customFetch('/api/auth/status');
    await customFetch('/api/personal/services', { method: 'POST', body: JSON.stringify({ name: 'Example', hourlyRate: 100000 }) });
    await customFetch('https://outside.test/api/members');
    await customFetch('/api/members', { headers: { Authorization: 'Bearer explicit-test-value' } });
    setAuthTokenGetter(null);
    await customFetch('/api/members');
    assert.deepEqual(received.map((request) => request.authorization), [
      'Bearer synthetic-session', 'Bearer synthetic-session', null, 'Bearer explicit-test-value', null,
    ]);
    setAuthTokenGetter(async () => 'legacy-zero-argument-getter');
    await customFetch('/api/members');
    assert.equal(received.at(-1)?.authorization, 'Bearer legacy-zero-argument-getter');
    setAuthTokenGetter(createWebSessionTokenGetter(async () => null, origin, () => true));
    const before = received.length;
    await assert.rejects(customFetch('/api/members'), SessionRestoringError);
    assert.equal(received.length, before, 'never send an unauthenticated write/read after token retrieval fails');
  } finally {
    setAuthTokenGetter(null);
    globalThis.fetch = originalFetch;
  }
});
