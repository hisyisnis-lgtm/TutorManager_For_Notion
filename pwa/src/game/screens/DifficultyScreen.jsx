// 난이도 선택 — 15스테이지(입문/실전/고수 × 5밴드) 세로 스크롤 피커('하늘 오르기').
// 선택 = 탭. 탭한 스테이지가 상세로 펼쳐지고 가운데로 스냅되며, 스크롤해도 선택은 유지된다(탭으로만 바뀜).
// 첫 진입: 맨 아래(입문1)에서 '마지막으로 해제된 스테이지'까지 스르륵 올라가 자동 선택되는 연출.
// 배경 = 하늘: 위로 오를수록(고수) 깊은 파랑, 아래(입문)는 지평선 톤. 스크롤에 따라 실시간 변화.
// 기록·페이스는 티어 단위(gameLogic), 스테이지는 난이도 밴드 + 티어 점수 순차 해제.
import { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { CaretLeftIcon, LockSimpleIcon, PlayIcon, StarIcon, PlantIcon, LeafIcon, FlameIcon, LightningIcon, CrownIcon } from '@phosphor-icons/react';
import { TG, FONT_TITLE, FONT_BODY, TOUCH_OPT, DIFF_COLORS } from '../tgTokens.js';
import { STAGES, isStageUnlocked, stageUnlockToastText, stageStarFlags } from '../gameLogic.js';
import { play as playSfx } from '../tgSfx.js';
import { Reveal, prefersReducedMotion } from './shared.jsx';
import CoachMarkOverlay from '../../components/ui/CoachMarkOverlay.jsx';
import { useTabTip } from '../../hooks/useTabTip.js';

// 스테이지 난이도 아이콘 — 밴드(1~5)마다 강도가 세짐(새싹→잎→불꽃→번개→왕관). 급은 색(DIFF_COLORS)으로 구분.
const STAGE_ICONS = [PlantIcon, LeafIcon, FlameIcon, LightningIcon, CrownIcon];
const SLOT_H = 92; // 슬롯 높이(균일)
// 아래→위 오름 배치(하늘 오르기): 입문1이 맨 아래, 고수5가 맨 위. 위로 스크롤해 어려워짐.
const V_STAGES = [...STAGES].reverse();
const BOTTOM_VIDX = V_STAGES.length - 1; // 입문1(맨 아래) = 인트로 시작 위치

// ── 하늘 색 그라디언트(고도감) — 진행도 p(0=하단 입문, 1=상단 고수)로 3스톱 보간 ──
const SKY_LOW = [[214, 233, 247], [235, 242, 247], [251, 243, 230]];  // 입문(지평선 근처: 옅은 하늘 → 따뜻)
const SKY_HIGH = [[74, 124, 182], [122, 168, 212], [188, 214, 235]];  // 고수(높은 파란 하늘)
const lerp = (a, b, t) => Math.round(a + (b - a) * t);
const skyGradient = (p) => {
  const c = (i) => `rgb(${lerp(SKY_LOW[i][0], SKY_HIGH[i][0], p)},${lerp(SKY_LOW[i][1], SKY_HIGH[i][1], p)},${lerp(SKY_LOW[i][2], SKY_HIGH[i][2], p)})`;
  return `linear-gradient(180deg, ${c(0)} 0%, ${c(1)} 52%, ${c(2)} 100%)`;
};

const DIFF_COACH = [
  { selector: '[data-coach="diff-list"]', label: '스테이지를 탭하면 선택돼요. 위로 오를수록 어려워져요!' },
  { selector: '[data-coach="diff-start"]', label: '선택한 스테이지로 시작하려면 이 버튼을 눌러요!' },
];

export function DifficultyScreen({ studentToken, onSelect, onStart, onBack, onLocked }) {
  const tip = useTabTip('game-difficulty', true);
  const scrollerRef = useRef(null);
  const rowRefs = useRef([]);
  const rafRef = useRef(0);
  const bgRef = useRef(null);
  const introTargetRef = useRef(-1); // 인트로 자동 스크롤 목표 V인덱스(도착 시 자동 선택). -1=인트로 아님.
  const [padY, setPadY] = useState(0);
  // active = 가운데(브라우징) 스테이지 — 아직 아무것도 '선택'(탭) 안 했을 때 CTA 기본 대상.
  const [active, setActive] = useState(BOTTOM_VIDX);
  const activeRef = useRef(active); activeRef.current = active;
  // selectedIdx = 탭으로 '선택'된 스테이지(상세 펼침 + CTA). -1=미선택 → 전부 간략. 스크롤로는 안 바뀜(유지).
  const [selectedIdx, setSelectedIdx] = useState(-1);
  // 잠금 스테이지 탭 시 흔들림 — 공용 .tg-shake 클래스 토글(ShakeButton과 동일 패턴). off→on 재트리거.
  const [shake, setShake] = useState({ idx: -1, on: false });

  // 마지막으로 해제된 스테이지(난이도순 최고 해제 = 첫 잠금 직전). 입문1은 항상 해제라 최소 BOTTOM.
  const firstLocked = STAGES.find((s) => !isStageUnlocked(studentToken, s));
  const lastUnlockedStage = firstLocked ? STAGES[Math.max(0, STAGES.indexOf(firstLocked) - 1)] : STAGES[STAGES.length - 1];
  const targetVIdx = V_STAGES.findIndex((s) => s.id === lastUnlockedStage.id);

  // 스크롤 위치 → 하늘 색 실시간 반영(리렌더 없이 DOM 직접 조작).
  const paintSky = (scrollTop, maxScroll) => {
    const p = maxScroll > 0 ? Math.min(1, Math.max(0, 1 - scrollTop / maxScroll)) : 0; // 상단(scrollTop 0)=고수=1
    if (bgRef.current) bgRef.current.style.background = skyGradient(p);
  };

  // 컨테이너 높이로 상/하 패딩 = (H - SLOT)/2 → 첫·끝 스테이지도 가운데 정렬
  useLayoutEffect(() => {
    const measure = () => { const el = scrollerRef.current; if (el) setPadY(Math.max(0, (el.clientHeight - SLOT_H) / 2)); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  // 첫 진입 인트로 — 맨 아래(입문1)에서 시작 → 잠깐 뒤 마지막 해제 스테이지까지 스르륵 올라가 자동 선택.
  useLayoutEffect(() => {
    const el = scrollerRef.current; if (!el || padY === 0) return;
    el.scrollTop = BOTTOM_VIDX * SLOT_H;
    paintSky(el.scrollTop, el.scrollHeight - el.clientHeight);
    if (targetVIdx <= BOTTOM_VIDX && targetVIdx >= 0 && targetVIdx === BOTTOM_VIDX) {
      setSelectedIdx(BOTTOM_VIDX); setActive(BOTTOM_VIDX); onSelect && onSelect(V_STAGES[BOTTOM_VIDX]); // 신규(입문1만) → 즉시 선택
      return undefined;
    }
    introTargetRef.current = targetVIdx;
    const t = setTimeout(() => { const e = scrollerRef.current; if (e) e.scrollTo({ top: targetVIdx * SLOT_H, behavior: 'smooth' }); }, 480);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [padY]);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const scrollToRow = (idx) => {
    const el = scrollerRef.current; if (!el) return;
    if (Math.abs(el.scrollTop - idx * SLOT_H) < 2) return;
    el.scrollTo({ top: idx * SLOT_H, behavior: 'smooth' });
  };

  const onScroll = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const s = scrollerRef.current; if (!s) return;
      paintSky(s.scrollTop, s.scrollHeight - s.clientHeight);
      if (introTargetRef.current >= 0) { // 인트로 자동 스크롤 중 — 목표 도착 시 자동 선택
        if (Math.abs(s.scrollTop - introTargetRef.current * SLOT_H) < 2) {
          const t = introTargetRef.current; introTargetRef.current = -1;
          setSelectedIdx(t); setActive(t); playSfx('tap', 0.2); onSelect && onSelect(V_STAGES[t]);
        }
        return;
      }
      // 가운데 스테이지 = active(미선택 시 CTA 대상). 선택(selectedIdx)은 스크롤로 안 바뀜 — 탭으로만.
      const centerY = s.getBoundingClientRect().top + s.clientHeight / 2;
      let best = 0, bestD = Infinity;
      rowRefs.current.forEach((r, i) => {
        if (!r) return;
        const rr = r.getBoundingClientRect();
        const d = Math.abs(rr.top + rr.height / 2 - centerY);
        if (d < bestD) { bestD = d; best = i; }
      });
      if (best !== activeRef.current) setActive(best);
    });
  };

  const focused = V_STAGES[selectedIdx >= 0 ? selectedIdx : active] || V_STAGES[BOTTOM_VIDX];
  const centerY = (i) => padY + i * SLOT_H + SLOT_H / 2;
  const focusedUnlocked = isStageUnlocked(studentToken, focused);
  const reduceMotion = prefersReducedMotion();

  return (
    <>
      {/* 하늘 배경 — 스크롤 진행도로 실시간 색 변화(위=고수=깊은 파랑, 아래=입문=지평선 톤) */}
      <div ref={bgRef} aria-hidden="true" style={{ position: 'absolute', inset: 0, background: skyGradient(0) }} />

      {/* 헤더 */}
      <Reveal i={0} style={{ position: 'absolute', left: 24, top: 20, right: 24, zIndex: 3 }}>
        <div style={{ height: 40, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={onBack} aria-label="뒤로" className="tg-press" style={{ width: 40, height: 40, borderRadius: 20, background: '#fff', boxShadow: '0px 3px 6px rgba(43,79,120,0.14)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT }}>
            <CaretLeftIcon size={20} weight="bold" color={TG.INK} />
          </button>
          <span style={{ fontFamily: FONT_TITLE, fontSize: 22, color: '#2b2730' }}>난이도 선택</span>
        </div>
      </Reveal>

      {/* 세로 스크롤 — 선택(탭)된 스테이지만 확대, 나머지 간략 */}
      <div data-coach="diff-list" ref={scrollerRef} onScroll={onScroll} className="tg-noscroll" style={{
        position: 'absolute', left: 0, right: 0, top: 72, bottom: 'calc(104px + env(safe-area-inset-bottom))',
        overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
        paddingTop: padY, paddingBottom: padY, zIndex: 2,
        // 위·아래 가장자리 자연스러운 페이드(뚝 잘림 방지)
        maskImage: 'linear-gradient(to bottom, transparent 0, #000 66px, #000 calc(100% - 74px), transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 66px, #000 calc(100% - 74px), transparent 100%)',
      }}>
        {/* 스테이지 사이 트레일 — 아래 칸을 깼으면(별1+) 골드 실선(오른 길), 아니면 옅은 점선(남은 길). 카드 뒤(간격) */}
        {padY > 0 && V_STAGES.slice(0, -1).map((s, i) => {
          const climbed = stageStarFlags(studentToken, V_STAGES[i + 1])[0];
          return (
            <div key={`seg-${s.id}`} aria-hidden="true" style={{
              position: 'absolute', left: '50%', top: centerY(i), height: centerY(i + 1) - centerY(i),
              transform: 'translateX(-50%)', zIndex: 0, pointerEvents: 'none',
              ...(climbed
                ? { width: 5, borderRadius: 3, background: TG.SUN, boxShadow: '0 0 6px rgba(255,194,60,0.5)' }
                : { width: 4, borderRadius: 2, backgroundImage: 'repeating-linear-gradient(180deg, rgba(255,255,255,0.6) 0 7px, transparent 7px 15px)' }),
            }} />
          );
        })}
        {V_STAGES.map((s, idx) => {
          const isSelected = idx === selectedIdx;
          const c = DIFF_COLORS[s.tier];
          const Icon = STAGE_ICONS[s.bandIndex] || LeafIcon;
          const unlocked = isStageUnlocked(studentToken, s);
          const stars = unlocked ? stageStarFlags(studentToken, s) : null;
          return (
            <div key={s.id} ref={(n) => { rowRefs.current[idx] = n; }}
              className={shake.idx === idx && shake.on ? 'tg-shake' : ''}
              onClick={() => {
                if (!unlocked) { // 잠금=안 펼침 → 공용 흔들림(tg-shake) + locked 사운드 + 해제조건 토스트
                  if (!reduceMotion) { setShake({ idx, on: false }); requestAnimationFrame(() => setShake({ idx, on: true })); }
                  playSfx('locked');
                  onLocked && onLocked(stageUnlockToastText(studentToken, s));
                  return;
                }
                setSelectedIdx(idx); setActive(idx); introTargetRef.current = -1; onSelect && onSelect(V_STAGES[idx]); playSfx('tap', 0.2); scrollToRow(idx);
              }}
              role="button" tabIndex={0} aria-label={`${s.label} 선택`}
              style={{ height: SLOT_H, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <div style={{
                width: isSelected ? 316 : (unlocked ? 220 : 'auto'), transition: 'transform .28s ease',
                transform: isSelected ? 'scale(1)' : 'scale(0.96)',
              }}>
                {isSelected ? (
                  /* 선택(확대) 카드 — 항상 해제된 것만(잠긴 건 선택 불가·토스트). 좌 아이콘 · 중앙 라벨+별 · 우 시작 */
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 13, padding: '0 16px 0 14px', height: 78, borderRadius: 22,
                    background: '#fff', border: `2.5px solid ${c.accent}`, boxShadow: `0 12px 26px ${c.glow}`,
                  }}>
                    <div style={{ width: 50, height: 50, borderRadius: 16, flexShrink: 0, background: c.tint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon size={26} weight="fill" color={c.accent} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <span style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 18, lineHeight: 1, color: '#2b2730' }}>{s.label}</span>
                      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                        {stars.map((f, si) => <StarIcon key={si} size={17} weight="fill" color={f ? TG.SUN : '#e4dece'} />)}
                      </div>
                    </div>
                    <div onClick={(e) => { e.stopPropagation(); playSfx('button'); onStart(s); }}
                      role="button" aria-label={`${s.label} 시작`}
                      style={{ width: 40, height: 40, borderRadius: 20, flexShrink: 0, cursor: 'pointer', background: c.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 5px 12px ${c.glow}`, '--fab-glow': c.glow, '--fab-glow-lg': c.glow, animation: reduceMotion ? 'none' : 'tg-fab-pulse 1.5s ease-in-out infinite', ...TOUCH_OPT }}>
                      <PlayIcon size={16} weight="fill" color="#fff" />
                    </div>
                  </div>
                ) : unlocked ? (
                  /* 간략(해제) — 아이콘 + 라벨 + 미니 별 */
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 15px', height: 46, borderRadius: 23, background: 'rgba(255,255,255,0.9)', boxShadow: '0 3px 9px rgba(43,79,120,0.1)' }}>
                    <div style={{ width: 26, height: 26, borderRadius: 9, flexShrink: 0, background: c.tint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon size={15} weight="fill" color={c.accent} />
                    </div>
                    <span style={{ flex: 1, fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: '#4a4550', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
                    <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                      {stars.map((f, si) => <StarIcon key={si} size={12} weight="fill" color={f ? TG.SUN : '#d8d2c8'} />)}
                    </div>
                  </div>
                ) : (
                  /* 간략(잠금) — 자물쇠 + 라벨, 급 색(티어 tint/accent)으로 물들이되 살짝 눌러 잠금 느낌 */
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '0 15px', height: 46, borderRadius: 23, background: '#fff', boxShadow: '0 3px 9px rgba(43,79,120,0.1)' }}>
                    <div style={{ width: 26, height: 26, borderRadius: 9, flexShrink: 0, background: c.tint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <LockSimpleIcon size={15} weight="fill" color={c.accent} />
                    </div>
                    <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: c.accent, whiteSpace: 'nowrap' }}>{s.label}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* CTA 하단 고정 — 선택한 스테이지 시작(잠기면 안내 토스트) */}
      <Reveal i={2} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(30px + env(safe-area-inset-bottom))', zIndex: 3 }}>
        <button data-coach="diff-start"
          onClick={() => { if (focusedUnlocked) { playSfx('button'); onStart(focused); } else onLocked && onLocked(stageUnlockToastText(studentToken, focused)); }}
          className="tg-press" style={{
            width: '100%', height: 62, borderRadius: 20, border: 'none', cursor: 'pointer',
            background: focusedUnlocked ? TG.CORAL_GRAD : '#d8d2ca',
            boxShadow: focusedUnlocked ? '0px 10px 22px rgba(242,72,76,0.34)' : 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, ...TOUCH_OPT,
          }}>
          {focusedUnlocked ? (
            <>
              <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 19, color: '#fff' }}>{focused.label} 시작</span>
              <PlayIcon size={13} weight="fill" color="#fff" />
            </>
          ) : (
            <>
              <LockSimpleIcon size={16} weight="fill" color="#fff" />
              <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15, color: '#fff' }}>더 높은 점수로 열려요</span>
            </>
          )}
        </button>
      </Reveal>
      <CoachMarkOverlay visible={tip.visible} onDone={tip.dismiss} steps={DIFF_COACH} delay={160} showControls={false} />
    </>
  );
}
