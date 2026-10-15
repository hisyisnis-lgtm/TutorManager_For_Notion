import { base64url } from './auth.js';
import { siteJson } from './siteAuth.js';
import { normalizeSitePhone, domesticSitePhone, sitePhoneReady, sitePhoneDailyLimit, phoneQuotaDay, phoneQuotaRetryAfter } from './sitePhoneAuth.js';

const encoder = new TextEncoder();
const now = () => Math.floor(Date.now() / 1000);
const failed = () => siteJson({ error: '인증번호가 틀렸거나 만료되었습니다. 다시 요청해주세요.', code: 'admin_phone_verification_failed' }, { status: 400 });
const unavailable = () => siteJson({ error: '휴대폰 로그인을 준비 중입니다. 비밀번호로 로그인해주세요.', code: 'admin_phone_unavailable' }, { status: 503 });
const rate = seconds => siteJson({ error: '잠시 후 다시 인증번호를 요청해주세요.', code: 'admin_phone_rate_limited' },
  { status: 429, headers: { 'Retry-After': String(Math.max(1, seconds)) } });

export function siteAdminPhoneAllowlist(env) {
  try {
    if (typeof env.SITE_ADMIN_PHONE_ALLOWLIST !== 'string' || env.SITE_ADMIN_PHONE_ALLOWLIST.length > 8192) return null;
    const values = JSON.parse(env.SITE_ADMIN_PHONE_ALLOWLIST);
    if (!Array.isArray(values) || values.length < 1 || values.length > 20) return null;
    const entries = values.map(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'phone') || !Object.hasOwn(value, 'name')) throw new Error('Invalid staff configuration');
      const phone = normalizeSitePhone(value.phone);
      if (!phone || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80 || /[\u0000-\u001f\u007f]/.test(value.name)) throw new Error('Invalid staff configuration');
      return { phone, name: value.name.trim() };
    }).sort((a, b) => a.phone.localeCompare(b.phone));
    return new Set(entries.map(entry => entry.phone)).size === entries.length ? entries : null;
  } catch { return null; }
}
export const siteAdminPhoneReady = env => !!siteAdminPhoneAllowlist(env) && sitePhoneReady(env);

