// 난이도 모드 — 15스테이지 + 급별 보스(승급시험) 세로 사다리.
// Figma "05. 난이도 — 진입포지션 / 스크롤"(2026-08-03) 리디자인:
//   · 선택·스냅·확대 개념 제거 → 모든 칸이 같은 카드. **카드의 플레이 버튼을 누르면 바로 시작**.
//   · 왼쪽 레일 = 전 구간 점선(#E0D8C5) + 밟은 구간만 실선(#9AAC5D), 노드는 26px 링(깬 칸엔 체크).
//   · 하단 고정바 = [맨 위로] [현재 난이도로] — 진입은 항상 맨 아래(입문 1)에서 시작한다.
//   · 리스트 아래엔 모드선택과 같은 들판 배경(FieldBg).
//   · '단어카드설정(뜻·병음)' 토글은 카드에서 빠짐 → 설정 팝업으로 이동 예정(디자인 대기, 2026-08-03 사용자 결정).
// 배경 = 게임 공통 크림(FigmaScreen TG.BG). rank(=깬 보스 수)가 급 첫 스테이지·보스 해제 게이트.
import { useRef, useState, useEffect, useLayoutEffect } from 'react';
// 아이콘 = Solar (weight="Bold"). 급별 강도 램프: 잎→불꽃→불→번개→왕관. 보스=메달.
import { Lock, Play, Leaf, Flame, Fire, Bolt, CrownStar, MedalStar, CheckCircle } from '@solar-icons/react';
import { TG, TYPE, TOUCH_OPT, DIFF_COLORS, RADIUS, SPACE } from '../tgTokens.js';
import { STAGES, BOSSES, isStageUnlocked, stageUnlockToastText, stageStarFlags, stageScoreOf, bossState, isTierCleared } from '../gameLogic.js';
import { play as playSfx } from '../tgSfx.js';
import { GameHeader, StarRow, FieldBg, prefersReducedMotion } from './shared.jsx';
import CoachMarkOverlay from '../../components/ui/CoachMarkOverlay.jsx';
import { useTabTip } from '../../hooks/useTabTip.js';

// 스테이지 난이도 아이콘 — 밴드(1~5)마다 강도가 세짐(잎→불꽃→불→번개→왕관). 급은 색(DIFF_COLORS)으로 구분.
const STAGE_ICONS = [Leaf, Flame, Fire, Bolt, CrownStar];
// 시안 치수(390 기준): 카드 266×72(r20) · 행 피치 92 · 레일 중심 x53 · 카드 좌측 84 · 우측 여백 40
const ROW_H = 92, CARD_H = 72, RAIL_X = 53, CARD_L = 84, CARD_R = 40, COL_W = 390;
// 노드 실측(시안 absoluteRenderBounds): 원 26 · **stroke 4 INSIDE** → 시각 지름은 26 그대로, 링은 안쪽 4px.
//  속 원 20(=26-4*2 + 링과 1px 겹침, 육안 무시). 체크 = 획 3 round, 14 프레임 중앙.
const NODE = 26, NODE_RING = 4;
const CHECK_W = 14, CHECK_H = 14, CHECK_SW = 3;
const RAIL_DASH = '#E0D8C5', RAIL_SOLID = '#9AAC5D', CHECK_INK = '#FFFDF8';
// 레일 — 폭 3, 대시 6/6(시안 dashPattern 그대로). ★border-left로 그리면 브라우저가 2.667px로 반올림해
//  레일 중심(52.83)과 노드 중심(53)이 어긋난다 → **width+background**로 그려 정확히 3px·중심 53 유지.
const RAIL_W = 3, RAIL_LEFT = RAIL_X - RAIL_W / 2;
const RAIL_DASH_BG = `repeating-linear-gradient(to bottom, ${RAIL_DASH} 0 6px, transparent 6px 12px)`;
// 배경 패럴랙스 — 맨 아래(입문1)에선 들판이 그대로, 맨 위(고수5)로 갈수록 아래로 밀려 거의 사라진다.
const FIELD_SHIFT = 460;
const CHIP_BG = '#E4EDF5', SCORE_C = '#8F9CA7';
const ICON_BG = '#F4F4F4'; // 난이도 아이콘 칩 배경(2026-08-06 사용자 지정) — 잠김 버튼(CHIP_BG)과는 별개

