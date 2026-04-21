import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { usePullToRefresh, PullIndicator } from '../hooks/usePullToRefresh.jsx';
import {
  fetchStudentByToken,
  fetchAvailableSlots,
  fetchTimeSlots,
  reserveSlot,
  fetchMyClasses,
  cancelMyClass,
  restoreMyClass,
} from '../api/bookingApi.js';
import { Card, Button, Modal } from 'antd';
import { DAY_KR, formatDateMD, formatYearMonth, addMonths, timeToMin, formatDuration } from '../utils/dateUtils.js';
import {
  PRIMARY, PRIMARY_BG,
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_TERTIARY, TEXT_INACTIVE,
  STATUS_SUCCESS_DARK, STATUS_SUCCESS_BG,
  STATUS_ERROR_TEXT, STATUS_ERROR_BORDER,
  STATUS_INFO_DARK,
} from '../constants/theme.js';
import { BADGE_SMALL } from '../constants/styles.js';

const LOCATION_OPTIONS = ['강남사무실', '온라인 (Zoom/화상)'];

const ALL_TIME_SLOTS = (() => {
  const slots = [];
  // 08:00 ~ 21:00: 시작 시간 표시용 (22:00은 종료 시간으로만 사용)
  for (let m = 8 * 60; m <= 21 * 60; m += 30) {
    const h = String(Math.floor(m / 60)).padStart(2, '0');
    const min = String(m % 60).padStart(2, '0');
    slots.push(`${h}:${min}`);
  }
  return slots;
})();
const ALL_END_SLOTS = [...ALL_TIME_SLOTS, '22:00'];

