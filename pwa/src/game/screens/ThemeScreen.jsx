// 테마 선택 화면 — 난이도와 별개 축. 테마별 포스터 카드를 가로 스냅스크롤로 보여줌(항상 중앙 스냅, 양옆 카드 살짝 걸침).
// Figma "23. 테마 선택" 기준(A안: 상단 이미지 + 하단 화이트 패널 분리). 중앙 카드는 크게·선명, 양옆은 축소·딤.
// 잠긴 테마는 흔들림+토스트(ShakeButton/onLocked), 패널에 해제조건+진행 게이지 표기.
// 참조 메모리: tone_game_redesign.md (테마 모드)
import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { CaretLeftIcon, CaretRightIcon, LockSimpleIcon, PlayIcon } from '@phosphor-icons/react';
import { TG, TYPE, TOUCH_OPT, DUR, RADIUS } from '../tgTokens.js';
import { isThemeUnlocked, themeBestScore, themeUnlockReqText, themeUnlockToastText, themeStars } from '../gameLogic.js';
import { play as playSfx } from '../tgSfx.js';
import { Reveal, GameHeader, StarRow, CoachBubble, ShakeButton, prefersReducedMotion } from './shared.jsx';

const GAP = 16;
// 스크롤 컨테이너 세로 패딩 — overflowY:hidden(가로 스크롤 강제)이 카드 그림자를 자르지 않게 여유 확보.
const PAD_TOP = 12, PAD_BOTTOM = 22;
// 카드 위/아래 고정 요소가 차지하는 세로 합(헤더80+코치63+간격18+스크롤패딩34+닷/힌트54=249)+여유 15.
// 짧은 화면(640 이하)에서 카드가 이만큼 빼고 줄어들어 하단 힌트까지 안 잘림.
const RESERVED_H = 264;
// 패널 텍스트 색 (화이트 패널 위)
const PANEL_SUB = TG.SUB;
const CHIP_BG = '#F5F1EA';
const GOLD_BG = 'rgba(255,194,60,0.18)', GOLD_TX = '#A46A00';
const GAUGE_BG = '#EFEAE2';

// PC 웹(마우스) 판별 — 터치 스와이프가 없는 환경에만 좌우 화살표·휠 넘기기 노출.
const FINE_POINTER = typeof window !== 'undefined' && !!window.matchMedia
  && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// 짧은 화면 대응 — 카드는 최대 392, 화면이 짧으면 줄어들기만(비율 5:7 고정, 커지지 않음).
