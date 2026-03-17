import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { fetchBookingStatus } from '../api/bookingApi.js';
import { Card, Tag, Button } from 'antd';

const DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00+09:00');
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAY_KR[d.getDay()]})`;
}

export default function BookingStatusPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const studentToken = new URLSearchParams(location.search).get('st') || location.state?.studentToken;
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
          <Card variant="borderless" style={{ borderRadius: 16, textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 16 }}>❌</div>
            <p className="text-gray-700 font-medium">예약 정보를 찾을 수 없습니다</p>
            <p className="text-sm text-gray-500 mt-2">{error}</p>
            <Button
              type="primary"
              block
              onClick={() => navigate('/book')}
              style={{ borderRadius: 12, height: 44, fontWeight: 600, marginTop: 24 }}
            >
              예약 페이지로 돌아가기
            </Button>
          </Card>
        )}

        {!loading && booking && (
          <div className="space-y-4">
            <Card
              variant="borderless"
              style={{ borderRadius: 16, backgroundColor: isCancelled ? '#f5f5f5' : '#fff' }}
            >
              {/* 상태 뱃지 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                {isCancelled ? (
                  <Tag color="error" style={{ fontSize: 14, padding: '2px 12px', borderRadius: 20 }}>
                    ❌ 취소됨
                  </Tag>
                ) : (
                  <Tag color="success" style={{ fontSize: 14, padding: '2px 12px', borderRadius: 20 }}>
                    ✅ 예약 확정
                  </Tag>
                )}
              </div>

              {/* 예약 정보 */}
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">예약자</p>
                  <p className="font-semibold text-gray-800">{booking.studentName}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">날짜</p>
                  <p className="font-semibold text-gray-800">{formatDate(booking.date)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-0.5">시간</p>
                  <p className="font-semibold text-gray-800">
                    {booking.startTime} ({booking.durationMin}분)
                  </p>
                </div>
              </div>

              {isCancelled && (
                <div style={{ marginTop: 20, padding: '12px 16px', backgroundColor: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 12, fontSize: 14, color: '#cf1322' }}>
                  수업이 취소되었습니다. 새로 예약하시려면 아래 버튼을 눌러주세요.
                </div>
              )}
            </Card>

            {/* 이 페이지 저장 안내 */}
            {!isCancelled && (
              <div style={{ backgroundColor: '#fff0f1', borderRadius: 12, padding: '16px', fontSize: 14, color: '#7f0005' }}>
                이 페이지 링크를 저장해두시면 언제든지 예약 상태를 확인할 수 있습니다.
              </div>
            )}

            <Button
              type={isCancelled ? 'primary' : 'default'}
              block
              onClick={() => navigate(studentToken ? `/book/${studentToken}` : '/book', { state: { tab: isCancelled ? '예약하기' : '내 수업' } })}
              style={{ borderRadius: 12, height: 44, fontWeight: 600 }}
            >
              {isCancelled ? '새로 예약하기' : '확인'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
