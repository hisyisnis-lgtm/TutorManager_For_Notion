import { useState } from 'react';
import { Button } from 'antd';

import { WORKER_URL } from '../config.js';

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
    <div className="h-screen overflow-hidden flex flex-col bg-brand-600">
      {/* 상단 로고 영역 */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 pb-6">
        <img
          src={`${import.meta.env.BASE_URL}logo/logo-white.png`}
          alt="하늘하늘 중국어"
          className="w-56 object-contain drop-shadow-sm"
        />
        <p className="text-white/70 text-sm mt-3 tracking-wide">수업 관리 시스템</p>
      </div>

      {/* 하단 폼 카드 */}
      <div className="bg-gray-50 rounded-t-3xl px-6 pt-7 pb-8 shadow-2xl">
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

          <Button
            type="primary" htmlType="submit" block loading={loading}
            style={{ borderRadius: 12, height: 48, fontSize: 16, fontWeight: 600 }}
          >
            {loading ? '확인 중...' : '로그인'}
          </Button>
        </form>
      </div>
    </div>
  );
}
