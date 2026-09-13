import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { signTypedToken } from '../lib/auth.js';
import { localD1 } from './helpers/localD1.js';
let local, env;
beforeEach(() => { local = localD1(); env = { GAME_DB: local.db, GAME_AE: { writeDataPoint: vi.fn() }, JWT_SECRET: 'analytics-test-only', CF_ANALYTICS_TOKEN: 'test' }; vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [] }))); });
afterEach(() => { local.close(); vi.unstubAllGlobals(); });
const request = (path, token, body, origin = 'https://tiantian-chinese.pages.dev') => worker.fetch(new Request(`https://worker.test${path}`, { method: body ? 'POST' : 'GET', headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, { waitUntil() {} });
it('allows the standalone origin only on login and authenticated reports', async () => {
  const origin = 'https://hanul-insights.pages.dev';
  expect((await request('/analytics/report', '', null, origin)).status).toBe(401);
  const token = await signTypedToken(env.JWT_SECRET, 'teacher', 'teacher', 600, { role: 'teacher' });
  const response = await request('/analytics/report', token, null, origin);
  expect(response.status).toBe(200);
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  expect((await request('/notifications', token, null, origin)).status).toBe(403);
});
it('report requires teacher identity; student/game and anonymous cannot read it', async () => {
  for (const token of ['', await signTypedToken(env.JWT_SECRET, 'game', 'user', 600), await signTypedToken(env.JWT_SECRET, 'student', 'personal:test', 600)]) expect((await request('/analytics/report', token)).status).toBe(401);
  const token = await signTypedToken(env.JWT_SECRET, 'teacher', 'teacher', 600, { role: 'teacher' });
  expect((await request('/analytics/report?days=7', token)).status).toBe(200);
  expect((await request('/analytics/report?days=999', token)).status).toBe(400);
  expect((await request('/analytics/report?source=invalid', token)).status).toBe(400);
});
it('allows official site collection without granting it access to other API routes', async () => {
  const body = { event: 'visit', service: 'site', sid: crypto.randomUUID(), id: crypto.randomUUID(), source: 'direct', at: Date.now() };
  expect((await request('/analytics/event', '', body, 'https://tiantianchinese.com')).status).toBe(204);
  expect((await request('/analytics/event', '', body, 'https://evil.test')).status).toBe(403);
  expect((await request('/analytics/report', '', null, 'https://tiantianchinese.com')).status).toBe(403);
  expect((await request('/analytics/event', '', { ...body, event: 'purchase' }, 'https://tiantianchinese.com')).status).toBe(400);
});

it('accepts tone events on the official site while rejecting instructor analytics', async () => {
  const body = { event: 'game_enter', service: 'tone', sid: crypto.randomUUID(), id: crypto.randomUUID(), source: 'direct', at: Date.now() };
  expect((await request('/analytics/event', '', body, 'https://tiantianchinese.com')).status).toBe(204);
  expect((await request('/analytics/event', '', { ...body, service: 'teacher' }, 'https://tiantianchinese.com')).status).toBe(400);
});
