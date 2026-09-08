import { describe, expect, it, vi } from 'vitest';
import { dashboardAccess } from './gameDashboardAccess.js';
import { signTypedToken, verifyTypedToken } from './auth.js';

const origin = 'https://worker.test';
const env = { GAME_DASH_KEY: 'synthetic-dashboard-key', JWT_SECRET: 'synthetic-signing-secret' };
const deps = () => ({ compareSecret: (a, b) => a === b, limit: vi.fn(async () => true), readText: (r) => r.text() });
const post = (headers = {}) => new Request(`${origin}/game/dashboard`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams({ key: env.GAME_DASH_KEY }) });

describe('dashboard access', () => {
  it('과거 query 키는 인증 없이 깨끗한 로그인 URL로만 리다이렉트한다', async () => {
    const d = deps(); d.compareSecret = vi.fn();
    const { response } = await dashboardAccess(new Request(`${origin}/game/dashboard?key=${env.GAME_DASH_KEY}`), env, d);
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/game/dashboard');
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(d.compareSecret).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(env.GAME_DASH_KEY);
  });
  it('동일 출처 폼만 10분 HttpOnly·Secure·Strict 목적 분리 세션을 발급한다', async () => {
    const { response } = await dashboardAccess(post(), env, deps());
    const cookie = response.headers.get('Set-Cookie');
    expect(response.status).toBe(303);
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=600', 'Path=/game/dashboard']) expect(cookie).toContain(flag);
    expect(cookie).not.toContain(env.GAME_DASH_KEY);
    const token = cookie.split(';')[0].split('=')[1];
    expect((await verifyTypedToken(env.JWT_SECRET, token, 'dashboard')).sub).toBe('dashboard');
    expect(await verifyTypedToken(env.JWT_SECRET, token, 'teacher')).toBeNull();
    const allowed = await dashboardAccess(new Request(`${origin}/game/dashboard`, { headers: { Cookie: cookie.split(';')[0] } }), env, deps());
    expect(allowed.response).toBeNull();
    expect(allowed.headers['Content-Security-Policy']).toContain(`script-src 'nonce-${allowed.nonce}'`);
    expect(allowed.headers['Content-Security-Policy']).not.toContain("script-src 'unsafe-inline'");
  });
  it('외부 폼·인증 제한·다른 용도/만료 세션을 거부한다', async () => {
    expect((await dashboardAccess(post({ Origin: 'https://other.test' }), env, deps())).response.status).toBe(403);
    const d = deps(); d.limit = async () => false;
    expect((await dashboardAccess(post(), env, d)).response.status).toBe(429);
    for (const token of [await signTypedToken(env.JWT_SECRET, 'game', 'g-synthetic', 600), await signTypedToken(env.JWT_SECRET, 'dashboard', 'dashboard', -1)]) {
      expect((await dashboardAccess(new Request(`${origin}/game/dashboard`, { headers: { Cookie: `__Secure-game_dashboard=${token}` } }), env, deps())).response.status).toBe(401);
    }
  });
});
