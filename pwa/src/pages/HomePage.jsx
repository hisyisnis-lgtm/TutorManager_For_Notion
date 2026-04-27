import { useState, useEffect, useRef } from 'react';
import { BellIcon, GearSixIcon, CalendarPlusIcon, ReceiptIcon, UsersThreeIcon, CaretRightIcon, HourglassLowIcon } from '@phosphor-icons/react';
import { Link, useNavigate } from 'react-router-dom';
import { Card } from 'antd';
import { useData } from '../context/DataContext.jsx';
import { queryPage, getPage } from '../api/notionClient.js';
import { CLASSES_DB, parseClass } from '../api/classes.js';
import { HOMEWORK_DB, parseHomework } from '../api/homework.js';
import { PAYMENTS_DB, parsePayment } from '../api/payments.js';
import { parseLessonLog } from '../api/lessonLogs.js';
import { CONSULT_DB } from '../constants.js';
import { formatShort, formatDateTime, formatTime, formatKRW, getWeekStart } from '../utils/dateUtils.js';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';
import SectionHeading from '../components/ui/SectionHeading.jsx';
import PendingClassCard from '../components/home/PendingClassCard.jsx';
import { usePendingClassState } from '../hooks/usePendingClassState.js';
import {
  PRIMARY, PRIMARY_BG,
  TEXT_PRIMARY, TEXT_TERTIARY, TEXT_DISABLED,
  STATUS_ERROR_TEXT,
} from '../constants/theme.js';
import { BADGE_SMALL } from '../constants/styles.js';
import { getInstructorName, getNtfyTopic } from './SettingsPage.jsx';

const KST = 'Asia/Seoul';

function getKSTToday() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parseInt(parts.find((p) => p.type === t)?.value ?? '0');
  return { year: get('year'), month: get('month') - 1, day: get('day') };
}

