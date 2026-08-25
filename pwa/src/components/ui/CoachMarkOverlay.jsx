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
/**
 * forceLastStep — true면 마지막 단계에서 스포트라이트(하이라이트된 요소)만 클릭 가능.
 *   나머지 화면은 탭을 흡수(진행/건너뛰기 불가) → 사용자가 그 버튼을 실제로 눌러야만 다음으로 진행.
 *   코치 종료는 그 버튼의 onClick 쪽에서 dismiss로 처리(여기선 탭으로 finish 안 함).
 */
export default function CoachMarkOverlay({ steps, visible, onDone, delay = 350, showControls = true, forceLastStep = false }) {
  const [step, setStep]       = useState(0);
  const [rect, setRect]       = useState(null);
  const [mounted, setMounted] = useState(false);
  const [alpha, setAlpha]     = useState(0);   // 페이드 opacity
  const stepRef = useRef(0);                   // 첫 스텝 보정 재측정 가드용

  // visible → true 시 마운트 + fade-in / visible → false 시(표시 중이었다면) 페이드아웃 후 언마운트.
  // ★false 처리 필수: 게임 결과화면처럼 표시 '후' 다른 오버레이(업적 축하 등)가 떠서 visible이 꺼지는 경우
  //   이전엔 mounted가 남아 계속 겹쳐 보였음. onDone은 호출 안 함(소비 아님 — visible 재점등 시 처음부터 재표시).
  useEffect(() => {
    if (!visible) {
      if (!mounted) return undefined;
      setAlpha(0);
      const t = setTimeout(() => { setMounted(false); setStep(0); setRect(null); }, 220);
      return () => clearTimeout(t);
    }
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

  const finishTimerRef = useRef(null); // finish 페이드아웃 타이머 — 언마운트 시 정리(뒤늦은 setState/onDone 방지)
  useEffect(() => () => clearTimeout(finishTimerRef.current), []);

  const finish = useCallback(() => {
    setAlpha(0);
    finishTimerRef.current = setTimeout(() => {
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
  // 강제 마지막 단계: 스포트라이트 요소만 클릭 가능(주변은 탭 흡수). rect 확정·표시 안정(alpha=1)일 때만.
  const forcedLast = forceLastStep && step >= steps.length - 1 && !!rect && alpha === 1;
  // 툴팁·컨트롤·딤은 게임 무대(9:16 컬럼) 안에만 — 포탈이라 뷰포트 전체가 기본이라서, 실제 무대 폭을 DOM에서 읽어 맞춘다.
  //  (구: min(vw,600) 가정 → 무대가 min(600px,56.25vh)로 더 좁은 PC에서 딤·툴팁이 레터박스로 삐져나왔음. 2026-08-03)
  const stageEl = typeof document !== 'undefined' ? document.querySelector('[data-tg-stage]') : null;
  const stageRect = stageEl ? stageEl.getBoundingClientRect() : null;
  const COL_W = stageRect ? Math.round(stageRect.width) : Math.min(vw, 600);
  const COL_LEFT = stageRect ? Math.round(stageRect.left) : Math.round((vw - COL_W) / 2);
  // 무대 밖(레터박스)은 잘라낸다 — 스포트라이트 좌표는 뷰포트 기준 그대로 두고 표시만 제한(계산 로직 무변경)
  const stageClip = stageRect ? { clipPath: `inset(0px ${Math.max(0, vw - (COL_LEFT + COL_W))}px 0px ${Math.max(0, COL_LEFT)}px)` } : null;

  // ── 툴팁 세로 위치 계산 ──────────────────────────────────
  // rect 있으면: element 상단 절반 → 아래에, 하단 절반 → 위에
  // rect 없으면: 화면 상단 35% 위치에 고정
  const hasSpotlight = !!rect;
  // 위/아래 남은 공간 — 스포트라이트가 화면을 거의 다 덮으면(리스트 전체 강조 등) 둘 다 부족해진다.
  //  그 경우 예전엔 무조건 '위'로 붙여 툴팁이 화면 밖(y −107)으로 나가 아예 안 보였다(난이도 코치마크, 2026-08-06).
  const TIP_MIN_SPACE = 130; // 툴팁이 들어갈 최소 세로 공간(툴팁 높이 ≈ 82~110 + 여백)
  const spaceBelow = hasSpotlight ? vh - (rect.y + rect.h) : 0;
  const spaceAbove = hasSpotlight ? rect.y : 0;
  const prefersBelow = hasSpotlight && rect.cy < vh * 0.5;
  const place = !hasSpotlight ? 'free'
    : (prefersBelow && spaceBelow >= TIP_MIN_SPACE) ? 'below'
    : (spaceAbove >= TIP_MIN_SPACE) ? 'above'
    : (spaceBelow >= TIP_MIN_SPACE) ? 'below'
    : 'free'; // 위아래 모두 공간 없음 → 스포트라이트 위에 겹쳐 띄운다(화면 밖으로 나가는 것보다 낫다)
  const isBelow = place === 'below';

  let tipTop, tipBottom;
  if (place === 'below') tipTop = Math.round(rect.y + rect.h + TIP_GAP);
  else if (place === 'above') tipBottom = Math.round(vh - rect.y + TIP_GAP);
  else if (hasSpotlight) tipBottom = Math.round(vh * 0.2); // 큰 스포트라이트 — 화면 아래쪽 잘 보이는 자리
  else tipTop = Math.round(vh * 0.32);

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
        ...stageClip,
        transition: 'opacity 0.22s ease-out',
        pointerEvents: 'none', // 루트는 통과, 상호작용 자식(advance/catcher/컨트롤)만 auto — 강제 마지막의 스포트라이트 홀 클릭스루용
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

      {/* ── 진행 영역 ── 일반: 화면 탭=다음 스텝. 강제 마지막: 스포트라이트 홀(버튼)만 클릭 통과, 주변 4프레임은 탭 흡수 ── */}
      {forcedLast ? (
        <>
          <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: Math.max(0, rect.y), pointerEvents: 'auto' }} onClick={(e) => e.stopPropagation()} aria-hidden="true" />
          <div style={{ position: 'absolute', left: 0, top: rect.y + rect.h, width: '100%', bottom: 0, pointerEvents: 'auto' }} onClick={(e) => e.stopPropagation()} aria-hidden="true" />
          <div style={{ position: 'absolute', top: rect.y, left: 0, width: Math.max(0, rect.x), height: rect.h, pointerEvents: 'auto' }} onClick={(e) => e.stopPropagation()} aria-hidden="true" />
          <div style={{ position: 'absolute', top: rect.y, left: rect.x + rect.w, right: 0, height: rect.h, pointerEvents: 'auto' }} onClick={(e) => e.stopPropagation()} aria-hidden="true" />
        </>
      ) : (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }} onClick={advance} aria-hidden="true" />
      )}

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
        {/* 화살표 다이아몬드 — 스포트라이트에 붙지 못한 'free' 배치에선 가리킬 대상이 없으므로 숨긴다 */}
        {hasSpotlight && place !== 'free' && (
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
            fontSize: 15, fontWeight: 600,
            color: TEXT_PRIMARY, lineHeight: 1.65, margin: 0,
          }}>
            {current?.label}
          </p>
        </div>

        {/* 진행 힌트 — ★툴팁에 붙여 둔다. 화면 하단 고정으로 두면 탭바 키캡·하단 CTA·카드 위에 겹쳐
            그 요소의 라벨을 가렸다(2026-08-07 UX 검수). absolute라 툴팁 본문/화살표 레이아웃엔 영향 없음.
            툴팁이 스포트라이트 '위'에 붙은 경우엔 아래가 스포트라이트라 힌트도 위로 올린다. */}
        {!showControls && !forcedLast && (
          <div style={{
            position: 'absolute', left: 0, right: 0, textAlign: 'center', pointerEvents: 'none',
            ...(place === 'above' ? { bottom: '100%', marginBottom: 10 } : { top: '100%', marginTop: 10 }),
          }}>
            <span style={{
              display: 'inline-block', padding: '5px 13px', borderRadius: 999,
              background: 'rgba(43,39,48,0.62)', color: 'rgba(255,255,255,0.92)', fontSize: 13, fontWeight: 600,
            }}>{step >= steps.length - 1 ? '탭하여 완료' : '탭하여 계속'}</span>
          </div>
        )}
      </div>

      {/* ── 하단 컨트롤 (건너뛰기 · 스텝 도트 · 다음/완료). showControls=false면 툴팁에 붙은 진행 힌트로만 진행 ── */}
      {showControls && (
      <div style={{
        position: 'absolute',
        bottom: 'max(20px, calc(env(safe-area-inset-bottom) + 76px))',
        left: COL_LEFT + 16, width: COL_W - 32,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 12px', boxSizing: 'border-box',
        // 딤만으로는 뒤 카드의 밝은 글씨가 비쳐 흰 라벨과 겹쳐 읽혔다(2026-08-24 검수).
        // 컨트롤 바 자체를 어둡게 깔아 어떤 배경 위에서도 대비를 보장한다.
        background: 'rgba(0,0,0,0.42)',
        borderRadius: 999,
        pointerEvents: 'auto',
      }}>
        {/* 건너뛰기 */}
        <button
          onClick={(e) => { e.stopPropagation(); finish(); }}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: 600,
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
                borderRadius: 4,
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
