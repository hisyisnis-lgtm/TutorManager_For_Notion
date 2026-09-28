import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { signTypedToken, verifyTypedToken } from '../lib/auth.js';
import { pkceChallenge, verifyAuthState } from '../lib/oauth.js';
import { findOrCreateFinderUser, parseFinderProfile } from '../lib/finderDb.js';
import { readFileSync } from 'node:fs';
const profiles = JSON.parse(readFileSync(new URL('./fixtures/finder-profiles.json', import.meta.url), 'utf8'));
const freshFinderProfile = () => structuredClone(profiles.fresh);
const resetFinderProgress = () => structuredClone(profiles.reset);
import { localD1 } from './helpers/localD1.js';

const ORIGIN = 'http://localhost:5173';
const SECRET = 'finder-test-only-secret';
const transaction = 't'.repeat(43), verifier = 'v'.repeat(43);
let local, env;
const request = (path, { token, body, origin = ORIGIN, method = body ? 'POST' : 'GET' } = {}) => worker.fetch(new Request(`https://worker.test${path}`, {
  method, headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
}), env, { waitUntil: promise => promise.catch(() => {}) });

beforeEach(() => {
  local = localD1();
  env = { GAME_DB: local.db, JWT_SECRET: SECRET, GAME_GOOGLE_CLIENT_ID: 'test-google-client' };
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { local.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function account() {
  const user = await findOrCreateFinderUser(local.db, 'google', 'same-provider-subject');
  return { user, token: await signTypedToken(SECRET, 'finder', user.id, 600) };
}

describe('independent post-office account', () => {
  it('reuses the registered callback but separates state, exchange codes, identities and sessions', async () => {
    local.sqlite.prepare("INSERT INTO game_users (id, provider, social_id, nickname, game_data) VALUES ('attic-user', 'google', 'same-provider-subject', '다락방 닉네임', '{}')").run();
    const params = new URLSearchParams({ redirect: ORIGIN + '/game/tone-finder', transaction, code_challenge: await pkceChallenge(verifier) });
    const start = await request('/finder/auth/google/start?' + params);
    expect(start.status).toBe(302);
    const authorize = new URL(start.headers.get('Location'));
    expect(authorize.searchParams.get('redirect_uri')).toBe('https://worker.test/game/auth/google/callback');
    expect((await verifyAuthState(SECRET, authorize.searchParams.get('state'))).app).toBe('finder');
    const claims = { sub: 'same-provider-subject', name: '소셜 닉네임', iss: 'https://accounts.google.com', aud: env.GAME_GOOGLE_CLIENT_ID, nonce: transaction, exp: Math.floor(Date.now() / 1000) + 600 };
    fetch.mockResolvedValue(Response.json({ id_token: `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature` }));
    const callbackPath = '/game/auth/google/callback?' + new URLSearchParams({ code: 'fake-provider-code', state: authorize.searchParams.get('state') });
    const callback = await request(callbackPath);
    expect(callback.status).toBe(302);
    const fragment = new URLSearchParams(new URL(callback.headers.get('Location')).hash.slice(1));
    const body = { code: fragment.get('login_code'), transaction, verifier };
    expect((await request('/game/auth/exchange', { body })).status).toBe(401);
    expect((await request('/finder/auth/exchange', { body: { ...body, verifier: 'w'.repeat(43) } })).status).toBe(401);
    const exchange = await request('/finder/auth/exchange', { body });
    expect(exchange.status).toBe(200);
    const data = await exchange.json();
    expect(data.user.id).toMatch(/^finder:/);
    expect(data.user.nickname).toBeNull();
    expect(data.user.profile).toBeNull();
    expect((await verifyTypedToken(SECRET, data.token, 'finder')).sub).toBe(data.user.id);
    expect(await verifyTypedToken(SECRET, data.token, 'game')).toBeNull();
    expect((await request('/game/me', { token: data.token })).status).toBe(401);
    const atticToken = await signTypedToken(SECRET, 'game', 'attic-user', 600);
    expect((await request('/finder/me', { token: atticToken })).status).toBe(401);
    expect((await request('/finder/auth/exchange', { body })).status).toBe(401);
    expect((await request(callbackPath)).status).toBe(400);
    expect(local.sqlite.prepare('SELECT nickname FROM game_users').get().nickname).toBe('다락방 닉네임');
  });

  it('accepts captured real client profiles without stripping any fields', () => {
    for (const profile of [profiles.fresh, profiles.progressed, profiles.reset]) {
      expect(parseFinderProfile(profile)).toEqual(profile);
    }
  });

  it('allows only one concurrent save and rejects stale pre-reset progress', async () => {
    const { token } = await account();
    const profile = { ...freshFinderProfile(), xp: 30 };
    const responses = await Promise.all(Array.from({ length: 4 }, () => request('/finder/me', { token, method: 'PUT', body: { profile, revision: 0 } })));
    expect(responses.filter(r => r.status === 200)).toHaveLength(1);
    expect(responses.filter(r => r.status === 409)).toHaveLength(3);
    const reset = await request('/finder/me', { token, method: 'PUT', body: { profile: resetFinderProgress(profile), revision: 1 } });
    expect(reset.status).toBe(200);
    const stale = await request('/finder/me', { token, method: 'PUT', body: { profile, revision: 1 } });
    expect(stale.status).toBe(409);
    const data = await stale.json();
    expect(data.user.profile.xp).toBe(0);
    expect(data.user.revision).toBe(2);
  });

  it('rejects malformed numeric, prototype and overlarge records while retaining the previous save', async () => {
    const { token } = await account();
    const profile = freshFinderProfile();
    expect((await request('/finder/me', { token, method: 'PUT', body: { profile, revision: 0 } })).status).toBe(200);
    for (const invalid of [{ ...profile, xp: -1 }, { ...profile, rank: 3 }, { ...profile, level: 1.5 }, { ...profile, settings: { ...profile.settings, sfx: 'yes' } }, { ...profile, unexpected: true }]) {
      expect((await request('/finder/me', { token, method: 'PUT', body: { profile: invalid, revision: 1 } })).status).toBe(400);
    }
    const poisoned = JSON.parse(JSON.stringify(profile));
    poisoned.mistakes = JSON.parse('{"__proto__":{"remaining":1,"lastAt":"2026-09-27T00:00:00Z","tones":[1]}}');
    expect((await request('/finder/me', { token, method: 'PUT', body: { profile: poisoned, revision: 1 } })).status).toBe(400);
    expect((await request('/finder/me', { token, method: 'PUT', body: { profile: { ...profile, nickname: 'x'.repeat(110000) }, revision: 1 } })).status).toBe(413);
    const stored = await (await request('/finder/me', { token })).json();
    expect(stored.user.revision).toBe(1);
    expect(stored.user.profile).toEqual(profile);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('scopes official-site CORS to the finder API and prevents accessing another finder account', async () => {
    const { token, user } = await account();
    const other = await findOrCreateFinderUser(local.db, 'google', 'other-user');
    for (const origin of ['https://tiantianchinese.com', 'https://www.tiantianchinese.com']) {
      const response = await request('/finder/me', { token, origin });
      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      expect((await response.json()).user.id).toBe(user.id);
      expect((await request('/booking/time-slots', { token, origin })).status).toBe(403);
    }
    expect(other.id).not.toBe(user.id);
    expect((await request('/finder/me', { token, origin: 'https://tiantianchinese.com.evil.test' })).status).toBe(403);
  });
});
