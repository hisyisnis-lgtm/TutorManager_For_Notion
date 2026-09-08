import { describe, it, expect } from 'vitest';
import { base64url, signTypedToken, verifyTypedToken } from './auth.js';

const SECRET = 'isolated-test-only-key';
const encoder = new TextEncoder();
async function signUnchecked(claim, purpose, legacy = false) {
  const body = base64url(encoder.encode(JSON.stringify(claim)));
  const key = await crypto.subtle.importKey('raw', encoder.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(legacy ? body : `tutor-manager/v2/${purpose}\n${body}`));
  return `${body}.${base64url(new Uint8Array(sig))}`;
}

describe('authentication domains', () => {
  it('teacher/student/game/state/dashboard only pass their own verifier', async () => {
    const tokens = {
      teacher: await signTypedToken(SECRET, 'teacher', 'teacher', 60, { role: 'teacher' }),
      student: await signTypedToken(SECRET, 'student', 'personal:student-a', 60),
      game: await signTypedToken(SECRET, 'game', 'game-user', 60),
      'oauth-state': await signTypedToken(SECRET, 'oauth-state', 'transaction', 60),
      dashboard: await signTypedToken(SECRET, 'dashboard', 'dashboard', 60),
    };
    for (const [issuedFor, token] of Object.entries(tokens)) {
      for (const verifier of Object.keys(tokens)) {
        expect(!!(await verifyTypedToken(SECRET, token, verifier)), `${issuedFor} -> ${verifier}`).toBe(issuedFor === verifier);
      }
    }
  });

  it('legacy tokens, wrong roles, missing purpose/aud/sub, expired tokens fail closed', async () => {
    const now = Math.floor(Date.now() / 1000);
    const valid = { v: 2, iss: 'tutor-manager', aud: 'tutor-manager:teacher', purpose: 'teacher', sub: 'teacher', role: 'teacher', iat: now, exp: now + 60 };
    const invalid = [
      { ...valid, role: 'student' }, { ...valid, purpose: undefined }, { ...valid, aud: undefined },
      { ...valid, sub: undefined }, { ...valid, sub: 'student-a' }, { ...valid, exp: now - 1 },
      { ...valid, exp: '9999999999' }, { ...valid, iat: now + 600 },
    ];
    for (const claim of invalid) expect(await verifyTypedToken(SECRET, await signUnchecked(claim, 'teacher'), 'teacher')).toBeNull();
    expect(await verifyTypedToken(SECRET, await signUnchecked({ exp: now + 600 }, 'teacher', true), 'teacher')).toBeNull();
    expect(await verifyTypedToken(undefined, await signTypedToken(SECRET, 'teacher', 'teacher', 60, { role: 'teacher' }), 'teacher')).toBeNull();
  });

  it('changing a state purpose to teacher cannot cross the signature domain', async () => {
    const now = Math.floor(Date.now() / 1000);
    const forged = await signUnchecked({ v: 2, iss: 'tutor-manager', aud: 'tutor-manager:teacher', purpose: 'teacher', sub: 'teacher', role: 'teacher', iat: now, exp: now + 60 }, 'oauth-state');
    expect(await verifyTypedToken(SECRET, forged, 'teacher')).toBeNull();
  });
});
