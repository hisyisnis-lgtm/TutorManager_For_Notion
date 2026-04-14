import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { fetchBookingStatus } from '../api/bookingApi.js';
import { Card, Button } from 'antd';
import { CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';

const DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00+09:00');
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAY_KR[d.getDay()]})`;
}

// 예약 확정 성공 아이콘 (애니메이션)
function SuccessIcon() {
  return (
    <div style={{
      width: 72, height: 72, borderRadius: '50%',
      backgroundColor: '#f6ffed',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      margin: '0 auto 20px',
      animation: 'successPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both',
    }}
    role="img"
    aria-label="예약 확정"
    >
      <CheckCircleFilled style={{ fontSize: 36, color: '#52c41a' }} />
    </div>
  );
}

function CancelIcon() {
  return (
    <div style={{
      width: 72, height: 72, borderRadius: '50%',
      backgroundColor: '#fff2f0',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      margin: '0 auto 20px',
    }}
    role="img"
    aria-label="예약 취소됨"
    >
      <CloseCircleFilled style={{ fontSize: 36, color: '#cf1322' }} />
    </div>
  );
}

// 예약 정보 행
function InfoRow({ label, value }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      alignItems: 'center',
      padding: '10px 0',
      borderBottom: '1px solid #f5f5f5',
    }}>
      <span style={{ fontSize: 13, color: '#8c8c8c' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: '#262626' }}>{value}</span>
    </div>
  );
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

  const from = location.state?.from;
  const isCancelled = booking?.status === '취소';

  return (
    <div className="min-h-dvh bg-gray-50 flex items-start justify-center pt-12 px-4">
      <div className="w-full max-w-sm">

        {/* 로딩 */}
        {loading && (
          <div className="text-center text-gray-400 py-12" aria-live="polite" aria-busy="true">
            불러오는 중...
          </div>
        )}

        {/* 오류 */}
        {error && (
          <Card variant="borderless" style={{ borderRadius: 16, textAlign: 'center', boxShadow: 'var(--shadow-card)' }}
            role="alert"
          >
            <CloseCircleFilled style={{ fontSize: 36, color: '#cf1322', marginBottom: 16, display: 'block' }} aria-hidden="true" />
            <p className="text-gray-700 font-medium">예약 정보를 찾을 수 없습니다</p>
            <p className="text-sm text-gray-500 mt-2">{error}</p>
            <Button
              type="primary"
              block
              onClick={() => navigate(from === 'personal' ? '/personal' : '/book')}
              style={{ borderRadius: 12, height: 48, fontWeight: 700, marginTop: 24 }}
            >
              예약 페이지로 돌아가기
            </Button>
          </Card>
        )}

        {/* 예약 정보 */}
        {!loading && booking && (
          <div
            className="space-y-4"
            style={{ animation: 'fadeSlideUp 0.4s ease both' }}
          >
            <Card
              variant="borderless"
              style={{ borderRadius: 16, textAlign: 'center', boxShadow: 'var(--shadow-card)' }}
            >
              {/* 상태 아이콘 */}
              {isCancelled ? <CancelIcon /> : <SuccessIcon />}

              {/* 상태 텍스트 */}
              <div
                role="status"
                aria-live="polite"
                style={{ marginBottom: 24 }}
              >
                <h2 style={{
                  fontSize: 20, fontWeight: 700,
                  color: isCancelled ? '#cf1322' : '#262626',
                  margin: '0 0 4px',
                  textWrap: 'balance',
                }}>
                  {isCancelled ? '예약이 취소되었습니다' : '예약이 확정되었습니다!'}
                </h2>
                <p style={{ fontSize: 13, color: '#8c8c8c', margin: 0 }}>
                  {isCancelled
                    ? '새로 예약하시려면 아래 버튼을 눌러주세요'
                    : '아래 예약 정보를 확인해주세요'}
                </p>
              </div>

              {/* 예약 상세 정보 */}
              <div style={{ textAlign: 'left' }}>
                <InfoRow label="예약자" value={booking.studentName} />
                <InfoRow label="날짜" value={<span className="tabular-nums">{formatDate(booking.date)}</span>} />
                <InfoRow
                  label="시간"
                  value={<span className="tabular-nums">{`${booking.startTime} (${booking.durationMin}분)`}</span>}
                />
              </div>

              {/* 취소 안내 */}
              {isCancelled && (
                <div style={{
                  marginTop: 20, padding: '12px 16px',
                  backgroundColor: '#fff2f0', border: '1px solid #ffccc7',
                  borderRadius: 12, fontSize: 14, color: '#cf1322', textAlign: 'left',
                }}>
                  수업이 취소되었습니다. 새로 예약해주세요.
                </div>
              )}
            </Card>

            {/* 페이지 저장 안내 */}
            {!isCancelled && (
              <div style={{
                backgroundColor: '#fff0f1', borderRadius: 12,
                padding: '14px 16px', fontSize: 13, color: '#7f0005',
                display: 'flex', alignItems: 'flex-start', gap: 8,
              }}>
                <span aria-hidden="true" style={{ flexShrink: 0 }}>💡</span>
                <span>이 페이지 링크를 저장해두시면 언제든지 예약 상태를 확인할 수 있습니다.</span>
              </div>
            )}

            <Button
              type="primary"
              block
              onClick={() => navigate(
                from === 'personal'
                  ? (studentToken ? `/personal/${studentToken}` : '/personal')
                  : (studentToken ? `/book/${studentToken}` : '/book'),
                { state: { tab: isCancelled ? '예약하기' : '내 수업' } }
              )}
              style={{ borderRadius: 12, height: 48, fontWeight: 700 }}
            >
              {isCancelled ? '새로 예약하기' : '내 수업 확인'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
