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
    <div className="min-h-screen flex flex-col bg-brand-600">
      {/* 상단 로고 영역 */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 pt-16 pb-10">
        <img
          src="/logo/logo-white.png"
          alt="하늘하늘 중국어"
          className="w-64 object-contain drop-shadow-sm"
        />
        <p className="text-white/70 text-sm mt-4 tracking-wide">수업 관리 시스템</p>
      </div>

      {/* 하단 폼 카드 */}
      <div className="bg-gray-50 rounded-t-3xl px-6 pt-8 pb-10 shadow-2xl">
        <h2 className="text-lg font-bold text-gray-800 mb-6 text-center">로그인</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="password"
              value={pin}
              onChange={e => { setPin(e.target.value); setError(''); }}
              placeholder="비밀번호를 입력하세요"
              className="w-full px-4 py-3.5 border border-gray-200 rounded-xl text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
              autoFocus
              disabled={loading}
            />
            {error && (
              <p className="text-red-500 text-sm mt-2 text-center">{error}</p>
            )}
          </div>

          <label className="flex items-center gap-2.5 text-sm text-gray-600 cursor-pointer select-none px-1">
            <input
              type="checkbox"
              checked={remember}
              onChange={e => setRemember(e.target.checked)}
              className="w-4 h-4 rounded accent-brand-600"
            />
            30일 동안 로그인 유지
          </label>

          <button
            type="submit"
            className="btn-primary w-full py-3.5 text-base"
            disabled={loading}
          >
            {loading ? '확인 중...' : '로그인'}
          </button>
        </form>
      </div>
    </div>
  );
}
