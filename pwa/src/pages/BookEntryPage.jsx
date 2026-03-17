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

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="max-w-lg mx-auto w-full flex-1 flex flex-col">
        <PullIndicator pullY={pullY} refreshing={refreshing} />
        <div className="bg-white px-4 pt-12 pb-4 border-b border-gray-100">
          <h1 className="text-xl font-bold text-gray-900">수업 예약</h1>
          <p className="text-sm text-gray-500 mt-1">예약 코드를 입력해주세요</p>
        </div>

        <div className="px-4 py-8 flex-1">
          <form onSubmit={handleSubmit}>
            <Card variant="borderless" style={{ borderRadius: 16 }}>
              <div style={{ marginBottom: 16 }}>
                <Typography.Text strong style={{ fontSize: 14, color: '#595959', display: 'block', marginBottom: 6 }}>
                  예약 코드
                </Typography.Text>
                <Input
                  size="large"
                  style={{ borderRadius: 12 }}
                  value={code}
                  onChange={e => { setCode(e.target.value); setError(null); }}
                  placeholder="강사에게 받은 코드를 입력하세요"
                  autoFocus
                />
              </div>

              {error && (
                <div style={{ padding: '12px 16px', backgroundColor: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 12, fontSize: 14, color: '#cf1322', marginBottom: 16 }}>
                  {error}
                </div>
              )}

              <Button
                type="primary"
                block
                htmlType="submit"
                disabled={loading || !code.trim()}
                style={{ borderRadius: 12, height: 44, fontWeight: 600 }}
              >
                {loading ? '확인 중...' : '시작하기'}
              </Button>
            </Card>
          </form>
        </div>
      </div>
    </div>
  );
}
