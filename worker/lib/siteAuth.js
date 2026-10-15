import { z } from 'zod';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { base64url } from './auth.js';
import { sendSiteEmail, siteEmailReady } from './siteEmail.js';
import { normalizeSitePhone, domesticSitePhone, maskSitePhone, sitePhoneReady, sitePhoneDailyLimit, phoneQuotaDay, phoneQuotaRetryAfter } from './sitePhoneAuth.js';
import { SiteIdentityError, LIVE_IDENTITY_SESSION, findSiteIdentityMember, memberSiteIdentities, assertLiveIdentitySession,
  claimSiteSocialIdentity, claimSiteEmailIdentity } from './siteMemberIdentities.js';

const encoder = new TextEncoder();
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ITERATIONS = 100_000;
const nowSeconds = () => Math.floor(Date.now() / 1000);
const stamp = () => new Date().toISOString();
const opaque = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
const fail = (status, error, code) => siteJson({ error, ...(code ? { code } : {}) }, { status });
const unavailable = () => fail(503, '회원 서비스를 준비하고 있습니다. 잠시 후 다시 시도해주세요.', 'site_unavailable');
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z.string().min(8, '비밀번호는 8자 이상 입력해주세요.').max(64, '비밀번호는 64자 이하로 입력해주세요.')
  .refine(value => /[A-Za-z]/.test(value) && /\d/.test(value), '비밀번호에 영문과 숫자를 함께 사용해주세요.');
const profileShape = {
  name: z.string().trim().min(2, '이름을 2자 이상 입력해주세요.').max(40),
  nickname: z.string().trim().max(20).optional().default(''),
  phone: z.string().trim().regex(/^(?:0\d{8,10})?$/, '전화번호는 숫자로 입력해주세요.').optional().default(''),
};
const consentShape = {
  termsAccepted: z.literal(true, { errorMap: () => ({ message: '이용약관에 동의해주세요.' }) }),
  privacyAccepted: z.literal(true, { errorMap: () => ({ message: '개인정보 수집·이용에 동의해주세요.' }) }),
  marketingAccepted: z.boolean().optional().default(false),
};
const passwordShape = { password: passwordSchema, passwordConfirm: z.string() };
const confirmPassword = value => value.password === value.passwordConfirm;
const signupSchema = z.object({ registrationToken: z.string().regex(TOKEN), ...passwordShape, ...profileShape, ...consentShape }).strict()
  .refine(confirmPassword, '비밀번호 확인이 일치하지 않습니다.');
const resetSchema = z.object({ token: z.string().regex(TOKEN), ...passwordShape }).strict()
  .refine(confirmPassword, '비밀번호 확인이 일치하지 않습니다.');
const emailLinkSchema = z.object({ registrationToken: z.string().regex(TOKEN), ...passwordShape }).strict()
  .refine(confirmPassword, '비밀번호 확인이 일치하지 않습니다.');

export function siteJson(value, { status = 200, headers = {} } = {}) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'Pragma': 'no-cache',
    'Referrer-Policy': 'no-referrer', ...headers } });
}

export function siteOrigin(env) {
  const value = env.SITE_ORIGIN || 'https://tiantianchinese.com';
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local && env.SITE_ENVIRONMENT === 'development'))) {
    throw new Error('invalid_site_origin');
  }
  return url.origin;
}

export function checkSiteOrigin(request, env) {
  let origin;
  try { origin = siteOrigin(env); } catch { return unavailable(); }
  const supplied = request.headers.get('Origin');
  if (supplied && supplied !== origin) return fail(403, '허용되지 않은 요청입니다.', 'origin_denied');
  if (!supplied && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    return fail(403, '요청 출처를 확인할 수 없습니다.', 'origin_required');
  }
  return null;
}

