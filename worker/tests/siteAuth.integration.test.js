import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { localD1 } from './helpers/localD1.js';
import { signTypedToken } from '../lib/auth.js';
import { handleSiteAuthRoutes, authorizeSiteMember, checkSiteOrigin, siteOrigin, hashSitePassword, verifySiteGoogleIdentity, cleanupSiteAuthState, safeSiteReturnTo } from '../lib/siteAuth.js';

const ORIGIN = 'https://tiantianchinese.com';
const EMAIL = 'fixture-member@example.invalid';
const PASSWORD = 'Synthetic-password42';
const SESSION_SECRET = 'isolated-site-session-secret-32-characters';
const PASSWORD_SECRET = 'isolated-site-password-pepper-32-characters';
let database, env, mail, googlePrivate, googlePublic, googleKeys;
const cookie = response => response.headers.get('Set-Cookie')?.split(';')[0];
function request(path, { method = 'GET', body, session, origin = ORIGIN, headers = {} } = {}) {
  return new Request(`${ORIGIN}/api/site${path}`, { method, headers: { ...(origin ? { Origin: origin } : {}),
    'CF-Connecting-IP': '198.51.100.18', ...(session?.cookie ? { Cookie: session.cookie } : {}),
    ...(session?.csrfToken ? { 'X-CSRF-Token': session.csrfToken } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
const send = (path, options) => handleSiteAuthRoutes(request(path, options), env);
async function guest() {
  const response = await send('/session');
  expect(response.status).toBe(200);
  return { cookie: cookie(response), ...(await response.json()) };
}
async function verifiedRegistration(session, email = EMAIL) {
  const requested = await send('/auth/email/request', { method: 'POST', session, body: { email } });
  expect(requested.status).toBe(200);
  const { challengeId } = await requested.json();
  const code = mail.at(-1).text.match(/\b\d{6}\b/)[0];
  const verified = await send('/auth/email/verify', { method: 'POST', session, body: { challengeId, code } });
  expect(verified.status).toBe(200);
  return { challengeId, code, ...(await verified.json()) };
}
async function registered(email = EMAIL) {
  const session = await guest(), registration = await verifiedRegistration(session, email);
  const response = await send('/auth/signup', { method: 'POST', session, body: { registrationToken: registration.registrationToken,
    password: PASSWORD, passwordConfirm: PASSWORD, name: '가상 회원', nickname: '닉네임', termsAccepted: true, privacyAccepted: true } });
  expect(response.status).toBe(201);
  return { guest: session, cookie: cookie(response), ...(await response.json()) };
}
async function login(email = EMAIL, password = PASSWORD, overrides = {}) {
  const session = await guest();
  const response = await send('/auth/login', { method: 'POST', session, body: { email, password, ...overrides } });
  const data = await response.json();
  return { response, session: { cookie: cookie(response), ...data }, guest: session };
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  googlePrivate = pair.privateKey;
  googlePublic = { ...(await exportJWK(pair.publicKey)), kid: 'isolated-google-key', alg: 'RS256', use: 'sig' };
  googleKeys = createLocalJWKSet({ keys: [googlePublic] });
});
beforeEach(() => {
  database = localD1();
  database.sqlite.exec(readFileSync(new URL('../migrations/0008_site_auth.sql', import.meta.url), 'utf8'));
  database.sqlite.exec(readFileSync(new URL('../migrations/0026_site_member_identities.sql', import.meta.url), 'utf8'));
  // D1 batches are transactions; exercise rollback and conditional production SQL in real SQLite.
  let batchQueue = Promise.resolve();
  database.db.batch = statements => {
    const next = batchQueue.then(async () => {
      database.sqlite.exec('BEGIN');
      try {
        const outcomes = [];
        for (const statement of statements) outcomes.push(await statement.run());
        database.sqlite.exec('COMMIT');
        return outcomes;
      } catch (error) { database.sqlite.exec('ROLLBACK'); throw error; }
    });
    batchQueue = next.catch(() => {});
    return next;
  };
  mail = [];
  env = { GAME_DB: database.db, SITE_SESSION_SECRET: SESSION_SECRET, SITE_PASSWORD_SECRET: PASSWORD_SECRET,
    SITE_EMAIL_FROM: 'fixture-sender@example.invalid', SITE_EMAIL: { send: vi.fn(async message => { mail.push(message); return { messageId: 'isolated-fixture' }; }) },
    GAME_GOOGLE_CLIENT_ID: 'fixture-google-client', GAME_GOOGLE_CLIENT_SECRET: 'fixture-google-secret',
    GAME_KAKAO_REST_KEY: 'fixture-kakao-client', GAME_KAKAO_CLIENT_SECRET: 'fixture-kakao-secret' };
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected network access'); }));
});
afterEach(() => { database.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('isolated website sessions and CSRF', () => {
  it('issues a hashed guest cookie and stable CSRF, with accurate capabilities and no caching', async () => {
    const response = await send('/session');
    const data = await response.json(), setCookie = response.headers.get('Set-Cookie');
    expect(data.member).toBeNull();
    expect(data.capabilities).toEqual({ phone: false, email: true, google: true, kakao: true, payments: false });
    expect(setCookie).toMatch(/^__Host-hanul_site=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Secure$/);
    expect(setCookie).not.toContain('Domain=');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    const row = database.sqlite.prepare('SELECT * FROM site_sessions').get();
    expect(row.token_hash).not.toEqual(cookie(response).split('=')[1]);
    expect(row.csrf_hash).not.toEqual(data.csrfToken);
    const next = await send('/session', { session: { cookie: cookie(response) } });
    expect((await next.json()).csrfToken).toBe(data.csrfToken);
    expect(next.headers.get('Set-Cookie')).toBeNull();
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_sessions').get().n).toBe(1);
  });
  it('requires exact origin plus guest CSRF even on login, signup, and reset', async () => {
    const session = await guest();
    for (const path of ['/auth/login', '/auth/signup', '/auth/password/reset', '/auth/password/request-reset']) {
      expect((await send(path, { method: 'POST', body: {} })).status).toBe(401);
      expect((await send(path, { method: 'POST', session: { cookie: session.cookie }, body: {} })).status).toBe(403);
      expect((await send(path, { method: 'POST', session, origin: 'https://tiantianchinese.com.attacker.invalid', body: {} })).status).toBe(403);
      expect((await send(path, { method: 'POST', session, origin: null, body: {} })).status).toBe(403);
    }
    expect(checkSiteOrigin(request('/session', { origin: 'https://www.tiantianchinese.com' }), env)?.status).toBe(403);
    expect(checkSiteOrigin(request('/session', { origin: 'https://tiantianchinese.com:444' }), env)?.status).toBe(403);
  });
  it('reports payments ready only when merchant and widget keys match the configured environment', async () => {
    const session = await guest();
    env.SITE_TOSS_CLIENT_KEY = 'test_gck_fixture';
    env.SITE_TOSS_SECRET_KEY = 'test_gsk_fixture';
    env.SITE_TOSS_MODE = 'test';
    env.SITE_TOSS_MERCHANT_ID = 'fixture-merchant';
    expect((await (await send('/session', { session })).json()).capabilities.payments).toBe(true);
    env.SITE_TOSS_SECRET_KEY = 'live_gsk_fixture';
    expect((await (await send('/session', { session })).json()).capabilities.payments).toBe(false);
    env.SITE_TOSS_CLIENT_KEY = 'live_gck_fixture';
    env.SITE_TOSS_MODE = 'live';
    expect((await (await send('/session', { session })).json()).capabilities.payments).toBe(true);
    env.SITE_TOSS_MERCHANT_ID = '';
    expect((await (await send('/session', { session })).json()).capabilities.payments).toBe(false);
  });
  it('permits a local insecure cookie only with explicit development plus configured localhost origin', async () => {
    expect(siteOrigin(env)).toBe(ORIGIN);
    env.SITE_ORIGIN = 'http://localhost:4321';
    expect((await send('/session', { origin: env.SITE_ORIGIN })).status).toBe(503);
    env.SITE_ENVIRONMENT = 'development';
    const response = await send('/session', { origin: env.SITE_ORIGIN });
    expect(response.headers.get('Set-Cookie')).toMatch(/^hanul_site_dev=/);
    expect(response.headers.get('Set-Cookie')).not.toContain('Secure');
    env.SITE_ORIGIN = 'http://attacker.invalid';
    expect((await send('/session', { origin: env.SITE_ORIGIN })).status).toBe(503);
  });
  it('does not accept teacher, student, game, finder, or review bearer tokens as site members', async () => {
    const member = await registered();
    for (const type of ['teacher', 'student', 'game', 'finder', 'review']) {
      const subject = type === 'teacher' ? 'teacher' : type === 'student' ? `personal:${member.member.id}`
        : ['finder', 'review'].includes(type) ? `${type}:${member.member.id}` : member.member.id;
      const token = await signTypedToken('unrelated-jwt-secret', type, subject, 600, type === 'teacher' ? { role: 'teacher' } : {});
      const response = await authorizeSiteMember(request('/me', { headers: { Authorization: `Bearer ${token}` } }), env);
      expect(response.status).toBe(401);
    }
    expect((await send('/me', { headers: { Cookie: 'game_session=synthetic-token' } })).status).toBe(401);
    expect((await send('/me', { session: member, headers: { Cookie: `${member.cookie}; ${member.cookie}` } })).status).toBe(401);
  });
  it('fails closed for missing storage, short secrets and migration failures without exposing internal details', async () => {
    env.SITE_SESSION_SECRET = 'short';
    expect((await send('/session')).status).toBe(503);
    env.SITE_SESSION_SECRET = SESSION_SECRET;
    database.sqlite.exec('DROP TABLE site_sessions');
    const response = await send('/session');
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/SQL|sqlite|site_sessions|secret/);
  });
  it('returns null for unrelated routes and 405 for unsupported methods', async () => {
    expect(await send('/orders')).toBeNull();
    expect(await handleSiteAuthRoutes(new Request(`${ORIGIN}/auth/login`), env)).toBeNull();
    expect((await send('/session', { method: 'POST' })).status).toBe(405);
  });
  it('cleans only expired authentication state while retaining live proofs, members, consents and other data', async () => {
    const member = await registered(), guestSession = await guest();
    await verifiedRegistration(guestSession, 'cleanup@example.invalid');
    await send('/auth/password/request-reset', { method: 'POST', session: guestSession, body: { email: EMAIL } });
    await send('/auth/google/start', { session: guestSession });
    const before = database.sqlite.prepare('SELECT * FROM site_members WHERE id=?').get(member.member.id);
    database.sqlite.exec("CREATE TABLE fixture_transaction(id TEXT PRIMARY KEY,member_id TEXT REFERENCES site_members(id));");
    database.sqlite.prepare('INSERT INTO fixture_transaction VALUES(?,?)').run('order-fixture', member.member.id);
    database.sqlite.exec('UPDATE site_sessions SET revoked_at=1');
    const live = await cleanupSiteAuthState(env);
    expect(live.unavailable).toBeUndefined();
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_registration_tokens').get().n).toBe(2);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_email_challenges').get().n).toBe(2);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_oauth_states').get().n).toBe(1);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_password_resets').get().n).toBe(1);
    database.sqlite.exec('UPDATE site_email_challenges SET expires_at=0; UPDATE site_registration_tokens SET expires_at=0; UPDATE site_oauth_states SET expires_at=0; UPDATE site_password_resets SET expires_at=0; UPDATE site_auth_rate_limits SET expires_at=0;');
    const expired = await cleanupSiteAuthState(env);
    expect(expired.cleaned).toBeGreaterThan(0);
    for (const table of ['site_email_challenges','site_registration_tokens','site_oauth_states','site_password_resets','site_sessions','site_auth_rate_limits']) {
      expect(database.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n).toBe(0);
    }
    expect(database.sqlite.prepare('SELECT * FROM site_members WHERE id=?').get(member.member.id)).toEqual(before);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM fixture_transaction').get().n).toBe(1);
  });
  it('makes optional scheduled cleanup a safe no-op before configuration or migrations exist', async () => {
    expect(await cleanupSiteAuthState({})).toEqual({ cleaned: 0, unavailable: true });
    database.sqlite.exec('DROP TABLE site_sessions');
    expect(await cleanupSiteAuthState(env)).toEqual({ cleaned: 0, unavailable: true });
  });
});

describe('email verification and registration', () => {
  it('stores OTP hashes and binds verification to the requesting browser with one-use registration', async () => {
    const session = await guest(), second = await guest();
    const response = await send('/auth/email/request', { method: 'POST', session, body: { email: ' FIXTURE-MEMBER@EXAMPLE.INVALID ' } });
    const { challengeId } = await response.json(), code = mail.at(-1).text.match(/\b\d{6}\b/)[0];
    expect(mail[0].to).toBe(EMAIL);
    expect(mail[0].from).toEqual({ email: env.SITE_EMAIL_FROM, name: '하늘하늘중국어' });
    expect(mail[0].html).toContain(code);
    const challenge = database.sqlite.prepare('SELECT * FROM site_email_challenges').get();
    expect(challenge.proof_hash).not.toContain(code);
    expect(challenge.expires_at - Math.floor(Date.now() / 1000)).toBeGreaterThanOrEqual(299);
    expect((await send('/auth/email/verify', { method: 'POST', session: second, body: { challengeId, code } })).status).toBe(400);
    const verified = await send('/auth/email/verify', { method: 'POST', session, body: { challengeId, code } });
    expect(verified.status).toBe(200);
    const registration = await verified.json();
    expect((await send('/auth/email/verify', { method: 'POST', session, body: { challengeId, code } })).status).toBe(400);
    const data = { registrationToken: registration.registrationToken, password: PASSWORD, passwordConfirm: PASSWORD,
      name: '가상 회원', termsAccepted: true, privacyAccepted: true };
    expect((await send('/auth/signup', { method: 'POST', session: second, body: data })).status).toBe(400);
    const created = await send('/auth/signup', { method: 'POST', session, body: data });
    expect(created.status).toBe(201);
    expect((await send('/auth/signup', { method: 'POST', session, body: data })).status).toBe(401);
    const row = database.sqlite.prepare('SELECT * FROM site_members').get();
    expect(row.provider).toBe('email');
    expect(row.password_iterations).toBe(100000);
    expect(row.password_hash).not.toBe(PASSWORD);
    expect(row.password_salt).toHaveLength(22);
    expect(row.member_code).toMatch(/^H[A-Z0-9]{10}$/);
    expect(row.customer_key).toMatch(/^[a-f0-9-]{36}$/);
    const publicMember = (await created.json()).member;
    expect(publicMember.profileComplete).toBe(true);
    expect(publicMember).not.toHaveProperty('password_hash');
    expect(publicMember).not.toHaveProperty('customer_key');
    expect(publicMember.customerKey).toBe(row.customer_key);
  });
  it('requires password confirmation and both required consents without consuming valid registration', async () => {
    const session = await guest(), registration = await verifiedRegistration(session);
    const good = { registrationToken: registration.registrationToken, password: PASSWORD, passwordConfirm: PASSWORD,
      name: '가상 회원', termsAccepted: true, privacyAccepted: true };
    for (const delta of [{ passwordConfirm: 'different' }, { password: '12345678', passwordConfirm: '12345678' },
      { termsAccepted: false }, { privacyAccepted: false }, { status: 'active' }, { memberCode: 'owned' }]) {
      expect((await send('/auth/signup', { method: 'POST', session, body: { ...good, ...delta } })).status).toBe(400);
    }
    expect(database.sqlite.prepare('SELECT consumed_at FROM site_registration_tokens').get().consumed_at).toBeNull();
    expect((await send('/auth/signup', { method: 'POST', session, body: good })).status).toBe(201);
  });
  it('caps OTP guesses, expiry, and email send frequency while keeping plaintext out of storage', async () => {
    const started = Date.parse('2026-10-15T03:00:00Z');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(started);
    const session = await guest(), requested = await send('/auth/email/request', { method: 'POST', session, body: { email: EMAIL } });
    const { challengeId } = await requested.json(), correct = mail.at(-1).text.match(/\b\d{6}\b/)[0];
    const wrong = correct === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await send('/auth/email/verify', { method: 'POST', session, body: { challengeId, code: wrong } })).status).toBe(400);
    expect((await send('/auth/email/verify', { method: 'POST', session, body: { challengeId, code: correct } })).status).toBe(400);
    expect(database.sqlite.prepare('SELECT attempts FROM site_email_challenges').get().attempts).toBe(5);
    for (let i = 0; i < 4; i++) expect((await send('/auth/email/request', { method: 'POST', session, body: { email: EMAIL } })).status).toBe(200);
    clock.mockReturnValue(started + 123_000);
    const limited = await send('/auth/email/request', { method: 'POST', session, body: { email: EMAIL } });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('3477');
    const last = database.sqlite.prepare('SELECT id FROM site_email_challenges ORDER BY created_at DESC LIMIT 1').get();
    database.sqlite.exec('UPDATE site_email_challenges SET expires_at=0');
    expect((await send('/auth/email/verify', { method: 'POST', session, body: { challengeId: last.id, code: mail.at(-1).text.match(/\b\d{6}\b/)[0] } })).status).toBe(400);
  });
  it('blocks duplicate emails and never creates an implicit second member', async () => {
    await registered();
    const session = await guest(), registration = await verifiedRegistration(session);
    const response = await send('/auth/signup', { method: 'POST', session, body: { registrationToken: registration.registrationToken,
      password: PASSWORD, passwordConfirm: PASSWORD, name: '다른 회원', termsAccepted: true, privacyAccepted: true } });
    expect(response.status).toBe(409);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_members').get().n).toBe(1);
  });
  it('rolls back registration and guest revocation when storing a member session fails', async () => {
    const session = await guest(), registration = await verifiedRegistration(session);
    database.sqlite.exec("CREATE TRIGGER reject_member_session BEFORE INSERT ON site_sessions WHEN NEW.member_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'fixture'); END;");
    const response = await send('/auth/signup', { method: 'POST', session, body: { registrationToken: registration.registrationToken,
      password: PASSWORD, passwordConfirm: PASSWORD, name: '가상 회원', termsAccepted: true, privacyAccepted: true } });
    expect(response.status).toBe(503);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_members').get().n).toBe(0);
    expect(database.sqlite.prepare('SELECT consumed_at FROM site_registration_tokens').get().consumed_at).toBeNull();
    expect(database.sqlite.prepare('SELECT revoked_at FROM site_sessions').get().revoked_at).toBeNull();
  });
  it('reports unavailable email setup and invalidates proofs when a fixture mail transport rejects', async () => {
    const session = await guest();
    delete env.SITE_EMAIL;
    const unavailable = await send('/auth/email/request', { method: 'POST', session, body: { email: EMAIL } });
    expect(unavailable.status).toBe(503);
    expect((await (await send('/session', { session })).json()).capabilities.email).toBe(false);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_email_challenges').get().n).toBe(0);
    env.EMAIL = { send: vi.fn(async () => { throw new Error('sensitive recipient/provider error'); }) };
    const failed = await send('/auth/email/request', { method: 'POST', session, body: { email: EMAIL } });
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain('sensitive');
    expect(database.sqlite.prepare('SELECT consumed_at FROM site_email_challenges').get().consumed_at).not.toBeNull();
  });
  it('uses only an independent slow password pepper and rejects oversized payloads', async () => {
    const first = await hashSitePassword(PASSWORD, PASSWORD_SECRET);
    const same = await hashSitePassword(PASSWORD, PASSWORD_SECRET, first.salt);
    const changed = await hashSitePassword(PASSWORD, SESSION_SECRET, first.salt);
    expect(first.hash).toBe(same.hash);
    expect(first.hash).not.toBe(changed.hash);
    const session = await guest();
    expect((await send('/auth/login', { method: 'POST', session, body: { email: EMAIL, password: 'a'.repeat(20000) } })).status).toBe(413);
  });
});

