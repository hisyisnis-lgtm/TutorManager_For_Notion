import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAvailableSlots, reserveSlot } from '../api/bookingApi.js';

const DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAY_KR[d.getDay()]})`;
}

function groupByDate(slots) {
  const map = {};
  for (const slot of slots) {
    if (!map[slot.date]) map[slot.date] = [];
    map[slot.date].push(slot);
  }
  return map;
}

export default function BookingPage() {
  const navigate = useNavigate();
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [form, setForm] = useState({ studentName: '', phone: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const loadSlots = useCallback(async () => {
    try {
      const data = await fetchAvailableSlots();
      setSlots(data);
      setError(null);
    } catch (e) {
      setError('예약 가능한 시간을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSlots();
    // 30초마다 갱신 (다른 학생이 예약하면 슬롯 사라짐)
    const id = setInterval(loadSlots, 30000);
    return () => clearInterval(id);
  }, [loadSlots]);

  const grouped = groupByDate(slots);
  const dates = Object.keys(grouped).sort();

  const handleDateClick = (date) => {
    setSelectedDate(date === selectedDate ? null : date);
    setSelectedSlot(null);
  };

  const handleSlotClick = (slot) => {
    setSelectedSlot(slot);
    setSubmitError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedSlot) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await reserveSlot({
        date: selectedSlot.date,
        startTime: selectedSlot.startTime,
        durationMin: selectedSlot.durationMin,
        studentName: form.studentName.trim(),
        phone: form.phone.trim(),
      });
      navigate(`/book/status/${encodeURIComponent(result.token)}`, { replace: true });
    } catch (e) {
      setSubmitError(e.message);
      if (e.status === 409) {
        // 충돌 → 슬롯 다시 로드
        setSelectedSlot(null);
        loadSlots();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-lg mx-auto">
        {/* 헤더 */}
        <div className="bg-white px-4 pt-12 pb-4 border-b border-gray-100">
          <h1 className="text-xl font-bold text-gray-900">수업 예약</h1>
          <p className="text-sm text-gray-500 mt-1">원하는 날짜와 시간을 선택해주세요</p>
        </div>

        <div className="px-4 py-4 space-y-3">
          {loading && (
            <div className="text-center py-12 text-gray-400">불러오는 중...</div>
          )}

          {error && (
            <div className="bg-red-50 text-red-600 rounded-xl p-4 text-sm">{error}</div>
          )}

          {!loading && !error && dates.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <div className="text-4xl mb-3">📅</div>
              <div>현재 예약 가능한 시간이 없습니다</div>
            </div>
          )}

          {/* 날짜 목록 */}
          {!loading && dates.map(date => (
            <div key={date} className="bg-white rounded-xl shadow-sm overflow-hidden">
              <button
                onClick={() => handleDateClick(date)}
                className="w-full flex items-center justify-between px-4 py-3.5 text-left"
              >
                <span className="font-medium text-gray-800">{formatDate(date)}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">{grouped[date].length}개 슬롯</span>
                  <span className={`text-gray-400 transition-transform ${selectedDate === date ? 'rotate-180' : ''}`}>▾</span>
                </div>
              </button>

              {selectedDate === date && (
                <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {grouped[date].map(slot => (
                      <button
                        key={`${slot.date}-${slot.startTime}`}
                        onClick={() => handleSlotClick(slot)}
                        className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                          selectedSlot?.date === slot.date && selectedSlot?.startTime === slot.startTime
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300'
                        }`}
                      >
                        {slot.startTime}
                        <span className="text-xs ml-1 opacity-70">({slot.durationMin}분)</span>
                      </button>
                    ))}
                  </div>

                  {/* 선택된 슬롯 예약 폼 */}
                  {selectedSlot?.date === date && (
                    <form onSubmit={handleSubmit} className="mt-4 space-y-3 border-t border-gray-100 pt-4">
                      <p className="text-sm font-medium text-gray-700">
                        선택: {formatDate(selectedSlot.date)} {selectedSlot.startTime} ({selectedSlot.durationMin}분)
                      </p>

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
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