function cookieSettings(env) {
  const origin = new URL(siteOrigin(env));
  const development = env.SITE_ENVIRONMENT === 'development' && origin.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  return { name: development ? 'hanul_site_dev' : '__Host-hanul_site', secure: !development };
}
function cookieHeader(env, token, maxAge) {
  const { name, secure } = cookieSettings(env);
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}${maxAge === undefined ? '' : `; Max-Age=${maxAge}`}`;
}
function readCookie(request, env) {
  const { name } = cookieSettings(env);
  const entries = (request.headers.get('Cookie') || '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  if (entries.length !== 1) return null;
  const token = entries[0].slice(name.length + 1);
  return TOKEN.test(token) ? token : null;
}
function ready(env) {
  return !!env.GAME_DB && typeof env.SITE_SESSION_SECRET === 'string' && env.SITE_SESSION_SECRET.length >= 32;
}
function passwordReady(env) {
  return typeof env.SITE_PASSWORD_SECRET === 'string' && env.SITE_PASSWORD_SECRET.length >= 32;
}
async function hmacKey(secret, domain, usage = 'sign') {
  const root = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const derived = await crypto.subtle.sign('HMAC', root, encoder.encode(`site-members/v1/${domain}`));
  return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}
async function hash(secret, domain, value) {
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret, domain), encoder.encode(value))));
}
async function checkHash(secret, domain, value, expected) {
  return !!expected && await crypto.subtle.verify('HMAC', await hmacKey(secret, domain, 'verify'), decode(expected), encoder.encode(value));
}
async function passwordBits(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: decode(salt), iterations, hash: 'SHA-256' }, key, 256);
}
export async function hashSitePassword(password, secret, salt = base64url(crypto.getRandomValues(new Uint8Array(16)))) {
  const bits = await passwordBits(password, salt, ITERATIONS);
  const key = await hmacKey(secret, 'password-pepper');
  return { salt, iterations: ITERATIONS, hash: base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, bits))) };
}
async function verifyPassword(password, env, member) {
  // Unknown emails and social-only members perform the same slow KDF; no fast verifier exists.
  const bits = await passwordBits(password, member?.password_salt || 'AAAAAAAAAAAAAAAAAAAAAA', member?.password_iterations || ITERATIONS);
  const key = await hmacKey(env.SITE_PASSWORD_SECRET, 'password-pepper', 'verify');
  return await crypto.subtle.verify('HMAC', key, decode(member?.password_hash || 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), bits)
    && !!member?.password_hash;
}

const memberRow = (db, id) => db.prepare('SELECT * FROM site_members WHERE id=?1').bind(id).first();
function memberDto(row) {
  return { id: row.id, memberCode: row.member_code, customerKey: row.customer_key, name: row.name, nickname: row.nickname,
    email: row.email, phone: row.phone, status: row.status, provider: row.provider,
    profileComplete: row.status === 'active' && !!row.name && !!row.terms_accepted_at && !!row.privacy_accepted_at,
    marketingAccepted: !!row.marketing_accepted };
}
async function sessionAccess(request, env, requireCsrf = false, includeMember = false) {
  const originFailure = checkSiteOrigin(request, env);
  if (originFailure) return originFailure;
  if (!ready(env)) return unavailable();
  const token = readCookie(request, env);
  if (!token) return fail(401, '세션이 만료되었습니다. 화면을 새로고침해주세요.', 'session_required');
  const tokenHash = await hash(env.SITE_SESSION_SECRET, 'session', token);
  // Read authorization uses one snapshot; CSRF routes must read the member after async verification.
  const row = await env.GAME_DB.prepare(includeMember ? `SELECT s.id,s.token_hash,s.csrf_hash,s.member_id,s.expires_at,s.revoked_at,s.created_at,
    m.id AS auth_member_id,m.member_code AS auth_member_code,m.customer_key AS auth_customer_key,
    m.name AS auth_name,m.nickname AS auth_nickname,m.email AS auth_email,m.phone AS auth_phone,
    m.status AS auth_status,m.provider AS auth_provider,m.terms_accepted_at AS auth_terms_accepted_at,
    m.privacy_accepted_at AS auth_privacy_accepted_at,m.marketing_accepted AS auth_marketing_accepted
    FROM site_sessions s LEFT JOIN site_members m ON m.id=s.member_id
    WHERE s.token_hash=?1 AND s.revoked_at IS NULL AND s.expires_at>?2`
    : 'SELECT * FROM site_sessions WHERE token_hash=?1 AND revoked_at IS NULL AND expires_at>?2')
    .bind(tokenHash, nowSeconds()).first();
  if (!row) return fail(401, '세션이 만료되었습니다. 화면을 새로고침해주세요.', 'session_expired');
  if (requireCsrf) {
    const csrf = request.headers.get('X-CSRF-Token');
    if (!csrf || !TOKEN.test(csrf) || !await checkHash(env.SITE_SESSION_SECRET, 'csrf-store', csrf, row.csrf_hash)) {
      return fail(403, '요청을 확인할 수 없습니다. 화면을 새로고침해주세요.', 'csrf_denied');
    }
  }
  if (!includeMember) return { session: row, token };
  return { session: { id: row.id, token_hash: row.token_hash, csrf_hash: row.csrf_hash, member_id: row.member_id,
    expires_at: row.expires_at, revoked_at: row.revoked_at, created_at: row.created_at }, token,
    member: row.auth_member_id ? { id: row.auth_member_id, member_code: row.auth_member_code, customer_key: row.auth_customer_key,
      name: row.auth_name, nickname: row.auth_nickname, email: row.auth_email, phone: row.auth_phone, status: row.auth_status,
      provider: row.auth_provider, terms_accepted_at: row.auth_terms_accepted_at,
      privacy_accepted_at: row.auth_privacy_accepted_at, marketing_accepted: row.auth_marketing_accepted } : null };
}

export async function authorizeSiteMember(request, env, { requireCsrf = false, allowIncomplete = false } = {}) {
  try {
    const access = await sessionAccess(request, env, requireCsrf, !requireCsrf);
    if (access instanceof Response) return access;
    if (!access.session.member_id) return fail(401, '로그인 후 이용해주세요.', 'login_required');
    const row = requireCsrf ? await memberRow(env.GAME_DB, access.session.member_id) : access.member;
    if (!row || ['suspended', 'withdrawn'].includes(row.status)) return fail(403, '이용할 수 없는 계정입니다.', 'member_unavailable');
    const member = memberDto(row);
    if (!allowIncomplete && !member.profileComplete) return fail(409, '회원 정보를 먼저 완성해주세요.', 'profile_incomplete');
    return { member, session: access.session };
  } catch { return unavailable(); }
}

async function newSession(env, memberId = null, remember = false) {
  const token = opaque();
  const csrf = await hash(env.SITE_SESSION_SECRET, 'csrf-token', token);
  const seconds = memberId ? (remember ? 30 * 86400 : 86400) : 3600;
  return { id: crypto.randomUUID(), token, csrf, tokenHash: await hash(env.SITE_SESSION_SECRET, 'session', token),
    csrfHash: await hash(env.SITE_SESSION_SECRET, 'csrf-store', csrf), expires: nowSeconds() + seconds, created: stamp(),
    cookie: cookieHeader(env, token, memberId && remember ? seconds : undefined) };
}
function sessionInsert(db, value, memberId = null) {
  return db.prepare('INSERT INTO site_sessions(id,token_hash,csrf_hash,member_id,expires_at,created_at) VALUES(?1,?2,?3,?4,?5,?6)')
    .bind(value.id, value.tokenHash, value.csrfHash, memberId, value.expires, value.created);
}
async function rotateSession(env, oldSession, memberId, remember = false, expectedPassword = null) {
  const value = await newSession(env, memberId, remember);
  await env.GAME_DB.batch([
    env.GAME_DB.prepare(`INSERT INTO site_sessions(id,token_hash,csrf_hash,member_id,expires_at,created_at)
      SELECT ?1,?2,?3,?4,?5,?6 FROM site_sessions WHERE id=?7 AND revoked_at IS NULL AND expires_at>?8
      AND EXISTS(SELECT 1 FROM site_members WHERE id=?4 AND status IN ('pending','active'))
      AND (?9 IS NULL OR EXISTS(SELECT 1 FROM site_members m JOIN site_member_identities i ON i.member_id=m.id
        WHERE m.id=?4 AND i.provider='email' AND i.provider_subject=?10
        AND m.password_hash=?9 AND m.password_salt=?11 AND m.password_iterations=?12))`)
      .bind(value.id, value.tokenHash, value.csrfHash, memberId, value.expires, value.created, oldSession.id, nowSeconds(),
        expectedPassword?.hash ?? null, expectedPassword?.email ?? null, expectedPassword?.salt ?? null, expectedPassword?.iterations ?? null),
    env.GAME_DB.prepare(`UPDATE site_sessions SET revoked_at=?1 WHERE id=?2 AND revoked_at IS NULL
      AND EXISTS(SELECT 1 FROM site_sessions WHERE id=?3)`).bind(nowSeconds(), oldSession.id, value.id),
  ]);
  const created = await env.GAME_DB.prepare('SELECT id FROM site_sessions WHERE id=?1').bind(value.id).first();
  return created ? value : null;
}
async function sessionRoute(request, env) {
  const access = await sessionAccess(request, env);
  let row = null;
  if (!(access instanceof Response)) {
    if (access.session.member_id) row = await memberRow(env.GAME_DB, access.session.member_id);
    if (!row || ['pending', 'active'].includes(row.status)) {
      return siteJson({ member: row ? memberDto(row) : null,
        csrfToken: await hash(env.SITE_SESSION_SECRET, 'csrf-token', access.token), capabilities: capabilities(env) });
    }
    await env.GAME_DB.prepare('UPDATE site_sessions SET revoked_at=?1 WHERE id=?2').bind(nowSeconds(), access.session.id).run();
  } else if (access.status !== 401) return access;
  const limited = await enforceRate(env, [[`guest-session:${ip(request)}`, 120, 3600]]);
  if (limited) return limited;
  const value = await newSession(env);
  await sessionInsert(env.GAME_DB, value).run();
  return siteJson({ member: null, csrfToken: value.csrf, capabilities: capabilities(env) }, { headers: { 'Set-Cookie': value.cookie } });
}

async function readBody(request, schema) {
  const size = Number(request.headers.get('Content-Length') || 0);
  if (size > 16_384) return fail(413, '입력 내용이 너무 큽니다.');
  const raw = await request.text();
  if (encoder.encode(raw).byteLength > 16_384) return fail(413, '입력 내용이 너무 큽니다.');
  let value;
  try { value = JSON.parse(raw); } catch { return fail(400, '입력값을 확인해주세요.'); }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fail(400, parsed.error.issues[0]?.message || '입력값을 확인해주세요.');
}
async function enforceRate(env, keys) {
  const now = nowSeconds();
  for (const [key, limit, window] of keys) {
    const keyHash = await hash(env.SITE_SESSION_SECRET, 'rate', key);
    const row = await env.GAME_DB.prepare(`INSERT INTO site_auth_rate_limits(key_hash,count,expires_at) VALUES(?1,1,?2)
      ON CONFLICT(key_hash) DO UPDATE SET count=CASE WHEN expires_at<=?3 THEN 1 ELSE count+1 END,
      expires_at=CASE WHEN expires_at<=?3 THEN ?2 ELSE expires_at END WHERE expires_at<=?3 OR count<?4 RETURNING count`)
      .bind(keyHash, now + window, now, limit).first();
    if (!row) {
      // Different limits can expire at different times. Report when all current
      // denials end rather than resetting the wait on each rejected request.
      let retryAfter = 1;
      for (const [blockedKey, blockedLimit] of keys) {
        const blockedHash = await hash(env.SITE_SESSION_SECRET, 'rate', blockedKey);
        const blocked = await env.GAME_DB.prepare('SELECT expires_at FROM site_auth_rate_limits WHERE key_hash=?1 AND count>=?2 AND expires_at>?3')
          .bind(blockedHash, blockedLimit, now).first();
        if (blocked) retryAfter = Math.max(retryAfter, blocked.expires_at - now);
      }
      return siteJson({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', code: 'rate_limited' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } });
    }
  }
  return null;
}
const ip = request => request.headers.get('CF-Connecting-IP') || 'unknown';
function guestOnly(access) {
  return access.session.member_id ? fail(409, '이미 로그인되어 있습니다.', 'already_logged_in') : null;
}

async function requestEmail(request, env, access, linking = false) {
  const loggedIn = !linking && guestOnly(access);
  if (loggedIn) return loggedIn;
  if (linking && await env.GAME_DB.prepare("SELECT 1 connected FROM site_member_identities WHERE member_id=?1 AND provider='email'").bind(access.member.id).first()) {
    return fail(409, '이메일 로그인이 이미 연결되어 있습니다.', 'identity_already_connected');
  }
  if (!passwordReady(env) || !siteEmailReady(env)) return unavailable();
  const data = await readBody(request, z.object({ email: emailSchema }).strict());
  if (data instanceof Response) return data;
  const limited = await enforceRate(env, [[`email-ip:${ip(request)}`, 30, 3600], [`email:${data.email}`, 5, 3600]]);
  if (limited) return limited;
  // Rejection sampling prevents modulo bias in the six-digit CSPRNG code.
  let number;
  do { number = crypto.getRandomValues(new Uint32Array(1))[0]; } while (number >= 4_294_000_000);
  const code = String(number % 1_000_000).padStart(6, '0');
  const id = crypto.randomUUID();
  const proof = await hash(env.SITE_SESSION_SECRET, `email-proof:${id}`, code);
  if (linking) {
    const linkId = await hash(env.SITE_SESSION_SECRET, 'identity-link-session', `${id}:${access.session.csrf_hash}`);
    const now = nowSeconds(), at = stamp(), base = [access.member.id, access.session.id, access.session.csrf_hash, now];
    await env.GAME_DB.batch([
      env.GAME_DB.prepare(`INSERT INTO site_email_challenges(id,email,proof_hash,session_id,expires_at,created_at)
        SELECT ?5,?6,?7,?2,?8,?9 WHERE ${LIVE_IDENTITY_SESSION}`)
        .bind(...base, id, data.email, proof, now + 300, at),
      env.GAME_DB.prepare(`INSERT INTO site_member_link_intents(id,provider,member_id,session_id,email_challenge_id,expires_at,created_at)
        SELECT ?8,'email',?1,?2,id,?6,?7 FROM site_email_challenges WHERE id=?5 AND ${LIVE_IDENTITY_SESSION}`)
        .bind(...base, id, now + 300, at, linkId),
    ]);
    if (!await env.GAME_DB.prepare('SELECT id FROM site_member_link_intents WHERE email_challenge_id=?1').bind(id).first()) {
      return fail(401, '세션이 만료되었습니다. 다시 로그인해주세요.', 'session_expired');
    }
  } else await env.GAME_DB.prepare(`INSERT INTO site_email_challenges(id,email,proof_hash,session_id,expires_at,created_at)
    VALUES(?1,?2,?3,?4,?5,?6)`).bind(id, data.email, proof, access.session.id, nowSeconds() + 300, stamp()).run();
  try { await sendSiteEmail(env, data.email, { code }); } catch {
    await env.GAME_DB.prepare('UPDATE site_email_challenges SET consumed_at=?1 WHERE id=?2').bind(nowSeconds(), id).run();
    return unavailable();
  }
  return siteJson({ ok: true, challengeId: id, expiresIn: 300 });
}
async function verifyEmail(request, env, access, linking = false) {
  const loggedIn = !linking && guestOnly(access);
  if (loggedIn) return loggedIn;
  const data = await readBody(request, z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }).strict());
  if (data instanceof Response) return data;
  const limited = await enforceRate(env, [[`email-verify-ip:${ip(request)}`, 60, 300]]);
  if (limited) return limited;
  if (linking) {
    const intent = await env.GAME_DB.prepare('SELECT id FROM site_member_link_intents WHERE email_challenge_id=?1 AND member_id=?2 AND session_id=?3')
      .bind(data.challengeId, access.member.id, access.session.id).first();
    if (!intent || !await checkHash(env.SITE_SESSION_SECRET, 'identity-link-session', `${data.challengeId}:${access.session.csrf_hash}`, intent.id)) {
      return fail(400, '연결 인증이 만료되었습니다. 다시 인증해주세요.', 'link_proof_expired');
    }
  }
  const challenge = linking ? await env.GAME_DB.prepare(`UPDATE site_email_challenges SET attempts=attempts+1
    WHERE id=?5 AND session_id=?2 AND consumed_at IS NULL AND expires_at>?4 AND attempts<5
    AND EXISTS(SELECT 1 FROM site_member_link_intents l WHERE l.email_challenge_id=?5 AND l.provider='email'
      AND l.member_id=?1 AND l.session_id=?2 AND l.consumed_at IS NULL AND l.expires_at>?4) AND ${LIVE_IDENTITY_SESSION} RETURNING *`)
    .bind(access.member.id, access.session.id, access.session.csrf_hash, nowSeconds(), data.challengeId).first()
    : await env.GAME_DB.prepare(`UPDATE site_email_challenges SET attempts=attempts+1
    WHERE id=?1 AND session_id=?2 AND consumed_at IS NULL AND expires_at>?3 AND attempts<5
      AND NOT EXISTS(SELECT 1 FROM site_member_link_intents WHERE email_challenge_id=site_email_challenges.id) RETURNING *`)
    .bind(data.challengeId, access.session.id, nowSeconds()).first();
  if (!challenge || !await checkHash(env.SITE_SESSION_SECRET, `email-proof:${data.challengeId}`, data.code, challenge.proof_hash)) {
    return fail(400, '인증번호가 틀렸거나 만료되었습니다. 다시 요청해주세요.', 'email_verification_failed');
  }
  const token = opaque(), tokenHash = await hash(env.SITE_SESSION_SECRET, 'registration', token), consumption = crypto.randomUUID();
  if (linking) {
    const now = nowSeconds(), expires = now + 600, base = [access.member.id, access.session.id, access.session.csrf_hash, now];
    await env.GAME_DB.batch([
      env.GAME_DB.prepare(`UPDATE site_email_challenges SET consumed_at=?4,consumption_id=?5 WHERE id=?6 AND session_id=?2
        AND consumed_at IS NULL AND expires_at>?4 AND attempts<=5 AND ${LIVE_IDENTITY_SESSION}`)
        .bind(...base, consumption, challenge.id),
      env.GAME_DB.prepare(`INSERT INTO site_registration_tokens(token_hash,email,session_id,expires_at,created_at)
        SELECT ?5,email,session_id,?6,?7 FROM site_email_challenges WHERE id=?8 AND consumption_id=?9 AND ${LIVE_IDENTITY_SESSION}`)
        .bind(...base, tokenHash, expires, stamp(), challenge.id, consumption),
      env.GAME_DB.prepare(`UPDATE site_member_link_intents SET registration_token_hash=?5,expires_at=?6 WHERE email_challenge_id=?7
        AND member_id=?1 AND session_id=?2 AND consumed_at IS NULL AND ${LIVE_IDENTITY_SESSION}
        AND EXISTS(SELECT 1 FROM site_registration_tokens WHERE token_hash=?5 AND session_id=?2)`)
        .bind(...base, tokenHash, expires, challenge.id),
    ]);
  } else await env.GAME_DB.batch([
    env.GAME_DB.prepare(`UPDATE site_email_challenges SET consumed_at=?1,consumption_id=?2
      WHERE id=?3 AND session_id=?4 AND consumed_at IS NULL AND expires_at>?1 AND attempts<=5`)
      .bind(nowSeconds(), consumption, challenge.id, access.session.id),
    env.GAME_DB.prepare(`INSERT INTO site_registration_tokens(token_hash,email,session_id,expires_at,created_at)
      SELECT ?1,email,session_id,?2,?3 FROM site_email_challenges WHERE id=?4 AND consumption_id=?5`)
      .bind(tokenHash, nowSeconds() + 600, stamp(), challenge.id, consumption),
  ]);
  const created = await env.GAME_DB.prepare('SELECT token_hash FROM site_registration_tokens WHERE token_hash=?1').bind(tokenHash).first();
  if (!created) return fail(400, '이미 사용한 인증번호입니다. 다시 요청해주세요.');
  return siteJson({ registrationToken: token, expiresIn: 600 });
}

async function signup(request, env, access) {
  const loggedIn = guestOnly(access);
  if (loggedIn) return loggedIn;
  if (!passwordReady(env)) return unavailable();
  const data = await readBody(request, signupSchema);
  if (data instanceof Response) return data;
  const limited = await enforceRate(env, [[`signup:${ip(request)}`, 20, 3600]]);
  if (limited) return limited;
  const tokenHash = await hash(env.SITE_SESSION_SECRET, 'registration', data.registrationToken);
  const registration = await env.GAME_DB.prepare(`SELECT * FROM site_registration_tokens
    WHERE token_hash=?1 AND session_id=?2 AND consumed_at IS NULL AND expires_at>?3`)
    .bind(tokenHash, access.session.id, nowSeconds()).first();
  if (!registration) return fail(400, '이메일 인증이 만료되었습니다. 다시 인증해주세요.', 'registration_expired');
  const existing = await findSiteIdentityMember(env.GAME_DB, 'email', registration.email);
  if (existing) return fail(409, '이미 가입한 이메일입니다. 기존 계정으로 로그인해주세요.', 'email_already_registered');
  const password = await hashSitePassword(data.password, env.SITE_PASSWORD_SECRET);
  const id = crypto.randomUUID(), at = stamp(), code = `H${opaque().slice(0, 10).toUpperCase().replace(/[-_]/g, 'X')}`;
  const session = await newSession(env, id);
  await env.GAME_DB.batch([
    env.GAME_DB.prepare(`INSERT INTO site_members(id,status,email,name,nickname,phone,member_code,customer_key,provider,
      password_hash,password_salt,password_iterations,registration_token_hash,terms_accepted_at,privacy_accepted_at,
      marketing_accepted,created_at,updated_at)
      SELECT ?1,'active',email,?2,?3,?4,?5,?6,'email',?7,?8,?9,token_hash,?10,?10,?11,?10,?10
      FROM site_registration_tokens WHERE token_hash=?12 AND session_id=?13 AND consumed_at IS NULL AND expires_at>?14
      AND EXISTS(SELECT 1 FROM site_sessions WHERE id=?13 AND revoked_at IS NULL AND expires_at>?14 AND member_id IS NULL)
      AND NOT EXISTS(SELECT 1 FROM site_member_link_intents WHERE registration_token_hash=?12)
      AND NOT EXISTS(SELECT 1 FROM site_member_identities WHERE provider='email' AND provider_subject=site_registration_tokens.email)
      ON CONFLICT DO NOTHING`)
      .bind(id, data.name, data.nickname, data.phone, code, crypto.randomUUID(), password.hash, password.salt, password.iterations,
        at, data.marketingAccepted ? 1 : 0, tokenHash, access.session.id, nowSeconds()),
    env.GAME_DB.prepare(`INSERT INTO site_member_identities(provider,provider_subject,member_id,email,created_at)
      SELECT 'email',email,id,email,created_at FROM site_members WHERE id=?1 AND registration_token_hash=?2 ON CONFLICT DO NOTHING`)
      .bind(id, tokenHash),
    env.GAME_DB.prepare(`UPDATE site_registration_tokens SET consumed_at=?1 WHERE token_hash=?2
      AND EXISTS(SELECT 1 FROM site_members WHERE id=?3 AND registration_token_hash=?2)`).bind(nowSeconds(), tokenHash, id),
    env.GAME_DB.prepare(`UPDATE site_sessions SET revoked_at=?1 WHERE id=?2
      AND EXISTS(SELECT 1 FROM site_members WHERE id=?3)`).bind(nowSeconds(), access.session.id, id),
    env.GAME_DB.prepare(`INSERT INTO site_sessions(id,token_hash,csrf_hash,member_id,expires_at,created_at)
      SELECT ?1,?2,?3,id,?4,?5 FROM site_members WHERE id=?6`)
      .bind(session.id, session.tokenHash, session.csrfHash, session.expires, session.created, id),
  ]);
  const row = await memberRow(env.GAME_DB, id);
  if (!row) return fail(409, '이미 가입했거나 사용한 인증입니다. 기존 계정으로 로그인해주세요.', 'signup_conflict');
  return siteJson({ member: memberDto(row), csrfToken: session.csrf }, { status: 201, headers: { 'Set-Cookie': session.cookie } });
}

async function login(request, env, access) {
  const loggedIn = guestOnly(access);
  if (loggedIn) return loggedIn;
  if (!passwordReady(env)) return unavailable();
  const data = await readBody(request, z.object({ email: emailSchema, password: z.string().min(1).max(64), remember: z.boolean().optional().default(false) }).strict());
  if (data instanceof Response) return data;
  const limited = await enforceRate(env, [[`login-ip:${ip(request)}`, 40, 900], [`login-email:${data.email}`, 10, 900]]);
  if (limited) return limited;
  const row = await findSiteIdentityMember(env.GAME_DB, 'email', data.email);
  const verified = await verifyPassword(data.password, env, row);
  if (!verified || !row || row.status !== 'active') return fail(401, '이메일 또는 비밀번호를 확인해주세요.', 'login_failed');
  const session = await rotateSession(env, access.session, row.id, data.remember,
    { email: data.email, hash: row.password_hash, salt: row.password_salt, iterations: row.password_iterations });
  if (!session) return fail(401, '세션이 만료되었습니다. 화면을 새로고침해주세요.', 'session_expired');
  return siteJson({ member: memberDto(row), csrfToken: session.csrf }, { headers: { 'Set-Cookie': session.cookie } });
}

async function requestReset(request, env) {
  if (!passwordReady(env) || !siteEmailReady(env)) return unavailable();
  const data = await readBody(request, z.object({ email: emailSchema }).strict());
  if (data instanceof Response) return data;
  const limited = await enforceRate(env, [[`reset-ip:${ip(request)}`, 30, 3600], [`reset-email:${data.email}`, 5, 3600]]);
  if (limited) return limited;
  const identityMember = await findSiteIdentityMember(env.GAME_DB, 'email', data.email);
  const row = identityMember?.status === 'active' ? identityMember : null;
  const token = opaque();
  const tokenHash = await hash(env.SITE_SESSION_SECRET, 'password-reset', token);
  if (row) {
    await env.GAME_DB.prepare(`INSERT INTO site_password_resets(token_hash,member_id,expires_at,created_at) VALUES(?1,?2,?3,?4)`)
      .bind(tokenHash, row.id, nowSeconds() + 900, stamp()).run();
    try { await sendSiteEmail(env, data.email, { resetUrl: `${siteOrigin(env)}/password/reset/?token=${encodeURIComponent(token)}` }); } catch {
      await env.GAME_DB.prepare('UPDATE site_password_resets SET consumed_at=?1 WHERE token_hash=?2').bind(nowSeconds(), tokenHash).run();
      // Do not reveal whether an email has an account, even when the provider rejects this recipient.
    }
  }
  return siteJson({ ok: true });
}
async function resetPassword(request, env) {
  if (!passwordReady(env)) return unavailable();
  const data = await readBody(request, resetSchema);
  if (data instanceof Response) return data;
  const limited = await enforceRate(env, [[`reset-consume:${ip(request)}`, 20, 900]]);
  if (limited) return limited;
  const tokenHash = await hash(env.SITE_SESSION_SECRET, 'password-reset', data.token);
  const password = await hashSitePassword(data.password, env.SITE_PASSWORD_SECRET);
  const consumption = crypto.randomUUID(), now = nowSeconds();
  await env.GAME_DB.batch([
    env.GAME_DB.prepare(`UPDATE site_password_resets SET consumed_at=?1,consumption_id=?2 WHERE token_hash=?3
      AND consumed_at IS NULL AND expires_at>?1 AND EXISTS(SELECT 1 FROM site_members m JOIN site_member_identities i ON i.member_id=m.id
        WHERE m.id=site_password_resets.member_id AND m.status='active' AND i.provider='email')`)
      .bind(now, consumption, tokenHash),
    env.GAME_DB.prepare(`UPDATE site_members SET password_hash=?1,password_salt=?2,password_iterations=?3,updated_at=?4
      WHERE id=(SELECT member_id FROM site_password_resets WHERE token_hash=?5 AND consumption_id=?6)`)
      .bind(password.hash, password.salt, password.iterations, stamp(), tokenHash, consumption),
    env.GAME_DB.prepare(`UPDATE site_sessions SET revoked_at=?1 WHERE member_id=
      (SELECT member_id FROM site_password_resets WHERE token_hash=?2 AND consumption_id=?3) AND revoked_at IS NULL`)
      .bind(now, tokenHash, consumption),
    env.GAME_DB.prepare(`UPDATE site_password_resets SET consumed_at=?1 WHERE member_id=
      (SELECT member_id FROM site_password_resets WHERE token_hash=?2 AND consumption_id=?3) AND consumed_at IS NULL`)
      .bind(now, tokenHash, consumption),
  ]);
  const consumed = await env.GAME_DB.prepare('SELECT token_hash FROM site_password_resets WHERE token_hash=?1 AND consumption_id=?2')
    .bind(tokenHash, consumption).first();
  if (!consumed) return fail(400, '재설정 링크가 만료되었거나 사용되었습니다. 다시 요청해주세요.', 'reset_expired');
  return siteJson({ ok: true });
}

function socialConfig(env, provider) {
  const idKey = provider === 'google' ? 'GOOGLE_CLIENT_ID' : 'KAKAO_REST_KEY';
  const secretKey = provider === 'google' ? 'GOOGLE_CLIENT_SECRET' : 'KAKAO_CLIENT_SECRET';
  // One OAuth app owns both credentials; partial SITE configuration must not borrow a GAME secret.
  const source = env[`SITE_${idKey}`] !== undefined || env[`SITE_${secretKey}`] !== undefined ? 'SITE' : 'GAME';
  const clientId = env[`${source}_${idKey}`], clientSecret = env[`${source}_${secretKey}`];
  return clientId && (provider === 'kakao' || clientSecret) ? { clientId, clientSecret } : null;
}
function capabilities(env) {
  const paymentPrefix = env.SITE_TOSS_MODE === 'test' ? 'test_' : env.SITE_TOSS_MODE === 'live' ? 'live_' : null;
  return { phone: sitePhoneReady(env), email: passwordReady(env) && siteEmailReady(env), google: !!socialConfig(env, 'google'),
    kakao: !!socialConfig(env, 'kakao'), payments: !!paymentPrefix
      && typeof env.SITE_TOSS_CLIENT_KEY === 'string' && env.SITE_TOSS_CLIENT_KEY.startsWith(`${paymentPrefix}gck_`)
      && typeof env.SITE_TOSS_SECRET_KEY === 'string' && env.SITE_TOSS_SECRET_KEY.startsWith(`${paymentPrefix}gsk_`)
      && typeof env.SITE_TOSS_MERCHANT_ID === 'string' && env.SITE_TOSS_MERCHANT_ID.length > 0 };
}
export function safeSiteReturnTo(raw) {
  if (raw === '/personal' || raw === '/personal/') return '/personal/';
  if (raw === '/account/#cart' || raw === '/account/#orders' || raw === '/account/#reviews') return raw;
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || raw.includes('#')) return null;
  const path = raw.split('?')[0];
  const base = new Map([['/account', '/account/'], ['/account/', '/account/'], ['/checkout', '/checkout/'], ['/checkout/', '/checkout/'],
    ['/reviews', '/reviews/'], ['/reviews/', '/reviews/']]);
  let url;
  try { url = new URL(raw, 'https://site-return.invalid'); } catch { return null; }
  if (path === '/checkout' || path === '/checkout/') {
    const keys = [...url.searchParams.keys()];
    if (!keys.length) return '/checkout/';
    if (url.searchParams.has('cart')) {
      const cart = url.searchParams.get('cart');
      return keys.length === 1 && z.string().uuid().safeParse(cart).success
        ? `/checkout/?${new URLSearchParams({ cart: cart.toLowerCase() })}` : null;
    }
    const allowed = ['product','order','quantity','coupon'];
    if (keys.some(key => !allowed.includes(key)) || allowed.some(key => url.searchParams.getAll(key).length > 1)) return null;
    const product = url.searchParams.get('product'), order = url.searchParams.get('order');
    if (url.searchParams.has('order')) return keys.length === 1 && z.string().uuid().safeParse(order).success
      ? `/checkout/?${new URLSearchParams({ order: order.toLowerCase() })}` : null;
    if (!product || product.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product)) return null;
    const quantity = url.searchParams.get('quantity'), coupon = url.searchParams.get('coupon');
    if (quantity !== null && !/^[1-9]\d?$/.test(quantity)) return null;
    if (coupon !== null && (coupon !== coupon.toLowerCase() || !z.string().uuid().safeParse(coupon).success)) return null;
    return `/checkout/?${new URLSearchParams({ product, ...(quantity && Number(quantity) > 1 ? { quantity } : {}), ...(coupon ? { coupon } : {}) })}`;
  }
  if (base.has(path)) return url.search ? null : base.get(path);
  const pay = path === '/pay' || path === '/pay/';
  const writeReview = path === '/reviews/write' || path === '/reviews/write/';
  if (!pay && !writeReview) return null;
  const allowed = pay ? ['request', 'resume', 'retry'] : ['targetId'];
  if ([...url.searchParams.keys()].some(key => !allowed.includes(key))
    || allowed.some(key => url.searchParams.getAll(key).length > 1)) return null;
  if (pay && (!url.searchParams.has('request') || (url.searchParams.has('resume') && url.searchParams.has('retry')))) return null;
  const query = new URLSearchParams();
  for (const key of allowed) {
    if (!url.searchParams.has(key)) continue;
    const value = url.searchParams.get(key);
    if (!z.string().uuid().safeParse(value).success) return null;
    query.set(key, value.toLowerCase());
  }
  return `${pay ? '/pay/' : '/reviews/write/'}${query.size ? `?${query}` : ''}`;
}

async function siteSocialSubject(clientId, subject) {
  // Provider IDs can be scoped to an OAuth app. This stable namespace survives session-secret rotation.
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(clientId)));
  return `${base64url(new Uint8Array(digest))}:${subject}`;
}
function redirect(target, cookie) {
  return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
}
function socialAuthorizationUrl(provider, config, callbackUri, state, nonce) {
  const query = new URLSearchParams({ client_id: config.clientId, redirect_uri: callbackUri, response_type: 'code', state });
  if (provider === 'google') { query.set('scope', 'openid profile email'); query.set('nonce', nonce); }
  return `${provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://kauth.kakao.com/oauth/authorize'}?${query}`;
}
async function identityList(request, env) {
  const access = await authorizeSiteMember(request, env);
  if (access instanceof Response) return access;
  const rows = await memberSiteIdentities(env.GAME_DB, access), available = capabilities(env);
  await assertLiveIdentitySession(env.GAME_DB, access);
  return siteJson({ identities: rows.results.map(row => ({ provider: row.provider, connected: true, email: row.email || null,
    ...(row.provider === 'phone' ? { phone: maskSitePhone(row.phone_subject) } : {}) })),
    availableProviders: { phone: available.phone, email: available.email, google: available.google, kakao: available.kakao } });
}
async function emailIdentityLink(request, env, access) {
  if (!passwordReady(env)) return unavailable();
  const data = await readBody(request, emailLinkSchema);
  if (data instanceof Response) return data;
  const limited = await enforceRate(env, [[`email-link:${access.member.id}`, 10, 900]]);
  if (limited) return limited;
  const existing = await env.GAME_DB.prepare("SELECT 1 connected FROM site_member_identities WHERE member_id=?1 AND provider='email'").bind(access.member.id).first();
  if (existing) return fail(409, '이메일 로그인이 이미 연결되어 있습니다.', 'identity_already_connected');
  const tokenHash = await hash(env.SITE_SESSION_SECRET, 'registration', data.registrationToken);
  const proof = await env.GAME_DB.prepare(`SELECT t.email,l.id,l.email_challenge_id FROM site_registration_tokens t JOIN site_member_link_intents l ON l.registration_token_hash=t.token_hash
    WHERE t.token_hash=?1 AND t.session_id=?2 AND t.consumed_at IS NULL AND t.expires_at>?3 AND l.provider='email'
      AND l.member_id=?4 AND l.session_id=?2 AND l.consumed_at IS NULL AND l.expires_at>?3`)
    .bind(tokenHash, access.session.id, nowSeconds(), access.member.id).first();
  if (!proof) return fail(400, '연결 인증이 만료되었습니다. 다시 인증해주세요.', 'link_proof_expired');
  if (!await checkHash(env.SITE_SESSION_SECRET, 'identity-link-session', `${proof.email_challenge_id}:${access.session.csrf_hash}`, proof.id)) {
    return fail(400, '연결 인증이 만료되었습니다. 다시 인증해주세요.', 'link_proof_expired');
  }
  const password = await hashSitePassword(data.password, env.SITE_PASSWORD_SECRET);
  await claimSiteEmailIdentity(env, access, { tokenHash, password });
  return siteJson({ ok: true });
}
async function socialIdentityLinkStart(request, env, provider, access) {
  const config = socialConfig(env, provider);
  if (!config) return unavailable();
  const body = await readBody(request, z.object({}).strict());
  if (body instanceof Response) return body;
  if (await env.GAME_DB.prepare('SELECT 1 connected FROM site_member_identities WHERE member_id=?1 AND provider=?2').bind(access.member.id, provider).first()) {
    return fail(409, '이미 연결된 로그인 방법입니다.', 'identity_already_connected');
  }
  const limited = await enforceRate(env, [[`identity-link:${access.member.id}`, 10, 900], [`oauth-start:${ip(request)}`, 30, 900]]);
  if (limited) return limited;
  const state = opaque(), nonce = opaque(), stateHash = await hash(env.SITE_SESSION_SECRET, 'oauth-state', state);
  const nonceHash = await hash(env.SITE_SESSION_SECRET, 'oauth-nonce', nonce);
  const linkId = await hash(env.SITE_SESSION_SECRET, 'identity-link-session', `${stateHash}:${access.session.csrf_hash}`);
  const callbackUri = `${siteOrigin(env)}/api/site/auth/${provider}/callback`, now = nowSeconds(), expires = now + 600;
  const base = [access.member.id, access.session.id, access.session.csrf_hash, now], at = stamp();
  await env.GAME_DB.batch([
    env.GAME_DB.prepare(`INSERT INTO site_oauth_states(state_hash,provider,nonce_hash,session_id,callback_uri,return_to,expires_at,created_at)
      SELECT ?5,?6,?7,?2,?8,'/account/',?9,?10 WHERE ${LIVE_IDENTITY_SESSION}`)
      .bind(...base, stateHash, provider, nonceHash, callbackUri, expires, at),
    env.GAME_DB.prepare(`INSERT INTO site_member_link_intents(id,provider,member_id,session_id,oauth_state_hash,expires_at,created_at)
      SELECT ?8,provider,?1,?2,state_hash,?6,?7 FROM site_oauth_states WHERE state_hash=?5 AND ${LIVE_IDENTITY_SESSION}`)
      .bind(...base, stateHash, expires, at, linkId),
  ]);
  if (!await env.GAME_DB.prepare('SELECT id FROM site_member_link_intents WHERE oauth_state_hash=?1').bind(stateHash).first()) {
    return fail(401, '세션이 만료되었습니다. 다시 로그인해주세요.', 'session_expired');
  }
  return siteJson({ authorizationUrl: socialAuthorizationUrl(provider, config, callbackUri, state, nonce) });
}
async function oauthStart(request, env, provider) {
  const config = socialConfig(env, provider);
  if (!config) return unavailable();
  const url = new URL(request.url), returnTo = safeSiteReturnTo(url.searchParams.get('returnTo') || '/account/');
  if (!returnTo || url.searchParams.getAll('returnTo').length > 1 || [...url.searchParams.keys()].some(key => key !== 'returnTo')) {
    return fail(400, '로그인 후 돌아갈 주소를 확인해주세요.');
  }
  const limited = await enforceRate(env, [[`oauth-start:${ip(request)}`, 30, 900]]);
  if (limited) return limited;
  let access = await sessionAccess(request, env), cookie;
  if (access instanceof Response) {
    if (access.status !== 401) return access;
    const value = await newSession(env);
    await sessionInsert(env.GAME_DB, value).run();
    access = { session: { id: value.id } };
    cookie = value.cookie;
  }
  if (access.session.member_id) return redirect(`${siteOrigin(env)}${returnTo}`);
  const state = opaque(), nonce = opaque(), callbackUri = `${siteOrigin(env)}/api/site/auth/${provider}/callback`;
  await env.GAME_DB.prepare(`INSERT INTO site_oauth_states(state_hash,provider,nonce_hash,session_id,callback_uri,return_to,expires_at,created_at)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`).bind(await hash(env.SITE_SESSION_SECRET, 'oauth-state', state), provider,
      await hash(env.SITE_SESSION_SECRET, 'oauth-nonce', nonce), access.session.id, callbackUri, returnTo, nowSeconds() + 600, stamp()).run();
  return redirect(socialAuthorizationUrl(provider, config, callbackUri, state, nonce), cookie);
}
let googleJwks;
export async function verifySiteGoogleIdentity(idToken, audience, nonceHash, secret, { jwks } = {}) {
  try {
    googleJwks ||= createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
    const { payload } = await jwtVerify(idToken, jwks || googleJwks, { algorithms: ['RS256'],
      issuer: ['https://accounts.google.com', 'accounts.google.com'], audience,
      requiredClaims: ['sub', 'exp', 'iat', 'nonce'] });
    if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255 || !Number.isSafeInteger(payload.exp)
      || typeof payload.nonce !== 'string' || !await checkHash(secret, 'oauth-nonce', payload.nonce, nonceHash)
      || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== audience)) return null;
    const email = payload.email_verified === true && emailSchema.safeParse(payload.email).success
      ? emailSchema.parse(payload.email) : null;
    return { subject: payload.sub, email, nickname: typeof payload.name === 'string' ? payload.name.trim().slice(0, 20) : '' };
  } catch { return null; }
}
async function socialIdentity(env, provider, code, state) {
  const config = socialConfig(env, provider);
  if (!config) return null;
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: config.clientId, redirect_uri: state.callback_uri });
  if (config.clientSecret) body.set('client_secret', config.clientSecret);
  const response = await fetch(provider === 'google' ? 'https://oauth2.googleapis.com/token' : 'https://kauth.kakao.com/oauth/token',
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return null;
  const token = await response.json();
  if (provider === 'google') return verifySiteGoogleIdentity(token.id_token, config.clientId, state.nonce_hash, env.SITE_SESSION_SECRET);
  if (typeof token.access_token !== 'string') return null;
  const profile = await fetch('https://kapi.kakao.com/v2/user/me', { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(10_000) });
  if (!profile.ok) return null;
  const data = await profile.json();
  if (!(Number.isSafeInteger(data.id) && data.id > 0)) return null;
  const account = data.kakao_account || {};
  const email = account.is_email_verified === true && account.is_email_valid === true && emailSchema.safeParse(account.email).success
    ? emailSchema.parse(account.email) : null;
  return { subject: String(data.id), email, nickname: typeof account.profile?.nickname === 'string' ? account.profile.nickname.trim().slice(0, 20) : '' };
}
async function oauthCallback(request, env, provider) {
  let linkIntent;
  const linkResult = value => redirect(`${siteOrigin(env)}/account/?loginMethod=${value}#profile`);
  const failure = () => linkIntent ? linkResult('failed') : redirect(`${siteOrigin(env)}/login/?error=social_login_failed`);
  const access = await sessionAccess(request, env);
  if (access instanceof Response) return failure();
  const url = new URL(request.url), stateToken = url.searchParams.get('state'), code = url.searchParams.get('code');
  if (!stateToken || !TOKEN.test(stateToken)) return failure();
  const stateHash = await hash(env.SITE_SESSION_SECRET, 'oauth-state', stateToken);
  // Browser-bound state is consumed atomically before any provider exchange, including denied authorizations.
  const state = await env.GAME_DB.prepare(`UPDATE site_oauth_states SET consumed_at=?1 WHERE state_hash=?2 AND provider=?3
    AND session_id=?4 AND expires_at>?1 AND consumed_at IS NULL RETURNING *`)
    .bind(nowSeconds(), stateHash, provider, access.session.id).first();
  if (!state) return failure();
  linkIntent = await env.GAME_DB.prepare('SELECT * FROM site_member_link_intents WHERE oauth_state_hash=?1').bind(stateHash).first();
  if (!code || code.length > 2048 || url.searchParams.get('error')) return failure();
  let linkAccess;
  if (linkIntent) {
    linkAccess = await authorizeSiteMember(request, env);
    if (linkAccess instanceof Response || linkAccess.member.id !== linkIntent.member_id || linkAccess.session.id !== linkIntent.session_id
      || state.session_id !== linkIntent.session_id || linkIntent.expires_at <= nowSeconds() || linkIntent.consumed_at !== null) return failure();
    if (!await checkHash(env.SITE_SESSION_SECRET, 'identity-link-session', `${stateHash}:${linkAccess.session.csrf_hash}`, linkIntent.id)) return failure();
  }
  const limited = await enforceRate(env, [[`oauth-callback:${ip(request)}`, 30, 900]]);
  if (limited) return limited;
  let identity;
  try { identity = await socialIdentity(env, provider, code, state); } catch { return failure(); }
  if (!identity) return failure();
  const config = socialConfig(env, provider);
  if (!config) return failure();
  const subject = await siteSocialSubject(config.clientId, identity.subject);
  let row = await findSiteIdentityMember(env.GAME_DB, provider, subject);
  if (linkIntent) {
    try {
      const already = row?.id === linkAccess.member.id;
      await claimSiteSocialIdentity(env, linkAccess, { stateHash, provider, subject, email: identity.email });
      return linkResult(already ? 'already_connected' : 'connected');
    } catch (error) { return linkResult(error instanceof SiteIdentityError && error.code === 'identity_conflict' ? 'conflict' : 'failed'); }
  }
  if (!row) {
    // The same address can have independent identities; only provider+subject identifies a social member.
    const id = crypto.randomUUID(), at = stamp();
    await env.GAME_DB.batch([
      env.GAME_DB.prepare(`INSERT INTO site_members(id,status,email,nickname,member_code,customer_key,provider,provider_subject,created_at,updated_at)
        SELECT ?1,'pending',?2,?3,?4,?5,?6,?7,?8,?8
        WHERE NOT EXISTS(SELECT 1 FROM site_member_identities WHERE provider=?6 AND provider_subject=?7)
        AND EXISTS(SELECT 1 FROM site_sessions WHERE id=?9 AND member_id IS NULL AND revoked_at IS NULL AND expires_at>?10) ON CONFLICT DO NOTHING`)
        .bind(id, identity.email, identity.nickname, `H${opaque().slice(0, 10).toUpperCase().replace(/[-_]/g, 'X')}`, crypto.randomUUID(), provider, subject, at, access.session.id, nowSeconds()),
      env.GAME_DB.prepare(`INSERT INTO site_member_identities(provider,provider_subject,member_id,email,created_at)
        SELECT provider,provider_subject,id,email,created_at FROM site_members WHERE provider=?1 AND provider_subject=?2
        AND EXISTS(SELECT 1 FROM site_sessions WHERE id=?3 AND member_id IS NULL AND revoked_at IS NULL AND expires_at>?4) ON CONFLICT DO NOTHING`)
        .bind(provider, subject, access.session.id, nowSeconds()),
    ]);
    row = await findSiteIdentityMember(env.GAME_DB, provider, subject);
  }
  if (!row || ['suspended', 'withdrawn'].includes(row.status)) return failure();
  const session = await rotateSession(env, access.session, row.id);
  if (!session) return failure();
  const returnTo = safeSiteReturnTo(state.return_to) || '/account/';
  const destination = memberDto(row).profileComplete ? returnTo
    : `/signup/complete/${returnTo === '/account/' ? '' : `?returnTo=${encodeURIComponent(returnTo)}`}`;
  return redirect(`${siteOrigin(env)}${destination}`, session.cookie);
}

