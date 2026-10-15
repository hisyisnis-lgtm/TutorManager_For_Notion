export class SiteIdentityError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const conflict = () => new SiteIdentityError(409, 'identity_conflict', '이미 다른 계정에 연결된 로그인 방법입니다. 기존 계정으로 로그인해주세요.');
const expired = () => new SiteIdentityError(400, 'link_proof_expired', '연결 인증이 만료되었습니다. 다시 인증해주세요.');
const sessionExpired = () => new SiteIdentityError(401, 'session_expired', '세션이 만료되었습니다. 다시 로그인해주세요.');

// Every linking write rechecks the exact active browser/member snapshot in SQL.
// Parameters 1..4 are member ID, session ID, CSRF hash and current Unix seconds.
export const LIVE_IDENTITY_SESSION = `EXISTS(SELECT 1 FROM site_sessions s JOIN site_members m ON m.id=s.member_id
  WHERE s.member_id=?1 AND s.id=?2 AND s.csrf_hash=?3 AND s.revoked_at IS NULL AND s.expires_at>?4
  AND m.status='active' AND length(trim(m.name))>0
  AND length(trim(COALESCE(m.terms_accepted_at,'')))>0 AND length(trim(COALESCE(m.privacy_accepted_at,'')))>0)`;
const snapshot = (access, now) => [access.member.id, access.session.id, access.session.csrf_hash, now];
export const findSiteIdentityMember = (db, provider, subject) => db.prepare(`SELECT m.* FROM site_member_identities i
  JOIN site_members m ON m.id=i.member_id WHERE i.provider=?1 AND i.provider_subject=?2`).bind(provider, subject).first();
export const memberSiteIdentities = (db, access) => db.prepare(`SELECT provider,email,created_at,CASE WHEN provider='phone' THEN provider_subject END AS phone_subject FROM site_member_identities
  WHERE member_id=?1 AND ${LIVE_IDENTITY_SESSION} ORDER BY CASE provider WHEN 'email' THEN 0 WHEN 'google' THEN 1 ELSE 2 END`)
  .bind(...snapshot(access, Math.floor(Date.now() / 1000))).all();
export async function assertLiveIdentitySession(db, access, now = Math.floor(Date.now() / 1000)) {
  const live = await db.prepare(`SELECT 1 ok WHERE ${LIVE_IDENTITY_SESSION}`).bind(...snapshot(access, now)).first();
  if (!live) throw sessionExpired();
}

export async function claimSiteSocialIdentity(env, access, { stateHash, provider, subject, email }) {
  const db = env.GAME_DB, now = Math.floor(Date.now() / 1000), at = new Date().toISOString(), operation = crypto.randomUUID();
  const base = snapshot(access, now);
  await db.batch([
    db.prepare(`UPDATE site_member_link_intents SET consumed_at=?4,consumption_id=?5 WHERE oauth_state_hash=?6
      AND provider=?7 AND member_id=?1 AND session_id=?2 AND expires_at>?4 AND consumed_at IS NULL AND ${LIVE_IDENTITY_SESSION}`)
      .bind(...base, operation, stateHash, provider),
    db.prepare(`INSERT INTO site_member_identities(provider,provider_subject,member_id,email,created_at)
      SELECT ?5,?6,?1,?7,?8 FROM site_member_link_intents WHERE oauth_state_hash=?9 AND consumption_id=?10
      AND ${LIVE_IDENTITY_SESSION} ON CONFLICT DO NOTHING`)
      .bind(...base, provider, subject, email || null, at, stateHash, operation),
  ]);
  const owned = await db.prepare(`SELECT i.member_id FROM site_member_identities i WHERE i.provider=?5 AND i.provider_subject=?6 AND i.member_id=?1
    AND EXISTS(SELECT 1 FROM site_member_link_intents WHERE oauth_state_hash=?7 AND consumption_id=?8)
    AND ${LIVE_IDENTITY_SESSION}`).bind(...snapshot(access, Math.floor(Date.now() / 1000)), provider, subject, stateHash, operation).first();
  if (owned) return;
  await assertLiveIdentitySession(db, access);
  const consumed = await db.prepare('SELECT id FROM site_member_link_intents WHERE oauth_state_hash=?1 AND consumption_id=?2').bind(stateHash, operation).first();
  throw consumed ? conflict() : expired();
}

