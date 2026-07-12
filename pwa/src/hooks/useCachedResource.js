import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';

// ─────────────────────────────────────────────────────────────────────────
// stale-while-revalidate 훅 — "기억해뒀다 즉시 보여주고, 뒤에서 갱신".
//
// DataContext(홈)가 학생·수업유형·할인에 쓰던 캐시 패턴을 화면 어디서나 쓰도록
// 일반화한 것. 동작:
//   1) localStorage에 저장된 값이 있으면 즉시 반환 → 재방문 화면이 바로 뜬다.
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

/**
 * 캐시 무효화 — 주어진 접두사로 시작하는 모든 캐시 키를 지운다.
 * 편집(생성/수정/삭제) 직후 호출하면, 해당 목록·상세를 다음에 열 때 옛값 대신
 * 새로 불러온다 → 본인이 방금 한 수정이 옛 데이터로 보이는 것을 막는다.
 * 예: 수업 저장 후 invalidateCache('class') → classes 목록·상세 캐시 제거.
 */
export function invalidateCache(prefix) {
  try {
    const full = PREFIX + prefix;
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(full)) localStorage.removeItem(k);
    }
  } catch {
    // localStorage 접근 불가 시 무시 — 무효화 실패해도 마운트 시 revalidate가 어차피 최신화.
  }
}

// ── 전역 갱신 상태 ────────────────────────────────────────────────────
// 아무 리소스라도 백그라운드 revalidate 중이면 "업데이트 중"으로 본다.
// React Query의 useIsFetching 전역 표시와 같은 개념 — 화면마다 표시를 달지 않고
// 앱에 하나만 두고 여기서 상태를 구독한다.
let activeRevalidations = 0;
const revalidateListeners = new Set();
function notifyRevalidate() {
  revalidateListeners.forEach((l) => l());
}
function beginRevalidate() {
  activeRevalidations += 1;
  notifyRevalidate();
}
function endRevalidate() {
  activeRevalidations = Math.max(0, activeRevalidations - 1);
  notifyRevalidate();
}

/** 앱 전역에서 하나라도 백그라운드 갱신 중이면 true. (전역 최신화 표시용) */
export function useIsRevalidating() {
  return useSyncExternalStore(
    (cb) => {
      revalidateListeners.add(cb);
      return () => revalidateListeners.delete(cb);
    },
    () => activeRevalidations > 0,
    () => false,
  );
}

// 명령형 코드(imperative fetch)에서 stale-while-revalidate를 직접 구현할 때 쓰는 프리미티브.
// useCachedResource와 같은 키 공간(swr_<key>)을 공유하므로 훅/명령형이 캐시를 함께 쓴다.
/** 캐시 값 즉시 읽기(동기). 없으면 undefined. */
export function peekCache(key) {
  return readCache(PREFIX + key);
}
/** 캐시 값 쓰기 — 명령형 fetch 성공 후 캐시 갱신용. */
export function writeCacheValue(key, value) {
  writeCache(PREFIX + key, value);
}
/** 명령형 fetch를 전역 "업데이트 중" 표시에 반영 — promise를 감싸 갱신 카운터를 증감. */
export async function trackRevalidation(promise) {
  beginRevalidate();
  try {
    return await promise;
  } finally {
    endRevalidate();
  }
}

function readCache(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(storageKey, value) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // 용량 초과 등은 조용히 무시 — 캐시는 부가기능이라 실패해도 흐름을 막지 않는다.
  }
}

/**
 * @param {string|null} key   캐시 키(파라미터 포함해 유일하게). null이면 비활성(요청 안 함).
 * @param {() => Promise<any>} fetcher  최신값을 가져오는 함수.
 * @returns {{ data, loading, refreshing, error, refresh: () => Promise<void> }}
 *   - data: 캐시값 → 최신값 (없으면 undefined)
 *   - loading: 캐시가 전혀 없어 처음 받아오는 중일 때만 true (재방문은 false)
 *   - refreshing: 백그라운드 갱신 중 (캐시는 이미 보이는 상태)
 *   - error: 캐시도 없고 fetch도 실패했을 때만 메시지. 캐시가 있으면 조용히 유지.
 *   - refresh: 쓰기 후 즉시 최신화하거나 당겨서 새로고침할 때 호출.
 */
export function useCachedResource(key, fetcher) {
  const enabled = key != null;
  const storageKey = enabled ? PREFIX + key : null;

  const [data, setData] = useState(() => (storageKey ? readCache(storageKey) : undefined));
  const [loading, setLoading] = useState(() => (storageKey ? readCache(storageKey) === undefined : false));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // fetcher는 매 렌더 새 함수일 수 있으므로 ref로 잡아 revalidate 재생성을 막는다.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const revalidate = useCallback(async () => {
    if (!storageKey) return;
    setRefreshing(true);
    setError(null);
    beginRevalidate();
    try {
      const fresh = await fetcherRef.current();
      setData(fresh);
      writeCache(storageKey, fresh);
    } catch (e) {
      // 캐시가 있으면 옛 데이터를 유지한 채 조용히 실패, 없을 때만 에러 노출.
      setData((cur) => {
        if (cur === undefined) setError(e.message || '불러오지 못했어요.');
        return cur;
      });
    } finally {
      endRevalidate();
      setRefreshing(false);
      setLoading(false);
    }
  }, [storageKey]);

  // 키가 바뀌면 해당 키의 캐시를 즉시 반영하고 갱신. (파라미터 화면 대응)
  useEffect(() => {
    if (!storageKey) {
      setData(undefined);
      setLoading(false);
      return;
    }
    const cached = readCache(storageKey);
    setData(cached);
    setLoading(cached === undefined);
    revalidate();
  }, [storageKey, revalidate]);

  return { data, loading, refreshing, error, refresh: revalidate };
}
