import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { signTypedToken, verifyTypedToken } from '../lib/auth.js';
import { signAuthState, verifyAuthState, pkceChallenge } from '../lib/oauth.js';
import { putChallenge } from '../lib/securityStore.js';
import { localD1 } from './helpers/localD1.js';

const ORIGIN = 'http://localhost:5173';
const SECRET = 'integration-test-only-secret';
const transaction = 't'.repeat(43);
const verifier = 'v'.repeat(43);
let local, env;
const ctx = { waitUntil: promise => promise.catch(() => {}) };
const request = (path, { token, body, origin = ORIGIN, method = body ? 'POST' : 'GET', headers = {} } = {}) => worker.fetch(new Request(`https://worker.test${path}`, {
  method, headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
  ...(body ? { body: JSON.stringify(body) } : {}),
}), env, ctx);

beforeEach(() => {
  local = localD1();
  env = { GAME_DB: local.db, JWT_SECRET: SECRET, AUTH_PASSWORD: 'test-teacher-password', GAME_GOOGLE_CLIENT_ID: 'test-google-client', NOTION_TOKEN: 'test-notion-token' };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ results: [], has_more: false })));
});
afterEach(() => { local.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('production auth handlers with isolated data', () => {
  it('only teacher tokens pass the teacher middleware; student/game/state cannot call upstream', async () => {
    const tokens = [
      await signTypedToken(SECRET, 'student', 'personal:student-a', 600),
      await signTypedToken(SECRET, 'game', 'user-a', 600),
      await signAuthState(SECRET, { provider: 'google', redirect: ORIGIN + '/game/tone', transaction, challenge: await pkceChallenge(verifier) }),
    ];
    for (const token of tokens) {
      expect((await request('/booking/time-slots', { token })).status).toBe(401);
      expect((await request('/v1/pages/12345678-1234-1234-1234-123456789abc', { token })).status).toBe(401);
    }
    expect(fetch).not.toHaveBeenCalled();
    const teacher = await signTypedToken(SECRET, 'teacher', 'teacher', 600, { role: 'teacher' });
    expect((await request('/booking/time-slots', { token: teacher })).status).toBe(200);
  });

  it('student A cannot access student B; absent enforcement settings still require authentication', async () => {
    const token = await signTypedToken(SECRET, 'student', 'personal:student-a', 600);
    expect((await request('/notice/student/student-b', { token })).status).toBe(401);
    expect((await request('/notice/student/student-a')).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    expect((await request('/notice/student/student-a', { token })).status).toBe(200);
  });

  it('a challenge-less OAuth start fails before redirecting; signed state contains the browser binding', async () => {
    expect((await request('/game/auth/google/start?redirect=' + encodeURIComponent(ORIGIN + '/game/tone'))).status).toBe(400);
    const challenge = await pkceChallenge(verifier);
    const params = new URLSearchParams({ redirect: ORIGIN + '/game/tone', transaction, code_challenge: challenge });
    const response = await request('/game/auth/google/start?' + params);
    expect(response.status).toBe(302);
    const state = new URL(response.headers.get('Location')).searchParams.get('state');
    expect(await verifyAuthState(SECRET, state)).toMatchObject({ transaction, challenge });
    expect(await verifyTypedToken(SECRET, state, 'teacher')).toBeNull();
  });

  it('login code requires the initiating verifier, then issues once and cannot be replayed', async () => {
    const code = 'a'.repeat(64);
    local.sqlite.prepare("INSERT INTO game_users (id,provider,social_id,game_data,created_at,last_seen_at) VALUES ('user-a','google','social-a','{}','now','now')").run();
    await putChallenge(env, 'oauth-code', code, await pkceChallenge(verifier), { sub: 'user-a', transaction, redirect: ORIGIN + '/game/tone' }, 90);
    const wrong = await request('/game/auth/exchange', { body: { code, transaction, verifier: 'x'.repeat(43) } });
    expect(wrong.status).toBe(401);
    const responses = await Promise.all(Array.from({ length: 8 }, () => request('/game/auth/exchange', { body: { code, transaction, verifier } })));
    expect(responses.filter(response => response.status === 200)).toHaveLength(1);
    expect(responses.filter(response => response.status === 401)).toHaveLength(7);
    const data = await responses.find(response => response.status === 200).json();
    expect((await verifyTypedToken(SECRET, data.token, 'game')).sub).toBe('user-a');
    expect(await verifyTypedToken(SECRET, data.token, 'teacher')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a complete fake Google callback returns only a one-time code and rejects callback replay', async () => {
    const params = new URLSearchParams({ redirect: ORIGIN + '/game/tone', transaction, code_challenge: await pkceChallenge(verifier) });
    const start = await request('/game/auth/google/start?' + params);
    const authorize = new URL(start.headers.get('Location'));
    expect(authorize.searchParams.get('nonce')).toBe(transaction);
    const claims = { sub: 'google-account', name: '가상 계정', iss: 'https://accounts.google.com', aud: env.GAME_GOOGLE_CLIENT_ID, nonce: transaction, exp: Math.floor(Date.now() / 1000) + 600 };
    const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
    fetch.mockImplementation(async (url) => {
      expect(url).toBe('https://oauth2.googleapis.com/token');
      return Response.json({ id_token: `header.${encoded}.signature` });
    });
    const callbackPath = '/game/auth/google/callback?' + new URLSearchParams({ code: 'fake-provider-code', state: authorize.searchParams.get('state') });
    const callback = await request(callbackPath);
    expect(callback.status).toBe(302);
    const back = new URL(callback.headers.get('Location'));
    const fragment = new URLSearchParams(back.hash.slice(1));
    expect(fragment.has('token')).toBe(false);
    expect(fragment.get('login_code')).toMatch(/^[a-f0-9]{64}$/);
    expect((await request(callbackPath)).status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(1);
    const exchange = await request('/game/auth/exchange', { body: { code: fragment.get('login_code'), transaction, verifier } });
    expect(exchange.status).toBe(200);
    expect((await exchange.json()).user.provider).toBe('google');
  });

  it('OTP concurrent verification creates only one student session, never a teacher token', async () => {
    await putChallenge(env, 'student-otp', 'ABCDEF123456', '123456', { verified: true }, 300);
    const responses = await Promise.all(Array.from({ length: 4 }, () => request('/personal/auth/verify-otp', { body: { token: 'ABCDEF123456', code: '123456' } })));
    expect(responses.filter(response => response.status === 200)).toHaveLength(1);
    const data = await responses.find(response => response.status === 200).json();
    expect((await verifyTypedToken(SECRET, data.session, 'student')).sub).toBe('personal:ABCDEF123456');
    expect(await verifyTypedToken(SECRET, data.session, 'teacher')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('missing security database or JWT secret never issues a login session', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    delete env.GAME_DB;
    const response = await request('/auth/login', { body: { password: env.AUTH_PASSWORD } });
    expect(response.status).toBe(429);
    expect((await response.json()).token).toBeUndefined();
    env.GAME_DB = local.db;
    delete env.JWT_SECRET;
    expect((await request('/auth/login', { body: { password: env.AUTH_PASSWORD } })).status).toBe(429);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('official game site origins', () => {
  it.each(['https://tiantianchinese.com', 'https://www.tiantianchinese.com', 'https://tiantianchinese.pages.dev'])('allows game CORS at %s without allowing teacher or student routes', async origin => {
    const preflight = await request('/game/me', { method: 'OPTIONS', origin });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    const anonymous = await request('/game/me', { origin });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    const gameToken = await signTypedToken(SECRET, 'game', 'user-a', 600);
    expect((await request('/game/me', { origin, token: gameToken })).status).toBe(404);
    expect((await request('/notifications', { origin })).status).toBe(403);
    expect((await request('/personal/auth/request-otp', { origin })).status).toBe(403);
    const params = new URLSearchParams({ redirect: origin + '/game/tone/', transaction, code_challenge: await pkceChallenge(verifier) });
    const start = await request('/game/auth/google/start?' + params, { origin });
    expect(start.status).toBe(302);
    const state = new URL(start.headers.get('Location')).searchParams.get('state');
    expect((await verifyAuthState(SECRET, state)).redirect).toBe(origin + '/game/tone/');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects lookalike site origins', async () => {
    for (const origin of ['https://tiantianchinese.com.evil.test', 'http://tiantianchinese.com']) {
      expect((await request('/game/me', { origin })).status).toBe(403);
      const options = await request('/game/me', { origin, method: 'OPTIONS' });
      expect(options.headers.get('Access-Control-Allow-Origin')).toBe('');
    }
  });
});

describe('official consultation origins', () => {
  it.each(['https://tiantianchinese.com', 'https://www.tiantianchinese.com', 'https://tiantianchinese.pages.dev'])('allows consultation POST preflight and validation errors at %s without granting sensitive routes', async origin => {
    const preflight = await request('/consult', { origin, method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toBe('POST');
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
    const invalid = await request('/consult', { origin, body: {} });
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(invalid.headers.get('Vary')).toBe('Origin');
    for (const [path, method] of [
      ['/auth/login', 'POST'], ['/notifications', 'GET'], ['/personal/auth/request-otp', 'POST'],
      ['/v1/pages/12345678-1234-1234-1234-123456789abc', 'GET'], ['/og-proxy?url=https%3A%2F%2Fblog.naver.com%2Fexample', 'GET'],
    ]) {
      const blocked = await request(path, { origin, method, ...(method === 'POST' ? { body: {} } : {}) });
      expect(blocked.status).toBe(403);
      expect(blocked.headers.has('Access-Control-Allow-Origin')).toBe(false);
      const options = await request(path, { origin, method: 'OPTIONS', headers: { 'Access-Control-Request-Method': method } });
      expect(options.headers.get('Access-Control-Allow-Origin')).toBe('');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('only allows the exact consultation path and POST method from the official site', async () => {
    const origin = 'https://tiantianchinese.com';
    for (const path of ['/consult/', '/consult/extra']) {
      expect((await request(path, { origin, body: {} })).status).toBe(403);
      const preflight = await request(path, { origin, method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST' } });
      expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('');
    }
    for (const method of ['GET', 'PUT', 'DELETE']) {
      expect((await request('/consult', { origin, method })).status).toBe(403);
      const preflight = await request('/consult', { origin, method: 'OPTIONS', headers: { 'Access-Control-Request-Method': method } });
      expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('');
    }
    expect((await request('/consult', { origin, method: 'OPTIONS' })).headers.get('Access-Control-Allow-Origin')).toBe('');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects lookalike and untrusted consultation origins before handling the body', async () => {
    for (const origin of ['https://tiantianchinese.com.evil.test', 'http://tiantianchinese.com', 'https://untrusted.example']) {
      expect((await request('/consult', { origin, body: {} })).status).toBe(403);
      const preflight = await request('/consult', { origin, method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST' } });
      expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves existing PWA consultation validation responses', async () => {
    const origin = 'https://tiantian-chinese.pages.dev';
    const response = await request('/consult', { origin, body: {} });
    expect(response.status).toBe(400);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps unexpected consultation errors readable from the official site', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const origin = 'https://tiantianchinese.com';
    const pending = [];
    const response = await worker.fetch(new Request('https://worker.test/consult', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, duplex: 'half',
      body: new ReadableStream({ start(controller) { controller.error(new Error('isolated consultation body failure')); } }),
    }), env, { waitUntil: promise => pending.push(promise) });
    await Promise.allSettled(pending);
    expect(response.status).toBe(500);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(response.headers.get('Vary')).toBe('Origin');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ error: 'Internal Server Error' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
