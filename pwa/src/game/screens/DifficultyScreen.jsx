// 난이도 선택 — 15스테이지 + 급별 보스(승급시험) 세로 스크롤 사다리('하늘 오르기').
// 선택 = 탭. 탭한 칸이 상세로 펼쳐지고 가운데로 스냅되며, 스크롤해도 선택은 유지된다(탭으로만 바뀜).
// 급 경계엔 '보스'(승급시험) — 급 5스테이지 다 깨면 도전 가능, 통과하면 rank↑·다음 급 해제. 통과=✓.
// 첫 진입: 맨 아래(입문1)에서 '마지막으로 도달한 칸'까지 스르륵 올라가 자동 선택.
// 배경 = 게임 공통 크림(FigmaScreen TG.BG). rank(=깬 보스 수)가 급 첫 스테이지·보스 해제 게이트.
import { useState, useRef, useLayoutEffect, useEffect } from 'react';
// 아이콘 = Solar (weight="Bold"). 급별 강도 램프: 잎→불꽃→불→번개→왕관. 보스=메달.
import { Lock, Play, Leaf, Flame, Fire, Bolt, CrownStar, MedalStar, CheckCircle } from '@solar-icons/react';
import { TG, TYPE, TOUCH_OPT, DIFF_COLORS, RADIUS, SPACE } from '../tgTokens.js';
import { STAGES, BOSSES, isStageUnlocked, stageUnlockToastText, stageStarFlags, stageScoreOf, bossState } from '../gameLogic.js';
import { play as playSfx } from '../tgSfx.js';
import { Reveal, GameHeader, StarRow, CrutchRow, prefersReducedMotion } from './shared.jsx';
import CoachMarkOverlay from '../../components/ui/CoachMarkOverlay.jsx';
import { useTabTip } from '../../hooks/useTabTip.js';

// 스테이지 난이도 아이콘 — 밴드(1~5)마다 강도가 세짐(잎→불꽃→불→번개→왕관). 급은 색(DIFF_COLORS)으로 구분.
const STAGE_ICONS = [Leaf, Flame, Fire, Bolt, CrownStar];
const SLOT_H = 92; // 슬롯 높이(균일)
const SEL_EXTRA = 56; // 선택 카드는 CrutchRow 행만큼 더 커짐 → 그 슬롯만 이만큼 키워 위·아래 이웃 간격 유지(안 침범)
const ROW_W = '100%'; // 카드는 오른쪽 열(컨테이너)을 꽉 채움(2열 타임라인 개편)
const GAUGE_CX = 30;   // 왼쪽 진행도 게이지 노드 중심 x (컨테이너 기준)
const TIMELINE_W = 344; // 게이지+카드 그룹 폭 — 화면 중앙 정렬(margin auto). 카드폭 = 344 - (58 lane) - (24 pad) = 262
const ROW_H = 52;  // 비선택 컴팩트 카드 공용 높이(모바일 요소 스케일 한 단계 up)
// 사다리 = 각 급 [5스테이지 (+ 그 급 승급시험이 있으면 보스)]. 승급시험은 급 사이만(입문·실전) — 마지막 급(고수)엔 없음(무한은 고수5 클리어).
// 세로 배치용 reverse(위=고수5, 아래=입문1). 위로 오를수록 어려워짐.
const TIERS = [...new Set(STAGES.map((s) => s.tier))]; // 급 순서 = STAGES 순서에서 파생(DIFFICULTIES 단일출처)
const LADDER = TIERS.flatMap((tier) => {
  const stages = STAGES.filter((s) => s.tier === tier);
  const boss = BOSSES.find((b) => b.tier === tier);
  return boss ? [...stages, boss] : stages;
});
const V_LADDER = [...LADDER].reverse();
const BOTTOM_VIDX = V_LADDER.length - 1; // 입문1(맨 아래) = 인트로 시작 위치
const isBoss = (it) => it.kind === 'boss';

const DIFF_COACH = [
  { selector: '[data-coach="diff-list"]', label: '탭하면 선택돼요. 위로 오를수록 어려워지고, 급 끝엔 승급시험이 있어요!' },
  { selector: '[data-coach="diff-start"]', label: '선택한 곳으로 시작하려면 이 버튼을 눌러요!' },
];