async function profileComplete(request, env) {
  const access = await authorizeSiteMember(request, env, { requireCsrf: true, allowIncomplete: true });
  if (access instanceof Response) return access;
  const data = await readBody(request, z.object({ ...profileShape, ...consentShape }).strict());
  if (data instanceof Response) return data;
  if (access.member.profileComplete) return fail(409, '이미 가입을 완료했습니다.');
  const at = stamp();
  const row = await env.GAME_DB.prepare(`UPDATE site_members SET status='active',name=?1,nickname=?2,phone=?3,
    terms_accepted_at=?4,privacy_accepted_at=?4,marketing_accepted=?5,updated_at=?4 WHERE id=?6 AND status='pending' RETURNING *`)
    .bind(data.name, data.nickname, data.phone, at, data.marketingAccepted ? 1 : 0, access.member.id).first();
  if (!row) return fail(409, '회원 정보가 변경되었습니다. 새로고침해주세요.');
  return siteJson({ member: memberDto(row) });
}
async function meRoute(request, env) {
  const access = await authorizeSiteMember(request, env, { requireCsrf: request.method === 'PUT', allowIncomplete: request.method === 'GET' });
  if (access instanceof Response) return access;
  if (request.method === 'GET') return siteJson({ member: access.member });
  const data = await readBody(request, z.object({ name: z.unknown().optional(), nickname: profileShape.nickname,
    phone: profileShape.phone, marketingAccepted: z.boolean().optional() }).partial().strict()
    .refine(value => Object.keys(value).length > 0, '수정할 정보를 입력해주세요.'));
  if (data instanceof Response) return data;
  if (Object.hasOwn(data, 'name')) return fail(400, '회원 이름은 변경할 수 없습니다.', 'member_name_immutable');
  if (data.phone !== undefined && data.phone !== access.member.phone
    && await env.GAME_DB.prepare("SELECT 1 connected FROM site_member_identities WHERE member_id=?1 AND provider='phone'").bind(access.member.id).first()) {
    return fail(409, '휴대폰 번호는 인증을 통해 연결해주세요.', 'phone_verification_required');
  }
  const row = await env.GAME_DB.prepare(`UPDATE site_members SET nickname=?1,phone=CASE WHEN ?6=0 THEN phone ELSE ?2 END,marketing_accepted=?3,updated_at=?4
    WHERE id=?5 AND status='active' AND (?6=0 OR NOT EXISTS(SELECT 1 FROM site_member_identities WHERE member_id=?5 AND provider='phone')
      OR EXISTS(SELECT 1 FROM site_member_identities WHERE member_id=?5 AND provider='phone' AND provider_subject=?7)) RETURNING *`).bind(data.nickname ?? access.member.nickname,
      data.phone ?? access.member.phone, data.marketingAccepted === undefined ? (access.member.marketingAccepted ? 1 : 0) : (data.marketingAccepted ? 1 : 0),
      stamp(), access.member.id, data.phone === undefined ? 0 : 1, normalizeSitePhone(data.phone || '') || '').first();
  return row ? siteJson({ member: memberDto(row) }) : fail(409, '회원 정보가 변경되었습니다. 새로고침해주세요.');
}

