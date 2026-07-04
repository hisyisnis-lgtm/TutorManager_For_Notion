// [임시·DEV 검수용] 파티클 랩 — 미리보기 URL `?screen=fx` 로 진입.
// 어두운 배경에서 버튼으로 반복 발사해 파티클 움직임 퀄리티를 확인한다. 검수 끝나면 이 파일 + ToneGamePage의 'fx' 분기 삭제.
import { useState } from 'react';
import { FONT_TITLE, FONT_BODY, TG, TOUCH_OPT } from '../tgTokens.js';
import { CaretLeftIcon } from '@phosphor-icons/react';
import { ConfettiBurst, CrispFlash, LIGHT_CONFETTI, ToneGameStyles } from './shared.jsx';

const VARIANTS = {
  complete: { label: '정답 완성', count: 16, power: 0.85, size: 9, flash: 90 },
  result: { label: '신기록 축하', count: 32, power: 1.35, size: 10, flash: 150 },
  big: { label: '대형 테스트', count: 60, power: 1.7, size: 12, flash: 200 },
};

export function ParticleLab({ onBack }) {
  const [fireKey, setFireKey] = useState(1);
  const [variant, setVariant] = useState('result');
  const fire = (v) => { setVariant(v); setFireKey((n) => n + 1); };
  const c = VARIANTS[variant];
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 40%, #2b3040, #191c25)', overflow: 'hidden' }}>
      <ToneGameStyles />{/* 키프레임(tg-shock 등) 주입 — 랩은 FigmaScreen 밖이라 직접 필요 */}
      {/* 헤더 */}
      <div style={{ position: 'absolute', top: 20, left: 24, right: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} aria-label="뒤로" className="tg-press" style={{ width: 40, height: 40, borderRadius: 20, background: 'rgba(255,255,255,0.1)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT }}>
          <CaretLeftIcon size={20} weight="bold" color="#fff" />
        </button>
        <span style={{ fontFamily: FONT_TITLE, fontSize: 20, color: '#fff' }}>파티클 검수 (임시)</span>
      </div>

      {/* 발사 지점 = 화면 중앙. ConfettiBurst 는 부모(0×0)의 50%/50% = 이 지점에서 터진다. key 변경 시 재발사 */}
      <div style={{ position: 'absolute', left: '50%', top: '42%', width: 0, height: 0 }}>
        <CrispFlash key={`f-${fireKey}`} radial color="rgba(255,255,255,0.95)" zIndex={7}
          style={{ inset: 'auto', left: 0, top: 0, width: c.flash * 2, height: c.flash * 2, marginLeft: -c.flash, marginTop: -c.flash, borderRadius: '50%' }} />
        <ConfettiBurst key={fireKey} count={c.count} power={c.power} size={c.size} zIndex={5} />
        <ConfettiBurst key={`g-${fireKey}`} colors={LIGHT_CONFETTI} count={Math.round(c.count * 0.55)} power={c.power} size={c.size * 0.55} zIndex={6} />
        <div aria-hidden="true" style={{ position: 'absolute', left: -3, top: -3, width: 6, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.3)' }} />
      </div>

      {/* 컨트롤 */}
      <div style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(40px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <span style={{ textAlign: 'center', fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: 'rgba(255,255,255,0.72)' }}>
          {c.label} · count {c.count} · power {c.power}
        </span>
        <div style={{ display: 'flex', gap: 10 }}>
          {[['complete', '정답 완성'], ['result', '🎉 신기록'], ['big', '대형']].map(([v, label]) => (
            <button key={v} onClick={() => fire(v)} className="tg-press" style={{
              flex: 1, minWidth: 0, height: 56, borderRadius: 16, border: 'none', cursor: 'pointer',
              background: variant === v ? TG.CORAL_GRAD : 'rgba(255,255,255,0.12)',
              boxShadow: variant === v ? '0 8px 18px rgba(242,72,76,0.3)' : 'none',
              fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14.5, color: '#fff', ...TOUCH_OPT,
            }}>{label}</button>
          ))}
        </div>
        <button onClick={() => setFireKey((n) => n + 1)} className="tg-press" style={{
          width: '100%', height: 60, borderRadius: 18, border: '1.5px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.06)',
          cursor: 'pointer', fontFamily: FONT_BODY, fontWeight: 800, fontSize: 17, color: '#fff', ...TOUCH_OPT,
        }}>다시 터뜨리기 ✦</button>
      </div>
    </div>
  );
}
