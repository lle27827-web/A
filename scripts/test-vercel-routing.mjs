import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const frontend = config.services['task-manager'];
const fallback = frontend.routes.find((route) => route.dest === '/index.html');

test('SPA routes select index.html and preserve the service runtime path override', () => {
  assert.ok(fallback, 'The static service needs an index.html destination, not only a path transform.');
  assert.deepEqual(fallback.methods, ['GET', 'HEAD']);
  assert.ok(fallback.transforms.some((transform) =>
    transform.type === 'request.path' && transform.op === 'set' && transform.args === '/index.html'));
});

test('raw route regex matches direct page loads and nested sign-in paths', () => {
  assert.ok(fallback);
  const pattern = new RegExp(fallback.src);
  for (const path of [
    '/', '/employees', '/employees/', '/employees/1', '/attendance',
    '/services', '/settings', '/revenue', '/cards',
    '/sign-in', '/sign-in/factor-one', '/sign-up', '/sign-up/verify-email-address',
  ]) {
    assert.ok(pattern.test(path), `${path} must load the SPA on refresh`);
  }
});

test('SPA fallback does not rewrite API requests or static asset paths', () => {
  assert.ok(fallback);
  const pattern = new RegExp(fallback.src);
  for (const path of [
    '/api', '/api/members', '/api/__clerk/v1/client',
    '/assets', '/assets/index-test.js', '/assets/index-test.css',
    '/favicon.svg', '/logo.svg', '/robots.txt', '/index.html',
  ]) {
    assert.equal(pattern.test(path), false, `${path} must keep its original routing`);
  }
});

test('public routing sends API traffic to the backend before the frontend catch-all', () => {
  for (const [path, service] of [
    ['/api/members', 'api-server'],
    ['/api/__clerk/v1/client', 'api-server'],
    ['/employees', 'task-manager'],
    ['/sign-in', 'task-manager'],
    ['/assets/index-test.js', 'task-manager'],
  ]) {
    const route = config.rewrites.find((rewrite) => new RegExp(`^${rewrite.source}$`).test(path));
    assert.equal(route?.destination.service, service, path);
  }
});
