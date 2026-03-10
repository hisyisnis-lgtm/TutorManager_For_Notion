import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAvailableSlots, fetchTimeSlots, reserveSlot } from '../api/bookingApi.js';

const DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];

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

  // startTime 이후 연속된 슬롯 계산
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

// ===== 메인 페이지 =====
export default function BookingPage() {
  const navigate = useNavigate();

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

  const [form, setForm] = useState({ studentName: '', phone: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

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
        date: selectedDate,
        startTime,
        endTime,
        studentName: form.studentName.trim(),
        phone: form.phone.trim(),
      });
      navigate(`/book/status/${encodeURIComponent(result.token)}`, { replace: true });
    } catch (e) {
      setSubmitError(e.message);
      if (e.status === 409) {
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
  const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-lg mx-auto">
        <div className="bg-white px-4 pt-12 pb-4 border-b border-gray-100">
          <h1 className="text-xl font-bold text-gray-900">수업 예약</h1>
          <p className="text-sm text-gray-500 mt-1">날짜를 선택하고 원하는 시간대를 골라주세요</p>
        </div>

        <div className="px-4 py-4 space-y-4">
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

              <div>
                <label className="block text-xs text-gray-500 mb-1">이름</label>
                <input
                  type="text"
                  required
                  value={form.studentName}
                  onChange={e => setForm(f => ({ ...f, studentName: e.target.value }))}
                  placeholder="홍길동"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">연락처</label>
                <input
                  type="tel"
                  required
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="010-0000-0000"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400"
                />
              </div>

              {submitError && (
                <div className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">{submitError}</div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-blue-600 text-white rounded-lg py-3 text-sm font-semibold disabled:opacity-50 active:bg-blue-700"
              >
                {submitting ? '예약 중...' : '예약 확정하기'}
              </button>
            </form>
          )}

          <div className="pb-8" />
        </div>
      </div>
    </div>
  );
}
