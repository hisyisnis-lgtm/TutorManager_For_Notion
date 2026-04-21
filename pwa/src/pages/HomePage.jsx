import { useState, useEffect, useCallback, useRef } from 'react';
import { BellIcon, GearSixIcon, CalendarPlusIcon, ReceiptIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { Link, useNavigate } from 'react-router-dom';
import { Card } from 'antd';
import { useData } from '../context/DataContext.jsx';
import { queryPage } from '../api/notionClient.js';
import { CLASSES_DB, parseClass } from '../api/classes.js';
import { HOMEWORK_DB, parseHomework } from '../api/homework.js';
import { CONSULT_DB } from '../constants.js';
import { formatShort, formatDateTime, formatTime } from '../utils/dateUtils.js';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';
import MonthCalendar from '../components/ui/MonthCalendar.jsx';
import SectionHeading from '../components/ui/SectionHeading.jsx';
import {
  PRIMARY, PRIMARY_BG,
  TEXT_PRIMARY, TEXT_TERTIARY, TEXT_DISABLED,
  STATUS_ERROR_TEXT,
} from '../constants/theme.js';
import { BADGE_SMALL } from '../constants/styles.js';
import { getInstructorName, getNtfyTopic } from './SettingsPage.jsx';

const KST = 'Asia/Seoul';
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function getKSTToday() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parseInt(parts.find((p) => p.type === t)?.value ?? '0');
  return { year: get('year'), month: get('month') - 1, day: get('day') };
}

function getClassDay(isoString) {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST, day: 'numeric',
  }).formatToParts(new Date(isoString));
  return parseInt(parts.find((p) => p.type === 'day')?.value ?? '0');
}

