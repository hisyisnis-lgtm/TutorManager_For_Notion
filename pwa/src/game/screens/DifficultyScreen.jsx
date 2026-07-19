// 난이도 선택 — 15스테이지 + 급별 보스(승급시험) 세로 스크롤 사다리('하늘 오르기').
// 선택 = 탭. 탭한 칸이 상세로 펼쳐지고 가운데로 스냅되며, 스크롤해도 선택은 유지된다(탭으로만 바뀜).
// 급 경계엔 '보스'(승급시험) — 급 5스테이지 다 깨면 도전 가능, 통과하면 rank↑·다음 급 해제. 통과=✓.
// 첫 진입: 맨 아래(입문1)에서 '마지막으로 도달한 칸'까지 스르륵 올라가 자동 선택.
// 배경 = 하늘: 위로 오를수록 깊은 파랑. rank(=깬 보스 수)가 급 첫 스테이지·보스 해제 게이트.
import { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { LockSimpleIcon, PlayIcon, PlantIcon, LeafIcon, FlameIcon, LightningIcon, CrownIcon, MedalIcon, CheckIcon } from '@phosphor-icons/react';
import { TG, TYPE, TOUCH_OPT, DIFF_COLORS, RADIUS, SPACE } from '../tgTokens.js';
import { STAGES, BOSSES, isStageUnlocked, stageUnlockToastText, stageStarFlags, stageScoreOf, bossState } from '../gameLogic.js';
import { play as playSfx } from '../tgSfx.js';
import { Reveal, GameHeader, StarRow, prefersReducedMotion } from './shared.jsx';
import CoachMarkOverlay from '../../components/ui/CoachMarkOverlay.jsx';
import { useTabTip } from '../../hooks/useTabTip.js';

// 스테이지 난이도 아이콘 — 밴드(1~5)마다 강도가 세짐(새싹→잎→불꽃→번개→왕관). 급은 색(DIFF_COLORS)으로 구분.
const STAGE_ICONS = [PlantIcon, LeafIcon, FlameIcon, LightningIcon, CrownIcon];
const SLOT_H = 92; // 슬롯 높이(균일)
const ROW_W = 240; // 비선택 컴팩트 카드 공용 폭(잠금·해제·승급시험 통일 — 들쭉날쭉 방지)
const ROW_H = 52;  // 비선택 컴팩트 카드 공용 높이(모바일 요소 스케일 한 단계 up)
// 사다리 = 각 급 [5스테이지 + 보스]. 세로 배치용 reverse(위=고수 보스, 아래=입문1). 위로 오를수록 어려워짐.
const LADDER = BOSSES.flatMap((boss) => [...STAGES.filter((s) => s.tier === boss.tier), boss]);
const V_LADDER = [...LADDER].reverse();
const BOTTOM_VIDX = V_LADDER.length - 1; // 입문1(맨 아래) = 인트로 시작 위치
const isBoss = (it) => it.kind === 'boss';

// ── 하늘 색 그라디언트(고도감) — 진행도 p(0=하단 입문, 1=상단 고수)로 3스톱 보간 ──
const SKY_LOW = [[214, 233, 247], [235, 242, 247], [251, 243, 230]];  // 입문(지평선 근처: 옅은 하늘 → 따뜻)
const SKY_HIGH = [[74, 124, 182], [122, 168, 212], [188, 214, 235]];  // 고수(높은 파란 하늘)
const lerp = (a, b, t) => Math.round(a + (b - a) * t);
const skyGradient = (p) => {
  const c = (i) => `rgb(${lerp(SKY_LOW[i][0], SKY_HIGH[i][0], p)},${lerp(SKY_LOW[i][1], SKY_HIGH[i][1], p)},${lerp(SKY_LOW[i][2], SKY_HIGH[i][2], p)})`;
  return `linear-gradient(180deg, ${c(0)} 0%, ${c(1)} 52%, ${c(2)} 100%)`;
};

const DIFF_COACH = [
  { selector: '[data-coach="diff-list"]', label: '탭하면 선택돼요. 위로 오를수록 어려워지고, 급 끝엔 승급시험이 있어요!' },
  { selector: '[data-coach="diff-start"]', label: '선택한 곳으로 시작하려면 이 버튼을 눌러요!' },
];

export function DifficultyScreen({ studentToken, rank = 0, onSelect, onStart, onBack, onLocked }) {
  const tip = useTabTip('game-difficulty', true);
  const scrollerRef = useRef(null);
  const rowRefs = useRef([]);
  const rafRef = useRef(0);
  const bgRef = useRef(null);
  const introTargetRef = useRef(-1); // 인트로 자동 스크롤 목표 V인덱스(도착 시 자동 선택). -1=인트로 아님.
  const [padY, setPadY] = useState(0);
  const [active, setActive] = useState(BOTTOM_VIDX);
  const activeRef = useRef(active); activeRef.current = active;
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [shake, setShake] = useState({ idx: -1, on: false });

  // 칸 상태 헬퍼 — 스테이지는 isStageUnlocked, 보스는 bossState(rank 게이트).
  const bsOf = (it) => bossState(studentToken, it.tierIdx, rank);
  const itemSelectable = (it) => (isBoss(it) ? bsOf(it) === 'ready' : isStageUnlocked(studentToken, it, rank)); // 펼침·시작 가능
  const itemReached = (it) => (isBoss(it) ? (bsOf(it) === 'ready' || bsOf(it) === 'beaten') : isStageUnlocked(studentToken, it, rank)); // 도달(해제)된 칸

  // 마지막으로 도달한 칸(첫 미도달 직전) → 인트로 스크롤 목표.
  const firstUnreached = LADDER.findIndex((it) => !itemReached(it));
  const lastReached = firstUnreached < 0 ? LADDER[LADDER.length - 1] : LADDER[Math.max(0, firstUnreached - 1)];
  const targetVIdx = V_LADDER.findIndex((it) => it.id === lastReached.id);

  const paintSky = (scrollTop, maxScroll) => {
    const p = maxScroll > 0 ? Math.min(1, Math.max(0, 1 - scrollTop / maxScroll)) : 0; // 상단(scrollTop 0)=고수=1
    if (bgRef.current) bgRef.current.style.background = skyGradient(p);
  };

  useLayoutEffect(() => {
    const measure = () => { const el = scrollerRef.current; if (el) setPadY(Math.max(0, (el.clientHeight - SLOT_H) / 2)); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  // 첫 진입 인트로 — 맨 아래(입문1)에서 시작 → 잠깐 뒤 마지막 도달 칸까지 스르륵 올라가 자동 선택.
  useLayoutEffect(() => {
    const el = scrollerRef.current; if (!el || padY === 0) return;
    el.scrollTop = BOTTOM_VIDX * SLOT_H;
    paintSky(el.scrollTop, el.scrollHeight - el.clientHeight);
    if (targetVIdx <= BOTTOM_VIDX && targetVIdx >= 0 && targetVIdx === BOTTOM_VIDX) {
      setSelectedIdx(BOTTOM_VIDX); setActive(BOTTOM_VIDX); onSelect && onSelect(V_LADDER[BOTTOM_VIDX]); // 신규(입문1만) → 즉시 선택
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
          setSelectedIdx(t); setActive(t); playSfx('tap', 0.2); onSelect && onSelect(V_LADDER[t]);
        }
        return;
      }
      const centerY0 = s.getBoundingClientRect().top + s.clientHeight / 2;
      let best = 0, bestD = Infinity;
      rowRefs.current.forEach((r, i) => {
        if (!r) return;
        const rr = r.getBoundingClientRect();
        const d = Math.abs(rr.top + rr.height / 2 - centerY0);
        if (d < bestD) { bestD = d; best = i; }
      });
      if (best !== activeRef.current) setActive(best);
    });
  };

  const focused = V_LADDER[selectedIdx >= 0 ? selectedIdx : active] || V_LADDER[BOTTOM_VIDX];
  const centerY = (i) => padY + i * SLOT_H + SLOT_H / 2;
  const focusedBoss = isBoss(focused);
  const focusedBs = focusedBoss ? bsOf(focused) : null;
  const focusedSelectable = itemSelectable(focused);
  const reduceMotion = prefersReducedMotion();

  return (
    <>
      {/* 하늘 배경 — 스크롤 진행도로 실시간 색 변화(위=고수=깊은 파랑, 아래=입문=지평선 톤) */}
      <div ref={bgRef} aria-hidden="true" style={{ position: 'absolute', inset: 0, background: skyGradient(0) }} />

      {/* 헤더 — 공용 GameHeader */}
      <GameHeader title="난이도 선택" onBack={onBack} />

      {/* 세로 스크롤 — 선택(탭)된 칸만 확대, 나머지 간략 */}
      <div data-coach="diff-list" ref={scrollerRef} onScroll={onScroll} className="tg-noscroll" style={{
        position: 'absolute', left: 0, right: 0, top: 72, bottom: 'calc(104px + env(safe-area-inset-bottom))',
        overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
        paddingTop: padY, paddingBottom: padY, zIndex: 2,
        maskImage: 'linear-gradient(to bottom, transparent 0, #000 66px, #000 calc(100% - 74px), transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 66px, #000 calc(100% - 74px), transparent 100%)',
      }}>
        {/* 칸 사이 트레일 — 위 칸을 깼으면(스테이지 별1+ / 보스 통과) 골드 실선, 아니면 옅은 점선 */}
        {padY > 0 && V_LADDER.slice(0, -1).map((s, i) => {
          const upper = V_LADDER[i + 1];
          const climbed = isBoss(upper) ? bossState(studentToken, upper.tierIdx, rank) === 'beaten' : stageStarFlags(studentToken, upper)[0];
          return (
            <div key={`seg-${s.id}`} aria-hidden="true" style={{
              position: 'absolute', left: '50%', top: centerY(i), height: centerY(i + 1) - centerY(i),
              transform: 'translateX(-50%)', zIndex: 0, pointerEvents: 'none',
              ...(climbed
                ? { width: 5, borderRadius: RADIUS.xs, background: TG.SUN, boxShadow: '0 0 6px rgba(255,194,60,0.5)' }
                : { width: 4, borderRadius: RADIUS.xs, backgroundImage: 'repeating-linear-gradient(180deg, rgba(255,255,255,0.6) 0 7px, transparent 7px 15px)' }),
            }} />
          );
        })}
        {V_LADDER.map((s, idx) => {
          const isSelected = idx === selectedIdx;
          const boss = isBoss(s);
          const bs = boss ? bsOf(s) : null;
          const beaten = bs === 'beaten';
          const selectable = boss ? bs === 'ready' : isStageUnlocked(studentToken, s, rank);
          const c = DIFF_COLORS[s.tier]; // 보스도 급 색(입문=초록 등). 보스 구분은 메달 아이콘·'보스' 라벨로.
          const Icon = boss ? MedalIcon : (STAGE_ICONS[s.bandIndex] || LeafIcon);
          const stars = (!boss && selectable) ? stageStarFlags(studentToken, s) : null;
          const best = (!boss && selectable) ? stageScoreOf(studentToken, s.id) : 0;
          const lockToast = boss
            ? (bs === 'prev' ? '앞 급 승급시험부터 통과해야 해요' : `${s.tierLabel} 5단계를 다 깨면 도전할 수 있어요`)
            : stageUnlockToastText(studentToken, s, rank);
          return (
            <div key={s.id} ref={(n) => { rowRefs.current[idx] = n; }}
              className={shake.idx === idx && shake.on ? 'tg-shake' : ''}
              onClick={() => {
                if (selectable) {
                  setSelectedIdx(idx); setActive(idx); introTargetRef.current = -1; onSelect && onSelect(V_LADDER[idx]); playSfx('tap', 0.2); scrollToRow(idx);
                  return;
                }
                if (beaten) { playSfx('button'); onLocked && onLocked('이미 통과한 승급시험이에요!', 'done'); return; }
                if (!reduceMotion) { setShake({ idx, on: false }); requestAnimationFrame(() => setShake({ idx, on: true })); }
                playSfx('locked');
                onLocked && onLocked(lockToast);
              }}
              role="button" tabIndex={0} aria-label={`${s.label} 선택`}
              style={{ position: 'relative', zIndex: 1, height: SLOT_H, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <div style={{
                width: isSelected ? 316 : ((selectable || beaten) ? 'auto' : 'auto'), transition: 'transform .28s ease',
                transform: isSelected ? 'scale(1)' : 'scale(0.96)',
              }}>
                {isSelected && boss ? (
                  /* 보스 선택(확대) 카드 — 골드 관문 */
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: SPACE.xl, padding: '0 16px 0 14px', height: 78, borderRadius: RADIUS.xxl,
                    background: '#fff', border: `2.5px solid ${c.accent}`, boxShadow: `0 12px 26px ${c.glow}`,
                  }}>
                    <div style={{ width: 50, height: 50, borderRadius: RADIUS.lg, flexShrink: 0, background: c.tint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <MedalIcon size={27} weight="fill" color={c.accent} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <span style={{ ...TYPE.h1, lineHeight: 1, color: TG.INK }}>{s.tierLabel} 승급시험</span>
                      <span style={{ ...TYPE.sub, color: TG.SUB, whiteSpace: 'nowrap' }}>20문제 · 정답률 80% 이상</span>
                    </div>
                    <div onClick={(e) => { e.stopPropagation(); playSfx('button'); onStart(s); }}
                      role="button" aria-label={`${s.tierLabel} 승급시험 도전`}
                      style={{ width: 40, height: 40, borderRadius: RADIUS.xl, flexShrink: 0, cursor: 'pointer', background: c.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 5px 12px ${c.glow}`, '--fab-glow': c.glow, '--fab-glow-lg': c.glow, animation: reduceMotion ? 'none' : 'tg-fab-pulse 1.5s ease-in-out infinite', ...TOUCH_OPT }}>
                      <PlayIcon size={16} weight="fill" color="#fff" />
                    </div>
                  </div>
                ) : isSelected ? (
                  /* 스테이지 선택(확대) 카드 — 좌 아이콘 · 중앙 라벨+별 · 우 시작 */
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: SPACE.xl, padding: '0 16px 0 14px', height: 78, borderRadius: RADIUS.xxl,
                    background: '#fff', border: `2.5px solid ${c.accent}`, boxShadow: `0 12px 26px ${c.glow}`,
                  }}>
                    <div style={{ width: 50, height: 50, borderRadius: RADIUS.lg, flexShrink: 0, background: c.tint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon size={26} weight="fill" color={c.accent} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
                      <span style={{ ...TYPE.h1, lineHeight: 1, color: TG.INK }}>{s.label}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.lg }}>
                        <StarRow filled={stars.filter(Boolean).length} size={17} gap={5} off="#e4dece" shine />
                        <span style={{ ...TYPE.num, color: best > 0 ? TG.SUB : TG.MUTED, whiteSpace: 'nowrap' }}>
                          {best > 0 ? `최고 ${best.toLocaleString()}` : '기록 없음'}
                        </span>
                      </div>
                    </div>
                    <div onClick={(e) => { e.stopPropagation(); playSfx('button'); onStart(s); }}
                      role="button" aria-label={`${s.label} 시작`}
                      style={{ width: 40, height: 40, borderRadius: RADIUS.xl, flexShrink: 0, cursor: 'pointer', background: c.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 5px 12px ${c.glow}`, '--fab-glow': c.glow, '--fab-glow-lg': c.glow, animation: reduceMotion ? 'none' : 'tg-fab-pulse 1.5s ease-in-out infinite', ...TOUCH_OPT }}>
                      <PlayIcon size={16} weight="fill" color="#fff" />
                    </div>
                  </div>
                ) : boss && beaten ? (
                  /* 보스 통과 — 골드 ✓ */
                  <div style={{ display: 'flex', width: ROW_W, alignItems: 'center', gap: SPACE.lg, padding: '0 15px', height: ROW_H, borderRadius: RADIUS.xxl, background: '#fff', boxShadow: '0 3px 9px rgba(43,79,120,0.1)' }}>
                    <div style={{ position: 'relative', width: 32, height: 32, borderRadius: RADIUS.md, flexShrink: 0, background: c.tint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <MedalIcon size={18} weight="fill" color={c.accent} />
                      <span style={{ position: 'absolute', right: -3, bottom: -3, width: 14, height: 14, borderRadius: RADIUS.pill, background: c.accent, border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <CheckIcon size={8} weight="bold" color="#fff" />
                      </span>
                    </div>
                    <span style={{ ...TYPE.label, color: c.accent, whiteSpace: 'nowrap' }}>{s.tierLabel} 승급시험 통과</span>
                  </div>
                ) : boss && selectable ? (
                  /* 보스 도전 가능(ready) — 골드 크라운 + 승급시험 */
                  <div style={{ display: 'flex', width: ROW_W, alignItems: 'center', gap: SPACE.lg, padding: '0 15px', height: ROW_H, borderRadius: RADIUS.xxl, background: '#fff', boxShadow: `0 4px 12px ${c.glow}` }}>
                    <div style={{ width: 32, height: 32, borderRadius: RADIUS.md, flexShrink: 0, background: c.tint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <MedalIcon size={18} weight="fill" color={c.accent} />
                    </div>
                    <span style={{ ...TYPE.label, color: c.accent, whiteSpace: 'nowrap' }}>{s.tierLabel} 승급시험</span>
                  </div>
                ) : boss ? (
                  /* 보스 잠금 — 좌 메달(원래 아이콘) + 우 자물쇠 */
                  <div style={{ display: 'flex', width: ROW_W, alignItems: 'center', gap: SPACE.lg, padding: '0 15px', height: ROW_H, borderRadius: RADIUS.xxl, background: '#fff', boxShadow: '0 3px 9px rgba(43,79,120,0.1)' }}>
                    <div style={{ width: 32, height: 32, borderRadius: RADIUS.md, flexShrink: 0, background: c.tint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon size={18} weight="fill" color={c.accent} />
                    </div>
                    <span style={{ flex: 1, minWidth: 0, ...TYPE.label, color: c.accent, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.tierLabel} 승급시험</span>
                    <LockSimpleIcon size={17} weight="fill" color={TG.MUTED} style={{ flexShrink: 0 }} />
                  </div>
                ) : selectable ? (
                  /* 스테이지 간략(해제) — 아이콘 + 라벨 + 미니 별 */
                  <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.lg, padding: '0 15px', height: ROW_H, borderRadius: RADIUS.xxl, background: '#fff', boxShadow: '0 3px 9px rgba(43,79,120,0.1)', width: ROW_W }}>
                    <div style={{ width: 32, height: 32, borderRadius: RADIUS.md, flexShrink: 0, background: c.tint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon size={18} weight="fill" color={c.accent} />
                    </div>
                    <span style={{ flex: 1, ...TYPE.label, color: TG.INK_SOFT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
                    <StarRow filled={stars.filter(Boolean).length} size={14} gap={3} off="#d8d2c8" shine style={{ flexShrink: 0 }} />
                  </div>
                ) : (
                  /* 스테이지 간략(잠금) — 좌 원래 아이콘 + 우 자물쇠 */
                  <div style={{ display: 'flex', width: ROW_W, alignItems: 'center', gap: SPACE.lg, padding: '0 15px', height: ROW_H, borderRadius: RADIUS.xxl, background: '#fff', boxShadow: '0 3px 9px rgba(43,79,120,0.1)' }}>
                    <div style={{ width: 32, height: 32, borderRadius: RADIUS.md, flexShrink: 0, background: c.tint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon size={18} weight="fill" color={c.accent} />
                    </div>
                    <span style={{ flex: 1, minWidth: 0, ...TYPE.label, color: TG.INK_SOFT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
                    <LockSimpleIcon size={17} weight="fill" color={TG.MUTED} style={{ flexShrink: 0 }} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* CTA 하단 고정 — 선택한 칸 시작(보스=승급시험, 잠기면 안내 토스트) */}
      <Reveal i={2} style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(30px + env(safe-area-inset-bottom))', zIndex: 3 }}>
        <button data-coach="diff-start"
          onClick={() => {
            if (focusedSelectable) { playSfx('button'); onStart(focused); }
            else if (focusedBs === 'beaten') { playSfx('button'); onLocked && onLocked('이미 통과한 승급시험이에요!', 'done'); }
            else {
              const t = focusedBoss
                ? (focusedBs === 'prev' ? '앞 급 승급시험부터 통과해야 해요' : `${focused.tierLabel} 5단계를 다 깨면 도전할 수 있어요`)
                : stageUnlockToastText(studentToken, focused, rank);
              onLocked && onLocked(t);
            }
          }}
          className="tg-press" style={{
            width: '100%', height: 62, borderRadius: RADIUS.xl, border: 'none', cursor: 'pointer',
            background: focusedSelectable ? TG.CORAL_GRAD : (focusedBs === 'beaten' ? ((DIFF_COLORS[focused.tier] || {}).accent || TG.SUN) : TG.MUTED),
            boxShadow: focusedSelectable ? '0px 10px 22px rgba(242,72,76,0.34)' : 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.md, ...TOUCH_OPT,
          }}>
          {focusedSelectable ? (
            <>
              {focusedBoss ? <MedalIcon size={17} weight="fill" color="#fff" /> : null}
              <span style={{ ...TYPE.cta, color: '#fff' }}>{focusedBoss ? '승급시험 도전' : `${focused.label} 시작`}</span>
              {!focusedBoss && <PlayIcon size={13} weight="fill" color="#fff" />}
            </>
          ) : focusedBs === 'beaten' ? (
            <>
              <CheckIcon size={16} weight="bold" color="#fff" />
              <span style={{ ...TYPE.btnSm, color: '#fff' }}>승급시험 통과 완료</span>
            </>
          ) : (
            <>
              <LockSimpleIcon size={16} weight="fill" color="#fff" />
              <span style={{ ...TYPE.btnSm, color: '#fff' }}>{focusedBoss ? '5단계를 다 깨면 열려요' : '더 높은 점수로 열려요'}</span>
            </>
          )}
        </button>
      </Reveal>
      <CoachMarkOverlay visible={tip.visible} onDone={tip.dismiss} steps={DIFF_COACH} delay={160} showControls={false} />
    </>
  );
}
