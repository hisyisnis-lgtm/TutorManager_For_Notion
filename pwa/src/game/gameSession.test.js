import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMemberSession, loginMember, logoutMember, pullMemberData, pushMemberData } from './gameStore.js';
import { fetchGameMe, saveGameMe } from '../api/gameApi.js';
import { loadXp } from './gameXp.js';

vi.mock('../api/gameApi.js', () => ({ fetchGameMe: vi.fn(), saveGameMe: vi.fn() }));
const token = (sub, overrides = {}) => btoa(JSON.stringify({ v: 2, iss: 'tutor-manager', aud: 'tutor-manager:game', purpose: 'game', sub,
  iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600, ...overrides })) + '.test-signature';
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
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
});
