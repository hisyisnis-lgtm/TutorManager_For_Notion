// D1 executes each conditional write atomically across data centers. No Cache API
// fallback: a missing binding, migration, or storage failure must deny access.
const encoder = new TextEncoder();

export class SecurityStoreUnavailable extends Error {
  constructor() { super('Security storage unavailable'); this.name = 'SecurityStoreUnavailable'; }
}

async function hashKey(env, value) {
  if (!env.GAME_DB || !env.JWT_SECRET) throw new SecurityStoreUnavailable();
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(`security-store/v1/${value}`));
  return Array.from(new Uint8Array(signed), b => b.toString(16).padStart(2, '0')).join('');
}

export async function rateLimitCheck(env, key, limit, windowSec) {
  try {
    const hash = await hashKey(env, `rate:${key}`);
    const now = Math.floor(Date.now() / 1000);
    const row = await env.GAME_DB.prepare(`
      INSERT INTO security_rate_limits (key_hash, count, expires_at) VALUES (?1, 1, ?2)
      ON CONFLICT(key_hash) DO UPDATE SET
        count = CASE WHEN expires_at <= ?3 THEN 1 ELSE count + 1 END,
        expires_at = CASE WHEN expires_at <= ?3 THEN ?2 ELSE expires_at END
      WHERE expires_at <= ?3 OR count < ?4
      RETURNING count
    `).bind(hash, now + windowSec, now, limit).first();
    return row != null;
  } catch {
    // Never log key (which may contain a phone number or student reservation code).
    console.error('[security-store] rate limit unavailable');
    return false;
  }
}

export async function putChallenge(env, namespace, key, proof, payload, ttlSeconds) {
  try {
    const keyHash = await hashKey(env, `challenge:${namespace}:${key}`);
    const proofHash = await hashKey(env, `proof:${namespace}:${key}:${proof}`);
    await env.GAME_DB.prepare(`
      INSERT INTO security_challenges (key_hash, proof_hash, payload, expires_at) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(key_hash) DO UPDATE SET proof_hash=excluded.proof_hash, payload=excluded.payload, expires_at=excluded.expires_at
    `).bind(keyHash, proofHash, JSON.stringify(payload), Math.floor(Date.now() / 1000) + ttlSeconds).run();
  } catch { throw new SecurityStoreUnavailable(); }
}

export async function consumeChallenge(env, namespace, key, proof) {
  try {
    const keyHash = await hashKey(env, `challenge:${namespace}:${key}`);
    const proofHash = await hashKey(env, `proof:${namespace}:${key}:${proof}`);
    const row = await env.GAME_DB.prepare(`
      DELETE FROM security_challenges WHERE key_hash=?1 AND proof_hash=?2 AND expires_at>?3 RETURNING payload
    `).bind(keyHash, proofHash, Math.floor(Date.now() / 1000)).first();
    return row ? JSON.parse(row.payload) : null;
  } catch { throw new SecurityStoreUnavailable(); }
}

export async function cleanupSecurityState(env) {
  if (!env.GAME_DB) throw new SecurityStoreUnavailable();
  const now = Math.floor(Date.now() / 1000);
  await env.GAME_DB.batch([
    env.GAME_DB.prepare('DELETE FROM security_rate_limits WHERE expires_at <= ?1').bind(now),
    env.GAME_DB.prepare('DELETE FROM security_challenges WHERE expires_at <= ?1').bind(now),
  ]);
}
