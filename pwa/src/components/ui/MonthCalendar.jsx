import { useRef, useEffect } from 'react';
import { Card } from 'antd';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const pad = n => String(n).padStart(2, '0');

/**
 * 공통 월별 캘린더 컴포넌트
 *
 * Props:
 *   year        {number}  연도
 *   month       {number}  월 (1-indexed)
 *   todayStr    {string}  오늘 날짜 'YYYY-MM-DD'
 *   classCountMap {object} { [day: number]: count } — 수업 있는 날
 *   selectedDay {number|null}
 *   onDayClick  {(day: number) => void}
 *   onPrevMonth {() => void}
 *   onNextMonth {() => void}
 *   loading     {boolean}
 *   footer      {ReactNode}  캘린더 카드 내부 하단 슬롯 (드릴다운 등)
 *   onDeselect  {() => void} 카드 외부 클릭 시 선택 해제 콜백
 */
export default function MonthCalendar({
  year,
  month,
  todayStr,
  classCountMap = {},
  selectedDay,
  onDayClick,
  onPrevMonth,
  onNextMonth,
  loading = false,
  footer,
  onDeselect,
}) {
  const containerRef = useRef(null);

  // 카드 외부 클릭 시 선택 해제
  // click 이벤트는 브라우저가 스크롤 후 자동으로 억제하므로 스크롤과 구분됨
  useEffect(() => {
    if (selectedDay === null || !onDeselect) return;

    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        onDeselect();
      }
    };

    // setTimeout으로 현재 이벤트 루프 이후에 등록 (날짜 클릭 자체가 즉시 해제되는 것 방지)
    const id = setTimeout(() => {
      document.addEventListener('click', handleClick);
    }, 0);

    return () => {
      clearTimeout(id);
      document.removeEventListener('click', handleClick);
    };
  }, [selectedDay, onDeselect]);

  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells = Array(firstDow).fill(null).concat(
    Array.from({ length: daysInMonth }, (_, i) => i + 1)
  );

  return (
    <div ref={containerRef}>
    <Card
      variant="borderless"
      style={{ borderRadius: 16, boxShadow: 'var(--shadow-card)' }}
      styles={{ body: { padding: 16 } }}
      onClick={() => onDeselect?.()}
    >
      {/* 월 네비게이션 */}
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={onPrevMonth}
          aria-label="이전 달"
          className="w-10 h-10 flex items-center justify-center rounded-lg active:bg-gray-100 text-gray-500 text-xl font-light"
        >
          <span aria-hidden="true">‹</span>
        </button>
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-semibold tabular-nums text-gray-800"
            aria-live="polite"
            aria-atomic="true"
          >
            {year}년 {month}월
          </span>
          {loading && (
            <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" aria-hidden="true" />
          )}
        </div>
        <button
          type="button"
          onClick={onNextMonth}
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
          if (!day) return <div key={`e-${i}`} className="h-11" />;
          const dateStr = `${year}-${pad(month)}-${pad(day)}`;
          const dow = (firstDow + day - 1) % 7;
          const isToday = dateStr === todayStr;
          const isPast = dateStr < todayStr;
          const isSelected = selectedDay === day;
          const count = classCountMap[day] || 0;
          const hasClass = count > 0;

          return (
            <div
              key={day}
              role={hasClass ? 'button' : undefined}
              tabIndex={hasClass ? 0 : undefined}
              aria-label={hasClass ? `${month}월 ${day}일, 수업 ${count}개` : undefined}
              aria-pressed={hasClass ? isSelected : undefined}
              onKeyDown={hasClass
                ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDayClick(day); } }
                : undefined}
              className={`flex flex-col items-center h-11 ${hasClass ? 'cursor-pointer' : ''}`}
              onClick={(e) => { if (hasClass) { e.stopPropagation(); onDayClick(day); } }}
            >
              <span
                className={`text-xs w-6 h-6 flex items-center justify-center rounded-full font-medium transition-colors ${
                  isSelected
                    ? 'bg-brand-600 text-white ring-2 ring-brand-300'
                    : isToday
                      ? 'bg-brand-600 text-white'
                      : isPast && hasClass
                        ? 'bg-gray-100 text-gray-400'
                        : hasClass
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
              {hasClass && (
                <span
                  className={`text-[9px] font-bold leading-none mt-0.5 ${
                    isPast && !isSelected ? 'text-gray-400' : 'text-brand-500'
                  }`}
                >
                  {count}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* 드릴다운 슬롯 */}
      {footer}
    </Card>
    </div>
  );
}
