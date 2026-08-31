import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext.jsx';
import { useCachedResource } from '../hooks/useCachedResource.js';
import { queryPage } from '../api/notionClient.js';
import { CLASSES_DB, parseClass } from '../api/classes.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import PendingClassCard from '../components/home/PendingClassCard.jsx';
import { usePendingClassState } from '../hooks/usePendingClassState.js';
import { PRIMARY } from '../constants/theme.js';

import { KST } from '../utils/dateUtils.js';

function getKSTToday() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parseInt(parts.find((p) => p.type === t)?.value ?? '0');
  return { year: get('year'), month: get('month') - 1, day: get('day') };
}

export default function PendingClassesPage() {
  const navigate = useNavigate();
  const { studentNameMap } = useData();
  const { state: pendingState, dismissMany } = usePendingClassState();
  const [showConfirm, setShowConfirm] = useState(false);

  const today = getKSTToday();
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = `${today.year}-${pad(today.month + 1)}-${pad(today.day)}`;

  // 오늘 수업 목록 캐시(당일 키). 재방문 즉시 표시.
  const todayRes = useCachedResource(`pending:today:${todayStr}`, async () => {
    const data = await queryPage(
      CLASSES_DB,
      {
        and: [
          { property: '수업 일시', date: { on_or_after: `${todayStr}T00:00:00+09:00` } },
          { property: '수업 일시', date: { on_or_before: `${todayStr}T23:59:59+09:00` } },
          { property: '특이사항', select: { does_not_equal: '🚫 취소' } },
        ],
      },
      [{ property: '수업 일시', direction: 'ascending' }],
      undefined,
      50,
    );
    return (data?.results ?? []).map(parseClass);
  });
  const todayClasses = todayRes.data ?? [];
  const loading = todayRes.loading;

  const nowMs = Date.now();
  const pending = todayClasses.filter((cls) => {
    if (!cls.endTime) return false;
    if (new Date(cls.endTime).getTime() > nowMs) return false;
    const s = pendingState[cls.id] || {};
    if (s.dismissed) return false;
    const logDone = (cls.lessonLogIds?.length ?? 0) > 0;
    if (s.hwDone && logDone) return false;
    return true;
  });

  useEffect(() => {
    // 최신 데이터가 확정된 뒤(캐시 갱신 완료)에만 홈으로 — 옛 캐시가 비었다고 성급히 넘기지 않게.
    if (!loading && !todayRes.refreshing && pending.length === 0) navigate('/home', { replace: true });
  }, [loading, todayRes.refreshing, pending.length, navigate]);

  const handleDismissAll = () => {
    dismissMany(pending.map((c) => c.id));
    setShowConfirm(false);
    navigate('/home');
  };

  return (
    <PullToRefresh onRefresh={todayRes.refresh}>
      <PageHeader
        title="수업 마무리"
        back
        action={
          pending.length > 0 ? (
            <button
              onClick={() => setShowConfirm(true)}
              className="hit-40 transition-[color] duration-150 ease-out"
              style={{
                background: 'transparent', border: 'none',
                color: PRIMARY, fontSize: 14, fontWeight: 600,
                padding: '6px 4px', cursor: 'pointer',
              }}
            >
              모두 완료
            </button>
          ) : null
        }
      />
      {loading ? (
        <div className="px-4 pt-8"><LoadingSpinner /></div>
      ) : (
        <div className="px-4 pb-6" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pending.map((cls) => {
            const names = cls.studentIds
              .map((id) => studentNameMap[id])
              .filter(Boolean)
              .map((n) => n.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/gu, '').trim())
              .join(', ');
            const s = pendingState[cls.id] || {};
            return (
              <PendingClassCard
                key={cls.id}
                cls={cls}
                studentName={names}
                hwDone={!!s.hwDone}
              />
            );
          })}
        </div>
      )}
      {showConfirm && (
        <ConfirmDialog
          title="모두 완료하시겠습니까?"
          message="표시된 모든 수업이 마무리 목록에서 사라집니다."
          confirmLabel="모두 완료"
          cancelLabel="취소"
          onConfirm={handleDismissAll}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </PullToRefresh>
  );
}
