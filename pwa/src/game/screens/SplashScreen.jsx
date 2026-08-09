// 스플래시 — 게임 진입 시 짧게. 로딩 컷(하늘하늘중국어 브랜드, ≈1.1s) → 게임 스플래시 순차.
// 전체 노출 시간은 ToneGamePage의 스플래시 해제 타이머가 관리(로딩 컷 포함 2.7s).
// 시안 "스플래시 — 편집본"(755:2, 2026-08-08) = 흰 과녁(동심원) + 성조 캐릭터 5마리가 **파도타기** + 로고.
//   ※ "로딩 — 편집본"(755:7)은 이 화면이 아니라 **App.jsx의 앱 초기 로드 스플래시**(브랜드 레드)다.
//     여기 브랜드 컷은 시안이 따로 없어 기존(크림 위 빨간 로고) 유지.
import { useEffect, useState } from 'react';
import { TONE_KEY_COLORS } from '../tgTokens.js';
import { TONES } from '../../constants/toneGameWords.js';
import { ToneMark } from '../tgWidgets.jsx';
import { FigmaScreen, RevealRings, prefersReducedMotion } from './shared.jsx';
import { Eyes, markSize } from './eyes.jsx';

const BRAND_CUT_MS = 1100;
// 캐릭터 스케일 — 시안 캐릭터 프레임 폭 30 ÷ 마크 기본 68. 경성(점)도 같은 배율로 18이 되어 시안과 맞는다.
const CH = 30 / 68;
const WAVE_MS = 1500, WAVE_STEP_MS = 130; // 파도타기 주기·이웃 간 시차

// 성조 캐릭터 한 줄 — 시안 169×19(캐릭터 5, 간격 8). 옆으로 차례차례 넘어가는 파도타기.
function ToneWave() {
  const still = prefersReducedMotion();
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
      {TONES.map((t, i) => (
        // ⚠️ tg-wave가 transform을 덮어쓰므로 색·눈을 얹는 래퍼는 **안쪽에 따로** 둔다
        <div key={t.num} style={still ? null : { animation: `tg-wave ${WAVE_MS}ms ease-in-out ${i * WAVE_STEP_MS}ms infinite` }}>
          <div style={{ position: 'relative', display: 'inline-block', color: t.color }}>
            <ToneMark tone={t.num} size={markSize(t.num) * CH} outline={TONE_KEY_COLORS[t.num].dark} />
            <Eyes num={t.num} i={i} scale={CH} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SplashScreen() {
  const [phase, setPhase] = useState('brand');
  useEffect(() => {
    const t = setTimeout(() => setPhase('game'), BRAND_CUT_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <FigmaScreen>
      {phase === 'brand' ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src="/logo/logo-red.png" alt="하늘하늘중국어" style={{ width: 250, height: 'auto', objectFit: 'contain', animation: `tg-brandcut ${BRAND_CUT_MS}ms ease-in-out both` }} />
        </div>
      ) : (
        <>
          {/* 과녁 — 크림 배경이라 흰색 50%(연출 5종의 검정 20%와 대비) */}
          <RevealRings tone="light" />
          {/* 캐릭터 줄 + 로고. 시안 블록(321~468)의 중심이 화면 중심보다 28px 위 */}
          <div style={{
            position: 'absolute', left: 0, right: 0, top: 'calc(50% - 28px)', transform: 'translateY(-50%)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
          }}>
            <ToneWave />
            <img src="/game/title-logo.svg" alt="매일매일 성조키우기" width={290} style={{ height: 'auto', objectFit: 'contain', animation: 'tg-enter .5s cubic-bezier(.22,1,.36,1) both' }} />
          </div>
        </>
      )}
    </FigmaScreen>
  );
}