// Parameters 1..4 always identify the exact active guest/member browser snapshot.
const PHONE_SESSION = `EXISTS(SELECT 1 FROM site_sessions s LEFT JOIN site_members m ON m.id=s.member_id
  WHERE s.id=?2 AND s.csrf_hash=?3 AND s.revoked_at IS NULL AND s.expires_at>?4
  AND ((?1 IS NULL AND s.member_id IS NULL) OR (s.member_id=?1 AND m.status='active'
    AND length(trim(m.name))>0 AND length(trim(COALESCE(m.terms_accepted_at,'')))>0
    AND length(trim(COALESCE(m.privacy_accepted_at,'')))>0)))`;
const phoneBase = access => [access.session.member_id || null, access.session.id, access.session.csrf_hash, nowSeconds()];
const phoneFailed = () => fail(400, '인증번호가 틀렸거나 만료되었습니다. 다시 요청해주세요.', 'phone_verification_failed');
const phoneExpired = () => fail(400, '휴대폰 인증이 만료되었습니다. 다시 인증해주세요.', 'registration_expired');
const phoneRate = seconds => siteJson({ error: '잠시 후 다시 인증번호를 요청해주세요.', code: 'phone_rate_limited' },
  { status: 429, headers: { 'Retry-After': String(seconds) } });
