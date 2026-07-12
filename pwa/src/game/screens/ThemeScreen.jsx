// 테마 선택 화면 — 난이도와 별개 축. 테마별 포스터 카드를 가로 스냅스크롤로 보여줌(항상 중앙 스냅, 양옆 카드 살짝 걸침).
// Figma "23. 테마 선택" 기준(A안: 상단 이미지 + 하단 화이트 패널 분리). 중앙 카드는 크게·선명, 양옆은 축소·딤.
// 잠긴 테마는 흔들림+토스트(ShakeButton/onLocked), 패널에 해제조건+진행 게이지 표기.
// 참조 메모리: tone_game_redesign.md (테마 모드)
import { useState, useEffect, useRef } from 'react';
import { CaretLeftIcon, CaretRightIcon, LockSimpleIcon, PlayIcon, StarIcon } from '@phosphor-icons/react';
import { TG, FONT_TITLE, FONT_BODY, TOUCH_OPT, DUR } from '../tgTokens.js';
import { isThemeUnlocked, themeBestScore, themeUnlockReqText, themeUnlockToastText, themeStars, themeNextStarScore } from '../gameLogic.js';
import { play as playSfx } from '../tgSfx.js';
import { Reveal, CoachBubble, ShakeButton } from './shared.jsx';

const GAP = 16;
// 스크롤 컨테이너 세로 패딩 — overflowY:hidden(가로 스크롤 강제)이 카드 그림자를 자르지 않게 여유 확보.
const PAD_TOP = 12, PAD_BOTTOM = 22;
// 카드 위/아래 고정 요소가 차지하는 세로 합(헤더80+코치63+간격18+스크롤패딩34+닷/힌트54=249)+여유 15.
// 짧은 화면(640 이하)에서 카드가 이만큼 빼고 줄어들어 하단 힌트까지 안 잘림.
const RESERVED_H = 264;
// 패널 텍스트 색 (화이트 패널 위)
const PANEL_SUB = '#6B6572';
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

const metaChip = (bg, color, bold) => ({
  display: 'inline-flex', alignItems: 'center', padding: '5px 10px', borderRadius: 13,
  background: bg, fontFamily: FONT_BODY, fontWeight: bold ? 700 : 500, fontSize: 12, color,
});

