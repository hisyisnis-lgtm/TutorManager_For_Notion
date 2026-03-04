import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../context/DataContext.jsx';
import { queryPage } from '../api/notionClient.js';
import { CLASSES_DB, parseClass } from '../api/classes.js';
import { formatShort } from '../utils/dateUtils.js';
import LoadingSpinner from '../components/ui/LoadingSpinner.jsx';
import PullToRefresh from '../components/ui/PullToRefresh.jsx';

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
  const { studentNameMap } = useData();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);

  const today = getKSTToday();
  const [calYear, setCalYear] = useState(today.year);
  const [calMonth, setCalMonth] = useState(today.month); // 0-indexed
  const [calClasses, setCalClasses] = useState([]);
  const [calLoading, setCalLoading] = useState(false);

  const loadUpcoming = async () => {
    setLoading(true);
    try {
      const data = await queryPage(
        CLASSES_DB,
        { property: '수업 일시', date: { on_or_after: new Date().toISOString() } },
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

  useEffect(() => { loadUpcoming(); }, []);
  useEffect(() => { loadCalendar(calYear, calMonth); }, [calYear, calMonth, loadCalendar]);

  const handleRefresh = async () => {
    await Promise.all([loadUpcoming(), loadCalendar(calYear, calMonth)]);
  };

  // 날짜별 수업 개수 집계
  const classCountMap = {};
  calClasses.forEach((cls) => {
    if (cls.datetime) {
      const day = getClassDay(cls.datetime);
      classCountMap[day] = (classCountMap[day] || 0) + 1;
    }
  });

  // 캘린더 그리드 셀 생성
  const firstDow = new Date(calYear, calMonth, 1).getDay(); // 0=일
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const cells = Array(firstDow).fill(null).concat(Array.from({ length: daysInMonth }, (_, i) => i + 1));

  const prevMonth = () => {
    if (calMonth === 0) { setCalYear((y) => y - 1); setCalMonth(11); }
    else setCalMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (calMonth === 11) { setCalYear((y) => y + 1); setCalMonth(0); }
    else setCalMonth((m) => m + 1);
  };

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div className="px-4 pt-8 pb-2">
        <h1 className="text-2xl font-bold text-gray-900">안녕하세요 '최하늘' 강사님</h1>
      </div>

      {/* 월별 캘린더 */}
      <div className="px-4 pt-4 pb-2">
        <div className="card p-4">
          {/* 헤더 */}
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={prevMonth}
              className="w-8 h-8 flex items-center justify-center rounded-lg active:bg-gray-100 text-gray-500 text-xl font-light"
            >
              ‹
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-800">
                {calYear}년 {calMonth + 1}월
              </span>
              {calLoading && (
                <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
              )}
            </div>
            <button
              onClick={nextMonth}
              className="w-8 h-8 flex items-center justify-center rounded-lg active:bg-gray-100 text-gray-500 text-xl font-light"
            >
              ›
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
              const count = classCountMap[day] || 0;
              const dow = (firstDow + day - 1) % 7;
              return (
                <div key={day} className="flex flex-col items-center h-9">
                  <span
                    className={`text-xs w-6 h-6 flex items-center justify-center rounded-full font-medium ${
                      isToday
                        ? 'bg-brand-600 text-white'
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
        </div>
      </div>

      {/* 다가오는 수업 */}
      <div className="px-4 pt-3 pb-24">
        <p className="text-xs font-semibold text-gray-400 tracking-wider mb-3">다가오는 수업</p>

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
                return (
                  <li key={cls.id}>
                    <Link
                      to="/classes"
                      className="card flex items-center justify-between px-4 py-2.5 active:bg-gray-50"
                    >
                      <span className="text-sm font-medium text-gray-800 truncate">{title}</span>
                      <span className="text-xs text-gray-400 ml-3 shrink-0">
                        {formatShort(cls.datetime)}
                      </span>
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
