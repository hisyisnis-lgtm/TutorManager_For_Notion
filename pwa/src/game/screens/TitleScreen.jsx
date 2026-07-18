// 타이틀 화면 — 배경 아트 + 큰 타이틀 로고(프리미엄 효과) + 태그라인 + 성조 캐릭터 무대 + "터치하여 시작하기".
// 화면 어디든 터치하면 홈 허브로(onStart). 좌상단 닫기로 게임 나가기(onClose).
// Figma "24. 타이틀". 스플래시(로딩) 다음의 영구 진입 관문. 캐릭터=홈 성조마크 룩 재사용(가벼운 정적판).
import { TYPE, TOUCH_OPT, ASSETS } from '../tgTokens.js';
import { TONES } from '../../constants/toneGameWords.js';
import { ToneMark } from '../tgWidgets.jsx';
import { FigmaScreen } from './shared.jsx';
import { Eyes, markSize } from './eyes.jsx';

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

// 타이틀 캐릭터 — 정지판(둥둥 + 고정 기울임). 홈 마크 룩 그대로, 스케일만 축소. 눈은 공용 eyes.jsx 사용.
const TILTS = [-8, 6, 0, -6, 8];
function TitleMark({ tone, i }) {
  return (
    <div style={{ position: 'relative', width: 60, display: 'flex', justifyContent: 'center' }}>
      {/* 접지 그림자 */}
      <div style={{ position: 'absolute', left: '50%', bottom: -6, transform: 'translateX(-50%)', width: 40, height: 9, borderRadius: '50%', background: 'rgba(70,62,52,0.14)', filter: 'blur(1.5px)' }} />
      <div style={{ transform: 'scale(.8)', transformOrigin: 'center bottom', animation: `tg-bob ${2.4 + i * 0.35}s ease-in-out ${i * 0.22}s infinite` }}>
        <div style={{ position: 'relative', display: 'inline-block', color: tone.color, transform: `rotate(${TILTS[i] || 0}deg)` }}>
          <ToneMark tone={tone.num} size={markSize(tone.num)} />
          {/* i 환산(num/1.4): 기존 이 화면의 깜빡임 딜레이(num*0.5s)를 정본 delay식(i*0.7s)으로 그대로 보존 */}
          <Eyes num={tone.num} i={tone.num / 1.4} />
        </div>
      </div>
    </div>
  );
}

export function TitleScreen({ onStart }) {
  return (
    <FigmaScreen bgImage={ASSETS.startBg}>
      {/* 화면 전체 터치 시작 (뒤로가기 버튼 없음 — 나가기는 홈 메뉴에서) */}
      <div onClick={() => onStart && onStart()} style={{ position: 'absolute', inset: 0, cursor: 'pointer', ...TOUCH_OPT }}>
        {/* 타이틀 로고 (상단) */}
        <div style={{ position: 'absolute', top: '11%', left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 300, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ position: 'relative', width: '100%' }}>
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

        {/* 캐릭터 말풍선 — 태그라인을 캐릭터가 말하는 느낌으로(꼬리 아래=캐릭터 향함) */}
        {/* 바깥=정렬(translateX-50%), 안쪽=등장 애니(tg-reveal의 transform이 정렬을 안 덮게 분리) */}
        <div style={{ position: 'absolute', left: '50%', top: '49%', transform: 'translateX(-50%)' }}>
          <div className="tg-reveal" style={{ animationDelay: '.55s' }}>
            <div style={{ position: 'relative', background: '#3c3c3c', color: '#fff', ...TYPE.head, fontSize: 16, padding: '10px 18px', borderRadius: 16, boxShadow: '0 5px 14px rgba(43,39,48,0.2)', whiteSpace: 'nowrap' }}>
              듣고 빠르게! 성조 찾기
              {/* 꼬리 */}
              <div style={{ position: 'absolute', left: '50%', bottom: -8, transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '8px solid transparent', borderRight: '8px solid transparent', borderTop: '9px solid #3c3c3c' }} />
            </div>
          </div>
        </div>

        {/* 성조 캐릭터 무대 (가운데 빈 공간) */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: '58%', display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: 6, pointerEvents: 'none' }}>
          {TONES.map((t, i) => <TitleMark key={t.num} tone={t} i={i} />)}
        </div>

        {/* 터치 힌트 — 맥동 + 둥둥 */}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 'calc(96px + env(safe-area-inset-bottom))', display: 'flex', justifyContent: 'center', animation: 'tg-pulse 1.8s ease-in-out infinite' }}>
          <span style={{ ...TYPE.btnSm, color: '#fff', background: 'rgba(43,39,48,0.55)', padding: '9px 20px', borderRadius: 999, boxShadow: '0 4px 12px rgba(43,39,48,0.18)' }}>터치하여 시작하기</span>
        </div>
      </div>
    </FigmaScreen>
  );
}
