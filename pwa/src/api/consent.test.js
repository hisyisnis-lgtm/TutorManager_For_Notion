import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchConsentTerms } from './consent.js';
import { fixtureSession } from './authFixtures.js';
import { setStudentSession, getStudentSession } from './studentAuth.js';
import { setAuth, clearAuth } from './authUtils.js';
const code = 'ABCDEF123456';
const data = { teacherCancellation: '보강', refundBefore: '시작 전', refundAfter: ['1', '2'], refundNotes: ['1', '2', '3', '4'], confirmationUrl: 'https://forms.gle/fixture' };
beforeEach(() => { localStorage.clear(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(data))); });
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
describe('인증된 동의서 읽기', () => {
  it('본인 bearer와 no-store를 사용하고 원문을 로컬 저장소에 남기지 않는다', async () => {
    const token = fixtureSession('student', `personal:${code}`);
    setStudentSession(code, token);
    const before = JSON.stringify(localStorage);
    expect(await fetchConsentTerms(code)).toEqual(data);
    expect(fetch.mock.calls[0][0]).toContain(`/booking/consent/${code}`);
    expect(fetch.mock.calls[0][1]).toMatchObject({ cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
    expect(JSON.stringify(localStorage)).toBe(before);
  });
  it('강사 원문 조회와 만료 처리를 분리한다', async () => {
    const teacher = fixtureSession(); setAuth(teacher);
    await fetchConsentTerms();
    expect(fetch.mock.calls[0][0]).toMatch(/\/booking\/consent$/);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${teacher}`);
    fetch.mockResolvedValueOnce(Response.json({ error: 'expired' }, { status: 401 }));
    await expect(fetchConsentTerms()).rejects.toThrow();
    expect(localStorage.getItem('auth_token')).toBeNull();
  });
  it('학생 401은 본인 세션을 정리하고 오류 HTML·다른 폼 URL은 원문으로 취급하지 않는다', async () => {
    setStudentSession(code, fixtureSession('student', `personal:${code}`));
    fetch.mockResolvedValueOnce(Response.json({ error: 'expired' }, { status: 401 }));
    await expect(fetchConsentTerms(code)).rejects.toThrow();
    expect(getStudentSession(code)).toBe('');
    fetch.mockResolvedValueOnce(new Response('<html>fallback</html>'));
    await expect(fetchConsentTerms(code)).rejects.toThrow('동의서');
    fetch.mockResolvedValueOnce(Response.json({ ...data, confirmationUrl: 'https://untrusted.example' }));
    await expect(fetchConsentTerms(code)).rejects.toThrow('동의서');
  });
  it('인증 변경 전 시작한 늦은 응답을 버린다', async () => {
    setAuth(fixtureSession()); let resolve;
    fetch.mockReturnValue(new Promise(done => { resolve = done; }));
    const pending = fetchConsentTerms();
    clearAuth(); resolve(Response.json(data));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
