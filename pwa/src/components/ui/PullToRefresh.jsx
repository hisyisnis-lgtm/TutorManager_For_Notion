import React, { useEffect, useRef, useState } from 'react';

const THRESHOLD = 64;

export default function PullToRefresh({ onRefresh, children }) {
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const active = useRef(false);
  const currentPull = useRef(0);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  });

  useEffect(() => {
    let startX = 0;

    function onTouchStart(e) {
      if (window.scrollY > 5) return;
      startX = e.touches[0].clientX;
      startY.current = e.touches[0].clientY;
      active.current = true;
      currentPull.current = 0;
    }

    function onTouchMove(e) {
      if (!active.current) return;
      const deltaY = e.touches[0].clientY - startY.current;
      const deltaX = e.touches[0].clientX - startX;
      // 수평 스와이프면 무시 (필터 탭 등)
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        active.current = false;
        return;
      }
      if (deltaY <= 0) {
        active.current = false;
        return;
      }
      currentPull.current = Math.min(deltaY * 0.45, THRESHOLD * 1.5);
      e.preventDefault();
      setPullY(currentPull.current);
    }

    function onTouchEnd() {
      if (!active.current) return;
      active.current = false;
      const pull = currentPull.current;
      currentPull.current = 0;
      if (pull >= THRESHOLD) {
        setPullY(0);
        setRefreshing(true);
        Promise.resolve(onRefreshRef.current()).finally(() => setRefreshing(false));
      } else {
        setPullY(0);
      }
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  const ready = pullY >= THRESHOLD;
  const indicatorHeight = refreshing ? 44 : pullY > 0 ? Math.round(pullY) : 0;

  return (
    <>
      <div
        className="flex items-center justify-center overflow-hidden bg-gray-50"
        style={{
          height: indicatorHeight,
          transition: pullY === 0 ? 'height 0.2s ease' : 'none',
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
      {children}
    </>
  );
}
