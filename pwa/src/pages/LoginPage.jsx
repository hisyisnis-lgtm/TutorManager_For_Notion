import React, { useState } from 'react';

const WORKER_URL = import.meta.env.VITE_WORKER_URL;

export default function LoginPage({ onSuccess }) {
  const [pin, setPin] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${WORKER_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || '비밀번호가 틀렸습니다.');
        setPin('');
        return;
      }
      const { token } = data;
      sessionStorage.setItem('auth_token', token);
      if (remember) {
        localStorage.setItem('auth_token', token);
      }
      onSuccess(token);
    } catch {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-brand-600 rounded-2xl mx-auto mb-4 flex items-center justify-center">
            <span className="text-white text-2xl">📚</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">TutorManager</h1>
          <p className="text-gray-500 text-sm mt-1">비밀번호를 입력하세요</p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          <div>
            <input
              type="password"
              value={pin}
              onChange={e => { setPin(e.target.value); setError(''); }}
              placeholder="비밀번호"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-brand-500"
              autoFocus
              disabled={loading}
            />
            {error && <p className="text-red-500 text-sm mt-2 text-center">{error}</p>}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={e => setRemember(e.target.checked)}
              className="rounded accent-brand-600"
            />
            30일 동안 로그인 유지
          </label>

          <button type="submit" className="btn-primary w-full py-3" disabled={loading}>
            {loading ? '확인 중...' : '로그인'}
          </button>
        </form>
      </div>
    </div>
  );
}
