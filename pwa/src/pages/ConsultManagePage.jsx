import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '../components/shadcn/button';
import { Card, CardContent } from '../components/shadcn/card';
import { useCachedResource } from '../hooks/useCachedResource.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';
import SectionHeading from '../components/ui/SectionHeading.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import { STATUS_ERROR_TEXT, STATUS_INFO_DARK, TEXT_TERTIARY, GRAY_100, STATUS_INFO_BG, STATUS_ERROR_BG, STATUS_PURPLE_BG, STATUS_PURPLE_TEXT, STATUS_GOLD_BG, STATUS_GOLD_TEXT, BORDER_NEUTRAL, STATUS_SUCCESS_BG, STATUS_SUCCESS_DARK } from '../constants/theme.js';
import { queryAll } from '../api/notionClient.js';
import { CONSULT_DB } from '../constants.js';
import { parseConsult, acknowledgeConsult, closeConsult } from '../api/consults.js';
import { useData } from '../context/DataContext.jsx';
import { KST } from '../utils/dateUtils.js';
import { ClipboardTextIcon } from '@phosphor-icons/react';

function formatKST(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: KST,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));
  } catch { return ''; }
}

const STATUS_STYLE = {
  '신청됨': { bg: STATUS_ERROR_BG, color: STATUS_ERROR_TEXT },
  '확인됨': { bg: STATUS_PURPLE_BG, color: STATUS_PURPLE_TEXT },
  '연락중': { bg: STATUS_GOLD_BG, color: STATUS_GOLD_TEXT },
  '확정':   { bg: STATUS_INFO_BG, color: STATUS_INFO_DARK },
  '완료':   { bg: GRAY_100, color: TEXT_TERTIARY },
  '불발':   { bg: GRAY_100, color: TEXT_TERTIARY },
};

// 상담 카드. 상태 전환은 두 가지뿐이다 — '확인하기'(신청됨→확인됨), '불발 처리'(열린 상담 닫기).
// '완료'는 버튼이 없다: 학생을 등록하면 전화번호로 자동 연결되며 완료로 바뀐다(api/consults.js).
function ConsultCard({ consult: c, studentName, onConfirm, onClose, busy }) {
  const style = STATUS_STYLE[c.status] ?? STATUS_STYLE['완료'];
  const isPending = c.status === '신청됨';
  const isOpen = !c.studentId && ['확인됨', '연락중', '확정'].includes(c.status);
  const faded = !!c.studentId || c.status === '완료' || c.status === '불발';

  return (
    <Card className="rounded-2xl" style={{ opacity: faded ? 0.7 : 1 }}>
      <CardContent className="p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <span className="text-base font-semibold text-gray-900">{c.name}</span>
          <span className="ml-2 text-sm text-gray-500">{c.phone}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {c.studentId && (
            <Link
              to={`/students/${c.studentId}`}
              className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: STATUS_SUCCESS_BG, color: STATUS_SUCCESS_DARK, textDecoration: 'none' }}
            >
              학생 연결됨{studentName ? ` · ${studentName}` : ''}
            </Link>
          )}
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: style.bg, color: style.color }}
          >
            {c.status}
          </span>
        </div>
      </div>

      <div className="space-y-0.5 text-sm text-gray-600">
        {c.level && <p><span className="text-gray-400">수준</span><span className="ml-1.5">{c.level}</span></p>}
        {c.days.length > 0 && <p><span className="text-gray-400">희망 요일</span><span className="ml-1.5">{c.days.join(', ')}</span></p>}
        {c.time && <p><span className="text-gray-400">희망 시간</span><span className="ml-1.5">{c.time}</span></p>}
        {c.content && (
          <p className="text-xs text-gray-500 leading-relaxed whitespace-pre-wrap pt-1">{c.content}</p>
        )}
      </div>

      <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
        <span className="text-xs text-gray-400 tabular-nums">{formatKST(c.appliedAt)}</span>
        {isPending && (
          <Button size="sm" loading={busy} onClick={() => onConfirm(c.id)} className="min-w-16">
            확인하기
          </Button>
        )}
        {isOpen && (
          <Button size="sm" variant="ghost" loading={busy} onClick={() => onClose(c)} className="text-gray-500">
            불발 처리
          </Button>
        )}
      </div>
      </CardContent>
    </Card>
  );
}