// 포스터형 테마 카드 — 상단 65% 이미지 + 하단 화이트 패널(제목·태그라인·메타 칩 / 잠금은 해제조건·진행 게이지)
function ThemeCard({ theme, unlocked, best, count, cardH, unlockCur }) {
  const imgH = Math.round(cardH * 0.65);
  const panelH = cardH - imgH;
  const stars = themeStars(best);
  const nextStar = themeNextStarScore(best);
  return (
    <div style={{ position: 'absolute', inset: 0, borderRadius: 24, overflow: 'hidden', background: '#fff' }}>
      {/* 이미지 영역(상단 65%) */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: imgH, background: theme.tint || '#eee' }}>
        {theme.image
          ? <img src={theme.image} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 30%' }} />
          : (
            <span style={{ position: 'absolute', left: 0, right: 0, top: '42%', textAlign: 'center', fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, lineHeight: 1.5, color: 'rgba(43,39,48,0.3)' }}>
              {theme.placeholder || '이미지'}<br />(준비 중)
            </span>
          )}
        {!unlocked && (
          <>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} />
            <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 56, height: 56, borderRadius: 28, background: 'rgba(0,0,0,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <LockSimpleIcon size={26} weight="fill" color="#fff" />
            </div>
          </>
        )}
        {/* 성취 별 배지 — 최고점 구간별 0~3개(비어있는 별 = 다음 목표) */}
        {unlocked && (
          <div style={{ position: 'absolute', left: 12, top: 12, display: 'flex', gap: 4, alignItems: 'center', padding: '6px 10px', borderRadius: 15, background: 'rgba(0,0,0,0.48)' }}>
            {[0, 1, 2].map((i) => (
              <StarIcon key={i} size={17} weight="fill" color={i < stars ? TG.SUN : 'rgba(255,255,255,0.5)'} />
            ))}
          </div>
        )}
      </div>

      {/* 하단 화이트 패널 */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: imgH, bottom: 0, background: '#fff', textAlign: 'left' }}>
        <div style={{ position: 'absolute', left: 18, top: panelH >= 130 ? 15 : 11, right: unlocked ? 74 : 18 }}>
          <div style={{ fontFamily: FONT_TITLE, fontSize: 22, color: TG.INK, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{theme.label}</div>
          <div style={{ marginTop: 5, fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13, color: PANEL_SUB, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {unlocked ? (theme.desc || `${count}단어`) : themeUnlockReqText(theme)}
          </div>
        </div>
        {unlocked ? (
          /* 메타 칩 — 첫 플레이 전엔 단어수, 플레이 후엔 최고점 + 다음 별까지 남은 점수(성취 동기) */
          <div style={{ position: 'absolute', left: 18, right: 74, bottom: panelH >= 130 ? 15 : 11, display: 'flex', gap: 8, overflow: 'hidden' }}>
            {best > 0 ? (
              <>
                <span style={metaChip(GOLD_BG, GOLD_TX, true)}>최고 {best.toLocaleString()}점</span>
                {nextStar != null && <span style={{ ...metaChip(TG.CORAL_BG, TG.CORAL_DK, true), whiteSpace: 'nowrap' }}>별까지 {(nextStar - best).toLocaleString()}점</span>}
              </>
            ) : (
              <span style={metaChip(CHIP_BG, PANEL_SUB, false)}>{count}단어</span>
            )}
          </div>
        ) : (
          /* 진행 게이지 — 해제 조건 대비 현재 최고점(잠금이 벽이 아니라 목표로 읽히게) */
          <div style={{ position: 'absolute', left: 18, right: 18, bottom: panelH >= 130 ? 17 : 13 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
              <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 11, color: GOLD_TX }}>
                {unlockCur.toLocaleString()} / {theme.unlock.score.toLocaleString()}
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: GAUGE_BG, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 4, background: TG.SUN, width: `${Math.min(100, (unlockCur / theme.unlock.score) * 100)}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* 시작 버튼(오픈만) — 패널 우측 세로중앙 */}
      {unlocked && (
        <div style={{ position: 'absolute', right: 16, top: imgH + (panelH - 46) / 2, width: 46, height: 46, borderRadius: 23, background: TG.CORAL_DK, boxShadow: '0 5px 12px rgba(242,72,76,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <PlayIcon size={18} weight="fill" color="#fff" />
        </div>
      )}
    </div>
  );
}

export function ThemeScreen({ themes, studentToken, counts = {}, onStart, onBack, onLocked }) {
  const [active, setActive] = useState(0);
  const [cardH, setCardH] = useState(calcCardH);
  const cardW = Math.round((cardH * 5) / 7);
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
    position: 'absolute', top: PAD_TOP + cardH / 2 - 20, width: 40, height: 40, borderRadius: 20,
    background: '#fff', boxShadow: '0px 3px 5px rgba(43,39,48,0.14)', border: 'none', zIndex: 2,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1, ...TOUCH_OPT,
  });
  // 항상 중앙 스냅 — 좌우 패딩을 (컨테이너폭-카드폭)/2 로 줘서 첫·끝 카드도 가운데에 오게.
  const sidePad = `max(24px, calc((100% - ${cardW}px) / 2))`;
  return (
    <>
      {/* 헤더 */}
      <Reveal i={0} style={{ position: 'absolute', left: 24, top: 20, right: 24 }}>
        <div style={{ height: 40, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={onBack} aria-label="뒤로" className="tg-press" style={{ width: 40, height: 40, borderRadius: 20, background: '#fff', boxShadow: '0px 3px 5px rgba(43,39,48,0.08)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT }}>
            <CaretLeftIcon size={20} weight="bold" color={TG.INK} />
          </button>
          <span style={{ fontFamily: FONT_TITLE, fontSize: 22, color: '#2b2730' }}>테마 선택</span>
        </div>
      </Reveal>
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
                  flex: `0 0 ${cardW}px`, width: cardW, height: cardH, scrollSnapAlign: 'center',
                  position: 'relative', padding: 0, border: 'none', background: 'transparent',
                  cursor: 'pointer', ...TOUCH_OPT,
                }}>
                <div ref={(n) => { fxRefs.current[idx] = n; }} style={{ position: 'absolute', inset: 0, borderRadius: 24, boxShadow: '0 5px 14px rgba(43,39,48,0.10)' }}>
                  <ThemeCard theme={t} unlocked={unlocked} best={themeBestScore(studentToken, t.gameKey)}
                    count={counts[t.id] || 0} cardH={cardH}
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
              <div key={t.id} style={{ width: i === active ? 20 : 6, height: 6, borderRadius: 3, background: i === active ? TG.CORAL_DK : '#d8d2ca', transition: `all ${DUR.state} ease` }} />
            ))}
          </div>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12.5, color: TG.SUB }}>
            {FINE_POINTER ? '화살표 버튼이나 휠로 테마를 넘겨보세요' : '옆으로 넘겨 테마를 골라보세요'}
          </span>
        </div>
      </div>
    </>
  );
}
