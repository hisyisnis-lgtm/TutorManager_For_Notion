import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  fetchStudentByToken,
  fetchAvailableSlots,
  fetchTimeSlots,
  reserveSlot,
  fetchMyClasses,
  cancelMyClass,
} from '../api/bookingApi.js';

const DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];
const LOCATION_OPTIONS = ['강남사무실', '온라인 (Zoom/화상)'];

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

// ===== 달력 컴포넌트 =====
function Calendar({ year, month, availableDates, selectedDate, onSelect }) {
  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();

  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = nowKST.toISOString().slice(0, 10);
  const minDate = new Date(nowKST);
  minDate.setUTCDate(minDate.getUTCDate() + 2);
  const minDateStr = minDate.toISOString().slice(0, 10);

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
                  ? 'bg-blue-600 text-white'
                  : disabled
                    ? 'text-gray-300 cursor-not-allowed'
                    : dow === 0
                      ? 'text-red-500 hover:bg-blue-50 cursor-pointer'
                      : dow === 6
                        ? 'text-blue-500 hover:bg-blue-50 cursor-pointer'
                        : 'text-gray-800 hover:bg-blue-50 cursor-pointer'
              }`}
            >
              {d.getDate()}
              {isToday && !isSelected && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-blue-400" />
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
  if (availableTimes.length === 0) {
    return <div className="text-center py-6 text-gray-400 text-sm">예약 가능한 시간이 없습니다</div>;
  }

  const startMin = startTime ? timeToMin(startTime) : null;

  const validEndTimes = (() => {
    if (startMin === null) return new Set();
    const valid = new Set();
    let prev = startMin;
    for (const t of availableTimes) {
      const tm = timeToMin(t);
      if (tm <= startMin) continue;
      if (tm !== prev + 30) break;
      if (tm - startMin >= 60) valid.add(t);
      prev = tm;
    }
    return valid;
  })();

  return (
    <div>
      <p className="text-xs text-gray-500 mb-2">시작 시간 선택</p>
      <div className="flex flex-wrap gap-2 mb-4">
        {availableTimes.map(t => {
          const tm = timeToMin(t);
          const isSelected = t === startTime;
          const inRange = startMin !== null && endTime && tm >= startMin && tm < timeToMin(endTime);
          return (
            <button
              key={t}
              type="button"
              onClick={() => onStartSelect(t)}
              className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                isSelected
                  ? 'bg-blue-600 text-white border-blue-600'
                  : inRange
                    ? 'bg-blue-50 text-blue-600 border-blue-200'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300'
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
            종료 시간 선택 <span className="text-gray-400">(최소 1시간 이상)</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {availableTimes
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
                        ? 'bg-blue-600 text-white border-blue-600'
                        : canSelect
                          ? 'bg-white text-gray-700 border-gray-200 hover:border-blue-300'
                          : 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
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
function MyClassesTab({ studentToken }) {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMyClasses(studentToken);
      setClasses(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [studentToken]);

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

  if (loading) return <div className="text-center py-12 text-gray-400 text-sm">불러오는 중...</div>;
  if (error) return <div className="mx-4 bg-red-50 text-red-500 rounded-xl p-4 text-sm mt-4">{error}</div>;
  if (classes.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <div className="text-4xl mb-3">📚</div>
        <div className="text-sm">수업 이력이 없습니다</div>
      </div>
    );
  }

  const LOCATION_LABEL = { '강남사무실': '강남', '온라인 (Zoom/화상)': 'Zoom' };

  return (
    <div className="px-4 py-4 space-y-2">
      {classes.map(cls => {
        const isPast = cls.date < todayStr;
        const canCancel = !cls.isCancelled && cls.date > todayStr;
        const statusLabel = cls.isCancelled ? '취소' : isPast ? '완료' : '예정';
        const statusStyle = cls.isCancelled
          ? 'bg-gray-100 text-gray-400'
          : isPast
            ? 'bg-blue-50 text-blue-500'
            : 'bg-green-100 text-green-700';
        return (
          <div
            key={cls.id}
            className={`bg-white rounded-xl shadow-sm p-4 flex items-center gap-3 ${isPast || cls.isCancelled ? 'opacity-60' : ''}`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusStyle}`}>
                  {statusLabel}
                </span>
                <span className="text-xs text-gray-400">{formatDate(cls.date)}</span>
              </div>
              <div className="text-sm text-gray-700 font-medium">
                {cls.startTime} · {formatDuration(cls.durationMin)}
              </div>
              {cls.location && (
                <div className="text-xs text-gray-400 mt-0.5">
                  {LOCATION_LABEL[cls.location] ?? cls.location}
                </div>
              )}
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
          </div>
        );
      })}
      <p className="text-xs text-center text-gray-400 pt-2">당일 취소는 강사에게 직접 연락해주세요</p>
    </div>
  );
}

