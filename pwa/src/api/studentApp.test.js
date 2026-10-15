import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearStudentAppContext, studentAppJson } from './studentApp.js';
import { getStudentAppContext, normalizeStudentAppContext, setStudentAppContext } from './studentAppState.js';

const allowed = { allowed: true, memberId: 'member-a', studentId: 'student-a', revision: 1, studentScope: 'scope-a' };
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const setupContext = data => {
  setStudentAppContext(normalizeStudentAppContext(data));
  return getStudentAppContext().scope;
};

beforeEach(() => clearStudentAppContext());
afterEach(() => { clearStudentAppContext(); vi.restoreAllMocks(); });

describe('학생앱의 진행 중 목록 요청 공유', () => {
  it('동일 학생·경로의 동시 GET만 공유하고 완료 후 재조회는 새 요청으로 보낸다', async () => {
    const scope = setupContext(allowed);
    let finish;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(json([{ id: 'latest' }]));
    const first = studentAppJson('/notices', { scope });
    const second = studentAppJson('/notices', { scope });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(json([{ id: 'shared' }]));
    expect(await first).toEqual([{ id: 'shared' }]);
    expect(await second).toEqual([{ id: 'shared' }]);
    expect(await studentAppJson('/notices', { scope })).toEqual([{ id: 'latest' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('각 호출자의 AbortSignal을 가진 요청은 공유하지 않고 취소가 다른 호출을 막지 않는다', async () => {
    const scope = setupContext(allowed);
    let finish;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(json([{ id: 'independent' }]));
    const controller = new AbortController();
    const canceled = studentAppJson('/notices', { scope, signal: controller.signal }).catch(error => error);
    const independent = studentAppJson('/notices', { scope });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    controller.abort();
    finish(json([{ id: 'canceled' }]));
    expect((await canceled).name).toBe('AbortError');
    expect(await independent).toEqual([{ id: 'independent' }]);
  });

  it('숙제 제출 전 시작한 응답은 사용하지 않고 제출 후 목록은 새로 조회한다', async () => {
    const scope = setupContext(allowed);
    let finishOld;
    let homeworkCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      if (url === '/api/site/session') return Promise.resolve(json({ member: { id: allowed.memberId }, csrfToken: 'test-csrf' }));
      if (url.endsWith('/submit')) return Promise.resolve(json({ ok: true }));
      if (url.endsWith('/homework')) {
        homeworkCalls += 1;
        return homeworkCalls === 1 ? new Promise(resolve => { finishOld = resolve; })
          : Promise.resolve(json([{ id: 'hw', status: '제출완료' }]));
      }
      throw new Error(`예상하지 않은 요청: ${url}`);
    });
    const old = studentAppJson('/homework', { scope }).catch(error => error);
    await studentAppJson('/homework/fixture/submit', { scope, method: 'POST', body: {} });
    expect(await studentAppJson('/homework', { scope })).toEqual([{ id: 'hw', status: '제출완료' }]);
    finishOld(json([{ id: 'hw', status: '미제출' }]));
    expect((await old).name).toBe('AbortError');
    expect(homeworkCalls).toBe(2);
  });

  it('다른 리소스 변경은 진행 중 공지 조회를 취소하지 않는다', async () => {
    const scope = setupContext(allowed);
    let finish;
    vi.spyOn(globalThis, 'fetch').mockImplementation(url => {
      if (url === '/api/site/session') return Promise.resolve(json({ member: { id: allowed.memberId }, csrfToken: 'test-csrf' }));
      if (url.endsWith('/submit')) return Promise.resolve(json({ ok: true }));
      return new Promise(resolve => { finish = resolve; });
    });
    const notices = studentAppJson('/notices', { scope });
    await studentAppJson('/homework/fixture/submit', { scope, method: 'POST', body: {} });
    finish(json([{ id: 'notice' }]));
    expect(await notices).toEqual([{ id: 'notice' }]);
  });

  it('회원이 변경되면 이전 요청을 새 회원과 공유하거나 늦은 응답을 허용하지 않는다', async () => {
    const scope = setupContext(allowed);
    let finishOld;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
      .mockResolvedValueOnce(json([{ id: 'member-b-notice' }]));
    const old = studentAppJson('/notices', { scope }).catch(error => error);
    clearStudentAppContext();
    const nextScope = setupContext({ ...allowed, memberId: 'member-b' });
    expect(await studentAppJson('/notices', { scope: nextScope })).toEqual([{ id: 'member-b-notice' }]);
    finishOld(json([{ id: 'member-a-notice' }]));
    expect((await old).name).toBe('AbortError');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
