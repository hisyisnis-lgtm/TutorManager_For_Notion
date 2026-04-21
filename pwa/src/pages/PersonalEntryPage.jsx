import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchStudentByToken } from '../api/bookingApi.js';
import { usePullToRefresh, PullIndicator } from '../hooks/usePullToRefresh.jsx';
import { Card, Input, Button } from 'antd';
import PublicHeader from '../components/public/PublicHeader.jsx';
import PublicFooter from '../components/public/PublicFooter.jsx';

const SAVED_TOKEN_KEY = 'personal_student_token';

export default function PersonalEntryPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // 저장된 코드 있으면 자동 이동
  useEffect(() => {
    const saved = localStorage.getItem(SAVED_TOKEN_KEY);
    if (saved) navigate(`/personal/${encodeURIComponent(saved)}`, { replace: true });
  }, [navigate]);

  const { pullY, refreshing } = usePullToRefresh(useCallback(() => window.location.reload(), []));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      await fetchStudentByToken(trimmed);
      localStorage.setItem(SAVED_TOKEN_KEY, trimmed);
      navigate(`/personal/${encodeURIComponent(trimmed)}`);
    } catch (err) {
      setError(err.status === 404 ? '등록된 학생 코드가 아닙니다.' : err.message);
    } finally {
      setLoading(false);
    }
  };

  const errorId = 'personal-entry-error';

  return (
    <div style={{ minHeight: '100dvh', backgroundColor: '#f5f5f5', fontFamily: 'inherit', display: 'flex', flexDirection: 'column' }}>
      <PublicHeader tabs={[]} activeTab="" onTabChange={() => {}} />
      <PullIndicator pullY={pullY} refreshing={refreshing} />

      {/* 히어로 */}
      <div style={{
        background: 'linear-gradient(150deg, #6b0004 0%, #7f0005 50%, #9a0007 100%)',
        padding: '56px 24px 48px',
      }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <p style={{
            color: 'rgba(255,255,255,0.55)', fontSize: 11,
            margin: '0 0 12px', fontWeight: 500,
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>
            하늘하늘 중국어
          </p>
          <h1 style={{
            color: 'white', fontSize: 30, fontWeight: 700,
            margin: '0 0 10px', lineHeight: 1.15, letterSpacing: '-0.4px',
            textWrap: 'balance',
          }}>
            학생 페이지
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, margin: 0, lineHeight: 1.7 }}>
            강사님이 보내준 학생 코드를 입력하면<br />
            내 수업과 일정을 바로 볼 수 있어요
          </p>
        </div>
      </div>

      {/* 폼 */}
      <div style={{ flex: 1, maxWidth: 480, margin: '0 auto', width: '100%', padding: '24px 16px 40px' }}>
        <form onSubmit={handleSubmit} noValidate>
          <Card variant="borderless" style={{ borderRadius: 16, boxShadow: 'var(--shadow-card)' }}>
            <div style={{ marginBottom: 16 }}>
              <label
                htmlFor="student-code"
                style={{ fontSize: 14, fontWeight: 600, color: '#595959', display: 'block', marginBottom: 8 }}
              >
                학생 코드
              </label>
              <Input
                id="student-code"
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
            코드를 모르시면 강사님께 카카오톡으로 문의해주세요 💬
          </p>
        </form>
      </div>

      <PublicFooter />
    </div>
  );
}
