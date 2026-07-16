// 난이도 선택 — 15스테이지(초급/중급/고급 × 5밴드) 세로 스냅 스크롤 피커.
// 가운데 스냅된 스테이지 = 확대·상세(선택), 나머지 = 간략화(작은 알약). 스크롤로 선택이 바뀜. 시작=하단 고정 CTA(스크롤 밖).
// 기록·페이스는 티어 단위(gameLogic), 스테이지는 난이도 밴드 + 티어 점수 순차 해제.
import { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { CaretLeftIcon, CheckCircleIcon, LockSimpleIcon, PlayIcon, StarIcon, PlantIcon, LeafIcon, FlameIcon, LightningIcon, CrownIcon } from '@phosphor-icons/react';
import { TG, FONT_TITLE, FONT_BODY, TOUCH_OPT, DUR, DIFF_COLORS } from '../tgTokens.js';
import { STAGES, isStageUnlocked, stageUnlockProgress, stageUnlockToastText, stageStarFlags } from '../gameLogic.js';
import { play as playSfx } from '../tgSfx.js';
import { Reveal } from './shared.jsx';
import CoachMarkOverlay from '../../components/ui/CoachMarkOverlay.jsx';
import { useTabTip } from '../../hooks/useTabTip.js';

// 스테이지 난이도 아이콘 — 밴드(1~5)마다 강도가 세짐(새싹→잎→불꽃→번개→왕관). 급은 색(DIFF_COLORS)으로 구분.
const STAGE_ICONS = [PlantIcon, LeafIcon, FlameIcon, LightningIcon, CrownIcon];
const SLOT_H = 92; // 스냅 슬롯 높이(균일 — 스냅 안정)
// 아래→위 오름 배치(하늘 오르기): 초급1이 맨 아래, 고급5가 맨 위. 위로 스크롤해 어려워짐.
const V_STAGES = [...STAGES].reverse();

const DIFF_COACH = [
  { selector: '[data-coach="diff-list"]', label: '위아래로 넘겨 가운데에 두면 선택돼요. 스테이지가 오를수록 어려워져요!' },
  { selector: '[data-coach="diff-start"]', label: '가운데 스테이지로 시작하려면 이 버튼을 눌러요!' },
];

export function DifficultyScreen({ selected, studentToken, onSelect, onStart, onBack, onLocked }) {
  const tip = useTabTip('game-difficulty', true);
  const scrollerRef = useRef(null);
  const rowRefs = useRef([]);
  const rafRef = useRef(0);
  const [padY, setPadY] = useState(0);
  // 초기 활성 = selected(부모 selectedDifficulty)의 인덱스(오름 배치 기준), 없으면 맨 아래(초급1)
  const foundIdx = V_STAGES.findIndex((s) => s.id === selected?.id);
  const initIdx = foundIdx < 0 ? V_STAGES.length - 1 : foundIdx;
  const [active, setActive] = useState(initIdx < 0 ? 0 : initIdx);
  const activeRef = useRef(active); activeRef.current = active;

  // 컨테이너 높이로 상/하 패딩 = (H - SLOT)/2 → 첫·끝 스테이지도 가운데 스냅
  useLayoutEffect(() => {
    const measure = () => { const el = scrollerRef.current; if (el) setPadY(Math.max(0, (el.clientHeight - SLOT_H) / 2)); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  // 초기 스크롤 — 선택된 스테이지를 가운데로
  useLayoutEffect(() => {
    const el = scrollerRef.current; if (!el || padY === 0) return;
    el.scrollTop = initIdx * SLOT_H; // padY가 첫 항목을 이미 중앙에 놓으므로 idx*SLOT만큼 이동
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [padY]);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const onScroll = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = scrollerRef.current; if (!el) return;
      const centerY = el.getBoundingClientRect().top + el.clientHeight / 2;
      let best = 0, bestD = Infinity;
      rowRefs.current.forEach((r, i) => {
        if (!r) return;
        const rr = r.getBoundingClientRect();
        const d = Math.abs(rr.top + rr.height / 2 - centerY);
        if (d < bestD) { bestD = d; best = i; }
      });
      if (best !== activeRef.current) {
        setActive(best);
        playSfx('tap', 0.18);
        onSelect && onSelect(V_STAGES[best]); // 부모 selectedDifficulty 동기(CTA·카운트다운·재시작용)
      }
    });
  };

  // 탭/클릭 이동 — 누른 스테이지를 가운데로 스냅(스크롤 → onScroll이 active·선택 갱신)
  const scrollToRow = (idx) => {
    const el = scrollerRef.current; if (!el) return;
    el.scrollTo({ top: idx * SLOT_H, behavior: 'smooth' });
  };

  const focused = V_STAGES[active] || V_STAGES[V_STAGES.length - 1];
  const centerY = (i) => padY + i * SLOT_H + SLOT_H / 2;
  const stageUnlocked = (s) => isStageUnlocked(studentToken, s);
  // 게이지는 '바로 다음에 열릴' 한 스테이지에만 — 난이도순 첫 잠금 스테이지(비연속 해제도 안전).
  const firstLocked = STAGES.find((s) => !stageUnlocked(s));
  const nextLockedVIdx = firstLocked ? V_STAGES.findIndex((s) => s.id === firstLocked.id) : -1;
  const focusedUnlocked = isStageUnlocked(studentToken, focused);

  return (
    <>
      {/* 하늘빛 배경(브랜드 연속성) */}
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, #D7E8F6 0%, #EAF1F6 46%, #FBF3E6 100%)' }} />

      {/* 헤더 */}
      <Reveal i={0} style={{ position: 'absolute', left: 24, top: 20, right: 24, zIndex: 3 }}>
        <div style={{ height: 40, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={onBack} aria-label="뒤로" className="tg-press" style={{ width: 40, height: 40, borderRadius: 20, background: '#fff', boxShadow: '0px 3px 6px rgba(43,79,120,0.12)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT }}>
            <CaretLeftIcon size={20} weight="bold" color={TG.INK} />
          </button>
          <span style={{ fontFamily: FONT_TITLE, fontSize: 22, color: '#2b2730' }}>난이도 선택</span>
        </div>
      </Reveal>

      {/* 세로 스냅 스크롤 — 가운데 스테이지 확대, 위아래 간략 */}
      <div data-coach="diff-list" ref={scrollerRef} onScroll={onScroll} className="tg-noscroll" style={{
        position: 'absolute', left: 0, right: 0, top: 72, bottom: 'calc(104px + env(safe-area-inset-bottom))',
        overflowY: 'auto', overflowX: 'hidden', scrollSnapType: 'y mandatory', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
        paddingTop: padY, paddingBottom: padY, zIndex: 2,
      }}>
        {/* 스테이지 사이를 잇는 트레일 — 구간별. 위 스테이지에 도달(해제)했으면 골드 실선(깬 길), 아니면 옅은 점선(남은 길). 카드 뒤(간격에서 보임) */}
        {padY > 0 && V_STAGES.slice(0, -1).map((s, i) => {
          const climbed = stageStarFlags(studentToken, V_STAGES[i + 1])[0]; // 아래 칸(쉬움)을 '깼으면'(별1+) 이 구간 오른 걸로 → 골드
          return (
            <div key={`seg-${s.id}`} aria-hidden="true" style={{
              position: 'absolute', left: '50%', top: centerY(i), height: centerY(i + 1) - centerY(i),
              transform: 'translateX(-50%)', zIndex: 0, pointerEvents: 'none',
              ...(climbed
                ? { width: 5, borderRadius: 3, background: TG.SUN, boxShadow: '0 0 6px rgba(255,194,60,0.45)' }
                : { width: 4, borderRadius: 2, backgroundImage: 'repeating-linear-gradient(180deg, rgba(120,150,180,0.38) 0 7px, transparent 7px 15px)' }),
            }} />
          );
        })}
        {V_STAGES.map((s, idx) => {
          const isActive = idx === active;
          const c = DIFF_COLORS[s.tier];
          const Icon = STAGE_ICONS[s.bandIndex] || LeafIcon;
          const unlocked = isStageUnlocked(studentToken, s);
          const prog = unlocked ? null : stageUnlockProgress(studentToken, s);
          return (
            <div key={s.id} ref={(n) => { rowRefs.current[idx] = n; }}
              onClick={() => { if (idx !== active) scrollToRow(idx); }}
              role="button" tabIndex={0} aria-label={`${s.label} 선택`}
              style={{ height: SLOT_H, scrollSnapAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <div style={{
                width: isActive ? 312 : (unlocked ? 214 : 'auto'), transition: 'transform .28s ease',
                transform: isActive ? 'scale(1)' : 'scale(0.96)', // 비활성은 크기·무채색·라벨로 구분(불투명). 잠금 간략=내용폭(짧게)
              }}>
                {isActive ? (
                  /* 확대(선택) 카드 — 상세. 해제=별 3개, 다음 잠금=해제 게이지, 그 외 잠금=안내. 잠김은 무채색 */
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', height: 76, borderRadius: 22,
                    background: unlocked ? '#fff' : '#f2eee8',
                    border: `2.5px solid ${unlocked ? c.accent : '#ddd6cc'}`, boxShadow: unlocked ? `0 10px 24px ${c.glow}` : '0 6px 16px rgba(43,79,120,0.1)',
                  }}>
                    <div style={{ width: 46, height: 46, borderRadius: 15, flexShrink: 0, background: unlocked ? c.tint : '#e5e0d8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {unlocked ? <Icon size={24} weight="fill" color={c.accent} /> : <LockSimpleIcon size={22} weight="fill" color="#b3aba2" />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <span style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 17, color: unlocked ? '#2b2730' : '#9a93a0' }}>{s.label}</span>
                      {unlocked ? (
                        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                          {stageStarFlags(studentToken, s).map((f, si) => <StarIcon key={si} size={16} weight="fill" color={f ? TG.SUN : '#e2dccf'} />)}
                        </div>
                      ) : idx === nextLockedVIdx && prog ? (
                        prog.kind === 'cleared' ? (
                          /* 급 전환 — 이전 급 클리어 수 게이지 */
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#e5e0d8', overflow: 'hidden' }}>
                              <div style={{ height: '100%', borderRadius: 3, background: TG.SUN, width: `${Math.min(100, (prog.cur / prog.need) * 100)}%` }} />
                            </div>
                            <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 10.5, color: '#A46A00', whiteSpace: 'nowrap' }}>{prog.prevLabel} 클리어 {prog.cur}/{prog.need}</span>
                          </div>
                        ) : (
                          /* 급 내 — 직전 스테이지 별 하나(사용자 요청: 점수 대신 "초급1 별 하나") */
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <StarIcon size={14} weight="fill" color={TG.SUN} />
                            <span style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12, color: '#8a8078' }}>{prog.prevLabel} 별 하나</span>
                          </div>
                        )
                      ) : (
                        <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12, color: '#a89f96' }}>앞 스테이지를 먼저 열어요</span>
                      )}
                    </div>
                    {unlocked && <CheckCircleIcon size={30} weight="fill" color={c.accent} style={{ flexShrink: 0 }} />}
                  </div>
                ) : unlocked ? (
                  /* 간략(해제) — 아이콘 + 라벨 + 미니 별 */
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', height: 44, borderRadius: 22, background: '#f4f6f8', boxShadow: '0 3px 8px rgba(43,79,120,0.08)' }}>
                    <div style={{ width: 24, height: 24, borderRadius: 8, flexShrink: 0, background: c.tint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon size={14} weight="fill" color={c.accent} />
                    </div>
                    <span style={{ flex: 1, fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13.5, color: '#5b5560', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
                    <div style={{ display: 'flex', gap: 1.5, flexShrink: 0 }}>
                      {stageStarFlags(studentToken, s).map((f, si) => <StarIcon key={si} size={11} weight="fill" color={f ? TG.SUN : '#d8d2c8'} />)}
                    </div>
                  </div>
                ) : (
                  /* 간략(잠금) — 자물쇠 + 라벨만, 내용폭에 맞춘 짧은 알약(무채색, 여백 최소) */
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 15px', height: 42, borderRadius: 21, background: '#ece7e0', boxShadow: '0 3px 8px rgba(43,79,120,0.06)' }}>
                    <LockSimpleIcon size={15} weight="fill" color="#b3aba2" style={{ flexShrink: 0 }} />
                    <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13.5, color: '#a89f96', whiteSpace: 'nowrap' }}>{s.label}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* CTA 하단 고정 — 가운데 스테이지 시작(잠기면 안내 토스트) */}
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
