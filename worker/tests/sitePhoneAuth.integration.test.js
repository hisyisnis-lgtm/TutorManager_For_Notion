import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { siteD1 } from './helpers/siteD1.js';
import { handleSiteAuthRoutes, cleanupSiteAuthState } from '../lib/siteAuth.js';
import { normalizeSitePhone, maskSitePhone, sitePhoneDailyLimit, sitePhoneReady, phoneQuotaDay } from '../lib/sitePhoneAuth.js';

const ORIGIN = 'https://tiantianchinese.com', PHONE = '01012345678', OTHER = '01087654321';
let local, env, sms, sendSms;
const cookie = response => response.headers.get('Set-Cookie')?.split(';')[0];
function request(path, { session, body, method = body ? 'POST' : 'GET', origin = ORIGIN, csrf = true, ip = '198.51.100.34' } = {}) {
  return new Request(`${ORIGIN}/api/site${path}`, { method, headers: { ...(origin ? { Origin: origin } : {}), 'CF-Connecting-IP': ip,
    ...(session?.cookie ? { Cookie: session.cookie } : {}), ...(csrf && session?.csrfToken ? { 'X-CSRF-Token': session.csrfToken } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
const send = (path, options) => handleSiteAuthRoutes(request(path, options), env, { sendPhoneSms: sendSms });
async function guest() { const response = await send('/session'); expect(response.status).toBe(200); return { cookie: cookie(response), ...await response.json() }; }
async function challenge(session, phone = PHONE, purpose = 'signin') {
  const response = await send('/auth/phone/request', { session, body: { phone, purpose } });
  expect(response.status).toBe(200); const result = await response.json();
  return { ...result, code: sms.at(-1).text.match(/\[(\d{6})\]/)[1] };
}
async function verified(session, phone = PHONE, purpose = 'signin') {
  const value = await challenge(session, phone, purpose), response = await send('/auth/phone/verify', { session, body: { challengeId: value.challengeId, code: value.code } });
  expect(response.status).toBe(200); return { ...value, ...await response.json(), response };
}
async function registered(phone = PHONE) {
  const anonymous = await guest(), proof = await verified(anonymous, phone);
  const response = await send('/auth/phone/signup', { session: anonymous, body: { registrationToken: proof.registrationToken, name: '합성 회원', termsAccepted: true, privacyAccepted: true } });
  expect(response.status).toBe(201); return { cookie: cookie(response), ...await response.json() };
}
async function social(phone = '') {
  const session = await guest(), id = crypto.randomUUID(), at = new Date().toISOString();
  local.sqlite.prepare(`INSERT INTO site_members(id,status,name,phone,member_code,customer_key,provider,provider_subject,terms_accepted_at,privacy_accepted_at,created_at,updated_at)
    VALUES(?,'active','소셜 회원',?,?,?,'google',?,?,?,?,?)`).run(id, phone, `CODE-${id}`, `CUSTOMER-${id}`, `GOOGLE-${id}`, at, at, at, at);
  local.sqlite.prepare("INSERT INTO site_member_identities VALUES('google',?,?,NULL,?)").run(`GOOGLE-${id}`, id, at);
  local.sqlite.prepare('UPDATE site_sessions SET member_id=? WHERE member_id IS NULL AND id=(SELECT id FROM site_sessions ORDER BY created_at DESC LIMIT 1)').run(id);
  const response = await send('/session', { session }); return { ...session, ...await response.json() };
}
function releaseCooldown() { local.sqlite.exec('UPDATE site_phone_send_cooldowns SET expires_at=0'); }

beforeEach(() => {
  local = siteD1(); local.sqlite.exec('BEGIN IMMEDIATE');
  local.sqlite.exec(readFileSync(new URL('../migrations/0028_site_phone_auth.sql', import.meta.url), 'utf8')); local.sqlite.exec('COMMIT');
  sms = []; sendSms = vi.fn(async (to, text) => { sms.push({ to, text }); return { ok: true, state: 'accepted' }; });
  env = { GAME_DB: local.db, SITE_SESSION_SECRET: 'synthetic-phone-session-secret-longer-than-32', SITE_PHONE_ENABLED: 'true',
    SOLAPI_API_KEY: 'synthetic-key', SOLAPI_API_SECRET: 'synthetic-secret', SOLAPI_SENDER: '01000000000' };
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Real network is forbidden'); }));
});
afterEach(() => { local.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('phone OTP configuration and cost boundaries', () => {
  it('normalizes Korean mobile identities and masks only the owner identity DTO', () => {
    expect(normalizeSitePhone(PHONE)).toBe('+821012345678'); expect(normalizeSitePhone('+82 10-1234-5678')).toBe('+821012345678');
    for (const value of ['0212345678', '01112345678', '+12025550123', '0101234567', '01012345678x', null]) expect(normalizeSitePhone(value)).toBeNull();
    expect(maskSitePhone(PHONE)).toBe('010-****-5678'); expect(phoneQuotaDay(Date.parse('2026-10-15T15:00:00Z') / 1000)).toBe('2026-10-16');
  });
  it('is disabled until explicitly enabled with valid delivery configuration and a daily cap', async () => {
    expect(sitePhoneDailyLimit({})).toBe(100);
    for (const value of ['', '0', '-1', '1.5', '10001', 100, null]) expect(sitePhoneDailyLimit({ SITE_PHONE_DAILY_LIMIT: value })).toBeNull();
    for (const change of [{ SITE_PHONE_ENABLED: 'false' }, { SOLAPI_SENDER: '' }, { SITE_PHONE_DAILY_LIMIT: 'bad' }]) {
      const checked = { ...env, ...change }; expect(sitePhoneReady(checked)).toBe(false);
      const session = await guest(), response = await handleSiteAuthRoutes(request('/auth/phone/request', { session, body: { phone: PHONE, purpose: 'signin' } }), checked, { sendPhoneSms: sendSms });
      expect(response.status).toBe(503);
    }
    expect(sendSms).not.toHaveBeenCalled();
  });
  it('stores an HMAC proof and charges a persistent reservation once, with no PII or code in its response', async () => {
    const session = await guest(), value = await challenge(session);
    expect(value.expiresIn).toBe(300); expect(value.resendAfter).toBe(60); expect(sms[0].to).toBe(PHONE); expect(sms[0].text).toContain('하늘하늘중국어');
    const row = local.sqlite.prepare('SELECT * FROM site_phone_challenges').get(); expect(row.proof_hash).not.toContain(value.code);
    expect(row.phone_e164).toBe('+821012345678'); expect(row.phone_hash).not.toContain(PHONE);
    expect(local.sqlite.prepare('SELECT sends FROM site_phone_daily_usage').get().sends).toBe(1);
    const retry = await send('/auth/phone/request', { session, body: { phone: PHONE, purpose: 'signin' } }); expect(retry.status).toBe(429); expect(sendSms).toHaveBeenCalledTimes(1);
  });
  it('atomically admits only one concurrent send at the global daily limit across numbers and sessions', async () => {
    env.SITE_PHONE_DAILY_LIMIT = '1'; const sessions = await Promise.all([guest(), guest()]);
    const result = await Promise.all(sessions.map((session, index) => send('/auth/phone/request', { session, body: { phone: index ? OTHER : PHONE, purpose: 'signin' } })));
    expect(result.map(response => response.status).sort()).toEqual([200, 429]); expect(sendSms).toHaveBeenCalledTimes(1);
    expect(local.sqlite.prepare('SELECT sends FROM site_phone_daily_usage').get().sends).toBe(1);
  });
  it.each(['failed', 'unknown', 'throw'])('invalidates a %s delivery without retrying or accepting delayed codes', async state => {
    sendSms.mockImplementation(async () => { if (state === 'throw') throw new Error('Private provider details'); return { ok: false, state }; });
    const session = await guest(), response = await send('/auth/phone/request', { session, body: { phone: PHONE, purpose: 'signin' } });
    expect(response.status).toBe(503); expect(sendSms).toHaveBeenCalledTimes(1);
    const row = local.sqlite.prepare('SELECT * FROM site_phone_challenges').get(); expect(row.consumed_at).not.toBeNull();
    expect((await send('/auth/phone/verify', { session, body: { challengeId: row.id, code: '000000' } })).status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain('Private');
  });
  it('bounds sender and recipient abuse independently even if a cooldown is past', async () => {
    const session = await guest();
    for (let index = 0; index < 5; index++) { await challenge(session); releaseCooldown(); }
    expect((await send('/auth/phone/request', { session, body: { phone: PHONE, purpose: 'signin' } })).status).toBe(429);
    expect(sendSms).toHaveBeenCalledTimes(5);
  });
  it.each(['phone', 'session', 'ip'])('reports the remaining %s hourly wait instead of a fresh one-minute delay', async scope => {
    const started = Date.parse('2026-10-15T03:00:00Z'); const clock = vi.spyOn(Date, 'now').mockReturnValue(started);
    const shared = await guest(), count = scope === 'ip' ? 20 : 5;
    for (let index = 0; index < count; index++) {
      const session = scope === 'session' ? shared : await guest();
      const phone = scope === 'phone' ? PHONE : `010${String(index).padStart(8, '0')}`;
      await challenge(session, phone); releaseCooldown();
    }
    clock.mockReturnValue(started + 123_000);
    const next = scope === 'session' ? shared : await guest(), phone = scope === 'phone' ? PHONE : OTHER;
    const rejected = await send('/auth/phone/request', { session: next, body: { phone, purpose: 'signin' } });
    expect(rejected.status).toBe(429); expect(rejected.headers.get('Retry-After')).toBe('3477');
    expect((await rejected.json()).code).toBe('phone_rate_limited'); expect(sendSms).toHaveBeenCalledTimes(count);
    clock.mockReturnValue(started + 3600_000);
    await challenge(await guest(), phone); expect(sendSms).toHaveBeenCalledTimes(count + 1);
  });
  it('reports the cooldown remainder and the next Korean quota day for a daily cap', async () => {
    const started = Date.parse('2026-10-15T14:30:00Z'); const clock = vi.spyOn(Date, 'now').mockReturnValue(started);
    const session = await guest(); await challenge(session);
    clock.mockReturnValue(started + 17_000);
    const cooldown = await send('/auth/phone/request', { session, body: { phone: PHONE, purpose: 'signin' } });
    expect(cooldown.status).toBe(429); expect(cooldown.headers.get('Retry-After')).toBe('43');
    env.SITE_PHONE_DAILY_LIMIT = '1';
    const daily = await send('/auth/phone/request', { session, body: { phone: OTHER, purpose: 'signin' } });
    expect(daily.status).toBe(429); expect(daily.headers.get('Retry-After')).toBe('1783');
    clock.mockReturnValue(Date.parse('2026-10-15T15:00:00Z'));
    await challenge(session, OTHER); expect(sendSms).toHaveBeenCalledTimes(2);
  });
  it('uses the longer daily restriction when an hourly restriction is also active', async () => {
    const started = Date.parse('2026-10-15T03:00:00Z'); vi.spyOn(Date, 'now').mockReturnValue(started);
    const session = await guest();
    for (let index = 0; index < 5; index++) { await challenge(session); releaseCooldown(); }
    env.SITE_PHONE_DAILY_LIMIT = '5';
    const rejected = await send('/auth/phone/request', { session, body: { phone: PHONE, purpose: 'signin' } });
    expect(rejected.status).toBe(429); expect(rejected.headers.get('Retry-After')).toBe('43200');
    expect(sendSms).toHaveBeenCalledTimes(5);
  });
  it('does not mistake a session revoked before send reservation for a one-minute cooldown', async () => {
    const session = await guest(), original = local.db.batch;
    local.db.batch = async statements => {
      local.sqlite.exec('UPDATE site_sessions SET revoked_at=1'); return original(statements);
    };
    const response = await send('/auth/phone/request', { session, body: { phone: PHONE, purpose: 'signin' } });
    expect(response.status).toBe(401); expect((await response.json()).code).toBe('session_expired');
    expect(sendSms).not.toHaveBeenCalled(); expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_phone_challenges').get().n).toBe(0);
  });
});

describe('phone registration, recovery and canonical identities', () => {
  it('creates a genuine phone provider without invented email/password and logs into the same ID later', async () => {
    const member = await registered(), row = local.sqlite.prepare('SELECT * FROM site_members').get();
    expect(row.provider).toBe('phone'); expect(row.email).toBeNull(); expect(row.password_hash).toBeNull(); expect(row.provider_subject).toBe('+821012345678');
    releaseCooldown(); const session = await guest(), proof = await verified(session);
    expect(proof.authenticated).toBe(true); expect(proof.member.id).toBe(member.member.id); expect(cookie(proof.response)).toMatch(/^__Host-/);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_members').get().n).toBe(1);
    expect((await send('/me', { session })).status).toBe(401);
  });
  it('links to the current Google account only after verification and preserves its member/customer IDs', async () => {
    const session = await social(), proof = await verified(session, PHONE, 'link');
    expect(proof.authenticated).toBeUndefined();
    const result = await send('/auth/phone/link', { session, body: { registrationToken: proof.registrationToken } }); expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true });
    const identities = await (await send('/auth/identities', { session })).json();
    expect(identities.identities.find(row => row.provider === 'phone')).toEqual({ provider: 'phone', connected: true, email: null, phone: '010-****-5678' });
    expect(identities.availableProviders.phone).toBe(true);
    releaseCooldown(); const entry = await verified(await guest()); expect(entry.member.id).toBe(session.member.id); expect(entry.member.customerKey).toBe(session.member.customerKey);
    expect(entry.member.provider).toBe('google'); expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_members').get().n).toBe(1);
  });
  it('does not treat an unverified legacy profile phone as a login or merge proof', async () => {
    const existing = await social(PHONE), member = await registered(); expect(member.member.id).not.toBe(existing.member.id);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_members').get().n).toBe(2);
  });
  it('does not transfer another member phone or replace an already connected number', async () => {
    const owner = await registered(), other = await social(); releaseCooldown(); const proof = await verified(other, PHONE, 'link');
    expect((await send('/auth/phone/link', { session: other, body: { registrationToken: proof.registrationToken } })).status).toBe(409);
    expect(local.sqlite.prepare("SELECT member_id FROM site_member_identities WHERE provider='phone'").get().member_id).toBe(owner.member.id);
    expect((await send('/auth/phone/request', { session: owner, body: { phone: OTHER, purpose: 'link' } })).status).toBe(409);
    expect((await send('/me', { method: 'PUT', session: owner, body: { phone: OTHER } })).status).toBe(409);
  });
  it('requires name and consent and consumes new registration proof once under concurrent signups', async () => {
    const session = await guest(), proof = await verified(session);
    const body = { registrationToken: proof.registrationToken, name: '합성 회원', termsAccepted: true, privacyAccepted: true };
    expect((await send('/auth/phone/signup', { session, body: { ...body, termsAccepted: false } })).status).toBe(400);
    const responses = await Promise.all([send('/auth/phone/signup', { session, body }), send('/auth/phone/signup', { session, body })]);
    expect(responses.map(response => response.status).filter(status => status === 201)).toHaveLength(1);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_members').get().n).toBe(1);
  });
  it('rejects expired registration proof and never promotes link purpose into signup', async () => {
    const session = await guest(), proof = await verified(session); local.sqlite.exec('UPDATE site_phone_proofs SET expires_at=0');
    expect((await send('/auth/phone/signup', { session, body: { registrationToken: proof.registrationToken, name: '합성 회원', termsAccepted: true, privacyAccepted: true } })).status).toBe(400);
    releaseCooldown(); const member = await social(), link = await verified(member, PHONE, 'link');
    local.sqlite.prepare('UPDATE site_sessions SET member_id=NULL WHERE member_id=?').run(member.member.id);
    expect((await send('/auth/phone/signup', { session: member, body: { registrationToken: link.registrationToken, name: '다른 회원', termsAccepted: true, privacyAccepted: true } })).status).toBe(400);
    expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_members').get().n).toBe(1);
  });
});

describe('OTP browser binding, races and session lifetime', () => {
  it('requires same-origin POST and real cookie plus CSRF even before login', async () => {
    const session = await guest(), body = { phone: PHONE, purpose: 'signin' };
    for (const path of ['/auth/phone/request', '/auth/phone/verify', '/auth/phone/signup', '/auth/phone/link']) {
      expect((await send(path, { method: 'GET', session })).status).toBe(405);
      expect((await send(path, { body: {} })).status).toBe(401);
      expect((await send(path, { session, body, csrf: false })).status).toBe(403);
      expect((await send(path, { session, body, origin: 'https://attacker.invalid' })).status).toBe(403);
    }
    expect(sendSms).not.toHaveBeenCalled();
  });
  it('does not accept another browser OTP or let its attempts invalidate the owner challenge', async () => {
    const one = await guest(), two = await guest(), proof = await challenge(one);
    expect((await send('/auth/phone/verify', { session: two, body: { challengeId: proof.challengeId, code: proof.code } })).status).toBe(400);
    expect(local.sqlite.prepare('SELECT attempts FROM site_phone_challenges').get().attempts).toBe(0);
    expect((await send('/auth/phone/verify', { session: one, body: { challengeId: proof.challengeId, code: proof.code } })).status).toBe(200);
  });
  it('allows one concurrent correct OTP consumption and bounds wrong attempts to five', async () => {
    const session = await guest(), proof = await challenge(session), body = { challengeId: proof.challengeId, code: proof.code };
    const responses = await Promise.all([send('/auth/phone/verify', { session, body }), send('/auth/phone/verify', { session, body })]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 400]);
    releaseCooldown(); const next = await challenge(session); const wrong = next.code === '000000' ? '111111' : '000000';
    for (let count = 0; count < 5; count++) expect((await send('/auth/phone/verify', { session, body: { challengeId: next.challengeId, code: wrong } })).status).toBe(400);
    expect((await send('/auth/phone/verify', { session, body: { challengeId: next.challengeId, code: next.code } })).status).toBe(400);
  });
  it('expires challenges and revokes previous codes after a successful resend', async () => {
    const session = await guest(), first = await challenge(session); releaseCooldown(); const next = await challenge(session);
    expect((await send('/auth/phone/verify', { session, body: { challengeId: first.challengeId, code: first.code } })).status).toBe(400);
    local.sqlite.exec('UPDATE site_phone_challenges SET expires_at=0');
    expect((await send('/auth/phone/verify', { session, body: { challengeId: next.challengeId, code: next.code } })).status).toBe(400);
  });
  it('refuses a phone login if suspension wins just before its session transaction', async () => {
    const member = await registered(); releaseCooldown(); const session = await guest(), proof = await challenge(session);
    const original = local.db.batch; let batches = 0;
    local.db.batch = statements => { if (++batches === 2) local.sqlite.prepare("UPDATE site_members SET status='suspended' WHERE id=?").run(member.member.id); return original(statements); };
    const response = await send('/auth/phone/verify', { session, body: { challengeId: proof.challengeId, code: proof.code } });
    expect(response.status).toBe(401); expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_sessions WHERE member_id=? AND revoked_at IS NULL').get(member.member.id).n).toBe(0);
  });
  it('does not report a signup session if a suspension wins before the response', async () => {
    const session = await guest(), proof = await verified(session), original = local.db.batch;
    local.db.batch = async statements => { const result = await original(statements); local.sqlite.exec("UPDATE site_members SET status='suspended'"); return result; };
    const response = await send('/auth/phone/signup', { session, body: { registrationToken: proof.registrationToken, name: '합성 회원', termsAccepted: true, privacyAccepted: true } });
    expect(response.status).toBe(401); expect(response.headers.get('Set-Cookie')).toBeNull();
  });
  it('does not overwrite a newly verified phone with a stale profile snapshot', async () => {
    const member = await social(OTHER), prepare = local.db.prepare;
    local.db.prepare = sql => {
      if (sql.startsWith('UPDATE site_members SET nickname=')) {
        local.sqlite.prepare("INSERT INTO site_member_identities VALUES('phone','+821012345678',?,NULL,'synthetic')").run(member.member.id);
        local.sqlite.prepare('UPDATE site_members SET phone=? WHERE id=?').run(PHONE, member.member.id);
      }
      return prepare(sql);
    };
    const response = await send('/me', { session: member, method: 'PUT', body: { marketingAccepted: true } });
    expect(response.status).toBe(200); expect((await response.json()).member.phone).toBe(PHONE);
  });
  it('preserves live phone challenges/proofs during session cleanup and later removes their expired parents safely', async () => {
    const session = await guest(); await verified(session); local.sqlite.exec('UPDATE site_sessions SET revoked_at=1');
    expect((await cleanupSiteAuthState(env)).unavailable).toBeUndefined(); expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_sessions').get().n).toBe(1);
    local.sqlite.exec('UPDATE site_phone_challenges SET expires_at=0; UPDATE site_phone_proofs SET expires_at=0;');
    expect((await cleanupSiteAuthState(env)).unavailable).toBeUndefined(); expect(local.sqlite.prepare('SELECT COUNT(*) n FROM site_sessions').get().n).toBe(0);
  });
});
