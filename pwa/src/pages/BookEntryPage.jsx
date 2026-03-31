import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchStudentByToken } from '../api/bookingApi.js';
import { usePullToRefresh, PullIndicator } from '../hooks/usePullToRefresh.jsx';
import { Card, Input, Button, Typography } from 'antd';

export default function BookEntryPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { pullY, refreshing } = usePullToRefresh(useCallback(() => window.location.reload(), []));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      await fetchStudentByToken(trimmed);
      navigate(`/book/${encodeURIComponent(trimmed)}`);
    } catch (err) {
      setError(err.status === 404 ? '등록된 예약 코드가 아닙니다.' : err.message);
    } finally {
      setLoading(false);
    }
  };

  const errorId = 'book-entry-error';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="max-w-lg mx-auto w-full flex-1 flex flex-col">
        <PullIndicator pullY={pullY} refreshing={refreshing} />

        {/* 브랜드 헤더 */}
        <div style={{
          background: 'linear-gradient(135deg, #7f0005 0%, #a00008 100%)',
          padding: '48px 24px 36px',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* 배경 장식 원 */}
          <div style={{
            position: 'absolute', top: -40, right: -40,
            width: 160, height: 160, borderRadius: '50%',
            backgroundColor: 'rgba(255,255,255,0.06)',
            pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', bottom: -20, left: -20,
            width: 100, height: 100, borderRadius: '50%',
            backgroundColor: 'rgba(255,255,255,0.04)',
            pointerEvents: 'none',
          }} />
          <h1 style={{
            color: 'white', fontSize: 22, fontWeight: 700,
            margin: '0 0 6px', lineHeight: 1.3,
            textWrap: 'balance',
          }}>
            수업 예약
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14, margin: 0 }}>
            강사에게 받은 예약 코드를 입력해주세요
          </p>
        </div>

        <div className="px-4 py-6 flex-1">
          <form onSubmit={handleSubmit} noValidate>
            <Card variant="borderless" style={{ borderRadius: 16, boxShadow: 'var(--shadow-card)' }}>
              <div style={{ marginBottom: 16 }}>
                <label
                  htmlFor="booking-code"
                  style={{ fontSize: 14, fontWeight: 600, color: '#595959', display: 'block', marginBottom: 8 }}
                >
                  예약 코드
                </label>
                <Input
                  id="booking-code"
                  size="large"
                  style={{ borderRadius: 12 }}
                  value={code}
                  onChange={e => { setCode(e.target.value); setError(null); }}
                  placeholder="예: ABCD1234EFGH"
                  autoFocus
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  aria-invalid={error ? 'true' : 'false'}
                  aria-describedby={error ? errorId : undefined}
                />
              </div>

              {/* aria-live로 에러 스크린 리더에 알림 */}
              <div
                id={errorId}
                role="alert"
                aria-live="assertive"
                aria-atomic="true"
                style={{
                  overflow: 'hidden',
                  maxHeight: error ? 80 : 0,
                  opacity: error ? 1 : 0,
                  transition: 'max-height 0.25s ease, opacity 0.2s ease',
                  marginBottom: error ? 16 : 0,
                }}
              >
                {error && (
                  <div style={{
                    padding: '12px 16px',
                    backgroundColor: '#fff2f0',
                    border: '1px solid #ffccc7',
                    borderRadius: 12,
                    fontSize: 14,
                    color: '#cf1322',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}>
                    <span aria-hidden="true">⚠️</span>
                    {error}
                  </div>
                )}
              </div>

              <Button
                type="primary"
                block
                htmlType="submit"
                loading={loading}
                disabled={loading || !code.trim()}
                style={{ borderRadius: 12, height: 48, fontWeight: 700, fontSize: 15 }}
              >
                {loading ? '확인 중...' : '시작하기'}
              </Button>
            </Card>

            <p style={{ textAlign: 'center', fontSize: 13, color: '#8c8c8c', marginTop: 16 }}>
              예약 코드는 강사에게 문의해주세요
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
