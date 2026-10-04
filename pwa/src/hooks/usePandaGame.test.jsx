import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import usePandaGame from './usePandaGame.js';
import { fetchPandaProfile, performPandaAction } from '../api/pandaApi.js';
import { getPandaGameStorageKey, normalizePandaGameProfile, persistPandaGameProfile, readPandaGameProfile } from '../constants/pandaGameState.js';
import { getPandaServerCacheKey, persistPandaServerCache } from '../constants/pandaServerState.js';

vi.mock('../api/pandaApi.js', () => ({ fetchPandaProfile: vi.fn(), performPandaAction: vi.fn() }));
const options = { storageKey: 'student-game', earnedTotal: 200, serverEnabled: false };
const transition = { version: 1, initializedAt: '2026-09-30T00:00:00.000Z', startingFood: 200, noticeSeen: true };
const snapshot = (profile = normalizePandaGameProfile({ fedTotal: 176, revision: 1 }), availableFood = 24) => ({ profile, earnedTotal: 200, availableFood, transition });
beforeEach(() => { localStorage.clear(); vi.resetAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

describe('판다 거래 저장과 원격 실패', () => {
  it('저장 실패는 경험치·잔액·소유권을 바꾸지 않는다', async () => {
    localStorage.setItem(options.storageKey, '176');
    const { result } = renderHook(() => usePandaGame(options));
    vi.spyOn(window.Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    let received;
    await act(async () => { received = await result.current.transact({ type: 'buy', itemId: 'gardener:hat' }); });
    expect(received).toBeNull();
    expect(result.current.profile.owned).toEqual([]);
    expect(result.current.available).toBe(24);
    expect(result.current.error).toMatch(/저장하지 못/);
  });

  it('손상 정본은 거래를 차단하고 덮어쓰지 않는다', async () => {
    localStorage.setItem(getPandaGameStorageKey(options.storageKey), 'broken');
    const { result } = renderHook(() => usePandaGame(options));
    expect(result.current.canTransact).toBe(false);
    await act(async () => { await result.current.transact({ type: 'feed', count: 1 }); });
    expect(localStorage.getItem(getPandaGameStorageKey(options.storageKey))).toBe('broken');
  });

  it('학생별 정본에 구매를 저장하고 다시 읽어도 보존한다', async () => {
    localStorage.setItem(options.storageKey, '176');
    const { result, unmount } = renderHook(() => usePandaGame(options));
    await act(async () => { await result.current.transact({ type: 'buy', itemId: 'gardener:hat' }); });
    expect(result.current.available).toBe(18);
    unmount();
    expect(readPandaGameProfile(options.storageKey).owned).toEqual(['gardener:hat']);
    expect(readPandaGameProfile('different-student').owned).toEqual([]);
  });

  it('원격 응답유실은 로컬 성공으로 대체하지 않고 같은 요청ID로 재시도한다', async () => {
    fetchPandaProfile.mockResolvedValue(snapshot());
    performPandaAction.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => usePandaGame({ ...options, studentToken: 'TESTSTUDENT1', serverEnabled: true }));
    await waitFor(() => expect(result.current.canTransact).toBe(true));
    await act(async () => { await result.current.transact({ type: 'buy', itemId: 'gardener:hat' }); });
    expect(result.current.profile.owned).toEqual([]);
    expect(result.current.available).toBe(24);
    expect(result.current.canTransact).toBe(false);
    expect(result.current.busy).toBe(false);
    expect(result.current.retry).toBeTypeOf('function');
    const request = performPandaAction.mock.calls[0][1];
    performPandaAction.mockResolvedValueOnce(snapshot(normalizePandaGameProfile({ fedTotal: 176, spentFood: 6, owned: ['gardener:hat'], revision: 2 }), 18));
    await act(async () => { await result.current.retry(); });
    expect(performPandaAction.mock.calls[1][1]).toEqual(request);
    expect(result.current.profile.owned).toEqual(['gardener:hat']);
    expect(result.current.available).toBe(18);
  });

  it('revision 충돌에서는 최신 서버 상태를 수용하고 재차감하지 않는다', async () => {
    fetchPandaProfile.mockResolvedValue(snapshot());
    const latest = snapshot(normalizePandaGameProfile({ fedTotal: 177, revision: 2 }), 23);
    performPandaAction.mockRejectedValue(Object.assign(new Error('다른 화면에서 변경됐어요.'), { status: 409, snapshot: latest }));
    const { result } = renderHook(() => usePandaGame({ ...options, studentToken: 'TESTSTUDENT1', serverEnabled: true }));
    await waitFor(() => expect(result.current.canTransact).toBe(true));
    await act(async () => { await result.current.transact({ type: 'feed', count: 5 }); });
    expect(result.current.profile.fedTotal).toBe(177);
    expect(result.current.available).toBe(23);
    expect(performPandaAction).toHaveBeenCalledTimes(1);
  });

  it('구매 거부 후 내역 재조회는 최신 프로필을 반환해 한 번의 재시도로 확인 화면을 연다', async () => {
    fetchPandaProfile.mockResolvedValue(snapshot());
    performPandaAction.mockRejectedValueOnce(Object.assign(new Error('레벨을 다시 확인해 주세요.'), { status: 409, snapshot: snapshot() }));
    const { result } = renderHook(() => usePandaGame({ ...options, studentToken: 'TESTSTUDENT1', serverEnabled: true }));
    await waitFor(() => expect(result.current.canTransact).toBe(true));
    await act(async () => { await result.current.transact({ type: 'buy', itemId: 'gardener:hat' }); });
    let received;
    await act(async () => { received = await result.current.retry(); });
    expect(received).toEqual({ profile: snapshot().profile, action: null });
    expect(performPandaAction).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe('');
  });

  it('첫 전환은 옛 성장값을 보내지 않고 알과 누적 먹이 전액을 받아 원본은 보존한다', async () => {
    localStorage.setItem(options.storageKey, '176');
    const reset = { ...snapshot(normalizePandaGameProfile(), 200), transition: { ...transition, noticeSeen: false } };
    fetchPandaProfile.mockResolvedValue(reset);
    const { result } = renderHook(() => usePandaGame({ ...options, studentToken: 'TESTSTUDENT1', serverEnabled: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(performPandaAction).not.toHaveBeenCalled();
    expect(result.current.profile.fedTotal).toBe(0);
    expect(result.current.available).toBe(200);
    expect(result.current.transition.noticeSeen).toBe(false);
    expect(result.current.canTransact).toBe(true);
    expect(localStorage.getItem(options.storageKey)).toBe('176');
    expect(localStorage.getItem(getPandaGameStorageKey(options.storageKey))).toBeNull();
    expect(JSON.parse(localStorage.getItem(getPandaServerCacheKey(options.storageKey)))).toMatchObject(reset);
  });

  it('새 기기가 먼저 키운 뒤 옛 기기로 접속해도 서버 성장을 이어가며 옛 원본은 덮지 않는다', async () => {
    localStorage.setItem(options.storageKey, '112');
    fetchPandaProfile.mockResolvedValue(snapshot(normalizePandaGameProfile({ fedTotal: 1, revision: 1 }), 199));
    const { result } = renderHook(() => usePandaGame({ ...options, studentToken: 'TESTSTUDENT1', serverEnabled: true }));
    await waitFor(() => expect(result.current.canTransact).toBe(true));
    expect(result.current.error).toBe('');
    expect(result.current.profile.fedTotal).toBe(1);
    expect(result.current.available).toBe(199);
    expect(performPandaAction).not.toHaveBeenCalled();
    expect(localStorage.getItem(options.storageKey)).toBe('112');
    expect(result.current.retry).toBeNull();
  });

  it('StrictMode의 늦은 최초 GET이 최신 상태를 덮어쓰거나 이관을 중복 발급하지 않는다', async () => {
    localStorage.setItem(options.storageKey, '176');
    let finishOld;
    fetchPandaProfile.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
      .mockResolvedValueOnce(snapshot(normalizePandaGameProfile({ fedTotal: 177, revision: 2 }), 23));
    const { result } = renderHook(() => usePandaGame({ ...options, studentToken: 'TESTSTUDENT1', serverEnabled: true }), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.profile.fedTotal).toBe(177));
    await act(async () => { finishOld(snapshot(normalizePandaGameProfile(), 200)); });
    expect(result.current.profile.fedTotal).toBe(177);
    expect(result.current.available).toBe(23);
    expect(performPandaAction).not.toHaveBeenCalled();
  });
  it('캐시가 없는 통신 실패는 옛 로컬 값으로 새 알이나 잔액을 확정하지 않는다', async () => {
    localStorage.setItem(options.storageKey, '112');
    localStorage.setItem(getPandaGameStorageKey(options.storageKey), 'broken');
    fetchPandaProfile.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => usePandaGame({ ...options, studentToken: 'TESTSTUDENT1', serverEnabled: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasProfile).toBe(false);
    expect(result.current.serverReady).toBe(false);
    expect(result.current.canTransact).toBe(false);
    expect(result.current.transition).toBeNull();
    expect(localStorage.getItem(getPandaServerCacheKey(options.storageKey))).toBeNull();
    expect(performPandaAction).not.toHaveBeenCalled();
  });

  it('서버 캐시는 장애 중 표시만 하고 새 서버 응답은 캐시 revision보다 낮아도 받아들인다', async () => {
    persistPandaServerCache(options.storageKey, snapshot(normalizePandaGameProfile({ fedTotal: 180, revision: 999 }), 20));
    fetchPandaProfile.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => usePandaGame({ ...options, studentToken: 'TESTSTUDENT1', serverEnabled: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasProfile).toBe(true);
    expect(result.current.profile.fedTotal).toBe(180);
    expect(result.current.canTransact).toBe(false);
    await act(async () => { await result.current.transact({ type: 'feed', count: 1 }); });
    expect(performPandaAction).not.toHaveBeenCalled();
    fetchPandaProfile.mockResolvedValueOnce(snapshot());
    await act(async () => { await result.current.retry(); });
    expect(result.current.profile.revision).toBe(1);
    expect(result.current.available).toBe(24);
    expect(result.current.canTransact).toBe(true);
  });

  it('캐시를 삭제하고 재접속해도 서버의 성장과 안내 확인 상태를 복원한다', async () => {
    fetchPandaProfile.mockResolvedValue(snapshot());
    const first = renderHook(() => usePandaGame({ ...options, studentToken: 'TESTSTUDENT1', serverEnabled: true }));
    await waitFor(() => expect(first.result.current.serverReady).toBe(true));
    first.unmount();
    localStorage.removeItem(getPandaServerCacheKey(options.storageKey));
    const second = renderHook(() => usePandaGame({ ...options, studentToken: 'TESTSTUDENT1', serverEnabled: true }));
    await waitFor(() => expect(second.result.current.serverReady).toBe(true));
    expect(second.result.current.profile).toEqual(snapshot().profile);
    expect(second.result.current.transition.noticeSeen).toBe(true);
    expect(second.result.current.available).toBe(24);
  });

  it.each(['focus', 'online', 'storage'])('%s 신호로 서버를 다시 조회하며 캐시 이벤트 값을 신뢰하지 않는다', async eventType => {
    fetchPandaProfile.mockResolvedValueOnce(snapshot());
    const { result } = renderHook(() => usePandaGame({ ...options, studentToken: 'TESTSTUDENT1', serverEnabled: true }));
    await waitFor(() => expect(result.current.serverReady).toBe(true));
    const latest = snapshot(normalizePandaGameProfile({ fedTotal: 177, revision: 2 }), 23);
    fetchPandaProfile.mockResolvedValueOnce(latest);
    await act(async () => {
      const event = eventType === 'storage'
        ? new window.StorageEvent('storage', { key: getPandaServerCacheKey(options.storageKey), newValue: 'untrusted' })
        : new window.Event(eventType);
      window.dispatchEvent(event);
    });
    expect(fetchPandaProfile).toHaveBeenCalledTimes(2);
    expect(result.current.profile.fedTotal).toBe(177);
    expect(result.current.available).toBe(23);
  });

  it('학생을 바꾼 뒤 도착한 이전 학생의 거래 응답은 새 학생 상태나 캐시에 반영하지 않는다', async () => {
    fetchPandaProfile.mockResolvedValueOnce(snapshot());
    let completeOld;
    performPandaAction.mockImplementationOnce(() => new Promise(resolve => { completeOld = resolve; }));
    const { result, rerender } = renderHook(({ token }) => usePandaGame({ ...options, storageKey: token, studentToken: token, serverEnabled: true }), { initialProps: { token: 'TESTSTUDENT1' } });
    await waitFor(() => expect(result.current.canTransact).toBe(true));
    let pending;
    act(() => { pending = result.current.transact({ type: 'feed', count: 1 }); });
    fetchPandaProfile.mockResolvedValueOnce(snapshot(normalizePandaGameProfile(), 200));
    rerender({ token: 'TESTSTUDENT2' });
    await waitFor(() => expect(result.current.canTransact).toBe(true));
    await act(async () => { completeOld(snapshot(normalizePandaGameProfile({ fedTotal: 177, revision: 2 }), 23)); await pending; });
    expect(result.current.profile.fedTotal).toBe(0);
    expect(result.current.available).toBe(200);
    expect(JSON.parse(localStorage.getItem(getPandaServerCacheKey('TESTSTUDENT2'))).profile.fedTotal).toBe(0);
  });

  it('캐시 저장 공간이 없어도 서버에서 성공한 거래를 실패로 바꾸지 않는다', async () => {
    fetchPandaProfile.mockResolvedValue(snapshot());
    const { result } = renderHook(() => usePandaGame({ ...options, studentToken: 'TESTSTUDENT1', serverEnabled: true }));
    await waitFor(() => expect(result.current.canTransact).toBe(true));
    vi.spyOn(window.Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    performPandaAction.mockResolvedValueOnce(snapshot(normalizePandaGameProfile({ fedTotal: 177, revision: 2 }), 23));
    await act(async () => { await result.current.transact({ type: 'feed', count: 1 }); });
    expect(result.current.profile.fedTotal).toBe(177);
    expect(result.current.available).toBe(23);
    expect(result.current.error).toBe('');
    expect(result.current.canTransact).toBe(true);
  });

  it('A→B→A로 돌아와 새 요청 중이면 이전 A의 응답은 잠금이나 재시도 정보를 해제하지 않는다', async () => {
    fetchPandaProfile.mockResolvedValue(snapshot());
    let completeOld;
    let failNew;
    performPandaAction.mockImplementationOnce(() => new Promise(resolve => { completeOld = resolve; }))
      .mockImplementationOnce(() => new Promise((_, reject) => { failNew = reject; }));
    const { result, rerender } = renderHook(({ token }) => usePandaGame({ ...options, storageKey: token, studentToken: token, serverEnabled: true }), { initialProps: { token: 'TESTSTUDENT1' } });
    await waitFor(() => expect(result.current.canTransact).toBe(true));
    let oldRequest;
    act(() => { oldRequest = result.current.transact({ type: 'feed', count: 1 }); });
    rerender({ token: 'TESTSTUDENT2' });
    await waitFor(() => expect(result.current.canTransact).toBe(true));
    rerender({ token: 'TESTSTUDENT1' });
    await waitFor(() => expect(result.current.canTransact).toBe(true));
    let newRequest;
    act(() => { newRequest = result.current.transact({ type: 'feed', count: 2 }); });
    await act(async () => { completeOld(snapshot(normalizePandaGameProfile({ fedTotal: 177, revision: 2 }), 23)); await oldRequest; });
    expect(result.current.busy).toBe(true);
    expect(result.current.canTransact).toBe(false);
    await act(async () => { failNew(new Error('response lost')); await newRequest; });
    performPandaAction.mockResolvedValueOnce(snapshot(normalizePandaGameProfile({ fedTotal: 178, revision: 2 }), 22));
    await act(async () => { await result.current.retry(); });
    expect(performPandaAction.mock.calls[2][1]).toEqual(performPandaAction.mock.calls[1][1]);
    expect(result.current.profile.fedTotal).toBe(178);
  });

  it('뒤늦은 낮은 revision 조회는 이미 확인한 성장과 잔액을 되돌리지 않는다', async () => {
    fetchPandaProfile.mockResolvedValueOnce(snapshot(normalizePandaGameProfile({ fedTotal: 177, revision: 2 }), 23));
    const { result } = renderHook(() => usePandaGame({ ...options, studentToken: 'TESTSTUDENT1', serverEnabled: true }));
    await waitFor(() => expect(result.current.canTransact).toBe(true));
    fetchPandaProfile.mockResolvedValueOnce(snapshot());
    await act(async () => { window.dispatchEvent(new window.Event('focus')); });
    expect(result.current.profile.fedTotal).toBe(177);
    expect(result.current.available).toBe(23);
    expect(result.current.canTransact).toBe(true);
  });
  it('이름 요청의 재시도 성공은 UI가 완료 처리를 이어갈 수 있도록 작업 종류를 반환한다', async () => {
    fetchPandaProfile.mockResolvedValue(snapshot());
    performPandaAction.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => usePandaGame({ ...options, studentToken: 'TESTSTUDENT1', serverEnabled: true }));
    await waitFor(() => expect(result.current.canTransact).toBe(true));
    await act(async () => { await result.current.transact({ type: 'nickname', nickname: '하오' }); });
    const named = normalizePandaGameProfile({ fedTotal: 176, nickname: '하오', namingPromptSeen: true, revision: 2 });
    performPandaAction.mockResolvedValueOnce(snapshot(named));
    let received;
    await act(async () => { received = await result.current.retry(); });
    expect(received).toEqual({ profile: named, action: { type: 'nickname' } });
    expect(performPandaAction.mock.calls[1][1]).toEqual(performPandaAction.mock.calls[0][1]);
  });
  it('다른 탭의 저장은 표시·잔액에 반영하고 이후 손상 이벤트는 쓰기를 차단한다', async () => {
    const { result } = renderHook(() => usePandaGame(options));
    const key = getPandaGameStorageKey(options.storageKey);
    const latest = normalizePandaGameProfile({ fedTotal: 176, revision: 3 });
    await act(async () => {
      persistPandaGameProfile(options.storageKey, latest);
      window.dispatchEvent(new window.StorageEvent('storage', { key }));
    });
    expect(result.current.profile).toEqual(latest);
    expect(result.current.available).toBe(24);
    await act(async () => {
      localStorage.setItem(key, JSON.stringify({ ...latest, refundFood: 100 }));
      window.dispatchEvent(new window.StorageEvent('storage', { key }));
    });
    expect(result.current.canTransact).toBe(false);
    expect(result.current.profile).toEqual(latest);
    await act(async () => { await result.current.transact({ type: 'feed', count: 1 }); });
    expect(JSON.parse(localStorage.getItem(key)).refundFood).toBe(100);
  });
  it('Web Lock 대기 중 다른 화면이 커밋하면 최신 기록을 읽고 중복 지출을 거부한다', async () => {
    localStorage.setItem(options.storageKey, '176');
    let release;
    const request = vi.fn((name, callback) => new Promise(resolve => { release = resolve; }).then(callback));
    vi.stubGlobal('navigator', { locks: { request } });
    try {
      const { result } = renderHook(() => usePandaGame(options));
      let pending;
      act(() => { pending = result.current.transact({ type: 'buy', itemId: 'gardener:hat' }); });
      const latest = normalizePandaGameProfile({ fedTotal: 180, revision: 1 });
      persistPandaGameProfile(options.storageKey, latest);
      await act(async () => { release(); await pending; });
      expect(request).toHaveBeenCalledWith(`panda:${getPandaGameStorageKey(options.storageKey)}`, expect.any(Function));
      expect(result.current.profile).toEqual(latest);
      expect(result.current.error).toMatch(/다른 화면/);
      expect(readPandaGameProfile(options.storageKey)).toEqual(latest);
    } finally { vi.unstubAllGlobals(); }
  });
  it('Web Locks 미지원에서도 이벤트를 놓친 오래된 화면은 최신 상태와 실패 안내를 표시한다', async () => {
    vi.stubGlobal('navigator', {});
    try {
      localStorage.setItem(options.storageKey, '176');
      const { result } = renderHook(() => usePandaGame(options));
      const latest = normalizePandaGameProfile({ fedTotal: 181, revision: 1 });
      persistPandaGameProfile(options.storageKey, latest); // No storage event was delivered yet.
      let response;
      await act(async () => { response = await result.current.transact({ type: 'buy', itemId: 'gardener:hat' }); });
      expect(response).toBeNull();
      expect(result.current.profile).toEqual(latest);
      expect(result.current.available).toBe(19);
      expect(result.current.error).toMatch(/다른 화면.*최신 기록/);
      expect(result.current.canTransact).toBe(true);
      expect(readPandaGameProfile(options.storageKey)).toEqual(latest);
      await act(async () => { response = await result.current.transact({ type: 'buy', itemId: 'gardener:hat' }); });
      expect(response.owned).toEqual(['gardener:hat']);
      expect(result.current.available).toBe(13);
      expect(result.current.error).toBe('');
    } finally { vi.unstubAllGlobals(); }
  });
});
