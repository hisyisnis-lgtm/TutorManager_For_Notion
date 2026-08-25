import { useCachedResource } from '../../hooks/useCachedResource.js';
import { fetchMyClasses } from '../../api/bookingApi.js';
import ClassCard from './ClassCard.jsx';
import LoadingSpinner from '../../components/ui/LoadingSpinner.jsx';
import ErrorMessage from '../../components/ui/ErrorMessage.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import SectionHeading from '../../components/ui/SectionHeading.jsx';
import { formatYearMonth, addMonths } from '../../utils/dateUtils.js';
import { FOOTNOTE } from '../../constants/styles.js';
import { CalendarBlankIcon } from '@phosphor-icons/react';
import { TEXT_PRIMARY, TEXT_SECONDARY, BORDER_SUBTLE, BORDER_NEUTRAL, GRAY_50 } from '../../constants/theme.js';

// ===== 예약 현황 탭 =====
// 학생 자가예약은 2026-06-10에 폐기됐다 — 여기선 잡힌 수업을 월별로 확인만 한다.
// (내부 탭 key는 여전히 '내 수업'이지만 화면 라벨은 '예약 현황')

export default function MyClassesTab({ studentToken, month, onMonthChange }) {
  // 수업 목록 캐시(토큰·월별) — 재방문 즉시 표시 + 백그라운드 갱신.
  const classesRes = useCachedResource(`student:classes:${studentToken}:${month}`, () => fetchMyClasses(studentToken, month));
  const classes = classesRes.data ?? [];
  const loading = classesRes.loading;
  const error = classesRes.error;

  const _nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = _nowKST.toISOString().slice(0, 10);
  const nowMin = _nowKST.getUTCHours() * 60 + _nowKST.getUTCMinutes();

  const upcomingClasses = classes
    .filter(c => !c.isCancelled && c.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const pastClasses = classes
    .filter(c => c.isCancelled || c.date < todayStr)
    .sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));

  return (
    <div>
      {/* 월 네비게이션 */}
      <div data-coach="month-nav" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: `1px solid ${BORDER_SUBTLE}`,
        backgroundColor: '#fff' }}>
        <button
          type="button"
          onClick={() => onMonthChange(addMonths(month, -1))}
          aria-label="이전 달"
          className="transition-[background-color] duration-150 ease-out"
          style={{
            width: 44, height: 44, borderRadius: 12,
            border: `1px solid ${BORDER_SUBTLE}`, background: GRAY_50, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, color: TEXT_SECONDARY }}
        >‹</button>
        <span
          style={{ fontSize: 16, fontWeight: 700, color: TEXT_PRIMARY }}
          aria-live="polite"
          aria-atomic="true"
        >
          {formatYearMonth(month)}
        </span>
        <button
          type="button"
          onClick={() => onMonthChange(addMonths(month, 1))}
          aria-label="다음 달"
          className="transition-[background-color] duration-150 ease-out"
          style={{
            width: 44, height: 44, borderRadius: 12,
            border: `1px solid ${BORDER_SUBTLE}`, background: GRAY_50, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, color: TEXT_SECONDARY }}
        >›</button>
      </div>

      {loading && <LoadingSpinner />}
      {error && <ErrorMessage message={error} onRetry={classesRes.refresh} />}
      {!loading && !error && classes.length === 0 && (
        <EmptyState icon={<CalendarBlankIcon size={44} weight="thin" style={{ color: BORDER_NEUTRAL }} />} title="이 달에 수업이 없어요" description="다른 달을 선택해 보세요" />
      )}

      {!loading && !error && classes.length > 0 && (
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
