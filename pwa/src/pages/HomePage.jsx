import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card } from 'antd';
import { useData } from '../context/DataContext.jsx';
import { queryPage } from '../api/notionClient.js';
import { CLASSES_DB, parseClass } from '../api/classes.js';
import { CONSULT_DB } from './ConsultManagePage.jsx';
import { formatShort, formatDateTime, formatTime } from '../utils/dateUtils.js';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';
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
  const [instructorName, setInstructorName] = useState(getInstructorName);

  const today = getKSTToday();
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
    } catch {
      // silent
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
    } catch {
      // silent
    }
  };

  useEffect(() => { loadUpcoming(); loadConsultCount(); }, []);
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
    await Promise.all([loadUpcoming(), loadCalendar(calYear, calMonth), loadConsultCount(), refreshData()]);
  };

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
          className="p-2 relative text-gray-400 active:text-gray-600"
          aria-label="알림"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 min-w-[14px] h-3.5 px-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
        {/* 설정 버튼 */}
        <button
          onClick={() => navigate('/settings')}
          className="p-2 -mr-1 text-gray-400 active:text-gray-600"
          aria-label="설정"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
        </div>
      </div>

      {/* 월별 캘린더 */}
      <div className="px-4 pt-4 pb-2">
        <Card variant="borderless" style={{ borderRadius: 16, boxShadow: 'var(--shadow-card)' }} styles={{ body: { padding: 16 } }}>
          {/* 헤더 */}
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={prevMonth}
              aria-label="이전 달"
              className="w-10 h-10 flex items-center justify-center rounded-lg active:bg-gray-100 text-gray-500 text-xl font-light"
            >
              <span aria-hidden="true">‹</span>
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tabular-nums text-gray-800" aria-live="polite" aria-atomic="true">
                {calYear}년 {calMonth + 1}월
              </span>
              {calLoading && (
                <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" aria-hidden="true" />
              )}
            </div>
            <button
              onClick={nextMonth}
              aria-label="다음 달"
              className="w-10 h-10 flex items-center justify-center rounded-lg active:bg-gray-100 text-gray-500 text-xl font-light"
            >
              <span aria-hidden="true">›</span>
            </button>
          </div>

          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map((w, i) => (
              <div
                key={w}
                className={`text-center text-xs font-medium py-1 ${
                  i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'
                }`}
              >
                {w}
              </div>
            ))}
          </div>

          {/* 날짜 그리드 */}
          <div className="grid grid-cols-7">
            {cells.map((day, i) => {
              if (!day) return <div key={`e-${i}`} className="h-9" />;
              const isToday = calYear === today.year && calMonth === today.month && day === today.day;
              const isSelected = selectedDay === day;
              const count = classCountMap[day] || 0;
              const dow = (firstDow + day - 1) % 7;
              const hasClass = count > 0;
              return (
                <div
                  key={day}
                  role={hasClass ? 'button' : undefined}
                  tabIndex={hasClass ? 0 : undefined}
                  aria-label={hasClass ? `${calMonth + 1}월 ${day}일, 수업 ${count}개` : undefined}
                  aria-pressed={hasClass ? isSelected : undefined}
                  onKeyDown={hasClass ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleDayClick(day); } } : undefined}
                  className={`flex flex-col items-center h-11 ${hasClass ? 'cursor-pointer' : ''}`}
                  onClick={() => handleDayClick(day)}
                >
                  <span
                    className={`text-xs w-6 h-6 flex items-center justify-center rounded-full font-medium transition-colors ${
                      isSelected
                        ? 'bg-brand-600 text-white ring-2 ring-brand-300'
                        : isToday
                        ? 'bg-brand-600 text-white'
                        : count > 0
                        ? 'bg-green-100 text-green-700'
                        : dow === 0
                        ? 'text-red-400'
                        : dow === 6
                        ? 'text-blue-400'
                        : 'text-gray-700'
                    }`}
                  >
                    {day}
                  </span>
                  {count > 0 && (
                    <span className="text-[9px] font-bold text-brand-500 leading-none mt-0.5">
                      {count}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* 선택된 날 수업 드릴다운 */}
          {selectedDay !== null && (
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
                                {cls.location && ` · 📍${cls.location}${cls.locationMemo ? ` — ${cls.locationMemo}` : ''}`}
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
        </Card>
      </div>

      {/* 미확인 무료상담 신청 */}
      {consultCount > 0 && (
        <div className="px-4 pt-3">
          <Link to="/consult">
            <Card
              variant="borderless"
              hoverable
              style={{ borderRadius: 16, backgroundColor: '#fff1f0', boxShadow: '0px 0px 0px 1px #ffccc7, 0px 2px 8px rgba(207,19,34,0.06)' }}
              styles={{ body: { padding: '12px 16px' } }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="text-lg">📩</span>
                  <span className="text-sm font-semibold" style={{ color: '#cf1322' }}>
                    미확인 상담 신청 {consultCount}건
                  </span>
                </div>
                <span className="text-xs text-gray-400">확인하기 ›</span>
              </div>
            </Card>
          </Link>
        </div>
      )}

      {/* 다가오는 수업 */}
      <div className="px-4 pt-3 pb-24">
        <p className="text-xs font-semibold text-gray-500 tracking-wider mb-3">다가오는 수업</p>

        {loading ? (
          <LoadingSpinner />
        ) : classes.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">예정된 수업이 없습니다.</p>
        ) : (
          <>
            <ul className="space-y-2">
              {classes.map((cls) => {
                const names = cls.studentIds
                  .map((id) => studentNameMap[id])
                  .filter(Boolean)
                  .join(', ');
                const title = cls.title || names || '수업';
                const classType = classTypeMap[cls.classTypeId]?.classType ?? '';
                return (
                  <li key={cls.id}>
                    <Link to={`/classes/${cls.id}/edit`}>
                      <Card
                        variant="borderless"
                        style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)', transition: 'box-shadow 150ms ease-out' }}
                        styles={{ body: { padding: '10px 16px' } }}
                        hoverable
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-gray-800 truncate block">{title}</span>
                            {(classType || cls.location) && (
                              <span className="text-xs text-gray-500">
                                {[classType, cls.location && `📍${cls.location}${cls.locationMemo ? ` — ${cls.locationMemo}` : ''}`].filter(Boolean).join(' · ')}
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-gray-500 ml-3 shrink-0">
                            {formatShort(cls.datetime)}{cls.endTime && `~${formatTime(cls.endTime)}`}
                          </span>
                        </div>
                      </Card>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-col items-center gap-1.5 pt-3 pb-1">
              <span className="w-1 h-1 rounded-full bg-gray-300" />
              <span className="w-1 h-1 rounded-full bg-gray-300" />
              <span className="w-1 h-1 rounded-full bg-gray-300" />
            </div>
          </>
        )}
      </div>
    </PullToRefresh>
  );
}
