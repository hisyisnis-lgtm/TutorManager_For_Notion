import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { socialLoginUrl, takeLoginFromHash, exchangeGameLogin } from './gameApi.js';
import { fetchWithTimeout } from './fetchTimeout.js';

vi.mock('./fetchTimeout.js', () => ({ fetchWithTimeout: vi.fn() }));
vi.mock('../config.js', () => ({ WORKER_URL: 'https://fixture.invalid' }));

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  sessionStorage.clear();
  history.replaceState(null, '', '/game/tone');
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe('browser-bound game login', () => {
  it('stores the verifier only in the initiating tab and sends an S256 challenge', async () => {
    const start = new URL(await socialLoginUrl('google', location.origin + location.pathname));
    const pending = JSON.parse(sessionStorage.getItem('tg_login_transaction_v2'));
    expect(start.searchParams.get('transaction')).toBe(pending.transaction);
    expect(start.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(start.href).not.toContain(pending.verifier);
  });
  it('unsolicited/legacy token links are removed without exchange or session creation', () => {
    history.replaceState(null, '', '/game/tone#token=attacker-token');
    expect(takeLoginFromHash()).toBeNull();
    expect(location.hash).toBe('');
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });
  it('a callback from another tab or transaction is rejected', async () => {
    await socialLoginUrl('google', location.origin + location.pathname);
    history.replaceState(null, '', '/game/tone#login_code=' + 'a'.repeat(64) + '&login_tx=' + 'x'.repeat(43));
    expect(takeLoginFromHash()).toBeNull();
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });
  it('a matching callback is consumed once and exchanged with its verifier', async () => {
    await socialLoginUrl('google', location.origin + location.pathname);
    const pending = JSON.parse(sessionStorage.getItem('tg_login_transaction_v2'));
    history.replaceState(null, '', '/game/tone#login_code=' + 'a'.repeat(64) + '&login_tx=' + pending.transaction);
    const callback = takeLoginFromHash();
    expect(callback.verifier).toBe(pending.verifier);
    expect(sessionStorage.getItem('tg_login_transaction_v2')).toBeNull();
    expect(takeLoginFromHash()).toBeNull();
    fetchWithTimeout.mockResolvedValue(Response.json({ token: 'verified-token', user: { id: 'user-a' } }));
    expect((await exchangeGameLogin(callback)).user.id).toBe('user-a');
    expect(fetchWithTimeout.mock.calls[0][0]).toMatch(/\/game\/auth\/exchange$/);
    expect(JSON.parse(fetchWithTimeout.mock.calls[0][1].body)).toEqual(callback);
  });
  it('expired pending logins cannot exchange a returned code', async () => {
    await socialLoginUrl('google', location.origin + location.pathname);
    const pending = JSON.parse(sessionStorage.getItem('tg_login_transaction_v2'));
    sessionStorage.setItem('tg_login_transaction_v2', JSON.stringify({ ...pending, expiresAt: Date.now() - 1 }));
    history.replaceState(null, '', '/game/tone#login_code=' + 'a'.repeat(64) + '&login_tx=' + pending.transaction);
    expect(takeLoginFromHash()).toBeNull();
  });
});
