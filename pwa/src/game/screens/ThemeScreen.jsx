// 테마 모드 — 난이도와 별개 축. 테마 카드를 가로 스냅스크롤로 보여줌(항상 중앙 스냅, 양옆 카드 살짝 걸침).
// Figma "06. 테마 — 개선/잠김"(2026-08-03) 리디자인:
//   · 제목(번호+이름)·별·최고점을 **카드 밖 화면 상단**으로 분리, 카드는 [이미지 + 캡션 밴드]만.
//   · 시작은 **하단 고정 CTA** [◀][시작][▶] — 카드 안 FAB 제거. 카드 탭도 시작(해제 시).
//   · 잠김 = 이미지 흑백 + 가운데 자물쇠 + 캡션에 해제조건, [시작] 비활성(#D4DEE6).
//   · 단어카드설정(CrutchRow)은 설정 팝업으로 이관 — 카드에서 제거(2026-08-03 사용자 승인).
// 참조 메모리: tone_game_redesign.md (테마 모드)
import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { AltArrowLeft, AltArrowRight, Lock, Play } from '@solar-icons/react';
import { TG, TYPE, TOUCH_OPT, DUR, RADIUS, SPACE, SHADOW, keycap } from '../tgTokens.js';
import { isThemeUnlocked, themeBestScore, themeUnlockReqText, themeUnlockToastText, themeStars } from '../gameLogic.js';
import { play as playSfx } from '../tgSfx.js';
import { Reveal, GameHeader, StarRow, ShakeButton, prefersReducedMotion } from './shared.jsx';

// 시안 치수: 카드 280×300(r20) · 캡션 밴드 54 · 카드 간격 20 · 닷 활성 20×6
const GAP = 20;
const CARD_W = 280, CARD_MAX_H = 300, CAP_H = 54;
// 카드 흰 내부 획(시안 stroke #FFF 14 INSIDE) — 이미지를 사방에서 덮어 액자처럼 보이게 한다.
const CARD_STROKE = 14;
const SCORE_C = TG.STEEL_SOFT, DOT_ON = TG.STEEL_SOFT, DOT_OFF = TG.KEY_EDGE;
// 스크롤 컨테이너 세로 패딩 — overflowY:hidden(가로 스크롤 강제)이 카드 그림자를 자르지 않게 여유 확보.
const PAD_TOP = 12, PAD_BOTTOM = 22;
// 카드 위/아래 고정 요소가 차지하는 세로 합(헤더80+코치63+간격18+스크롤패딩34+닷/힌트54=249)+여유 15.
// 짧은 화면(640 이하)에서 카드가 이만큼 빼고 줄어들어 하단 힌트까지 안 잘림.
const RESERVED_H = 400; // 헤더60 + 상단블록(제목·별·점수)116 + 닷·여백 + 하단바 96
// 패널 텍스트 색 (화이트 패널 위)
const PANEL_SUB = TG.SUB;
const CHIP_BG = TG.SURFACE;
const GOLD_BG = 'rgba(255,194,60,0.18)', GOLD_TX = '#A46A00';
const GAUGE_BG = TG.BORDER;

// PC 웹(마우스) 판별 — 터치 스와이프가 없는 환경에만 좌우 화살표·휠 넘기기 노출.
const FINE_POINTER = typeof window !== 'undefined' && !!window.matchMedia
  && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// 짧은 화면 대응 — 카드는 최대 392, 화면이 짧으면 줄어들기만(비율 5:7 고정, 커지지 않음).
function calcCardH() {
  if (typeof window === 'undefined') return CARD_MAX_H;
  return Math.max(210, Math.min(CARD_MAX_H, window.innerHeight - RESERVED_H));
}