const phoneProofSchema = z.object({ registrationToken: z.string().regex(TOKEN) }).strict();
async function phoneSendRetryAfter(env, phoneHash, current, rateRetryAfter = 0) {
  const quota = await env.GAME_DB.prepare(`SELECT
    COALESCE((SELECT expires_at FROM site_phone_send_cooldowns WHERE phone_hash=?1),0) AS cooldown_expires_at,
    COALESCE((SELECT sends FROM site_phone_daily_usage WHERE day=?2),0) AS sends`)
    .bind(phoneHash, phoneQuotaDay(current)).first();
  return Math.max(rateRetryAfter, 0, quota.cooldown_expires_at - current,
    quota.sends >= sitePhoneDailyLimit(env) ? phoneQuotaRetryAfter(current) : 0);
}

async function phoneRequest(request, env, access, sendPhoneSms) {
  if (!sitePhoneReady(env) || typeof sendPhoneSms !== 'function') return fail(503, '휴대폰 인증을 준비 중입니다.', 'phone_not_configured');
  const data = await readBody(request, z.object({ phone: z.string().max(24).refine(value => !!normalizeSitePhone(value), '휴대폰 번호를 확인해주세요.'),
    purpose: z.enum(['signin', 'link']) }).strict());
  if (data instanceof Response) return data;
  if (data.purpose === 'signin') { const denied = guestOnly(access); if (denied) return denied; }
  else {
    const member = await authorizeSiteMember(request, env, { requireCsrf: true });
    if (member instanceof Response) return member;
    if (await env.GAME_DB.prepare("SELECT 1 connected FROM site_member_identities WHERE member_id=?1 AND provider='phone'").bind(member.member.id).first()) {
      return fail(409, '휴대폰 로그인이 이미 연결되어 있습니다.', 'identity_already_connected');
    }
  }
  const phone = normalizeSitePhone(data.phone), phoneHash = await hash(env.SITE_SESSION_SECRET, 'phone-number', phone);
  const limited = await enforceRate(env, [[`phone-send-ip:${ip(request)}`, 20, 3600], [`phone-send:${phone}`, 5, 3600], [`phone-send-session:${access.session.id}`, 5, 3600]]);
  if (limited) return phoneRate(await phoneSendRetryAfter(env, phoneHash, nowSeconds(), Number(limited.headers.get('Retry-After'))));
  let number;
  do { number = crypto.getRandomValues(new Uint32Array(1))[0]; } while (number >= 4_294_000_000);
  const code = String(number % 1_000_000).padStart(6, '0'), id = crypto.randomUUID();
  const proof = await hash(env.SITE_SESSION_SECRET, `phone-code:${id}`, code), base = phoneBase(access), now = base[3], at = stamp();
  await env.GAME_DB.batch([
    env.GAME_DB.prepare(`INSERT INTO site_phone_challenges(id,phone_e164,phone_hash,purpose,member_id,session_id,csrf_hash,proof_hash,expires_at,created_at)
      SELECT ?5,?6,?7,?8,?1,?2,?3,?9,?10,?11 WHERE ${PHONE_SESSION}
      AND NOT EXISTS(SELECT 1 FROM site_phone_send_cooldowns WHERE phone_hash=?7 AND expires_at>?4)
      AND COALESCE((SELECT sends FROM site_phone_daily_usage WHERE day=?12),0)<?13`)
      .bind(...base, id, phone, phoneHash, data.purpose, proof, now + 300, at, phoneQuotaDay(now), sitePhoneDailyLimit(env)),
    env.GAME_DB.prepare(`INSERT INTO site_phone_daily_usage(day,sends) SELECT ?2,1 FROM site_phone_challenges WHERE id=?1
      ON CONFLICT(day) DO UPDATE SET sends=sends+1`).bind(id, phoneQuotaDay(now)),
    env.GAME_DB.prepare(`INSERT INTO site_phone_send_cooldowns(phone_hash,expires_at) SELECT phone_hash,?2 FROM site_phone_challenges WHERE id=?1
      ON CONFLICT(phone_hash) DO UPDATE SET expires_at=excluded.expires_at`).bind(id, now + 60),
    env.GAME_DB.prepare(`UPDATE site_phone_challenges SET consumed_at=?3,delivery_state='superseded'
      WHERE phone_hash=?2 AND id!=?1 AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM site_phone_challenges WHERE id=?1)`)
      .bind(id, phoneHash, now),
  ]);
  if (!await env.GAME_DB.prepare('SELECT id FROM site_phone_challenges WHERE id=?1').bind(id).first()) {
    const retryAfter = await phoneSendRetryAfter(env, phoneHash, nowSeconds());
    if (retryAfter > 0) return phoneRate(retryAfter);
    const live = await env.GAME_DB.prepare(`SELECT 1 live WHERE ${PHONE_SESSION}`).bind(...phoneBase(access)).first();
    // A limit may have expired between the guarded insert and the follow-up
    // read. Keep that recoverable race distinct from a changed browser session.
    return live ? phoneRate(1) : fail(401, '세션이 변경되었습니다. 화면을 새로고침해주세요.', 'session_expired');
  }
  let delivered;
  try { delivered = await sendPhoneSms(domesticSitePhone(phone), `[하늘하늘중국어] 인증번호 [${code}] (5분 내 입력)`); }
  catch { delivered = { ok: false, state: 'unknown' }; }
  if (!delivered?.ok || delivered.state !== 'accepted') {
    await env.GAME_DB.prepare("UPDATE site_phone_challenges SET delivery_state=?1,consumed_at=?2 WHERE id=?3 AND delivery_state='pending'")
      .bind(delivered?.state === 'failed' ? 'failed' : 'unknown', nowSeconds(), id).run();
    return fail(503, '인증번호를 보내지 못했어요. 잠시 후 다시 요청해주세요.', 'phone_delivery_failed');
  }
  const accepted = await env.GAME_DB.prepare(`UPDATE site_phone_challenges SET delivery_state='accepted'
    WHERE id=?5 AND delivery_state='pending' AND consumed_at IS NULL AND expires_at>?4 AND ${PHONE_SESSION} RETURNING id`)
    .bind(...phoneBase(access), id).first();
  return accepted ? siteJson({ challengeId: id, expiresIn: 300, resendAfter: 60 }) : phoneFailed();
}