export default function HomePage() {
  const navigate = useNavigate();
  const { studentNameMap, classTypeMap, refresh: refreshData } = useData();
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

  const [calYear, setCalYear] = useState(today.year);
  const [calMonth, setCalMonth] = useState(today.month); // 0-indexed
  const [calClasses, setCalClasses] = useState([]);
  const [calLoading, setCalLoading] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);

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
      setClasses((data?.results ?? []).map(parseClass));
    } catch (e) {
      console.error('[홈] 수업 불러오기 오류', e);
    } finally {
      setLoading(false);
    }
  };

  const loadCalendar = useCallback(async (year, month) => {
    setCalLoading(true);
    try {
      const mm = String(month + 1).padStart(2, '0');
      const dd = String(new Date(year, month + 1, 0).getDate()).padStart(2, '0');
      const data = await queryPage(
        CLASSES_DB,
        {
          and: [
            { property: '수업 일시', date: { on_or_after: `${year}-${mm}-01T00:00:00+09:00` } },
            { property: '수업 일시', date: { on_or_before: `${year}-${mm}-${dd}T23:59:59+09:00` } },
          ],
        },
        [{ property: '수업 일시', direction: 'ascending' }],
        undefined,
        100
      );
      setCalClasses((data?.results ?? []).map(parseClass));
    } catch {
      setCalClasses([]);
    } finally {
      setCalLoading(false);
    }
  }, []);

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

  useEffect(() => { loadUpcoming(); loadConsultCount(); loadSubmittedHomework(); loadTodayClasses(); }, []);
  useEffect(() => { loadCalendar(calYear, calMonth); }, [calYear, calMonth, loadCalendar]);

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
    await Promise.all([loadUpcoming(), loadCalendar(calYear, calMonth), loadConsultCount(), loadSubmittedHomework(), loadTodayClasses(), refreshData()]);
  };

  // 최근 완료된 수업 (오늘 종료된 수업) - 숙제 부여 카드용
  const nowKSTMs = Date.now() + 9 * 60 * 60 * 1000;
  const nowKSTStr = new Date(nowKSTMs).toISOString().slice(11, 16); // HH:MM
  const recentlyCompleted = todayClasses.filter((cls) => {
    if (!cls.endTime) return false;
    return cls.endTime <= nowKSTStr;
  });

  // 날짜별 수업 집계
  const classCountMap = {};
  calClasses.forEach((cls) => {
    if (cls.datetime) {
      const day = getClassDay(cls.datetime);
      classCountMap[day] = (classCountMap[day] || 0) + 1;
    }
  });

  // 선택된 날의 수업 목록
  const selectedDayClasses = selectedDay
    ? calClasses.filter((cls) => cls.datetime && getClassDay(cls.datetime) === selectedDay)
    : [];

  // 캘린더 그리드
  const firstDow = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const cells = Array(firstDow).fill(null).concat(Array.from({ length: daysInMonth }, (_, i) => i + 1));

  const prevMonth = () => {
    setSelectedDay(null);
    if (calMonth === 0) { setCalYear((y) => y - 1); setCalMonth(11); }
    else setCalMonth((m) => m - 1);
  };
  const nextMonth = () => {
    setSelectedDay(null);
    if (calMonth === 11) { setCalYear((y) => y + 1); setCalMonth(0); }
    else setCalMonth((m) => m + 1);
  };

  const handleDayClick = (day) => {
    if (!classCountMap[day]) return; // 수업 없는 날은 클릭 무시
    setSelectedDay((prev) => (prev === day ? null : day));
  };

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

      {/* 월별 캘린더 */}
      <div
        className="px-4 pt-4"
        style={{ animation: 'fade-in-up 400ms cubic-bezier(0.2, 0, 0, 1) both', animationDelay: '160ms' }}
      >
        <MonthCalendar
          year={calYear}
          month={calMonth + 1}
          todayStr={todayStr}
          classCountMap={classCountMap}
          selectedDay={selectedDay}
          onDayClick={handleDayClick}
          onPrevMonth={prevMonth}
          onNextMonth={nextMonth}
          loading={calLoading}
          onDeselect={() => setSelectedDay(null)}
          footer={selectedDay !== null && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-500 mb-2">
                {calMonth + 1}월 {selectedDay}일 수업
              </p>
              {selectedDayClasses.length === 0 ? (
                <p className="text-sm text-gray-400 py-1 text-center">수업 없음</p>
              ) : (
                <ul className="space-y-1.5">
                  {selectedDayClasses.map((cls) => {
                    const names = cls.studentIds
                      .map((id) => studentNameMap[id])
                      .filter(Boolean)
                      .join(', ');
                    const classType = classTypeMap[cls.classTypeId]?.classType ?? '';
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
                          className="flex items-center gap-3 px-3 py-2 rounded-xl bg-gray-50 active:bg-gray-100"
                        >
                          <span className="text-xs font-semibold text-brand-600 shrink-0">
                            {timeStr}{endTimeStr && `~${endTimeStr}`}
                          </span>
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-gray-800 truncate block">
                              {names || cls.title || '학생 미정'}
                            </span>
                            {(classType || cls.location) && (
                              <span className="text-xs text-gray-500">
                                {classType && `${classType} · `}{cls.duration}분
                                {cls.location && ` · ${cls.location}${cls.locationMemo ? ` — ${cls.locationMemo}` : ''}`}
                              </span>
                            )}
                          </div>
                          {cls.notes && (
                            <span className="text-xs text-gray-500 shrink-0">{cls.notes}</span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        />
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

      {/* 숙제 부여 카드 */}
      {!todayLoading && recentlyCompleted.length > 0 && (
        <div
          className="px-4 pt-5"
          style={{ animation: 'fade-in-up 400ms cubic-bezier(0.2, 0, 0, 1) both', animationDelay: '120ms' }}
        >
          <SectionHeading style={{ marginBottom: 12 }}>숙제 부여</SectionHeading>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recentlyCompleted.slice(0, 3).map((cls) => {
              const names = cls.studentIds
                .map((id) => studentNameMap[id])
                .filter(Boolean)
                .map((n) => n.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/gu, '').trim())
                .join(', ');
              const timeStr = cls.datetime
                ? new Date(cls.datetime).toLocaleTimeString('ko-KR', { timeZone: KST, hour: '2-digit', minute: '2-digit', hour12: false })
                : '';
              const endTimeStr = cls.endTime ? formatTime(cls.endTime) : '';
              const hwLink = cls.studentIds.length === 1
                ? `/homework/new?studentId=${cls.studentIds[0]}`
                : '/homework/new';
              return (
                <div
                  key={cls.id}
                  style={{
                    borderRadius: 12, background: '#fff', boxShadow: 'var(--shadow-border)',
                    padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {names || cls.title || '학생 미정'}
                    </p>
                    <p style={{ fontSize: 12, color: TEXT_TERTIARY, margin: '2px 0 0' }} className="tabular-nums">
                      {timeStr}{endTimeStr && `–${endTimeStr}`} 수업 완료
                    </p>
                  </div>
                  <Link
                    to={hwLink}
                    className="active:scale-[0.96] transition-[scale,background-color] duration-150 ease-out"
                    style={{
                      flexShrink: 0, height: 44, padding: '0 14px', borderRadius: 10,
                      background: PRIMARY_BG, color: PRIMARY,
                      fontSize: 13, fontWeight: 700,
                      display: 'flex', alignItems: 'center',
                      border: 'none', textDecoration: 'none',
                    }}
                  >
                    숙제 부여
                  </Link>
                </div>
              );
            })}
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
                      styles={{ body: { padding: '12px 16px' } }}
                      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-border-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-border)'; }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {/* 시간 박스 */}
                        <div style={{ flexShrink: 0, minWidth: 48, textAlign: 'center', background: PRIMARY_BG, borderRadius: 10, padding: '6px 4px' }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: PRIMARY, lineHeight: 1.2 }} className="tabular-nums">
                            {timeStr}
                          </div>
                          {endTimeStr && (
                            <div style={{ fontSize: 11, color: '#9a0007', marginTop: 1 }} className="tabular-nums">–{endTimeStr}</div>
                          )}
                        </div>
                        {/* 학생·수업 정보 */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 14, fontWeight: 600, color: TEXT_PRIMARY, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {title}
                          </p>
                          {(classType || cls.location) && (
                            <p style={{ fontSize: 12, color: TEXT_TERTIARY, margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {[classType, cls.location].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </div>
                        {/* 날짜 */}
                        <div style={{ flexShrink: 0, textAlign: 'right' }}>
                          <span style={{ fontSize: 12, color: TEXT_TERTIARY }} className="tabular-nums">{dateStr}</span>
                        </div>
                      </div>
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