// ── 배경 앰비언트 파티클 — 포커스된 테마에 맞는 글리프가 은은하게 떠오름 ──
// 테마별 파티클 세트(THEMES.id 기준). 새 테마 추가 시 여기 한 줄 — 없으면 ✨ 폴백.
const THEME_PARTICLES = {
  drama: ['❤️', '💌', '💕'],
  travel: ['✈️', '☁️', '🎒'],
  slang: ['💬', '✨', '⚡'],
  cooking: ['🥟', '🍜', '🥢'],
};
const pickGlyph = (set) => set[(Math.random() * set.length) | 0];
// 1D 부드러운 값 노이즈(-1..1) — 상승 중 좌우 흔들림(EmberRise와 동일 방식)
function driftNoise(x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  const h = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
  return (h(i) * (1 - u) + h(i + 1) * u) * 2 - 1;
}
// 래퍼 — 모션 최소화 설정이면 장식 파티클 생략(훅 규칙 안전하게 바깥 분기)
function AmbientParticles({ themeId }) {
  if (prefersReducedMotion()) return null;
  return <AmbientParticlesInner themeId={themeId} />;
}
function AmbientParticlesInner({ themeId }) {
  const refs = useRef([]);
  const cfg = useRef(null);
  const setRef = useRef(THEME_PARTICLES[themeId] || ['✨']);
  if (!cfg.current) {
    const R = Math.random;
    cfg.current = Array.from({ length: 13 }, () => ({
      x: R() * 100, size: 14 + R() * 11, life: 5 + R() * 4, t: -R() * 7, // 음수 t = 시차 등장
      sway: 8 + R() * 16, freq: 0.4 + R() * 0.9, seed: R() * 100, peak: 0.14 + R() * 0.16,
      glyph: pickGlyph(setRef.current),
    }));
  }
  useEffect(() => { // 테마 전환 — 등장 대기(t<0)는 즉시 교체, 화면의 옛 글리프는 '제자리에서' 서서히 옅어진 뒤 재생성.
    // ★수명을 당기면 진행률=높이라 위치가 순간이동함(사용자 "뚝 없어져 어색") → 위치·궤도 유지 + 투명도만 감쇠(dying).
    const set = THEME_PARTICLES[themeId] || ['✨'];
    setRef.current = set;
    cfg.current.forEach((s, k) => {
      if (s.t <= 0) {
        s.glyph = pickGlyph(set);
        const el = refs.current[k]; if (el) el.textContent = s.glyph;
      } else if (!set.includes(s.glyph) && !s.dying) {
        s.dying = true; s.fadeK = 1; s.fadeDur = 0.6 + Math.random() * 0.9; // 0.6~1.5s 시차 페이드
      }
    });
  }, [themeId]);
  useLayoutEffect(() => {
    let raf, alive = true, last = performance.now();
    const tick = (now) => {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      for (let k = 0; k < cfg.current.length; k++) {
        const el = refs.current[k]; const s = cfg.current[k]; if (!el) continue;
        s.t += dt;
        if (s.dying) s.fadeK = Math.max(0, s.fadeK - dt / s.fadeDur); // 테마 전환 퇴장 — 제자리에서 투명도만 감쇠
        if (s.t >= s.life || (s.dying && s.fadeK === 0)) { // 재생성 — 현재 테마의 글리프로 교체(자연스러운 세대교체)
          s.t = -Math.random() * 1.2; s.x = Math.random() * 100; s.glyph = pickGlyph(setRef.current);
          s.dying = false; s.fadeK = 1;
          el.textContent = s.glyph; el.style.left = `${s.x.toFixed(1)}%`;
        }
        if (s.t < 0) { el.style.opacity = '0'; continue; }
        const p = s.t / s.life;
        const y = 104 - p * 118; // 화면 아래(104%)에서 위(-14%)로 상승
        const wob = driftNoise(s.seed + s.t * s.freq) * s.sway;
        const env = Math.min(1, p * 6) * Math.min(1, (1 - p) * 5); // 페이드 인/아웃
        el.style.opacity = (env * s.peak * (s.dying ? s.fadeK : 1)).toFixed(3);
        el.style.top = `${y.toFixed(2)}%`;
        el.style.transform = `translateX(${wob.toFixed(1)}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, []);
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
      {cfg.current.map((s, k) => (
        <span key={k} ref={(n) => { refs.current[k] = n; }} style={{
          position: 'absolute', left: `${s.x.toFixed(1)}%`, top: '110%', fontSize: s.size,
          opacity: 0, willChange: 'transform, opacity, top', filter: 'saturate(0.85)',
        }}>{s.glyph}</span>
      ))}
    </div>
  );
}

const metaChip = (bg, color, bold) => ({
  display: 'inline-flex', alignItems: 'center', padding: '5px 10px', borderRadius: RADIUS.md,
  background: bg, ...(bold ? TYPE.labelSm : TYPE.meta), color,
});

// 테마 카드 — 시안 "06. 테마 — 개선/잠김": 흰 카드(280×300 r20) = 이미지 246 + 캡션 밴드 54.
//  제목·별·최고점은 카드 밖(화면 상단)으로 빠졌고, 시작도 하단 고정 CTA가 맡는다.
//  잠김 = 이미지 흑백 + 가운데 자물쇠 원 + 캡션에 해제 조건.
// unlockCur = 해제 조건이 되는 테마의 현재 최고점(잠김 캡션에 진행 표시). 호출부가 계산해 넘긴다.
function ThemeCard({ theme, unlocked, w, h, capH, unlockCur = 0 }) {
  const imgH = h - capH;
  // 포스터가 뜨는 순간이 '툭' 튀지 않게 짧게 페이드인 — 뒤에는 이미 theme.tint가 깔려 있어
  // 로딩 중에도 빈칸이 아니라 그 테마의 색이 보인다. (캐시 히트면 onLoad가 즉시 떠서 사실상 무전환)
  const [imgOn, setImgOn] = useState(false);
  return (
    <div style={{
      position: 'absolute', inset: 0, borderRadius: RADIUS.xl, overflow: 'hidden', background: '#fff',
      boxShadow: SHADOW.level1,
    }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: capH - CARD_STROKE, background: theme.tint || TG.SURFACE }}>
        {theme.image
          ? (
            <img
              src={theme.image}
              alt=""
              decoding="async"
              onLoad={() => setImgOn(true)}
              onError={() => setImgOn(true)}
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 30%',
                filter: unlocked ? 'none' : 'grayscale(1)', // 잠김 = 흑백(시안)
                opacity: imgOn ? 1 : 0,
                transition: `opacity ${DUR.state} ease`,
              }}
            />
          )
          : (
            <span style={{ position: 'absolute', left: 0, right: 0, top: '42%', textAlign: 'center', ...TYPE.label, lineHeight: 1.5, color: 'rgba(43,39,48,0.3)' }}>
              {theme.placeholder || '이미지'}<br />(준비 중)
            </span>
          )}
        {!unlocked && (
          <div style={{
            position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
            width: 60, height: 60, borderRadius: '50%', background: 'rgba(24,33,41,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Lock size={24} weight="Bold" color="#fff" />
          </div>
        )}
      </div>
      {/* ★흰 내부 획 14px — 시안은 카드에 `stroke #FFF 14 INSIDE`라 획이 **그림 위를 덮는다**(이미지는 카드보다 크게 깔림).
          그래서 이미지를 카드 전체에 채우고 이 오버레이로 사방을 덮어야 시안과 같은 프레이밍이 된다. */}
      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0, borderRadius: RADIUS.xl,
        border: `${CARD_STROKE}px solid #fff`, boxSizing: 'border-box', pointerEvents: 'none',
      }} />
      {/* 캡션 밴드 — 해제: 한 줄 소개 / 잠김: 해제 조건 */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: imgH, height: capH, background: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 14px',
      }}>
        <span style={{ ...TYPE.micro, fontSize: 13, color: SCORE_C, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {unlocked ? (theme.tagline || theme.desc || '') : themeUnlockReqText(theme, unlockCur)}
        </span>
      </div>
    </div>
  );
}

export function ThemeScreen({ themes, studentToken, counts = {}, onStart, onBack, onLocked }) {
  const [active, setActive] = useState(0);
  // 카드 = 시안 280×300(캡션 54). 짧은 화면에선 높이만 줄인다(폭은 유지 — 캐러셀 피치 안정).
  const [cardH, setCardH] = useState(calcCardH);
  const cardW = CARD_W;
  const capH = CAP_H;
  useEffect(() => {
    const onResize = () => setCardH(calcCardH());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 캐러셀 다이내믹 — 중앙에서 멀어질수록 축소·딤.
  const scrollerRef = useRef(null);
  const fxRefs = useRef([]);
  const scrollRafRef = useRef(0);
  const applyFx = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    fxRefs.current.forEach((node) => {
      if (!node) return;
      const r = node.parentElement.getBoundingClientRect();
      const d = Math.min(1, Math.abs(r.left + r.width / 2 - center) / (cardW + GAP));
      node.style.transform = `scale(${1 - 0.06 * d})`;
      node.style.opacity = String(1 - 0.2 * d);
    });
  };
  useEffect(() => { applyFx(); }, [cardH]);
  useEffect(() => () => cancelAnimationFrame(scrollRafRef.current), []);
  const onScroll = (e) => {
    const el = e.currentTarget;
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      applyFx();
      const i = Math.round(el.scrollLeft / (cardW + GAP));
      setActive(Math.max(0, Math.min(themes.length - 1, i)));
    });
  };
  const scrollToIndex = (i) => {
    const el = scrollerRef.current;
    if (!el) return;
    const idx = Math.max(0, Math.min(themes.length - 1, i));
    el.scrollTo({ left: idx * (cardW + GAP), behavior: 'smooth' });
  };
  const wheelLockRef = useRef(0);
  const onWheel = (e) => {
    if (!FINE_POINTER) return;
    const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(d) < 8) return;
    const now = Date.now();
    if (now - wheelLockRef.current < 350) return;
    wheelLockRef.current = now;
    scrollToIndex(active + (d > 0 ? 1 : -1));
  };

  const cur = themes[active] || themes[0];
  const curUnlocked = cur ? isThemeUnlocked(studentToken, cur) : false;
  const curBest = cur ? themeBestScore(studentToken, cur.gameKey) : 0;
  const curStars = themeStars(curBest);
  const sidePad = `max(24px, calc((100% - ${cardW}px) / 2))`;
  // 좌우 이동 버튼(공용) — 시안: 60×60 흰 카드 버튼 + 아래 4px 엣지
  const navBtn = (disabled) => ({
    width: 60, height: 60, flexShrink: 0, borderRadius: RADIUS.xl, border: 'none', background: '#fff',
    boxShadow: keycap(TG.KEY_EDGE),
    display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 4,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1, ...TOUCH_OPT,
  });

  return (
    <>
      {/* 배경 앰비언트 파티클 — 포커스 테마 연동(모든 콘텐츠 뒤) */}
      <AmbientParticles themeId={cur?.id} />
      {/* 헤더 — 시안: 60px 글래스 + 가운데 타이틀 */}
      <GameHeader title="테마 모드" onBack={onBack} glass center />

      {/* 상단 — 번호+제목 / 별 / 최고점 (카드 밖으로 이동, 시안 y92·135·155) */}
      <Reveal i={1} style={{ position: 'absolute', left: 0, right: 0, top: 84, zIndex: 2 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.md }}>
          <span style={{ ...TYPE.head, fontSize: 26, color: TG.INK, whiteSpace: 'nowrap' }}>{`${active + 1}. ${cur?.label || ''}`}</span>
          <StarRow filled={curStars} size={16} gap={2} off={TG.KEY_EDGE} shine />
          <span style={{ ...TYPE.num, fontSize: 14, color: SCORE_C }}>{`최고 ${curBest.toLocaleString()}점`}</span>
        </div>
      </Reveal>

      {/* 카드 캐러셀 + 페이지 닷 — 상단 블록과 하단바 사이 세로 중앙 */}
      <div style={{
        // 카드+닷 묶음을 [상단 블록 ~ 하단 CTA] 사이에서 중앙정렬하되, **아래로 74px 치우침 보정**을 준다.
        //  · 고정 top(252)만 쓰면 세로가 짧은 화면에서 아래 공간이 줄어 카드가 처져 보이고,
        //  · 보정 없는 정중앙이면 844에서 시안보다 33px 내려간다. 둘 다 피하는 값(실측: 844에서 카드 상단 258 = 시안과 동일).
        position: 'absolute', left: 0, right: 0, top: 176, bottom: 'calc(112px + env(safe-area-inset-bottom))',
        paddingTop: 8, paddingBottom: 74,
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: SPACE.x3, zIndex: 2,
      }}>
        <div ref={scrollerRef} onScroll={onScroll} onWheel={onWheel} className="tg-noscroll" style={{
          display: 'flex', gap: GAP, flexShrink: 0,
          paddingLeft: sidePad, paddingRight: sidePad, paddingTop: 6, paddingBottom: 6,
          overflowX: 'auto', overflowY: 'hidden', scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
        }}>
          {themes.map((t, idx) => {
            const unlocked = isThemeUnlocked(studentToken, t);
            // 잠긴 테마의 진행 = 해제 조건이 되는 테마(직전)의 현재 최고점. 열린 테마는 계산 불필요.
            const unlockCur = (!unlocked && t.unlock) ? themeBestScore(studentToken, t.unlock.byGameKey) : 0;
            return (
              <div key={t.id} style={{ flex: `0 0 ${cardW}px`, width: cardW, height: cardH, scrollSnapAlign: 'center', position: 'relative' }}>
                <div ref={(n) => { fxRefs.current[idx] = n; }} style={{ position: 'absolute', inset: 0 }}>
                  <ShakeButton shakeOnClick={!unlocked}
                    onClick={() => { if (unlocked) { playSfx('button'); onStart(t); } else if (onLocked) onLocked(themeUnlockToastText(t, unlockCur)); }}
                    className={unlocked ? 'tg-press' : ''}
                    style={{ position: 'absolute', inset: 0, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', ...TOUCH_OPT }}>
                    <ThemeCard theme={t} unlocked={unlocked} w={cardW} h={cardH} capH={capH} unlockCur={unlockCur} />
                  </ShakeButton>
                </div>
              </div>
            );
          })}
        </div>

        {/* 페이지 닷 — 활성 20×6 알약, 나머지 6원 */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div style={{ display: 'flex', gap: SPACE.sm, alignItems: 'center' }}>
            {themes.map((t, i) => (
              <div key={t.id} style={{
                width: i === active ? 20 : 6, height: 6, borderRadius: 3,
                background: i === active ? DOT_ON : DOT_OFF,
                transition: `width ${DUR.state} ease, background-color ${DUR.state} ease`,
              }} />
            ))}
          </div>
        </div>
      </div>

      {/* 하단 고정 — [◀] [시작] [▶] (시안 24/94/306, 높이 60, 하단 26) */}
      <div style={{
        position: 'absolute', left: 24, right: 24, bottom: 'calc(26px + env(safe-area-inset-bottom))', zIndex: 3,
        display: 'flex', alignItems: 'center', gap: SPACE.lg,
      }}>
        <button type="button" className="tg-press" aria-label="이전 테마" disabled={active === 0}
          onClick={() => { playSfx('tap', 0.2); scrollToIndex(active - 1); }} style={navBtn(active === 0)}>
          <AltArrowLeft size={30} weight="Bold" color={TG.STEEL} />
        </button>
        <button type="button" className={curUnlocked ? 'tg-press' : ''} aria-label={`${cur?.label || ''} 시작`}
          onClick={() => { if (curUnlocked) { playSfx('button'); onStart(cur); } else if (onLocked) onLocked(themeUnlockToastText(cur)); }}
          style={{
            flex: 1, minWidth: 0, height: 60, borderRadius: RADIUS.xl, border: 'none',
            cursor: curUnlocked ? 'pointer' : 'default', paddingBottom: 4,
            background: curUnlocked ? TG.CTA : TG.KEY_EDGE_LOCKED,
            boxShadow: curUnlocked ? keycap(TG.CTA_EDGE) : 'none',
            ...TOUCH_OPT,
          }}>
          <span style={{ ...TYPE.head, color: curUnlocked ? '#fff' : TG.STEEL }}>시작</span>
        </button>
        <button type="button" className="tg-press" aria-label="다음 테마" disabled={active === themes.length - 1}
          onClick={() => { playSfx('tap', 0.2); scrollToIndex(active + 1); }} style={navBtn(active === themes.length - 1)}>
          <AltArrowRight size={30} weight="Bold" color={TG.STEEL} />
        </button>
      </div>
    </>
  );
}
