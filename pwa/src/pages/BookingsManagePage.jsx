import { useState, useEffect, useCallback } from 'react';
import PageHeader from '../components/layout/PageHeader.jsx';
import { fetchBookingList, cancelBooking, fetchBlockedDates, createBlockedDate, deleteBlockedDate } from '../api/bookingApi.js';

const DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];
const WEEK_DAYS = ['월', '화', '수', '목', '금', '토', '일'];

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00+09:00');
  return `${d.getMonth() + 1}/${d.getDate()}(${DAY_KR[d.getDay()]})`;
}

const STATUS_STYLE = {
  확정: 'bg-green-100 text-green-700',
  취소: 'bg-gray-100 text-gray-400',
};

// ===== 예약 목록 탭 =====
function BookingListTab() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);
  const [filter, setFilter] = useState('확정');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBookingList();
      setBookings(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCancel = async (booking) => {
    if (!window.confirm(`${booking.studentName}님의 ${formatDate(booking.date)} ${booking.startTime} 수업을 취소하시겠습니까?`)) return;
    setCancellingId(booking.id);
    try {
      await cancelBooking(booking.id);
      setBookings(prev => prev.map(b => b.id === booking.id ? { ...b, status: '취소' } : b));
    } catch (e) {
      alert(`취소 실패: ${e.message}`);
    } finally {
      setCancellingId(null);
    }
  };

  const filtered = filter === '확정' ? bookings.filter(b => b.status === '확정') : bookings;
  const todayStr = new Date().toISOString().slice(0, 10);
  const upcoming = filtered.filter(b => b.date >= todayStr);
  const past = filtered.filter(b => b.date < todayStr);
  const sorted = [...upcoming, ...past];

  return (
    <>
      <div className="flex gap-2 px-4 pt-3 pb-2">
        {['확정', '전체'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {f}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-400 self-center">{upcoming.length}개 예정</span>
      </div>

      {loading && <div className="text-center py-12 text-gray-400">불러오는 중...</div>}
      {error && <div className="mx-4 bg-red-50 text-red-500 rounded-xl p-4 text-sm">{error}</div>}

      {!loading && sorted.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-3">📋</div>
          <div>예약 내역이 없습니다</div>
        </div>
      )}

      <div className="px-4 pb-24 space-y-2 mt-1">
        {sorted.map(booking => {
          const isPast = booking.date < todayStr;
          return (
            <div
              key={booking.id}
              className={`bg-white rounded-xl shadow-sm p-4 flex items-center gap-3 ${isPast ? 'opacity-60' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[booking.status] ?? STATUS_STYLE.취소}`}>
                    {booking.status}
                  </span>
                  <span className="text-xs text-gray-400">{formatDate(booking.date)}</span>
                </div>
                <div className="font-semibold text-gray-800 truncate">{booking.studentName}</div>
                <div className="text-sm text-gray-500">{booking.startTime} · {booking.durationMin}분</div>
                {booking.phone && (
                  <div className="text-xs text-gray-400 mt-0.5">{booking.phone}</div>
                )}
              </div>

              {booking.status === '확정' && (
                <button
                  onClick={() => handleCancel(booking)}
                  disabled={cancellingId === booking.id}
                  className="shrink-0 text-sm text-red-500 border border-red-200 rounded-lg px-3 py-1.5 disabled:opacity-40 active:bg-red-50"
                >
                  {cancellingId === booking.id ? '취소 중...' : '취소'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ===== 예약 불가 날짜 탭 =====
function BlockedDatesTab() {
  const [blocked, setBlocked] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [form, setForm] = useState({
    type: '일회성',
    days: [],
    start: '',
    end: '',
    memo: '',
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBlockedDates();
      setBlocked(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleDay = (day) => {
    setForm(f => ({
      ...f,
      days: f.days.includes(day) ? f.days.filter(d => d !== day) : [...f.days, day],
    }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await createBlockedDate({
        type: form.type,
        days: form.type === '반복' ? form.days : [],
        start: form.start || undefined,
        end: form.end || undefined,
        memo: form.memo || undefined,
      });
      setForm({ type: '일회성', days: [], start: '', end: '', memo: '' });
      setShowForm(false);
      load();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`"${item.memo || formatBlockedLabel(item)}" 을 삭제하시겠습니까?`)) return;
    setDeletingId(item.id);
    try {
      await deleteBlockedDate(item.id);
      setBlocked(prev => prev.filter(b => b.id !== item.id));
    } catch (e) {
      alert(`삭제 실패: ${e.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="text-sm text-gray-500">{blocked.length}개 등록됨</span>
        <button
          onClick={() => { setShowForm(v => !v); setFormError(null); }}
          className="text-sm font-medium text-blue-600 active:opacity-70"
        >
          {showForm ? '닫기' : '+ 추가'}
        </button>
      </div>

      {/* 추가 폼 */}
      {showForm && (
        <form onSubmit={handleSave} className="mx-4 mb-3 bg-white rounded-xl shadow-sm p-4 space-y-3">
          {/* 유형 선택 */}
          <div className="flex gap-2">
            {['일회성', '반복'].map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setForm(f => ({ ...f, type: t, days: [], start: '', end: '' }))}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  form.type === t ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* 반복: 요일 선택 */}
          {form.type === '반복' && (
            <div>
              <p className="text-xs text-gray-500 mb-2">반복 요일</p>
              <div className="flex gap-1.5 flex-wrap">
                {WEEK_DAYS.map(day => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={`w-9 h-9 rounded-full text-sm font-medium border transition-colors ${
                      form.days.includes(day)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-200'
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 반복: 기간 제한 (선택) */}
          {form.type === '반복' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">시작일 (선택)</label>
                <input
                  type="date"
                  value={form.start}
                  onChange={e => setForm(f => ({ ...f, start: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">종료일 (선택)</label>
                <input
                  type="date"
                  value={form.end}
                  min={form.start}
                  onChange={e => setForm(f => ({ ...f, end: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                />
              </div>
            </div>
          )}

          {/* 일회성: 날짜 선택 */}
          {form.type === '일회성' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">날짜</label>
                <input
                  type="date"
                  required
                  value={form.start}
                  onChange={e => setForm(f => ({ ...f, start: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">종료일 (범위 시)</label>
                <input
                  type="date"
                  value={form.end}
                  min={form.start}
                  onChange={e => setForm(f => ({ ...f, end: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                />
              </div>
            </div>
          )}

          {/* 메모 */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">메모 (선택)</label>
            <input
              type="text"
              value={form.memo}
              onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}
              placeholder="예: 추석 연휴"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
            />
          </div>

          {formError && (
            <div className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">{formError}</div>
          )}

          <button
            type="submit"
            disabled={saving || (form.type === '반복' && form.days.length === 0)}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </form>
      )}

      {loading && <div className="text-center py-12 text-gray-400">불러오는 중...</div>}
      {error && <div className="mx-4 bg-red-50 text-red-500 rounded-xl p-4 text-sm">{error}</div>}

      {!loading && blocked.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-3">🚫</div>
          <div>등록된 예약 불가 날짜가 없습니다</div>
        </div>
      )}

      <div className="px-4 pb-24 space-y-2 mt-1">
        {blocked.map(item => (
          <div key={item.id} className="bg-white rounded-xl shadow-sm p-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  item.type === '반복' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'
                }`}>
                  {item.type}
                </span>
              </div>
              <div className="font-medium text-gray-800 text-sm">{formatBlockedLabel(item)}</div>
              {item.memo && item.memo !== formatBlockedLabel(item) && (
                <div className="text-xs text-gray-400 mt-0.5">{item.memo}</div>
              )}
            </div>
            <button
              onClick={() => handleDelete(item)}
              disabled={deletingId === item.id}
              className="shrink-0 text-sm text-red-500 border border-red-200 rounded-lg px-3 py-1.5 disabled:opacity-40 active:bg-red-50"
            >
              {deletingId === item.id ? '삭제 중...' : '삭제'}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function formatBlockedLabel(item) {
  if (item.type === '반복') {
    const days = item.days.join('·');
    if (item.start && item.end) return `매주 ${days} (${item.start} ~ ${item.end})`;
    if (item.start) return `매주 ${days} (${item.start}~)`;
    if (item.end) return `매주 ${days} (~${item.end})`;
    return `매주 ${days}`;
  }
  if (item.end && item.end !== item.start) return `${item.start} ~ ${item.end}`;
  return item.start || '';
}

// ===== 메인 페이지 =====
export default function BookingsManagePage() {
  const [tab, setTab] = useState('목록');

  return (
    <div className="page-content">
      <PageHeader title="예약 관리" />

      {/* 상단 탭 */}
      <div className="flex border-b border-gray-100 px-4 pt-2">
        {['목록', '예약 불가'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`mr-4 pb-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === '목록' ? <BookingListTab /> : <BlockedDatesTab />}
    </div>
  );
}
