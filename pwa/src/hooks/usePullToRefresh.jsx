import { useState, useEffect, useRef } from 'react';

const THRESHOLD = 70;

export function usePullToRefresh(onRefresh) {
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const onRefreshRef = useRef(onRefresh);
  const startYRef = useRef(0);
  const pullYRef = useRef(0);
  const pullingRef = useRef(false);
  const refreshingRef = useRef(false);

  useEffect(() => { onRefreshRef.current = onRefresh; });

  useEffect(() => {
    const onTouchStart = (e) => {
      if (window.scrollY === 0 && !refreshingRef.current) {
        startYRef.current = e.touches[0].clientY;
        pullingRef.current = true;
      }
    };

    const onTouchMove = (e) => {
      if (!pullingRef.current) return;
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy > 0 && window.scrollY === 0) {
        pullYRef.current = Math.min(dy * 0.45, THRESHOLD * 1.4);
        setPullY(pullYRef.current);
        e.preventDefault(); // 당기는 중 페이지 스크롤 방지
      } else {
        pullYRef.current = 0;
        setPullY(0);
        pullingRef.current = false;
      }
    };

    const onTouchEnd = async () => {
      const pulled = pullYRef.current;
      pullingRef.current = false;
      pullYRef.current = 0;
      setPullY(0);
      if (pulled >= THRESHOLD && !refreshingRef.current) {
        refreshingRef.current = true;
        setRefreshing(true);
        try {
          await onRefreshRef.current();
        } finally {
          refreshingRef.current = false;
          setRefreshing(false);
        }
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove, { passive: false });
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  return { pullY, refreshing };
}

export function PullIndicator({ pullY, refreshing }) {
  const ready = pullY >= THRESHOLD;
  const height = refreshing ? 44 : Math.round(pullY);
  return (
    <div
      className="flex items-center justify-center overflow-hidden bg-gray-50"
      style={{
        height: `${height}px`,
        transition: pullY > 0 ? 'none' : 'height 0.2s ease',
      }}
    >
      {refreshing ? (
        <div className="flex items-center gap-1.5 text-xs text-blue-500">
          <div className="w-3.5 h-3.5 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
          새로고침 중...
        </div>
      ) : pullY > 0 ? (
        <div className={`text-xs ${ready ? 'text-blue-500' : 'text-gray-400'}`}>
          {ready ? '↑ 놓으면 새로고침' : '↓ 당겨서 새로고침'}
        </div>
      ) : null}
    </div>
  );
}
