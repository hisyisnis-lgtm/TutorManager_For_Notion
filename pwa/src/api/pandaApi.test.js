import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPandaProfile, performPandaAction } from './pandaApi.js';
import { fixtureSession } from './authFixtures.js';
import { setStudentSession, clearStudentSession, getStudentSession } from './studentAuth.js';

const code = 'QAABCD123456';
const snapshot = { profile: { fedTotal: 112, spentFood: 0, refundFood: 0, owned: [], equipped: { hat: null, costume: null, neck: null, hand: null }, nickname: '', namingPromptSeen: false, revision: 1 }, earnedTotal: 200, availableFood: 88,
  transition: { version: 1, initializedAt: '2026-09-30T00:00:00.000Z', startingFood: 200, noticeSeen: true } };
const action = { requestId: 'request-fixture-123456', expectedRevision: 1, type: 'buy', itemId: 'gardener:hat' };
beforeEach(() => {
  localStorage.clear();
  setStudentSession(code, fixtureSession('student', `personal:${code}`));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(snapshot)));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe('판다 서버 저장 API', () => {
  it('본인 세션·no-store를 쓰며 GET 응답으로 로컬 기록을 직접 바꾸지 않는다', async () => {
    const before = JSON.stringify(localStorage);
    expect(await fetchPandaProfile(code)).toEqual(snapshot);
    expect(fetch.mock.calls[0][0]).toContain(`/personal/student/${code}/panda`);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET', cache: 'no-store', headers: { Authorization: `Bearer ${getStudentSession(code)}` } });
    expect(JSON.stringify(localStorage)).toBe(before);
  });

  it('액션 ID와 서버 확인 응답을 보존하며 실패를 로컬 성공으로 대체하지 않는다', async () => {
    const response = { ...snapshot, ok: true, action: { requestId: action.requestId, type: action.type } };
    fetch.mockResolvedValueOnce(Response.json(response));
    expect(await performPandaAction(code, action)).toEqual(response);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(action);
    const before = JSON.stringify(localStorage);
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(performPandaAction(code, action)).rejects.toThrow('Failed to fetch');
    expect(JSON.stringify(localStorage)).toBe(before);
    fetch.mockResolvedValueOnce(Response.json({ ...response, action: { ...response.action, requestId: 'another-request' } }));
    await expect(performPandaAction(code, action)).rejects.toThrow('응답');
  });

  it('409에서는 최신 스냅샷을 오류에 포함하고 401에서는 해당 세션만 만료 처리한다', async () => {
    fetch.mockResolvedValueOnce(Response.json({ ...snapshot, error: '최신 기록', code: 'revision_conflict' }, { status: 409 }));
    await expect(performPandaAction(code, action)).rejects.toMatchObject({ status: 409, code: 'revision_conflict', profile: snapshot.profile, snapshot });
    fetch.mockResolvedValueOnce(Response.json({ error: 'expired' }, { status: 401 }));
    await expect(fetchPandaProfile(code)).rejects.toMatchObject({ status: 401 });
    expect(getStudentSession(code)).toBe('');
  });

  it('인증 변경 뒤 도착한 응답과 손상된 성공 응답은 적용하지 않는다', async () => {
    let resolve;
    fetch.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const pending = fetchPandaProfile(code);
    clearStudentSession(code); resolve(Response.json(snapshot));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    setStudentSession(code, fixtureSession('student', `personal:${code}`));
    fetch.mockResolvedValueOnce(Response.json({ ok: true }));
    await expect(fetchPandaProfile(code)).rejects.toThrow('응답');
    fetch.mockResolvedValueOnce(new Response('<html>error</html>'));
    await expect(fetchPandaProfile(code)).rejects.toThrow('응답');
  });
  it.each([
    { availableFood: 999 },
    { transition: undefined },
    { transition: { ...snapshot.transition, startingFood: 201 } },
    { transition: { ...snapshot.transition, initializedAt: 'invalid' } },
    { profile: { ...snapshot.profile, refundFood: 10 } },
    { profile: { ...snapshot.profile, owned: ['removed:hat'] } },
    { profile: { ...snapshot.profile, equipped: { ...snapshot.profile.equipped, hat: 'gardener:hat' } } },
  ])('경제·소유권이 손상된 응답 %j는 캐시할 성공 스냅샷으로 인정하지 않는다', async fields => {
    fetch.mockResolvedValueOnce(Response.json({ ...snapshot, ...fields }));
    await expect(fetchPandaProfile(code)).rejects.toThrow('응답');
    fetch.mockResolvedValueOnce(Response.json({ ...snapshot, ...fields, error: 'conflict' }, { status: 409 }));
    await expect(fetchPandaProfile(code)).rejects.not.toHaveProperty('snapshot');
  });
});
