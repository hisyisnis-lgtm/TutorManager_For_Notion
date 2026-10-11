import { readSWRCacheEntry, writeSWRCacheEntry, invalidateSWRCache } from './swrCacheStorage.js';
import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import {
  cacheScope, captureAuthScope, isAuthScopeCurrent, subscribeAuthChanges,
  getAuthRevision,
} from '../api/authState.js';

// ─────────────────────────────────────────────────────────────────────────
// stale-while-revalidate 훅 — "기억해뒀다 즉시 보여주고, 뒤에서 갱신".
//
// DataContext(홈)가 학생·수업유형·할인에 쓰던 캐시 패턴을 화면 어디서나 쓰도록
// 일반화한 것. 동작:
//   1) 현재 탭의 15분 이내 캐시가 있으면 즉시 반환 → 재방문 화면이 바로 뜬다.
//   2) 마운트 시 fetcher를 다시 호출(revalidate)해 최신값으로 교체·저장.
//   3) 쓰기(생성/수정/삭제) 후 refresh()를 호출하면 그 즉시 다시 최신화 →
//      본인이 방금 한 수정이 옛값으로 보이는 일을 막는다.
//
// 옛 정보 노출 창 = revalidate가 끝나는 데 걸리는 시간(보통 1~3초)이며, 끝나는
// 즉시 자동으로 최신으로 바뀐다. 결제·예약처럼 '행동 직전 정확성'이 필요한 화면은
// 이 훅만으로 부족하므로, 그런 화면은 행동 직전 별도 라이브 확인을 덧대야 한다.
//
// 주의: 캐시할 데이터에만 쓴다. 자주 바뀌고 틀리면 손해 큰 거래·금전 화면은
// 이 훅으로 목록을 빠르게 보여주되, 실제 확정 액션은 라이브로 재검증할 것.
// ─────────────────────────────────────────────────────────────────────────

const PREFIX = 'swr_';

/** 쓰기 직후 목록/상세 캐시를 접두사로 무효화한다. */
export const invalidateCache = invalidateSWRCache;

// ── 전역 갱신 상태 ────────────────────────────────────────────────────
// 아무 리소스라도 백그라운드 revalidate 중이면 "업데이트 중"으로 본다.
// React Query의 useIsFetching 전역 표시와 같은 개념 — 화면마다 표시를 달지 않고
// 앱에 하나만 두고 여기서 상태를 구독한다.
const revalidations = new Map();
const imperativeRequests = new Map();
const snapshots = new Map();
const revalidateListeners = new Set();
function notifyRevalidate() {
  // 탭을 떠난 로더와 완료된 오래된 기록은 콜백/요청 상태를 붙잡지 않는다.
  for (const [id, record] of revalidations) {
    if (!record.isCurrent() || (record.path !== '*' && record.path !== currentPath())) revalidations.delete(id);
  }
  // 성공 기록은 최근 표시용만 남긴다. 현재 실패/진행 중 요청은 재시도를 위해 보존한다.
  const succeeded = [...revalidations.values()].filter(record => !record.pending && !record.error);
  for (const record of succeeded.slice(0, Math.max(0, succeeded.length - 80))) revalidations.delete(record.id);
  snapshots.clear();
  revalidateListeners.forEach((l) => l());
}
/** 화면이 해제된 로더의 상태·재시도 콜백을 남기지 않는다. */
export function pruneRevalidations() {
  for (const [id, record] of revalidations) if (!record.isCurrent()) revalidations.delete(id);
  notifyRevalidate();
}
function currentPath() {
  if (typeof window === 'undefined') return '/';
  return window.location.hash.startsWith('#/')
    ? window.location.hash.slice(1).split('?')[0]
    : window.location.pathname;
}
function beginRevalidate({ key, label = '정보', lastSuccessAt = null, retry, global = false, isCurrent = () => true } = {}) {
  const path = global ? '*' : currentPath();
  const id = `${path}:${key ?? 'unscoped'}`;
  const previous = revalidations.get(id);
  const record = { id, path, label, lastSuccessAt: previous?.lastSuccessAt ?? lastSuccessAt,
    retry, isCurrent, pending: true, error: previous?.error ?? null, completedAt: null };
  revalidations.set(id, record);
  notifyRevalidate();
  return record;
}
function endRevalidate(record, error) {
  if (revalidations.get(record.id) !== record) return;
  if (!record.isCurrent()) revalidations.delete(record.id);
  else {
    record.pending = false;
    record.error = error ? '최신 정보를 확인하지 못했어요' : null;
    if (!error) {
      record.lastSuccessAt = record.completedAt = Date.now();
      record.retry = null;
    }
  }
  notifyRevalidate();
}

