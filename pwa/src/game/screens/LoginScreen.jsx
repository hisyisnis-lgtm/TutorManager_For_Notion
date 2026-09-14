// 로그인(회원) — 카카오·구글 소셜 로그인(OAuth BFF). 버튼 탭 → Worker 인증 시작 URL로 전체 이동,
// 제공자 인증 후 일회 교환 코드로 복귀(브라우저 거래 검증은 ToneGamePage). Figma "18b. 로그인(소셜)".
import { TG, TYPE, TOUCH_OPT, ASSETS, RADIUS, SPACE } from '../tgTokens.js';
import { socialLoginUrl } from '../../api/gameApi.js';
import { SITE_ORIGIN } from '../../constants.js';
import { play as playSfx } from '../tgSfx.js';
import { Reveal, BackButton } from './shared.jsx';

// 소셜 로그인 시작 — 브라우저 거래를 보관한 뒤 제공자 인증 URL로 이동. LoginScreen·ProfileModal 공용.
export async function startSocialLogin(provider) {
  playSfx('button');
  const redirect = window.location.origin + window.location.pathname; // 현재 게임 주소로 복귀
  try {
    window.location.href = await socialLoginUrl(provider, redirect);
  } catch {
    window.alert('로그인을 시작하지 못했어요. 브라우저 저장소를 허용한 뒤 다시 시도해주세요.');
  }
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

// 소셜 로그인 버튼(공용) — LoginScreen(56·btn)·ProfileModal(52·btnSm)이 공유.
// 색은 제공자 브랜드 규격 고정(카카오 #FEE500 / 구글 흰 배경 + 보더 #747775 — Google 가이드라인 값이라 토큰화 대상 아님).
export function SocialLoginButton({ provider, height = 56, labelType = TYPE.btn }) {
  const kakao = provider === 'kakao';
  return (
    <button onClick={() => startSocialLogin(provider)} className="tg-press" style={{
      width: '100%', height, borderRadius: RADIUS.lg, cursor: 'pointer',
      border: kakao ? 'none' : '1px solid #747775' /* BRAND — Google 로그인 규격 */, background: kakao ? '#FEE500' : '#fff', // BRAND — 카카오 규격색
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: kakao ? SPACE.md : SPACE.lg, ...TOUCH_OPT,
    }}>
      {kakao ? <KakaoLogo /> : <GoogleLogo />}
      <span style={{ ...labelType, color: kakao ? 'rgba(0,0,0,0.85)' : '#1f1f1f' }}>{kakao ? '카카오로 시작하기' : 'Google로 계속하기'}</span>
    </button>
  );
}

export function LoginScreen({ onBack }) {
  return (
    <>
      {/* ⚠️ 들판 실루엣(FieldBg)은 여기 깔지 말 것 — 하단 법정 문구(만 14세·방침)가 나무 위에 얹혀 대비 1.7까지 떨어진다(2026-09-03 실측) */}
      {/* 뒤로 — 공용 BackButton */}
      <Reveal i={0} style={{ position: 'absolute', left: 24, top: 20, zIndex: 3 }}>
        <BackButton onClick={onBack} />
      </Reveal>

      {/* 설명·로그인 선택·이용 안내를 하나의 흐름으로 묶고, 짧은 화면에서는 내용이 스크롤된다. */}
      <div className="tg-noscroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{
          minHeight: '100%', boxSizing: 'border-box', padding: '88px 24px calc(24px + env(safe-area-inset-bottom))',
          display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: SPACE.x4,
        }}>
          <Reveal i={1}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.x2, textAlign: 'center' }}>
              <img src={ASSETS.pandaCoach} alt="" width={140} style={{ height: 'auto', filter: 'drop-shadow(0px 6px 14px rgba(43,39,48,0.12))', animation: 'tg-bob 3s ease-in-out infinite' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
                <span style={{ ...TYPE.titleLg, lineHeight: '32px', color: TG.INK, textWrap: 'balance' }}>로그인하고 기록을 지켜요</span>
                <span style={{ ...TYPE.sub, lineHeight: '20px', color: TG.SUB, textWrap: 'pretty' }}>기기를 바꿔도 최고 점수·진도가 그대로예요</span>
              </div>
            </div>
          </Reveal>

          <Reveal i={2}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
              <SocialLoginButton provider="kakao" />
              <SocialLoginButton provider="google" />
            </div>
            {/* 만 14세 안내와 방침 링크는 로그인 선택과 함께 보이게 유지한다. */}
            <div style={{ marginTop: SPACE.x2, textAlign: 'center' }}>
              <span style={{ ...TYPE.meta, color: TG.SUB, display: 'block', lineHeight: '18px' }}>로그인 정보는 기록 저장·동기화에만 써요</span>
              <span style={{ ...TYPE.meta, color: TG.SUB, display: 'block', lineHeight: '18px', marginTop: SPACE.xs, textWrap: 'pretty' }}>
                만 14세 이상만 로그인할 수 있어요 ·{' '}
                <a
                  href={`${import.meta.env.MODE === 'game-site' ? SITE_ORIGIN : window.location.origin}/#/privacy`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: TG.SUB, textDecoration: 'underline', textUnderlineOffset: 2 }}
                >
                  개인정보처리방침
                </a>
              </span>
            </div>
          </Reveal>
        </div>
      </div>
    </>
  );
}
