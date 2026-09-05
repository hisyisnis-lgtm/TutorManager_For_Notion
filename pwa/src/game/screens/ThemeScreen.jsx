// 테마 모드 — 난이도와 별개 축. 테마 카드를 가로 스냅스크롤로 보여줌(항상 중앙 스냅, 양옆 카드 살짝 걸침).
// Figma "06. 테마 — 개선/잠김"(2026-08-03) 리디자인:
//   · 시작은 **하단 고정 CTA** [◀][시작][▶] — 카드 안 FAB 제거. 카드 탭도 시작(해제 시).
// 2026-09-05 '포스터 카드' 개편(사용자 A/B 캡처 비교 후 B 확정):
//   · 상단 제목·별·최고점 블록을 없애고 **카드 캡션 밴드(120)** 로 내림 — 카드 = 이미지 + 이름 + 별/최고점 + 소개.
//   · 잠김 = 이미지 흑백·명도 0.85 + 캡션에 **해제 게이지(현재/필요점수)** + 조건 문구. 자물쇠 원 제거.
//   · 닷은 하단바 바로 위 — 화살표·닷·CTA가 한 묶음. CTA 라벨이 상태를 말한다('드라마 단어 시작' / '500점이면 열려요').
//   · 단어카드설정(CrutchRow)은 설정 팝업으로 이관 — 카드에서 제거(2026-08-03 사용자 승인).
// 참조 메모리: tone_game_redesign.md (테마 모드)
import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { AltArrowLeft, AltArrowRight } from '@solar-icons/react';
import { TG, TYPE, TOUCH_OPT, DUR, RADIUS, SPACE, SHADOW, keycap } from '../tgTokens.js';
import { isThemeUnlocked, themeBestScore, themeUnlockReqText, themeUnlockToastText, themeStars } from '../gameLogic.js';
import { play as playSfx } from '../tgSfx.js';
import { GameHeader, StarRow, ShakeButton, prefersReducedMotion, Gauge } from './shared.jsx';

// 치수: 카드 280×380(r20) = 이미지 260 + 캡션 밴드 120 · 카드 간격 20 · 닷 활성 20×6
const GAP = 20;
const CARD_W = 280, CARD_MAX_H = 380, CAP_H = 120;
// 카드 흰 내부 획(시안 stroke #FFF 14 INSIDE) — 이미지를 사방에서 덮어 액자처럼 보이게 한다.
const CARD_STROKE = 8;               // 14→8(2026-09-05): 동심 라운드(외곽 20 = 이미지 12 + 획 8) — 사진 면적 확보
const IMG_RADIUS = RADIUS.xl - CARD_STROKE;
const SCORE_C = TG.STEEL_SOFT, DOT_ON = TG.STEEL_SOFT, DOT_OFF = TG.KEY_EDGE;
// 카드 위/아래 고정 요소의 세로 합 — 헤더 60 + 하단바 86 + 닷 26 + 여유. 짧은 화면(667)에서 카드가 이만큼 빼고 줄어든다.
const RESERVED_H = 200;

