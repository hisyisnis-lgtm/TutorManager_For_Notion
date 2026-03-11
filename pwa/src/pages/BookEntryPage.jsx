import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchStudentByToken } from '../api/bookingApi.js';
import { usePullToRefresh, PullIndicator } from '../hooks/usePullToRefresh.jsx';

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
          <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm p-5 space-y-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">예약 코드</label>
              <input
                type="text"
                value={code}
                onChange={e => { setCode(e.target.value); setError(null); }}
                placeholder="강사에게 받은 코드를 입력하세요"
                autoFocus
                className="w-full border border-gray-200 rounded-lg px-3 py-3 text-sm focus:outline-none focus:border-blue-400"
              />
            </div>

            {error && (
              <div className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="w-full bg-blue-600 text-white rounded-lg py-3 text-sm font-semibold disabled:opacity-50 active:bg-blue-700"
            >
              {loading ? '확인 중...' : '시작하기'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
