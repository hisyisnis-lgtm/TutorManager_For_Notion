// Authentication domains are signed independently even when they share the root secret.
// Legacy tokens without v/purpose/aud/subject are deliberately invalidated.
const encoder = new TextEncoder();
const ISSUER = 'tutor-manager';
const PURPOSES = new Set(['teacher', 'student', 'game', 'oauth-state', 'dashboard', 'homework-upload']);

export function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid encoding');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

async function signingKey(secret, purpose, usage) {
  if (typeof secret !== 'string' || !secret || !PURPOSES.has(purpose)) throw new Error('authentication configuration missing');
  // Prefixing the signed message provides cryptographic domain separation.
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usage);
}

const message = (purpose, payload) => encoder.encode(`tutor-manager/v2/${purpose}\n${payload}`);

function validSubject(purpose, sub, role) {
  if (typeof sub !== 'string' || sub.length < 1 || sub.length > 256) return false;
  if (purpose === 'teacher') return sub === 'teacher' && role === 'teacher';
  if (purpose === 'student') return /^personal:[A-Za-z0-9_-]+$/.test(sub);
  if (purpose === 'game') return !sub.startsWith('personal:');
  if (purpose === 'dashboard') return sub === 'dashboard';
  return true;
}

export async function signTypedToken(secret, purpose, sub, ttlSeconds, extraClaims = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claim = { ...extraClaims, v: 2, iss: ISSUER, aud: `${ISSUER}:${purpose}`, purpose, sub, iat: now, exp: now + ttlSeconds };
  if (!validSubject(purpose, sub, claim.role) || !Number.isSafeInteger(ttlSeconds)) throw new Error('invalid authentication claims');
  const payload = base64url(encoder.encode(JSON.stringify(claim)));
  const key = await signingKey(secret, purpose, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, message(purpose, payload));
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}

export async function verifyTypedToken(secret, token, purpose) {
  if (typeof token !== 'string' || token.length > 8192) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  try {
    const key = await signingKey(secret, purpose, ['verify']);
    if (!(await crypto.subtle.verify('HMAC', key, decode(parts[1]), message(purpose, parts[0])))) return null;
    const claim = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    const now = Math.floor(Date.now() / 1000);
    if (claim.v !== 2 || claim.iss !== ISSUER || claim.aud !== `${ISSUER}:${purpose}` || claim.purpose !== purpose
      || !Number.isSafeInteger(claim.exp) || claim.exp <= now || !Number.isSafeInteger(claim.iat) || claim.iat > now + 30
      || claim.exp <= claim.iat || !validSubject(purpose, claim.sub, claim.role)) return null;
    return claim;
  } catch { return null; }
}