async function phoneLogin(env, access, tokenHash, member) {
  const session = await newSession(env, member.id), operation = crypto.randomUUID(), base = phoneBase(access);
  await env.GAME_DB.batch([
    env.GAME_DB.prepare(`UPDATE site_phone_proofs SET consumed_at=?4,consumption_id=?5 WHERE token_hash=?6 AND purpose='signin'
      AND member_id IS NULL AND session_id=?2 AND csrf_hash=?3 AND consumed_at IS NULL AND expires_at>?4 AND ${PHONE_SESSION}
      AND EXISTS(SELECT 1 FROM site_member_identities i JOIN site_members m ON m.id=i.member_id WHERE i.provider='phone'
        AND i.provider_subject=site_phone_proofs.phone_e164 AND i.member_id=?7 AND m.status='active')`)
      .bind(...base, operation, tokenHash, member.id),
    env.GAME_DB.prepare(`INSERT INTO site_sessions(id,token_hash,csrf_hash,member_id,expires_at,created_at)
      SELECT ?5,?6,?7,?8,?9,?10 FROM site_phone_proofs WHERE token_hash=?11 AND consumption_id=?12 AND ${PHONE_SESSION}
      AND EXISTS(SELECT 1 FROM site_member_identities i JOIN site_members m ON m.id=i.member_id
        WHERE i.provider='phone' AND i.provider_subject=site_phone_proofs.phone_e164 AND i.member_id=?8 AND m.status='active')`)
      .bind(...base, session.id, session.tokenHash, session.csrfHash, member.id, session.expires, session.created, tokenHash, operation),
    env.GAME_DB.prepare(`UPDATE site_sessions SET revoked_at=?1 WHERE id=?2 AND EXISTS(SELECT 1 FROM site_sessions WHERE id=?3)`)
      .bind(nowSeconds(), access.session.id, session.id),
  ]);
  const live = await env.GAME_DB.prepare(`SELECT m.* FROM site_sessions s JOIN site_members m ON m.id=s.member_id
    WHERE s.id=?1 AND s.revoked_at IS NULL AND s.expires_at>?2 AND m.status='active'`).bind(session.id, nowSeconds()).first();
  return live ? siteJson({ authenticated: true, member: memberDto(live), csrfToken: session.csrf }, { headers: { 'Set-Cookie': session.cookie } })
    : fail(401, '인증이 만료되었습니다. 다시 로그인해주세요.', 'session_expired');
}

