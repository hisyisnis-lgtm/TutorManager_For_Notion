// 타이틀 화면 — 배경 아트 + 큰 타이틀 로고(프리미엄 효과) + "터치하여 시작하기".
// 화면 어디든 터치하면 홈 허브로(onStart). 좌상단 닫기로 게임 나가기(onClose).
// Figma "24. 타이틀". 스플래시(로딩) 다음의 영구 진입 관문.
import { CaretLeftIcon } from '@phosphor-icons/react';
import { TG, FONT_BODY, TOUCH_OPT, ASSETS } from '../tgTokens.js';
import { FigmaScreen } from './shared.jsx';

// 반짝임 파티클 — 4점 별
function Sparkle({ s, size = 14, delay = 0 }) {
  return (
    <div style={{ position: 'absolute', width: size, height: size, zIndex: 3, pointerEvents: 'none', animation: `tg-sparkle 2.8s ease-in-out ${delay}s infinite`, ...s }}>
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <path d="M12 0 L14.4 9.6 L24 12 L14.4 14.4 L12 24 L9.6 14.4 L0 12 L9.6 9.6 Z" fill="#FFC23C" />
      </svg>
    </div>
  );
}

export function TitleScreen({ onStart, onClose }) {
  return (
    <FigmaScreen bgImage={ASSETS.startBg}>
      {/* 화면 전체 터치 시작 */}
      <div onClick={() => onStart && onStart()} style={{ position: 'absolute', inset: 0, cursor: 'pointer', ...TOUCH_OPT }}>
        {/* 닫기(나가기) */}
        <button onClick={(e) => { e.stopPropagation(); onClose && onClose(); }} aria-label="닫기" className="tg-press"
          style={{ position: 'absolute', left: 24, top: 20, width: 40, height: 40, borderRadius: 20, background: '#fff', boxShadow: '0px 3px 5px rgba(43,39,48,0.08)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 4, ...TOUCH_OPT }}>
          <CaretLeftIcon weight="bold" size={20} color={TG.INK} />
        </button>
        {/* 타이틀 로고 (중앙) — 진입 팝 + 빛 스윕 + 반짝임 */}
        <div style={{ position: 'absolute', top: '26%', left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 344 }}>
          <div style={{ position: 'relative' }}>
            <img src={ASSETS.startTitle} alt="성조 빨리찾기" style={{ position: 'relative', zIndex: 1, display: 'block', width: '100%', height: 'auto', objectFit: 'contain', animation: 'tg-logo-pop .7s cubic-bezier(.34,1.56,.64,1) both' }} />
            <div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none',
              WebkitMaskImage: `url(${ASSETS.startTitle})`, maskImage: `url(${ASSETS.startTitle})`,
              WebkitMaskSize: 'contain', maskSize: 'contain', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat', WebkitMaskPosition: 'center', maskPosition: 'center',
              background: 'linear-gradient(120deg, transparent 40%, rgba(255,255,255,0.42) 50%, transparent 60%)', backgroundSize: '300% 100%',
              animation: 'tg-shine 7s ease-in-out 1.2s infinite' }} />
            <Sparkle s={{ top: '-9%', left: '5%' }} size={16} delay={0.4} />
            <Sparkle s={{ top: '12%', right: '1%' }} size={12} delay={1.8} />
            <Sparkle s={{ bottom: '-2%', left: '22%' }} size={13} delay={3.0} />
          </div>
        </div>
        {/* 터치 힌트 — 맥동 + 둥둥 */}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 'calc(96px + env(safe-area-inset-bottom))', display: 'flex', justifyContent: 'center', animation: 'tg-pulse 1.8s ease-in-out infinite' }}>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15, color: '#fff', background: 'rgba(43,39,48,0.55)', padding: '9px 20px', borderRadius: 999, boxShadow: '0 4px 12px rgba(43,39,48,0.18)' }}>터치하여 시작하기</span>
        </div>
      </div>
    </FigmaScreen>
  );
}
