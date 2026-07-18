// 성조게임 공용 위젯 — ToneMark(성조 마크 SVG) · useCountUp(숫자 카운트업) · 콤보 칩 · 불꽃 아이콘
import { useState, useEffect } from 'react';
import { TG, TYPE, RADIUS, SPACE } from './tgTokens.js';

// 성조 마크 SVG — 폰트별 두께 편차 제거 위해 동일 stroke-width로 직접 렌더. currentColor 상속.
export function ToneMark({ tone, size = 20 }) {
  const w = size;
  const h = Math.round(size * 0.5);
  const common = {
    width: w, height: h, viewBox: '0 0 24 12',
    fill: 'none', stroke: 'currentColor', strokeWidth: 3,
    strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': true, style: { display: 'block' },
  };
  switch (tone) {
    case 1: return <svg {...common}><line x1="3" y1="6" x2="21" y2="6" /></svg>;
    case 2: return <svg {...common}><line x1="4" y1="10" x2="20" y2="2" /></svg>;
    case 3: return <svg {...common}><polyline points="3,3 12,9 21,3" /></svg>;
    case 4: return <svg {...common}><line x1="4" y1="2" x2="20" y2="10" /></svg>;
    case 0:
      return (
        <svg width={Math.round(size * 0.42)} height={Math.round(size * 0.42)}
             viewBox="0 0 12 12" aria-hidden="true" style={{ display: 'block' }}>
          <circle cx="6" cy="6" r="3" fill="currentColor" />
        </svg>
      );
    default: return null;
  }
}

// 숫자 count-up 애니메이션 훅 — 0→target ease-out cubic. rAF 기반.
export function useCountUp(target, duration = 1200, decimals = 0, delay = 0) {
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    let rafId;
    let startTs = null;
    const tick = (now) => {
      if (startTs === null) startTs = now;
      const elapsed = now - startTs - delay;
      if (elapsed < 0) { rafId = requestAnimationFrame(tick); return; }
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(target * eased);
      if (progress < 1) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [target, duration, delay]);
  return decimals === 0 ? Math.round(current) : Number(current.toFixed(decimals));
}

// 불꽃 아이콘 (Phosphor Flame fill, 단색 플랫)
export function FlameIcon({ size = 14, color = TG.CORAL_DK }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true" style={{ display: 'block' }}>
      <path fill={color} d="M173.79,51.48a221.25,221.25,0,0,0-41.67-34.34,8,8,0,0,0-8.24,0A221.25,221.25,0,0,0,82.21,51.48C54.59,80.48,40,112.47,40,144a88,88,0,0,0,176,0C216,112.47,201.41,80.48,173.79,51.48ZM96,184c0-27.67,22.53-47.28,32-54.3,9.48,7,32,26.63,32,54.3a32,32,0,0,1-64,0Z" />
    </svg>
  );
}

// 콤보 칩 — 소프트 코랄 틴트 + 플랫 불꽃 + 숫자 + '콤보' (메모리 §6 확정안). combo>=2일 때만 표시.
export function ComboChip({ combo, flash }) {
  if (combo < 2) return null;
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: SPACE.xs,
      padding: '5px 11px 6px 9px',
      borderRadius: RADIUS.md,
      background: TG.CORAL_BG,
      transform: flash ? 'scale(1.12)' : 'scale(1)',
      transition: 'transform 220ms cubic-bezier(0.34,1.56,0.64,1)',
    }}>
      <FlameIcon size={14} color={TG.CORAL_DK} />
      <span style={{ ...TYPE.numMd, fontSize: 18, lineHeight: 1, color: TG.CORAL_DK }}>{combo}</span>
      <span style={{ fontFamily: 'inherit', fontWeight: 700, fontSize: 11, color: TG.CORAL_DK, opacity: 0.72 }}>콤보</span>
    </div>
  );
}
