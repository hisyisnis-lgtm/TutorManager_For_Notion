import { useState } from 'react';
import { Button } from '@/components/shadcn/button';
import { Input } from '@/components/shadcn/input';
import { GRADIENTS, TEXT_PRIMARY, TEXT_TERTIARY, STATUS_ERROR_TEXT } from '../constants/theme.js';

import { WORKER_URL } from '../config.js';

// 공개 랜딩 HeroSection과 같은 어법의 한자 파티클 — 로그인은 '시작 화면'이라
// 의도 배치 한자가 허용되는 예외(§18-1). 로그인은 히어로보다 조용해야 해서 6자만.
const HANZI_FONT = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Heiti SC", sans-serif';
const HANZI_PARTICLES = [
  { char: '好', left: '8%',  bottom: '18%', size: 22, delay: '0s',   dur: '8s'   },
  { char: '学', left: '26%', bottom: '8%',  size: 15, delay: '2.4s', dur: '7s'   },
  { char: '语', left: '48%', bottom: '13%', size: 18, delay: '1.1s', dur: '8.5s' },
  { char: '中', left: '68%', bottom: '6%',  size: 21, delay: '3.2s', dur: '7.5s' },
  { char: '文', left: '85%', bottom: '16%', size: 15, delay: '0.7s', dur: '6.5s' },
  { char: '说', left: '15%', bottom: '38%', size: 14, delay: '4.1s', dur: '9s'   },
];

export default function LoginPage({ onSuccess }) {
  const [pin, setPin] = useState('');
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
      localStorage.setItem('auth_token', token);
      // 이 디바이스/브라우저는 강사용임을 표시. 토큰이 만료·삭제돼도 남아 있어
      // 루트 진입 시 학생 페이지로 자동 리다이렉트되는 것을 막는다 (App.jsx 참고).
      localStorage.setItem('teacher_device', '1');
      onSuccess(token);
    } catch {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  }

  return (
    // h-screen → 100dvh: iOS Safari에서 주소창 높이만큼 뛰는 문제 방지
    <div className="relative min-h-[100dvh] overflow-hidden flex flex-col" style={{ background: GRADIENTS.hero }}>
      {/* 단색 브랜드 면이 밋밋하지 않게 은은한 광원 두 겹 — On-Primary 화이트 알파 어법(§2.2).
          장식 요소는 이것뿐, 한자 워터마크류 금지(§18-1) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(420px 320px at 18% 10%, rgba(255,255,255,0.10), transparent 70%), ' +
            'radial-gradient(560px 440px at 90% 42%, rgba(255,255,255,0.06), transparent 70%)',
        }}
      />

      {/* 상단 로고 영역 */}
      <div className="relative flex-1 flex flex-col items-center justify-center px-8 pb-6">
        {/* 한자 파티클 — 히어로와 같은 hanziFloat, 하단에서 피어올라 흩어진다 */}
        {HANZI_PARTICLES.map(({ char, left, bottom, size, delay, dur }) => (
          <span
            key={`${char}-${left}`}
            aria-hidden="true"
            style={{
              position: 'absolute', left, bottom,
              fontSize: size, lineHeight: 1,
              color: 'white', fontFamily: HANZI_FONT,
              animation: `hanziFloat ${dur} ease-in-out ${delay} infinite both`,
              pointerEvents: 'none', userSelect: 'none',
            }}
          >{char}</span>
        ))}
        <div
          className="relative flex flex-col items-center"
          style={{ animation: 'fade-in-up 500ms var(--ease-out) both' }}
        >
          <img
            src={`${import.meta.env.BASE_URL}logo/logo-white.png`}
            alt="하늘하늘 중국어"
            className="w-56 object-contain drop-shadow-sm"
          />
          <p className="text-white/70 text-sm mt-3 tracking-[0.18em] break-keep">수업 관리 시스템</p>
        </div>
      </div>

      {/* 하단 폼 시트 — 모달급 그림자 토큰(§6.3) + 홈 인디케이터 safe-area */}
      <div
        className="relative bg-white rounded-t-3xl px-6 pt-8"
        style={{
          boxShadow: 'var(--shadow-modal)',
          paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))',
          animation: 'fade-in-up 400ms var(--ease-out) 60ms both',
        }}
      >
        {/* 브랜드가 하는 인사 — 실사용 표현만(欢迎回来 = 돌아온 걸 환영해요) */}
        <h2 className="text-xl font-bold text-center tracking-tight" style={{ color: TEXT_PRIMARY, fontFamily: HANZI_FONT }}>
          欢迎回来
        </h2>
        <p className="text-[13px] text-center mt-1.5 mb-6 break-keep" style={{ color: TEXT_TERTIARY }}>
          다시 오셨네요 — 강사 계정 비밀번호를 입력해주세요
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Input
              type="password"
              value={pin}
              onChange={e => { setPin(e.target.value); setError(''); }}
              placeholder="비밀번호"
              aria-label="비밀번호"
              className="h-12 text-center text-lg font-semibold tracking-[0.35em] placeholder:tracking-normal placeholder:font-normal"
              autoFocus
              disabled={loading}
            />
            {error && (
              <p role="alert" className="text-sm mt-2 text-center font-semibold" style={{ color: STATUS_ERROR_TEXT }}>
                {error}
              </p>
            )}
          </div>

          <Button
            type="submit" size="lg" block loading={loading}
            className="text-base font-bold"
          >
            {loading ? '확인 중...' : '로그인'}
          </Button>
        </form>
      </div>
    </div>
  );
}
