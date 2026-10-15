import { base64url } from './auth.js';
import { siteJson, siteOrigin } from './siteAuth.js';
import { rateLimitCheck } from './securityStore.js';

const encoder = new TextEncoder();
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const AUTH_TTL = 8 * 60 * 60;
const ANON_TTL = 15 * 60;
const MAX_BODY = 4096;
const seconds = () => Math.floor(Date.now() / 1000);
const opaque = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
const fail = (status, error, code) => siteJson({ error, code }, { status });
const unavailable = () => fail(503, '관리자 서비스를 잠시 사용할 수 없습니다. 다시 시도해주세요.', 'admin_unavailable');
const expired = () => fail(401, '관리자 세션이 만료되었습니다. 다시 로그인해주세요.', 'admin_session_expired');
const loginRequired = () => fail(401, '관리자 로그인이 필요합니다.', 'admin_login_required');
const csrfDenied = () => fail(403, '요청을 확인할 수 없습니다. 관리자 화면을 새로고침해주세요.', 'admin_csrf_denied');

export function siteAdminReady(env) {
  try {
    siteOrigin(env);
    return env.SITE_ADMIN_ENABLED === 'true' && !!env.GAME_DB
      && typeof env.AUTH_PASSWORD === 'string' && env.AUTH_PASSWORD.length > 0
      && typeof env.JWT_SECRET === 'string' && env.JWT_SECRET.length > 0
      && typeof env.SITE_SESSION_SECRET === 'string' && env.SITE_SESSION_SECRET.length >= 32;
  } catch { return false; }
}
function cookieSettings(env) {
  const origin = new URL(siteOrigin(env));
  const development = env.SITE_ENVIRONMENT === 'development' && origin.protocol === 'http:'
    && ['localhost','127.0.0.1','[::1]'].includes(origin.hostname);
  return { name: development ? 'hanul_site_admin_dev' : '__Host-hanul_site_admin', secure: !development };
}
function cookie(env, token, ttl) {
  const { name, secure } = cookieSettings(env);
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ttl}${secure ? '; Secure' : ''}`;
}
function cookieToken(request, env) {
  const { name } = cookieSettings(env);
  const values = (request.headers.get('Cookie') || '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const token = values[0].slice(name.length + 1);
  return TOKEN.test(token) ? token : null;
}
function sourceDenied(request, env) {
  if (request.headers.get('Origin') !== siteOrigin(env)) return fail(403, '관리자 사이트에서 다시 요청해주세요.', 'admin_origin_denied');
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && !['same-origin','none'].includes(site)) return fail(403, '허용되지 않은 관리자 요청입니다.', 'admin_fetch_site_denied');
  return null;
}
async function hmacKey(secret, usage = ['sign']) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usage);
}
async function hash(secret, domain, value) {
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(`site-admin/v1/${domain}/${value}`))));
}
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
async function matchesHash(secret, domain, value, expected) {
  if (!TOKEN.test(expected || '')) return false;
  return crypto.subtle.verify('HMAC', await hmacKey(secret, ['verify']), decode(expected), encoder.encode(`site-admin/v1/${domain}/${value}`));
}
async function fingerprint(env) {
  return hash(env.SITE_SESSION_SECRET, 'credentials', JSON.stringify([env.AUTH_PASSWORD, env.JWT_SECRET]));
}
async function passwordMatches(password, expected) {
  const supplied = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(password)));
  const configured = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(expected)));
  if (typeof crypto.subtle.timingSafeEqual === 'function') return crypto.subtle.timingSafeEqual(supplied, configured);
  const key = await crypto.subtle.importKey('raw', configured, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign','verify']);
  return crypto.subtle.verify('HMAC', key, await crypto.subtle.sign('HMAC', key, configured), supplied);
}
async function session(request, env, requireCsrf = false) {
  const token = cookieToken(request, env);
  if (!token) return null;
  const tokenHash = await hash(env.SITE_SESSION_SECRET, 'session', token), credential = await fingerprint(env);
  const row = await env.GAME_DB.prepare(`SELECT * FROM site_admin_sessions
    WHERE token_hash=?1 AND credential_fingerprint=?2 AND revoked_at IS NULL AND expires_at>?3`)
    .bind(tokenHash, credential, seconds()).first();
  if (!row) return null;
  if (requireCsrf) {
    const csrf = request.headers.get('X-CSRF-Token');
    if (!csrf || !TOKEN.test(csrf) || !await matchesHash(env.SITE_SESSION_SECRET, 'csrf-store', csrf, row.csrf_hash)) return csrfDenied();
    // Recheck after async CSRF verification; revocation must not survive this await.
    const live = await env.GAME_DB.prepare(`SELECT id FROM site_admin_sessions WHERE id=?1 AND token_hash=?2
      AND credential_fingerprint=?3 AND revoked_at IS NULL AND expires_at>?4`).bind(row.id, tokenHash, credential, seconds()).first();
    if (!live) return null;
  }
  return { row, token };
}
async function newSession(env, role = null) {
  const token = opaque(), ttl = role ? AUTH_TTL : ANON_TTL, created = seconds();
  const csrf = await hash(env.SITE_SESSION_SECRET, 'csrf-token', token);
  return { id: crypto.randomUUID(), token, csrf, tokenHash: await hash(env.SITE_SESSION_SECRET, 'session', token),
    csrfHash: await hash(env.SITE_SESSION_SECRET, 'csrf-store', csrf), credential: await fingerprint(env), role, created, expires: created + ttl, ttl };
}
function insert(db, value, previous) {
  const params = [value.id, value.tokenHash, value.csrfHash, value.credential, value.role, value.expires, value.created];
  return previous ? db.prepare(`INSERT INTO site_admin_sessions(id,token_hash,csrf_hash,credential_fingerprint,role,expires_at,created_at)
    SELECT ?1,?2,?3,?4,?5,?6,?7 FROM site_admin_sessions WHERE id=?8 AND token_hash=?9
      AND credential_fingerprint=?4 AND revoked_at IS NULL AND expires_at>?7`)
    .bind(...params, previous.row.id, previous.row.token_hash)
    : db.prepare(`INSERT INTO site_admin_sessions(id,token_hash,csrf_hash,credential_fingerprint,role,expires_at,created_at)
      VALUES(?1,?2,?3,?4,?5,?6,?7)`).bind(...params);
}
async function rotate(env, previous, role) {
  const next = await newSession(env, role);
  await env.GAME_DB.batch([insert(env.GAME_DB, next, previous),
    env.GAME_DB.prepare(`UPDATE site_admin_sessions SET revoked_at=?1 WHERE id=?2 AND revoked_at IS NULL
      AND EXISTS(SELECT 1 FROM site_admin_sessions WHERE id=?3)`).bind(seconds(), previous.row.id, next.id)]);
  return await env.GAME_DB.prepare('SELECT id FROM site_admin_sessions WHERE id=?1').bind(next.id).first() ? next : null;
}
function dto(role, csrf, expires) {
  return { authenticated: role === 'teacher', admin: role === 'teacher' ? { role: 'teacher' } : null,
    csrfToken: csrf, expiresAt: new Date(expires * 1000).toISOString() };
}
function freshResponse(env, value) {
  return siteJson(dto(value.role, value.csrf, value.expires), { headers: { 'Set-Cookie': cookie(env, value.token, value.ttl) } });
}
async function body(request, login) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) return null;
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) return null;
  const reader = request.body?.getReader(); if (!reader) return null;
  let size = 0; const chunks = [];
  try { for (;;) { const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength; if (size > MAX_BODY) { await reader.cancel(); return null; } chunks.push(part.value);
  } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const keys = Object.keys(value);
    return login ? keys.length === 1 && keys[0] === 'password' && typeof value.password === 'string'
      && value.password.length > 0 && value.password.length <= 1024 ? value : null : keys.length === 0 ? value : null;
  } catch { return null; }
}
async function limited(env, label, limit, ttl) {
  if (await rateLimitCheck(env, label, limit, ttl)) return null;
  // rateLimitCheck intentionally fails closed for both exhaustion and storage errors.
  // Re-read its exact existing bucket to report storage failure as 503 instead of 429.
  const signed = await crypto.subtle.sign('HMAC', await hmacKey(env.JWT_SECRET), encoder.encode(`security-store/v1/rate:${label}`));
  const keyHash = Array.from(new Uint8Array(signed), byte => byte.toString(16).padStart(2, '0')).join('');
  const row = await env.GAME_DB.prepare('SELECT count,expires_at FROM security_rate_limits WHERE key_hash=?1').bind(keyHash).first();
  return row && row.expires_at > seconds() && row.count >= limit
    ? fail(429, '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.', 'admin_rate_limited') : unavailable();
}

export async function handleSiteAdminAuthRoutes(request, env) {
  const path = new URL(request.url).pathname;
  const isSession = path === '/api/site/admin/session', isLogin = path === '/api/site/admin/auth/login', isLogout = path === '/api/site/admin/auth/logout';
  if (!isSession && !isLogin && !isLogout) return null;
  if (!siteAdminReady(env)) return unavailable();
  try {
    const denial = sourceDenied(request, env); if (denial) return denial;
    if (isSession && request.method !== 'GET' || !isSession && request.method !== 'POST') return fail(405, '지원하지 않는 요청 방식입니다.', 'admin_method_not_allowed');
    const access = await session(request, env, !isSession);
    if (access instanceof Response) return access;
    if (isSession) {
      if (access) return siteJson(dto(access.row.role, await hash(env.SITE_SESSION_SECRET, 'csrf-token', access.token), access.row.expires_at));
      const throttle = await limited(env, `site-admin-bootstrap:${request.headers.get('CF-Connecting-IP') || '0.0.0.0'}`, 60, 60);
      if (throttle) return throttle;
      const fresh = await newSession(env);
      await env.GAME_DB.prepare(`DELETE FROM site_admin_sessions WHERE id IN
        (SELECT id FROM site_admin_sessions WHERE expires_at<=?1 LIMIT 100)`).bind(seconds()).run();
      await insert(env.GAME_DB, fresh).run();
      return freshResponse(env, fresh);
    }
    if (!access) return expired();
    if (isLogin) {
      const throttle = await limited(env, `login:${request.headers.get('CF-Connecting-IP') || '0.0.0.0'}`, 10, 300)
        || await limited(env, 'login:teacher', 30, 300);
      if (throttle) return throttle;
    }
    const input = await body(request, isLogin);
    if (!input) return fail(400, '입력값을 확인해주세요.', 'admin_invalid_input');
    if (isLogin && !await passwordMatches(input.password, env.AUTH_PASSWORD)) return fail(401, '관리자 비밀번호를 확인해주세요.', 'admin_password_invalid');
    const next = await rotate(env, access, isLogin ? 'teacher' : null);
    return next ? freshResponse(env, next) : expired();
  } catch { return unavailable(); }
}

export async function authorizeSiteAdminRequest(request, env, { authorizeTeacher } = {}) {
  // The existing direct Worker teacher-PWA path keeps its typed Bearer verifier and
  // is not gated by the new website-admin switch, origin policy, or cookie database.
  if (request.headers.has('Authorization')) {
    if (typeof authorizeTeacher !== 'function') return loginRequired();
    try {
      const denial = await authorizeTeacher(request, env, {});
      return denial === null ? null : denial instanceof Response ? denial : loginRequired();
    } catch { return unavailable(); }
  }
  if (!siteAdminReady(env)) return unavailable();
  try {
    if (!new URL(request.url).pathname.startsWith('/api/site/admin/')) return loginRequired();
    const denial = sourceDenied(request, env); if (denial) return denial;
    const access = await session(request, env, !['GET','HEAD'].includes(request.method));
    if (access instanceof Response) return access;
    return access?.row.role === 'teacher' ? null : loginRequired();
  } catch { return unavailable(); }
}
