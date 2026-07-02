import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TEXT_PRIMARY } from '../../constants/theme.js';

const PAD = 10;        // spotlight 여백
const RADIUS = 16;     // spotlight 모서리 반경
const TIP_GAP = 16;    // spotlight ↔ 툴팁 간격
const TIP_H_PAD = 20;  // 툴팁 좌우 여백

function resolveRect(selector) {
  if (!selector) return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    x: r.left - PAD,
    y: r.top - PAD,
    w: r.width + PAD * 2,
    h: r.height + PAD * 2,
    cx: r.left + r.width / 2,
    cy: r.top + r.height / 2,
  };
}

/**
 * 코치마크 오버레이.
 *
 * Props:
 *   steps   — [{ selector: string | null, label: string }]
 *   visible — boolean (useTabTip의 visible)
 *   onDone  — () => void (useTabTip의 dismiss 연결)
 *   delay   — 첫 스포트라이트 계산 전 대기(ms). 기본 350(탭 콘텐츠 async 렌더 대기).
 *             콘텐츠가 이미 떠있는 화면은 작게 줘 빠르게 표시.
 */
export default function CoachMarkOverlay({ steps, visible, onDone, delay = 350, showControls = true }) {
  const [step, setStep]       = useState(0);
  const [rect, setRect]       = useState(null);
  const [mounted, setMounted] = useState(false);
  const [alpha, setAlpha]     = useState(0);   // 페이드 opacity
  const stepRef = useRef(0);                   // 첫 스텝 보정 재측정 가드용

  // visible → true 시 마운트 + fade-in
  useEffect(() => {
    if (!visible) return;
    setStep(0);
    stepRef.current = 0;
    setAlpha(0);
    setMounted(true);
    // delay에 첫 스포트라이트+페이드인. 첫 스텝 요소가 등장 애니(tg-rise 등) 중이면 위치가 어긋나므로
    // 등장이 끝나는 구간까지 몇 차례 재측정해 스냅(여전히 첫 스텝일 때만).
    const timers = [];
    timers.push(setTimeout(() => {
      setRect(resolveRect(steps[0]?.selector));
      requestAnimationFrame(() => setAlpha(1));
    }, delay));
    if (steps[0]?.selector) {
      [220, 420, 620, 820].forEach((off) => timers.push(setTimeout(() => {
        if (stepRef.current === 0) setRect(resolveRect(steps[0].selector));
      }, delay + off)));
    }
    return () => timers.forEach(clearTimeout);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // 코치마크가 열려 있는 동안 스크롤 잠금
  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mounted]);

  const finish = useCallback(() => {
    setAlpha(0);
    setTimeout(() => {
      setMounted(false);
      setStep(0);
      setRect(null);
      onDone();
    }, 220);
  }, [onDone]);

  const advance = useCallback(() => {
    const next = step + 1;
    if (next >= steps.length) { finish(); return; }
    stepRef.current = next; // 첫 스텝 보정 재측정 취소
    // 살짝 dimming 후 spotlight 이동
    setAlpha(0.55);
    setTimeout(() => {
      setRect(resolveRect(steps[next]?.selector));
      setStep(next);
      setAlpha(1);
    }, 160);
  }, [step, steps, finish]);

  if (!mounted) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const current = steps[step];
  // 툴팁·컨트롤은 게임 컬럼(가운데 최대 600px, FigmaScreen과 정합) 안에만 — 포탈(뷰포트 전체)이라 넓은 웹서 가로로 안 늘어나게.
  const COL_W = Math.min(vw, 600);
  const COL_LEFT = Math.round((vw - COL_W) / 2);

  // ── 툴팁 세로 위치 계산 ──────────────────────────────────
  // rect 있으면: element 상단 절반 → 아래에, 하단 절반 → 위에
  // rect 없으면: 화면 상단 35% 위치에 고정
  const hasSpotlight = !!rect;
  const isBelow = hasSpotlight && rect.cy < vh * 0.5;

  let tipTop, tipBottom;
  if (!hasSpotlight) {
    tipTop = Math.round(vh * 0.32);
  } else if (isBelow) {
    tipTop = Math.round(rect.y + rect.h + TIP_GAP);
  } else {
    tipBottom = Math.round(vh - rect.y + TIP_GAP);
  }

  // ── 화살표 가로 위치: element 중심에 정렬, 툴팁 경계(컬럼) 내 클램프 ──
  const tipLeft = COL_LEFT + TIP_H_PAD;
  const tipWidth = COL_W - TIP_H_PAD * 2;
  const arrowLeft = hasSpotlight
    ? Math.max(12, Math.min(tipWidth - 24, rect.cx - tipLeft - 5))
    : tipWidth / 2 - 5;

  // document.body로 포탈 — FigmaScreen 등 transform 조상 안에 두면 position:fixed가 뷰포트가 아닌
  // 그 컨테이너 기준이 돼(넓은 화면서 스포트라이트 구멍이 밀림). 포탈로 빼내 getBoundingClientRect(뷰포트)와 일치.
  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        opacity: alpha,
        transition: 'opacity 0.22s ease-out',
      }}
    >
      {/* ── 어두운 오버레이 + 스포트라이트 홀 ── */}
      <svg
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none',
        }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <mask id="cm-mask">
            <rect width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={rect.x} y={rect.y}
                width={rect.w} height={rect.h}
                rx={RADIUS}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%" height="100%"
          fill="rgba(0,0,0,0.64)"
          mask="url(#cm-mask)"
        />
      </svg>

      {/* ── 탭하면 다음 스텝 ── */}
      <div style={{ position: 'absolute', inset: 0 }} onClick={advance} aria-hidden="true" />

      {/* ── 툴팁 (게임 컬럼 안, 가운데 정렬) ── */}
      <div
        style={{
          position: 'absolute',
          left: tipLeft,
          width: tipWidth,
          ...(tipTop    !== undefined ? { top: tipTop }       : {}),
          ...(tipBottom !== undefined ? { bottom: tipBottom } : {}),
          pointerEvents: 'none',
        }}
      >
        {/* 화살표 다이아몬드 */}
        {hasSpotlight && (
          <div style={{
            position: 'absolute',
            left: arrowLeft,
            ...(isBelow
              ? { top: -5,   borderTop:    '1px solid rgba(0,0,0,0.04)' }
              : { bottom: -5, borderBottom: '1px solid rgba(0,0,0,0.04)' }),
            width: 10, height: 10,
            background: '#fff',
            transform: 'rotate(45deg)',
            boxShadow: isBelow
              ? '-1px -1px 0 rgba(0,0,0,0.04)'
              : '1px 1px 0 rgba(0,0,0,0.04)',
            zIndex: 1,
          }} />
        )}

        {/* 툴팁 본문 */}
        <div style={{
          background: '#fff',
          borderRadius: 16,
          padding: '16px 20px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.24)',
          position: 'relative', zIndex: 2,
        }}>
          <p style={{
            fontSize: 15, fontWeight: 500,
            color: TEXT_PRIMARY, lineHeight: 1.65, margin: 0,
          }}>
            {current?.label}
          </p>
        </div>
      </div>

      {/* ── 하단 컨트롤 (건너뛰기 · 스텝 도트 · 다음/완료). showControls=false면 숨기고 탭으로만 진행 ── */}
      {!showControls && (
        <div style={{
          position: 'absolute',
          bottom: 'max(22px, calc(env(safe-area-inset-bottom) + 22px))',
          left: COL_LEFT, width: COL_W, textAlign: 'center', pointerEvents: 'none',
          color: 'rgba(255,255,255,0.62)', fontSize: 13, fontWeight: 600,
        }}>
          {step >= steps.length - 1 ? '탭하여 완료' : '탭하여 계속'}
        </div>
      )}
      {showControls && (
      <div style={{
        position: 'absolute',
        bottom: 'max(20px, calc(env(safe-area-inset-bottom) + 76px))',
        left: COL_LEFT, width: COL_W,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 28px', boxSizing: 'border-box',
        pointerEvents: 'auto',
      }}>
        {/* 건너뛰기 */}
        <button
          onClick={(e) => { e.stopPropagation(); finish(); }}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: 500,
            padding: '10px 4px', minWidth: 60,
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          건너뛰기
        </button>

        {/* 스텝 도트 */}
        {steps.length > 1 && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {steps.map((_, i) => (
              <div key={i} style={{
                width: i === step ? 20 : 6, height: 6,
                borderRadius: 3,
                background: i === step ? '#fff' : 'rgba(255,255,255,0.32)',
                transition: 'width 0.24s cubic-bezier(0.16,1,0.3,1)',
              }} />
            ))}
          </div>
        )}

        {/* 다음 / 완료 */}
        <button
          onClick={(e) => { e.stopPropagation(); advance(); }}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#fff', fontSize: 14, fontWeight: 700,
            padding: '10px 4px', minWidth: 60, textAlign: 'right',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {step >= steps.length - 1 ? '완료' : '다음 →'}
        </button>
      </div>
      )}
    </div>,
    document.body,
  );
}
