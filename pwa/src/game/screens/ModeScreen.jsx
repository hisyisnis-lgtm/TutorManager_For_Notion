// 모드 선택 — 주력 큰 원형(난이도·무한) + 풀폭 카드(테마·트레이닝).
// Figma "26. 모드 선택 v2". 잠긴 카드(무한)는 흔들림+토스트.
import { Star, Infinity as InfinityIcon, Lock, SquareAcademicCap, Album, AltArrowRight } from '@solar-icons/react';
import { TG, TYPE, TOUCH_OPT, RADIUS, SPACE } from '../tgTokens.js';
import { useState, useRef, useLayoutEffect } from 'react';
import { ShakeButton, Reveal, GameHeader, prefersReducedMotion } from './shared.jsx';
import { EndlessStartModal, TrainingStartModal } from './gameModals.jsx';
import CoachMarkOverlay from '../../components/ui/CoachMarkOverlay.jsx';
import { useTabTip } from '../../hooks/useTabTip.js';
import { DIFFICULTIES } from '../../constants/toneGameWords.js';

const FIRST_LABEL = DIFFICULTIES[0].label;                       // 난이도 사다리 첫 급(현재 '입문')
const LAST_LABEL = DIFFICULTIES[DIFFICULTIES.length - 1].label;  // 마지막 급(현재 '고수')
const ENDLESS_REQ = `${LAST_LABEL} 마지막 스테이지`;             // 무한 해제 = 마지막 급 마지막 스테이지 클리어(고수5, 2026-07-22 — 승급시험은 급 사이만·고수엔 없음)

// 첫 진입 코치마크 — 난이도 경로 안내. Reveal 등장(≈0.9s)이 끝난 뒤 표시(ready 게이트).
const MODE_COACH = [
  { selector: '[data-coach="mode-difficulty"]', label: `여기서 난이도를 골라요. ${FIRST_LABEL}부터 차근차근 시작해보세요!` },
  { selector: '[data-coach="mode-theme"]', label: '드라마·여행 등 취향대로 즐기는 테마 모드도 있어요.' },
  { selector: '[data-coach="mode-practice"]', label: '내 실력 범위에서 약한 단어를 골라 자유롭게 트레이닝할 수 있어요.' },
];
// 입문 저조 시 트레이닝 유도 코치마크(조건부·1회). 트레이닝 칩만 스포트라이트.
const PRACTICE_NUDGE = [
  { selector: '[data-coach="mode-practice"]', label: '시간 제한 없이 약한 단어를 천천히 트레이닝할 수 있어요. 여기를 눌러봐요! 🐼' },
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
    cfg.current = Array.from({ length: count }, () => {
      const life = 2.8 + R() * 1.6;    // 수명(s)
      return {
        ang: R() * Math.PI * 2,        // 방사 각도
        speed: 12 + R() * 13,          // 바깥 이동 속도(px/s)
        life,
        t: R() * life,                 // 수명 구간의 임의 지점에서 시작 → 진입 즉시 이미 재생 중(퍼지는 중)
        sz: 7 + R() * 6,               // 점 크기
        op: 0.5 + R() * 0.35,          // 최대 불투명도
      };
    });
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

// 하프톤 그라데이션 배경 — 도트 크기가 그라데이션을 따라 변하는 팝아트 하프톤(위=큰 도트 → 아래로 작아지며 사라짐).
//  캔버스 1회 렌더(정적, 리사이즈 시 재그림). 코랄 톤 은은하게 — 크림 배경 위 따뜻한 텍스처(UI 방해 X).
function HalftoneBg() {
  const cvRef = useRef(null);
  useLayoutEffect(() => {
    const cv = cvRef.current, par = cv && cv.parentElement; if (!par) return undefined;
    const ctx = cv.getContext('2d');
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const GAP = 11, MAXR = 3.3;
    const draw = () => {
      const W = par.clientWidth, H = par.clientHeight; if (!W || !H) return;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(206,166,124,0.2)'; // 배경에 묻어나는 웜 톤(은은)
      const cx = W / 2, cy = H * 0.42, RAD = Math.hypot(W, H) * 0.38; // 원형 그라데이션 중심·반경(범위 축소)
      // 45° 회전 격자(다이아몬드 하프톤) — P(i,j)=((i-j)k,(i+j)k), k=cos45·GAP. 이웃 간격=GAP 유지.
      const k = 0.70710678 * GAP;
      let iMin = Infinity, iMax = -Infinity, jMin = Infinity, jMax = -Infinity;
      for (const [px, py] of [[0, 0], [W, 0], [0, H], [W, H]]) {
        const i = (px + py) / (2 * k), j = (py - px) / (2 * k);
        if (i < iMin) iMin = i; if (i > iMax) iMax = i; if (j < jMin) jMin = j; if (j > jMax) jMax = j;
      }
      iMin = Math.floor(iMin) - 1; iMax = Math.ceil(iMax) + 1; jMin = Math.floor(jMin) - 1; jMax = Math.ceil(jMax) + 1;
      for (let i = iMin; i <= iMax; i += 1) {
        for (let j = jMin; j <= jMax; j += 1) {
          const x = (i - j) * k, y = (i + j) * k;
          if (x < -GAP || x > W + GAP || y < -GAP || y > H + GAP) continue;
          const d = Math.hypot(x - cx, y - cy);
          const gv = Math.max(0, Math.min(1, 1 - d / RAD)); // 중심=큰 도트 → 원형으로 작아지며 사라짐
          const r = MAXR * gv; if (r < 0.3) continue;
          ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
        }
      }
    };
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, []);
  return <canvas ref={cvRef} aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }} />;
}

