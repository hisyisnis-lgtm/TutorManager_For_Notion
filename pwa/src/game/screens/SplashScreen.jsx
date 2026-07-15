// 스플래시 — 게임 진입 시 짧게. 제작사 브랜드 컷(하늘하늘중국어, ≈1.1s) → 게임 로고+로딩점 순차.
// 전체 노출 시간은 ToneGamePage의 스플래시 해제 타이머가 관리(브랜드 컷 포함 2.7s). Figma "28. 브랜드 스플래시".
import { useEffect, useState } from 'react';
import { TG, ASSETS } from '../tgTokens.js';
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
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 26 }}>
          <img src={ASSETS.startTitle} alt="성조 빨리찾기" style={{ width: 300, height: 'auto', objectFit: 'contain', animation: 'tg-enter .5s cubic-bezier(.22,1,.36,1) both' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ width: 9, height: 9, borderRadius: 999, background: TG.CORAL, animation: `tg-dot .9s ease-in-out ${i * 0.15}s infinite` }} />
            ))}
          </div>
        </div>
      )}
    </FigmaScreen>
  );
}
