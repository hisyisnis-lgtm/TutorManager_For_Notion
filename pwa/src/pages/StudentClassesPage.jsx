import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, message } from 'antd';
import { CalendarBlankIcon, CalendarPlusIcon } from '@phosphor-icons/react';
import PageHeader from '../components/layout/PageHeader.jsx';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../components/ui/ErrorMessage.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import ClassCard from '../components/classes/ClassCard.jsx';
import MonthRangeFilter, { yearsOf, filterByMonthRange } from '../components/ui/MonthRangeFilter.jsx';
import { getPage, deletePage } from '../api/notionClient.js';
import { parseStudent } from '../api/students.js';
import { fetchUpcomingClasses, fetchCompletedClasses, parseClass } from '../api/classes.js';
import { invalidateCache } from '../hooks/useCachedResource.js';
import { useData } from '../context/DataContext.jsx';
import { formatDateTime } from '../utils/dateUtils.js';
import { PRIMARY, TEXT_PRIMARY, TEXT_SECONDARY, BORDER_NEUTRAL, BG_APP, BG_CARD } from '../constants/theme.js';
import { ABOVE_BOTTOM_NAV, BELOW_PAGE_HEADER } from '../constants/styles.js';

const TABS = [
  { key: 'upcoming', label: '예정' },
  { key: 'completed', label: '완료' },
];

/** 자체 하단 고정 바 높이 — 목록 마지막 카드가 가리지 않게 paddingBottom에 더한다 */
const ACTION_BAR_H = 76;
/** 플로팅 '수업 추가' 버튼(원형 56px) + 위아래 여백까지 비워둘 스크롤 하단 여백 */
const FAB_CLEARANCE = 152;

/**
 * 학생별 수업 관리 — 한 학생의 예약된(예정) 수업을 모아 보고 탭해서 편집한다.
 * 학생 상세의 "수업 관리" 버튼으로 진입. 숙제의 StudentHomeworkPage와 같은 자리에 있는 화면.
 * 선택 삭제는 예정 탭에서만 — 완료 수업은 사용 시간 회차·정산 이력이라 여기서 지우게 하지 않는다.
 */
