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
import { Card, Button } from 'antd';

const DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];
const LOCATION_OPTIONS = ['강남사무실', '온라인 (Zoom/화상)'];

const ALL_TIME_SLOTS = (() => {
  const slots = [];
  // 09:00 ~ 21:00: 시작 시간 표시용 (22:00은 종료 시간으로만 사용)
  for (let m = 9 * 60; m <= 21 * 60; m += 30) {
    const h = String(Math.floor(m / 60)).padStart(2, '0');
    const min = String(m % 60).padStart(2, '0');
    slots.push(`${h}:${min}`);
  }
  return slots;
})();
const ALL_END_SLOTS = [...ALL_TIME_SLOTS, '22:00'];

function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function formatDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00+09:00');
  return `${d.getMonth() + 1}/${d.getDate()}(${DAY_KR[d.getDay()]})`;
}
function formatMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return `${y}년 ${m}월`;
}
function shiftMonth(monthStr, delta) {
  let [y, m] = monthStr.split('-').map(Number);
  m += delta;
  if (m > 12) { m = 1; y++; }
  if (m < 1) { m = 12; y--; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

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
              className={`relative flex items-center justify-center h-9 rounded-full text-sm font-medium transition-colors ${
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
function TimeRangePicker({ availableTimes, startTime, endTime, onStartSelect, onEndSelect }) {
  const availableSet = new Set(availableTimes);
  const startMin = startTime ? timeToMin(startTime) : null;

  const validEndTimes = (() => {
    if (startMin === null) return new Set();
    const valid = new Set();
    let prev = startMin;
    // ALL_END_SLOTS(~22:00)까지 순회하되, 가용 여부는 슬롯 시작(prev)으로 확인
    for (const t of ALL_END_SLOTS) {
      const tm = timeToMin(t);
      if (tm <= startMin) continue;
      if (tm !== prev + 30) break;
      const ps = `${String(Math.floor(prev / 60)).padStart(2, '0')}:${String(prev % 60).padStart(2, '0')}`;
      if (!availableSet.has(ps)) break;
      if (tm - startMin >= 60) valid.add(t);
      prev = tm;
    }
    return valid;
  })();

  return (
    <div>
      <p className="text-xs text-gray-500 mb-2">시작 시간 선택</p>
      <div className="flex flex-wrap gap-2 mb-4">
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
              className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
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

      {startTime && (
        <>
          <p className="text-xs text-gray-500 mb-2">
            종료 시간 선택 <span className="text-gray-500">(최소 1시간 이상)</span>
          </p>
          <div className="flex flex-wrap gap-2">
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
                    className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
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
        </>
      )}
    </div>
  );
}

// ===== 내 수업 탭 =====
function MyClassesTab({ studentToken, month, onMonthChange }) {
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

  const todayStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const handleCancel = async (cls) => {
    if (!window.confirm(`${formatDate(cls.date)} ${cls.startTime} 수업을 취소하시겠습니까?`)) return;
    setCancellingId(cls.id);
    try {
      await cancelMyClass(cls.id, studentToken);
      setClasses(prev => prev.map(c => c.id === cls.id ? { ...c, isCancelled: true } : c));
    } catch (e) {
      alert(e.message);
    } finally {
      setCancellingId(null);
    }
  };

  const handleRestore = async (cls) => {
    if (!window.confirm(`${formatDate(cls.date)} ${cls.startTime} 수업을 복구하시겠습니까?`)) return;
    setRestoringId(cls.id);
    try {
      await restoreMyClass(cls.id, studentToken);
      setClasses(prev => prev.map(c => c.id === cls.id ? { ...c, isCancelled: false } : c));
    } catch (e) {
      alert(e.message);
    } finally {
      setRestoringId(null);
    }
  };

  const LOCATION_LABEL = { '강남사무실': '강남', '온라인 (Zoom/화상)': 'Zoom' };

  return (
    <div>
      {/* 월 네비게이션 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <button
          type="button"
          onClick={() => onMonthChange(shiftMonth(month, -1))}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 text-lg"
        >
          ‹
        </button>
        <span className="font-semibold text-gray-800 text-sm">{formatMonth(month)}</span>
        <button
          type="button"
          onClick={() => onMonthChange(shiftMonth(month, 1))}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 text-lg"
        >
          ›
        </button>
      </div>

      {loading && <div className="text-center py-12 text-gray-500 text-sm">불러오는 중...</div>}
      {error && (
        <div style={{ margin: '16px', padding: '12px 16px', backgroundColor: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 12, fontSize: 14, color: '#cf1322' }}>
          {error}
        </div>
      )}
      {!loading && !error && classes.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-3">📚</div>
          <div className="text-sm">이 달에 수업이 없습니다</div>
        </div>
      )}

      {!loading && !error && classes.length > 0 && (
        <div className="px-4 py-4 space-y-2">
          {classes.map(cls => {
            const isPast = cls.date < todayStr;
            const canCancel = !cls.isCancelled && cls.date > todayStr;
            const canRestore = cls.isCancelled && cls.date > todayStr;
            const statusLabel = cls.isCancelled ? '취소' : isPast ? '완료' : '예정';
            const statusStyle = cls.isCancelled
              ? 'bg-gray-100 text-gray-400'
              : isPast
                ? 'bg-gray-100 text-gray-500'
                : 'bg-green-100 text-green-700';
            return (
              <Card
                key={cls.id}
                variant="borderless"
                style={{ borderRadius: 16, opacity: isPast || cls.isCancelled ? 0.6 : 1 }}
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-semibold text-gray-900 mb-0.5">
                      {formatDate(cls.date)}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusStyle}`}>
                        {statusLabel}
                      </span>
                      <span className="text-xs text-gray-500">
                        {cls.startTime} · {formatDuration(cls.durationMin)}
                      </span>
                      {cls.location && (
                        <span className="text-xs text-gray-500">
                          {LOCATION_LABEL[cls.location] ?? cls.location}
                        </span>
                      )}
                    </div>
                  </div>
                  {canCancel && (
                    <button
                      onClick={() => handleCancel(cls)}
                      disabled={cancellingId === cls.id}
                      className="shrink-0 text-sm text-red-500 border border-red-200 rounded-lg px-3 py-1.5 disabled:opacity-40 active:bg-red-50"
                    >
                      {cancellingId === cls.id ? '취소 중...' : '취소'}
                    </button>
                  )}
                  {canRestore && (
                    <button
                      onClick={() => handleRestore(cls)}
                      disabled={restoringId === cls.id}
                      className="shrink-0 text-sm text-brand-600 border border-brand-100 rounded-lg px-3 py-1.5 disabled:opacity-40 active:bg-brand-50"
                    >
                      {restoringId === cls.id ? '복구 중...' : '복구'}
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
          <p className="text-xs text-center text-gray-500 pt-2">당일 취소는 강사에게 직접 연락해주세요</p>
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

  const handleDateSelect = async (date) => {
    setSelectedDate(date);
    setStartTime(null);
    setEndTime(null);
    setSubmitError(null);
    setTimesLoading(true);
    try {
      const times = await fetchTimeSlots(date);
      setAvailableTimes(times);
    } catch {
      setAvailableTimes([]);
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
      navigate(`/book/status/${encodeURIComponent(result.token)}?st=${encodeURIComponent(studentToken)}`, { replace: true });
    } catch (err) {
      setSubmitError(err.message);
      if (err.status === 409) {
        setStartTime(null);
        setEndTime(null);
        const [times] = await Promise.all([
          fetchTimeSlots(selectedDate).catch(() => []),
          loadSlots(),
        ]);
        setAvailableTimes(times);
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
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
        <Card variant="borderless" style={{ borderRadius: 16, maxWidth: 360, width: '100%', textAlign: 'center' }}>
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
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-500 text-sm">불러오는 중...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-lg mx-auto">
        <PullIndicator pullY={pullY} refreshing={pullRefreshing} />
        {/* 헤더 */}
        <div className="bg-white px-4 pt-12 pb-3 border-b border-gray-100">
          <h1 className="text-xl font-bold text-gray-900">수업 예약</h1>
          <div className="flex items-center justify-between mt-1">
            <div className="flex items-center gap-2">
              <p className="text-sm text-gray-500">{student.name}님</p>
              <button
                onClick={() => navigate('/book')}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                로그아웃
              </button>
            </div>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              student.remainingSessions > 0 ? 'bg-brand-50 text-brand-600' : 'bg-red-50 text-red-500'
            }`}>
              잔여 {student.remainingSessions}회차
            </span>
          </div>
        </div>

        {/* 탭 */}
        <div
          role="tablist"
          className="flex border-b border-gray-100 bg-white px-4 sticky top-0 z-[100]"
        >
          {['예약하기', '내 수업'].map((t, i) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              aria-controls={`tab-panel-${i}`}
              id={`tab-${i}`}
              onClick={() => setTab(t)}
              className={`mr-4 py-3 text-sm font-medium border-b-2 transition-colors min-h-[44px] ${
                tab === t ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === '내 수업' ? (
          <div role="tabpanel" id="tab-panel-1" aria-labelledby="tab-1">
          <MyClassesTab
            key={classRefreshKey}
            studentToken={studentToken}
            month={myClassesMonth}
            onMonthChange={setMyClassesMonth}
          />
          </div>
        ) : (
          <div role="tabpanel" id="tab-panel-0" aria-labelledby="tab-0" className="px-4 py-4 space-y-4">
            {/* 잔여 시간 없을 때 안내 */}
            {student.remainingSessions <= 0 && (
              <div style={{ padding: '12px 16px', backgroundColor: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 12, fontSize: 14, color: '#cf1322', textAlign: 'center' }}>
                잔여 시간이 없습니다. 결제 후 예약이 가능합니다.
              </div>
            )}

            {/* 달력 */}
            <Card variant="borderless" style={{ borderRadius: 16 }}>
              <div className="flex items-center justify-between mb-3">
                <button
                  type="button"
                  onClick={prevMonth}
                  className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 text-lg"
                >
                  ‹
                </button>
                <span className="font-semibold text-gray-800">{calYear}년 {MONTHS[calMonth]}</span>
                <button
                  type="button"
                  onClick={nextMonth}
                  className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 text-lg"
                >
                  ›
                </button>
              </div>

              {slotsLoading ? (
                <div className="text-center py-8 text-gray-500 text-sm">불러오는 중...</div>
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
              <Card variant="borderless" style={{ borderRadius: 16 }}>
                {(() => {
                  const d = new Date(selectedDate + 'T00:00:00+09:00');
                  return (
                    <h2 className="font-semibold text-gray-800 mb-3">
                      {d.getMonth() + 1}월 {d.getDate()}일 ({DAY_KR[d.getDay()]}) 시간 선택
                    </h2>
                  );
                })()}

                {timesLoading ? (
                  <div className="text-center py-6 text-gray-500 text-sm">불러오는 중...</div>
                ) : (
                  <TimeRangePicker
                    availableTimes={availableTimes}
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
                <Card variant="borderless" style={{ borderRadius: 16 }}>
                  {/* 선택 요약 */}
                  <div className="bg-brand-50 rounded-lg px-3 py-2.5 text-sm text-brand-600" style={{ marginBottom: 12 }}>
                    {(() => {
                      const d = new Date(selectedDate + 'T00:00:00+09:00');
                      return (
                        <>
                          <span className="font-semibold">
                            {d.getMonth() + 1}/{d.getDate()}({DAY_KR[d.getDay()]}) {startTime} ~ {endTime}
                          </span>
                          <span className="ml-2 opacity-70">({formatDuration(durationMin)})</span>
                        </>
                      );
                    })()}
                  </div>

                  {/* 수업 장소 선택 */}
                  <div style={{ marginBottom: 12 }}>
                    <label className="block text-xs text-gray-500 mb-1.5">수업 장소</label>
                    <div className="flex gap-2">
                      {LOCATION_OPTIONS.map(opt => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setLocation(opt)}
                          className={`flex-1 py-3 rounded-lg text-sm font-medium border transition-colors ${
                            location === opt
                              ? 'bg-brand-600 text-white border-brand-600'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-brand-100'
                          }`}
                        >
                          {opt === '강남사무실' ? '강남사무실' : 'Zoom (온라인)'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 잔여 시간 부족 경고 */}
                  {!hasEnoughTime && (
                    <div style={{ padding: '8px 12px', backgroundColor: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 8, fontSize: 14, color: '#cf1322', marginBottom: 12 }}>
                      잔여 시간이 부족합니다. (잔여 {student.remainingSessions}회차, 필요 {requiredSessions}회차)
                    </div>
                  )}

                  {submitError && (
                    <div style={{ padding: '8px 12px', backgroundColor: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 8, fontSize: 14, color: '#cf1322', marginBottom: 12 }}>
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

            <div className="pb-8" />
          </div>
        )}
      </div>
    </div>
  );
}
