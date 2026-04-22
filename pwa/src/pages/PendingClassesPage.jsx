import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext.jsx';
import { queryPage } from '../api/notionClient.js';
import { CLASSES_DB, parseClass } from '../api/classes.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import PendingClassCard from '../components/home/PendingClassCard.jsx';
import { usePendingClassState } from '../hooks/usePendingClassState.js';
import { PRIMARY } from '../constants/theme.js';

const KST = 'Asia/Seoul';

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
  const { state: pendingState, setHwDone, setDismissed, dismissMany } = usePendingClassState();
  const [todayClasses, setTodayClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);

  const today = getKSTToday();
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = `${today.year}-${pad(today.month + 1)}-${pad(today.day)}`;

  const load = async () => {
    setLoading(true);
    try {
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
        50
      );
      setTodayClasses((data?.results ?? []).map(parseClass));
    } catch (e) {
      console.error('[수업 마무리] 불러오기 오류', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

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
    if (!loading && pending.length === 0) navigate('/home', { replace: true });
  }, [loading, pending.length, navigate]);

  const handleDismissAll = () => {
    dismissMany(pending.map((c) => c.id));
    setShowConfirm(false);
    navigate('/home');
  };

  return (
    <PullToRefresh onRefresh={load}>
      <PageHeader
        title="수업 마무리"
        back
        action={
          pending.length > 0 ? (
            <button
              onClick={() => setShowConfirm(true)}
              className="active:scale-[0.96] transition-[scale,color] duration-150 ease-out"
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
                onHwClick={setHwDone}
                onDismiss={setDismissed}
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