subscribeAuthChanges(() => { revalidations.clear(); imperativeRequests.clear(); notifyRevalidate(); });

function freshnessSnapshot(path) {
  if (!snapshots.has(path)) {
    const records = [...revalidations.values()].filter((record) => (record.path === path || record.path === '*') && record.isCurrent());
    snapshots.set(path, {
      refreshing: records.some((record) => record.pending),
      failures: records.filter((record) => record.error).map((record) => ({ ...record })),
      completedAt: Math.max(0, ...records.map((record) => record.completedAt ?? 0)),
    });
  }
  return snapshots.get(path);
}

/** 현재 화면의 실패는 다른 리소스의 성공으로 지워지지 않는다. */
export function useRevalidationStatus(path = currentPath()) {
  return useSyncExternalStore(
    (cb) => { revalidateListeners.add(cb); return () => revalidateListeners.delete(cb); },
    () => freshnessSnapshot(path),
    () => freshnessSnapshot('/'),
  );
}

function resourceLabel(key) {
  if (/homework|submittedHw/.test(key)) return '숙제';
  if (/notice/.test(key)) return '공지';
  if (/class|today|tomorrow|upcoming|prep|bookings/.test(key)) return '수업 정보';
  if (/payment|shortage/.test(key)) return '수강 내역';
  if (/consult/.test(key)) return '상담';
  if (/student/.test(key)) return '학생 정보';
  return '정보';
}

/** 앱 전역에서 하나라도 백그라운드 갱신 중이면 true. (전역 최신화 표시용) */
export function useIsRevalidating() {
  return useRevalidationStatus().refreshing;
}

// 명령형 코드(imperative fetch)에서 stale-while-revalidate를 직접 구현할 때 쓰는 프리미티브.
// useCachedResource와 같은 키 공간(swr_<key>)을 공유하므로 훅/명령형이 캐시를 함께 쓴다.
/** 캐시 값 즉시 읽기(동기). 없으면 undefined. */
export function peekCache(key) {
  return readCache(PREFIX + key);
}
export function peekCacheSavedAt(key) {
  return readCacheEntry(PREFIX + key)?.savedAt ?? null;
}
/** 캐시 값 쓰기 — 명령형 fetch 성공 후 캐시 갱신용. */
export function writeCacheValue(key, value, auth) {
  writeCache(PREFIX + key, value, auth);
}
/** 명령형 fetch를 전역 "업데이트 중" 표시에 반영 — promise를 감싸 갱신 카운터를 증감. */
export async function trackRevalidation(promise, options) {
  const record = beginRevalidate(options);
  let failure;
  try {
    return await (typeof promise === 'function' ? promise() : promise);
  } catch (error) {
    failure = error || new Error('불러오지 못했어요.');
    throw error;
  } finally {
    endRevalidate(record, failure);
  }
}

function readCache(storageKey) {
  return readCacheEntry(storageKey)?.value;
}

function readCacheEntry(storageKey) {
  return readSWRCacheEntry(storageKey);
}

function writeCache(storageKey, value, auth) {
  writeSWRCacheEntry(storageKey, value, auth);
}

/**
 * @param {string|null} key   캐시 키(파라미터 포함해 유일하게). null이면 비활성(요청 안 함).
 * @param {() => Promise<any>} fetcher  최신값을 가져오는 함수.
 * @returns {{ data, loading, refreshing, error, refresh: () => Promise<void> }}
 *   - data: 캐시값 → 최신값 (없으면 undefined)
 *   - loading: 캐시가 전혀 없어 처음 받아오는 중일 때만 true (재방문은 false)
 *   - refreshing: 백그라운드 갱신 중 (캐시는 이미 보이는 상태)
 *   - error: 캐시가 전혀 없는 실패. 기존 화면의 전체 오류 처리와 호환한다.
 *   - refreshError: 캐시 유무와 관계없이 최신 조회 실패. 데이터는 유지한다.
 *   - lastSuccessAt: 마지막 서버 조회 성공 시각(캐시의 저장 시각 포함).
 *   - refresh: 쓰기 후 즉시 최신화하거나 당겨서 새로고침할 때 호출.
 */