export default function HomePage() {
  const navigate = useNavigate();
  const { studentNameMap, classTypeMap, students, refresh: refreshData } = useData();
  // 잔여 회차 ≤ 1인 학생 수 — DataContext의 students에서 직접 derive (별도 fetch 불필요)
  const lowSessionCount = students.filter((s) => (s.remainingSessions ?? 0) <= 1).length;
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [consultCount, setConsultCount] = useState(0);
  const [submittedHomework, setSubmittedHomework] = useState([]);
  const [todayClasses, setTodayClasses] = useState([]);
  const [todayLoading, setTodayLoading] = useState(true);
  const [instructorName, setInstructorName] = useState(getInstructorName);

  // 피드백 대기 숙제 가로 스크롤 러버밴드
  const hwScrollRef = useRef(null);
  const hwInnerRef = useRef(null);

  useEffect(() => {
    const el = hwScrollRef.current;
    const inner = hwInnerRef.current;
    if (!el || !inner) return;

    let startX = 0;

    const onStart = (e) => {
      e.stopPropagation(); // document 레벨 PullToRefresh 차단
      startX = e.touches[0].clientX;
      inner.style.transition = 'none';
    };
    const onMove = (e) => {
      e.stopPropagation();
      const dx = e.touches[0].clientX - startX;
      const maxScroll = el.scrollWidth - el.clientWidth;
      let bounce = 0;
      if (el.scrollLeft <= 0 && dx > 0) {
        bounce = Math.min(dx * 0.3, 28);
      } else if (el.scrollLeft >= maxScroll - 1 && dx < 0) {
        bounce = Math.max(dx * 0.3, -28);
      }
      inner.style.transform = bounce !== 0 ? `translateX(${bounce}px)` : '';
    };
    const onEnd = () => {
      inner.style.transition = 'transform 0.45s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      inner.style.transform = '';
      setTimeout(() => { inner.style.transition = 'none'; }, 500);
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const today = getKSTToday();
  const pad = n => String(n).padStart(2, '0');
  const todayStr = `${today.year}-${pad(today.month + 1)}-${pad(today.day)}`;
  const [unreadCount, setUnreadCount] = useState(() => {
    try {
      const notifications = JSON.parse(localStorage.getItem('ntfy_notifications') || '[]');
      const lastRead = parseInt(localStorage.getItem('ntfy_last_read') || '0', 10);
      return notifications.filter((n) => n.time > lastRead).length;
    } catch {
      return 0;
    }
  });

  const { state: pendingState, setHwDone, setDismissed } = usePendingClassState();

  const [weekClasses, setWeekClasses] = useState([]);
  const [weekPayments, setWeekPayments] = useState([]);
  const [weekLoading, setWeekLoading] = useState(true);
  const [upcomingPrep, setUpcomingPrep] = useState(null);

  const loadUpcoming = async () => {
    setLoading(true);
    try {
      const data = await queryPage(
        CLASSES_DB,
        {
          and: [
            { property: '수업 일시', date: { on_or_after: new Date().toISOString() } },
            { property: '특이사항', select: { does_not_equal: '🚫 취소' } },
          ],
        },
        [{ property: '수업 일시', direction: 'ascending' }],
        undefined,
        5
      );
      const list = (data?.results ?? []).map(parseClass);
      setClasses(list);
      loadUpcomingPrep(list[0]);
    } catch (e) {
      console.error('[홈] 수업 불러오기 오류', e);
    } finally {
      setLoading(false);
    }
  };

  const loadWeekSummary = async () => {
    setWeekLoading(true);
    try {
      const weekStart = getWeekStart();
      const [y, m, d] = weekStart.slice(0, 10).split('-').map(Number);
      const sun = new Date(y, m - 1, d + 6);
      const weekEnd = `${sun.getFullYear()}-${String(sun.getMonth() + 1).padStart(2, '0')}-${String(sun.getDate()).padStart(2, '0')}T23:59:59+09:00`;
      const [classData, paymentData] = await Promise.all([
        queryPage(
          CLASSES_DB,
          {
            and: [
              { property: '수업 일시', date: { on_or_after: weekStart } },
              { property: '수업 일시', date: { on_or_before: weekEnd } },
              { property: '특이사항', select: { does_not_equal: '🚫 취소' } },
            ],
          },
          undefined,
          undefined,
          100
        ),
        queryPage(
          PAYMENTS_DB,
          {
            and: [
              { property: '결제일', date: { on_or_after: weekStart } },
              { property: '결제일', date: { on_or_before: weekEnd } },
            ],
          },
          undefined,
          undefined,
          100
        ),
      ]);
      setWeekClasses((classData?.results ?? []).map(parseClass));
      setWeekPayments((paymentData?.results ?? []).map(parsePayment));
    } catch (e) {
      console.error('[홈] 이번 주 요약 오류', e);
    } finally {
      setWeekLoading(false);
    }
  };

  const loadUpcomingPrep = async (nextClass) => {
    if (!nextClass || !nextClass.studentIds?.length) { setUpcomingPrep(null); return; }
    try {
      const firstStudentId = nextClass.studentIds[0];
      const prevData = await queryPage(
        CLASSES_DB,
        {
          and: [
            { property: '학생', relation: { contains: firstStudentId } },
            { property: '수업 일시', date: { before: new Date().toISOString() } },
            { property: '수업 일지', relation: { is_not_empty: true } },
            { property: '특이사항', select: { does_not_equal: '🚫 취소' } },
          ],
        },
        [{ property: '수업 일시', direction: 'descending' }],
        undefined,
        1
      );
      const prevPage = (prevData?.results ?? [])[0];
      if (!prevPage) { setUpcomingPrep(null); return; }
      const prevClass = parseClass(prevPage);
      const logId = prevClass.lessonLogIds?.[0];
      if (!logId) { setUpcomingPrep(null); return; }
      const logPage = await getPage(logId);
      const log = parseLessonLog(logPage);
      const text = log.nextPrepare?.trim();
      if (!text) { setUpcomingPrep(null); return; }
      setUpcomingPrep({ classId: nextClass.id, logId, text });
    } catch (e) {
      console.error('[홈] 준비사항 로드 오류', e);
      setUpcomingPrep(null);
    }
  };

  const loadSubmittedHomework = async () => {
    try {
      const data = await queryPage(
        HOMEWORK_DB,
        { property: '제출 상태', select: { equals: '제출완료' } },
        [{ property: '제출일', direction: 'descending' }],
        undefined,
        20
      );
      setSubmittedHomework((data?.results ?? []).map(parseHomework));
    } catch (e) {
      console.error('[홈] 제출된 숙제 불러오기 오류', e);
    }
  };

  const loadConsultCount = async () => {
    try {
      const data = await queryPage(
        CONSULT_DB,
        { property: '상태', select: { equals: '신청됨' } },
        undefined,
        undefined,
        100
      );
      setConsultCount(data?.results?.length ?? 0);
    } catch (e) {
      console.error('[홈] 상담 수 불러오기 오류', e);
    }
  };

  const loadTodayClasses = async () => {
    setTodayLoading(true);
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
        20
      );
      setTodayClasses((data?.results ?? []).map(parseClass));
    } catch (e) {
      console.error('[홈] 오늘 수업 불러오기 오류', e);
    } finally {
      setTodayLoading(false);
    }
  };

  useEffect(() => {
    loadUpcoming();
    loadConsultCount();
    loadSubmittedHomework();
    loadTodayClasses();
    loadWeekSummary();
  }, []);

  // 설정/알림 페이지에서 돌아올 때 이름 및 뱃지 갱신 (마운트 시 1회)
  useEffect(() => {
    setInstructorName(getInstructorName());
    try {
      const notifications = JSON.parse(localStorage.getItem('ntfy_notifications') || '[]');
      const lastRead = parseInt(localStorage.getItem('ntfy_last_read') || '0', 10);
      setUnreadCount(notifications.filter((n) => n.time > lastRead).length);
    } catch {}
  }, []);

  const handleRefresh = async () => {
    // refreshData()가 students를 갱신 → lowSessionCount는 derive로 자동 재계산됨
    await Promise.all([
      loadUpcoming(),
      loadConsultCount(),
      loadSubmittedHomework(),
      loadTodayClasses(),
      loadWeekSummary(),
      refreshData(),
    ]);
  };

  // 최근 완료된 수업 (오늘 종료된 수업) - 수업 마무리 카드용
  const nowMs = Date.now();
  const recentlyCompleted = todayClasses.filter((cls) => {
    if (!cls.endTime) return false;
    if (new Date(cls.endTime).getTime() > nowMs) return false;
    const s = pendingState[cls.id] || {};
    if (s.dismissed) return false;
    const logDone = (cls.lessonLogIds?.length ?? 0) > 0;
    if (s.hwDone && logDone) return false;
    return true;
  });
  const visiblePending = recentlyCompleted.slice(0, 5);
  const overflowCount = Math.max(0, recentlyCompleted.length - 5);

  // 오늘 수업 요약
  const totalMinutes = todayClasses.reduce((sum, cls) => sum + (parseInt(cls.duration) || 0), 0);

  const QUICK_ACTIONS = [
    { label: '수업 추가', Icon: CalendarPlusIcon, path: '/classes/new' },
    { label: '결제 입력', Icon: ReceiptIcon, path: '/payments/new' },
    { label: '학생 관리', Icon: UsersThreeIcon, path: '/students' },
  ];

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      {/* 헤더 */}
      <div className="px-4 pt-8 pb-2 flex items-start justify-between">
        <h1 className="text-2xl font-bold text-gray-900">
          안녕하세요<br />
          <span className="text-brand-600">{instructorName}</span> 강사님
        </h1>
        <div className="flex items-center gap-0.5">
        {/* 알림 버튼 */}
        <button
          onClick={() => { setUnreadCount(0); navigate('/notifications'); }}
          className="p-2 relative text-gray-400 active:text-gray-600 active:scale-[0.96] transition-[scale,color] duration-150 ease-out"
          aria-label="알림"
        >
          <BellIcon weight="fill" size={24} />
          {unreadCount > 0 && (
            <span
              className="absolute top-1.5 right-1.5 min-w-[14px] h-3.5 px-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none tabular-nums"
              style={{ animation: 'badge-in 300ms cubic-bezier(0.2, 0, 0, 1) both' }}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
        {/* 설정 버튼 */}
        <button
          onClick={() => navigate('/settings')}
          className="p-2 -mr-1 text-gray-400 active:text-gray-600 active:scale-[0.96] transition-[scale,color] duration-150 ease-out"
          aria-label="설정"
        >
          <GearSixIcon weight="fill" size={24} />
        </button>
        </div>
      </div>

      {/* 빠른 실행 */}
      <div
        className="px-4 pt-4 pb-1 flex gap-2"
        style={{ animation: 'fade-in-up 400ms cubic-bezier(0.2, 0, 0, 1) both', animationDelay: '0ms' }}
      >
        {QUICK_ACTIONS.map(({ label, Icon, path }) => (
          <button
            key={path}
            type="button"
            onClick={() => navigate(path)}
            className="flex-1 flex flex-col items-center gap-1.5 py-3 rounded-2xl bg-white active:bg-gray-50 active:scale-[0.96] transition-[scale,background-color] duration-150 ease-out"
            style={{ boxShadow: 'var(--shadow-border)' }}
          >
            <Icon size={22} weight="fill" color={PRIMARY} />
            <span className="text-xs font-medium text-gray-600">{label}</span>
          </button>
        ))}
      </div>

      {/* 이번 주 요약 */}
      <div
        className="px-4 pt-3"
        style={{ animation: 'fade-in-up 400ms cubic-bezier(0.2, 0, 0, 1) both', animationDelay: '40ms' }}
      >
        <Card
          variant="borderless"
          style={{ borderRadius: 12, boxShadow: 'var(--shadow-border)' }}
          styles={{ body: { padding: '14px 16px' } }}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-800">이번 주 수업</span>
            {weekLoading ? (
              <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
            ) : (
              <span className="tabular-nums" style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY }}>
                {weekClasses.length}회
                <span style={{ color: TEXT_TERTIARY, fontWeight: 400, marginLeft: 6 }}>
                  · {weekClasses.reduce((s, c) => s + (parseInt(c.duration) || 0), 0)}분
                </span>
              </span>
            )}
          </div>
          <div className="flex items-center justify-between" style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f5f5f5' }}>
            <span className="text-sm" style={{ color: TEXT_TERTIARY }}>결제 수입</span>
            <span className="tabular-nums" style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY }}>
              {formatKRW(weekPayments.reduce((s, p) => s + (p.actualAmount || 0), 0))}
            </span>
          </div>
        </Card>
      </div>

      {/* 오늘 수업 요약 */}
      <div
        className="px-4 pt-3"
        style={{ animation: 'fade-in-up 400ms cubic-bezier(0.2, 0, 0, 1) both', animationDelay: '80ms' }}
      >
        <Card
          variant="borderless"
          style={{ borderRadius: 12, boxShadow: 'var(--shadow-border)' }}
          styles={{ body: { padding: '14px 16px' } }}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-800">오늘 수업</span>
            {todayLoading ? (
              <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
            ) : todayClasses.length > 0 ? (
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold tabular-nums" style={{ color: PRIMARY }}>
                  {todayClasses.length}개
                </span>
                <span className="text-gray-300">·</span>
                <span className="text-xs tabular-nums text-gray-400">총 {totalMinutes}분</span>
              </div>
            ) : (
              <span className="text-xs text-gray-400">없음</span>
            )}
          </div>
          {!todayLoading && todayClasses.length > 0 && (
            <ul className="mt-2.5 space-y-1">
              {todayClasses.map((cls) => {
                const names = cls.studentIds
                  .map((id) => studentNameMap[id])
                  .filter(Boolean)
                  .map((n) => n.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/gu, '').trim())
                  .join(', ');
                const timeStr = cls.datetime
                  ? new Date(cls.datetime).toLocaleTimeString('ko-KR', {
                      timeZone: KST, hour: '2-digit', minute: '2-digit', hour12: false,
                    })
                  : '';
                const endTimeStr = cls.endTime ? formatTime(cls.endTime) : '';
                return (
                  <li key={cls.id}>
                    <Link
                      to={`/classes/${cls.id}/edit`}
                      className="flex items-center gap-3 px-3 py-2 rounded-xl bg-gray-50 active:bg-gray-100 transition-[background-color] duration-150"
                    >
                      <span className="text-xs font-semibold tabular-nums shrink-0" style={{ color: PRIMARY }}>
                        {timeStr}{endTimeStr && `~${endTimeStr}`}
                      </span>
                      <span className="flex-1 text-sm font-medium text-gray-800 truncate">
                        {names || cls.title || '학생 미정'}
                      </span>
                      {cls.duration && (
                        <span className="text-xs tabular-nums text-gray-400 shrink-0">{cls.duration}분</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* 미확인 무료상담 신청 */}
      {consultCount > 0 && (
        <div
          className="px-4 pt-5"
          style={{ animation: 'fade-in-up 400ms cubic-bezier(0.2, 0, 0, 1) both', animationDelay: '80ms' }}
        >
          <Link
            to="/consult"
            className="block active:scale-[0.96] transition-[scale] duration-150 ease-out"
          >
            <Card
              variant="borderless"
              style={{ borderRadius: 16, backgroundColor: '#fff1f0', boxShadow: 'var(--shadow-danger-border)' }}
              styles={{ body: { padding: '12px 16px' } }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="text-lg">📩</span>
                  <span className="text-sm font-semibold tabular-nums" style={{ color: STATUS_ERROR_TEXT }}>
                    미확인 상담 신청 {consultCount}건
                  </span>
                </div>
                <span className="text-xs text-gray-400">확인하기 ›</span>
              </div>
            </Card>
          </Link>
        </div>
      )}

      {/* 잔여 회차 부족 학생 */}
      {lowSessionCount > 0 && (
        <div
          className="px-4 pt-3"
          style={{ animation: 'fade-in-up 400ms cubic-bezier(0.2, 0, 0, 1) both', animationDelay: '100ms' }}
        >
          <Link
            to="/students"
            className="block active:scale-[0.96] transition-[scale] duration-150 ease-out"
          >
            <Card
              variant="borderless"
              style={{ borderRadius: 16, backgroundColor: '#fff7e6', boxShadow: '0 0 0 1px #ffd591 inset' }}
              styles={{ body: { padding: '12px 16px' } }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HourglassLowIcon size={18} weight="fill" color="#d46b08" />
                  <span className="text-sm font-semibold tabular-nums" style={{ color: '#ad4e00' }}>
                    잔여 회차 부족 {lowSessionCount}명
                  </span>
                </div>
                <span className="text-xs text-gray-400">확인하기 ›</span>
              </div>
            </Card>
          </Link>
        </div>
      )}

      {/* 수업 마무리 */}
      {!todayLoading && recentlyCompleted.length > 0 && (
        <div
          className="px-4 pt-5"
          style={{ animation: 'fade-in-up 400ms cubic-bezier(0.2, 0, 0, 1) both', animationDelay: '120ms' }}
        >
          <SectionHeading style={{ marginBottom: 12 }}>수업 마무리</SectionHeading>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visiblePending.map((cls) => {
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
            {overflowCount > 0 && (
              <Link
                to="/home/pending"
                className="active:scale-[0.96] transition-[scale,background-color] duration-150 ease-out"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  height: 40, borderRadius: 10, background: '#fff',
                  boxShadow: 'var(--shadow-border)',
                  color: PRIMARY, fontSize: 13, fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                더보기 <span className="tabular-nums">+{overflowCount}</span>
                <CaretRightIcon size={14} weight="bold" />
              </Link>
            )}
          </div>
        </div>
      )}

      {/* 제출된 숙제 */}
      {submittedHomework.length > 0 && (
        <div
          className="pt-5"
          style={{ animation: 'fade-in-up 400ms cubic-bezier(0.2, 0, 0, 1) both', animationDelay: '160ms' }}
        >
          <SectionHeading style={{ marginBottom: 12, paddingLeft: 16, paddingRight: 16 }}>
            피드백 대기 숙제 <span className="tabular-nums" style={{ color: PRIMARY }}>{submittedHomework.length}</span>
          </SectionHeading>
          <div
            ref={hwScrollRef}
            className="hide-scrollbar"
            style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
          >
            <div ref={hwInnerRef} style={{
              display: 'inline-flex', gap: 10, padding: '4px 16px 8px 16px', verticalAlign: 'top',
            }}>
            {submittedHomework.map((hw) => {
              const studentName = hw.studentIds
                .map((id) => studentNameMap[id])
                .filter(Boolean)
                .join(', ')
                .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '')
                .trim();
              const submitDate = hw.submitDate
                ? new Date(hw.submitDate).toLocaleString('ko-KR', {
                    timeZone: KST, month: 'numeric', day: 'numeric',
                    hour: '2-digit', minute: '2-digit', hour12: false,
                  })
                : null;
              return (
                <Link
                  key={hw.id}
                  to={`/homework/${hw.id}`}
                  style={{ flexShrink: 0, textDecoration: 'none', display: 'block', transition: 'scale 150ms ease-out', }}
                  className="active:scale-[0.96]"
                >
                  <div style={{
                    width: 136, height: 136, borderRadius: 12, padding: 12,
                    background: '#fff', boxShadow: 'var(--shadow-border)',
                    display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                    boxSizing: 'border-box',
                  }}>
                    <div>
                      <p style={{ fontSize: 15, fontWeight: 700, color: PRIMARY, margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {studentName || '—'}
                      </p>
                      <p style={{ fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY, margin: 0, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {hw.title}
                      </p>
                    </div>
                    <div>
                      <span style={{ ...BADGE_SMALL, background: PRIMARY_BG, color: PRIMARY }}>
                        제출완료
                      </span>
                      {submitDate && (
                        <p style={{ fontSize: 11, color: TEXT_DISABLED, margin: '4px 0 0', fontVariantNumeric: 'tabular-nums' }}>{submitDate}</p>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
            </div>
          </div>
        </div>
      )}

      {/* 다가오는 수업 */}
      <div
        className="px-4 pt-5 pb-24"
        style={{ animation: 'fade-in-up 400ms cubic-bezier(0.2, 0, 0, 1) both', animationDelay: '240ms' }}
      >
        <SectionHeading style={{ marginBottom: 12 }}>다가오는 수업</SectionHeading>

        {loading ? (
          <LoadingSpinner />
        ) : classes.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">예정된 수업이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {classes.map((cls) => {
              const names = cls.studentIds
                .map((id) => studentNameMap[id])
                .filter(Boolean)
                .map((n) => n.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/gu, '').trim())
                .join(', ');
              const title = cls.title || names || '수업';
              const classType = classTypeMap[cls.classTypeId]?.classType ?? '';
              const timeStr = cls.datetime
                ? new Date(cls.datetime).toLocaleTimeString('ko-KR', { timeZone: KST, hour: '2-digit', minute: '2-digit', hour12: false })
                : '';
              const endTimeStr = cls.endTime ? formatTime(cls.endTime) : '';
              const dateStr = cls.datetime
                ? new Date(cls.datetime).toLocaleDateString('ko-KR', { timeZone: KST, month: 'numeric', day: 'numeric', weekday: 'short' })
                : '';
              return (
                <li key={cls.id}>
                  <Link
                    to={`/classes/${cls.id}/edit`}
                    className="block active:scale-[0.96] transition-[scale] duration-150 ease-out"
                  >
                    <Card
                      variant="borderless"
                      style={{ borderRadius: 12, boxShadow: 'var(--shadow-border)', transition: 'box-shadow 150ms ease-out' }}
                      styles={{ body: { padding: '14px 16px' } }}
                      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-border-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-border)'; }}
                    >
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                        <p style={{ fontSize: 15, fontWeight: 600, color: TEXT_PRIMARY, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                          {title}
                        </p>
                        <span style={{ fontSize: 13, color: TEXT_PRIMARY, fontWeight: 500, flexShrink: 0 }} className="tabular-nums">
                          {dateStr} {timeStr}{endTimeStr && `–${endTimeStr}`}
                        </span>
                      </div>
                      {(classType || cls.location) && (
                        <p style={{ fontSize: 12, color: TEXT_TERTIARY, margin: '4px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {[classType, cls.location].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {(() => {
                        const typeTitle = classTypeMap[cls.classTypeId]?.title ?? '';
                        const isFree = typeTitle.includes('무료상담');
                        const isOneDay = typeTitle.includes('원데이');
                        if (isFree || isOneDay) {
                          return (
                            <div style={{ marginTop: 8 }}>
                              <span style={{
                                display: 'inline-block',
                                padding: '2px 8px', borderRadius: 6,
                                background: '#f5f5f5',
                                color: TEXT_TERTIARY,
                                fontSize: 11, fontWeight: 600,
                              }}>
                                {isFree ? '무료상담' : '원데이클래스'}
                              </span>
                            </div>
                          );
                        }
                        if (classes[0]?.id === cls.id && upcomingPrep && cls.id === upcomingPrep.classId) {
                          return (
                            <div style={{
                              marginTop: 10, paddingTop: 10,
                              borderTop: '1px solid #f5f5f5',
                            }}>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                <span style={{ fontSize: 11, color: TEXT_TERTIARY, flexShrink: 0, lineHeight: 1.45, marginTop: 1 }}>
                                  준비
                                </span>
                                <span style={{ fontSize: 13, color: TEXT_PRIMARY, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                  {upcomingPrep.text}
                                </span>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </PullToRefresh>
  );
}