// ===== 달력 컴포넌트 =====
function Calendar({ year, month, availableDates, selectedDate, onSelect }) {
  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();

  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const todayStr = `${nowKST.getUTCFullYear()}-${pad(nowKST.getUTCMonth() + 1)}-${pad(nowKST.getUTCDate())}`;
  const minDate = new Date(nowKST);
  minDate.setUTCDate(minDate.getUTCDate() + 2);
  const minDateStr = `${minDate.getUTCFullYear()}-${pad(minDate.getUTCMonth() + 1)}-${pad(minDate.getUTCDate())}`;

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= lastDate; d++) {
    const mm = String(month + 1).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    cells.push(`${year}-${mm}-${dd}`);
  }

  return (
    <div>
      <div className="grid grid-cols-7 mb-1">
        {['일', '월', '화', '수', '목', '금', '토'].map(d => (
          <div
            key={d}
            className={`text-center text-xs py-1.5 font-medium ${
              d === '일' ? 'text-red-400' : d === '토' ? 'text-blue-400' : 'text-gray-400'
            }`}
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((dateStr, i) => {
          if (!dateStr) return <div key={`e${i}`} />;
          const d = new Date(dateStr + 'T00:00:00+09:00');
          const dow = d.getDay();
          const disabled = dateStr < minDateStr || !availableDates.has(dateStr);
          const isSelected = selectedDate === dateStr;
          const isToday = dateStr === todayStr;

          return (
            <button
              key={dateStr}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(dateStr)}
              style={{ touchAction: 'manipulation' }}
              className={`relative flex items-center justify-center h-11 rounded-full text-sm font-medium transition-[scale,background-color,color] duration-150 ease-out ${!disabled ? 'active:scale-[0.96]' : ''} ${
                isSelected
                  ? 'bg-brand-600 text-white'
                  : disabled
                    ? 'text-gray-300 cursor-not-allowed'
                    : dow === 0
                      ? 'text-red-500 hover:bg-brand-50 cursor-pointer'
                      : dow === 6
                        ? 'text-blue-500 hover:bg-brand-50 cursor-pointer'
                        : 'text-gray-800 hover:bg-brand-50 cursor-pointer'
              }`}
            >
              {d.getDate()}
              {isToday && !isSelected && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-brand-400" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ===== 시간 범위 선택 컴포넌트 =====
function TimeRangePicker({ availableTimes, passableTimes, startTime, endTime, onStartSelect, onEndSelect }) {
  const availableSet = new Set(availableTimes);
  // passableSet: pre-buffer(classStart-60) 통과 허용, classStart-30에서 차단
  const passableSet = new Set(passableTimes ?? availableTimes);
  const startMin = startTime ? timeToMin(startTime) : null;

  const validEndTimes = (() => {
    if (startMin === null) return new Set();
    const valid = new Set();
    let prev = startMin;
    // ALL_END_SLOTS(~22:00)까지 순회하되, 탐색 가능 여부는 passableSet으로 확인
    for (const t of ALL_END_SLOTS) {
      const tm = timeToMin(t);
      if (tm <= startMin) continue;
      if (tm !== prev + 30) break;
      const ps = `${String(Math.floor(prev / 60)).padStart(2, '0')}:${String(prev % 60).padStart(2, '0')}`;
      if (!passableSet.has(ps)) break;
      if (tm - startMin >= 60) valid.add(t);
      prev = tm;
    }
    return valid;
  })();

  return (
    <div>
      <p className="text-xs text-gray-500 mb-2">시작 시간 선택</p>
      <div style={{ maxHeight: 152, overflowY: 'auto', WebkitOverflowScrolling: 'touch', marginBottom: 16 }}>
        <div className="flex flex-wrap gap-2 pb-0.5">
          {ALL_TIME_SLOTS.map(t => {
            const tm = timeToMin(t);
            const isSelected = t === startTime;
            const inRange = startMin !== null && endTime && tm >= startMin && tm < timeToMin(endTime);
            const canSelect = availableSet.has(t);
            return (
              <button
                key={t}
                type="button"
                disabled={!canSelect}
                onClick={() => canSelect && onStartSelect(t)}
                style={{ touchAction: 'manipulation' }}
                className={`px-3 py-2 rounded-lg text-sm font-medium border transition-[scale,background-color,color,border-color] duration-150 ease-out ${canSelect ? 'active:scale-[0.96]' : ''} ${
                  isSelected
                    ? 'bg-brand-600 text-white border-brand-600'
                    : inRange
                      ? 'bg-brand-50 text-brand-600 border-brand-100'
                      : canSelect
                        ? 'bg-white text-gray-700 border-gray-200 hover:border-brand-100'
                        : 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed line-through'
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>

      {startTime && (
        <>
          <p className="text-xs text-gray-500 mb-2">
            종료 시간 선택 <span className="text-gray-500">(최소 1시간 이상)</span>
          </p>
          <div style={{ maxHeight: 152, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <div className="flex flex-wrap gap-2 pb-0.5">
              {ALL_END_SLOTS
                .filter(t => timeToMin(t) > (startMin ?? 0))
                .map(t => {
                  const tm = timeToMin(t);
                  const duration = tm - (startMin ?? 0);
                  const canSelect = validEndTimes.has(t);
                  const isSelected = t === endTime;
                  return (
                    <button
                      key={t}
                      type="button"
                      disabled={!canSelect}
                      onClick={() => canSelect && onEndSelect(t)}
                      style={{ touchAction: 'manipulation' }}
                      className={`px-3 py-2 rounded-lg text-sm font-medium border transition-[scale,background-color,color,border-color] duration-150 ease-out ${canSelect ? 'active:scale-[0.96]' : ''} ${
                        isSelected
                          ? 'bg-brand-600 text-white border-brand-600'
                          : canSelect
                            ? 'bg-white text-gray-700 border-gray-200 hover:border-brand-100'
                            : 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed line-through'
                      }`}
                    >
                      {t}
                      {canSelect && (
                        <span className="text-xs ml-1 opacity-60">({formatDuration(duration)})</span>
                      )}
                    </button>
                  );
                })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ===== 내 수업 탭 =====
function MyClassesTab({ studentToken, month, onMonthChange, onStudentRefresh }) {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);
  const [restoringId, setRestoringId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMyClasses(studentToken, month);
      setClasses(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [studentToken, month]);

  useEffect(() => { load(); }, [load]);

  const _nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = _nowKST.toISOString().slice(0, 10);
  const nowMin = _nowKST.getUTCHours() * 60 + _nowKST.getUTCMinutes();

  const handleCancel = (cls) => {
    if (cancellingId || restoringId) return;
    Modal.confirm({
      title: '수업 취소',
      content: `${formatDateMD(cls.date)} ${cls.startTime} 수업을 취소하시겠습니까?`,
      okText: '취소하기',
      cancelText: '닫기',
      okButtonProps: { danger: true },
      onOk: async () => {
        setCancellingId(cls.id);
        try {
          await cancelMyClass(cls.id, studentToken);
          setClasses(prev => prev.map(c => c.id === cls.id ? { ...c, isCancelled: true } : c));
          onStudentRefresh?.();
        } catch (e) {
          Modal.error({ title: '오류', content: e.message });
        } finally {
          setCancellingId(null);
        }
      },
    });
  };

  const handleRestore = (cls) => {
    if (restoringId || cancellingId) return;
    Modal.confirm({
      title: '수업 복구',
      content: `${formatDateMD(cls.date)} ${cls.startTime} 수업을 복구하시겠습니까?`,
      okText: '복구하기',
      cancelText: '닫기',
      onOk: async () => {
        setRestoringId(cls.id);
        try {
          await restoreMyClass(cls.id, studentToken);
          setClasses(prev => prev.map(c => c.id === cls.id ? { ...c, isCancelled: false } : c));
          onStudentRefresh?.();
        } catch (e) {
          Modal.error({ title: '오류', content: e.message });
        } finally {
          setRestoringId(null);
        }
      },
    });
  };

  const LOCATION_LABEL = { '강남사무실': '강남', '온라인 (Zoom/화상)': 'Zoom' };

  return (
    <div>
      {/* 월 네비게이션 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.06)',
      }}>
        <button
          type="button"
          onClick={() => onMonthChange(addMonths(month, -1))}
          aria-label="이전 달"
          className="active:scale-[0.96]"
          style={{
            width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 10, border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 20, color: '#595959',
            transitionProperty: 'scale', transitionDuration: '150ms', transitionTimingFunction: 'ease-out',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#1d1d1f' }} aria-live="polite" aria-atomic="true">
          {formatYearMonth(month)}
        </span>
        <button
          type="button"
          onClick={() => onMonthChange(addMonths(month, 1))}
          aria-label="다음 달"
          className="active:scale-[0.96]"
          style={{
            width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 10, border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 20, color: '#595959',
            transitionProperty: 'scale', transitionDuration: '150ms', transitionTimingFunction: 'ease-out',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '48px 0', fontSize: 13, color: '#8c8c8c' }}>불러오는 중...</div>}
      {error && (
        <div style={{ margin: '16px', padding: '12px 16px', backgroundColor: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 12, fontSize: 14, color: '#cf1322' }}>
          {error}
        </div>
      )}
      {!loading && !error && classes.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 16px', color: '#8c8c8c', fontSize: 14 }}>
          이 달에 수업이 없어요
        </div>
      )}

      {!loading && !error && classes.length > 0 && (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {classes.map(cls => {
            const clsStartMin = timeToMin(cls.startTime);
            const clsEndMin = clsStartMin + cls.durationMin;
            const isOngoing = !cls.isCancelled && cls.date === todayStr && nowMin >= clsStartMin && nowMin < clsEndMin;
            const isPast = cls.date < todayStr;
            const canCancel = !cls.isCancelled && cls.date > todayStr;
            const canRestore = cls.isCancelled && cls.date > todayStr;
            const statusLabel = cls.isCancelled ? '취소' : isOngoing ? '수업중' : isPast ? '완료' : '예정';
            const statusBadgeStyle = cls.isCancelled
              ? { ...BADGE_SMALL, backgroundColor: '#f5f5f5', color: TEXT_INACTIVE }
              : isOngoing
                ? { ...BADGE_SMALL, backgroundColor: '#e6f4ff', color: STATUS_INFO_DARK }
                : isPast
                  ? { ...BADGE_SMALL, backgroundColor: '#f5f5f5', color: TEXT_SECONDARY }
                  : { ...BADGE_SMALL, backgroundColor: STATUS_SUCCESS_BG, color: STATUS_SUCCESS_DARK };
            return (
              <Card
                key={cls.id}
                variant="borderless"
                style={{ borderRadius: 12, boxShadow: 'var(--shadow-border)', opacity: isPast || cls.isCancelled ? 0.65 : 1, transition: 'opacity 0.2s' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 15, fontWeight: 600, color: TEXT_PRIMARY, margin: '0 0 4px' }} className="tabular-nums">
                      {formatDateMD(cls.date)}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={statusBadgeStyle}>{statusLabel}</span>
                      <span style={{ fontSize: 12, color: TEXT_TERTIARY }} className="tabular-nums">
                        {cls.startTime} · {formatDuration(cls.durationMin)}
                      </span>
                      {cls.location && (
                        <span style={{ fontSize: 12, color: TEXT_TERTIARY }}>
                          {LOCATION_LABEL[cls.location] ?? cls.location}
                        </span>
                      )}
                    </div>
                  </div>
                  {canCancel && (
                    <button
                      onClick={() => handleCancel(cls)}
                      disabled={cancellingId === cls.id}
                      className="active:scale-[0.96]"
                      style={{
                        flexShrink: 0, height: 36, padding: '0 12px', borderRadius: 10,
                        fontSize: 13, fontWeight: 500, cursor: 'pointer',
                        color: STATUS_ERROR_TEXT, border: `1.5px solid ${STATUS_ERROR_BORDER}`, background: '#fff',
                        transitionProperty: 'scale, background-color', transitionDuration: '150ms', transitionTimingFunction: 'ease-out',
                        WebkitTapHighlightColor: 'transparent',
                        opacity: cancellingId === cls.id ? 0.5 : 1,
                      }}
                    >
                      {cancellingId === cls.id ? '취소 중...' : '취소'}
                    </button>
                  )}
                  {canRestore && (
                    <button
                      onClick={() => handleRestore(cls)}
                      disabled={restoringId === cls.id}
                      className="active:scale-[0.96]"
                      style={{
                        flexShrink: 0, height: 36, padding: '0 12px', borderRadius: 10,
                        fontSize: 13, fontWeight: 500, cursor: 'pointer',
                        color: PRIMARY, border: '1.5px solid rgba(127,0,5,0.2)', background: PRIMARY_BG,
                        transitionProperty: 'scale, background-color', transitionDuration: '150ms', transitionTimingFunction: 'ease-out',
                        WebkitTapHighlightColor: 'transparent',
                        opacity: restoringId === cls.id ? 0.5 : 1,
                      }}
                    >
                      {restoringId === cls.id ? '복구 중...' : '복구'}
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
          <p style={{ fontSize: 12, textAlign: 'center', color: '#767676', marginTop: 4 }}>당일 취소는 강사님께 직접 문의해주세요</p>
        </div>
      )}
    </div>
  );
}

// ===== 메인 페이지 =====
export default function BookingPage() {
  const navigate = useNavigate();
  const { studentToken } = useParams();
  const routerLocation = useLocation();

  const [student, setStudent] = useState(null);
  const [studentError, setStudentError] = useState(null);
  const [tab, setTab] = useState(routerLocation.state?.tab ?? '예약하기');

  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const [calYear, setCalYear] = useState(nowKST.getUTCFullYear());
  const [calMonth, setCalMonth] = useState(nowKST.getUTCMonth());

  const [availableDates, setAvailableDates] = useState(new Set());
  const [slotsLoading, setSlotsLoading] = useState(true);

  const [selectedDate, setSelectedDate] = useState(null);
  const [availableTimes, setAvailableTimes] = useState([]);
  const [passableTimes, setPassableTimes] = useState([]);
  const [timesLoading, setTimesLoading] = useState(false);
  const [startTime, setStartTime] = useState(null);
  const [endTime, setEndTime] = useState(null);
  const [location, setLocation] = useState(LOCATION_OPTIONS[0]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const [classRefreshKey, setClassRefreshKey] = useState(0);
  const [myClassesMonth, setMyClassesMonth] = useState(() => {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
  });

  // 학생 정보 로드
  const loadStudent = useCallback(async () => {
    try {
      const data = await fetchStudentByToken(studentToken);
      setStudent(data);
    } catch (e) {
      setStudentError(e.status === 404 ? '등록된 예약 코드가 아닙니다.' : e.message);
    }
  }, [studentToken]);

  useEffect(() => {
    if (!studentToken) {
      navigate('/book', { replace: true });
      return;
    }
    loadStudent();
  }, [studentToken, navigate, loadStudent]);

  const loadSlots = useCallback(async () => {
    setSlotsLoading(true);
    try {
      const data = await fetchAvailableSlots();
      setAvailableDates(new Set(data.map(s => s.date)));
    } catch {
      // 무시
    } finally {
      setSlotsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSlots();
    const id = setInterval(loadSlots, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadSlots]);

  const handlePullRefresh = useCallback(async () => {
    setClassRefreshKey(k => k + 1);
    await Promise.all([loadStudent(), loadSlots()]);
  }, [loadStudent, loadSlots]);

  const { pullY, refreshing: pullRefreshing } = usePullToRefresh(handlePullRefresh);

  const [timeResetKey, setTimeResetKey] = useState(0);

  const handleDateSelect = async (date) => {
    if (selectedDate && selectedDate !== date && (startTime || endTime)) {
      setTimeResetKey(k => k + 1);
    }
    setSelectedDate(date);
    setStartTime(null);
    setEndTime(null);
    setSubmitError(null);
    setTimesLoading(true);
    try {
      const times = await fetchTimeSlots(date);
      setAvailableTimes(times.available);
      setPassableTimes(times.passable);
    } catch {
      setAvailableTimes([]);
      setPassableTimes([]);
    } finally {
      setTimesLoading(false);
    }
  };

  const handleStartSelect = (t) => {
    setStartTime(t);
    setEndTime(null);
    setSubmitError(null);
  };

  const handleEndSelect = (t) => {
    setEndTime(t);
    setSubmitError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedDate || !startTime || !endTime) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await reserveSlot({
        studentToken,
        date: selectedDate,
        startTime,
        endTime,
        location,
      });
      navigate(`/book/status/${encodeURIComponent(result.token)}`, { replace: true, state: { studentToken } });
    } catch (err) {
      setSubmitError(err.message);
      if (err.status === 409) {
        setStartTime(null);
        setEndTime(null);
        const [times] = await Promise.all([
          fetchTimeSlots(selectedDate).catch(() => ({ available: [], passable: [] })),
          loadSlots(),
        ]);
        setAvailableTimes(times.available ?? []);
        setPassableTimes(times.passable ?? []);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const prevMonth = () => {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); }
    else setCalMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); }
    else setCalMonth(m => m + 1);
  };

  const durationMin = startTime && endTime ? timeToMin(endTime) - timeToMin(startTime) : 0;
  const requiredSessions = durationMin / 60;
  const hasEnoughTime = !student || student.remainingSessions >= requiredSessions;
  const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

  if (studentError) {
    return (
      <div className="min-h-dvh bg-gray-50 flex flex-col items-center justify-center px-4">
        <Card variant="borderless" style={{ borderRadius: 16, maxWidth: 360, width: '100%', textAlign: 'center', boxShadow: 'var(--shadow-card)' }}>
          <div style={{ fontSize: 36, marginBottom: 16 }}>⚠️</div>
          <p className="text-red-500 text-sm">{studentError}</p>
          <Button
            type="primary"
            block
            onClick={() => navigate('/book')}
            style={{ borderRadius: 12, height: 44, fontWeight: 600, marginTop: 16 }}
          >
            다시 입력
          </Button>
        </Card>
      </div>
    );
  }

  if (!student) {
    return <div className="min-h-dvh bg-gray-50 flex items-center justify-center text-gray-500 text-sm">불러오는 중...</div>;
  }

  return (
    <div style={{ minHeight: '100dvh', backgroundColor: '#f9fafb' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <PullIndicator pullY={pullY} refreshing={pullRefreshing} />

        {/* 헤더 + 탭 — 하나의 sticky 컨테이너 */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 101,
          backgroundColor: 'rgba(255,255,255,0.95)',
          backdropFilter: 'saturate(180%) blur(20px)',
          WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        }}>
          {/* 헤더 행 */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px 10px',
            borderBottom: '1px solid rgba(0,0,0,0.04)',
          }}>
            <div>
              <h1 style={{ fontSize: 17, fontWeight: 700, color: '#1d1d1f', margin: 0, lineHeight: 1.3 }}>
                수업 예약
              </h1>
              <p style={{ fontSize: 12, color: '#767676', margin: '1px 0 0' }}>
                {student.name}님
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                className="tabular-nums"
                style={{
                  fontSize: 12, fontWeight: 600,
                  padding: '4px 10px', borderRadius: 20,
                  backgroundColor: student.remainingSessions > 0 ? '#fff0f1' : '#fff2f0',
                  color: student.remainingSessions > 0 ? '#7f0005' : '#cf1322',
                }}
                aria-label={`잔여 ${student.remainingSessions}회차`}
              >
                잔여 {student.remainingSessions}회
              </span>
              <button
                onClick={() => navigate('/book')}
                aria-label="예약 코드 입력 화면으로 돌아가기"
                style={{
                  fontSize: 12, color: '#8c8c8c', background: 'none',
                  border: 'none', cursor: 'pointer', padding: '4px 0',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                로그아웃
              </button>
            </div>
          </div>

          {/* 탭 행 */}
          <div
            role="tablist"
            style={{
              display: 'flex', padding: '0 16px',
              borderBottom: '1px solid rgba(0,0,0,0.06)',
            }}
          >
            {['예약하기', '내 수업'].map((t, i) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                aria-controls={`tab-panel-${i}`}
                id={`tab-${i}`}
                onClick={() => setTab(t)}
                className="active:scale-[0.96]"
                style={{
                  marginRight: 20, paddingTop: 10, paddingBottom: 10,
                  fontSize: 14, fontWeight: tab === t ? 600 : 500,
                  border: 'none', background: 'none', cursor: 'pointer',
                  borderBottom: tab === t ? '2px solid #7f0005' : '2px solid transparent',
                  color: tab === t ? '#7f0005' : '#595959',
                  minHeight: 44,
                  transitionProperty: 'color, border-color',
                  transitionDuration: '150ms',
                  transitionTimingFunction: 'ease-out',
                  WebkitTapHighlightColor: 'transparent',
                  outline: 'none',
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {tab === '내 수업' ? (
          <div role="tabpanel" id="tab-panel-1" aria-labelledby="tab-1">
          <MyClassesTab
            key={classRefreshKey}
            studentToken={studentToken}
            month={myClassesMonth}
            onMonthChange={setMyClassesMonth}
            onStudentRefresh={loadStudent}
          />
          </div>
        ) : (
          <div role="tabpanel" id="tab-panel-0" style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* 잔여 시간 없을 때 안내 */}
            {student.remainingSessions <= 0 && (
              <div role="alert" style={{ padding: '12px 16px', backgroundColor: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 12, fontSize: 14, color: '#cf1322', textAlign: 'center' }}>
                잔여 시간이 없습니다. 결제 후 예약이 가능합니다.
              </div>
            )}

            {/* 달력 */}
            <Card variant="borderless" style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <button
                  type="button"
                  onClick={prevMonth}
                  aria-label="이전 달"
                  className="active:scale-[0.96]"
                  style={{
                    width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 10, border: 'none', background: 'none', cursor: 'pointer',
                    fontSize: 20, color: '#595959',
                    transitionProperty: 'scale, background-color', transitionDuration: '150ms', transitionTimingFunction: 'ease-out',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <span aria-hidden="true">‹</span>
                </button>
                <span
                  style={{ fontSize: 15, fontWeight: 600, color: '#1d1d1f' }}
                  aria-live="polite" aria-atomic="true"
                >
                  {calYear}년 {MONTHS[calMonth]}
                </span>
                <button
                  type="button"
                  onClick={nextMonth}
                  aria-label="다음 달"
                  className="active:scale-[0.96]"
                  style={{
                    width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 10, border: 'none', background: 'none', cursor: 'pointer',
                    fontSize: 20, color: '#595959',
                    transitionProperty: 'scale, background-color', transitionDuration: '150ms', transitionTimingFunction: 'ease-out',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <span aria-hidden="true">›</span>
                </button>
              </div>

              {slotsLoading ? (
                <div style={{ textAlign: 'center', padding: '32px 0', fontSize: 13, color: '#8c8c8c' }}>불러오는 중...</div>
              ) : (
                <Calendar
                  year={calYear}
                  month={calMonth}
                  availableDates={availableDates}
                  selectedDate={selectedDate}
                  onSelect={handleDateSelect}
                />
              )}
            </Card>

            {/* 시간 선택 */}
            {selectedDate && (
              <Card variant="borderless" style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)' }}>
                {(() => {
                  const d = new Date(selectedDate + 'T00:00:00+09:00');
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                      <h2 style={{ fontSize: 15, fontWeight: 600, color: '#1d1d1f', margin: 0 }}>
                        {d.getMonth() + 1}월 {d.getDate()}일 ({DAY_KR[d.getDay()]}) 시간 선택
                      </h2>
                      {timeResetKey > 0 && (
                        <span style={{ fontSize: 12, color: '#8c8c8c' }}>초기화됨</span>
                      )}
                    </div>
                  );
                })()}

                {timesLoading ? (
                  <div style={{ textAlign: 'center', padding: '24px 0', fontSize: 13, color: '#8c8c8c' }}>불러오는 중...</div>
                ) : (
                  <TimeRangePicker
                    availableTimes={availableTimes}
                    passableTimes={passableTimes}
                    startTime={startTime}
                    endTime={endTime}
                    onStartSelect={handleStartSelect}
                    onEndSelect={handleEndSelect}
                  />
                )}
              </Card>
            )}

            {/* 예약 폼 */}
            {selectedDate && startTime && endTime && durationMin >= 60 && (
              <form onSubmit={handleSubmit}>
                <Card variant="borderless" style={{ borderRadius: 16, boxShadow: 'var(--shadow-border)' }}>
                  {/* 선택 요약 */}
                  <div style={{
                    backgroundColor: '#fff0f1', borderRadius: 10,
                    padding: '10px 14px', marginBottom: 14,
                    fontSize: 14, color: '#7f0005',
                  }}>
                    {(() => {
                      const d = new Date(selectedDate + 'T00:00:00+09:00');
                      return (
                        <span className="tabular-nums">
                          <span style={{ fontWeight: 600 }}>
                            {d.getMonth() + 1}/{d.getDate()}({DAY_KR[d.getDay()]}) {startTime} ~ {endTime}
                          </span>
                          <span style={{ marginLeft: 8, color: '#a00008', opacity: 0.7 }}>({formatDuration(durationMin)})</span>
                        </span>
                      );
                    })()}
                  </div>

                  {/* 수업 장소 선택 */}
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: '#595959', display: 'block', marginBottom: 8 }}>
                      수업 장소
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {LOCATION_OPTIONS.map(opt => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setLocation(opt)}
                          className="active:scale-[0.96]"
                          style={{
                            flex: 1, height: 44, borderRadius: 12,
                            fontSize: 14, fontWeight: 500, cursor: 'pointer',
                            border: location === opt ? '1.5px solid #7f0005' : '1.5px solid #d9d9d9',
                            backgroundColor: location === opt ? '#7f0005' : '#ffffff',
                            color: location === opt ? '#ffffff' : '#595959',
                            transitionProperty: 'background-color, color, border-color',
                            transitionDuration: '150ms', transitionTimingFunction: 'ease-out',
                            WebkitTapHighlightColor: 'transparent',
                          }}
                        >
                          {opt === '강남사무실' ? '강남사무실' : 'Zoom (온라인)'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 잔여 시간 부족 경고 */}
                  {!hasEnoughTime && (
                    <div
                      role="alert"
                      aria-live="assertive"
                      style={{ padding: '8px 12px', backgroundColor: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 8, fontSize: 14, color: '#cf1322', marginBottom: 12 }}
                    >
                      잔여 시간이 부족합니다.{' '}
                      <span className="tabular-nums">(잔여 {student.remainingSessions}회차, 필요 {requiredSessions}회차)</span>
                    </div>
                  )}

                  {submitError && (
                    <div
                      role="alert"
                      aria-live="assertive"
                      style={{ padding: '8px 12px', backgroundColor: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 8, fontSize: 14, color: '#cf1322', marginBottom: 12 }}
                    >
                      {submitError}
                    </div>
                  )}

                  <Button
                    type="primary"
                    block
                    htmlType="submit"
                    disabled={submitting || !hasEnoughTime}
                    style={{ borderRadius: 12, height: 44, fontWeight: 600 }}
                  >
                    {submitting ? '예약 중...' : '예약 확정하기'}
                  </Button>
                </Card>
              </form>
            )}

            <div style={{ height: 32 }} />
          </div>
        )}
      </div>
    </div>
  );
}