export function useCachedResource(key, fetcher) {
  const revision = useSyncExternalStore(subscribeAuthChanges, getAuthRevision, () => 0);
  const enabled = key != null;
  const storageKey = enabled ? PREFIX + key : null;

  const [data, setData] = useState(() => (storageKey ? readCache(storageKey) : undefined));
  const [loading, setLoading] = useState(() => (storageKey ? readCache(storageKey) === undefined : false));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [refreshError, setRefreshError] = useState(null);
  const [lastSuccessAt, setLastSuccessAt] = useState(() => key ? peekCacheSavedAt(key) : null);
  const dataOwner = useRef(`${storageKey}:${revision}`);
  const requestId = useRef(0);

  // fetcher는 매 렌더 새 함수일 수 있으므로 ref로 잡아 revalidate 재생성을 막는다.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const revalidate = useCallback(async () => {
    if (!storageKey) return;
    const auth = captureAuthScope(cacheScope(key));
    if (auth.revision !== revision || !isAuthScopeCurrent(auth)) return;
    const request = ++requestId.current;
    setRefreshing(true);
    setError(null);
    const isCurrent = () => request === requestId.current && isAuthScopeCurrent(auth);
    try {
      const fresh = await trackRevalidation(() => fetcherRef.current(), {
        key, label: resourceLabel(key), lastSuccessAt: peekCacheSavedAt(key),
        retry: () => revalidate(), isCurrent,
      });
      if (request !== requestId.current || !isAuthScopeCurrent(auth)) return;
      setData(fresh);
      writeCache(storageKey, fresh, auth);
      setLastSuccessAt(Date.now());
      setRefreshError(null);
    } catch (e) {
      if (request !== requestId.current || !isAuthScopeCurrent(auth)) return;
      setRefreshError(e.message || '불러오지 못했어요.');
      // 기존 화면은 캐시를 유지하고, 갱신 실패는 전역 상태와 refreshError로 알린다.
      setData((cur) => {
        if (cur === undefined) setError(e.message || '불러오지 못했어요.');
        return cur;
      });
    } finally {
      if (request === requestId.current && isAuthScopeCurrent(auth)) {
        setRefreshing(false);
        setLoading(false);
      }
    }
  }, [key, storageKey, revision]);

  // 키가 바뀌면 해당 키의 캐시를 즉시 반영하고 갱신. (파라미터 화면 대응)
  useEffect(() => {
    dataOwner.current = `${storageKey}:${revision}`;
    setRefreshing(false);
    setError(null);
    setRefreshError(null);
    setLastSuccessAt(key ? peekCacheSavedAt(key) : null);
    if (!storageKey) {
      setData(undefined);
      setLoading(false);
      return;
    }
    const cached = readCache(storageKey);
    setData(cached);
    setLoading(cached === undefined);
    revalidate();
    return () => { requestId.current += 1; notifyRevalidate(); };
  }, [storageKey, revision, revalidate]);

  const current = dataOwner.current === `${storageKey}:${revision}`
    && !!captureAuthScope(key ? cacheScope(key) : 'teacher').credential;
  return { data: current ? data : undefined, loading, refreshing, error,
    refreshError: current ? refreshError : null, lastSuccessAt: current ? lastSuccessAt : null,
    refresh: revalidate };
}

/**
 * 명령형 로더용 stale-while-revalidate.
 *
 * 훅을 쓸 수 없는 화면(로더가 여러 개고 서로 얽힌 강사 홈 등)에서 쓴다.
 * 캐시가 있으면 즉시 apply해 화면을 먼저 채우고, 그다음 새로 받아 다시 apply한다.
 *
 * ⚠️ fetcher는 **가공을 마친 최소 데이터**를 반환할 것. Notion 원본을 그대로 담으면
 * localStorage 용량을 넘겨 writeCache가 조용히 실패하고, 캐시가 영영 안 먹는다(2026-07 실제 사례).
 * ⚠️ 날짜에 의존하는 데이터는 키에 날짜를 넣을 것(`home:today:2026-08-25`). 그래야 날이 바뀌면
 * 옛 캐시를 자동으로 안 쓰게 된다.
 *
 * @returns {Promise<any>} 새로 받은 값. 실패하면 throw하므로 호출부에서 잡는다.
 */
export async function swrLoad(key, fetcher, apply) {
  const auth = captureAuthScope(cacheScope(key));
  if (!isAuthScopeCurrent(auth)) return;
  const cached = peekCache(key);
  if (cached !== undefined && cached !== null) apply(cached, { fromCache: true });
  const path = currentPath();
  const requestKey = `${path}:${key}`;
  const request = Symbol(key);
  imperativeRequests.set(requestKey, request);
  let settled = false;
  const isCurrent = () => isAuthScopeCurrent(auth) && currentPath() === path
    && (settled || imperativeRequests.get(requestKey) === request);
  try {
    const fresh = await trackRevalidation(fetcher, {
      key, label: resourceLabel(key), lastSuccessAt: peekCacheSavedAt(key),
      isCurrent,
      retry: () => swrLoad(key, fetcher, apply),
    });
    if (!isCurrent()) return;
    writeCacheValue(key, fresh, auth);
    apply(fresh, { fromCache: false });
    return fresh;
  } finally {
    if (imperativeRequests.get(requestKey) === request) {
      settled = true;
      imperativeRequests.delete(requestKey);
    }
  }
}
