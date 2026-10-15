import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { siteD1 } from './helpers/siteD1.js';
import { rateLimitCheck } from '../lib/securityStore.js';
import { signTypedToken, verifyTypedToken } from '../lib/auth.js';
import { handleSiteAdminAuthRoutes, authorizeSiteAdminRequest, siteAdminReady } from '../lib/siteAdminAuth.js';

const ORIGIN = 'https://site.example.invalid', WORKER = 'https://fixture.example.workers.dev';
const PASSWORD = 'Synthetic-admin-password42';
let local, env;
const cookie = response => response.headers.get('Set-Cookie')?.split(';')[0];
function request(path, { method = 'GET', body, session, headers = {}, url = `${WORKER}/api/site/admin${path}` } = {}) {
  return new Request(url, { method, headers: { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': '198.51.100.14',
    ...(session?.cookie ? { Cookie: session.cookie } : {}), ...(session?.csrfToken ? { 'X-CSRF-Token': session.csrfToken } : {}),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
}
const send = (path, options) => handleSiteAdminAuthRoutes(request(path, options), env);
async function bootstrap() {
  const response = await send('/session'); expect(response.status).toBe(200);
  return { cookie: cookie(response), ...(await response.json()) };
}
async function login(current) {
  const anonymous = current || await bootstrap();
  const response = await send('/auth/login', { method: 'POST', session: anonymous, body: { password: PASSWORD } });
  expect(response.status).toBe(200);
  return { cookie: cookie(response), ...(await response.json()) };
}
beforeEach(() => {
  local = siteD1(); local.sqlite.exec(readFileSync(new URL('../migrations/0014_site_admin_sessions.sql', import.meta.url), 'utf8'));
  env = { GAME_DB: local.db, SITE_ORIGIN: ORIGIN, SITE_ADMIN_ENABLED: 'true',
    SITE_SESSION_SECRET: 'synthetic-site-session-secret-32-characters', JWT_SECRET: 'synthetic-teacher-secret', AUTH_PASSWORD: PASSWORD };
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External network denied'); }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); local.close(); });

describe('independent opaque administrator session', () => {
  it('bootstraps anonymous CSRF with a host-only Strict HttpOnly cookie and hash-only storage', async () => {
    const response = await send('/session'), data = await response.json(), setCookie = response.headers.get('Set-Cookie');
    expect(data).toMatchObject({ authenticated: false, admin: null, csrfToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(setCookie).toMatch(/^__Host-hanul_site_admin=/); expect(setCookie).toContain('HttpOnly'); expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Strict'); expect(setCookie).toContain('Path=/'); expect(setCookie).not.toContain('Domain=');
    const row = local.sqlite.prepare('SELECT * FROM site_admin_sessions').get(), token = cookie(response).split('=')[1];
    expect(JSON.stringify(row)).not.toContain(token); expect(JSON.stringify(row)).not.toContain(data.csrfToken);
    expect(JSON.stringify(row)).not.toContain(PASSWORD); expect(JSON.stringify(row)).not.toContain(env.JWT_SECRET);
    expect(JSON.stringify(data)).not.toContain(token); expect(data).not.toHaveProperty('token');
    expect(row).toMatchObject({ role: null, revoked_at: null }); expect(row.expires_at - row.created_at).toBe(900);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_sessions').get().n).toBe(0);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store'); expect(fetch).not.toHaveBeenCalled();
  });
  it('rotates cookie and CSRF on password login, grants only teacher role and revokes the anonymous cookie', async () => {
    const anonymous = await bootstrap(), authenticated = await login(anonymous);
    expect(authenticated).toMatchObject({ authenticated: true, admin: { role: 'teacher' } });
    expect(authenticated.cookie).not.toBe(anonymous.cookie); expect(authenticated.csrfToken).not.toBe(anonymous.csrfToken);
    expect(await authorizeSiteAdminRequest(request('/products', { session: authenticated }), env)).toBeNull();
    expect((await authorizeSiteAdminRequest(request('/products', { session: anonymous }), env)).status).toBe(401);
    const rows = local.sqlite.prepare('SELECT * FROM site_admin_sessions ORDER BY role').all();
    expect(rows.find(row => row.role === null).revoked_at).not.toBeNull();
    const admin = rows.find(row => row.role === 'teacher'); expect(admin.expires_at - admin.created_at).toBe(28800);
    expect(JSON.stringify(authenticated)).not.toContain(env.JWT_SECRET); expect(JSON.stringify(authenticated)).not.toContain(PASSWORD);
  });
  it('refreshes the same session without extending its absolute expiry', async () => {
    const authenticated = await login(), row = local.sqlite.prepare("SELECT * FROM site_admin_sessions WHERE role='teacher'").get();
    const response = await send('/session', { session: authenticated });
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(await response.json()).toMatchObject({ csrfToken: authenticated.csrfToken, expiresAt: authenticated.expiresAt });
    expect(local.sqlite.prepare("SELECT expires_at FROM site_admin_sessions WHERE role='teacher'").get().expires_at).toBe(row.expires_at);
  });
  it('revokes authenticated logout and rotates an anonymous cookie without touching member cookies', async () => {
    const authenticated = await login();
    const response = await send('/auth/logout', { method: 'POST', session: authenticated, body: {} }), data = await response.json();
    expect(response.status).toBe(200); expect(data).toMatchObject({ authenticated: false, admin: null });
    expect(cookie(response)).not.toBe(authenticated.cookie); expect(data.csrfToken).not.toBe(authenticated.csrfToken);
    expect((await authorizeSiteAdminRequest(request('/products', { session: authenticated }), env)).status).toBe(401);
    expect(local.sqlite.prepare("SELECT revoked_at FROM site_admin_sessions WHERE role='teacher'").get().revoked_at).not.toBeNull();
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_sessions').get().n).toBe(0);
  });
  it('never treats a website member cookie as administrator authentication', async () => {
    const authenticated = await login(), memberName = authenticated.cookie.replace('__Host-hanul_site_admin', '__Host-hanul_site');
    expect((await authorizeSiteAdminRequest(request('/products', { headers: { Cookie: memberName } }), env)).status).toBe(401);
  });
  it('rejects duplicate administrator cookies rather than choosing one', async () => {
    const authenticated = await login();
    const denied = await authorizeSiteAdminRequest(request('/products', { headers: { Cookie: `${authenticated.cookie}; ${authenticated.cookie}` } }), env);
    expect(denied.status).toBe(401);
  });
  it('uses a different insecure cookie only for explicitly configured localhost development', async () => {
    env.SITE_ORIGIN = 'http://localhost:4327'; env.SITE_ENVIRONMENT = 'development';
    const response = await send('/session', { headers: { Origin: env.SITE_ORIGIN } });
    expect(response.status).toBe(200); expect(response.headers.get('Set-Cookie')).toMatch(/^hanul_site_admin_dev=/);
    expect(response.headers.get('Set-Cookie')).not.toContain('Secure');
    env.SITE_ENVIRONMENT = 'production'; expect(siteAdminReady(env)).toBe(false);
  });
});

describe('origin, CSRF, credential rotation and storage failures', () => {
  it.each([{ Origin: 'https://other.example.invalid' }, { Origin: '' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }])
    ('rejects unsafe cookie request metadata %j before session creation', async headers => {
      expect((await send('/session', { headers })).status).toBe(403);
      expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_admin_sessions').get().n).toBe(0);
    });
  it.each(['SITE_ADMIN_ENABLED','AUTH_PASSWORD','JWT_SECRET','SITE_SESSION_SECRET','GAME_DB'])('fails closed if required configuration %s is missing', async key => {
    env[key] = undefined;
    expect(siteAdminReady(env)).toBe(false); expect((await send('/session')).status).toBe(503);
  });
  it('requires a bootstrapped cookie and matching CSRF for login, logout and administrator writes', async () => {
    expect((await send('/auth/login', { method: 'POST', body: { password: PASSWORD } })).status).toBe(401);
    const anonymous = await bootstrap();
    const invalid = { ...anonymous, csrfToken: 'x'.repeat(43) };
    expect((await send('/auth/login', { method: 'POST', session: invalid, body: { password: PASSWORD } })).status).toBe(403);
    const authenticated = await login(anonymous);
    expect((await authorizeSiteAdminRequest(request('/products', { method: 'POST', session: { cookie: authenticated.cookie }, body: {} }), env)).status).toBe(403);
    expect((await send('/auth/logout', { method: 'POST', session: { ...authenticated, csrfToken: anonymous.csrfToken }, body: {} })).status).toBe(403);
    expect(await authorizeSiteAdminRequest(request('/products', { method: 'POST', session: authenticated, body: {} }), env)).toBeNull();
  });
  it.each(['SITE_SESSION_SECRET','JWT_SECRET','AUTH_PASSWORD'])('invalidates existing administrator authentication after %s rotation', async key => {
    const authenticated = await login(); env[key] += '-rotated';
    expect((await authorizeSiteAdminRequest(request('/products', { session: authenticated }), env)).status).toBe(401);
    const response = await send('/session', { session: authenticated }); expect(response.status).toBe(200);
    expect((await response.json()).authenticated).toBe(false); expect(cookie(response)).not.toBe(authenticated.cookie);
  });
  it('denies expired/revoked authentication and does not refresh past the eight-hour TTL', async () => {
    const authenticated = await login();
    const active = local.sqlite.prepare("SELECT * FROM site_admin_sessions WHERE role='teacher'").get();
    vi.spyOn(Date, 'now').mockReturnValue((active.expires_at+1)*1000);
    expect((await authorizeSiteAdminRequest(request('/products', { session: authenticated }), env)).status).toBe(401);
    expect((await send('/auth/logout', { method: 'POST', session: authenticated, body: {} })).status).toBe(401);
    expect((await (await send('/session', { session: authenticated })).json()).authenticated).toBe(false);
  });
  it('returns fixed 503 when the admin schema or security rate-limit storage is unavailable', async () => {
    local.sqlite.exec('DROP TABLE site_admin_sessions');
    expect((await send('/session')).status).toBe(503);
  });
  it('distinguishes limiter persistence errors from exhausted buckets as 503', async () => {
    const anonymous = await bootstrap(); local.sqlite.exec('DROP TABLE security_rate_limits');
    const response = await send('/auth/login', { method: 'POST', session: anonymous, body: { password: PASSWORD } });
    expect(response.status).toBe(503); expect((await response.json()).code).toBe('admin_unavailable');
    expect(local.sqlite.prepare("SELECT COUNT(*) AS n FROM site_admin_sessions WHERE role='teacher'").get().n).toBe(0);
  });
});

describe('bounded inputs, shared brute-force limits and constant-time password comparison', () => {
  it.each([{ password: PASSWORD, role: 'teacher' }, { password: 1 }, { password: '' }, [], '{"password":'])
    ('rejects unsupported password JSON %j without authentication', async body => {
      const anonymous = await bootstrap();
      expect((await send('/auth/login', { method: 'POST', session: anonymous, body })).status).toBe(400);
      expect(local.sqlite.prepare("SELECT COUNT(*) AS n FROM site_admin_sessions WHERE role='teacher'").get().n).toBe(0);
    });
  it('bounds actual streamed body even without Content-Length and rejects other content types', async () => {
    const anonymous = await bootstrap();
    expect((await send('/auth/login', { method: 'POST', session: anonymous, body: `{"password":"${'x'.repeat(5000)}"}` })).status).toBe(400);
    expect((await send('/auth/login', { method: 'POST', session: anonymous, body: { password: PASSWORD }, headers: { 'Content-Type': 'text/plain' } })).status).toBe(400);
  });
  it('shares the exact IP bucket with existing teacher login and cannot bypass its ten-attempt window', async () => {
    const anonymous = await bootstrap();
    for (let index=0; index<10; index++) expect(await rateLimitCheck(env, 'login:198.51.100.14', 10, 300)).toBe(true);
    const response = await send('/auth/login', { method: 'POST', session: anonymous, body: { password: PASSWORD } });
    expect(response.status).toBe(429); expect((await response.json()).code).toBe('admin_rate_limited');
  });
  it('shares the exact global teacher bucket across IPs', async () => {
    const anonymous = await bootstrap();
    for (let index=0; index<30; index++) expect(await rateLimitCheck(env, 'login:teacher', 30, 300)).toBe(true);
    expect((await send('/auth/login', { method: 'POST', session: anonymous, body: { password: PASSWORD } })).status).toBe(429);
  });
  it('counts invalid administrator passwords in the existing teacher buckets without leaking secrets', async () => {
    const anonymous = await bootstrap();
    for (let index=0; index<10; index++) {
      const response = await send('/auth/login', { method: 'POST', session: anonymous, body: { password: 'wrong' } });
      expect(response.status).toBe(401); expect(JSON.stringify(await response.json())).not.toContain(PASSWORD);
    }
    expect(await rateLimitCheck(env, 'login:198.51.100.14', 10, 300)).toBe(false);
  });
  it('uses native constant-time digest comparison where Workers supports it', async () => {
    const anonymous = await bootstrap(), original = crypto.subtle, compare = vi.fn(timingSafeEqual);
    const subtle = { timingSafeEqual: compare };
    for (const method of ['digest','importKey','sign','verify']) subtle[method] = original[method].bind(original);
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto), randomUUID: crypto.randomUUID.bind(crypto), subtle });
    expect((await send('/auth/login', { method: 'POST', session: anonymous, body: { password: 'wrong' } })).status).toBe(401);
    await login(anonymous); expect(compare).toHaveBeenCalledTimes(2);
  });
});

describe('legacy typed teacher Bearer isolation and atomic rotation', () => {
  const authorizeTeacher = async (request, env) => {
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
    return await verifyTypedToken(env.JWT_SECRET, token, 'teacher') ? null : Response.json({ error: 'Unauthorized' }, { status: 401 });
  };
  it('preserves existing teacher Bearer verification even when website admin is disabled or storage absent', async () => {
    const token = await signTypedToken(env.JWT_SECRET, 'teacher', 'teacher', 600, { role: 'teacher' });
    const legacyEnv = { JWT_SECRET: env.JWT_SECRET };
    const legacy = request('/products', { headers: { Authorization: `Bearer ${token}`, Origin: 'http://localhost:5173' } });
    expect(await authorizeSiteAdminRequest(legacy, legacyEnv, { authorizeTeacher })).toBeNull();
  });
  it.each([['game','game-player',{}],['student','personal:fixture',{}],['dashboard','dashboard',{}]])('never promotes a valid %s Bearer to teacher', async (purpose, subject, claims) => {
    const token = await signTypedToken(env.JWT_SECRET, purpose, subject, 600, claims), authenticated = await login();
    const response = await authorizeSiteAdminRequest(request('/products', { session: authenticated, headers: { Authorization: `Bearer ${token}` } }), env, { authorizeTeacher });
    expect(response.status).toBe(401);
  });
  it('fails closed without a verifier or when a verifier returns undefined instead of explicit success', async () => {
    const response = await authorizeSiteAdminRequest(request('/products', { headers: { Authorization: 'Bearer arbitrary' } }), env);
    expect(response.status).toBe(401);
    expect((await authorizeSiteAdminRequest(request('/products', { headers: { Authorization: 'Bearer arbitrary' } }), env,
      { authorizeTeacher: async () => undefined })).status).toBe(401);
  });
  it('rotates a pre-login cookie at most once under simultaneous correct logins', async () => {
    const anonymous = await bootstrap();
    const results = await Promise.all([send('/auth/login', { method: 'POST', session: anonymous, body: { password: PASSWORD } }),
      send('/auth/login', { method: 'POST', session: anonymous, body: { password: PASSWORD } })]);
    expect(results.map(result => result.status).sort()).toEqual([200,401]);
    expect(local.sqlite.prepare("SELECT COUNT(*) AS n FROM site_admin_sessions WHERE role='teacher' AND revoked_at IS NULL").get().n).toBe(1);
  });
  it('denies a write if revocation occurs during async CSRF verification', async () => {
    const authenticated = await login(), originalVerify = crypto.subtle.verify.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'verify').mockImplementation(async (...args) => {
      const verified = await originalVerify(...args);
      local.sqlite.prepare("UPDATE site_admin_sessions SET revoked_at=created_at WHERE role='teacher'").run(); return verified;
    });
    expect((await authorizeSiteAdminRequest(request('/products', { method: 'POST', session: authenticated, body: {} }), env)).status).toBe(401);
  });
  it('handles only its three exact routes and refuses to use cookies outside the administrator API namespace', async () => {
    expect(await send('/products')).toBeNull(); const authenticated = await login();
    expect((await authorizeSiteAdminRequest(request('/products', { session: authenticated, url: `${WORKER}/api/site/student-app/context` }), env)).status).toBe(401);
    expect((await send('/session', { method: 'POST', body: {} })).status).toBe(405);
  });
});
