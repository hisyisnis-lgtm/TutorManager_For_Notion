import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMemberSession, loginMember, logoutMember, pullMemberData, pushMemberData, loadMasteredSync, storeMasteredSync, deleteMemberAccount } from './gameStore.js';
import { fetchGameMe, saveGameMe, deleteGameMe } from '../api/gameApi.js';
import { loadXp, loadRank } from './gameXp.js';
import { loadWordStats, saveWordStats, recordWordResult } from './tgWordStats.js';
import { loadToneStats, saveToneStats } from './toneStats.js';
import { loadStreak, saveStreak, loadFreezes, saveFreezes, recordPlay } from './streak.js';
import { stageScoreOf } from './gameLogic.js';
import { loadAchievements } from './achievements.js';

vi.mock('../api/gameApi.js', () => ({ fetchGameMe: vi.fn(), saveGameMe: vi.fn(), deleteGameMe: vi.fn() }));
const token = (sub, overrides = {}) => btoa(JSON.stringify({ v: 2, iss: 'tutor-manager', aud: 'tutor-manager:game', purpose: 'game', sub,
  iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600, ...overrides })) + '.test-signature';
beforeEach(() => { localStorage.clear(); vi.resetAllMocks(); });
afterEach(() => localStorage.clear());

describe('game sessions and pending synchronization', () => {
  it('old tokens, expired tokens and a different account subject never establish a member session', () => {
    for (const value of ['legacy.token', token('user-a', { exp: 0 }), token('user-b'), token('user-a', { purpose: 'student' })]) {
      localStorage.setItem('tg_member_token', value);
      localStorage.setItem('tg_member_user', JSON.stringify({ id: 'user-a' }));
      expect(getMemberSession()).toBeNull();
      expect(localStorage.getItem('tg_member_token')).toBeNull();
    }
    expect(() => loginMember(token('user-a'), { id: 'user-b' })).toThrow();
  });
  it('a pull that completes after logout cannot restore account data', async () => {
    const sessionToken = token('user-a');
    loginMember(sessionToken, { id: 'user-a' });
    let resolve;
    fetchGameMe.mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = pullMemberData({ kind: 'member', id: 'user-a', token: sessionToken });
    logoutMember();
    resolve({ user: { id: 'user-a', gameData: { xp: 98765 } } });
    await expect(pending).rejects.toThrow();
    expect(loadXp('user-a') ?? 0).toBe(0);
    expect(getMemberSession()).toBeNull();
  });
  it('an old request failure cannot log out a newly signed-in account', async () => {
    const sessionToken = token('user-a');
    loginMember(sessionToken, { id: 'user-a' });
    let reject;
    fetchGameMe.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    const pending = pullMemberData({ kind: 'member', id: 'user-a', token: sessionToken });
    loginMember(token('user-b'), { id: 'user-b' });
    reject(Object.assign(new Error('expired'), { status: 401 }));
    await expect(pending).rejects.toThrow();
    expect(getMemberSession().user.id).toBe('user-b');
  });
  it('an identity retained after logout cannot push guest or member records', async () => {
    const sessionToken = token('user-a');
    loginMember(sessionToken, { id: 'user-a' });
    logoutMember();
    await expect(pushMemberData({ kind: 'member', id: 'user-a', token: sessionToken })).rejects.toThrow();
    expect(saveGameMe).not.toHaveBeenCalled();
  });
  it('reflects progress merged by the server after saving', async () => {
    const sessionToken = token('user-a');
    loginMember(sessionToken, { id: 'user-a' });
    saveGameMe.mockResolvedValue({ ok: true, gameData: { xp: 1000 } });
    await pushMemberData({ kind: 'member', id: 'user-a', token: sessionToken });
    expect(loadXp('user-a')).toBe(1000);
  });
  it('a save response after logout does not restore private progress', async () => {
    const sessionToken = token('user-a');
    loginMember(sessionToken, { id: 'user-a' });
    let resolve;
    saveGameMe.mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = pushMemberData({ kind: 'member', id: 'user-a', token: sessionToken });
    logoutMember();
    resolve({ ok: true, gameData: { xp: 98765 } });
    await expect(pending).rejects.toThrow();
    expect(loadXp('user-a') ?? 0).toBe(0);
  });
});

