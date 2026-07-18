// 로그인(회원) — 카카오·구글 소셜 로그인(OAuth BFF). 버튼 탭 → Worker 인증 시작 URL로 전체 이동,
// 제공자 인증 후 현재 게임 주소로 #token=… 붙여 복귀(복귀 토큰 처리는 ToneGamePage). Figma "18b. 로그인(소셜)".
import { TG, TYPE, TOUCH_OPT, ASSETS, RADIUS } from '../tgTokens.js';
import { socialLoginUrl } from '../../api/gameApi.js';
import { play as playSfx } from '../tgSfx.js';
import { Reveal, BackButton } from './shared.jsx';

// 소셜 로그인 시작 — 제공자 인증 URL로 전체 이동(복귀는 현재 게임 주소로 #token=…). LoginScreen·ProfileModal 공용.
export function startSocialLogin(provider) {
  playSfx('button');
  const redirect = window.location.origin + window.location.pathname; // 현재 게임 주소로 복귀
  window.location.href = socialLoginUrl(provider, redirect);
}

// 카카오 심볼(공식 말풍선) — 노란 버튼 위 검정.
export function KakaoLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M9 1.6C4.86 1.6 1.5 4.2 1.5 7.42c0 2.07 1.38 3.89 3.47 4.94-.15.54-.56 2.02-.64 2.34-.1.4.15.39.3.28.12-.08 1.9-1.29 2.68-1.82.4.06.8.09 1.19.09 4.14 0 7.5-2.6 7.5-5.82S13.14 1.6 9 1.6z" fill="#000000" />
    </svg>
  );
}
// 구글 심볼(공식 4색 G).
export function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

export function LoginScreen({ onBack }) {
  const go = (provider) => startSocialLogin(provider);
  return (
    <>
      {/* 뒤로 — 공용 BackButton */}
      <Reveal i={0} style={{ position: 'absolute', left: 24, top: 20 }}>
        <BackButton onClick={onBack} />
      </Reveal>

      {/* 판다 히어로 (가운데) */}
      <Reveal i={1} style={{ position: 'absolute', left: 0, right: 0, top: 168, display: 'flex', justifyContent: 'center' }}>
        <img src={ASSETS.pandaCoach} alt="" width={140} style={{ height: 'auto', filter: 'drop-shadow(0px 6px 14px rgba(43,39,48,0.12))', animation: 'tg-bob 3s ease-in-out infinite' }} />
      </Reveal>

      {/* 헤드라인 */}
      <Reveal i={2} style={{ position: 'absolute', left: 24, right: 24, top: 330, textAlign: 'center' }}>
        <span style={{ ...TYPE.titleLg, color: TG.INK }}>로그인하고 기록을 지켜요</span>
      </Reveal>
      {/* 보조문구 */}
      <Reveal i={3} style={{ position: 'absolute', left: 24, right: 24, top: 374, textAlign: 'center' }}>
        <span style={{ ...TYPE.sub, color: TG.SUB }}>기기를 바꿔도 최고 점수·진도가 그대로예요</span>
      </Reveal>

      {/* 카카오 로그인 */}
      <Reveal i={4} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(122px + env(safe-area-inset-bottom))' }}>
        <button onClick={() => go('kakao')} className="tg-press" style={{ width: '100%', height: 56, borderRadius: RADIUS.lg, border: 'none', background: '#FEE500', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer', ...TOUCH_OPT }}>
          <KakaoLogo />
          <span style={{ ...TYPE.btn, color: 'rgba(0,0,0,0.85)' }}>카카오로 시작하기</span>
        </button>
      </Reveal>
      {/* 구글 로그인 */}
      <Reveal i={5} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(54px + env(safe-area-inset-bottom))' }}>
        <button onClick={() => go('google')} className="tg-press" style={{ width: '100%', height: 56, borderRadius: RADIUS.lg, border: '1px solid #747775', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer', ...TOUCH_OPT }}>
          <GoogleLogo />
          <span style={{ ...TYPE.btn, color: '#1f1f1f' }}>Google로 계속하기</span>
        </button>
      </Reveal>
      {/* 안내 */}
      <Reveal i={6} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(24px + env(safe-area-inset-bottom))', textAlign: 'center' }}>
        <span style={{ ...TYPE.meta, color: TG.SUB }}>로그인 정보는 기록 저장·동기화에만 써요</span>
      </Reveal>
    </>
  );
}