describe('login, member editing, logout and password recovery', () => {
  it('rotates every login cookie, supports remember and rejects old sessions after logout', async () => {
    const first = await registered();
    expect((await send('/me', { session: first.guest })).status).toBe(401);
    const entered = await login(EMAIL, PASSWORD, { remember: true });
    expect(entered.response.status).toBe(200);
    expect(entered.response.headers.get('Set-Cookie')).toContain('Max-Age=2592000');
    expect(entered.session.cookie).not.toBe(first.cookie);
    expect((await send('/me', { session: entered.guest })).status).toBe(401);
    const logout = await send('/auth/logout', { method: 'POST', session: entered.session });
    expect(logout.status).toBe(200);
    expect(logout.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect((await send('/me', { session: entered.session })).status).toBe(401);
    expect((await send('/me', { session: first })).status).toBe(200);
  });
  it('uses the same incorrect-login response and enforces email attempt limits', async () => {
    await registered();
    const wrong = await login(EMAIL, 'wrong-password');
    const unknown = await login('missing@example.invalid', 'wrong-password');
    expect(wrong.response.status).toBe(401);
    expect(unknown.response.status).toBe(401);
    expect(unknown.session.error).toBe(wrong.session.error);
    for (let i = 0; i < 9; i++) expect((await login(EMAIL, 'wrong-password')).response.status).toBe(401);
    expect((await login(EMAIL, PASSWORD)).response.status).toBe(429);
  });
  it('allows only one concurrent login rotation from the same guest session', async () => {
    await registered();
    const session = await guest();
    const responses = await Promise.all([send('/auth/login', { method: 'POST', session, body: { email: EMAIL, password: PASSWORD } }),
      send('/auth/login', { method: 'POST', session, body: { email: EMAIL, password: PASSWORD } })]);
    expect(responses.map(value => value.status).sort()).toEqual([200, 401]);
    const winner = responses.find(value => value.status === 200);
    expect((await send('/me', { session: { cookie: cookie(winner) } })).status).toBe(200);
  });
  it('consumes a registration once under simultaneous signup and creates only one member', async () => {
    const session = await guest(), registration = await verifiedRegistration(session);
    const body = { registrationToken: registration.registrationToken, password: PASSWORD, passwordConfirm: PASSWORD,
      name: '가상 회원', termsAccepted: true, privacyAccepted: true };
    const responses = await Promise.all([send('/auth/signup', { method: 'POST', session, body }), send('/auth/signup', { method: 'POST', session, body })]);
    expect(responses.map(value => value.status).sort()).toEqual([201, 409]);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_members').get().n).toBe(1);
  });
  it('allows only safe self profile fields and preserves provider, code, email and required consents', async () => {
    const member = await registered();
    const response = await send('/me', { method: 'PUT', session: member, body: { phone: '01012345678', nickname: '수정 닉네임', marketingAccepted: true } });
    expect(response.status).toBe(200);
    const changed = (await response.json()).member;
    expect(changed.phone).toBe('01012345678');
    expect(changed.nickname).toBe('수정 닉네임');
    expect(changed.marketingAccepted).toBe(true);
    expect(changed.name).toBe('가상 회원');
    for (const body of [{ email: 'new@example.invalid' }, { id: crypto.randomUUID() }, { status: 'active' }, { phone: 'not-a-phone' }, { termsAccepted: false }]) {
      expect((await send('/me', { method: 'PUT', session: member, body })).status).toBe(400);
    }
    expect((await send('/me', { method: 'PUT', session: { cookie: member.cookie }, body: { nickname: '변경' } })).status).toBe(403);
  });
  it.each([
    { name: '다른 이름' },
    { name: '다른 이름', nickname: '변경 닉네임', phone: '01012345678', marketingAccepted: true },
    { name: '가상 회원', nickname: '변경 닉네임' },
    { name: null, nickname: '변경 닉네임' },
  ])('rejects any supplied member name without updating any profile field: %j', async body => {
    const member = await registered();
    const before = database.sqlite.prepare('SELECT * FROM site_members WHERE id=?').get(member.member.id);
    const response = await send('/me', { method: 'PUT', session: member, body });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '회원 이름은 변경할 수 없습니다.', code: 'member_name_immutable' });
    expect(database.sqlite.prepare('SELECT * FROM site_members WHERE id=?').get(member.member.id)).toEqual(before);
    expect((await send('/me', { session: member })).status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('revokes all member sessions for suspension or withdrawal and blocks email login', async () => {
    for (const status of ['suspended', 'withdrawn']) {
      const email = `${status}@example.invalid`, member = await registered(email), second = await login(email);
      database.sqlite.prepare('UPDATE site_members SET status=? WHERE id=?').run(status, member.member.id);
      expect((await send('/me', { session: member })).status).toBe(401);
      expect((await send('/me', { session: second.session })).status).toBe(401);
      expect((await login(email)).response.status).toBe(401);
      expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_sessions WHERE member_id=? AND revoked_at IS NULL').get(member.member.id).n).toBe(0);
    }
  });
  it('keeps reset requests generic and consumes a reset once while revoking every session and older reset', async () => {
    const first = await registered(), second = (await login()).session, guestSession = await guest();
    const unknown = await send('/auth/password/request-reset', { method: 'POST', session: guestSession, body: { email: 'missing@example.invalid' } });
    const valid = await send('/auth/password/request-reset', { method: 'POST', session: guestSession, body: { email: EMAIL } });
    expect(await unknown.json()).toEqual(await valid.json());
    const link = mail.at(-1).text.match(/https:\/\/\S+/)[0], token = new URL(link).searchParams.get('token');
    expect(new URL(link).pathname).toBe('/password/reset/');
    expect(database.sqlite.prepare('SELECT token_hash FROM site_password_resets').get().token_hash).not.toBe(token);
    await send('/auth/password/request-reset', { method: 'POST', session: guestSession, body: { email: EMAIL } });
    const olderToken = new URL(mail.at(-1).text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
    const reset = { token, password: 'New-synthetic-password57', passwordConfirm: 'New-synthetic-password57' };
    const results = await Promise.all([send('/auth/password/reset', { method: 'POST', session: guestSession, body: reset }),
      send('/auth/password/reset', { method: 'POST', session: guestSession, body: reset })]);
    expect(results.map(value => value.status).sort()).toEqual([200, 400]);
    expect((await send('/me', { session: first })).status).toBe(401);
    expect((await send('/me', { session: second })).status).toBe(401);
    expect((await send('/auth/password/reset', { method: 'POST', session: guestSession, body: { ...reset, token: olderToken } })).status).toBe(400);
    expect((await login()).response.status).toBe(401);
    expect((await login(EMAIL, reset.password)).response.status).toBe(200);
  });
  it('rejects expired and invalid reset links and does not reveal a delivery failure', async () => {
    await registered();
    const session = await guest();
    env.SITE_EMAIL.send = vi.fn(async () => { throw new Error('fixture-email-error'); });
    const response = await send('/auth/password/request-reset', { method: 'POST', session, body: { email: EMAIL } });
    expect(await response.json()).toEqual({ ok: true });
    expect(database.sqlite.prepare('SELECT consumed_at FROM site_password_resets').get().consumed_at).not.toBeNull();
    const reset = { token: 'a'.repeat(43), password: PASSWORD, passwordConfirm: PASSWORD };
    expect((await send('/auth/password/reset', { method: 'POST', session, body: reset })).status).toBe(400);
  });
});

async function googleToken(nonce, overrides = {}) {
  return new SignJWT({ nonce, email: 'social@example.invalid', email_verified: true, name: '구글 닉네임', ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: googlePublic.kid }).setSubject('google-fixture-user')
    .setIssuer(overrides.iss || 'https://accounts.google.com').setAudience(overrides.aud || env.GAME_GOOGLE_CLIENT_ID)
    .setIssuedAt().setExpirationTime(overrides.exp || '5m').sign(googlePrivate);
}
function mockGoogle(token) {
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (String(url) === 'https://oauth2.googleapis.com/token') return Response.json({ id_token: token });
    if (String(url) === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [googlePublic] });
    throw new Error('Unexpected network access');
  }));
}
function mockKakao(email = 'kakao@example.invalid') {
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (String(url) === 'https://kauth.kakao.com/oauth/token') return Response.json({ access_token: 'fixture-only-token' });
    if (String(url) === 'https://kapi.kakao.com/v2/user/me') return Response.json({ id: 123456789, kakao_account:
      { email, is_email_verified: true, is_email_valid: true, profile: { nickname: '카카오 닉네임' } } });
    throw new Error('Unexpected network access');
  }));
}