async function phoneVerify(request, env, access) {
  const data = await readBody(request, z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }).strict());
  if (data instanceof Response) return data;
  const limited = await enforceRate(env, [[`phone-verify:${ip(request)}`, 60, 300]]);
  if (limited) return phoneRate(Number(limited.headers.get('Retry-After')));
  const base = phoneBase(access), challenge = await env.GAME_DB.prepare(`UPDATE site_phone_challenges SET attempts=attempts+1
    WHERE id=?5 AND member_id IS ?1 AND session_id=?2 AND csrf_hash=?3 AND consumed_at IS NULL AND expires_at>?4
      AND attempts<5 AND delivery_state='accepted' AND ${PHONE_SESSION} RETURNING *`).bind(...base, data.challengeId).first();
  if (!challenge || !await checkHash(env.SITE_SESSION_SECRET, `phone-code:${challenge.id}`, data.code, challenge.proof_hash)) return phoneFailed();
  const token = opaque(), tokenHash = await hash(env.SITE_SESSION_SECRET, 'phone-registration', token), operation = crypto.randomUUID();
  await env.GAME_DB.batch([
    env.GAME_DB.prepare(`UPDATE site_phone_challenges SET consumed_at=?4,consumption_id=?5 WHERE id=?6 AND member_id IS ?1
      AND session_id=?2 AND csrf_hash=?3 AND consumed_at IS NULL AND expires_at>?4 AND attempts<=5
      AND delivery_state='accepted' AND ${PHONE_SESSION}`).bind(...phoneBase(access), operation, challenge.id),
    env.GAME_DB.prepare(`INSERT INTO site_phone_proofs(token_hash,phone_e164,purpose,member_id,session_id,csrf_hash,expires_at,created_at)
      SELECT ?5,phone_e164,purpose,member_id,session_id,csrf_hash,?6,?7 FROM site_phone_challenges
      WHERE id=?8 AND consumption_id=?9 AND ${PHONE_SESSION}`).bind(...phoneBase(access), tokenHash, nowSeconds() + 600, stamp(), challenge.id, operation),
  ]);
  const proof = await env.GAME_DB.prepare('SELECT purpose,phone_e164 FROM site_phone_proofs WHERE token_hash=?1').bind(tokenHash).first();
  if (!proof) return phoneFailed();
  if (proof.purpose === 'signin') {
    const member = await findSiteIdentityMember(env.GAME_DB, 'phone', proof.phone_e164);
    if (member) return member.status === 'active' ? phoneLogin(env, access, tokenHash, member)
      : fail(403, '이용할 수 없는 계정입니다.', 'member_unavailable');
  }
  return siteJson({ registrationToken: token, expiresIn: 600 });
}

async function phoneSignup(request, env, access) {
  const denied = guestOnly(access); if (denied) return denied;
  const data = await readBody(request, phoneProofSchema.extend({ name: profileShape.name, ...consentShape }));
  if (data instanceof Response) return data;
  const limited = await enforceRate(env, [[`signup:${ip(request)}`, 20, 3600]]); if (limited) return limited;
  const tokenHash = await hash(env.SITE_SESSION_SECRET, 'phone-registration', data.registrationToken), base = phoneBase(access);
  const proof = await env.GAME_DB.prepare(`SELECT phone_e164 FROM site_phone_proofs WHERE token_hash=?5 AND purpose='signin'
    AND member_id IS NULL AND session_id=?2 AND csrf_hash=?3 AND consumed_at IS NULL AND expires_at>?4 AND ${PHONE_SESSION}`)
    .bind(...base, tokenHash).first();
  if (!proof) return phoneExpired();
  const id = crypto.randomUUID(), session = await newSession(env, id), at = stamp(), code = `H${opaque().slice(0, 10).toUpperCase().replace(/[-_]/g, 'X')}`;
  await env.GAME_DB.batch([
    env.GAME_DB.prepare(`INSERT INTO site_members(id,status,name,phone,member_code,customer_key,provider,provider_subject,
      registration_token_hash,terms_accepted_at,privacy_accepted_at,marketing_accepted,created_at,updated_at)
      SELECT ?5,'active',?6,?7,?8,?9,'phone',phone_e164,token_hash,?10,?10,?11,?10,?10 FROM site_phone_proofs
      WHERE token_hash=?12 AND purpose='signin' AND member_id IS NULL AND session_id=?2 AND csrf_hash=?3
        AND consumed_at IS NULL AND expires_at>?4 AND ${PHONE_SESSION}
        AND NOT EXISTS(SELECT 1 FROM site_member_identities WHERE provider='phone' AND provider_subject=site_phone_proofs.phone_e164)
      ON CONFLICT DO NOTHING`).bind(...base, id, data.name, domesticSitePhone(proof.phone_e164), code, crypto.randomUUID(), at, data.marketingAccepted ? 1 : 0, tokenHash),
    env.GAME_DB.prepare(`INSERT INTO site_member_identities(provider,provider_subject,member_id,created_at)
      SELECT 'phone',provider_subject,id,created_at FROM site_members WHERE id=?1 AND provider='phone' AND registration_token_hash=?2 ON CONFLICT DO NOTHING`).bind(id, tokenHash),
    env.GAME_DB.prepare(`UPDATE site_phone_proofs SET consumed_at=?1 WHERE token_hash=?2 AND EXISTS(SELECT 1 FROM site_member_identities WHERE member_id=?3 AND provider='phone')`).bind(nowSeconds(), tokenHash, id),
    env.GAME_DB.prepare(`INSERT INTO site_sessions(id,token_hash,csrf_hash,member_id,expires_at,created_at)
      SELECT ?1,?2,?3,id,?4,?5 FROM site_members WHERE id=?6 AND EXISTS(SELECT 1 FROM site_member_identities WHERE member_id=?6 AND provider='phone')`)
      .bind(session.id, session.tokenHash, session.csrfHash, session.expires, session.created, id),
    env.GAME_DB.prepare(`UPDATE site_sessions SET revoked_at=?1 WHERE id=?2 AND EXISTS(SELECT 1 FROM site_sessions WHERE id=?3)`).bind(nowSeconds(), access.session.id, session.id),
  ]);
  const row = await env.GAME_DB.prepare(`SELECT m.* FROM site_sessions s JOIN site_members m ON m.id=s.member_id
    WHERE s.id=?1 AND s.revoked_at IS NULL AND s.expires_at>?2 AND m.status='active'`).bind(session.id, nowSeconds()).first();
  if (row) return siteJson({ member: memberDto(row), csrfToken: session.csrf }, { status: 201, headers: { 'Set-Cookie': session.cookie } });
  return await memberRow(env.GAME_DB, id) ? fail(401, '인증이 만료되었습니다. 다시 로그인해주세요.', 'session_expired')
    : fail(409, '이미 가입했거나 사용한 인증입니다. 다시 로그인해주세요.', 'signup_conflict');
}