describe('저장 응답은 대기 중 새 학습 상태를 되돌리지 않는다', () => {
  it('새 오답·보호권 소비·숙련도 하락·스트릭은 보존하고 서버 획득 기록만 병합한다', async () => {
    const sessionToken = token('user-a');
    const identity = { kind: 'member', id: 'user-a', token: sessionToken };
    loginMember(sessionToken, { id: identity.id });
    saveWordStats(identity.id, { 你好: [2, 2, 2000, 2, 1, 0] });
    saveToneStats(identity.id, { 1: [2, 2, 1] });
    saveFreezes(identity.id, 1);
    saveStreak(identity.id, { lastDate: '2026-09-08', current: 5, longest: 5 });
    let resolve;
    saveGameMe.mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = pushMemberData(identity);
    const sent = saveGameMe.mock.calls[0][1];

    // 저장은 계속 대기 중이고, 새 판에서 틀려 다시 오답 노트로 들어갔다.
    const newWords = loadWordStats(identity.id);
    for (let i = 0; i < 2; i += 1) recordWordResult(newWords, '你好', { perfect: false, timedOut: false, ms: 1000 });
    saveWordStats(identity.id, newWords);
    saveToneStats(identity.id, { 1: [2, 4, 0.4] });
    storeMasteredSync(identity.id, 0);
    recordPlay(identity.id, new Date('2026-09-10T10:00:00+09:00'));
    const newStreak = loadStreak(identity.id);
    expect(loadFreezes(identity.id)).toBe(0);

    resolve({ ok: true, gameData: { ...sent, xp: 1000, ach: ['first-play'], stg: { 'easy-2': 1100 } } });
    await pending;
    expect(loadWordStats(identity.id)).toEqual(newWords);
    expect(loadWordStats(identity.id).你好[5]).toBe(3);
    expect(loadToneStats(identity.id)).toEqual({ 1: [2, 4, 0.4] });
    expect(loadMasteredSync(identity.id)).toBe(0);
    expect(loadFreezes(identity.id)).toBe(0);
    expect(loadStreak(identity.id)).toEqual(newStreak);
    expect(loadXp(identity.id)).toBe(1000);
    expect(loadAchievements(identity.id)).toContain('first-play');
    expect(stageScoreOf(identity.id, 'easy-2')).toBe(1100);
  });

  it('근거 없는 과거 rank가 서버에서 돌아와도 승급으로 복원하지 않는다', async () => {
    const sessionToken = token('user-a');
    loginMember(sessionToken, { id: 'user-a' });
    saveGameMe.mockResolvedValue({ ok: true, gameData: { rk: 2, bp: 0, stg: {} } });
    await pushMemberData({ kind: 'member', id: 'user-a', token: sessionToken });
    expect(loadRank('user-a')).toBe(0);
  });

  it.each([
    { rk: 2, bp: 2 },
    { rk: 1, stg: { 'easy-1': 1500, 'easy-2': 1500, 'easy-3': 1500, 'easy-4': 1500, 'easy-5': 1500 } },
  ])('시험 또는 기존 스테이지 클리어가 뒷받침하는 rank는 보존한다: %j', async (gameData) => {
    const sessionToken = token('user-a');
    loginMember(sessionToken, { id: 'user-a' });
    saveGameMe.mockResolvedValue({ ok: true, gameData });
    await pushMemberData({ kind: 'member', id: 'user-a', token: sessionToken });
    expect(loadRank('user-a')).toBe(gameData.rk);
  });
});

