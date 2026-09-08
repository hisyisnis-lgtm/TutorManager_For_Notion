import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { peekCache, swrLoad, useCachedResource, writeCacheValue } from './useCachedResource.js';
import { captureAuthScope, notifyAuthChange, SENSITIVE_CACHE_TTL } from '../api/authState.js';
import { clearAuth, setAuth } from '../api/authUtils.js';
import { fixtureSession } from '../api/authFixtures.js';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setAuth(fixtureSession()); });
afterEach(() => {
  cleanup(); localStorage.clear(); sessionStorage.clear(); notifyAuthChange(); vi.useRealTimers();
});

describe('개인정보 SWR 캐시', () => {
  it('현재 탭에서만 15분 동안 캐시를 읽고 만료하면 지운다', () => {
    writeCacheValue('home:today', { phone: 'fixture-only' }, captureAuthScope());
    expect(localStorage.getItem('swr_home:today')).toBeNull();
    expect(peekCache('home:today')).toEqual({ phone: 'fixture-only' });
    const cache = JSON.parse(sessionStorage.getItem('swr_home:today'));
    cache.savedAt -= SENSITIVE_CACHE_TTL + 1;
    sessionStorage.setItem('swr_home:today', JSON.stringify(cache));
    expect(peekCache('home:today')).toBeUndefined();
    expect(sessionStorage.getItem('swr_home:today')).toBeNull();
  });

  it('명령형 요청이 로그아웃 후 완료되어도 캐시·화면에 적용하지 않는다', async () => {
    let respond;
    const apply = vi.fn();
    const result = swrLoad('home:today', () => new Promise((resolve) => { respond = resolve; }), apply);
    clearAuth();
    setAuth(fixtureSession());
    respond({ phone: 'old-session' });
    await result;
    expect(apply).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('swr_home:today')).toBeNull();
  });

  it('로그아웃 즉시 메모리 값을 숨기고 늦은 응답으로 재삽입하지 않는다', async () => {
    writeCacheValue('home:today', { phone: 'cached-private' }, captureAuthScope());
    let respond;
    const fetcher = vi.fn(() => new Promise((resolve) => { respond = resolve; }));
    const { result } = renderHook(() => useCachedResource('home:today', fetcher));
    expect(result.current.data).toEqual({ phone: 'cached-private' });
    act(() => clearAuth());
    expect(result.current.data).toBeUndefined();
    await act(async () => respond({ phone: 'late-private' }));
    expect(result.current.data).toBeUndefined();
    expect(sessionStorage.getItem('swr_home:today')).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('키 변경 전 요청이 나중에 끝나도 새 화면 데이터와 캐시를 덮지 않는다', async () => {
    let respond;
    const pending = new Promise((resolve) => { respond = resolve; });
    const { result, rerender } = renderHook(({ key }) => useCachedResource(key,
      () => key === 'home:old' ? pending : Promise.resolve('new-result')),
    { initialProps: { key: 'home:old' } });
    rerender({ key: 'home:new' });
    await waitFor(() => expect(result.current.data).toBe('new-result'));
    await act(async () => respond('old-result'));
    expect(result.current.data).toBe('new-result');
    expect(peekCache('home:old')).toBeUndefined();
  });
});
