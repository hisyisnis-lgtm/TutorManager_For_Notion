// 모드 선택 — 중요도 2단. 주력 큰 카드(난이도·테마) + 보조 칩(무한·연습·복습).
// Figma "26. 모드 선택 v2". 잠긴 카드(무한)는 흔들림+토스트.
import { CaretLeftIcon, CaretRightIcon, StairsIcon, InfinityIcon, SkullIcon, LockSimpleIcon, GraduationCapIcon, ArrowsClockwiseIcon, CardsThreeIcon } from '@phosphor-icons/react';
import { TG, FONT_TITLE, FONT_BODY, TOUCH_OPT } from '../tgTokens.js';
import { useState, useRef, useLayoutEffect } from 'react';
import { ShakeButton, Reveal, CoachBubble, prefersReducedMotion } from './shared.jsx';
import { ReviewStartModal, EndlessStartModal } from './gameModals.jsx';
import CoachMarkOverlay from '../../components/ui/CoachMarkOverlay.jsx';
import { useTabTip } from '../../hooks/useTabTip.js';

// 첫 진입 코치마크 — 난이도 경로 안내. Reveal 등장(≈0.9s)이 끝난 뒤 표시(ready 게이트).
const MODE_COACH = [
  { selector: '[data-coach="mode-difficulty"]', label: '여기서 난이도를 골라요. 초급부터 차근차근 시작해보세요!' },
  { selector: '[data-coach="mode-theme"]', label: '드라마·여행 등 취향대로 즐기는 테마 모드도 있어요.' },
  { selector: '[data-coach="mode-aux"]', label: '가볍게 연습하거나, 틀린 단어만 모아 복습할 수 있어요.' },
];
// 초급 저조 시 연습 유도 코치마크(조건부·1회). 연습 칩만 스포트라이트.
const PRACTICE_NUDGE = [
  { selector: '[data-coach="mode-practice"]', label: '시간 제한 없이 천천히 연습할 수 있어요. 여기를 눌러 연습해봐요! 🐼' },
];

