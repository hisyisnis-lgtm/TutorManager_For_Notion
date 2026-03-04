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

  const progress = Math.min(pullY / THRESHOLD, 1);
  const indicatorHeight = refreshing ? 48 : pullY > 0 ? pullY : 0;
  const showIndicator = pullY > 0 || refreshing;

  return (
    <>
      <div
        className="flex justify-center items-end overflow-hidden"
        style={{
          height: indicatorHeight,
          transition: pullY === 0 ? 'height 0.25s ease' : 'none',
        }}
      >
        {showIndicator && (
          <div
            className="mb-2"
            style={{
              opacity: refreshing ? 1 : progress,
              transform: `scale(${0.4 + progress * 0.6})`,
            }}
          >
            <svg
              className={`w-6 h-6 text-brand-600 ${refreshing ? 'animate-spin' : ''}`}
              style={!refreshing ? { transform: `rotate(${progress * 360}deg)` } : undefined}
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}
      </div>
      {children}
    </>
  );
}
