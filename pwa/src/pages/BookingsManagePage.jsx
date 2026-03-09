import { useState, useEffect, useCallback } from 'react';
import PageHeader from '../components/layout/PageHeader.jsx';
import { fetchBookingList, cancelBooking } from '../api/bookingApi.js';

const DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00+09:00');
  return `${d.getMonth() + 1}/${d.getDate()}(${DAY_KR[d.getDay()]})`;
}

const STATUS_STYLE = {
  확정: 'bg-green-100 text-green-700',
  취소: 'bg-gray-100 text-gray-400',
};

export default function BookingsManagePage() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);
  const [filter, setFilter] = useState('확정'); // '확정' | '전체'

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

  const filtered = filter === '확정'
    ? bookings.filter(b => b.status === '확정')
    : bookings;

  // 날짜 기준 오늘 이전 예약은 하단으로
  const todayStr = new Date().toISOString().slice(0, 10);
  const upcoming = filtered.filter(b => b.date >= todayStr);
  const past = filtered.filter(b => b.date < todayStr);
  const sorted = [...upcoming, ...past];

  return (
    <div className="page-content">
      <PageHeader title="예약 관리" onRefresh={load} />

      {/* 필터 탭 */}
      <div className="flex gap-2 px-4 pt-4 pb-2">
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
    </div>
  );
}
