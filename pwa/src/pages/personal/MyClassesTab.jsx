import { useState } from 'react';
import { useCachedResource } from '../../hooks/useCachedResource.js';
import { fetchMyClasses } from '../../api/bookingApi.js';
import ClassCard, { LOCATION_LABEL } from './ClassCard.jsx';
import LoadingSpinner from '../../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../../components/ui/ErrorMessage.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import SectionHeading from '../../components/ui/SectionHeading.jsx';
import MonthCalendar from '../../components/ui/MonthCalendar.jsx';
import { addMonths, timeToMin } from '../../utils/dateUtils.js';
import { FOOTNOTE } from '../../constants/styles.js';
import { CalendarBlankIcon } from '@phosphor-icons/react';
import { BORDER_NEUTRAL } from '../../constants/theme.js';

// ===== 예약 현황 탭 =====
// 학생 자가예약은 2026-06-10에 폐기됐다 — 여기선 잡힌 수업을 월별로 확인만 한다.
// (내부 탭 key는 여전히 '내 수업'이지만 화면 라벨은 '예약 현황')
// 2026-08-31: 텍스트 월 네비 → 강사앱 수업 캘린더와 같은 MonthCalendar 재사용.
// 날짜 점으로 한 달이 한눈에 보이고, 날짜를 누르면 카드 안에서 그날 수업이 펼쳐진다.

function endTimeOf(c) {
  const end = timeToMin(c.startTime) + c.durationMin;
  return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}

export default function MyClassesTab({ studentToken, month, onMonthChange }) {
  // 수업 목록 캐시(토큰·월별) — 재방문 즉시 표시 + 백그라운드 갱신.
  const classesRes = useCachedResource(`student:classes:${studentToken}:${month}`, () => fetchMyClasses(studentToken, month));
  const classes = classesRes.data ?? [];
  const loading = classesRes.loading;
  const error = classesRes.error;

  const [selectedDay, setSelectedDay] = useState(null);

  const _nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = _nowKST.toISOString().slice(0, 10);
  const nowMin = _nowKST.getUTCHours() * 60 + _nowKST.getUTCMinutes();

  const calYear = parseInt(month.slice(0, 4), 10);
  const calMonth = parseInt(month.slice(5, 7), 10); // 1-indexed

  // 날짜별 수업 수(취소 제외) — 캘린더 점 표시용
  const classCountMap = {};
  for (const c of classes) {
    if (c.isCancelled) continue;
    const day = parseInt(c.date.slice(8, 10), 10);
    classCountMap[day] = (classCountMap[day] || 0) + 1;
  }

  const selectedDayClasses = selectedDay === null ? [] : classes
    .filter((c) => parseInt(c.date.slice(8, 10), 10) === selectedDay)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const changeMonth = (delta) => {
    setSelectedDay(null);
    onMonthChange(addMonths(month, delta));
  };

  const upcomingClasses = classes
    .filter(c => !c.isCancelled && c.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const pastClasses = classes
    .filter(c => c.isCancelled || c.date < todayStr)
    .sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));

  return (
    <div>
      {/* 월별 캘린더 — data-coach 앵커는 코치마크("버튼으로 월 이동") 타깃 유지용 */}
      <div data-coach="month-nav" className="px-4 pt-4">
        <MonthCalendar
          year={calYear}
          month={calMonth}
          todayStr={todayStr}
          classCountMap={classCountMap}
          selectedDay={selectedDay}
          onDayClick={(day) => setSelectedDay((prev) => (prev === day ? null : day))}
          onPrevMonth={() => changeMonth(-1)}
          onNextMonth={() => changeMonth(1)}
          loading={loading}
          onDeselect={() => setSelectedDay(null)}
          footer={selectedDay !== null && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-500 mb-2">
                {calMonth}월 {selectedDay}일 수업
              </p>
              {selectedDayClasses.length === 0 ? (
                <p className="text-sm text-gray-400 py-1 text-center">수업 없음</p>
              ) : (
                <ul className="space-y-1.5" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {selectedDayClasses.map((c) => (
                    <li key={c.id} className="tabular-nums flex items-center gap-2 text-sm">
                      <span className={`font-semibold ${c.isCancelled ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                        {c.startTime}–{endTimeOf(c)}
                      </span>
                      <span className="text-gray-400">
                        {LOCATION_LABEL[c.location] ?? c.location ?? ''}
                      </span>
                      {c.isCancelled && <span className="text-xs text-gray-400">취소</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        />
      </div>

      {error && <ErrorMessage message={error} onRetry={classesRes.refresh} />}
      {loading && classes.length === 0 && <LoadingSpinner />}
      {!loading && !error && classes.length === 0 && (
        <EmptyState icon={<CalendarBlankIcon size={44} weight="thin" style={{ color: BORDER_NEUTRAL }} />} title="이 달에 수업이 없어요" description="다른 달을 선택해 보세요" />
      )}

      {!error && classes.length > 0 && (
        <>
          {upcomingClasses.length > 0 && (
            <div style={{ padding: '16px 16px 0' }}>
              <SectionHeading>예정된 수업</SectionHeading>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {upcomingClasses.map(cls => (
                  <ClassCard key={cls.id} cls={cls} todayStr={todayStr} nowMin={nowMin} />
                ))}
              </div>
            </div>
          )}

          {pastClasses.length > 0 && (
            <div style={{ padding: '16px 16px 0' }}>
              <SectionHeading>지난 수업</SectionHeading>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pastClasses.map(cls => (
                  <ClassCard key={cls.id} cls={cls} todayStr={todayStr} nowMin={nowMin} />
                ))}
              </div>
            </div>
          )}

          <p style={{ ...FOOTNOTE, margin: '12px 16px 24px' }}>
            수업 변경·취소는 강사님께 문의해주세요
          </p>
        </>
      )}
    </div>
  );
}