// 주력 버튼 — 박스(카드) 없이 큰 원형 + 아래 라벨(앱 아이콘 형태). 원 뒤에서 성조 마크 파티클이 방사형으로 퍼짐.
//  아래 사각 카드/칩과 형태가 완전히 달라 강조된다. locked면 무광 회색 원+자물쇠(파티클 없음).
// dangerDesc=서든데스 톤: 해골 + 빨간 글씨(배경 위라 색이 그대로 읽힘).
const ORB = 98;
function BigTile({ Icon, grad, glow, dot, title, locked, onClick, onLocked, coachId, iconStyle }) {
  return (
    <ShakeButton shakeOnClick={locked} onClick={locked ? onLocked : onClick} className={locked ? '' : 'tg-press'} data-coach={coachId} style={{
      flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.x2, padding: '6px 4px', ...TOUCH_OPT,
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
          <Icon size={52} weight="Bold" color={locked ? TG.MUTED : '#fff'} style={iconStyle} />
          {locked && (
            <div style={{ position: 'absolute', right: 3, bottom: 3, width: 29, height: 29, borderRadius: RADIUS.lg, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.16)' }}>
              <Lock size={15} weight="Bold" color="#9a93a0" />
            </div>
          )}
        </div>
      </div>
      <span style={{ ...TYPE.h1, color: locked ? TG.SUB : TG.INK }}>{title}</span>
    </ShakeButton>
  );
}

// 피처 카드 — 흰 카드 + 컬러 아이콘 + 제목 + 오른쪽 화살표. 설명 문구는 제거(사용자 요청).
function FeatureCard({ Icon, accent, title, locked, lockText, onClick, onLocked, coachId }) {
  return (
    <ShakeButton shakeOnClick={locked} onClick={locked ? onLocked : onClick} className={locked ? '' : 'tg-press'} data-coach={coachId} style={{
      width: '100%', height: 76, display: 'flex', alignItems: 'center', gap: SPACE.x2, textAlign: 'left', padding: '0 18px', borderRadius: RADIUS.xl, cursor: 'pointer',
      background: locked ? TG.SURFACE : '#fff', border: 'none',
      boxShadow: locked ? 'none' : '0 6px 18px rgba(43,39,48,0.07)', ...TOUCH_OPT,
    }}>
      <Icon size={35} weight="Bold" color={locked ? TG.MUTED : accent} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, ...TYPE.h2, letterSpacing: '-0.01em', color: locked ? TG.SUB : TG.INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
      {locked ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, flexShrink: 0 }}>
          <Lock size={20} weight="Bold" color="#b8b0a8" />
          <span style={{ ...TYPE.micro, color: TG.SUB, whiteSpace: 'nowrap' }}>{lockText}</span>
        </div>
      ) : (
        <AltArrowRight size={22} weight="Bold" color="#c9c2bb" style={{ flexShrink: 0 }} />
      )}
    </ShakeButton>
  );
}