// ===== 메인 페이지 =====
export default function BookingPage() {
  const navigate = useNavigate();
  const { studentToken } = useParams();

  const [student, setStudent] = useState(null);
  const [studentError, setStudentError] = useState(null);
  const [tab, setTab] = useState('예약하기');

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

  // 학생 정보 로드
  useEffect(() => {
    if (!studentToken) {
      navigate('/book', { replace: true });
      return;
    }
    fetchStudentByToken(studentToken).then(setStudent).catch(e => {
      setStudentError(e.status === 404 ? '등록된 예약 코드가 아닙니다.' : e.message);
    });
  }, [studentToken, navigate]);

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
    const id = setInterval(loadSlots, 60000);
    return () => clearInterval(id);
  }, [loadSlots]);

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
      navigate(`/book/status/${encodeURIComponent(result.token)}`, { replace: true });
    } catch (err) {
      setSubmitError(err.message);
      if (err.status === 409) {
        setStartTime(null);
        setEndTime(null);
        const times = await fetchTimeSlots(selectedDate).catch(() => []);
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
        <div className="bg-white rounded-xl shadow-sm p-6 max-w-sm w-full text-center space-y-4">
          <div className="text-4xl">⚠️</div>
          <p className="text-red-500 text-sm">{studentError}</p>
          <button
            onClick={() => navigate('/book')}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold"
          >
            다시 입력
          </button>
        </div>
      </div>
    );
  }

  if (!student) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400 text-sm">불러오는 중...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-lg mx-auto">
        {/* 헤더 */}
        <div className="bg-white px-4 pt-12 pb-3 border-b border-gray-100">
          <h1 className="text-xl font-bold text-gray-900">수업 예약</h1>
          <div className="flex items-center justify-between mt-1">
            <p className="text-sm text-gray-500">{student.name}님</p>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              student.remainingSessions > 0 ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-500'
            }`}>
              잔여 {student.remainingSessions}회차
            </span>
          </div>
        </div>

        {/* 탭 */}
        <div className="flex border-b border-gray-100 bg-white px-4">
          {['예약하기', '내 수업'].map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`mr-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === '내 수업' ? (
          <MyClassesTab studentToken={studentToken} />
        ) : (
          <div className="px-4 py-4 space-y-4">
            {/* 잔여 시간 없을 때 안내 */}
            {student.remainingSessions <= 0 && (
              <div className="bg-red-50 rounded-xl p-4 text-sm text-red-600 text-center">
                잔여 시간이 없습니다. 결제 후 예약이 가능합니다.
              </div>
            )}

            {/* 달력 */}
            <div className="bg-white rounded-xl shadow-sm p-4">
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
                <div className="text-center py-8 text-gray-400 text-sm">불러오는 중...</div>
              ) : (
                <Calendar
                  year={calYear}
                  month={calMonth}
                  availableDates={availableDates}
                  selectedDate={selectedDate}
                  onSelect={handleDateSelect}
                />
              )}
            </div>

            {/* 시간 선택 */}
            {selectedDate && (
              <div className="bg-white rounded-xl shadow-sm p-4">
                {(() => {
                  const d = new Date(selectedDate + 'T00:00:00+09:00');
                  return (
                    <h2 className="font-semibold text-gray-800 mb-3">
                      {d.getMonth() + 1}월 {d.getDate()}일 ({DAY_KR[d.getDay()]}) 시간 선택
                    </h2>
                  );
                })()}

                {timesLoading ? (
                  <div className="text-center py-6 text-gray-400 text-sm">불러오는 중...</div>
                ) : (
                  <TimeRangePicker
                    availableTimes={availableTimes}
                    startTime={startTime}
                    endTime={endTime}
                    onStartSelect={handleStartSelect}
                    onEndSelect={handleEndSelect}
                  />
                )}
              </div>
            )}

            {/* 예약 폼 */}
            {selectedDate && startTime && endTime && durationMin >= 60 && (
              <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-4 space-y-3">
                {/* 선택 요약 */}
                <div className="bg-blue-50 rounded-lg px-3 py-2.5 text-sm text-blue-700">
                  {(() => {
                    const d = new Date(selectedDate + 'T00:00:00+09:00');
                    return (
                      <>
                        <span className="font-semibold">
                          {d.getMonth() + 1}/{d.getDate()}({DAY_KR[d.getDay()]}) {startTime} ~ {endTime}
                        </span>
                        <span className="ml-2 text-blue-500">({formatDuration(durationMin)})</span>
                      </>
                    );
                  })()}
                </div>

                {/* 수업 장소 선택 */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">수업 장소</label>
                  <div className="flex gap-2">
                    {LOCATION_OPTIONS.map(opt => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setLocation(opt)}
                        className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                          location === opt
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                        }`}
                      >
                        {opt === '강남사무실' ? '강남사무실' : 'Zoom (온라인)'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 잔여 시간 부족 경고 */}
                {!hasEnoughTime && (
                  <div className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">
                    잔여 시간이 부족합니다. (잔여 {student.remainingSessions}회차, 필요 {requiredSessions}회차)
                  </div>
                )}

                {submitError && (
                  <div className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">{submitError}</div>
                )}

                <button
                  type="submit"
                  disabled={submitting || !hasEnoughTime}
                  className="w-full bg-blue-600 text-white rounded-lg py-3 text-sm font-semibold disabled:opacity-50 active:bg-blue-700"
                >
                  {submitting ? '예약 중...' : '예약 확정하기'}
                </button>
              </form>
            )}

            <div className="pb-8" />
          </div>
        )}
      </div>
    </div>
  );
}
