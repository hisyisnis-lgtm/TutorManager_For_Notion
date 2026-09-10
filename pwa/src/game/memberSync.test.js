import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemberSync } from './memberSync.js';
import { loginMember, logoutMember } from './gameStore.js';
import { loadXp, saveXp } from './gameXp.js';
import { fetchGameMe, saveGameMe } from '../api/gameApi.js';

vi.mock('../api/gameApi.js', () => ({ fetchGameMe: vi.fn(), saveGameMe: vi.fn(), deleteGameMe: vi.fn() }));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
let identity;
beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  const token = btoa(JSON.stringify({ v: 2, iss: 'tutor-manager', aud: 'tutor-manager:game', purpose: 'game', sub: 'sync-user',
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 })) + '.test-signature';
  identity = { kind: 'member', id: 'sync-user', token };
  loginMember(token, { id: identity.id });
  fetchGameMe.mockResolvedValue({ user: { id: identity.id, gameData: {} } });
  saveGameMe.mockResolvedValue({ ok: true });
});

describe('회원 기록의 조회·저장·복구', () => {
  it('첫 조회가 실패하면 쓰지 않고, 재시도에서 두 기기 기록을 병합한 뒤 저장한다', async () => {
    const onState = vi.fn();
    const sync = createMemberSync(identity, { onState });
    fetchGameMe.mockRejectedValueOnce(new Error('offline'));
    saveXp(identity.id, 20);
    await sync.save('새 이름');
    expect(saveGameMe).not.toHaveBeenCalled();
    expect(onState).toHaveBeenLastCalledWith('read-error');
    fetchGameMe.mockResolvedValueOnce({ user: { id: identity.id, gameData: { xp: 1000, stg: { 'easy-1': 1500 } } } });
    await sync.retry();
    expect(saveGameMe).toHaveBeenCalledExactlyOnceWith(identity.token, expect.objectContaining({ xp: 1000, stg: { 'easy-1': 1500 } }), '새 이름');
    expect(onState).toHaveBeenLastCalledWith('saved');
  });

  it('저장 실패 후에는 재조회로 현재 학습을 되돌리지 않고 최신 로컬 값을 재전송한다', async () => {
    const onState = vi.fn();
    const sync = createMemberSync(identity, { onState });
    saveGameMe.mockRejectedValueOnce(new Error('lost response'));
    await sync.save('별명');
    expect(onState).toHaveBeenLastCalledWith('save-error');
    saveXp(identity.id, 200);
    await sync.retry();
    expect(fetchGameMe).toHaveBeenCalledTimes(1);
    expect(saveGameMe).toHaveBeenLastCalledWith(identity.token, expect.objectContaining({ xp: 200 }), '별명');
    expect(onState).toHaveBeenLastCalledWith('saved');
  });

  it('연결 회복과 연속 재시도는 진행 중인 요청 하나를 공유한다', async () => {
    const read = deferred();
    fetchGameMe.mockReturnValueOnce(read.promise);
    const sync = createMemberSync(identity, { onState: vi.fn() });
    const first = sync.retry();
    const second = sync.retry();
    await Promise.resolve();
    expect(first).toBe(second);
    expect(fetchGameMe).toHaveBeenCalledTimes(1);
    read.resolve({ user: { id: identity.id, gameData: {} } });
    await Promise.all([first, second]);
    expect(saveGameMe).toHaveBeenCalledTimes(1);
  });

  it('저장 대기 중 다음 판을 마치면 최신 진행도를 이어서 한 번 저장한다', async () => {
    const write = deferred();
    saveGameMe.mockReturnValueOnce(write.promise);
    const sync = createMemberSync(identity, { onState: vi.fn() });
    const first = sync.save();
    await vi.waitFor(() => expect(saveGameMe).toHaveBeenCalledTimes(1));
    saveXp(identity.id, 350);
    const second = sync.save();
    write.resolve({ ok: true });
    await Promise.all([first, second]);
    expect(saveGameMe).toHaveBeenCalledTimes(2);
    expect(saveGameMe).toHaveBeenLastCalledWith(identity.token, expect.objectContaining({ xp: 350 }), undefined);
  });

  it('로그아웃 뒤 늦은 첫 조회는 로컬 복원·서버 저장·완료 표시를 하지 않는다', async () => {
    const read = deferred();
    fetchGameMe.mockReturnValueOnce(read.promise);
    const onState = vi.fn();
    const sync = createMemberSync(identity, { onState });
    const pending = sync.retry();
    await Promise.resolve();
    logoutMember();
    read.resolve({ user: { id: identity.id, gameData: { xp: 9876 } } });
    await pending;
    expect(saveGameMe).not.toHaveBeenCalled();
    expect(loadXp(identity.id) ?? 0).toBe(0);
    expect(onState).toHaveBeenLastCalledWith('signed-out');
  });

  it('화면이 닫힌 뒤에는 상태 변경이나 후속 저장이 없다', async () => {
    const read = deferred();
    fetchGameMe.mockReturnValueOnce(read.promise);
    const onState = vi.fn();
    const sync = createMemberSync(identity, { onState });
    const pending = sync.retry();
    await Promise.resolve();
    sync.dispose();
    onState.mockClear();
    read.resolve({ user: { id: identity.id, gameData: {} } });
    await pending;
    expect(saveGameMe).not.toHaveBeenCalled();
    expect(onState).not.toHaveBeenCalled();
  });
});
