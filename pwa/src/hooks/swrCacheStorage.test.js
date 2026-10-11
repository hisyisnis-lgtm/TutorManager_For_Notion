import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { peekCache, peekCacheSavedAt, writeCacheValue, invalidateCache } from './useCachedResource.js';
import { SWR_CACHE_LIMITS } from './swrCacheStorage.js';
import { captureAuthScope, notifyAuthChange, SENSITIVE_CACHE_TTL } from '../api/authState.js';
import { clearAuth, setAuth } from '../api/authUtils.js';
import { fixtureSession } from '../api/authFixtures.js';

const write = (key, value) => writeCacheValue(key, value, captureAuthScope());
const swrKeys = storage => Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(key => key.startsWith('swr_'));
const serializedBytes = storage => swrKeys(storage).reduce((sum, key) => sum + (key.length + storage.getItem(key).length) * 2, 0);

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); setAuth(fixtureSession());
});
afterEach(() => {
  vi.restoreAllMocks(); clearAuth(); notifyAuthChange();
  localStorage.clear(); sessionStorage.clear();
});

describe('SWR 캐시의 용량·수명 제한', () => {
  it('쓰는 시점에 만료·손상 캐시를 지우고 다른 기능의 저장값은 보존한다', () => {
    sessionStorage.setItem('swr_expired', JSON.stringify({ savedAt: Date.now() - SENSITIVE_CACHE_TTL - 1, value: 'old' }));
    sessionStorage.setItem('swr_broken', '{broken');
    sessionStorage.setItem('instructor_name', '검수 강사');
    write('home:today', 'new');
    expect(sessionStorage.getItem('swr_expired')).toBeNull();
    expect(sessionStorage.getItem('swr_broken')).toBeNull();
    expect(sessionStorage.getItem('instructor_name')).toBe('검수 강사');
    expect(peekCache('home:today')).toBe('new');
  });

  it('개수 상한을 넘으면 가장 오래 저장한 항목을 퇴출하며 읽기는 수명을 연장하지 않는다', () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now');
    for (let index = 0; index < SWR_CACHE_LIMITS.entries; index += 1) {
      clock.mockReturnValue(now + index);
      write(`class:${index}`, index);
    }
    expect(peekCache('class:0')).toBe(0);
    clock.mockReturnValue(now + SWR_CACHE_LIMITS.entries);
    write('class:new', 'new');
    expect(swrKeys(sessionStorage)).toHaveLength(SWR_CACHE_LIMITS.entries);
    expect(peekCache('class:0')).toBeUndefined();
    expect(peekCache('class:1')).toBe(1);
    expect(peekCache('class:new')).toBe('new');
  });

  it('큰 목록들이 쌓여도 직렬화 총량 상한을 유지하며 최신 목록은 재사용한다', () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now');
    const value = '한'.repeat(200 * 1024);
    for (let index = 0; index < 6; index += 1) {
      clock.mockReturnValue(now + index);
      write(`homework:${index}`, value);
    }
    expect(serializedBytes(sessionStorage)).toBeLessThanOrEqual(SWR_CACHE_LIMITS.bytes);
    expect(swrKeys(sessionStorage)).toHaveLength(5);
    expect(peekCache('homework:0')).toBeUndefined();
    expect(peekCache('homework:5')).toBe(value);
  });

  it('상한을 넘는 단건은 캐시하지 않고 해당 키의 이전값도 남기지 않는다', () => {
    write('homework:large', 'previous');
    write('home:today', 'keep');
    expect(() => write('homework:large', '한'.repeat(SWR_CACHE_LIMITS.entryBytes))).not.toThrow();
    expect(peekCache('homework:large')).toBeUndefined();
    expect(peekCache('home:today')).toBe('keep');
  });

  it('동일한 저장 문자열은 한 번만 파싱하고 외부 갱신·무효화는 즉시 반영한다', () => {
    write('home:today', { value: 'old' });
    const parse = vi.spyOn(JSON, 'parse');
    expect(peekCache('home:today')).toEqual({ value: 'old' });
    expect(peekCache('home:today')).toEqual({ value: 'old' });
    expect(peekCacheSavedAt('home:today')).toBeTruthy();
    const cacheParses = () => parse.mock.calls.filter(([raw]) => String(raw).startsWith('{"savedAt":'));
    expect(cacheParses()).toHaveLength(1);
    sessionStorage.setItem('swr_home:today', JSON.stringify({ savedAt: Date.now(), value: 'external' }));
    expect(peekCache('home:today')).toBe('external');
    expect(cacheParses()).toHaveLength(2);
    invalidateCache('home:');
    expect(peekCache('home:today')).toBeUndefined();
  });

  it('저장소 용량 오류에는 제한된 메모리로 재사용하고 무효화·계정 변경 때 비운다', () => {
    const storage = sessionStorage;
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (this === storage) throw new DOMException('Quota full', 'QuotaExceededError');
      return originalSet.call(this, key, value);
    });
    write('class:invalidate', 'temporary');
    expect(storage.getItem('swr_class:invalidate')).toBeNull();
    expect(peekCache('class:invalidate')).toBe('temporary');
    invalidateCache('class:');
    expect(peekCache('class:invalidate')).toBeUndefined();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now');
    for (let index = 0; index <= SWR_CACHE_LIMITS.entries; index += 1) {
      clock.mockReturnValue(now + index);
      write(`home:${index}`, index);
    }
    expect(peekCache('home:0')).toBeUndefined();
    expect(peekCache(`home:${SWR_CACHE_LIMITS.entries}`)).toBe(SWR_CACHE_LIMITS.entries);
    clearAuth(); setAuth(fixtureSession());
    expect(peekCache(`home:${SWR_CACHE_LIMITS.entries}`)).toBeUndefined();
  });

  it('저장소가 차단돼도 메모리 캐시에 같은 15분 만료를 적용한다', () => {
    const storage = sessionStorage;
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key) {
      if (this === storage) throw new DOMException('Blocked', 'SecurityError');
      return originalGet.call(this, key);
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (this === storage) throw new DOMException('Blocked', 'SecurityError');
      return originalSet.call(this, key, value);
    });
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    write('home:today', 'memory');
    expect(peekCache('home:today')).toBe('memory');
    clock.mockReturnValue(now + SENSITIVE_CACHE_TTL + 1);
    expect(peekCache('home:today')).toBeUndefined();
  });

});
