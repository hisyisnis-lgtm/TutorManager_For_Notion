// 등급 상승 연출 — 게임오버 비트 다음, 결과화면 전. 누적 XP가 다음 등급 임계를 넘겨 승급했을 때만.
//  긴장감 2단 연출(2026-07-04): ①차징(흰 실루엣 엠블럼이 부들부들 떨며 점점 커짐, 떨림·크기·글로우가 끝으로
//    갈수록 격해지고 에너지 입자가 중심으로 빨려듦, 햅틱이 점점 빨라짐) → ②짠!(흰 플래시가 교체 순간을 덮으며
//    실제 색 엠블럼으로 팝 + "등급 상승!" + 색종이). 떨다가 터지는 '진화' 순간. 결과를 즉시 안 보여줘 기대감.
//  ★XP 등급 전환(2026-07-11): 등급은 이제 누적 XP로 오르며 강등이 없다 → 상승 연출만 남김(하락/게이지/마스터 문구 제거).
//    prevIdx/nowIdx = 등급 인덱스(EAR_TIERS). Phase 2(승급 시험)에서도 합격 시 이 연출을 그대로 재활용.
import { useEffect, useRef, useState } from 'react';
import { TYPE, haptic, SPACE } from '../tgTokens.js';
import { EAR_TIERS, TIER_SPARK_POS as PARTICLE_POS } from '../earProfile.js';
import { CrispFlash, ConfettiBurst, LIGHT_CONFETTI, RevealStage, RevealRings } from './shared.jsx';
const CHARGE_MS = 1500; // 차징 지속(짠! 까지) — 기대감 형성 구간
const clampIdx = (i) => Math.max(0, Math.min(EAR_TIERS.length - 1, i | 0));