export function DifficultyScreen({ studentToken, rank = 0, onSelect, onStart, onBack, onLocked }) {
  const tip = useTabTip('game-difficulty', true);
  const scrollerRef = useRef(null);
  const rowRefs = useRef([]);
  const rafRef = useRef(0);
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
    // 선택 시 그 칸 슬롯이 커지므로 고정식(idx*SLOT_H) 대신 '실제 렌더 위치'로 가운데 정렬. rAF로 커진 뒤 측정.
    requestAnimationFrame(() => {
      const el = scrollerRef.current; const row = rowRefs.current[idx]; if (!el || !row) return;
      // offsetParent가 중앙 컨테이너로 바뀌어 offsetTop이 padY만큼 어긋남 → getBoundingClientRect로 스크롤러 기준 실측
      const er = el.getBoundingClientRect(), rr = row.getBoundingClientRect();
      const target = el.scrollTop + (rr.top - er.top) + rr.height / 2 - el.clientHeight / 2;
      if (Math.abs(el.scrollTop - target) < 2) return;
      el.scrollTo({ top: target, behavior: 'smooth' });
    });
  };

  const onScroll = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const s = scrollerRef.current; if (!s) return;
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
  // 선택 칸은 슬롯이 SEL_EXTRA만큼 커짐 → 그 칸(중심 +반) 이후 칸(전부 +SEL_EXTRA) 위치 보정
  const centerY = (i) => {
    const extra = selectedIdx < 0 ? 0 : (i > selectedIdx ? SEL_EXTRA : (i === selectedIdx ? SEL_EXTRA / 2 : 0));
    return padY + i * SLOT_H + SLOT_H / 2 + extra;
  };
  // 게이지는 중앙 컨테이너(스크롤러 paddingTop=padY 안쪽) 기준이라 padY만큼 위로 보정
  const gy = (i) => centerY(i) - padY;
  const focusedBoss = isBoss(focused);
  const focusedBs = focusedBoss ? bsOf(focused) : null;
  const focusedSelectable = itemSelectable(focused);
  const reduceMotion = prefersReducedMotion();

  return (
    <>
      {/* 배경 = FigmaScreen의 크림(TG.BG) 그대로 — 게임 전체와 통일된 은은한 크림 단색(하늘 그라데이션 제거) */}
      {/* 헤더 — 공용 GameHeader (보조바퀴 토글은 선택된 카드 안으로 이동) */}
      <GameHeader title="난이도 선택" onBack={onBack} />

      {/* 세로 스크롤 — 선택(탭)된 칸만 확대, 나머지 간략 */}
      <div data-coach="diff-list" ref={scrollerRef} onScroll={onScroll} className="tg-noscroll" style={{
        position: 'absolute', left: 0, right: 0, top: 72, bottom: 'calc(104px + env(safe-area-inset-bottom))',
        overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
        paddingTop: padY, paddingBottom: padY, zIndex: 2,
        maskImage: 'linear-gradient(to bottom, transparent 0, #000 66px, #000 calc(100% - 74px), transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 66px, #000 calc(100% - 74px), transparent 100%)',
      }}>
      {/* 게이지+카드 그룹 — 화면 중앙 정렬(왼쪽 치우침 방지) */}
      <div style={{ position: 'relative', width: '100%', maxWidth: TIMELINE_W, margin: '0 auto' }}>
        {/* 왼쪽 진행도 게이지 — 세로 레일 + 스테이지 위치마다 노드(동그라미). 밟은 구간·완료 노드=골드, 잠김=회색, 선택=강조. */}
        {padY > 0 && (
          <>
            {/* 안 채워진 연속 레일(뒤) */}
            <div aria-hidden="true" style={{
              position: 'absolute', left: GAUGE_CX, top: gy(0), height: gy(V_LADDER.length - 1) - gy(0),
              transform: 'translateX(-50%)', zIndex: 0, pointerEvents: 'none',
              width: 5, borderRadius: RADIUS.xs, background: TG.MUTED,
            }} />
            {/* 채워진 선(앞) — 밟은 구간만 */}
            {V_LADDER.slice(0, -1).map((s, i) => {
              const climbed = isBoss(s) ? bossState(studentToken, s.tierIdx, rank) === 'beaten' : isStageUnlocked(studentToken, s, rank);
              if (!climbed) return null;
              return (
                <div key={`seg-${s.id}`} aria-hidden="true" style={{
                  position: 'absolute', left: GAUGE_CX, top: gy(i), height: gy(i + 1) - gy(i),
                  transform: 'translateX(-50%)', zIndex: 0, pointerEvents: 'none',
                  width: 5, borderRadius: RADIUS.xs, background: TG.SUN,
                }} />
              );
            })}
            {/* 스테이지 노드(동그라미) — 각 칸 위치에. 완료=골드, 잠김=회색, 선택=급 색+흰 링 강조 */}
            {V_LADDER.map((s, i) => {
              const reached = itemReached(s);
              const sel = i === selectedIdx;
              const cc = DIFF_COLORS[s.tier] || {};
              const size = sel ? 20 : 13;
              return (
                <div key={`node-${s.id}`} aria-hidden="true" style={{
                  position: 'absolute', left: GAUGE_CX, top: gy(i), transform: 'translate(-50%,-50%)',
                  width: size, height: size, borderRadius: '50%', zIndex: 1, pointerEvents: 'none',
                  background: sel ? (cc.accent || TG.SUN) : (reached ? TG.SUN : TG.MUTED),
                  boxShadow: sel ? `0 0 0 3px #fff, 0 0 0 5px ${cc.glow || 'rgba(255,194,60,0.3)'}, 0 2px 5px rgba(43,39,48,0.18)` : 'none',
                }} />
              );
            })}
          </>
        )}
        {V_LADDER.map((s, idx) => {
          const isSelected = idx === selectedIdx;
          const boss = isBoss(s);
          const bs = boss ? bsOf(s) : null;
          const beaten = bs === 'beaten';
          const selectable = boss ? bs === 'ready' : isStageUnlocked(studentToken, s, rank);
          const c = DIFF_COLORS[s.tier]; // 보스도 급 색(입문=초록 등). 보스 구분은 메달 아이콘·'보스' 라벨로.
          const Icon = boss ? MedalStar : (STAGE_ICONS[s.bandIndex] || Leaf);
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
              style={{ position: 'relative', zIndex: 1, height: isSelected ? SLOT_H + SEL_EXTRA : SLOT_H, display: 'flex', alignItems: 'center', paddingLeft: GAUGE_CX + 28, paddingRight: 24, cursor: 'pointer' }}>
              <div style={{ width: '100%' }}>
                {isSelected && boss ? (
                  /* 보스 선택(확대) 카드 — 관문 + 보조바퀴 토글 */
                  <div style={{
                    display: 'flex', flexDirection: 'column', gap: SPACE.md, padding: '11px 16px 12px 14px', borderRadius: RADIUS.xxl,
                    background: '#fff', border: `2.5px solid ${c.accent}`, boxShadow: `0 12px 26px ${c.glow}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.xl }}>
                      <MedalStar size={30} weight="Bold" color={c.accent} style={{ flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <span style={{ ...TYPE.h1, lineHeight: 1, color: TG.INK }}>{s.nextLabel} 승급시험</span>
                        <span style={{ ...TYPE.sub, color: TG.SUB, whiteSpace: 'nowrap' }}>20문제 · 정답률 80% 이상</span>
                      </div>
                      <div onClick={(e) => { e.stopPropagation(); playSfx('button'); onStart(s); }}
                        role="button" aria-label={`${s.nextLabel} 승급시험 도전`}
                        style={{ width: 40, height: 40, borderRadius: RADIUS.xl, flexShrink: 0, cursor: 'pointer', background: c.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 5px 12px ${c.glow}`, '--fab-glow': c.glow, '--fab-glow-lg': c.glow, animation: reduceMotion ? 'none' : 'tg-fab-pulse 1.5s ease-in-out infinite', ...TOUCH_OPT }}>
                        <Play size={16} weight="Bold" color="#fff" />
                      </div>
                    </div>
                    <CrutchRow ctx={s.id} key={s.id} />
                  </div>
                ) : isSelected ? (
                  /* 스테이지 선택(확대) 카드 — 상단: 아이콘·라벨·별·시작 / 하단: 보조바퀴 토글 */
                  <div style={{
                    display: 'flex', flexDirection: 'column', gap: SPACE.md, padding: '11px 16px 12px 14px', borderRadius: RADIUS.xxl,
                    background: '#fff', border: `2.5px solid ${c.accent}`, boxShadow: `0 12px 26px ${c.glow}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.xl }}>
                      <Icon size={30} weight="Bold" color={c.accent} style={{ flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <span style={{ ...TYPE.h1, lineHeight: 1, color: TG.INK }}>{s.label}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.lg }}>
                          <StarRow filled={stars.filter(Boolean).length} size={16} gap={5} off="#e4dece" shine />
                          <span style={{ ...TYPE.num, color: best > 0 ? TG.SUB : TG.MUTED, whiteSpace: 'nowrap' }}>
                            {best > 0 ? `최고 ${best.toLocaleString()}` : '기록 없음'}
                          </span>
                        </div>
                      </div>
                      <div onClick={(e) => { e.stopPropagation(); playSfx('button'); onStart(s); }}
                        role="button" aria-label={`${s.label} 시작`}
                        style={{ width: 40, height: 40, borderRadius: RADIUS.xl, flexShrink: 0, cursor: 'pointer', background: c.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 5px 12px ${c.glow}`, '--fab-glow': c.glow, '--fab-glow-lg': c.glow, animation: reduceMotion ? 'none' : 'tg-fab-pulse 1.5s ease-in-out infinite', ...TOUCH_OPT }}>
                        <Play size={16} weight="Bold" color="#fff" />
                      </div>
                    </div>
                    <CrutchRow ctx={s.id} key={s.id} />
                  </div>
                ) : boss && beaten ? (
                  /* 보스 통과 — 흰 카드 + 메달 ✓ */
                  <div style={{ display: 'flex', width: ROW_W, alignItems: 'center', gap: SPACE.lg, padding: '0 15px', height: ROW_H, borderRadius: RADIUS.xxl, background: '#fff', boxShadow: '0 3px 9px rgba(43,79,120,0.1)' }}>
                    <span style={{ position: 'relative', flexShrink: 0, display: 'inline-flex' }}>
                      <MedalStar size={26} weight="Bold" color={c.accent} />
                      <CheckCircle size={15} weight="Bold" color={c.accent} style={{ position: 'absolute', right: -5, bottom: -5, background: '#fff', borderRadius: '50%' }} />
                    </span>
                    <span style={{ ...TYPE.label, color: TG.INK_SOFT, whiteSpace: 'nowrap' }}>{s.nextLabel} 승급시험 통과</span>
                  </div>
                ) : boss && selectable ? (
                  /* 보스 도전 가능(ready) — 흰 카드 + 메달 */
                  <div style={{ display: 'flex', width: ROW_W, alignItems: 'center', gap: SPACE.lg, padding: '0 15px', height: ROW_H, borderRadius: RADIUS.xxl, background: '#fff', boxShadow: `0 4px 12px ${c.glow}` }}>
                    <MedalStar size={26} weight="Bold" color={c.accent} style={{ flexShrink: 0 }} />
                    <span style={{ ...TYPE.label, color: TG.INK_SOFT, whiteSpace: 'nowrap' }}>{s.nextLabel} 승급시험</span>
                  </div>
                ) : boss ? (
                  /* 보스 잠금 — 좌 메달 + 우 자물쇠 */
                  <div style={{ display: 'flex', width: ROW_W, alignItems: 'center', gap: SPACE.lg, padding: '0 15px', height: ROW_H, borderRadius: RADIUS.xxl, background: '#fff', boxShadow: '0 3px 9px rgba(43,79,120,0.1)' }}>
                    <Icon size={26} weight="Bold" color={c.accent} style={{ flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, ...TYPE.label, color: TG.INK_SOFT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.nextLabel} 승급시험</span>
                    <Lock size={18} weight="Bold" color={TG.MUTED} style={{ flexShrink: 0 }} />
                  </div>
                ) : selectable ? (
                  /* 스테이지 간략(해제) — 아이콘 + 라벨 + 미니 별 */
                  <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.lg, padding: '0 15px', height: ROW_H, borderRadius: RADIUS.xxl, background: '#fff', boxShadow: '0 3px 9px rgba(43,79,120,0.1)', width: ROW_W }}>
                    <Icon size={26} weight="Bold" color={c.accent} style={{ flexShrink: 0 }} />
                    <span style={{ flex: 1, ...TYPE.label, color: TG.INK_SOFT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
                    <StarRow filled={stars.filter(Boolean).length} size={14} gap={3} off="#d8d2c8" shine style={{ flexShrink: 0 }} />
                  </div>
                ) : (
                  /* 스테이지 간략(잠금) — 회색 표면으로 '눌린' 느낌: 해제(흰 카드·컬러 아이콘·별)와 뚜렷이 구분 */
                  <div style={{ display: 'flex', width: ROW_W, alignItems: 'center', gap: SPACE.lg, padding: '0 15px', height: ROW_H, borderRadius: RADIUS.xxl, background: TG.SURFACE, border: `1px solid ${TG.BORDER}`, boxShadow: 'none' }}>
                    <Icon size={26} weight="Bold" color={TG.MUTED} style={{ flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, ...TYPE.label, color: TG.MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
                    <Lock size={18} weight="Bold" color={TG.MUTED} style={{ flexShrink: 0 }} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
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
              {focusedBoss ? <MedalStar size={18} weight="Bold" color="#fff" /> : null}
              <span style={{ ...TYPE.cta, color: '#fff' }}>{focusedBoss ? '승급시험 도전' : `${focused.label} 시작`}</span>
              {!focusedBoss && <Play size={14} weight="Bold" color="#fff" />}
            </>
          ) : focusedBs === 'beaten' ? (
            <>
              <CheckCircle size={17} weight="Bold" color="#fff" />
              <span style={{ ...TYPE.btnSm, color: '#fff' }}>승급시험 통과 완료</span>
            </>
          ) : (
            <>
              <Lock size={17} weight="Bold" color="#fff" />
              <span style={{ ...TYPE.btnSm, color: '#fff' }}>{focusedBoss ? '5단계를 다 깨면 열려요' : '더 높은 점수로 열려요'}</span>
            </>
          )}
        </button>
      </Reveal>
      <CoachMarkOverlay visible={tip.visible} onDone={tip.dismiss} steps={DIFF_COACH} delay={160} showControls={false} />
    </>
  );
}