// 사다리 = 각 급 [5스테이지 (+ 그 급 승급시험이 있으면 보스)]. 승급시험은 급 사이만(입문·실전) — 마지막 급(고수)엔 없음.
// 세로 배치용 reverse(위=고수5, 아래=입문1). 위로 오를수록 어려워짐.
const TIERS = [...new Set(STAGES.map((s) => s.tier))]; // 급 순서 = STAGES 순서에서 파생(DIFFICULTIES 단일출처)
const LADDER = TIERS.flatMap((tier) => {
  const stages = STAGES.filter((s) => s.tier === tier);
  const boss = BOSSES.find((b) => b.tier === tier);
  return boss ? [...stages, boss] : stages;
});
const V_LADDER = [...LADDER].reverse();
const isBoss = (it) => it.kind === 'boss';

const DIFF_COACH = [
  // ★현재 칸 카드를 비춘다 — 리스트 전체를 스포트라이트로 잡으면 화면 전부가 구멍이 되어 딤이 사라진다(2026-08-06 사용자 지적)
  { selector: '[data-coach="diff-card"]', label: '위로 오를수록 어려워지고, 급 끝엔 승급시험이 있어요. 카드의 ▶︎를 누르면 바로 시작해요!' },
  { selector: '[data-coach="diff-current"]', label: '멀리 스크롤했으면 여기로 현재 난이도에 바로 돌아와요.' },
];