export default function StudentClassesPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { studentNameMap } = useData();

  const [student, setStudent] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [completed, setCompleted] = useState([]);
  const [tab, setTab] = useState('upcoming');
  // 날짜 필터 — "2026년 3월 ~ 2026년 8월" 범위. 값을 안 건드리면 데이터 전 구간이라
  // 기본이 곧 '전체'가 된다(별도 적용·해제 버튼 불필요 — 버튼·토글은 헤더 '선택'과 겹쳐 충돌했다).
  const [range, setRange] = useState({ sy: '', sm: '', ey: '', em: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 선택 삭제
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [studentPage, up, done] = await Promise.all([
        getPage(id),
        fetchUpcomingClasses(id),
        fetchCompletedClasses(id),
      ]);
      setStudent(parseStudent(studentPage));
      setUpcoming(up.map(parseClass));
      setCompleted(done.map(parseClass));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds([]);
  };

  const toggleSelect = (classId) => {
    setSelectedIds((prev) =>
      prev.includes(classId) ? prev.filter((x) => x !== classId) : [...prev, classId]
    );
  };

  const handleDelete = async () => {
    setDeleting(true);
    // 하나가 실패해도 나머지는 지운다. 성공분만 목록에서 빼야 화면과 Notion이 어긋나지 않는다.
    const results = await Promise.allSettled(selectedIds.map((cid) => deletePage(cid)));
    const deleted = selectedIds.filter((_, i) => results[i].status === 'fulfilled');
    const failed = selectedIds.length - deleted.length;

    if (deleted.length) {
      setUpcoming((prev) => prev.filter((c) => !deleted.includes(c.id)));
      // 수업 목록·캘린더 캐시와 학생 상세의 예약된 시간이 옛 값으로 남지 않게.
      invalidateCache('classes:');
      invalidateCache(`student:detail:v3:${id}`);
    }
    setDeleting(false);
    setShowDeleteConfirm(false);
    exitSelectMode();

    if (failed) message.error(`${deleted.length}개 삭제, ${failed}개 실패했어요. 실패한 수업은 다시 시도해주세요.`);
    else message.success(`수업 ${deleted.length}개를 삭제했어요.`);
  };

  if (loading) return <><PageHeader title="수업" back /><LoadingSpinner /></>;
  if (error) return <><PageHeader title="수업" back /><ErrorMessage message={error} onRetry={load} /></>;

  const tabList = tab === 'upcoming' ? upcoming : completed;

  // 날짜 범위 필터 — 계산은 공용 헬퍼가 맡는다(결제 목록과 같은 어법).
  const years = yearsOf(tabList.map((c) => c.datetime));
  const list = filterByMonthRange(tabList, (c) => c.datetime, range, years);

  const canSelect = tab === 'upcoming' && upcoming.length > 0;
  // 월 필터가 걸려 있으면 "전체 선택"은 화면에 보이는 것만 고른다 — 안 보이는 수업이
  // 조용히 선택돼 삭제되면 안 된다.
  const allSelected = list.length > 0 && list.every((c) => selectedIds.includes(c.id));
  const showActionBar = selectMode && selectedIds.length > 0;

  const selectedTitles = upcoming
    .filter((c) => selectedIds.includes(c.id))
    .map((c) => (c.datetime ? formatDateTime(c.datetime) : '일시 미정'))
    .join('\n');

  return (
    <>
      <PageHeader
        title={`${student?.name ?? ''} 수업`}
        back
        action={
          canSelect ? (
            /* 선택·수업추가는 "필요할 때 찾는" 보조 액션 — 색으로 강조하지 않는다.
               브랜드 채움은 이 화면에서 삭제 버튼 하나만 쓴다(액센트 예산) */
            <Button
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              style={{ borderRadius: 12, fontWeight: 600 }}
            >
              {selectMode ? '취소' : '선택'}
            </Button>
          ) : null
        }
      />

      {/* 선택 중에는 탭을 감춘다 — 예정 탭에서만 선택할 수 있어서 탭을 누르면 선택만 풀린다.
          헤더 아래 고정 자리는 탭 대신 이 줄이 물려받아, 긴 목록을 스크롤해도 선택 개수가 붙어 있다 */}
      {selectMode ? (
        <div
          className="px-4 pt-4 pb-3 flex items-center justify-between"
          style={{ position: 'sticky', top: BELOW_PAGE_HEADER, zIndex: 30, background: BG_APP }}
        >
          <span style={{ fontSize: 13, color: TEXT_SECONDARY }}>
            <span className="tabular-nums" style={{ fontWeight: 600, color: TEXT_PRIMARY }}>{selectedIds.length}</span>개 선택됨
          </span>
          <TextButton
            label={allSelected ? '전체 해제' : '전체 선택'}
            onClick={() => setSelectedIds(allSelected ? [] : list.map((c) => c.id))}
          />
        </div>
      ) : (
        <div
          className="flex gap-2 px-4 pt-4 pb-3"
          style={{ position: 'sticky', top: BELOW_PAGE_HEADER, zIndex: 30, background: BG_APP }}
        >
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setTab(key); setRange({ sy: '', sm: '', ey: '', em: '' }); }}
              className={`flex-1 py-3 rounded-full text-sm font-semibold transition-[background-color,color] duration-150 ease-out ${
                tab === key ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* 날짜 범위 필터 — 선택 중에는 목록이 바뀌면 혼란스러워 감춘다 */}
      {!selectMode && years.length > 0 && (
        <div className="px-4 pb-3">
          <MonthRangeFilter years={years} value={range} onChange={setRange} />
        </div>
      )}

      {list.length === 0 ? (
        <EmptyState
          icon={<CalendarBlankIcon size={44} weight="thin" style={{ color: BORDER_NEUTRAL }} />}
          title={tabList.length > 0
            ? '이 기간에는 수업이 없어요'
            : tab === 'upcoming' ? '예약된 수업이 없어요' : '완료된 수업이 없어요'}
          description={tabList.length === 0 && tab === 'upcoming' ? '오른쪽 아래 + 버튼으로 수업을 등록하세요.' : undefined}
        />
      ) : (
        <ul
          className="px-4 space-y-3"
          style={{
            // 고정 줄(zIndex 30·불투명)이 첫 카드의 브랜드 링·그림자를 덮어 "잘린" 것처럼 보였다.
            // 카드가 고정 줄의 페인트 영역 밖에서 시작하도록 목록 자체에 상단 여백을 준다.
            paddingTop: 8,
            paddingBottom: showActionBar ? 96 + ACTION_BAR_H : FAB_CLEARANCE,
          }}
        >
          {list.map((cls) => (
            <ClassCard
              key={cls.id}
              cls={cls}
              studentNameMap={studentNameMap}
              hideStudentName
              selectable={selectMode && tab === 'upcoming'}
              selected={selectedIds.includes(cls.id)}
              onSelect={toggleSelect}
            />
          ))}
        </ul>
      )}

      {/* 수업 추가 플로팅 버튼 — 선택 모드에선 삭제 바와 겹치므로 숨긴다 */}
      {!selectMode && (
        <div
          style={{
            position: 'fixed', right: 16,
            bottom: `calc(${ABOVE_BOTTOM_NAV} + 16px)`,
            zIndex: 40,
          }}
        >
          <Button
            type="primary"
            shape="circle"
            aria-label="수업 추가"
            onClick={() => navigate(`/classes/new?studentId=${id}`)}
            style={{
              width: 56, height: 56,
              boxShadow: 'var(--shadow-brand-button)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {/* 그냥 +는 speed-dial(누르면 버튼이 펼쳐지는) 것처럼 읽힌다 — 무엇이 추가되는지
                말해주는 아이콘으로. weight는 §19.3 기본값 fill */}
            <CalendarPlusIcon weight="fill" size={24} />
          </Button>
        </div>
      )}

      {/* 삭제 바 — 전역 BottomNav(zIndex 50) 바로 위. 오프셋은 ABOVE_BOTTOM_NAV 단일 출처 */}
      {showActionBar && (
        <div
          style={{
            position: 'fixed', left: 0, right: 0,
            bottom: ABOVE_BOTTOM_NAV,
            zIndex: 40,
            background: BG_CARD, boxShadow: 'var(--shadow-action-bar)',
            padding: '12px 16px calc(12px + env(safe-area-inset-bottom, 0px))',
          }}
        >
          <div style={{ maxWidth: 480, margin: '0 auto' }}>
            {/* 선택을 끝낸 뒤 유일하게 눌러야 할 버튼이라 채움으로 세운다.
                채움색은 PRIMARY — §16 단일 액센트 정책상 인터랙티브 면을 채우는 색은 이것뿐이다.
                (별도 danger 빨강을 새로 들이면 브랜드 예산 초과.) 파괴적이라는 신호는
                라벨과 확인창이 맡는다 */}
            <Button
              type="primary"
              block
              onClick={() => setShowDeleteConfirm(true)}
              style={{
                borderRadius: 12, height: 48, fontWeight: 700, fontSize: 15,
                boxShadow: 'var(--shadow-brand-button)',
              }}
            >
              {selectedIds.length}개 삭제
            </Button>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <ConfirmDialog
          title={`수업 ${selectedIds.length}개를 삭제하시겠습니까?`}
          message={`삭제한 수업은 복구할 수 없습니다.\n\n${selectedTitles}`}
          confirmLabel={`${selectedIds.length}개 삭제`}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
          loading={deleting}
        />
      )}
    </>
  );
}

/** 컨트롤 줄의 텍스트 버튼 — 테두리 없는 iOS 스타일 (히트영역은 .hit-40이 보장) */
function TextButton({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hit-40"
      style={{
        border: 'none', background: 'none', cursor: 'pointer', padding: 0,
        fontSize: 13, fontWeight: 600,
        color: PRIMARY,
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {label}
    </button>
  );
}
