import { useEffect, useRef, useState } from 'react';
import { ArrowsClockwiseIcon, CheckCircleIcon } from '@phosphor-icons/react';
import { useIsRevalidating } from '../../hooks/useCachedResource.js';

// 전역 최신화 표시 — 앱에 하나만 둔다(App.jsx). 백그라운드로 캐시를 갱신하는
// 동안 "업데이트 중", 끝나면 잠깐 "방금 업데이트됨"을 보여주고 사라진다.
// 전체 스피너로 화면을 막지 않으면서도, 지금 보는 게 최신인지 확인시켜 준다.
// (React Query의 useIsFetching 전역 인디케이터와 같은 패턴)
export default function FreshnessIndicator() {
  const refreshing = useIsRevalidating();
  const [showDone, setShowDone] = useState(false);
  const wasRefreshing = useRef(false);

  useEffect(() => {
    // 갱신이 막 끝난 순간(true→false)에만 "방금 업데이트됨"을 잠깐 표시.
    if (wasRefreshing.current && !refreshing) {
      setShowDone(true);
      const t = setTimeout(() => setShowDone(false), 1400);
      wasRefreshing.current = refreshing;
      return () => clearTimeout(t);
    }
    wasRefreshing.current = refreshing;
    return undefined;
  }, [refreshing]);

  if (!refreshing && !showDone) return null;

  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 'calc(60px + env(safe-area-inset-bottom) + 12px)',
        display: 'flex',
        justifyContent: 'center',
        zIndex: 45, // BottomNav(50) 아래 — 위치상 겹치지 않지만 안전하게.
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: 'rgba(28,28,30,0.82)',
          color: '#fff',
          fontSize: 12,
          fontWeight: 500,
          padding: '6px 13px',
          borderRadius: 980,
          backdropFilter: 'saturate(180%) blur(12px)',
          WebkitBackdropFilter: 'saturate(180%) blur(12px)',
          boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
          transition: 'opacity 200ms ease-out',
        }}
      >
        {refreshing ? (
          <>
            <ArrowsClockwiseIcon size={13} weight="bold" className="animate-spin" />
            업데이트 중…
          </>
        ) : (
          <>
            <CheckCircleIcon size={14} weight="fill" />
            방금 업데이트됨
          </>
        )}
      </div>
    </div>
  );
}