export function DifficultyScreen({ studentToken, rank = 0, onSelect, onStart, onBack, onLocked }) {
  const tip = useTabTip('game-difficulty', true);
  const scrollerRef = useRef(null);
  const rowRefs = useRef([]);
  const artRef = useRef(null);      // 들판 배경(패럴랙스 대상)
  const rafRef = useRef(0);
  const innerRef = useRef(null);   // 리스트 콘텐츠(오버스크롤 바운스 대상)
  const pullRef = useRef(0);       // 현재 당김량(px)
  const touchY = useRef(0);
  const wheelAcc = useRef(0);
  const releaseT = useRef(0);
  const wheelT = useRef(0);
  const [padY, setPadY] = useState(0); // 첫/끝 칸을 화면 중앙에 두기 위한 상하 여백

  // 칸 상태 헬퍼 — 스테이지는 isStageUnlocked, 보스는 bossState(rank 게이트).
  const bsOf = (it) => bossState(studentToken, it.tierIdx, rank);
  // 시작 가능 — 승급시험은 **통과한 뒤에도 언제든 재도전**(2026-08-03 사용자 요청). 잠긴 건 'prev'(앞 급 미통과)뿐.
  const itemSelectable = (it) => (isBoss(it) ? (bsOf(it) === 'ready' || bsOf(it) === 'beaten') : isStageUnlocked(studentToken, it, rank));
  const itemReached = (it) => (isBoss(it) ? (bsOf(it) === 'ready' || bsOf(it) === 'beaten') : isStageUnlocked(studentToken, it, rank));
  // 레일·노드 표시용 '도달' — **응시 가능 ≠ 도달**. 승급시험은 상시 개방(bossState 항상 'ready')이라
  //  itemReached 그대로 쓰면 아무것도 안 깬 상태에서도 위쪽 승급시험 칸이 초록으로 칠해져
  //  진행 레일이 중간중간 끊긴 채 채워져 보였다(2026-08-06 사용자 지적). 승급시험은 그 급을 다 깼거나 통과했을 때만 도달.
  const railReached = (it) => (isBoss(it)
    ? (bsOf(it) === 'beaten' || isTierCleared(studentToken, it.tier))
    : isStageUnlocked(studentToken, it, rank));

  // 마지막으로 도달한 칸 = '현재 난이도'(하단 버튼 목적지)
  const firstUnreached = LADDER.findIndex((it) => !itemReached(it));
  const lastReached = firstUnreached < 0 ? LADDER[LADDER.length - 1] : LADDER[Math.max(0, firstUnreached - 1)];
  const currentVIdx = V_LADDER.findIndex((it) => it.id === lastReached.id);
  // 밟은 구간(실선) = 맨 아래(입문 1)부터 **연속으로** 도달한 칸까지. 중간에 끊기면 거기서 멈춘다
  //  (건너뛴 위쪽 칸이 따로 초록이 되지 않게 — 레일은 '여기까지 왔다'는 하나의 선이어야 한다)
  const topReachedVIdx = (() => {
    let top = V_LADDER.length - 1;
    for (let i = V_LADDER.length - 1; i >= 0; i -= 1) {
      if (!railReached(V_LADDER[i])) break;
      top = i;
    }
    return top;
  })();

  // 상하 패딩 = (화면높이 - 행높이)/2 → 스크롤 끝에서 첫/끝 칸이 **화면 정중앙**에 온다
  //  (맨 아래=입문 1 중앙, 맨 위=고수 5 중앙 — 2026-08-03 사용자 요청)
  useLayoutEffect(() => {
    const measure = () => { const el = scrollerRef.current; if (el) setPadY(Math.max(0, (el.clientHeight - ROW_H) / 2)); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // 배경 패럴랙스 — 스크롤 위치에 따라 들판을 아래로 밀어낸다(맨 위에선 거의 사라짐)
  const applyParallax = () => {
    const el = scrollerRef.current, art = artRef.current;
    if (!el || !art) return;
    const max = Math.max(1, el.scrollHeight - el.clientHeight);
    const t = Math.min(1, Math.max(0, el.scrollTop / max)); // 0=맨 위(고수5) · 1=맨 아래(입문1)
    art.style.transform = `translateX(-50%) translateY(${((1 - t) * FIELD_SHIFT).toFixed(1)}px)`;
  };
  const onScroll = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; applyParallax(); });
  };
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // ── 오버스크롤 바운스 — 끝에서 더 당기면 리스트가 고무줄처럼 딸려왔다가 튕겨 돌아온다.
  //  네이티브 바운스(iOS)와 겹치지 않게 스크롤러엔 overscrollBehavior:'none'을 주고 이 연출만 쓴다.
  //  당김량은 제곱근 감쇠(당길수록 뻑뻑) + 최대 96px.
  const damp = (dy) => Math.sign(dy) * Math.min(96, Math.abs(dy) ** 0.72 * 1.9);
  const setPull = (v) => {
    const c = innerRef.current; if (!c) return;
    pullRef.current = v;
    c.style.transform = v ? `translateY(${v.toFixed(1)}px)` : '';
  };
  const releasePull = () => {
    const c = innerRef.current; if (!c || !pullRef.current) return;
    c.style.transition = 'transform .42s cubic-bezier(.22,1,.36,1)'; // 살짝 오버슈트 있는 스프링 느낌
    setPull(0);
    clearTimeout(releaseT.current);
    releaseT.current = setTimeout(() => { if (innerRef.current) innerRef.current.style.transition = ''; }, 460);
  };
  const edgeOf = () => {
    const el = scrollerRef.current; if (!el) return 0;
    if (el.scrollTop <= 0) return 1;                                            // 위 끝(고수 5)
    if (el.scrollTop >= el.scrollHeight - el.clientHeight - 1) return -1;       // 아래 끝(입문 1)
    return 0;
  };
  const onTouchStart = (e) => { touchY.current = e.touches[0].clientY; };
  const onTouchMove = (e) => {
    if (prefersReducedMotion()) return;
    const dy = e.touches[0].clientY - touchY.current;
    const edge = edgeOf();
    if ((edge === 1 && dy > 0) || (edge === -1 && dy < 0)) {
      if (innerRef.current) innerRef.current.style.transition = '';
      setPull(damp(dy));
    } else if (pullRef.current) setPull(0);
  };
  const onWheel = (e) => {
    if (prefersReducedMotion()) return;
    const edge = edgeOf();
    if ((edge === 1 && e.deltaY < 0) || (edge === -1 && e.deltaY > 0)) {
      if (innerRef.current) innerRef.current.style.transition = '';
      wheelAcc.current = Math.max(-260, Math.min(260, wheelAcc.current - e.deltaY));
      setPull(damp(wheelAcc.current));
      clearTimeout(wheelT.current);
      wheelT.current = setTimeout(() => { wheelAcc.current = 0; releasePull(); }, 110); // 휠은 '뗀 시점'이 없어 idle로 판정
    }
  };
  useEffect(() => () => { clearTimeout(releaseT.current); clearTimeout(wheelT.current); }, []);

  // 진입 = 맨 아래(입문 1이 화면 중앙, 시안 "진입포지션") → 잠깐 뒤 **현재 난이도까지 스르륵 올라가는 연출**.
  //  사다리를 아래에서부터 훑어 올라가며 '내가 여기까지 왔다'를 보여준다. 모션 민감 설정이면 연출 없이 바로 이동.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !padY) return;
    el.scrollTop = el.scrollHeight;
    applyParallax();
    if (currentVIdx < 0 || currentVIdx === V_LADDER.length - 1) return undefined; // 신규(입문1) — 이미 그 자리
    if (prefersReducedMotion()) { scrollToIdx(currentVIdx, 'auto'); return undefined; }
    const t = setTimeout(() => scrollToIdx(currentVIdx, 'smooth'), 520);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [padY]);

  const scrollToIdx = (idx, behavior = 'smooth') => {
    const el = scrollerRef.current, row = rowRefs.current[idx];
    if (!el || !row) return;
    const er = el.getBoundingClientRect(), rr = row.getBoundingClientRect();
    el.scrollTo({ top: el.scrollTop + (rr.top - er.top) + rr.height / 2 - el.clientHeight / 2, behavior });
  };

  const start = (s) => {
    if (itemSelectable(s)) { playSfx('button'); onSelect && onSelect(s); onStart && onStart(s); return; }
    if (isBoss(s) && bsOf(s) === 'beaten') { playSfx('button'); onLocked && onLocked('이미 통과한 승급시험이에요!', 'done'); return; }
    playSfx('locked');
    onLocked && onLocked(isBoss(s)
      ? (bsOf(s) === 'prev' ? '앞 급 승급시험부터 통과해야 해요' : `${s.tierLabel} 5단계를 다 깨면 도전할 수 있어요`)
      : stageUnlockToastText(studentToken, s, rank));
  };

  return (
    <>
      {/* 배경 — 모드선택과 같은 들판(맨 뒤). 리스트가 그 위를 스크롤한다 */}
      <FieldBg artRef={artRef} />
      {/* 헤더 — 시안: 60px 글래스 + 가운데 타이틀 */}
      <GameHeader title="난이도 모드" onBack={onBack} glass center />

      {/* 스크롤 영역은 화면 전체(inset 0) — 헤더/하단바 뒤로 카드가 그대로 흘러가야 두 바의 배경 블러가 산다.
          잘라내지 않고 padding으로만 비켜준다(사용자 요청: "리스트 마스킹 영역에 자르지 마") */}
      <div data-coach="diff-list" ref={scrollerRef} onScroll={onScroll} className="tg-noscroll"
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={releasePull} onTouchCancel={releasePull} onWheel={onWheel} style={{
        position: 'absolute', inset: 0,
        overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', zIndex: 2,
        overscrollBehavior: 'none', // 네이티브 바운스/스크롤 체이닝 끄기 — 아래 커스텀 바운스만 쓴다
      }}>
        <div ref={innerRef} style={{
          position: 'relative', width: '100%', maxWidth: COL_W, margin: '0 auto',
          paddingTop: padY, paddingBottom: padY,
        }}>
          {/* 레일 — 전 구간 점선 위에 밟은 구간만 실선을 덧그림.
              첫/끝 노드 중심에서 끊는다 — 위아래로 삐져나오는 '꼬다리' 제거(2026-08-03 사용자 요청) */}
          <div aria-hidden="true" style={{
            position: 'absolute', left: RAIL_LEFT, top: padY + ROW_H / 2, bottom: padY + ROW_H / 2,
            width: RAIL_W, backgroundImage: RAIL_DASH_BG, zIndex: 0,
          }} />

          {V_LADDER.map((s, idx) => {
            const boss = isBoss(s);
            const bs = boss ? bsOf(s) : null;
            const beaten = bs === 'beaten';
            const selectable = itemSelectable(s);
            // 레일·노드는 '연속 도달 구간' 안에서만 초록 — 상시 개방인 승급시험이 진행도처럼 보이지 않게
            const reached = idx >= topReachedVIdx && railReached(s);
            const c = DIFF_COLORS[s.tier] || {};
            const Icon = boss ? MedalStar : (STAGE_ICONS[s.bandIndex] || Leaf);
            const stars = (!boss && selectable) ? stageStarFlags(studentToken, s).filter(Boolean).length : 0;
            const best = stageScoreOf(studentToken, s.id); // 보스도 같은 맵에 최고점을 저장한다(id=`<급>-boss`)
            const cleared = boss ? beaten : stars > 0;
            const title = boss ? `${s.nextLabel} 승급시험` : s.label;
            return (
              <div key={s.id} ref={(n) => { rowRefs.current[idx] = n; }}
                style={{ position: 'relative', height: ROW_H, zIndex: 1 }}>
                {/* 밟은 구간 실선 — 행마다 자기 몫만 그린다(전역 좌표 계산 없이 항상 정확).
                    맨 위 도달 칸은 아래 절반만, 그 아래 도달 칸들은 행 전체. */}
                {reached && (
                  <div aria-hidden="true" style={{
                    position: 'absolute', left: RAIL_LEFT,
                    top: idx === topReachedVIdx ? ROW_H / 2 : 0,
                    // 맨 아래 칸은 노드 아래로 선이 삐져나오지 않게(꼬다리 제거)
                    bottom: idx === V_LADDER.length - 1 ? ROW_H / 2 : 0,
                    width: RAIL_W, background: RAIL_SOLID, zIndex: 0,
                  }} />
                )}
                {/* 노드 — 26 링(밟았으면 올리브) + 안쪽 크림 원 + 깬 칸은 체크.
                    ⚠️ 크기: border-box + 링 3px + 안쪽 원 20 = 정확히 26. (구: 4px 링에 20 원을 넣어 flex가 눌러 타원으로 찌그러졌음) */}
                <div aria-hidden="true" style={{
                  position: 'absolute', left: RAIL_X, top: ROW_H / 2, transform: 'translate(-50%,-50%)',
                  width: NODE, height: NODE, borderRadius: '50%', boxSizing: 'border-box',
                  // 깬 칸 = 단색 올리브 원 + 흰 체크(다른 색이 비치지 않게 바탕도 올리브)
                  // 현재/잠김 = 크림 속 + 링(현재=올리브 · 잠김=베이지). 베이지 바탕 깔지 말 것 — 링 안쪽으로 비친다.
                  background: cleared ? RAIL_SOLID : TG.BG,
                  border: `${NODE_RING}px solid ${cleared || reached ? RAIL_SOLID : RAIL_DASH}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1,
                }}>
                  {/* 체크 — 시안 vector 실측 크기·획으로 렌더 */}
                  {cleared && (
                    <svg width={CHECK_W} height={CHECK_H} viewBox={`0 0 ${CHECK_W} ${CHECK_H}`} aria-hidden="true">
                      <path d="M3.2 7.2 L5.9 9.9 L10.8 4.4" fill="none" stroke={CHECK_INK} strokeWidth={CHECK_SW} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>

                {/* 카드 — 아이콘 칩 + 제목 + 별·점수 + 시작 버튼. 잠김도 흰 카드(버튼만 자물쇠) */}
                <div data-coach={idx === currentVIdx ? 'diff-card' : undefined} style={{
                  position: 'absolute', left: CARD_L, right: CARD_R, top: (ROW_H - CARD_H) / 2, height: CARD_H,
                  display: 'flex', alignItems: 'center', gap: SPACE.lg, padding: '0 10px 0 10px',
                  borderRadius: RADIUS.xl, background: '#fff',
                  boxShadow: 'inset 0 -2px 0 #E4EDF5, 0 4px 18px rgba(43,39,48,0.07)',
                }}>
                  <div style={{ position: 'relative', width: 50, height: 50, borderRadius: RADIUS.lg, background: ICON_BG, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {/* 잠겨도 아이콘은 급 색 그대로(시안) — 잠김 표시는 오른쪽 자물쇠 버튼이 전담 */}
                    <Icon size={boss ? 30 : 34} weight="Bold" color={c.accent || TG.SUN} />
                    {cleared && boss && (
                      <CheckCircle size={18} weight="Bold" color={c.accent || TG.SUN} style={{ position: 'absolute', right: 2, bottom: 2, background: ICON_BG, borderRadius: '50%' }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ ...TYPE.h2, lineHeight: 1, color: TG.INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md }}>
                      <StarRow filled={boss ? (beaten ? 3 : 0) : stars} size={16} gap={2} off="#D8D2C8" shine />
                      {/* 승급시험도 스테이지와 같은 '점수' 표기(2026-08-03 사용자 요청) — 시험 종료 시 보스 id로 최고점 저장 */}
                      <span style={{ ...TYPE.num, fontSize: 13, color: SCORE_C, whiteSpace: 'nowrap' }}>{best.toLocaleString()}점</span>
                    </div>
                  </div>
                  {/* 시작 — 누르면 바로 시작(선택 단계 없음). 잠김은 회색 자물쇠 + 안내 토스트 */}
                  <button type="button" className="tg-press" onClick={() => start(s)}
                    aria-label={selectable ? `${title} 시작` : `${title} 잠김`}
                    style={{
                      width: 50, height: 50, flexShrink: 0, borderRadius: RADIUS.xl, border: 'none', cursor: 'pointer',
                      background: selectable ? '#F96163' : CHIP_BG,
                      boxShadow: selectable ? 'inset 0 -4px 0 #E64244, 0 4px 8px rgba(43,39,48,0.07)' : 'inset 0 -4px 0 #CFDBE6',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 4, ...TOUCH_OPT,
                    }}>
                    {selectable ? <Play size={17} weight="Bold" color="#fff" /> : <Lock size={17} weight="Bold" color={SCORE_C} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 하단 고정바 — 글래스 + [맨 위로] [현재 난이도로]
          ⚠️ Reveal(등장 애니메이션) 안에 넣으면 새 스택 컨텍스트가 생겨 **backdrop-filter가 죽는다** → 바는 Reveal 밖에 둔다 */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 3 }}>
        <div style={{
          height: 'calc(96px + env(safe-area-inset-bottom))', padding: '10px 24px calc(26px + env(safe-area-inset-bottom))',
          display: 'flex', gap: SPACE.lg, alignItems: 'flex-start',
          background: 'rgba(255,253,248,0.5)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        }}>
          <button type="button" className="tg-press" onClick={() => { playSfx('tap', 0.2); scrollToIdx(0); }}
            style={{
              flex: 1, height: 60, borderRadius: RADIUS.xl, border: 'none', cursor: 'pointer', background: '#fff',
              boxShadow: 'inset 0 -4px 0 #E4EDF5, 0 4px 18px rgba(43,39,48,0.07)', paddingBottom: 4, ...TOUCH_OPT,
            }}>
            <span style={{ ...TYPE.head, color: '#7E8A94' }}>맨 위로</span>
          </button>
          <button type="button" data-coach="diff-current" className="tg-press" onClick={() => { playSfx('tap', 0.2); scrollToIdx(currentVIdx); }}
            style={{
              flex: 1, height: 60, borderRadius: RADIUS.xl, border: 'none', cursor: 'pointer', background: '#F96163',
              boxShadow: 'inset 0 -4px 0 #E64244, 0 4px 18px rgba(43,39,48,0.07)', paddingBottom: 4, ...TOUCH_OPT,
            }}>
            <span style={{ ...TYPE.head, color: '#fff' }}>현재 난이도로</span>
          </button>
        </div>
      </div>
      <CoachMarkOverlay visible={tip.visible} onDone={tip.dismiss} steps={DIFF_COACH} delay={160} showControls={false} />
    </>
  );
}