// 색상 점 파티클 이미터 — 원 뒤에서 모드 색상의 작은 원이 방사형으로 퍼지며 '작아지면서' 사라짐(앰비언트).
//  rAF 물리(EmberRise 방식 루프): 랜덤 각도로 바깥 이동, 수명 순환. 원(zIndex 상위)이 안쪽을 가려 '뒤에서 퍼지는' 효과.
//  노이즈 최소화: 개수 적게(6)·흔들림 없음·끝에서 scale·opacity 동시 감소.
function ToneBurst({ color, count = 6 }) {
  if (prefersReducedMotion()) return null;
  return <ToneBurstInner color={color} count={count} />;
}
function ToneBurstInner({ color, count }) {
  const refs = useRef([]);
  const cfg = useRef(null);
  if (!cfg.current) {
    const R = Math.random;
    cfg.current = Array.from({ length: count }, () => ({
      ang: R() * Math.PI * 2,          // 방사 각도
      speed: 12 + R() * 13,            // 바깥 이동 속도(px/s)
      life: 2.8 + R() * 1.6,           // 수명(s)
      t: -R() * 4.5,                   // 시차 시작(음수 = 아직 미출현)
      sz: 7 + R() * 6,                 // 점 크기
      op: 0.5 + R() * 0.35,            // 최대 불투명도
    }));
  }
  useLayoutEffect(() => {
    let raf, alive = true, last = performance.now();
    const tick = (now) => {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      for (let k = 0; k < cfg.current.length; k++) {
        const el = refs.current[k]; const s = cfg.current[k]; if (!el) continue;
        s.t += dt;
        if (s.t >= s.life) s.t %= s.life;                 // 수명 순환(재점화)
        if (s.t < 0) { el.style.opacity = '0'; continue; }
        const t = s.t / s.life;
        const dist = 24 + s.speed * s.t;                  // 원 안쪽서 시작 → 바깥으로
        const fin = Math.min(1, t * 5);                   // 빠른 페이드 인
        const tail = Math.max(0, 1 - t * t);              // 끝으로 갈수록 0 → 작아지며 사라짐
        el.style.opacity = String(fin * tail * s.op);
        el.style.transform = `translate(${(Math.cos(s.ang) * dist).toFixed(1)}px, ${(Math.sin(s.ang) * dist).toFixed(1)}px) scale(${((0.5 + 0.5 * fin) * tail).toFixed(2)})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, []);
  return (
    <div aria-hidden="true" style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, pointerEvents: 'none', zIndex: 0 }}>
      {cfg.current.map((s, k) => (
        <span key={k} ref={(n) => { refs.current[k] = n; }} style={{
          position: 'absolute', left: 0, top: 0, width: s.sz, height: s.sz, marginLeft: -s.sz / 2, marginTop: -s.sz / 2,
          borderRadius: '50%', background: color, opacity: 0, willChange: 'transform, opacity',
        }} />
      ))}
    </div>
  );
}

// 주력 버튼 — 박스(카드) 없이 큰 원형 + 아래 라벨(앱 아이콘 형태). 원 뒤에서 성조 마크 파티클이 방사형으로 퍼짐.
//  아래 사각 카드/칩과 형태가 완전히 달라 강조된다. locked면 무광 회색 원+자물쇠(파티클 없음).
// dangerDesc=서든데스 톤: 해골 + 빨간 글씨(배경 위라 색이 그대로 읽힘).
const ORB = 98;
function BigTile({ Icon, grad, glow, dot, title, desc, locked, lockText, onClick, onLocked, coachId, dangerDesc }) {
  const showDanger = dangerDesc && !locked;
  return (
    <ShakeButton shakeOnClick={locked} onClick={locked ? onLocked : onClick} className={locked ? '' : 'tg-press'} data-coach={coachId} style={{
      flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 15, padding: '6px 4px', ...TOUCH_OPT,
    }}>
      {/* 스테이지 — 파티클(뒤·zIndex0)과 원(앞·zIndex1)을 겹침. 원이 안쪽 파티클을 가려 '뒤에서 퍼지는' 효과 */}
      <div style={{ position: 'relative', width: ORB, height: ORB, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {!locked && <ToneBurst color={dot} />}
        <div style={{
          position: 'relative', zIndex: 1, width: ORB, height: ORB, borderRadius: '50%',
          background: locked ? '#e9e3da' : grad,
          boxShadow: locked ? 'none' : `0 14px 28px ${glow}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={52} weight="fill" color={locked ? '#b8b0a8' : '#fff'} />
          {locked && (
            <div style={{ position: 'absolute', right: 3, bottom: 3, width: 29, height: 29, borderRadius: 15, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.16)' }}>
              <LockSimpleIcon size={15} weight="fill" color="#9a93a0" />
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 800, fontSize: 17.5, color: locked ? '#9a93a0' : '#2b2730' }}>{title}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12, color: showDanger ? '#d0464a' : '#9a93a0' }}>
          {showDanger && <SkullIcon size={12} weight="fill" color="#d0464a" style={{ flexShrink: 0 }} />}
          {locked ? lockText : desc}
        </span>
      </div>
    </ShakeButton>
  );
}

// 피처 카드 — 메인 모드를 풀폭으로 강조(accent 색 범용). locked면 회색+자물쇠+조건.
function FeatureCard({ Icon, accent, tint, border, title, desc, locked, lockText, onClick, onLocked, coachId }) {
  return (
    <ShakeButton shakeOnClick={locked} onClick={locked ? onLocked : onClick} className={locked ? '' : 'tg-press'} data-coach={coachId} style={{
      width: '100%', height: 74, display: 'flex', alignItems: 'center', gap: 13, textAlign: 'left', padding: '0 16px', borderRadius: 18, cursor: 'pointer',
      background: locked ? '#f3eee7' : tint, border: `1.5px solid ${locked ? '#efeae4' : border}`,
      boxShadow: locked ? 'none' : `0px 5px 14px ${accent}22`, ...TOUCH_OPT,
    }}>
      <div style={{ width: 46, height: 46, borderRadius: 14, flexShrink: 0, background: locked ? '#e7e0d6' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: locked ? 'none' : `0 2px 6px ${accent}33` }}>
        <Icon size={25} weight="fill" color={locked ? '#b8b0a8' : accent} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 16, color: locked ? '#9a93a0' : '#2b2730' }}>{title}</span>
        <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12, color: '#9a93a0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{desc}</span>
      </div>
      {locked ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0 }}>
          <LockSimpleIcon size={20} weight="fill" color="#b8b0a8" />
          <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 10.5, color: '#9a93a0', whiteSpace: 'nowrap' }}>{lockText}</span>
        </div>
      ) : <CaretRightIcon size={22} weight="bold" color={accent} style={{ flexShrink: 0, opacity: 0.55 }} />}
    </ShakeButton>
  );
}

// 보조 칩 — 테마 카드와 같은 '아이콘 배경 + 라벨' 구조로 통일(비율 균형). 주력(원형)보다 가볍게. locked면 회색+자물쇠.
function ModeChip({ Icon, iconColor, tint, label, locked, onClick, onLocked, coachId }) {
  return (
    <ShakeButton shakeOnClick={locked} onClick={locked ? onLocked : onClick} className={locked ? '' : 'tg-press'} data-coach={coachId} style={{
      flex: 1, minWidth: 0, height: 66, background: locked ? '#f3eee7' : '#fff', border: '1.5px solid #efeae4', borderRadius: 18, cursor: 'pointer',
      boxShadow: locked ? 'none' : '0px 3px 9px rgba(43,39,48,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, ...TOUCH_OPT,
    }}>
      <div style={{ width: 36, height: 36, borderRadius: 12, flexShrink: 0, background: locked ? '#e7e0d6' : tint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={20} weight="fill" color={locked ? '#b8b0a8' : iconColor} />
      </div>
      <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15, color: locked ? '#9a93a0' : '#2b2730' }}>{label}</span>
      {locked && <LockSimpleIcon size={13} weight="fill" color="#b8b0a8" style={{ marginLeft: -2 }} />}
    </ShakeButton>
  );
}