// 보조 칩 — 테마 카드와 같은 '아이콘 배경 + 라벨' 구조로 통일(비율 균형). 주력(원형)보다 가볍게. locked면 회색+자물쇠.

export function ModeScreen({ endlessUnlocked, endlessBest = 0, onDifficulty, onTheme, onEndless, onTraining, onBack, onLocked, highlightPractice = false, onHighlightDone }) {
  const tip = useTabTip('game-mode', true);
  const [endlessOpen, setEndlessOpen] = useState(false);
  const [trainingOpen, setTrainingOpen] = useState(false);
  return (
    <>
      {/* 하프톤 그라데이션 배경(맨 뒤) */}
      <HalftoneBg />
      <GameHeader title="모드 선택" onBack={onBack} />
      {/* 코치=상단 / 주력 원형 버튼=중앙 밴드 / 나머지=하단. 원형 주력이 화면 중앙을 채워 '빈 중간'이 사라진다.
          (space-between은 남는 공간을 전부 가운데로 몰아 중간이 비었음 — 주력을 중앙에 앉히는 방식으로 교체) */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 84, bottom: 'calc(26px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column' }}>
        {/* 주력 난이도·무한 — 남는 중앙 공간(flex:1)에 세로 중앙정렬로 앉혀 화면 한가운데를 차지 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Reveal i={2} style={{ paddingLeft: SPACE.x4, paddingRight: SPACE.x4 }}>
            <div style={{ display: 'flex', gap: SPACE.xl }}>
              <BigTile Icon={Star} grad="linear-gradient(150deg, #FF8A6B 0%, #F2484C 100%)" glow="rgba(242,72,76,0.30)" dot="#F2484C" title="난이도 모드" onClick={onDifficulty} coachId="mode-difficulty" />
              <BigTile Icon={InfinityIcon} grad="linear-gradient(150deg, #FFC85C 0%, #F0A11E 100%)" glow="rgba(240,161,30,0.32)" dot="#F0A91E" title="무한 모드"
                iconStyle={{ stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round', strokeLinecap: 'round' }}
                locked={!endlessUnlocked} onClick={() => setEndlessOpen(true)} onLocked={() => onLocked && onLocked(`${ENDLESS_REQ}를 클리어하면 열려요`)} />
            </div>
          </Reveal>
        </div>
        {/* 나머지 — 테마 + 연습/복습, 하단 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xl }}>
          <Reveal i={3} style={{ paddingLeft: SPACE.x4, paddingRight: SPACE.x4 }}>
            <FeatureCard Icon={Album} accent="#7c5cff"
              title="테마 모드" onClick={onTheme} coachId="mode-theme" />
          </Reveal>
          <Reveal i={4} style={{ paddingLeft: SPACE.x4, paddingRight: SPACE.x4 }}>
            <FeatureCard Icon={SquareAcademicCap} accent="#2BB583"
              title="트레이닝"
              onClick={() => { onHighlightDone && onHighlightDone(); setTrainingOpen(true); }} /* 넛지 코치마크는 이 카드 onClick에서 dismiss(forceLastStep 구조) */
              coachId="mode-practice" />
          </Reveal>
        </div>
      </div>
      <CoachMarkOverlay visible={tip.visible} onDone={tip.dismiss} steps={MODE_COACH} delay={160} showControls={false} />
      {/* 입문 저조 유도 — 첫 진입 코치와 안 겹치게(그게 끝난 뒤에만), 트레이닝 칩만 강조.
          forceLastStep: 주변 탭 흡수 → 트레이닝 칩을 실제로 눌러야만 진행(칩 onClick=onTraining이 플래그 해제+트레이닝 진입). */}
      <CoachMarkOverlay visible={highlightPractice && !tip.visible} onDone={() => onHighlightDone && onHighlightDone()} steps={PRACTICE_NUDGE} delay={200} showControls={false} forceLastStep />
      {trainingOpen && <TrainingStartModal onStart={() => { setTrainingOpen(false); onTraining && onTraining(); }} onClose={() => setTrainingOpen(false)} />}
      {endlessOpen && <EndlessStartModal best={endlessBest} onStart={() => { setEndlessOpen(false); onEndless && onEndless(); }} onClose={() => setEndlessOpen(false)} />}
    </>
  );
}