// PC 웹(마우스) 판별 — 터치 스와이프가 없는 환경에만 좌우 화살표·휠 넘기기 노출.
const FINE_POINTER = typeof window !== 'undefined' && !!window.matchMedia
  && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// 짧은 화면 대응 — 카드는 최대 380, 화면이 짧으면 줄어들기만(커지지 않음).
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
    cfg.current = Array.from({ length: 6 }, () => ({
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

// 테마 카드 — 포스터: 흰 카드(280×380 r20) = 이미지 260 + 캡션 밴드 120(이름 · 별/최고점 · 소개).
//  시작은 하단 고정 CTA가 맡는다. 잠김 = 이미지 흑백 + 캡션에 해제 게이지·조건.
// unlockCur = 해제 조건이 되는 테마의 현재 최고점(잠김 캡션에 진행 표시). 호출부가 계산해 넘긴다.
function ThemeCard({ theme, unlocked, w, h, capH, unlockCur = 0, name = '', stars = 0, best = 0 }) {
  const imgH = h - capH;
  // 포스터가 뜨는 순간이 '툭' 튀지 않게 짧게 페이드인 — 뒤에는 이미 theme.tint가 깔려 있어
  // 로딩 중에도 빈칸이 아니라 그 테마의 색이 보인다. (캐시 히트면 onLoad가 즉시 떠서 사실상 무전환)
  const [imgOn, setImgOn] = useState(false);
  return (
    <div style={{
      position: 'absolute', inset: 0, borderRadius: RADIUS.xl, overflow: 'hidden', background: '#fff',
      boxShadow: SHADOW.level1,
    }}>
      <div style={{ position: 'absolute', left: CARD_STROKE, right: CARD_STROKE, top: CARD_STROKE, bottom: capH, borderRadius: IMG_RADIUS, overflow: 'hidden', background: theme.tint || TG.SURFACE, boxShadow: `inset 0 0 0 1px ${TG.LINE}` }}>
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
                filter: unlocked ? 'none' : 'grayscale(1) brightness(0.85)', // 잠김 = 흑백·살짝 어둡게(자물쇠 원 대신, 2026-09-05)
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
      </div>
      {/* ★흰 내부 획 14px — 시안은 카드에 `stroke #FFF 14 INSIDE`라 획이 **그림 위를 덮는다**(이미지는 카드보다 크게 깔림).
          그래서 이미지를 카드 전체에 채우고 이 오버레이로 사방을 덮어야 시안과 같은 프레이밍이 된다. */}
      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0, borderRadius: RADIUS.xl,
        border: `${CARD_STROKE}px solid #fff`, boxSizing: 'border-box', pointerEvents: 'none',
      }} />
      {/* 캡션 밴드 — 이름 + (해제: 별/최고점 + 소개 | 잠김: 해제 게이지 + 조건) */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: imgH, height: capH, background: '#fff',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm, padding: '0 16px',
      }}>
        <span style={{ ...TYPE.h1, color: TG.INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{name}</span>
        {unlocked && (
          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md }}>
            <StarRow filled={stars} size={16} gap={2} off={TG.STAR_OFF} />
            <span style={{ ...TYPE.num, fontSize: 13, color: SCORE_C, whiteSpace: 'nowrap' }}>{best > 0 ? `최고 ${best.toLocaleString()}점` : '기록 없음'}</span>
          </div>
        )}
        {unlocked
          ? <span style={{ ...TYPE.sub, color: SCORE_C, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{theme.tagline || theme.desc || ''}</span>
          : (
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.xs }}>
              {/* 해제 게이지 — 이전 테마 최고점 / 필요 점수(themes.js unlock.score). 얼마나 남았는지 보이게(2026-09-05) */}
              <Gauge pct={theme.unlock ? Math.min(100, (unlockCur / theme.unlock.score) * 100) : 0} height={6} fill={TG.CTA} track={TG.TRACK} ariaLabel="해제 진행" style={{ width: 160 }} />
              <span style={{ ...TYPE.micro, fontSize: 12, color: SCORE_C, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{themeUnlockReqText(theme, unlockCur)}</span>
            </div>
          )}
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
  // CTA 라벨이 상태를 말한다 — 해제: '드라마 단어 시작' / 잠김: '500점이면 열려요'(조건 테마 이름은 카드 캡션이 이미 보여준다).
  const ctaLabel = curUnlocked ? `${cur?.label || ''} 시작` : (cur?.unlock ? `${cur.unlock.score.toLocaleString()}점이면 열려요` : '시작');
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

      {/* 카드 캐러셀 — 헤더와 하단바 사이 세로 중앙. 페이지 닷은 이 컨테이너 바닥(=하단바 26px 위)에 고정 */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 72, bottom: 'calc(112px + env(safe-area-inset-bottom))',
        paddingTop: 8, paddingBottom: 28,
        display: 'flex', flexDirection: 'column', justifyContent: 'center', zIndex: 2,
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
                    <ThemeCard theme={t} unlocked={unlocked} w={cardW} h={cardH} capH={capH} unlockCur={unlockCur} name={`${idx + 1}. ${t.label}`} stars={themeStars(themeBestScore(studentToken, t.gameKey))} best={themeBestScore(studentToken, t.gameKey)} />
                  </ShakeButton>
                </div>
              </div>
            );
          })}
        </div>

        {/* 페이지 닷 — 활성 20×6 알약, 나머지 6원. 하단바 바로 위에 붙여 화살표·닷·CTA가 한 묶음 */}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center' }}>
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
        <button type="button" className={curUnlocked ? 'tg-press' : ''} aria-label={ctaLabel}
          onClick={() => { if (curUnlocked) { playSfx('button'); onStart(cur); } else if (onLocked) onLocked(themeUnlockToastText(cur)); }}
          style={{
            flex: 1, minWidth: 0, height: 60, borderRadius: RADIUS.xl, border: 'none',
            cursor: curUnlocked ? 'pointer' : 'default', paddingBottom: 4,
            background: curUnlocked ? TG.CTA : TG.KEY_EDGE_LOCKED,
            boxShadow: curUnlocked ? keycap(TG.CTA_EDGE) : 'none',
            ...TOUCH_OPT,
          }}>
          <span style={{ ...TYPE.head, color: curUnlocked ? '#fff' : TG.STEEL, whiteSpace: 'nowrap' }}>{ctaLabel}</span>
        </button>
        <button type="button" className="tg-press" aria-label="다음 테마" disabled={active === themes.length - 1}
          onClick={() => { playSfx('tap', 0.2); scrollToIndex(active + 1); }} style={navBtn(active === themes.length - 1)}>
          <AltArrowRight size={30} weight="Bold" color={TG.STEEL} />
        </button>
      </div>
    </>
  );
}