export async function claimSiteEmailIdentity(env, access, { tokenHash, password }) {
  const db = env.GAME_DB, now = Math.floor(Date.now() / 1000), at = new Date().toISOString(), operation = crypto.randomUUID();
  const base = snapshot(access, now);
  await db.batch([
    db.prepare(`UPDATE site_member_link_intents SET consumed_at=?4,consumption_id=?5 WHERE provider='email'
      AND member_id=?1 AND session_id=?2 AND registration_token_hash=?6 AND expires_at>?4 AND consumed_at IS NULL
      AND EXISTS(SELECT 1 FROM site_registration_tokens t WHERE t.token_hash=?6 AND t.session_id=?2 AND t.consumed_at IS NULL AND t.expires_at>?4)
      AND NOT EXISTS(SELECT 1 FROM site_member_identities WHERE member_id=?1 AND provider='email')
      AND NOT EXISTS(SELECT 1 FROM site_member_identities i JOIN site_registration_tokens t ON t.email=i.provider_subject
        WHERE t.token_hash=?6 AND i.provider='email') AND ${LIVE_IDENTITY_SESSION}`)
      .bind(...base, operation, tokenHash),
    db.prepare(`INSERT INTO site_member_identities(provider,provider_subject,member_id,email,created_at)
      SELECT 'email',t.email,?1,t.email,?5 FROM site_registration_tokens t JOIN site_member_link_intents l ON l.registration_token_hash=t.token_hash
      WHERE t.token_hash=?6 AND l.consumption_id=?7 AND ${LIVE_IDENTITY_SESSION} ON CONFLICT DO NOTHING`)
      .bind(...base, at, tokenHash, operation),
    db.prepare(`UPDATE site_members SET password_hash=?5,password_salt=?6,password_iterations=?7,updated_at=?8,
      email=COALESCE(email,(SELECT email FROM site_registration_tokens WHERE token_hash=?9))
      WHERE id=?1 AND ${LIVE_IDENTITY_SESSION} AND EXISTS(SELECT 1 FROM site_member_identities i JOIN site_registration_tokens t ON t.email=i.provider_subject
        JOIN site_member_link_intents l ON l.registration_token_hash=t.token_hash
        WHERE i.provider='email' AND i.member_id=?1 AND t.token_hash=?9 AND l.consumption_id=?10)`)
      .bind(...base, password.hash, password.salt, password.iterations, at, tokenHash, operation),
    db.prepare(`UPDATE site_registration_tokens SET consumed_at=?4 WHERE token_hash=?5 AND EXISTS(SELECT 1 FROM site_member_link_intents
      WHERE registration_token_hash=?5 AND consumption_id=?6) AND ${LIVE_IDENTITY_SESSION}`)
      .bind(...base, tokenHash, operation),
  ]);
  const owned = await db.prepare(`SELECT i.member_id FROM site_member_identities i JOIN site_member_link_intents l ON l.member_id=i.member_id
    JOIN site_registration_tokens t ON t.token_hash=l.registration_token_hash AND t.email=i.provider_subject
    WHERE i.provider='email' AND i.member_id=?1 AND t.token_hash=?5 AND l.consumption_id=?6 AND ${LIVE_IDENTITY_SESSION}`)
    .bind(...snapshot(access, Math.floor(Date.now() / 1000)), tokenHash, operation).first();
  if (owned) return;
  await assertLiveIdentitySession(db, access);
  const occupied = await db.prepare(`SELECT i.member_id FROM site_member_identities i WHERE i.provider='email' AND
    (i.member_id=?1 OR i.provider_subject=(SELECT email FROM site_registration_tokens WHERE token_hash=?2))`).bind(access.member.id, tokenHash).first();
  throw occupied ? conflict() : expired();
}
