import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secureTopics, TOPIC_KEYS } from './secure_ntfy_topics.mjs';

const env = Object.fromEntries([
  ['NTFY_TOKEN', 'test-credential'],
  ...TOPIC_KEYS.map((key, index) => [key, `private-test-${index}`]),
]);

function fakeServer({ capacity = 5, maliciousError = false } = {}) {
  const reservations = [];
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      if (maliciousError) throw new Error('test-credential/private-test-0');
      assert.equal(options.redirect, 'error');
      const path = new URL(url).pathname;
      if (path === '/v1/account') return Response.json({
        username: 'private-user', tokens: [{ token: 'another-secret' }],
        emails: ['private@example.test'], reservations,
        limits: { reservations: capacity },
        stats: { reservations_remaining: capacity - reservations.length },
      });
      if (path === '/v1/account/reservation') {
        assert.equal(options.method, 'POST');
        assert.equal(options.headers.Authorization, 'Bearer test-credential');
        reservations.push(JSON.parse(options.body));
        return Response.json({ success: true });
      }
      assert.match(path, /^\/private-test-\d\/auth$/);
      const owned = reservations.some(item => path === `/${item.topic}/auth`);
      return new Response(null, { status: owned && !options.headers.Authorization ? 403 : 200 });
    },
  };
}

test('check is read only and reports only safe aliases and counts', async () => {
  const server = fakeServer();
  const result = await secureTopics({ env, ...server });
  assert.equal(result.capacitySufficient, true);
  assert.equal(result.allProtected, false);
  assert.ok(server.calls.every(call => call.method === 'GET'));
  assert.doesNotMatch(JSON.stringify(result), /private-test|credential|private-user|another-secret|example\.test/);
});

test('apply reserves deny-all and verifies anonymous denial without publishing', async () => {
  const server = fakeServer();
  const result = await secureTopics({ env, mode: 'apply', ...server });
  assert.equal(result.allProtected, true);
  assert.equal(server.calls.filter(call => call.method === 'POST').length, 5);
  assert.ok(result.topics.every(item => item.authenticatedReadStatus === 200 && item.anonymousReadStatus === 403));
  const again = await secureTopics({ env, mode: 'apply', ...server });
  assert.equal(again.allProtected, true);
  assert.equal(server.calls.filter(call => call.method === 'POST').length, 5);
});

test('insufficient capacity never changes reservations or billing', async () => {
  const server = fakeServer({ capacity: 1 });
  await assert.rejects(secureTopics({ env, mode: 'apply', ...server }), /Insufficient existing/);
  assert.ok(server.calls.every(call => call.method === 'GET'));
});

test('native request errors never expose token or topic', async () => {
  const server = fakeServer({ maliciousError: true });
  await assert.rejects(secureTopics({ env, ...server }), error => {
    assert.equal(error.message, 'ntfy request failed or timed out');
    assert.doesNotMatch(error.message, /credential|private-test/);
    return true;
  });
});