describe('회원 탈퇴는 서버 결과가 확정되어야 로컬 기록을 지운다', () => {
  beforeEach(() => {
    loginMember(token('user-a'), { id: 'user-a' });
    localStorage.setItem('tg_test_record', '보존할 기록');
    localStorage.setItem('teacher_session', '강사 로그인');
  });
  it('삭제 성공 응답을 받은 뒤에만 게임 기록과 세션을 정리한다', async () => {
    deleteGameMe.mockResolvedValue({ ok: true });
    await deleteMemberAccount();
    expect(localStorage.getItem('tg_test_record')).toBeNull();
    expect(getMemberSession()).toBeNull();
    expect(localStorage.getItem('teacher_session')).toBe('강사 로그인');
    expect(fetchGameMe).not.toHaveBeenCalled();
  });
  it('삭제가 실패하고 계정이 여전히 존재하면 기록·로그인을 보존한다', async () => {
    deleteGameMe.mockRejectedValue(new Error('server failed'));
    fetchGameMe.mockResolvedValue({ user: { id: 'user-a' } });
    await expect(deleteMemberAccount()).rejects.toThrow('계정이 아직 남아 있어요');
    expect(localStorage.getItem('tg_test_record')).toBe('보존할 기록');
    expect(getMemberSession().user.id).toBe('user-a');
  });
  it('삭제 응답을 잃어도 인증된 조회에서 계정 없음이 확인되면 정리한다', async () => {
    deleteGameMe.mockRejectedValue(new Error('response lost'));
    fetchGameMe.mockRejectedValue(Object.assign(new Error('account missing'), { status: 404 }));
    await deleteMemberAccount();
    expect(localStorage.getItem('tg_test_record')).toBeNull();
    expect(getMemberSession()).toBeNull();
  });
  it.each([undefined, 401, 403, 503])('조회 실패(%s)는 계정 삭제로 간주하지 않는다', async status => {
    deleteGameMe.mockRejectedValue(new Error('response lost'));
    fetchGameMe.mockRejectedValue(Object.assign(new Error('unknown'), { status }));
    await expect(deleteMemberAccount()).rejects.toThrow('삭제 여부를 확인하지 못했어요');
    expect(localStorage.getItem('tg_test_record')).toBe('보존할 기록');
    expect(getMemberSession().user.id).toBe('user-a');
  });
  it('삭제를 기다리는 동안 로그인 계정이 바뀌면 새 계정 기록을 지우지 않는다', async () => {
    let resolve;
    deleteGameMe.mockReturnValue(new Promise(done => { resolve = done; }));
    const pending = deleteMemberAccount();
    loginMember(token('user-b'), { id: 'user-b' });
    resolve({ ok: true });
    await expect(pending).rejects.toThrow('로그인이 변경');
    expect(localStorage.getItem('tg_test_record')).toBe('보존할 기록');
    expect(getMemberSession().user.id).toBe('user-b');
  });
  it('동시 삭제·저장은 차단하고 삭제 결과 확인 중에는 인증 실패로 로그아웃하지 않는다', async () => {
    let rejectRead, resolveDelete;
    const identity = { kind: 'member', id: 'user-a', token: getMemberSession().token };
    fetchGameMe.mockReturnValueOnce(new Promise((_done, fail) => { rejectRead = fail; }));
    const reading = pullMemberData(identity);
    deleteGameMe.mockReturnValueOnce(new Promise(done => { resolveDelete = done; }));
    const deleting = deleteMemberAccount();
    await expect(deleteMemberAccount()).rejects.toThrow('계정 삭제 결과');
    await expect(pushMemberData(identity)).rejects.toThrow('계정 삭제 결과');
    expect(deleteGameMe).toHaveBeenCalledTimes(1);
    expect(saveGameMe).not.toHaveBeenCalled();
    rejectRead(Object.assign(new Error('account missing'), { status: 404 }));
    await expect(reading).rejects.toThrow();
    expect(getMemberSession().user.id).toBe('user-a');
    resolveDelete({ ok: true });
    await deleting;
    expect(getMemberSession()).toBeNull();
  });
});
