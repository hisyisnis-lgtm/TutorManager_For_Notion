// 스플래시 — 게임 진입 시 짧게. 제작사 브랜드 컷(하늘하늘중국어, ≈1.1s) → 게임 로고+로딩점 순차.
// 전체 노출 시간은 ToneGamePage의 스플래시 해제 타이머가 관리(브랜드 컷 포함 2.7s). Figma "28. 브랜드 스플래시".
import { useEffect, useState } from 'react';
import { TG, ASSETS, RADIUS, SPACE } from '../tgTokens.js';
import { FigmaScreen } from './shared.jsx';

const BRAND_CUT_MS = 1100;

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
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: SPACE.x4 }}>
          {/* 게임 로고 — 타이틀 리디자인의 레터링 SVG(매일매일 성조키우기)로 교체(2026-07-28) */}
          <img src="/game/title-logo.svg" alt="매일매일 성조키우기" style={{ width: 290, height: 'auto', objectFit: 'contain', animation: 'tg-enter .5s cubic-bezier(.22,1,.36,1) both' }} />
          <div style={{ display: 'flex', gap: SPACE.md }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ width: 9, height: 9, borderRadius: RADIUS.pill, background: TG.CORAL, animation: `tg-dot .9s ease-in-out ${i * 0.15}s infinite` }} />
            ))}
          </div>
        </div>
      )}
    </FigmaScreen>
  );
}
