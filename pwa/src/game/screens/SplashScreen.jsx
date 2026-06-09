// 스플래시 — 게임 진입 시 짧게(로고+로딩점). 로딩 상태도 겸함.
import { TG, ASSETS } from '../tgTokens.js';
import { FigmaScreen } from './shared.jsx';

export function SplashScreen() {
  return (
    <FigmaScreen>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 26 }}>
        <img src={ASSETS.startTitle} alt="성조 빨리찾기" style={{ width: 300, height: 'auto', objectFit: 'contain', animation: 'tg-enter .5s cubic-bezier(.22,1,.36,1) both' }} />
        <div style={{ display: 'flex', gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ width: 9, height: 9, borderRadius: 999, background: TG.CORAL, animation: `tg-dot .9s ease-in-out ${i * 0.15}s infinite` }} />
          ))}
        </div>
      </div>
    </FigmaScreen>
  );
}
