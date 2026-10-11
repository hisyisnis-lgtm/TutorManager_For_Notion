import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { peekCache, swrLoad, useCachedResource, useRevalidationStatus, trackRevalidation, writeCacheValue } from './useCachedResource.js';
import { captureAuthScope, notifyAuthChange, SENSITIVE_CACHE_TTL } from '../api/authState.js';
import { clearAuth, setAuth } from '../api/authUtils.js';
import { fixtureSession } from '../api/authFixtures.js';
import { SWR_CACHE_LIMITS } from './swrCacheStorage.js';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setAuth(fixtureSession()); });
afterEach(() => {
  cleanup(); localStorage.clear(); sessionStorage.clear(); notifyAuthChange(); vi.useRealTimers();
});

describe('개인정보 SWR 캐시', () => {
  it('캐시 단건 상한을 넘는 조회도 현재 화면에는 성공값과 신선도를 적용한다', async () => {
    const fresh = '한'.repeat(SWR_CACHE_LIMITS.entryBytes);
    const { result } = renderHook(() => ({ resource: useCachedResource('home:large', () => Promise.resolve(fresh)), status: useRevalidationStatus() }));
    await waitFor(() => expect(result.current.resource.data).toBe(fresh));
    expect(result.current.resource.error).toBeNull();
    expect(result.current.resource.refreshError).toBeNull();
    expect(result.current.status.refreshing).toBe(false);
    expect(result.current.status.completedAt).toBeTruthy();
    expect(peekCache('home:large')).toBeUndefined();
  });

  it('완료한 명령형 요청을 정리해도 실패 재시도와 최신화 완료 표시를 유지한다', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('실패')).mockResolvedValueOnce('recovered');
    const apply = vi.fn();
    const { result } = renderHook(useRevalidationStatus);
    await act(async () => { await swrLoad('home:retry', fetcher, apply).catch(() => {}); });
    expect(result.current.failures).toHaveLength(1);
    expect(result.current.refreshing).toBe(false);
    await act(async () => result.current.failures[0].retry());
    expect(result.current.failures).toEqual([]);
    expect(result.current.completedAt).toBeTruthy();
    expect(peekCache('home:retry')).toBe('recovered');
    expect(apply).toHaveBeenCalledWith('recovered', { fromCache: false });
  });

  it('캐시 갱신 실패 시 기존 값과 마지막 성공 시각을 유지하고 재시도로 복구한다', async () => {
    const savedAt = Date.now() - 60000;
    sessionStorage.setItem('swr_home:today', JSON.stringify({ savedAt, value: ['이전 수업'] }));
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('통신 실패')).mockResolvedValueOnce(['최신 수업']);
    const { result } = renderHook(() => ({ resource: useCachedResource('home:today', fetcher), status: useRevalidationStatus() }));
    await waitFor(() => expect(result.current.resource.refreshError).toBe('통신 실패'));
    expect(result.current.resource.data).toEqual(['이전 수업']);
    expect(result.current.resource.error).toBeNull();
    expect(result.current.resource.lastSuccessAt).toBe(savedAt);
    expect(result.current.status.failures[0].lastSuccessAt).toBe(savedAt);
    await act(async () => result.current.status.failures[0].retry());
    expect(result.current.resource.data).toEqual(['최신 수업']);
    expect(result.current.resource.refreshError).toBeNull();
    expect(result.current.status.failures).toEqual([]);
    expect(result.current.resource.lastSuccessAt).toBeGreaterThan(savedAt);
  });

  it('캐시가 없는 첫 실패와 다른 리소스의 성공을 구분한다', async () => {
    const { result } = renderHook(() => ({ resource: useCachedResource('home:today', () => Promise.reject(new Error('첫 실패'))), status: useRevalidationStatus() }));
    await waitFor(() => expect(result.current.resource.error).toBe('첫 실패'));
    await act(async () => trackRevalidation(Promise.resolve([]), { key: 'other', label: '다른 정보' }));
    expect(result.current.status.failures).toHaveLength(1);
    expect(result.current.status.failures[0].lastSuccessAt).toBeNull();
  });

  it('해제된 화면의 늦은 실패를 전역 오류로 남기지 않는다', async () => {
    let reject;
    const pending = new Promise((_, fail) => { reject = fail; });
    const resource = renderHook(() => useCachedResource('home:today', () => pending));
    const status = renderHook(useRevalidationStatus);
    resource.unmount();
    await act(async () => reject(new Error('이전 화면 실패')));
    expect(status.result.current.refreshing).toBe(false);
    expect(status.result.current.failures).toEqual([]);
  });

  it('앱 공통 데이터 실패는 사용하는 다른 경로에서도 유지된다', async () => {
    const { result } = renderHook(() => useRevalidationStatus('/students'));
    await act(async () => trackRevalidation(Promise.reject(new Error('공통 데이터 실패')), {
      key: 'master', global: true,
    }).catch(() => {}));
    expect(result.current.failures).toHaveLength(1);
  });

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

  it('같은 명령형 리소스의 늦은 응답이 더 최근 성공을 덮지 않는다', async () => {
    let respond;
    const apply = vi.fn();
    const first = swrLoad('home:today', () => new Promise(resolve => { respond = resolve; }), apply);
    await swrLoad('home:today', () => Promise.resolve('최신값'), apply);
    respond('늦은 이전값');
    await first;
    expect(peekCache('home:today')).toBe('최신값');
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenLastCalledWith('최신값', { fromCache: false });
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