describe('server-bound social login', () => {
  it('uses GAME OAuth app fallback without promoting or merging the existing game identity into a site member', async () => {
    database.sqlite.prepare('INSERT INTO game_users(id,provider,social_id,nickname,game_data) VALUES(?,?,?,?,?)')
      .run('isolated-game-member', 'google', 'google-fixture-user', '게임 닉네임', JSON.stringify({ score: 42 }));
    const before = database.sqlite.prepare('SELECT * FROM game_users').get();
    const session = await guest(), start = new URL((await send('/auth/google/start', { session })).headers.get('Location'));
    expect(start.searchParams.get('client_id')).toBe(env.GAME_GOOGLE_CLIENT_ID);
    mockGoogle(await googleToken(start.searchParams.get('nonce')));
    const callback = await send(`/auth/google/callback?state=${start.searchParams.get('state')}&code=isolated-game-fallback`, { session });
    expect(callback.headers.get('Location')).toBe(`${ORIGIN}/signup/complete/`);
    const tokenBody = fetch.mock.calls.find(([url]) => String(url) === 'https://oauth2.googleapis.com/token')[1].body;
    expect(tokenBody.get('client_id')).toBe(env.GAME_GOOGLE_CLIENT_ID);
    expect(tokenBody.get('client_secret')).toBe(env.GAME_GOOGLE_CLIENT_SECRET);
    const current = await (await send('/session', { session: { cookie: cookie(callback) } })).json();
    expect(current.member.id).not.toBe(before.id);
    expect(current.member).toMatchObject({ provider: 'google', profileComplete: false });
    const site = database.sqlite.prepare('SELECT provider_subject FROM site_members').get();
    expect(site.provider_subject).not.toBe(before.social_id);
    expect(site.provider_subject.endsWith(`:${before.social_id}`)).toBe(true);
    expect(database.sqlite.prepare('SELECT * FROM game_users').get()).toEqual(before);
  });
  it.each([
    ['google', 'SITE_GOOGLE_CLIENT_ID', 'isolated-site-google-client'],
    ['google', 'SITE_GOOGLE_CLIENT_SECRET', 'isolated-site-google-secret'],
    ['google', 'SITE_GOOGLE_CLIENT_ID', ''],
    ['google', 'SITE_GOOGLE_CLIENT_SECRET', ''],
    ['kakao', 'SITE_KAKAO_CLIENT_SECRET', 'isolated-site-kakao-secret'],
    ['kakao', 'SITE_KAKAO_CLIENT_SECRET', ''],
    ['kakao', 'SITE_KAKAO_REST_KEY', ''],
  ])('disables %s rather than mixing or falling back from partial %s configuration', async (provider, key, value) => {
    env[key] = value;
    const session = await guest();
    expect(session.capabilities[provider]).toBe(false);
    expect((await send(`/auth/${provider}/start`, { session })).status).toBe(503);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_oauth_states').get().n).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses the complete SITE Google app pair for authorization, exchange and identity verification', async () => {
    env.SITE_GOOGLE_CLIENT_ID = 'isolated-site-google-client';
    env.SITE_GOOGLE_CLIENT_SECRET = 'isolated-site-google-secret';
    const session = await guest();
    expect(session.capabilities.google).toBe(true);
    const start = new URL((await send('/auth/google/start', { session })).headers.get('Location'));
    expect(start.searchParams.get('client_id')).toBe(env.SITE_GOOGLE_CLIENT_ID);
    mockGoogle(await googleToken(start.searchParams.get('nonce'), { aud: env.SITE_GOOGLE_CLIENT_ID }));
    const callback = await send(`/auth/google/callback?state=${start.searchParams.get('state')}&code=isolated-site-app`, { session });
    expect(callback.headers.get('Location')).toBe(`${ORIGIN}/signup/complete/`);
    const tokenBody = fetch.mock.calls.find(([url]) => String(url) === 'https://oauth2.googleapis.com/token')[1].body;
    expect(tokenBody.get('client_id')).toBe(env.SITE_GOOGLE_CLIENT_ID);
    expect(tokenBody.get('client_secret')).toBe(env.SITE_GOOGLE_CLIENT_SECRET);
    expect(tokenBody.get('client_secret')).not.toBe(env.GAME_GOOGLE_CLIENT_SECRET);
    expect(database.sqlite.prepare('SELECT provider FROM site_members').get().provider).toBe('google');
  });
  it.each([undefined, 'isolated-site-kakao-secret'])('keeps a SITE Kakao app with optional own secret %s separate from the GAME secret', async clientSecret => {
    env.SITE_KAKAO_REST_KEY = 'isolated-site-kakao-client';
    if (clientSecret !== undefined) env.SITE_KAKAO_CLIENT_SECRET = clientSecret;
    const session = await guest();
    expect(session.capabilities.kakao).toBe(true);
    const start = new URL((await send('/auth/kakao/start', { session })).headers.get('Location'));
    expect(start.searchParams.get('client_id')).toBe(env.SITE_KAKAO_REST_KEY);
    mockKakao();
    const callback = await send(`/auth/kakao/callback?state=${start.searchParams.get('state')}&code=isolated-site-app`, { session });
    expect(callback.headers.get('Location')).toBe(`${ORIGIN}/signup/complete/`);
    const tokenBody = fetch.mock.calls.find(([url]) => String(url) === 'https://kauth.kakao.com/oauth/token')[1].body;
    expect(tokenBody.get('client_id')).toBe(env.SITE_KAKAO_REST_KEY);
    expect(tokenBody.get('client_secret')).toBe(clientSecret ?? null);
    expect(tokenBody.get('client_secret')).not.toBe(env.GAME_KAKAO_CLIENT_SECRET);
  });
  it('allows only the exact personal return page, without queries, fragments or path encoding', async () => {
    expect(safeSiteReturnTo('/personal')).toBe('/personal/');
    expect(safeSiteReturnTo('/personal/')).toBe('/personal/');
    const session = await guest();
    for (const target of ['/personal/?', '/personal/?next=/account/', '/personal/#student-app', '/personal/#',
      '/personal/extra', '/personal//', '/personal/../personal/', '/other/../personal/', '/%70ersonal/', '/personal%2f',
      '/personal/%2e%2e/personal/', 'https://attacker.invalid/personal/', '//attacker.invalid/personal/', '/personal\\']) {
      expect(safeSiteReturnTo(target)).toBeNull();
      expect((await send(`/auth/kakao/start?returnTo=${encodeURIComponent(target)}`, { session })).status).toBe(400);
    }
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_oauth_states').get().n).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['google', 'kakao'])('retains the personal return page through %s signup, repeat login and an already logged-in start', async provider => {
    const session = await guest(), returnTo = '/personal/';
    const startResponse = await send(`/auth/${provider}/start?returnTo=${encodeURIComponent('/personal')}`, { session });
    expect(startResponse.status).toBe(302);
    const start = new URL(startResponse.headers.get('Location'));
    expect(database.sqlite.prepare('SELECT return_to FROM site_oauth_states').get().return_to).toBe(returnTo);
    if (provider === 'google') mockGoogle(await googleToken(start.searchParams.get('nonce'))); else mockKakao();
    const callback = await send(`/auth/${provider}/callback?state=${start.searchParams.get('state')}&code=isolated-personal-signup`, { session });
    const completion = new URL(callback.headers.get('Location'));
    expect(completion.pathname).toBe('/signup/complete/');
    expect(completion.searchParams.get('returnTo')).toBe(returnTo);
    const pending = { cookie: cookie(callback), ...(await (await send('/session', { session: { cookie: cookie(callback) } })).json()) };
    const completed = await send('/auth/profile-complete', { method: 'POST', session: pending,
      body: { name: '가상 소셜 회원', nickname: '', termsAccepted: true, privacyAccepted: true } });
    expect(completed.status).toBe(200);
    expect((await completed.json()).member.profileComplete).toBe(true);
    await send('/auth/logout', { method: 'POST', session: pending });
    const guestAgain = await guest();
    const restart = new URL((await send(`/auth/${provider}/start?returnTo=${encodeURIComponent(returnTo)}`, { session: guestAgain })).headers.get('Location'));
    if (provider === 'google') mockGoogle(await googleToken(restart.searchParams.get('nonce'))); else mockKakao();
    const signedIn = await send(`/auth/${provider}/callback?state=${restart.searchParams.get('state')}&code=isolated-personal-login`, { session: guestAgain });
    expect(signedIn.headers.get('Location')).toBe(`${ORIGIN}${returnTo}`);
    const current = { cookie: cookie(signedIn), ...(await (await send('/session', { session: { cookie: cookie(signedIn) } })).json()) };
    const states = database.sqlite.prepare('SELECT COUNT(*) n FROM site_oauth_states').get().n, calls = fetch.mock.calls.length;
    const alreadyLoggedIn = await send(`/auth/${provider}/start?returnTo=${encodeURIComponent(returnTo)}`, { session: current });
    expect(alreadyLoggedIn.headers.get('Location')).toBe(`${ORIGIN}${returnTo}`);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_oauth_states').get().n).toBe(states);
    expect(fetch).toHaveBeenCalledTimes(calls);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_members').get().n).toBe(1);
  });
  it('normalizes only safe payment and review return paths and carries the validated payment return through social signup', async () => {
    const requestId = crypto.randomUUID(), resumeId = crypto.randomUUID(), targetId = crypto.randomUUID();
    expect(safeSiteReturnTo(`/pay?request=${requestId}&resume=${resumeId}`)).toBe(`/pay/?request=${requestId}&resume=${resumeId}`);
    expect(safeSiteReturnTo(`/pay/?request=${requestId}&retry=${resumeId}`)).toBe(`/pay/?request=${requestId}&retry=${resumeId}`);
    expect(safeSiteReturnTo(`/reviews/write?targetId=${targetId}`)).toBe(`/reviews/write/?targetId=${targetId}`);
    expect(safeSiteReturnTo('/reviews/write')).toBe('/reviews/write/');
    expect(safeSiteReturnTo('/checkout/')).toBe('/checkout/');
    expect(safeSiteReturnTo('/account/#cart')).toBe('/account/#cart');
    expect(safeSiteReturnTo('/account/#reviews')).toBe('/account/#reviews');
    expect(safeSiteReturnTo('/account/#orders')).toBe('/account/#orders');
    expect(safeSiteReturnTo(`/checkout/?cart=${resumeId}`)).toBe(`/checkout/?cart=${resumeId}`);
    for (const value of [`/checkout/?cart=${resumeId}&cart=${resumeId}`, `/checkout/?cart=${resumeId}&product=one`, `/checkout/?cart=${resumeId}&amount=1`, `/checkout/?cart=${resumeId}#private`, '/checkout/?cart=invalid']) expect(safeSiteReturnTo(value)).toBeNull();
    for (const value of ['/account/#unexpected', '/account/?token=secret#cart', '/account/#cart&token=secret']) expect(safeSiteReturnTo(value)).toBeNull();
    expect(safeSiteReturnTo('/checkout?product=pronunciation-workbook')).toBe('/checkout/?product=pronunciation-workbook');
    expect(safeSiteReturnTo(`/checkout/?order=${resumeId}`)).toBe(`/checkout/?order=${resumeId}`);
    for (const value of ['/checkout/?product=one&product=two', '/checkout/?product=../me', `/checkout/?order=${resumeId}&product=one`,
      '/checkout/?amount=100', '/checkout/?product=one&authToken=secret']) expect(safeSiteReturnTo(value)).toBeNull();
    for (const value of ['/pay/', '/pay?request=invalid', `/pay?request=${requestId}&paymentKey=secret`,
      `/pay?request=${requestId}&resume=${resumeId}&retry=${resumeId}`, `/pay?request=${requestId}&request=${requestId}`,
      `/reviews/write/?targetId=${targetId}&token=secret`, '/reviews/write/#fragment', 'https://attacker.invalid/pay/', '//attacker.invalid/pay/',
      '/account/?paymentKey=secret', '/different/../pay/?request=' + requestId, '/pay\\?request=' + requestId]) expect(safeSiteReturnTo(value)).toBeNull();
    const session = await guest();
    const returnTo = `/pay?request=${requestId}&resume=${resumeId}`;
    const response = await send(`/auth/kakao/start?returnTo=${encodeURIComponent(returnTo)}`, { session });
    expect(response.status).toBe(302);
    const start = new URL(response.headers.get('Location'));
    expect(database.sqlite.prepare('SELECT return_to FROM site_oauth_states').get().return_to).toBe(`/pay/?request=${requestId}&resume=${resumeId}`);
    mockKakao();
    const callback = await send(`/auth/kakao/callback?state=${start.searchParams.get('state')}&code=fixture`, { session });
    const complete = new URL(callback.headers.get('Location'));
    expect(complete.pathname).toBe('/signup/complete/');
    expect(complete.searchParams.get('returnTo')).toBe(`/pay/?request=${requestId}&resume=${resumeId}`);
  });
  it('preserves only valid product quantities and coupon IDs in checkout login returns', () => {
    const couponId = crypto.randomUUID(), orderId = crypto.randomUUID();
    expect(safeSiteReturnTo(`/checkout?coupon=${couponId}&quantity=3&product=daily-sentence`))
      .toBe(`/checkout/?product=daily-sentence&quantity=3&coupon=${couponId}`);
    expect(safeSiteReturnTo(`/checkout/?product=daily-sentence&quantity=1&coupon=${couponId}`))
      .toBe(`/checkout/?product=daily-sentence&coupon=${couponId}`);
    expect(safeSiteReturnTo('/checkout/?product=daily-sentence&quantity=99')).toBe('/checkout/?product=daily-sentence&quantity=99');
    expect(safeSiteReturnTo(`/checkout/?order=${orderId.toUpperCase()}`)).toBe(`/checkout/?order=${orderId}`);
    for (const value of [`/checkout/?order=${orderId}&quantity=2`, `/checkout/?order=${orderId}&coupon=${couponId}`,
      `/checkout/?product=daily-sentence&coupon=${couponId}&coupon=${couponId}`, '/checkout/?product=daily-sentence&quantity=2&quantity=3',
      '/checkout/?product=daily-sentence&quantity=0', '/checkout/?product=daily-sentence&quantity=100',
      '/checkout/?product=daily-sentence&quantity=1.5', '/checkout/?product=daily-sentence&quantity=01',
      `/checkout/?coupon=${couponId}`, '/checkout/?quantity=2', `/checkout/?product=daily-sentence&coupon=${couponId.toUpperCase()}`,
      '/checkout/?product=daily-sentence&coupon=not-a-uuid', '/checkout/?product=daily--sentence', `/checkout/?product=${'a'.repeat(81)}`,
      `/checkout/?product=daily-sentence&coupon=${couponId}&discountAmount=100`, '/checkout/?product=daily-sentence&amount=1']) {
      expect(safeSiteReturnTo(value)).toBeNull();
    }
  });
  it.each(['google','kakao'])('retains product, quantity and coupon through %s OAuth state and profile completion', async provider => {
    const session = await guest(), couponId = crypto.randomUUID();
    const returnTo = `/checkout/?product=daily-sentence&quantity=3&coupon=${couponId}`;
    const response = await send(`/auth/${provider}/start?returnTo=${encodeURIComponent(returnTo)}`, { session }); expect(response.status).toBe(302);
    const start = new URL(response.headers.get('Location'));
    expect(database.sqlite.prepare('SELECT return_to FROM site_oauth_states').get().return_to).toBe(returnTo);
    if (provider === 'google') mockGoogle(await googleToken(start.searchParams.get('nonce'))); else mockKakao();
    const callback = await send(`/auth/${provider}/callback?state=${start.searchParams.get('state')}&code=fixture-checkout`, { session });
    expect(callback.status).toBe(302); const complete = new URL(callback.headers.get('Location'));
    expect(complete.pathname).toBe('/signup/complete/'); expect(complete.searchParams.get('returnTo')).toBe(returnTo);
    const current = await send('/session', { session: { cookie: cookie(callback) } });
    const pending = { cookie: cookie(callback), ...(await current.json()) };
    const completed = await send('/auth/profile-complete', { method: 'POST', session: pending,
      body: { name: '쿠폰 구매자', nickname: '', termsAccepted: true, privacyAccepted: true } });
    expect(completed.status).toBe(200); await send('/auth/logout', { method: 'POST', session: pending });
    const guestAgain = await guest();
    const secondStart = new URL((await send(`/auth/${provider}/start?returnTo=${encodeURIComponent(returnTo)}`, { session: guestAgain })).headers.get('Location'));
    if (provider === 'google') mockGoogle(await googleToken(secondStart.searchParams.get('nonce'))); else mockKakao();
    const signedIn = await send(`/auth/${provider}/callback?state=${secondStart.searchParams.get('state')}&code=fixture-repeat-checkout`, { session: guestAgain });
    expect(signedIn.headers.get('Location')).toBe(`${ORIGIN}${returnTo}`);
  });
  it('separates equal provider subjects from different configured apps and survives session-secret rotation', async () => {
    mockKakao();
    const enter = async () => {
      const session = await guest(), start = new URL((await send('/auth/kakao/start', { session })).headers.get('Location'));
      const response = await send(`/auth/kakao/callback?state=${start.searchParams.get('state')}&code=fixture`, { session });
      const current = await send('/session', { session: { cookie: cookie(response) } });
      return { cookie: cookie(response), ...(await current.json()) };
    };
    const first = await enter();
    await send('/auth/logout', { method: 'POST', session: first });
    env.SITE_KAKAO_REST_KEY = 'different-isolated-kakao-app';
    const second = await enter();
    expect(second.member.id).not.toBe(first.member.id);
    await send('/auth/logout', { method: 'POST', session: second });
    env.SITE_SESSION_SECRET = 'rotated-isolated-site-session-secret-32';
    const repeated = await enter();
    expect(repeated.member.id).toBe(second.member.id);
    const rows = database.sqlite.prepare("SELECT provider_subject FROM site_members WHERE provider='kakao'").all();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(row => row.provider_subject)).size).toBe(2);
    expect(rows.every(row => row.provider_subject.endsWith(':123456789'))).toBe(true);
  });
  it('verifies signed Google tokens, completes required profile and consents, then reuses only provider subject', async () => {
    const session = await guest(), start = await send('/auth/google/start?returnTo=/account/', { session });
    const location = new URL(start.headers.get('Location'));
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/site/auth/google/callback`);
    mockGoogle(await googleToken(location.searchParams.get('nonce')));
    const response = await send(`/auth/google/callback?state=${location.searchParams.get('state')}&code=fixture-code`, { session, origin: null });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(`${ORIGIN}/signup/complete/`);
    const pendingResponse = await send('/session', { session: { cookie: cookie(response) } });
    const pending = { cookie: cookie(response), ...(await pendingResponse.json()) };
    expect(pending.member.provider).toBe('google');
    expect(pending.member.profileComplete).toBe(false);
    expect((await authorizeSiteMember(request('/me', { session: pending }), env)).status).toBe(409);
    const complete = await send('/auth/profile-complete', { method: 'POST', session: pending, body:
      { name: '가상 소셜 회원', nickname: '후기 닉네임', termsAccepted: true, privacyAccepted: true, marketingAccepted: false } });
    expect(complete.status).toBe(200);
    expect((await complete.json()).member).toMatchObject({ profileComplete: true, name: '가상 소셜 회원', nickname: '후기 닉네임' });
    const renamed = await send('/me', { method: 'PUT', session: pending, body: { name: '변경 소셜 이름', nickname: '변경 닉네임' } });
    expect(renamed.status).toBe(400);
    expect(await renamed.json()).toEqual({ error: '회원 이름은 변경할 수 없습니다.', code: 'member_name_immutable' });
    expect(database.sqlite.prepare('SELECT name,nickname FROM site_members WHERE id=?').get(pending.member.id))
      .toEqual({ name: '가상 소셜 회원', nickname: '후기 닉네임' });
    await send('/auth/logout', { method: 'POST', session: pending });
    const second = await guest(), restart = new URL((await send('/auth/google/start', { session: second })).headers.get('Location'));
    mockGoogle(await googleToken(restart.searchParams.get('nonce')));
    const reentered = await send(`/auth/google/callback?state=${restart.searchParams.get('state')}&code=fixture-code`, { session: second });
    expect(reentered.headers.get('Location')).toBe(`${ORIGIN}/account/`);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_members').get().n).toBe(1);
  });
  it('binds OAuth state to the browser, consumes it once and rejects arbitrary return URLs', async () => {
    const first = await guest(), second = await guest();
    for (const target of ['https://attacker.invalid', '//attacker.invalid', '/account/?next=x', '/api/site/admin', '/account/%2e%2e/']) {
      expect((await send(`/auth/kakao/start?returnTo=${encodeURIComponent(target)}`, { session: first })).status).toBe(400);
    }
    const start = new URL((await send('/auth/kakao/start', { session: first })).headers.get('Location'));
    const path = `/auth/kakao/callback?state=${start.searchParams.get('state')}&code=fixture-code`;
    mockKakao();
    expect((await send(path, { session: second })).headers.get('Location')).toContain('social_login_failed');
    expect(database.sqlite.prepare('SELECT consumed_at FROM site_oauth_states').get().consumed_at).toBeNull();
    expect((await send(path, { session: first })).headers.get('Location')).toBe(`${ORIGIN}/signup/complete/`);
    expect((await send(path, { session: first })).headers.get('Location')).toContain('social_login_failed');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not merge an existing email member with a different social provider', async () => {
    const emailMember = await registered();
    const session = await guest(), start = new URL((await send('/auth/kakao/start', { session })).headers.get('Location'));
    mockKakao(EMAIL);
    const response = await send(`/auth/kakao/callback?state=${start.searchParams.get('state')}&code=fixture-code`, { session });
    expect(response.headers.get('Location')).toBe(`${ORIGIN}/signup/complete/`);
    expect(response.headers.get('Set-Cookie')).not.toBeNull();
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_members').get().n).toBe(2);
    const social = database.sqlite.prepare("SELECT * FROM site_members WHERE provider='kakao'").get();
    expect(social.id).not.toBe(emailMember.member.id);
    expect(social.email).toBe(EMAIL);
    expect(social.password_hash).toBeNull();
    const passwordLogin = await login();
    expect(passwordLogin.session.member.id).toBe(emailMember.member.id);
  });
  it('allows separate email signup after social login but never promotes social email to password login', async () => {
    const session = await guest(), start = new URL((await send('/auth/kakao/start', { session })).headers.get('Location'));
    mockKakao(EMAIL);
    await send(`/auth/kakao/callback?state=${start.searchParams.get('state')}&code=fixture`, { session });
    const social = database.sqlite.prepare("SELECT * FROM site_members WHERE provider='kakao'").get();
    expect((await login()).response.status).toBe(401);
    const email = await registered();
    expect(email.member.id).not.toBe(social.id);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_members WHERE email=?').get(EMAIL).n).toBe(2);
    expect((await login()).session.member.id).toBe(email.member.id);
    expect(database.sqlite.prepare("SELECT password_hash FROM site_members WHERE provider='kakao'").get().password_hash).toBeNull();
  });
  it('rejects invalid signature, issuer, audience, nonce and expiration independently of TLS', async () => {
    const session = await guest(), start = new URL((await send('/auth/google/start', { session })).headers.get('Location'));
    const nonce = start.searchParams.get('nonce'), state = database.sqlite.prepare('SELECT * FROM site_oauth_states').get();
    const verify = token => verifySiteGoogleIdentity(token, env.GAME_GOOGLE_CLIENT_ID, state.nonce_hash, SESSION_SECRET, { jwks: googleKeys });
    expect(await verify(await googleToken(nonce))).toMatchObject({ subject: 'google-fixture-user' });
    for (const token of [await googleToken('wrong-nonce'), await googleToken(nonce, { aud: 'wrong-client' }),
      await googleToken(nonce, { iss: 'https://attacker.invalid' }), await googleToken(nonce, { exp: Math.floor(Date.now() / 1000) - 100 }),
      `${btoa('{"alg":"none"}')}.${btoa('{"sub":"forged"}')}.`]) expect(await verify(token)).toBeNull();
  });
  it('consumes canceled states and refuses disabled providers or expired states without network access', async () => {
    const session = await guest(), start = new URL((await send('/auth/google/start', { session })).headers.get('Location'));
    const failed = await send(`/auth/google/callback?state=${start.searchParams.get('state')}&error=access_denied`, { session });
    expect(failed.headers.get('Location')).toContain('social_login_failed');
    expect(database.sqlite.prepare('SELECT consumed_at FROM site_oauth_states').get().consumed_at).not.toBeNull();
    const other = new URL((await send('/auth/kakao/start', { session })).headers.get('Location'));
    database.sqlite.exec('UPDATE site_oauth_states SET expires_at=0');
    expect((await send(`/auth/kakao/callback?state=${other.searchParams.get('state')}&code=fixture`, { session })).headers.get('Location')).toContain('social_login_failed');
    expect(fetch).not.toHaveBeenCalled();
    delete env.GAME_GOOGLE_CLIENT_SECRET;
    expect((await send('/auth/google/start', { session })).status).toBe(503);
    expect((await (await send('/session', { session })).json()).capabilities.google).toBe(false);
  });
});

async function registeredSocial(provider = 'kakao', email = 'social-link@example.invalid') {
  const session = await guest();
  const start = new URL((await send(`/auth/${provider}/start`, { session })).headers.get('Location'));
  if (provider === 'google') mockGoogle(await googleToken(start.searchParams.get('nonce'), { email })); else mockKakao(email);
  const callback = await send(`/auth/${provider}/callback?state=${start.searchParams.get('state')}&code=fixture`, { session });
  const pending = { cookie: cookie(callback), ...(await (await send('/session', { session: { cookie: cookie(callback) } })).json()) };
  const completed = await send('/auth/profile-complete', { method: 'POST', session: pending,
    body: { name: '연결 회원', termsAccepted: true, privacyAccepted: true } });
  expect(completed.status).toBe(200);
  return { ...pending, member: (await completed.json()).member };
}
async function identityStart(session, provider) {
  const response = await send(`/auth/identities/${provider}/link`, { method: 'POST', session, body: {} });
  expect(response.status).toBe(200);
  return new URL((await response.json()).authorizationUrl);
}
async function identityCallback(session, provider, start) {
  if (provider === 'google') mockGoogle(await googleToken(start.searchParams.get('nonce'))); else mockKakao();
  return send(`/auth/${provider}/callback?state=${start.searchParams.get('state')}&code=fixture-link`, { session });
}
async function emailIdentityProof(session, email) {
  const response = await send('/auth/identities/email/request', { method: 'POST', session, body: { email } });
  expect(response.status).toBe(200);
  const { challengeId } = await response.json(), code = mail.at(-1).text.match(/\b\d{6}\b/)[0];
  const verified = await send('/auth/identities/email/verify', { method: 'POST', session, body: { challengeId, code } });
  expect(verified.status).toBe(200);
  return { challengeId, code, ...(await verified.json()) };
}

describe('canonical member login methods', () => {
  it('lists only this member login methods without subjects or credentials', async () => {
    const member = await registered();
    const response = await send('/auth/identities', { session: member });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ identities: [{ provider: 'email', connected: true, email: EMAIL }],
      availableProviders: { phone: false, email: true, google: true, kakao: true } });
    expect((await send('/auth/identities')).status).toBe(401);
    const text = await (await send('/auth/identities', { session: member })).text();
    expect(text).not.toMatch(/provider_subject|password|csrf|token_hash|member_id/);
  });
  it('requires a complete signed-in member and CSRF POST for explicit linking', async () => {
    const member = await registered(), anonymous = await guest();
    for (const path of ['/auth/identities/google/link', '/auth/identities/kakao/link', '/auth/identities/email/request']) {
      expect((await send(path, { method: 'GET', session: member })).status).toBe(405);
      expect((await send(path, { method: 'POST', session: { cookie: member.cookie }, body: {} })).status).toBe(403);
      expect((await send(path, { method: 'POST', session: anonymous, body: {} })).status).toBe(401);
    }
    const response = await send('/auth/kakao/start', { session: member });
    expect(response.headers.get('Location')).toBe(`${ORIGIN}/account/`);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_member_link_intents').get().n).toBe(0);
  });
  it.each(['google', 'kakao'])('links %s to the current canonical member and later logs into the same history', async provider => {
    const member = await registered(), original = database.sqlite.prepare('SELECT * FROM site_members WHERE id=?').get(member.member.id);
    database.sqlite.exec('CREATE TABLE fixture_member_history(id TEXT PRIMARY KEY,member_id TEXT REFERENCES site_members(id));');
    database.sqlite.prepare('INSERT INTO fixture_member_history VALUES(?,?)').run('existing-order-and-student', member.member.id);
    const start = await identityStart(member, provider), linked = await identityCallback(member, provider, start);
    expect(linked.headers.get('Location')).toBe(`${ORIGIN}/account/?loginMethod=connected#profile`);
    expect(linked.headers.get('Set-Cookie')).toBeNull();
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_members').get().n).toBe(1);
    expect(database.sqlite.prepare('SELECT * FROM site_members WHERE id=?').get(member.member.id)).toEqual(original);
    const identities = (await (await send('/auth/identities', { session: member })).json()).identities;
    expect(identities.map(row => row.provider)).toEqual(['email', provider]);
    expect((await send(`/auth/identities/${provider}/link`, { method: 'POST', session: member, body: {} })).status).toBe(409);
    await send('/auth/logout', { method: 'POST', session: member });
    const anonymous = await guest(), loginStart = new URL((await send(`/auth/${provider}/start`, { session: anonymous })).headers.get('Location'));
    if (provider === 'google') mockGoogle(await googleToken(loginStart.searchParams.get('nonce'))); else mockKakao();
    const entered = await send(`/auth/${provider}/callback?state=${loginStart.searchParams.get('state')}&code=fixture-login`, { session: anonymous });
    const current = await (await send('/session', { session: { cookie: cookie(entered) } })).json();
    expect(current.member.id).toBe(member.member.id);
    expect(database.sqlite.prepare('SELECT member_id FROM fixture_member_history').get().member_id).toBe(member.member.id);
  });
  it('keeps an already-owned social identity on its original member and never switches the current session', async () => {
    const owner = await registeredSocial(), member = await registered();
    const start = await identityStart(member, 'kakao'), callback = await identityCallback(member, 'kakao', start);
    expect(callback.headers.get('Location')).toBe(`${ORIGIN}/account/?loginMethod=conflict#profile`);
    expect(database.sqlite.prepare("SELECT member_id FROM site_member_identities WHERE provider='kakao'").get().member_id).toBe(owner.member.id);
    expect((await (await send('/session', { session: member })).json()).member.id).toBe(member.member.id);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_members').get().n).toBe(2);
  });
  it('allows only one of two canonical members to claim the same social identity concurrently', async () => {
    const first = await registered('first-link@example.invalid'), second = await registered('second-link@example.invalid');
    const one = await identityStart(first, 'kakao'), two = await identityStart(second, 'kakao');
    mockKakao();
    const responses = await Promise.all([[first, one], [second, two]].map(([session, start]) => send(`/auth/kakao/callback?state=${start.searchParams.get('state')}&code=fixture-race`, { session })));
    expect(responses.map(response => new URL(response.headers.get('Location')).searchParams.get('loginMethod')).sort()).toEqual(['conflict', 'connected']);
    expect(database.sqlite.prepare("SELECT COUNT(*) n FROM site_member_identities WHERE provider='kakao'").get().n).toBe(1);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_members').get().n).toBe(2);
  });
  it('binds a link callback to its original member and browser session', async () => {
    const first = await registered('bound-first@example.invalid'), second = await registered('bound-second@example.invalid');
    const start = await identityStart(first, 'kakao');
    const response = await send(`/auth/kakao/callback?state=${start.searchParams.get('state')}&code=fixture`, { session: second });
    expect(response.headers.get('Location')).toContain('social_login_failed');
    expect(fetch).not.toHaveBeenCalled();
    expect(database.sqlite.prepare("SELECT COUNT(*) n FROM site_member_identities WHERE provider='kakao'").get().n).toBe(0);
  });
  it.each(['revoked', 'suspended', 'incomplete', 'csrf'])('rechecks %s membership after provider awaits before inserting any identity', async change => {
    const member = await registered(), start = await identityStart(member, 'kakao');
    mockKakao();
    const providerFetch = fetch;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (String(url) === 'https://kauth.kakao.com/oauth/token') {
        if (change === 'revoked') database.sqlite.prepare('UPDATE site_sessions SET revoked_at=1 WHERE member_id=?').run(member.member.id);
        else if (change === 'suspended') database.sqlite.prepare("UPDATE site_members SET status='suspended' WHERE id=?").run(member.member.id);
        else if (change === 'incomplete') database.sqlite.prepare("UPDATE site_members SET privacy_accepted_at='' WHERE id=?").run(member.member.id);
        else database.sqlite.prepare("UPDATE site_sessions SET csrf_hash='rotated-unit-csrf' WHERE member_id=?").run(member.member.id);
      }
      return providerFetch(url, init);
    }));
    const callback = await send(`/auth/kakao/callback?state=${start.searchParams.get('state')}&code=fixture-revoked`, { session: member });
    expect(callback.headers.get('Location')).toBe(`${ORIGIN}/account/?loginMethod=failed#profile`);
    expect(database.sqlite.prepare("SELECT COUNT(*) n FROM site_member_identities WHERE provider='kakao'").get().n).toBe(0);
  });
  it('rejects an expired link intent before any provider exchange', async () => {
    const member = await registered(), start = await identityStart(member, 'kakao');
    database.sqlite.exec('UPDATE site_member_link_intents SET expires_at=0');
    const callback = await send(`/auth/kakao/callback?state=${start.searchParams.get('state')}&code=fixture-expired`, { session: member });
    expect(callback.headers.get('Location')).toContain('loginMethod=failed');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('binds an OAuth link intent to its creating CSRF snapshot even before callback authentication', async () => {
    const member = await registered(), start = await identityStart(member, 'kakao');
    database.sqlite.prepare("UPDATE site_sessions SET csrf_hash='rotated-before-callback' WHERE member_id=?").run(member.member.id);
    const callback = await send(`/auth/kakao/callback?state=${start.searchParams.get('state')}&code=fixture-csrf`, { session: member });
    expect(callback.headers.get('Location')).toContain('loginMethod=failed');
    expect(fetch).not.toHaveBeenCalled();
    expect(database.sqlite.prepare("SELECT COUNT(*) n FROM site_member_identities WHERE provider='kakao'").get().n).toBe(0);
  });
  it('connects a verified email to a social primary member, uses one canonical password and revokes all sessions on reset', async () => {
    const member = await registeredSocial('google'), linkedEmail = 'email-login@example.invalid';
    const proof = await emailIdentityProof(member, linkedEmail);
    const linked = await send('/auth/identities/email/link', { method: 'POST', session: member,
      body: { registrationToken: proof.registrationToken, password: PASSWORD, passwordConfirm: PASSWORD } });
    expect(linked.status).toBe(200);
    expect((await login(linkedEmail)).session.member.id).toBe(member.member.id);
    expect(database.sqlite.prepare('SELECT provider FROM site_members WHERE id=?').get(member.member.id).provider).toBe('google');
    const pending = await identityStart(member, 'kakao');
    const anonymous = await guest();
    expect((await send('/auth/password/request-reset', { method: 'POST', session: anonymous, body: { email: linkedEmail } })).status).toBe(200);
    const token = mail.at(-1).text.match(/token=([A-Za-z0-9_-]{43})/)[1], nextPassword = 'Changed-password84';
    expect((await send('/auth/password/reset', { method: 'POST', session: anonymous,
      body: { token, password: nextPassword, passwordConfirm: nextPassword } })).status).toBe(200);
    expect((await send('/me', { session: member })).status).toBe(401);
    expect((await login(linkedEmail, PASSWORD)).response.status).toBe(401);
    expect((await login(linkedEmail, nextPassword)).session.member.id).toBe(member.member.id);
    const failedLink = await send(`/auth/kakao/callback?state=${pending.searchParams.get('state')}&code=fixture-after-reset`, { session: member });
    expect(failedLink.headers.get('Location')).toContain('social_login_failed');
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_members').get().n).toBe(1);
  });
  it('separates ordinary registration proof from email linking even when a session is rebound in a fault scenario', async () => {
    const member = await registeredSocial(), anonymous = await guest(), proof = await verifiedRegistration(anonymous, 'signup-proof@example.invalid');
    database.sqlite.prepare('UPDATE site_sessions SET member_id=? WHERE token_hash IS NOT NULL AND member_id IS NULL AND id=(SELECT session_id FROM site_registration_tokens WHERE token_hash IS NOT NULL ORDER BY created_at DESC LIMIT 1)').run(member.member.id);
    const response = await send('/auth/identities/email/link', { method: 'POST', session: anonymous,
      body: { registrationToken: proof.registrationToken, password: PASSWORD, passwordConfirm: PASSWORD } });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('link_proof_expired');
    expect(database.sqlite.prepare("SELECT COUNT(*) n FROM site_member_identities WHERE provider='email'").get().n).toBe(0);
  });
  it('does not turn link-purpose email proof into a new signup', async () => {
    const member = await registeredSocial(), proof = await emailIdentityProof(member, 'link-only@example.invalid');
    database.sqlite.prepare('UPDATE site_sessions SET member_id=NULL WHERE member_id=?').run(member.member.id);
    const response = await send('/auth/signup', { method: 'POST', session: member,
      body: { registrationToken: proof.registrationToken, password: PASSWORD, passwordConfirm: PASSWORD, name: '중복 금지', termsAccepted: true, privacyAccepted: true } });
    expect(response.status).toBe(409);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_members').get().n).toBe(1);
  });
  it('refuses a verified email already owned by another canonical member without merging either account', async () => {
    const owner = await registered(), social = await registeredSocial('kakao', EMAIL), proof = await emailIdentityProof(social, EMAIL);
    const response = await send('/auth/identities/email/link', { method: 'POST', session: social,
      body: { registrationToken: proof.registrationToken, password: PASSWORD, passwordConfirm: PASSWORD } });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('identity_conflict');
    expect(database.sqlite.prepare("SELECT member_id FROM site_member_identities WHERE provider='email'").get().member_id).toBe(owner.member.id);
    expect(database.sqlite.prepare('SELECT password_hash FROM site_members WHERE id=?').get(social.member.id).password_hash).toBeNull();
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_members').get().n).toBe(2);
  });
  it('does not attach an expired email proof or store its password', async () => {
    const member = await registeredSocial(), proof = await emailIdentityProof(member, 'expired-link@example.invalid');
    database.sqlite.exec("UPDATE site_member_link_intents SET expires_at=0 WHERE provider='email'");
    const response = await send('/auth/identities/email/link', { method: 'POST', session: member,
      body: { registrationToken: proof.registrationToken, password: PASSWORD, passwordConfirm: PASSWORD } });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('link_proof_expired');
    expect(database.sqlite.prepare('SELECT password_hash FROM site_members WHERE id=?').get(member.member.id).password_hash).toBeNull();
  });
  it('retains verified link proof until its advertised token expiry when challenge cleanup runs', async () => {
    const member = await registeredSocial(), proof = await emailIdentityProof(member, 'retained-link@example.invalid');
    database.sqlite.prepare('UPDATE site_email_challenges SET expires_at=0 WHERE id=?').run(proof.challengeId);
    expect((await cleanupSiteAuthState(env)).unavailable).toBeUndefined();
    expect(database.sqlite.prepare('SELECT id FROM site_email_challenges WHERE id=?').get(proof.challengeId)).toBeDefined();
    const response = await send('/auth/identities/email/link', { method: 'POST', session: member,
      body: { registrationToken: proof.registrationToken, password: PASSWORD, passwordConfirm: PASSWORD } });
    expect(response.status).toBe(200);
  });
  it('allows only one concurrent member to attach the same verified email credential', async () => {
    const first = await registeredSocial('google'), second = await registeredSocial('kakao');
    const email = 'concurrent-link@example.invalid';
    const one = await emailIdentityProof(first, email), two = await emailIdentityProof(second, email);
    const responses = await Promise.all([[first, one], [second, two]].map(([session, proof]) => send('/auth/identities/email/link', {
      method: 'POST', session, body: { registrationToken: proof.registrationToken, password: PASSWORD, passwordConfirm: PASSWORD },
    })));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(database.sqlite.prepare("SELECT COUNT(*) n FROM site_member_identities WHERE provider='email'").get().n).toBe(1);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_members WHERE password_hash IS NOT NULL').get().n).toBe(1);
  });
  it('does not issue a new password session if password reset wins after verification but before rotation', async () => {
    const member = await registered(), changed = await hashSitePassword('Changed-during-login84', PASSWORD_SECRET);
    const originalBatch = database.db.batch;
    let changedOnce = false;
    database.db.batch = statements => {
      if (!changedOnce) {
        changedOnce = true;
        database.sqlite.prepare('UPDATE site_members SET password_hash=?,password_salt=?,password_iterations=? WHERE id=?')
          .run(changed.hash, changed.salt, changed.iterations, member.member.id);
        database.sqlite.prepare('UPDATE site_sessions SET revoked_at=1 WHERE member_id=?').run(member.member.id);
      }
      return originalBatch(statements);
    };
    const outcome = await login();
    expect(changedOnce).toBe(true);
    expect(outcome.response.status).toBe(401);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_sessions WHERE member_id=? AND revoked_at IS NULL').get(member.member.id).n).toBe(0);
  });
  it('backfills legacy identity ownership idempotently without replacing an existing owner', async () => {
    const member = await registered(), before = database.sqlite.prepare('SELECT * FROM site_member_identities').get();
    const migration = readFileSync(new URL('../migrations/0026_site_member_identities.sql', import.meta.url), 'utf8');
    database.sqlite.exec(migration); database.sqlite.exec(migration);
    expect(database.sqlite.prepare('SELECT * FROM site_member_identities').get()).toEqual(before);
    expect(database.sqlite.prepare('SELECT COUNT(*) n FROM site_member_identities').get().n).toBe(1);
    expect((await login()).session.member.id).toBe(member.member.id);
  });
});
