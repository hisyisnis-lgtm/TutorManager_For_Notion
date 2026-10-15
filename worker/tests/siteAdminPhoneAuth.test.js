import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { siteD1 } from './helpers/siteD1.js';
import { handleSiteAdminAuthRoutes, authorizeSiteAdminRequest, cleanupSiteAdminAuthState } from '../lib/siteAdminAuth.js';
import { handleSiteAuthRoutes } from '../lib/siteAuth.js';
import { siteAdminPhoneAllowlist } from '../lib/siteAdminPhoneAuth.js';

const ORIGIN = 'https://staff.example.invalid', PHONE = '01012345678', OTHER = '01087654321', UNKNOWN = '01011112222';
let local, env, sms, sendPhoneSms;
const cookie = response => response.headers.get('Set-Cookie')?.split(';')[0];
function request(path, { session, body, method = body ? 'POST' : 'GET', headers = {} } = {}) {
  return new Request(`${ORIGIN}/api/site${path}`, { method, headers: { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': '198.51.100.64',
    ...(session?.cookie ? { Cookie: session.cookie } : {}), ...(session?.csrfToken ? { 'X-CSRF-Token': session.csrfToken } : {}),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
const send = (path, options) => handleSiteAdminAuthRoutes(request(`/admin${path}`, options), env, { sendPhoneSms });
async function bootstrap() {
  const response = await send('/session'); expect(response.status).toBe(200);
  return { cookie: cookie(response), ...await response.json() };
}
async function challenge(session, phone = PHONE) {
  const response = await send('/auth/phone/request', { session, body: { phone } }); expect(response.status).toBe(200);
  return { ...await response.json(), code: sms.at(-1)?.text.match(/\[(\d{6})\]/)?.[1] };
}
const verify = (session, value) => send('/auth/phone/verify', { session, body: { challengeId: value.challengeId, code: value.code } });
async function login() {
  const session = await bootstrap(), value = await challenge(session), response = await verify(session, value);
  expect(response.status).toBe(200); return { cookie: cookie(response), ...await response.json() };
}
function releaseCooldown() { local.sqlite.exec('UPDATE site_phone_send_cooldowns SET expires_at=0'); }
beforeEach(() => {
  local = siteD1();
  local.sqlite.exec(readFileSync(new URL('../migrations/0014_site_admin_sessions.sql', import.meta.url), 'utf8'));
  local.sqlite.exec('BEGIN IMMEDIATE');
  local.sqlite.exec(readFileSync(new URL('../migrations/0028_site_phone_auth.sql', import.meta.url), 'utf8')); local.sqlite.exec('COMMIT');
  local.sqlite.exec(readFileSync(new URL('../migrations/0031_site_admin_phone_auth.sql', import.meta.url), 'utf8'));
  env = { GAME_DB: local.db, SITE_ORIGIN: ORIGIN, SITE_ADMIN_ENABLED: 'true', SITE_SESSION_SECRET: 'synthetic-admin-phone-secret-longer-than-32',
    JWT_SECRET: 'synthetic-teacher-signing-key', AUTH_PASSWORD: 'synthetic-staff-password', SITE_PHONE_ENABLED: 'true',
    SOLAPI_API_KEY: 'synthetic-key', SOLAPI_API_SECRET: 'synthetic-secret', SOLAPI_SENDER: '01000000000',
    SITE_ADMIN_PHONE_ALLOWLIST: JSON.stringify([{ name: '합성 운영자 가', phone: PHONE }, { name: '합성 운영자 나', phone: OTHER }]) };
  sms = []; sendPhoneSms = vi.fn(async (to, text) => { sms.push({ to, text }); return { ok: true, state: 'accepted' }; });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network is forbidden'); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); local.close(); });

describe('private staff phone configuration and session boundaries', () => {
  it('cleans expired OTP and revoked admin sessions without deleting a live login', async () => {
    const active = await login();
    await cleanupSiteAdminAuthState(env);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_admin_phone_challenges').get().n).toBe(0);
    expect((await send('/session', { session: active })).status).toBe(200);
    expect(await authorizeSiteAdminRequest(request('/admin/content', { session: active }), env)).toBeNull();
    local.sqlite.exec('UPDATE site_admin_sessions SET created_at=created_at-28801,expires_at=expires_at-28801');
    await cleanupSiteAdminAuthState(env);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_admin_sessions').get().n).toBe(0);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_admin_phone_sessions').get().n).toBe(0);
  });
  it('reports the longest daily/number/hourly wait when more than one limit blocks sending', async () => {
    const anonymous = await bootstrap();
    for (let index = 0; index < 5; index++) { releaseCooldown(); await challenge(anonymous); }
    env.SITE_PHONE_DAILY_LIMIT = '5';
    const denied = await send('/auth/phone/request', { session: anonymous, body: { phone: PHONE } });
    expect(denied.status).toBe(429);
    const seconds = Math.floor(Date.now() / 1000), boundary = 86400 - ((seconds + 9 * 3600) % 86400);
    expect(Number(denied.headers.get('Retry-After'))).toBeGreaterThanOrEqual(Math.max(3599, boundary - 1));
    expect(sendPhoneSms).toHaveBeenCalledTimes(5);
  });
  it('offers phone login only with valid private configuration and never publishes the allowlist', async () => {
    const session = await bootstrap(); expect(session.phoneLoginAvailable).toBe(true);
    expect(JSON.stringify(session)).not.toContain(PHONE); expect(JSON.stringify(session)).not.toContain('합성 운영자');
    for (const list of ['', '[]', '{}', JSON.stringify([{ phone: PHONE, name: '' }]), JSON.stringify([{ phone: PHONE, name: '가', role: 'admin' }]),
      JSON.stringify([{ phone: PHONE, name: '가' }, { phone: '+821012345678', name: '나' }])]) {
      env.SITE_ADMIN_PHONE_ALLOWLIST = list; expect(siteAdminPhoneAllowlist(env)).toBeNull();
      const next = await bootstrap(); expect(next.phoneLoginAvailable).toBe(false);
      expect((await send('/auth/phone/request', { session: next, body: { phone: PHONE } })).status).toBe(503);
    }
    expect(sendPhoneSms).not.toHaveBeenCalled();
  });
  it('logs a nominated phone into an opaque admin cookie without creating a public member or teacher JWT', async () => {
    const anonymous = await bootstrap(), value = await challenge(anonymous), response = await verify(anonymous, value), data = await response.json();
    expect(response.status).toBe(200); expect(data).toMatchObject({ authenticated: true, admin: { role: 'teacher' } });
    const authenticated = { cookie: cookie(response), ...data };
    expect(authenticated.cookie).not.toBe(anonymous.cookie); expect(authenticated.csrfToken).not.toBe(anonymous.csrfToken);
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly'); expect(response.headers.get('Set-Cookie')).toContain('SameSite=Strict');
    expect(await authorizeSiteAdminRequest(request('/admin/content', { session: authenticated }), env)).toBeNull();
    expect((await authorizeSiteAdminRequest(request('/admin/content', { session: anonymous }), env)).status).toBe(401);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_members').get().n).toBe(0);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_sessions').get().n).toBe(0);
    const binding = local.sqlite.prepare('SELECT * FROM site_admin_phone_sessions').get(); expect(binding.auth_method).toBe('phone');
    const stored = JSON.stringify(local.sqlite.prepare('SELECT * FROM site_admin_phone_challenges').all()) + JSON.stringify(binding);
    for (const raw of [PHONE, '+821012345678', value.code, env.SITE_SESSION_SECRET]) expect(stored).not.toContain(raw);
    expect(data).not.toHaveProperty('token'); expect(data).not.toHaveProperty('member'); expect(fetch).not.toHaveBeenCalled();
  });
  it('returns the same challenge response for other phones, without sending SMS or granting a role', async () => {
    const anonymous = await bootstrap();
    const original = crypto.getRandomValues.bind(crypto);
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(value => {
      if (value instanceof Uint32Array && value.length === 1) { value[0] = 42; return value; }
      return original(value);
    });
    const response = await send('/auth/phone/request', { session: anonymous, body: { phone: UNKNOWN } });
    expect(response.status).toBe(200); const value = await response.json();
    expect(value).toEqual({ challengeId: expect.any(String), expiresIn: 300, resendAfter: 60 }); expect(sendPhoneSms).not.toHaveBeenCalled();
    // Even knowledge of the deliberately predictable decoy code cannot grant a
    // staff role: eligibility is checked independently after proof verification.
    expect((await verify(anonymous, { ...value, code: '000042' })).status).toBe(400);
    expect(local.sqlite.prepare("SELECT COUNT(*) n FROM site_admin_sessions WHERE role='teacher'").get().n).toBe(0);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_phone_daily_usage').get().n).toBe(0);
    expect((await send('/auth/phone/request', { session: anonymous, body: { phone: UNKNOWN } })).status).toBe(429);
  });
  it.each([{ Origin: 'https://other.example.invalid' }, { 'Sec-Fetch-Site': 'same-site' }, { 'X-CSRF-Token': 'x'.repeat(43) }])
    ('rejects unsafe source or CSRF before sending SMS %j', async headers => {
      const anonymous = await bootstrap(); expect((await send('/auth/phone/request', { session: anonymous, body: { phone: PHONE }, headers })).status).toBe(403);
      expect(sendPhoneSms).not.toHaveBeenCalled();
    });
  it('never uses a member session to start or consume an administrator OTP', async () => {
    const memberResponse = await handleSiteAuthRoutes(request('/session'), env), member = { cookie: cookie(memberResponse), ...await memberResponse.json() };
    expect((await send('/auth/phone/request', { session: member, body: { phone: PHONE } })).status).toBe(401);
    const anonymous = await bootstrap(), value = await challenge(anonymous);
    expect((await verify(member, value)).status).toBe(401);
    expect(local.sqlite.prepare("SELECT COUNT(*) n FROM site_admin_sessions WHERE role='teacher'").get().n).toBe(0);
  });
  it('binds a challenge to its original anonymous admin cookie and CSRF snapshot', async () => {
    const first = await bootstrap(), second = await bootstrap(), value = await challenge(first);
    expect((await verify(second, value)).status).toBe(400);
    expect((await verify(first, value)).status).toBe(200);
  });
  it.each(['AUTH_PASSWORD', 'JWT_SECRET', 'SITE_SESSION_SECRET', 'SITE_ADMIN_PHONE_ALLOWLIST'])('invalidates phone sessions and challenges after %s rotation', async key => {
    const authenticated = await login(); releaseCooldown(); const anonymous = await bootstrap(), value = await challenge(anonymous);
    if (key === 'SITE_ADMIN_PHONE_ALLOWLIST') env[key] = JSON.stringify([{ name: '합성 운영자 나', phone: OTHER }]); else env[key] += '-rotated';
    expect((await authorizeSiteAdminRequest(request('/admin/content', { session: authenticated }), env)).status).toBe(401);
    expect((await verify(anonymous, value)).status).toBe(401);
  });
  it('keeps password recovery available with absent or malformed staff configuration', async () => {
    env.SITE_ADMIN_PHONE_ALLOWLIST = 'invalid'; const anonymous = await bootstrap();
    const response = await send('/auth/login', { session: anonymous, body: { password: env.AUTH_PASSWORD } });
    expect(response.status).toBe(200); expect((await response.json()).authenticated).toBe(true);
  });
});

describe('OTP consumption, delivery and shared SMS spending limits', () => {
  it('expires codes after five minutes and consumes at most five wrong attempts', async () => {
    const anonymous = await bootstrap(), value = await challenge(anonymous), wrong = value.code === '000000' ? '111111' : '000000';
    for (let index = 0; index < 5; index++) expect((await verify(anonymous, { ...value, code: wrong })).status).toBe(400);
    expect((await verify(anonymous, value)).status).toBe(400);
    expect(local.sqlite.prepare('SELECT attempts FROM site_admin_phone_challenges').get().attempts).toBe(5);
    releaseCooldown(); const next = await challenge(anonymous);
    local.sqlite.prepare('UPDATE site_admin_phone_challenges SET expires_at=0 WHERE id=?').run(next.challengeId);
    expect((await verify(anonymous, next)).status).toBe(400);
  });
  it('atomically consumes a valid challenge and anonymous cookie only once under simultaneous verifies', async () => {
    const anonymous = await bootstrap(), value = await challenge(anonymous), responses = await Promise.all([verify(anonymous, value), verify(anonymous, value)]);
    expect(responses.map(value => value.status).sort()).toEqual([200,400]);
    expect(local.sqlite.prepare("SELECT COUNT(*) n FROM site_admin_sessions WHERE role='teacher' AND revoked_at IS NULL").get().n).toBe(1);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_admin_phone_sessions').get().n).toBe(1);
    expect((await verify(anonymous, value)).status).toBe(401);
  });
  it('rejects a challenge if its session is revoked during asynchronous proof verification', async () => {
    const anonymous = await bootstrap(), value = await challenge(anonymous), original = crypto.subtle.verify.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'verify').mockImplementation(async (...args) => {
      const accepted = await original(...args);
      if (new TextDecoder().decode(args[3]).includes('phone-code:')) local.sqlite.prepare('UPDATE site_admin_sessions SET revoked_at=created_at').run();
      return accepted;
    });
    expect((await verify(anonymous, value)).status).toBe(400);
    expect(local.sqlite.prepare("SELECT COUNT(*) n FROM site_admin_sessions WHERE role='teacher'").get().n).toBe(0);
  });
  it('rejects a challenge if the allowlist changes during asynchronous proof verification', async () => {
    const anonymous = await bootstrap(), value = await challenge(anonymous), original = crypto.subtle.verify.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'verify').mockImplementation(async (...args) => {
      const accepted = await original(...args);
      if (new TextDecoder().decode(args[3]).includes('phone-code:')) env.SITE_ADMIN_PHONE_ALLOWLIST = JSON.stringify([{ name: '다른 운영자', phone: OTHER }]);
      return accepted;
    });
    expect((await verify(anonymous, value)).status).toBe(400);
    expect(local.sqlite.prepare("SELECT COUNT(*) n FROM site_admin_sessions WHERE role='teacher'").get().n).toBe(0);
  });
  it('reserves cost before sending and never authenticates failed or unknown delivery', async () => {
    const anonymous = await bootstrap(); sendPhoneSms.mockResolvedValue({ ok: false, state: 'unknown' });
    const response = await send('/auth/phone/request', { session: anonymous, body: { phone: PHONE } }); expect(response.status).toBe(503);
    const row = local.sqlite.prepare('SELECT * FROM site_admin_phone_challenges').get(); expect(row.delivery_state).toBe('unknown'); expect(row.consumed_at).not.toBeNull();
    expect(local.sqlite.prepare('SELECT sends FROM site_phone_daily_usage').get().sends).toBe(1);
    expect((await verify(anonymous, { challengeId: row.id, code: '123456' })).status).toBe(400);
    expect((await send('/auth/phone/request', { session: anonymous, body: { phone: PHONE } })).status).toBe(429);
  });
  it('shares per-number cooldown and daily quota with public member OTP in both directions', async () => {
    const admin = await bootstrap(), memberResponse = await handleSiteAuthRoutes(request('/session'), env), member = { cookie: cookie(memberResponse), ...await memberResponse.json() };
    const memberSend = phone => handleSiteAuthRoutes(request('/auth/phone/request', { session: member, body: { phone, purpose: 'signin' } }), env, { sendPhoneSms });
    expect((await memberSend(PHONE)).status).toBe(200);
    expect((await send('/auth/phone/request', { session: admin, body: { phone: PHONE } })).status).toBe(429);
    releaseCooldown(); await challenge(admin, OTHER);
    expect((await memberSend(OTHER)).status).toBe(429);
    releaseCooldown(); env.SITE_PHONE_DAILY_LIMIT = '2';
    expect((await send('/auth/phone/request', { session: admin, body: { phone: PHONE } })).status).toBe(429);
    expect((await memberSend(UNKNOWN)).status).toBe(429); expect(sendPhoneSms).toHaveBeenCalledTimes(2);
  });
  it('shares the public phone-number hourly budget rather than adding a second allowance', async () => {
    const admin = await bootstrap();
    for (let index = 0; index < 5; index++) { releaseCooldown(); await challenge(admin); }
    releaseCooldown(); const memberResponse = await handleSiteAuthRoutes(request('/session'), env), member = { cookie: cookie(memberResponse), ...await memberResponse.json() };
    const response = await handleSiteAuthRoutes(request('/auth/phone/request', { session: member, body: { phone: PHONE, purpose: 'signin' } }), env, { sendPhoneSms });
    expect(response.status).toBe(429); expect(sendPhoneSms).toHaveBeenCalledTimes(5);
  });
  it('fails closed on missing phone schema or quota storage without SMS', async () => {
    const anonymous = await bootstrap(); local.sqlite.exec('DROP TABLE site_phone_daily_usage');
    expect((await send('/auth/phone/request', { session: anonymous, body: { phone: PHONE } })).status).toBe(503); expect(sendPhoneSms).not.toHaveBeenCalled();
  });
});