export function ModeScreen({ endlessUnlocked, endlessBest = 0, reviewCount = 0, onDifficulty, onTheme, onEndless, onPractice, onReview, onBack, onLocked, highlightPractice = false, onHighlightDone }) {
  const tip = useTabTip('game-mode', true);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [endlessOpen, setEndlessOpen] = useState(false);
  return (
    <>
      <Reveal i={0} style={{ position: 'absolute', left: 24, top: 20, right: 24 }}>
        <div style={{ height: 40, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={onBack} aria-label="뒤로" className="tg-press" style={{ width: 40, height: 40, borderRadius: 20, background: '#fff', boxShadow: '0px 3px 5px rgba(43,39,48,0.08)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT }}>
            <CaretLeftIcon size={20} weight="bold" color={TG.INK} />
          </button>
          <span style={{ fontFamily: FONT_TITLE, fontSize: 22, color: '#2b2730' }}>모드 선택</span>
        </div>
      </Reveal>
      {/* 코치=상단 / 주력 원형 버튼=중앙 밴드 / 나머지=하단. 원형 주력이 화면 중앙을 채워 '빈 중간'이 사라진다.
          (space-between은 남는 공간을 전부 가운데로 몰아 중간이 비었음 — 주력을 중앙에 앉히는 방식으로 교체) */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 84, bottom: 'calc(26px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column' }}>
        <Reveal i={1} style={{ paddingLeft: 24, paddingRight: 24 }}>
          <CoachBubble text="무엇으로 플레이할까요?" />
        </Reveal>
        {/* 주력 난이도·무한 — 남는 중앙 공간(flex:1)에 세로 중앙정렬로 앉혀 화면 한가운데를 차지 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Reveal i={2} style={{ paddingLeft: 24, paddingRight: 24 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <BigTile Icon={StairsIcon} grad="linear-gradient(150deg, #FF8A6B 0%, #F2484C 100%)" glow="rgba(242,72,76,0.30)" dot="#F2484C" title="난이도 모드" desc="초급부터 차근차근" onClick={onDifficulty} coachId="mode-difficulty" />
              <BigTile Icon={InfinityIcon} grad="linear-gradient(150deg, #FFC85C 0%, #F0A11E 100%)" glow="rgba(240,161,30,0.32)" dot="#F0A91E" title="무한 모드" desc="서든데스" dangerDesc
                locked={!endlessUnlocked} lockText="고급 1,000점 달성" onClick={() => setEndlessOpen(true)} onLocked={() => onLocked && onLocked('고급 1,000점을 달성하면 열려요')} />
            </div>
          </Reveal>
        </div>
        {/* 나머지 — 테마 + 연습/복습, 하단 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <Reveal i={3} style={{ paddingLeft: 24, paddingRight: 24 }}>
            <FeatureCard Icon={CardsThreeIcon} accent="#7c5cff" tint="rgba(124,92,255,0.10)" border="rgba(124,92,255,0.28)"
              title="테마 모드" desc="드라마·여행 등 취향대로" onClick={onTheme} coachId="mode-theme" />
          </Reveal>
          <Reveal i={4} style={{ paddingLeft: 24, paddingRight: 24 }}>
            <div data-coach="mode-aux" style={{ display: 'flex', gap: 11 }}>
              <ModeChip Icon={GraduationCapIcon} iconColor={TG.SUCCESS_GLOW} tint="rgba(54,201,141,0.14)" label="연습" onClick={onPractice} coachId="mode-practice" />
              <ModeChip Icon={ArrowsClockwiseIcon} iconColor="#4D8DFF" tint="rgba(77,141,255,0.14)" label="복습"
                onClick={() => { if (reviewCount > 0) setReviewOpen(true); else onLocked && onLocked('아직 복습할 단어가 없어요. 먼저 게임을 플레이해보세요'); }} />
            </div>
          </Reveal>
        </div>
      </div>
      <CoachMarkOverlay visible={tip.visible} onDone={tip.dismiss} steps={MODE_COACH} delay={160} showControls={false} />
      {/* 초급 저조 유도 — 첫 진입 코치와 안 겹치게(그게 끝난 뒤에만), 연습 칩만 강조.
          forceLastStep: 주변 탭 흡수 → 연습 칩을 실제로 눌러야만 진행(칩 onClick=onPractice가 플래그 해제+연습 진입). */}
      <CoachMarkOverlay visible={highlightPractice && !tip.visible} onDone={() => onHighlightDone && onHighlightDone()} steps={PRACTICE_NUDGE} delay={200} showControls={false} forceLastStep />
      {reviewOpen && <ReviewStartModal count={reviewCount} onStart={() => { setReviewOpen(false); onReview && onReview(); }} onClose={() => setReviewOpen(false)} />}
      {endlessOpen && <EndlessStartModal best={endlessBest} onStart={() => { setEndlessOpen(false); onEndless && onEndless(); }} onClose={() => setEndlessOpen(false)} />}
    </>
  );
}
