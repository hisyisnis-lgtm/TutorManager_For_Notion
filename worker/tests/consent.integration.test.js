import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { signTypedToken } from '../lib/auth.js';
import { sanitizePath } from '../lib/security.js';

// 이전 ConsentPage에서 이동 전에 추출한 원문. 약정 변경이 아닌 접근 경로 변경인지 비교한다.
const original = JSON.parse(readFileSync(new URL('./fixtures/consent-financial-terms.original.json', import.meta.url), 'utf8'));
const secret = 'consent-test-only-secret';
const studentCode = 'ABCDEF123456';
const env = { JWT_SECRET: secret };
const ctx = { waitUntil: promise => promise.catch(() => {}) };
const call = (path, token, options = {}) => worker.fetch(new Request(`https://worker.test${path}`, {
  method: options.method || 'GET', headers: { Origin: options.origin || 'http://localhost:5173', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
}), options.env || env, ctx);

beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('외부 호출 금지'); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe('동의서 원문의 인증 경계', () => {
  it('본인 학생 세션과 강사 JWT만 원문을 받으며 캐시하지 않는다', async () => {
    const student = await signTypedToken(secret, 'student', `personal:${studentCode}`, 600);
    const teacher = await signTypedToken(secret, 'teacher', 'teacher', 600, { role: 'teacher' });
    for (const [path, token] of [[`/booking/consent/${studentCode}`, student], [`/booking/consent/${studentCode}`, teacher], ['/booking/consent', teacher]]) {
      const response = await call(path, token);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await response.json()).toEqual(original);
    }
  });

  it('미인증·다른 학생·게임·만료·잘못된 서명에는 원문을 노출하지 않는다', async () => {
    const tokens = [undefined,
      await signTypedToken(secret, 'student', 'personal:OTHER1234567', 600),
      await signTypedToken(secret, 'game', 'game-user', 600),
      await signTypedToken(secret, 'student', `personal:${studentCode}`, -60),
      await signTypedToken('wrong-secret', 'student', `personal:${studentCode}`, 600),
    ];
    for (const token of tokens) {
      const response = await call(`/booking/consent/${studentCode}`, token);
      expect(response.status).toBe(401);
      expect(await response.text()).not.toMatch(/50,000|할인|환불|forms\.gle/);
    }
    const ownStudent = await signTypedToken(secret, 'student', `personal:${studentCode}`, 600);
    expect((await call('/booking/consent', ownStudent)).status).toBe(401);
    expect((await call(`/booking/consent/${studentCode}`, ownStudent, { env: {} })).status).toBe(401);
  });

  it('GET만 허용하고 잘못된 코드와 출처를 거절한다', async () => {
    expect((await call(`/booking/consent/${studentCode}`, null, { method: 'POST' })).status).toBe(405);
    expect((await call('/booking/consent/invalid')).status).toBe(400);
    expect((await call(`/booking/consent/${studentCode}/extra`)).status).toBe(400);
    expect((await call(`/booking/consent/${studentCode}`, null, { origin: 'https://untrusted.example' })).status).toBe(403);
    expect(sanitizePath(`/booking/consent/${studentCode}`)).toBe('/booking/consent/ABCD...3456');
  });
});