export function RankUpReveal({ prevIdx = 0, nowIdx = 0, onDone, hold = false }) {
  const nowT = EAR_TIERS[clampIdx(nowIdx)];
  const [phase, setPhase] = useState('charge'); // charge → done(짠!)
  const shakeRef = useRef(null); // 차징 실루엣(rAF로 떨림+확대 구동)
  useEffect(() => {
    // ── 차징 → 짠! ──
    const timers = [];
    [0, 470, 840, 1120, 1330].forEach((d) => timers.push(setTimeout(() => haptic(9), d))); // 점점 빨라지는 두근거림
    timers.push(setTimeout(() => { setPhase('done'); haptic([30, 55, 25, 70]); }, CHARGE_MS)); // 짠!
    return () => timers.forEach(clearTimeout);
  }, []);
  // 차징 실루엣: 떨림(진폭↑)+확대(가속)+글로우(강해짐)를 rAF로 매 프레임 구동
  useEffect(() => {
    if (phase !== 'charge') return undefined;
    let raf, alive = true; const t0 = performance.now();
    const tick = (now2) => {
      if (!alive) return;
      const el = shakeRef.current; // 매 프레임 새로 읽음 — done 전환으로 언마운트되면 null → 중단(흰색 잔상 방지)
      if (!el) return;
      const p = Math.min(1, (now2 - t0) / CHARGE_MS);
      const grow = 0.82 + Math.pow(p, 1.5) * 0.5;              // 0.82 → ~1.32 (가속하며 커짐)
      const amp = 0.5 + p * p * 8;                             // 떨림 진폭 0 → ~8px (끝으로 갈수록 격해짐)
      const dx = (Math.random() - 0.5) * 2 * amp;
      const dy = (Math.random() - 0.5) * 2 * amp;
      const rot = (Math.random() - 0.5) * 2 * (p * p * 9);     // ±9° 근처(막판)
      el.style.transform = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px) scale(${grow.toFixed(3)}) rotate(${rot.toFixed(1)}deg)`;
      el.style.filter = `brightness(0) invert(1) drop-shadow(0 0 ${(8 + p * 24).toFixed(0)}px ${nowT.glow}) drop-shadow(0 0 6px #fff)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);
  const done = phase === 'done';
  const charging = !done;
  return (
    <div onClick={() => { if (!hold && done) onDone && onDone(); }}
      // 딤은 BeatDim(공용 레이어) 담당 — 체인 사이 깜빡임 방지(2026-08-08). 구 charging 0.9→0.8 농도 변화도 함께 폐기(체인 중 딤은 일정해야 함).
      style={{ position: 'fixed', inset: 0, zIndex: 130, cursor: done && !hold ? 'pointer' : 'default' }}>
      <style>{`
        @keyframes ru-pop{0%{opacity:0;transform:scale(.5)}55%{opacity:1;transform:scale(1.12)}100%{opacity:1;transform:scale(1)}}
        @keyframes ru-tada{0%{opacity:0;transform:scale(1.3)}28%{opacity:1;transform:scale(1.18)}60%{transform:scale(.96)}100%{transform:scale(1)}}
        @keyframes ru-hintpulse{0%,100%{opacity:.45}50%{opacity:.9}}
        @keyframes ru-converge{0%{opacity:0;transform:translate(var(--fx),var(--fy)) scale(1)}22%{opacity:.95}100%{opacity:0;transform:translate(0,0) scale(.2)}}
      `}</style>
      {/* 동심원 배경 — 연출 5종 공용(딤 위·콘텐츠 아래) */}
      <RevealRings />
      <RevealStage>
      {/* 차징 중 안내 — '짠!' 이후엔 엠블럼 아래 eyebrow가 대신한다(시안은 완료 상태만 정의) */}
      {charging && (
        <span style={{ position: 'absolute', left: 0, right: 0, top: 469.5, textAlign: 'center', ...TYPE.label, lineHeight: '25px', color: 'rgba(255,255,255,0.66)', animation: 'ru-hintpulse 1s ease-in-out infinite' }}>
          등급이 오르고 있어요…
        </span>
      )}
      {/* 엠블럼 영역 — 시안 y318(140×140). 파티클/플래시가 엠블럼 중심을 기준으로 놓이도록 같은 박스 안에 둔다 */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 318, height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* (시안 757:52 = 엠블럼만 남는 정지 상태 — 상시 글로우 헤일로·무한 반짝임은 폐기. 순간 연출인 플래시·색종이는 유지) */}
        {/* 빨려드는 에너지 입자 — 차징 단계만(중심으로 흡수) */}
        {charging && PARTICLE_POS.map(([dx, dy], i) => (
          <div key={`cv${i}`} aria-hidden="true" style={{ position: 'absolute', left: '50%', top: '50%', width: 7, height: 7, marginLeft: -3.5, marginTop: -3.5,
            borderRadius: '50%', background: '#fff', boxShadow: `0 0 6px ${nowT.glow}`,
            '--fx': `${dx * 1.7}px`, '--fy': `${dy * 1.7}px`,
            animation: `ru-converge ${0.85 + (i % 3) * 0.12}s ease-in ${i * 0.13}s infinite` }} />
        ))}
        {/* 짠! 순간 — 흰 플래시가 교체를 덮음 + 색종이(엠블럼 중심) */}
        {done && (
          <>
            <CrispFlash radial color="rgba(255,255,255,0.97)" dur={0.36} zIndex={2} />
            <ConfettiBurst count={26} power={1.25} size={9} zIndex={3} />
            <ConfettiBurst colors={LIGHT_CONFETTI} count={14} power={1.05} size={5} zIndex={3} />
          </>
        )}
        {/* 엠블럼 — 차징=흰 실루엣(rAF 떨림+확대), 짠!=실제 색 ru-tada */}
        {charging ? (
          // ★key로 done img와 노드 분리 — 안 하면 React가 같은 <img> 노드를 재사용, 전환 직후 늦은 rAF 프레임이
          //   흰 필터를 재적용하고 멈춰 흰 실루엣이 고정됨(버그). 다른 key면 언마운트되어 안전.
          <img key="em-charge" ref={shakeRef} src={nowT.emblem} alt="" width={140} height={140} style={{ position: 'relative', zIndex: 4,
            transform: 'scale(0.82)', filter: `brightness(0) invert(1) drop-shadow(0 0 8px ${nowT.glow}) drop-shadow(0 0 6px #fff)`, willChange: 'transform, filter' }} />
        ) : (
          <img key="em-done" src={nowT.emblem} alt="" width={140} height={140} style={{ position: 'relative', zIndex: 4,
            animation: 'ru-tada .58s cubic-bezier(.34,1.56,.64,1) both', filter: `drop-shadow(0 8px 20px ${nowT.glow}66)` }} />
        )}
      </div>
      {/* eyebrow + 등급명 — 차징 중엔 숨겨 짠! 때 등장(반전 강조). 시안 757:52 잉크 y478 · y504 */}
      {done && (
        <>
          <span style={{ position: 'absolute', left: 0, right: 0, top: 478, textAlign: 'center', ...TYPE.label, lineHeight: '25px', color: '#fff', animation: 'ru-pop .5s cubic-bezier(.34,1.56,.64,1) both' }}>등급 상승!</span>
          <span style={{ position: 'absolute', left: 0, right: 0, top: 504, textAlign: 'center', ...TYPE.head, fontSize: 30, lineHeight: '34px', color: '#fff', animation: 'ru-pop .5s cubic-bezier(.34,1.56,.64,1) .12s both' }}>{nowT.name}</span>
        </>
      )}
      </RevealStage>
    </div>
  );
}
