// 게임 전면(인터스티셜) 광고 — 웹(PWA) 부수입 실험. Google AdSense H5 Games Ads(adBreak) 사용.
// ⚠️ 게임 라우트에서만 로드/호출(강사·학생앱엔 절대 노출 금지 — ToneGamePage에서만 import).
//   전면은 ROUND_INTERVAL판마다 1회. 기본 OFF — 아래 AD_CLIENT 채우고 AD_ENABLED=true 로 켠다.
//   꺼져 있으면 스크립트 로드/전역 오염 없이 완전 무동작(앱 영향 0)이라, 승인 대기 중 미리 붙여둬도 안전.
//
// 켜기 전 체크리스트(사용자):
//   1) Google AdSense 승인 + 게시자 ID(ca-pub-...) 발급 → AD_CLIENT 입력, AD_ENABLED=true
//   2) 개인정보처리방침에 광고·쿠키 고지 추가, (EEA/UK 대상) Google UMP 동의 연동
//   3) PWA CSP(script-src)에 https://pagead2.googlesyndication.com 등 허용
//   4) 게임을 AdSense 'H5 게임 광고'로 설정(전면 지면)

const AD_CLIENT = '';        // AdSense 게시자 ID: 'ca-pub-XXXXXXXXXXXXXXXX' (승인 후 입력)
const AD_ENABLED = false;    // 실험 토글 — AD_CLIENT 채우고 true 로
const ROUND_INTERVAL = 3;    // N판마다 전면 1회 (사용자 요청: 3판)

const on = () => AD_ENABLED && !!AD_CLIENT && typeof window !== 'undefined' && typeof document !== 'undefined';

let loaded = false;
let rounds = 0;

function ensureScript() {
  if (loaded) return;
  loaded = true;
  window.adsbygoogle = window.adsbygoogle || [];
  // adConfig/adBreak 스텁(스크립트 로드 전 호출 큐잉) — H5 Games Ads 표준 패턴
  window.adBreak = window.adBreak || function (o) { (window.adsbygoogle = window.adsbygoogle || []).push(o); };
  window.adConfig = window.adConfig || function (o) { (window.adsbygoogle = window.adsbygoogle || []).push(o); };
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${AD_CLIENT}`;
  s.setAttribute('data-ad-frequency-hint', `${ROUND_INTERVAL * 45}s`);
  document.head.appendChild(s);
  window.adConfig({ preloadAdBreaks: 'on' });
}

// 게임 진입 시 1회. 꺼져 있으면 아무 것도 안 함.
export function initGameAds() {
  if (!on()) return;
  try { ensureScript(); } catch { /* noop */ }
}

// 라운드(한 판) 종료 시 호출 — ROUND_INTERVAL판마다 전면 1회. 꺼져 있으면 무동작.
export function onRoundEnd() {
  if (!on()) return;
  rounds += 1;
  if (rounds % ROUND_INTERVAL !== 0 || typeof window.adBreak !== 'function') return;
  try { window.adBreak({ type: 'next', name: `round-${rounds}` }); } catch { /* noop */ }
}