function calcCardH() {
  if (typeof window === 'undefined') return 392;
  return Math.max(300, Math.min(392, window.innerHeight - RESERVED_H));
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

// 포스터형 테마 카드 — 상단 이미지 + 하단 화이트 패널(제목·태그라인 / 잠금은 해제조건·진행 게이지)
// imgH는 호출부가 산출(패널은 고정 높이 — 칩 제거 후 여백 밸런스, 사용자 "상단 기준으로 세로 줄여").
// focused: 캐러셀 중앙 카드 — 플레이 FAB 맥동은 포커스 카드에서만(전 카드 맥동은 소란). 모션 최소화 시 정적.
function ThemeCard({ theme, unlocked, best, count, cardH, imgH, unlockCur, focused = false }) {
  const panelH = cardH - imgH;
  const stars = themeStars(best); // 0~3, 한 판 최고점 기준(점수 오름차순이라 항상 연속 채움)
  return (
    <div style={{ position: 'absolute', inset: 0, borderRadius: RADIUS.xxl, overflow: 'hidden', background: '#fff' }}>
      {/* 이미지 영역(상단 65%) */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: imgH, background: theme.tint || '#eee' }}>
        {theme.image
          ? <img src={theme.image} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 30%' }} />
          : (
            <span style={{ position: 'absolute', left: 0, right: 0, top: '42%', textAlign: 'center', ...TYPE.label, lineHeight: 1.5, color: 'rgba(43,39,48,0.3)' }}>
              {theme.placeholder || '이미지'}<br />(준비 중)
            </span>
          )}
        {!unlocked && (
          <>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} />
            <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 56, height: 56, borderRadius: RADIUS.card, background: 'rgba(0,0,0,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <LockSimpleIcon size={26} weight="fill" color="#fff" />
            </div>
          </>
        )}
        {/* 성취 별 배지 — 우상단(유일한 배지). 한 판 최고점 500/1000/1800 구간별 0~3개(점수 오름차순=항상 연속 채움).
            점수 숫자는 카드에서 제거(중복·정보과다, 2026-07-16 사용자 결정: 최고점은 결과화면에서 확인). 채운 별은 시차 반짝임 */}
        {unlocked && (
          <div style={{ position: 'absolute', right: 12, top: 12, display: 'flex', alignItems: 'center', padding: '6px 10px', borderRadius: RADIUS.lg, background: 'rgba(0,0,0,0.48)' }}>
            <StarRow filled={stars} size={17} gap={4} off="rgba(255,255,255,0.5)" shine />
          </div>
        )}
      </div>

      {/* 하단 화이트 패널 — 오픈 카드는 칩 없이 제목·설명만 세로 중앙(최고점·별 목표는 이미지 위 배지로, 단어수 캡슐은 불필요로 제거 — 사용자 결정) */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: imgH, bottom: 0, background: '#fff', textAlign: 'left' }}>
        <div style={unlocked
          ? { position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', right: 74 }
          : { position: 'absolute', left: 18, top: panelH >= 130 ? 15 : 11, right: 18 }}>
          <div style={{ ...TYPE.title, color: TG.INK, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{theme.label}</div>
          <div style={{ marginTop: 5, ...TYPE.sub, color: PANEL_SUB, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {unlocked ? (theme.desc || `${count}단어`) : themeUnlockReqText(theme)}
          </div>
        </div>
        {!unlocked && (
          /* 진행 게이지 — 해제 조건 대비 현재 최고점(잠금이 벽이 아니라 목표로 읽히게) */
          <div style={{ position: 'absolute', left: 18, right: 18, bottom: panelH >= 130 ? 17 : 13 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
              <span style={{ ...TYPE.labelSm, color: GOLD_TX }}>
                {unlockCur.toLocaleString()} / {theme.unlock.score.toLocaleString()}
              </span>
            </div>
            <div style={{ height: 8, borderRadius: RADIUS.xs, background: GAUGE_BG, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: RADIUS.xs, background: TG.SUN, width: `${Math.min(100, (unlockCur / theme.unlock.score) * 100)}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* 시작 버튼(오픈만) — 패널 우측 세로중앙. 포커스 카드에서만 맥동 강조 */}
      {unlocked && (
        <div style={{
          position: 'absolute', right: 16, top: imgH + (panelH - 46) / 2, width: 46, height: 46, borderRadius: RADIUS.xxl,
          background: TG.CORAL_DK, boxShadow: '0 5px 12px rgba(242,72,76,0.42)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: (focused && !prefersReducedMotion()) ? 'tg-fab-pulse 1.5s ease-in-out infinite' : 'none',
        }}>
          <PlayIcon size={18} weight="fill" color="#fff" />
        </div>
      )}
    </div>
  );
}

export function ThemeScreen({ themes, studentToken, counts = {}, onStart, onBack, onLocked }) {
  const [active, setActive] = useState(0);
  const [cardH, setCardH] = useState(calcCardH); // 기준 높이(5:7 산출용) — 실제 카드는 아래 boxH
  const cardW = Math.round((cardH * 5) / 7);
  // 카드 실높이 = 이미지(기준의 65%, 크롭 불변) + 고정 패널 100px — 칩 제거 후 하단 여백 밸런스(상단 기준으로 세로 축소)
  const imgH = Math.round(cardH * 0.65);
  const boxH = imgH + 100;
  useEffect(() => {
    const onResize = () => setCardH(calcCardH());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 캐러셀 다이내믹 — 중앙에서 멀어질수록 축소(0.92)·딤(0.75). 스크롤 위치 연동, rAF로 프레임당 1회.
  const scrollerRef = useRef(null);
  const fxRefs = useRef([]); // 카드 시각 래퍼(스케일은 버튼이 아닌 내부 래퍼에 — tg-press/shake transform과 충돌 방지)
  const scrollRafRef = useRef(0);
  const applyFx = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    fxRefs.current.forEach((node) => {
      if (!node) return;
      const r = node.parentElement.getBoundingClientRect(); // 버튼(비변형) 기준
      const d = Math.min(1, Math.abs(r.left + r.width / 2 - center) / (cardW + GAP));
      node.style.transform = `scale(${1 - 0.08 * d})`;
      node.style.opacity = String(1 - 0.25 * d);
    });
  };
  useEffect(() => { applyFx(); }, [cardH]); // 마운트·리사이즈 직후 초기 적용
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
  // PC 웹 내비 — 화살표 버튼·마우스 휠로 한 카드씩 이동(터치 스와이프 대체).
  const scrollToIndex = (i) => {
    const el = scrollerRef.current;
    if (!el) return;
    const idx = Math.max(0, Math.min(themes.length - 1, i));
    el.scrollTo({ left: idx * (cardW + GAP), behavior: 'smooth' });
  };
  const wheelLockRef = useRef(0); // 휠 이벤트 연사(트랙패드 관성) → 350ms당 1스텝
  const onWheel = (e) => {
    if (!FINE_POINTER) return;
    const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(d) < 8) return;
    const now = Date.now();
    if (now - wheelLockRef.current < 350) return;
    wheelLockRef.current = now;
    scrollToIndex(active + (d > 0 ? 1 : -1));
  };
  const navBtn = (disabled) => ({
    position: 'absolute', top: PAD_TOP + boxH / 2 - 20, width: 40, height: 40, borderRadius: RADIUS.xl,
    background: '#fff', boxShadow: '0px 3px 5px rgba(43,39,48,0.14)', border: 'none', zIndex: 2,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1, ...TOUCH_OPT,
  });
  // 항상 중앙 스냅 — 좌우 패딩을 (컨테이너폭-카드폭)/2 로 줘서 첫·끝 카드도 가운데에 오게.
  const sidePad = `max(24px, calc((100% - ${cardW}px) / 2))`;
  return (
    <>
      {/* 배경 앰비언트 파티클 — 포커스 테마 연동(첫 자식 = 모든 콘텐츠 뒤) */}
      <AmbientParticles themeId={themes[active]?.id} />
      {/* 헤더 — 공용 GameHeader */}
      <GameHeader title="테마 선택" onBack={onBack} />
      {/* 코치+카드+닷/힌트 = 헤더 바로 아래 상단정렬(모드/난이도 화면과 동일 리듬 — 큰 카드가 아래로 쏠리지 않게). */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 80, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* 코치 말풍선 */}
        <Reveal i={1} style={{ paddingLeft: 24, paddingRight: 24 }}>
          <CoachBubble text="어떤 테마로 즐겨볼까요?" />
        </Reveal>
        {/* 카드 가로 스냅스크롤 (항상 중앙 스냅 · 양옆 peek 축소·딤) — PC는 좌우 화살표·휠로 넘김 */}
        <div style={{ position: 'relative' }}>
        <div ref={scrollerRef} onScroll={onScroll} onWheel={onWheel} className="tg-noscroll" style={{
          display: 'flex', gap: GAP, flexShrink: 0,
          paddingTop: PAD_TOP, paddingBottom: PAD_BOTTOM, paddingLeft: sidePad, paddingRight: sidePad,
          overflowX: 'auto', overflowY: 'hidden', scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
        }}>
          {themes.map((t, idx) => {
            const unlocked = isThemeUnlocked(studentToken, t);
            return (
              <ShakeButton key={t.id} shakeOnClick={!unlocked}
                onClick={() => { if (unlocked) { playSfx('button'); onStart(t); } else if (onLocked) onLocked(themeUnlockToastText(t)); }}
                className={unlocked ? 'tg-press' : ''}
                style={{
                  flex: `0 0 ${cardW}px`, width: cardW, height: boxH, scrollSnapAlign: 'center',
                  position: 'relative', padding: 0, border: 'none', background: 'transparent',
                  cursor: 'pointer', ...TOUCH_OPT,
                }}>
                <div ref={(n) => { fxRefs.current[idx] = n; }} style={{ position: 'absolute', inset: 0, borderRadius: RADIUS.xxl, boxShadow: '0 5px 14px rgba(43,39,48,0.10)' }}>
                  <ThemeCard theme={t} unlocked={unlocked} best={themeBestScore(studentToken, t.gameKey)}
                    count={counts[t.id] || 0} cardH={boxH} imgH={imgH} focused={idx === active}
                    unlockCur={t.unlock ? themeBestScore(studentToken, t.unlock.byGameKey) : 0} />
                </div>
              </ShakeButton>
            );
          })}
        </div>
        {FINE_POINTER && (
          <>
            <button onClick={() => scrollToIndex(active - 1)} aria-label="이전 테마" disabled={active === 0}
              style={{ ...navBtn(active === 0), left: 10 }}>
              <CaretLeftIcon size={20} weight="bold" color={TG.INK} />
            </button>
            <button onClick={() => scrollToIndex(active + 1)} aria-label="다음 테마" disabled={active === themes.length - 1}
              style={{ ...navBtn(active === themes.length - 1), right: 10 }}>
              <CaretRightIcon size={20} weight="bold" color={TG.INK} />
            </button>
          </>
        )}
        </div>
        {/* 페이지 닷 + 스크롤 힌트 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {themes.map((t, i) => (
              <div key={t.id} style={{ width: i === active ? 20 : 6, height: 6, borderRadius: RADIUS.xs, background: i === active ? TG.CORAL_DK : TG.MUTED, transition: `all ${DUR.state} ease` }} />
            ))}
          </div>
          <span style={{ ...TYPE.meta, color: TG.SUB }}>
            {FINE_POINTER ? '화살표 버튼이나 휠로 테마를 넘겨보세요' : '옆으로 넘겨 테마를 골라보세요'}
          </span>
        </div>
      </div>
    </>
  );
}