// This derivation intentionally matches siteAuth's phone-number/rate domains so
// member and staff requests share the same phone cooldown and cost limits.
async function memberHash(env, domain, value) {
  const root = await crypto.subtle.importKey('raw', encoder.encode(env.SITE_SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const derived = await crypto.subtle.sign('HMAC', root, encoder.encode(`site-members/v1/${domain}`));
  const key = await crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}
async function limits(request, env, access, phone) {
  const keys = phone ? [[`phone-send-ip:${request.headers.get('CF-Connecting-IP') || 'unknown'}`, 20, 3600],
    [`phone-send:${phone}`, 5, 3600], [`phone-send-session:${access.row.id}`, 5, 3600]]
    : [[`phone-verify:${request.headers.get('CF-Connecting-IP') || 'unknown'}`, 60, 300]];
  for (const [label, limit, ttl] of keys) {
    const key = await memberHash(env, 'rate', label), current = now();
    const saved = await env.GAME_DB.prepare(`INSERT INTO site_auth_rate_limits(key_hash,count,expires_at) VALUES(?1,1,?2)
      ON CONFLICT(key_hash) DO UPDATE SET count=CASE WHEN expires_at<=?3 THEN 1 ELSE count+1 END,
      expires_at=CASE WHEN expires_at<=?3 THEN ?2 ELSE expires_at END WHERE expires_at<=?3 OR count<?4 RETURNING count`)
      .bind(key, current + ttl, current, limit).first();
    if (!saved) {
      const bucket = await env.GAME_DB.prepare('SELECT expires_at FROM site_auth_rate_limits WHERE key_hash=?1').bind(key).first();
      return rate(Math.max(1, (bucket?.expires_at || current + 1) - current));
    }
  }
  return null;
}
const LIVE = `EXISTS(SELECT 1 FROM site_admin_sessions s WHERE s.id=?1 AND s.token_hash=?2 AND s.csrf_hash=?3
  AND s.credential_fingerprint=?4 AND s.role IS NULL AND s.revoked_at IS NULL AND s.expires_at>?5)`;
const base = (access, credential) => [access.row.id, access.row.token_hash, access.row.csrf_hash, credential, now()];
async function retryAfter(env, phoneHash, current) {
  const value = await env.GAME_DB.prepare(`SELECT
    COALESCE((SELECT expires_at FROM site_phone_send_cooldowns WHERE phone_hash=?1),0) AS cooldown,
    COALESCE((SELECT sends FROM site_phone_daily_usage WHERE day=?2),0) AS sends`).bind(phoneHash, phoneQuotaDay(current)).first();
  return Math.max(0, value.cooldown - current, value.sends >= sitePhoneDailyLimit(env) ? phoneQuotaRetryAfter(current) : 0);
}
function randomCode() {
  let value;
  do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= 4_294_000_000);
  return String(value % 1_000_000).padStart(6, '0');
}
export async function handleSiteAdminPhoneAuth(request, env, access, action, hooks) {
  const entries = siteAdminPhoneAllowlist(env);
  if (!siteAdminPhoneReady(env) || typeof hooks.sendPhoneSms !== 'function') return unavailable();
  if (access.row.role !== null) return siteJson({ error: '이미 관리자 로그인이 되어 있습니다.', code: 'admin_already_authenticated' }, { status: 409 });
  const input = await hooks.readBody(request);
  if (!input || Object.keys(input).length !== (action === 'request' ? 1 : 2)) return siteJson({ error: '입력값을 확인해주세요.', code: 'admin_invalid_input' }, { status: 400 });
  if (action === 'request') {
    const phone = normalizeSitePhone(input.phone);
    if (!phone || Object.keys(input)[0] !== 'phone') return siteJson({ error: '휴대폰 번호를 확인해주세요.', code: 'admin_invalid_input' }, { status: 400 });
    const phoneHash = await memberHash(env, 'phone-number', phone);
    const denied = await limits(request, env, access, phone);
    if (denied) return rate(Math.max(Number(denied.headers.get('Retry-After')) || 1, await retryAfter(env, phoneHash, now())));
    const principal = await hooks.hash('phone-principal', phone);
    const credential = await hooks.fingerprint(), current = now(), id = crypto.randomUUID(), code = randomCode();
    const proof = await hooks.hash(`phone-code:${id}`, code), eligible = entries.some(entry => entry.phone === phone);
    // Non-staff receive the same challenge shape and cooldown, without an SMS or
    // spend. A decoy challenge can never be promoted because verification checks
    // the current secret allowlist again, independently of the supplied code.
    await env.GAME_DB.batch([
      env.GAME_DB.prepare(`INSERT INTO site_admin_phone_challenges(id,principal_hash,phone_hash,session_id,csrf_hash,credential_fingerprint,proof_hash,expires_at,created_at)
        SELECT ?6,?7,?8,?1,?3,?4,?9,?10,?5 WHERE ${LIVE}
        AND NOT EXISTS(SELECT 1 FROM site_phone_send_cooldowns WHERE phone_hash=?8 AND expires_at>?5)
        AND COALESCE((SELECT sends FROM site_phone_daily_usage WHERE day=?11),0)<?12`)
        .bind(...base(access, credential), id, principal, phoneHash, proof, current + 300, phoneQuotaDay(current), sitePhoneDailyLimit(env)),
      env.GAME_DB.prepare(`INSERT INTO site_phone_daily_usage(day,sends) SELECT ?2,1 FROM site_admin_phone_challenges WHERE id=?1 AND ?3=1
        ON CONFLICT(day) DO UPDATE SET sends=sends+1`).bind(id, phoneQuotaDay(current), eligible ? 1 : 0),
      env.GAME_DB.prepare(`INSERT INTO site_phone_send_cooldowns(phone_hash,expires_at) SELECT phone_hash,?2 FROM site_admin_phone_challenges WHERE id=?1
        ON CONFLICT(phone_hash) DO UPDATE SET expires_at=excluded.expires_at`).bind(id, current + 60),
      env.GAME_DB.prepare(`UPDATE site_admin_phone_challenges SET consumed_at=?3,delivery_state='superseded'
        WHERE phone_hash=?2 AND id!=?1 AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM site_admin_phone_challenges WHERE id=?1)`)
        .bind(id, phoneHash, current),
    ]);
    if (!await env.GAME_DB.prepare('SELECT id FROM site_admin_phone_challenges WHERE id=?1').bind(id).first()) {
      const retry = await retryAfter(env, phoneHash, now());
      return retry > 0 ? rate(retry) : failed();
    }
    if (credential !== await hooks.fingerprint()) return failed();
    let delivery = { ok: true, state: 'accepted' };
    if (eligible) {
      try { delivery = await hooks.sendPhoneSms(domesticSitePhone(phone), `[하늘하늘중국어] 관리자 로그인 인증번호 [${code}] (5분 내 입력)`); }
      catch { delivery = { ok: false, state: 'unknown' }; }
    }
    if (!delivery?.ok || delivery.state !== 'accepted') {
      await env.GAME_DB.prepare("UPDATE site_admin_phone_challenges SET delivery_state=?1,consumed_at=?2 WHERE id=?3 AND delivery_state='pending'")
        .bind(delivery?.state === 'failed' ? 'failed' : 'unknown', now(), id).run();
      return siteJson({ error: '인증번호를 보내지 못했어요. 잠시 후 다시 요청해주세요.', code: 'admin_phone_delivery_failed' }, { status: 503 });
    }
    const accepted = await env.GAME_DB.prepare(`UPDATE site_admin_phone_challenges SET delivery_state='accepted'
      WHERE id=?6 AND delivery_state='pending' AND consumed_at IS NULL AND expires_at>?5 AND credential_fingerprint=?4 AND ${LIVE} RETURNING id`)
      .bind(...base(access, await hooks.fingerprint()), id).first();
    return accepted ? siteJson({ challengeId: id, expiresIn: 300, resendAfter: 60 }) : failed();
  }
  if (!Object.hasOwn(input, 'challengeId') || !Object.hasOwn(input, 'code') || typeof input.challengeId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.challengeId)
    || typeof input.code !== 'string' || !/^\d{6}$/.test(input.code)) return failed();
  const denied = await limits(request, env, access); if (denied) return denied;
  const credential = await hooks.fingerprint();
  const challenge = await env.GAME_DB.prepare(`UPDATE site_admin_phone_challenges SET attempts=attempts+1
    WHERE id=?6 AND session_id=?1 AND csrf_hash=?3 AND credential_fingerprint=?4 AND consumed_at IS NULL AND expires_at>?5
      AND attempts<5 AND delivery_state='accepted' AND ${LIVE} RETURNING *`)
    .bind(...base(access, credential), input.challengeId).first();
  if (!challenge || !await hooks.matchesHash(`phone-code:${challenge.id}`, input.code, challenge.proof_hash)) return failed();
  const principals = await Promise.all(siteAdminPhoneAllowlist(env)?.map(entry => hooks.hash('phone-principal', entry.phone)) || []);
  if (!principals.includes(challenge.principal_hash) || credential !== await hooks.fingerprint()) return failed();
  const next = await hooks.newSession('teacher'), operation = crypto.randomUUID();
  await env.GAME_DB.batch([
    env.GAME_DB.prepare(`UPDATE site_admin_phone_challenges SET consumed_at=?5,consumption_id=?7
      WHERE id=?6 AND session_id=?1 AND csrf_hash=?3 AND credential_fingerprint=?4 AND consumed_at IS NULL AND expires_at>?5
        AND attempts<=5 AND delivery_state='accepted' AND ${LIVE}`)
      .bind(...base(access, next.credential), challenge.id, operation),
    env.GAME_DB.prepare(`INSERT INTO site_admin_sessions(id,token_hash,csrf_hash,credential_fingerprint,role,expires_at,created_at)
      SELECT ?8,?9,?10,?4,'teacher',?11,?12 FROM site_admin_phone_challenges WHERE id=?6 AND consumption_id=?7 AND ${LIVE}`)
      .bind(...base(access, next.credential), challenge.id, operation, next.id, next.tokenHash, next.csrfHash, next.expires, next.created),
    env.GAME_DB.prepare(`INSERT INTO site_admin_phone_sessions(session_id,principal_hash,auth_method)
      SELECT ?1,?2,'phone' FROM site_admin_sessions WHERE id=?1`).bind(next.id, challenge.principal_hash),
    env.GAME_DB.prepare(`UPDATE site_admin_sessions SET revoked_at=?1 WHERE id=?2 AND revoked_at IS NULL
      AND EXISTS(SELECT 1 FROM site_admin_sessions WHERE id=?3)`).bind(now(), access.row.id, next.id),
  ]);
  const live = await env.GAME_DB.prepare(`SELECT id FROM site_admin_sessions WHERE id=?1 AND credential_fingerprint=?2
    AND revoked_at IS NULL AND expires_at>?3`).bind(next.id, await hooks.fingerprint(), now()).first();
  return live ? hooks.freshResponse(next) : failed();
}
