import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { localD1 } from './helpers/localD1.js';

let local, env;
const ctx = { waitUntil: promise => promise.catch(() => {}) };
beforeEach(() => {
  local = localD1();
  env = { GAME_DB: local.db, JWT_SECRET: 'preservation-test-secret', GAME_DASH_KEY: 'dashboard-test-key' };
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected external request'); }));
});
afterEach(() => { local.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('finder rollout preserves existing public routes and dashboard', () => {
  it.each(['/contact', '/consult'])('keeps POST-only official form CORS for %s', async path => {
    const response = await worker.fetch(new Request('https://worker.test' + path, {
      method: 'OPTIONS', headers: { Origin: 'https://tiantianchinese.com', 'Access-Control-Request-Method': 'POST' },
    }), env, ctx);
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://tiantianchinese.com');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST');
    const disallowed = await worker.fetch(new Request('https://worker.test' + path, {
      headers: { Origin: 'https://tiantianchinese.com' },
    }), env, ctx);
    expect(disallowed.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('still reaches contact validation without sending an email or using teacher login', async () => {
    const response = await worker.fetch(new Request('https://worker.test/contact', {
      method: 'POST', headers: { Origin: 'https://tiantianchinese.com', 'Content-Type': 'application/json' }, body: '{}',
    }), env, ctx);
    expect(response.status).toBe(400);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://tiantianchinese.com');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the existing short HttpOnly dashboard cookie login without Access configuration', async () => {
    const anonymous = await worker.fetch(new Request('https://worker.test/game/dashboard'), env, ctx);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.text()).toContain('<form');
    const login = await worker.fetch(new Request('https://worker.test/game/dashboard', {
      method: 'POST', headers: { Origin: 'https://worker.test', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ key: env.GAME_DASH_KEY }),
    }), env, ctx);
    expect(login.status).toBe(303);
    expect(login.headers.get('Location')).toBe('/game/dashboard');
    expect(login.headers.get('Set-Cookie')).toMatch(/__Secure-game_dashboard=.+; Path=\/game\/dashboard; Max-Age=600; HttpOnly; Secure; SameSite=Strict/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
