import { useEffect, useRef, useState } from 'react';
import { ArrowsClockwiseIcon, CheckCircleIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useLocation } from 'react-router-dom';
import { useRevalidationStatus } from '../../hooks/useCachedResource.js';
import { ABOVE_BOTTOM_NAV } from '../../constants/styles.js';
import { Button } from '../shadcn/button';
import { BG_CARD, TEXT_PRIMARY, TEXT_TERTIARY, STATUS_WARNING_TEXT } from '../../constants/theme.js';

// 전역 최신화 표시 — 앱에 하나만 둔다(App.jsx). 백그라운드로 캐시를 갱신하는
// 동안 "업데이트 중", 끝나면 잠깐 "방금 업데이트됨"을 보여주고 사라진다.
// 전체 스피너로 화면을 막지 않으면서도, 지금 보는 게 최신인지 확인시켜 준다.
// (React Query의 useIsFetching 전역 인디케이터와 같은 패턴)
export default function FreshnessIndicator() {
  const { pathname } = useLocation();
  const { refreshing, failures, completedAt } = useRevalidationStatus(pathname);
  const [showDone, setShowDone] = useState(false);
  const wasRefreshing = useRef(false);

  useEffect(() => {
    // 갱신이 막 끝난 순간(true→false)에만 "방금 업데이트됨"을 잠깐 표시.
    if (wasRefreshing.current && !refreshing && failures.length === 0 && completedAt) {
      setShowDone(true);
      const t = setTimeout(() => setShowDone(false), 1400);
      wasRefreshing.current = refreshing;
      return () => clearTimeout(t);
    }
    setShowDone(false);
    wasRefreshing.current = refreshing;
    return undefined;
  }, [refreshing, failures.length, completedAt, pathname]);

  if (!refreshing && !showDone && failures.length === 0) return null;

  // 실패는 다른 조회의 성공으로 덮지 않으며, 각 항목의 마지막 성공 시각을 보여준다.
  if (failures.length > 0) return (
    <div role="status" className="fixed inset-x-0 mx-auto w-full max-w-[480px] px-4" style={{ bottom: ABOVE_BOTTOM_NAV, zIndex: 45 }}>
      <div className="max-h-[35dvh] overflow-y-auto rounded-xl p-3" style={{ background: BG_CARD, boxShadow: 'var(--shadow-card)' }}>
        {failures.map((failure) => (
          <div key={failure.id} className="flex items-center justify-between gap-3 py-1">
            <div className="min-w-0">
              <p className="m-0 flex items-start gap-1 text-xs font-semibold" style={{ color: TEXT_PRIMARY }}>
                <WarningCircleIcon size={16} weight="fill" className="shrink-0" style={{ color: STATUS_WARNING_TEXT }} />
                {failure.label} 확인에 실패했어요
              </p>
              <p className="m-0 mt-1 text-xs" style={{ color: TEXT_TERTIARY }}>
                {failure.lastSuccessAt ? `마지막 확인 ${new Date(failure.lastSuccessAt).toLocaleString('ko-KR', {
                  timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}` : '아직 서버 정보를 확인하지 못했어요'}
              </p>
            </div>
            {failure.retry && <Button variant="outline" size="sm" className="min-h-11" disabled={failure.pending}
              aria-label={`${failure.label} 다시 시도`}
              onClick={() => { Promise.resolve().then(failure.retry).catch(() => {}); }}>
              {failure.pending ? '확인 중…' : '다시 시도'}
            </Button>}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        // 캡슐 탭바 위 — 탭바 형태가 바뀌어도 이 상수만 따라간다
        bottom: ABOVE_BOTTOM_NAV,
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
          fontWeight: 600,
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
            <ArrowsClockwiseIcon size={12} weight="bold" className="animate-spin" />
            업데이트 중…
          </>
        ) : (
          <>
            <CheckCircleIcon size={16} weight="fill" />
            방금 업데이트됨
          </>
        )}
      </div>
    </div>
  );
}
