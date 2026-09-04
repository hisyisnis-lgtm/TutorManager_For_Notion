// 성조게임 공용 위젯 — ToneMark(성조 마크 SVG) · useCountUp(숫자 카운트업) · 콤보 칩 · 불꽃 아이콘
import { useState, useEffect, useRef } from 'react';
import { TG, TYPE, RADIUS, SPACE } from './tgTokens.js';

// 성조 마크 SVG — 폰트별 두께 편차 제거 위해 동일 stroke-width로 직접 렌더. currentColor 상속.
// outline: 획 뒤에 두를 외곽선 색(옵션) — 키캡 버튼 등 마크를 배경보다 어두운 선으로 도드라지게(2패스: 굵은 외곽선→흰 획).
// stroke/dotR — 시안 실측값 주입용(뷰박스 단위). 09 게임 키캡은 획 8px·경성 점 14px라 기본값(3/3)보다 굵다.
export function ToneMark({ tone, size = 20, outline, stroke, dotR }) {
  const w = size;
  const h = Math.round(size * 0.5);
  const common = {
    width: w, height: h, viewBox: '0 0 24 12',
    // 외곽선 모드(키캡)에선 흰 획도 살짝 두껍게(3→4) — 사용자 "획 조금만 두껍게" (2026-07-26)
    fill: 'none', stroke: 'currentColor', strokeWidth: stroke != null ? stroke : (outline ? 4 : 3),
    strokeLinecap: 'round', strokeLinejoin: 'round',
    // 외곽선 패스가 viewBox를 살짝 넘어도 잘리지 않게
    'aria-hidden': true, style: { display: 'block', overflow: 'visible' },
  };
  const back = outline ? { stroke: outline, strokeWidth: 6.8 } : null;
  const shape = {
    1: (p) => <line x1="3" y1="6" x2="21" y2="6" {...p} />,
    2: (p) => <line x1="4" y1="10" x2="20" y2="2" {...p} />,
    3: (p) => <polyline points="3,3 12,9 21,3" {...p} />,
    4: (p) => <line x1="4" y1="2" x2="20" y2="10" {...p} />,
  }[tone];
  if (shape) return <svg {...common}>{back && shape(back)}{shape({})}</svg>;
  if (tone === 0) {
    return (
      <svg width={Math.round(size * 0.42)} height={Math.round(size * 0.42)}
           viewBox="0 0 12 12" aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
        {outline && <circle cx="6" cy="6" r="4.8" fill={outline} />}
        <circle cx="6" cy="6" r={dotR != null ? dotR : (outline ? 3.4 : 3)} fill="currentColor" />
      </svg>
    );
  }
  return null;
}

// 모바일 소프트 키보드가 화면 하단을 덮는 높이(px) — 없으면 0. visualViewport 기준.
//  ★iOS Safari는 키보드가 올라와도 position:fixed/absolute 하단 고정 요소를 밀어주지 않는다(레이아웃 뷰포트 불변)
//    → 하단 CTA가 키보드에 가려진다. 이 값만큼 띄워 키보드 바로 위에 붙인다.
//  60px 미만 차이는 주소창 접힘 등 노이즈라 무시(키보드로 오인 방지).
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return undefined; // 미지원 브라우저 — 기존 하단 고정 그대로
    const update = () => {
      const overlap = window.innerHeight - vv.height - vv.offsetTop;
      setInset(overlap > 60 ? Math.round(overlap) : 0);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
  }, []);
  return inset;
}

// 숫자 count-up 애니메이션 훅 — 직전 표시값→target ease-out cubic. rAF 기반.
// target이 '쾅'처럼 여러 스텝으로 올라도 매번 0으로 리셋하지 않고 현재값에서 이어 올라 단조 증가(XpGainReveal 등).
export function useCountUp(target, duration = 1200, decimals = 0, delay = 0) {
  const [current, setCurrent] = useState(0);
  const currentRef = useRef(0);
  currentRef.current = current;
  useEffect(() => {
    let rafId;
    let startTs = null;
    const from = currentRef.current; // 이 애니메이션의 시작값 = 현재 화면에 보이는 값
    const tick = (now) => {
      if (startTs === null) startTs = now;
      const elapsed = now - startTs - delay;
      if (elapsed < 0) { rafId = requestAnimationFrame(tick); return; }
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(from + (target - from) * eased);
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

// 콤보 칩 — 시안 09-3(2026-08-04): 불꽃·틴트 없이 웜화이트 칩에 '콤보 x6'. 카드 밖(화면 y143 중앙)에 배치. combo>=2일 때만 표시.
export function ComboChip({ combo, flash }) {
  if (combo < 2) return null;
  return (
    // 시안 09-3 실측: 75×30 · r12 · 배경 #FFFCF8 · 좌9/우11 · 간격4 · '콤보' 16 CORAL_DK + 'x6' 18 INK
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: SPACE.xs,
      height: 30, padding: '0 11px 0 9px',
      borderRadius: RADIUS.md,
      background: TG.BG,
      transform: flash ? 'scale(1.12)' : 'scale(1)',
      transition: 'transform 220ms cubic-bezier(0.34,1.56,0.64,1)',
    }}>
      <span style={{ ...TYPE.btn, color: TG.CORAL_DK }}>콤보</span>
      <span style={{ ...TYPE.numMd, fontSize: 18, lineHeight: 1, color: TG.INK }}>x{combo}</span>
    </div>
  );
}