async function phoneLink(request, env, access) {
  const member = await authorizeSiteMember(request, env, { requireCsrf: true }); if (member instanceof Response) return member;
  const data = await readBody(request, phoneProofSchema); if (data instanceof Response) return data;
  const tokenHash = await hash(env.SITE_SESSION_SECRET, 'phone-registration', data.registrationToken), base = phoneBase(access), operation = crypto.randomUUID();
  const proof = await env.GAME_DB.prepare(`SELECT phone_e164 FROM site_phone_proofs WHERE token_hash=?5 AND purpose='link'
    AND member_id=?1 AND session_id=?2 AND csrf_hash=?3 AND consumed_at IS NULL AND expires_at>?4 AND ${PHONE_SESSION}`).bind(...base, tokenHash).first();
  if (!proof) return phoneExpired();
  await env.GAME_DB.batch([
    env.GAME_DB.prepare(`UPDATE site_phone_proofs SET consumed_at=?4,consumption_id=?5 WHERE token_hash=?6 AND purpose='link'
      AND member_id=?1 AND session_id=?2 AND csrf_hash=?3 AND consumed_at IS NULL AND expires_at>?4 AND ${PHONE_SESSION}
      AND NOT EXISTS(SELECT 1 FROM site_member_identities WHERE provider='phone' AND (member_id=?1 OR provider_subject=site_phone_proofs.phone_e164))`)
      .bind(...base, operation, tokenHash),
    env.GAME_DB.prepare(`INSERT INTO site_member_identities(provider,provider_subject,member_id,created_at)
      SELECT 'phone',phone_e164,?1,?5 FROM site_phone_proofs WHERE token_hash=?6 AND consumption_id=?7 AND ${PHONE_SESSION} ON CONFLICT DO NOTHING`)
      .bind(...base, stamp(), tokenHash, operation),
    env.GAME_DB.prepare(`UPDATE site_members SET phone=?5,updated_at=?6 WHERE id=?1 AND ${PHONE_SESSION}
      AND EXISTS(SELECT 1 FROM site_phone_proofs p JOIN site_member_identities i ON i.provider_subject=p.phone_e164 AND i.provider='phone'
        WHERE p.token_hash=?7 AND p.consumption_id=?8 AND i.member_id=?1)`)
      .bind(...base, domesticSitePhone(proof.phone_e164), stamp(), tokenHash, operation),
  ]);
  const linked = await env.GAME_DB.prepare(`SELECT 1 ok FROM site_phone_proofs p JOIN site_member_identities i ON i.provider_subject=p.phone_e164 AND i.provider='phone'
    WHERE p.token_hash=?5 AND p.consumption_id=?6 AND i.member_id=?1 AND ${PHONE_SESSION}`).bind(...phoneBase(access), tokenHash, operation).first();
  if (linked) return siteJson({ ok: true });
  await assertLiveIdentitySession(env.GAME_DB, member);
  return fail(409, '이미 다른 계정에 연결되었거나 사용한 인증입니다. 다시 확인해주세요.', 'identity_conflict');
}

const POST_PATHS = new Set(['/auth/email/request', '/auth/email/verify', '/auth/signup', '/auth/login', '/auth/logout',
  '/auth/password/request-reset', '/auth/password/reset', '/auth/profile-complete']);

export async function cleanupSiteAuthState(env) {
  if (!ready(env)) return { cleaned: 0, unavailable: true };
  const db = env.GAME_DB, now = nowSeconds();
  try {
    const phoneSchema = await db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='site_phone_proofs'").first();
    const phoneCleanup = phoneSchema ? [
      db.prepare('DELETE FROM site_phone_proofs WHERE expires_at<=?1').bind(now),
      db.prepare('DELETE FROM site_phone_challenges WHERE expires_at<=?1').bind(now),
      db.prepare('DELETE FROM site_phone_send_cooldowns WHERE expires_at<=?1').bind(now),
      db.prepare('DELETE FROM site_phone_daily_usage WHERE day<?1').bind(phoneQuotaDay(now - 7 * 86400)),
    ] : [];
    const results = await db.batch([
      ...phoneCleanup,
      db.prepare(`DELETE FROM site_email_challenges WHERE expires_at<=?1 AND NOT EXISTS(
        SELECT 1 FROM site_member_link_intents l JOIN site_registration_tokens t ON t.token_hash=l.registration_token_hash
        WHERE l.email_challenge_id=site_email_challenges.id AND l.consumed_at IS NULL AND l.expires_at>?1
          AND t.consumed_at IS NULL AND t.expires_at>?1)`).bind(now),
      db.prepare('DELETE FROM site_registration_tokens WHERE expires_at<=?1').bind(now),
      db.prepare('DELETE FROM site_password_resets WHERE expires_at<=?1').bind(now),
      db.prepare('DELETE FROM site_oauth_states WHERE expires_at<=?1').bind(now),
      // Live challenges still reference the browser session. Retain that parent until their expiry.
      db.prepare(`DELETE FROM site_sessions WHERE (expires_at<=?1 OR revoked_at IS NOT NULL)
        AND NOT EXISTS(SELECT 1 FROM site_email_challenges WHERE session_id=site_sessions.id)
        AND NOT EXISTS(SELECT 1 FROM site_registration_tokens WHERE session_id=site_sessions.id)
        AND NOT EXISTS(SELECT 1 FROM site_oauth_states WHERE session_id=site_sessions.id)
        ${phoneSchema ? `AND NOT EXISTS(SELECT 1 FROM site_phone_challenges WHERE session_id=site_sessions.id)
          AND NOT EXISTS(SELECT 1 FROM site_phone_proofs WHERE session_id=site_sessions.id)` : ''}`).bind(now),
      db.prepare('DELETE FROM site_auth_rate_limits WHERE expires_at<=?1').bind(now),
    ]);
    return { cleaned: results.reduce((total, result) => total + Number(result.meta?.changes || 0), 0) };
  } catch {
    // Optional scheduled cleanup must not disrupt an existing cron before the auth migration is applied.
    return { cleaned: 0, unavailable: true };
  }
}

export async function handleSiteAuthRoutes(request, env, { sendPhoneSms } = {}) {
  const fullPath = new URL(request.url).pathname;
  if (!fullPath.startsWith('/api/site/')) return null;
  const path = fullPath.slice('/api/site'.length);
  const social = path.match(/^\/auth\/(google|kakao)\/(start|callback)$/);
  const phone = path.match(/^\/auth\/phone\/(request|verify|signup|link)$/);
  const identity = path.match(/^\/auth\/identities\/(email|google|kakao)\/(request|verify|link)$/);
  const identities = path === '/auth/identities';
  if (!POST_PATHS.has(path) && !['/session', '/me'].includes(path) && !social && !phone && !identity && !identities) return null;
  try {
    const originFailure = checkSiteOrigin(request, env);
    if (originFailure) return originFailure;
    if (!ready(env)) return unavailable();
    const allowed = path === '/me' ? ['GET', 'PUT'] : social || identities || path === '/session' ? ['GET'] : ['POST'];
    if (!allowed.includes(request.method)) return siteJson({ error: '지원하지 않는 요청 방식입니다.' }, { status: 405, headers: { Allow: allowed.join(', ') } });
    if (path === '/session') return await sessionRoute(request, env);
    if (identities) return await identityList(request, env);
    if (identity) {
      const access = await authorizeSiteMember(request, env, { requireCsrf: true });
      if (access instanceof Response) return access;
      if (identity[1] === 'email') {
        if (identity[2] === 'request') return await requestEmail(request, env, access, true);
        if (identity[2] === 'verify') return await verifyEmail(request, env, access, true);
        return await emailIdentityLink(request, env, access);
      }
      return identity[2] === 'link' ? await socialIdentityLinkStart(request, env, identity[1], access) : fail(404, '지원하지 않는 연결 요청입니다.');
    }
    if (social) return await (social[2] === 'start' ? oauthStart(request, env, social[1]) : oauthCallback(request, env, social[1]));
    if (path === '/me') return await meRoute(request, env);
    const access = await sessionAccess(request, env, true);
    if (access instanceof Response) return access;
    if (phone) {
      if (!sitePhoneReady(env)) return fail(503, '휴대폰 인증을 준비 중입니다.', 'phone_not_configured');
      if (phone[1] === 'request') return await phoneRequest(request, env, access, sendPhoneSms);
      if (phone[1] === 'verify') return await phoneVerify(request, env, access);
      if (phone[1] === 'signup') return await phoneSignup(request, env, access);
      return await phoneLink(request, env, access);
    }
    if (path === '/auth/email/request') return await requestEmail(request, env, access);
    if (path === '/auth/email/verify') return await verifyEmail(request, env, access);
    if (path === '/auth/signup') return await signup(request, env, access);
    if (path === '/auth/login') return await login(request, env, access);
    if (path === '/auth/password/request-reset') return await requestReset(request, env);
    if (path === '/auth/password/reset') return await resetPassword(request, env);
    if (path === '/auth/profile-complete') return await profileComplete(request, env);
    await env.GAME_DB.prepare('UPDATE site_sessions SET revoked_at=?1 WHERE id=?2').bind(nowSeconds(), access.session.id).run();
    return siteJson({ ok: true }, { headers: { 'Set-Cookie': cookieHeader(env, '', 0) } });
  } catch (error) {
    if (error instanceof SiteIdentityError) return fail(error.status, error.message, error.code);
    // Avoid provider messages, SQL, member identifiers, session cookies and reset query strings in logs.
    return unavailable();
  }
}
