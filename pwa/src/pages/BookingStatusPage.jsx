import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchBookingStatus } from '../api/bookingApi.js';

const DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00+09:00');
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAY_KR[d.getDay()]})`;
}

export default function BookingStatusPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const data = await fetchBookingStatus(token);
        if (alive) { setBooking(data); setError(null); }
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    };

    load();
    // 30초마다 상태 갱신 (강사 취소 반영)
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, [token]);

  const isCancelled = booking?.status === '취소';

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center pt-16 px-4">
      <div className="w-full max-w-sm">
        {loading && (
          <div className="text-center text-gray-400 py-12">불러오는 중...</div>
        )}

        {error && (
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
            <div className="text-4xl mb-4">❌</div>
            <p className="text-gray-700 font-medium">예약 정보를 찾을 수 없습니다</p>
            <p className="text-sm text-gray-400 mt-2">{error}</p>
            <button
              onClick={() => navigate('/book')}
              className="mt-6 w-full bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold"
            >
              예약 페이지로 돌아가기
            </button>
          </div>
        )}

        {!loading && booking && (
          <div className="space-y-4">
            <div className={`rounded-2xl shadow-sm p-6 ${isCancelled ? 'bg-gray-100' : 'bg-white'}`}>
              {/* 상태 뱃지 */}
              <div className="flex items-center gap-2 mb-5">
                <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${
                  isCancelled
                    ? 'bg-red-100 text-red-600'
                    : 'bg-green-100 text-green-700'
                }`}>
                  {isCancelled ? '❌ 취소됨' : '✅ 예약 확정'}
                </span>
              </div>

              {/* 예약 정보 */}
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">예약자</p>
                  <p className="font-semibold text-gray-800">{booking.studentName}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">날짜</p>
                  <p className="font-semibold text-gray-800">{formatDate(booking.date)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">시간</p>
                  <p className="font-semibold text-gray-800">
                    {booking.startTime} ({booking.durationMin}분)
                  </p>
                </div>
              </div>

              {isCancelled && (
                <div className="mt-5 bg-red-50 rounded-xl p-3 text-sm text-red-600">
                  수업이 취소되었습니다. 새로 예약하시려면 아래 버튼을 눌러주세요.
                </div>
              )}
            </div>

            {/* 이 페이지 저장 안내 */}
            {!isCancelled && (
              <div className="bg-blue-50 rounded-xl p-4 text-sm text-blue-700">
                이 페이지 링크를 저장해두시면 언제든지 예약 상태를 확인할 수 있습니다.
              </div>
            )}

            <button
              onClick={() => navigate('/book')}
              className={`w-full rounded-xl py-3 text-sm font-semibold ${
                isCancelled
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {isCancelled ? '새로 예약하기' : '예약 페이지로 돌아가기'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