const RECENT_DAYS = 30;

export default function ConsultManagePage() {
  const { studentNameMap } = useData();
  // 상담 신청 목록 캐시(기억+갱신). 상태 변경 후 refresh()로 즉시 최신화.
  const consultsRes = useCachedResource('consult:all:v2', async () => {
    const results = await queryAll(
      CONSULT_DB,
      undefined,
      [{ timestamp: 'created_time', direction: 'descending' }],
    );
    return results.map(parseConsult);
  });
  const consults = consultsRes.data ?? [];
  const loading = consultsRes.loading;
  const [busyId, setBusyId] = useState(null);
  const [closing, setClosing] = useState(null); // 불발 처리 확인 대상

  const run = async (id, fn, failMsg) => {
    setBusyId(id);
    try {
      await fn();
      await consultsRes.refresh();
    } catch (e) {
      toast.error(`${failMsg}: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };
  const handleConfirm = (id) => run(id, () => acknowledgeConsult(id), '처리 실패');
  const handleClose = async () => {
    const c = closing;
    setClosing(null);
    await run(c.id, () => closeConsult(c.id), '불발 처리 실패');
  };

  const recentCutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
  const pending = consults.filter((c) => c.status === '신청됨');
  // 열린 상담 = 학생 연결 전이고 아직 닫지 않은 것. 오래됐어도 보인다 — 닫아야 목록에서 빠진다.
  const open = consults.filter((c) => !c.studentId && ['확인됨', '연락중', '확정'].includes(c.status));
  const closed = consults.filter((c) => (c.studentId || c.status === '완료' || c.status === '불발')
    && new Date(c.appliedAt).getTime() > recentCutoff);

  const section = (title, list, extraClass = '') => list.length > 0 && (
    <section className={extraClass}>
      <SectionHeading style={{ marginBottom: 12 }}>{title}</SectionHeading>
      <ul className="space-y-3">
        {list.map((c) => (
          <li key={c.id}>
            <ConsultCard
              consult={c}
              studentName={c.studentId ? studentNameMap[c.studentId] : ''}
              onConfirm={handleConfirm}
              onClose={setClosing}
              busy={busyId === c.id}
            />
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <PullToRefresh onRefresh={consultsRes.refresh}>
      <PageHeader title="무료상담 신청" back />
      <div className="px-4 pt-4 pb-24">
        {loading ? (
          <LoadingSpinner />
        ) : consults.length === 0 ? (
          <EmptyState icon={<ClipboardTextIcon size={44} weight="thin" style={{ color: BORDER_NEUTRAL }} />} title="아직 무료상담 신청이 없습니다" />
        ) : (
          <>
            {section(<>미확인&nbsp;<span className="tabular-nums" style={{ color: STATUS_ERROR_TEXT }}>{pending.length}</span>건</>, pending)}
            {section(<>진행 중&nbsp;<span className="tabular-nums">{open.length}</span>건</>, open, pending.length > 0 ? 'mt-6' : '')}
            {section(`최근 ${RECENT_DAYS}일 마감`, closed, (pending.length + open.length) > 0 ? 'mt-6' : '')}
            <p className="text-xs mt-6 text-center" style={{ color: TEXT_TERTIARY }}>
              학생을 등록하면 같은 전화번호의 상담이 자동으로 연결돼요
            </p>
          </>
        )}
      </div>
      {closing && (
        <ConfirmDialog
          title="불발로 처리하시겠습니까?"
          message={`${closing.name}님 상담을 닫습니다. 나중에 학생으로 등록하면 다시 연결됩니다.`}
          confirmLabel="불발 처리"
          cancelLabel="취소"
          danger={false}
          onConfirm={handleClose}
          onCancel={() => setClosing(null)}
        />
      )}
    </PullToRefresh>
  );
}
