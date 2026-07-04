// 등급 진행/하락 연출 — 게임오버 비트 다음, 결과화면 전.
//  ★상승(티어 업): 긴장감 2단 연출(2026-07-04) — ①차징(흰 실루엣 엠블럼이 부들부들 떨며 점점 커짐, 떨림·크기·
//    글로우가 끝으로 갈수록 격해지고 에너지 입자가 중심으로 빨려듦, 햅틱이 점점 빨라짐) → ②짠!(흰 플래시가 교체
//    순간을 덮으며 실제 색 엠블럼으로 팝 + "등급 상승!" + 색종이). 떨다가 터지는 '진화' 순간. 결과를 즉시 안 보여줘 기대감.
//  마스터만 늘고 티어 그대로: 기존 담백(게이지 차오름).
//  하락(티어 다운): 담백·차분 — 파티클/차오름 없음, 회색 톤 + 최고 기록 칩 + 회복 안내(압박 카피 금지·노FOMO).
import { useEffect, useRef, useState } from 'react';
import { TG, FONT_TITLE, FONT_BODY, haptic } from '../tgTokens.js';
import { earTier, EAR_TIERS, TIER_SPARK_POS as PARTICLE_POS } from '../earProfile.js';
import { CrispFlash, ConfettiBurst, LIGHT_CONFETTI } from './shared.jsx';
const CHARGE_MS = 1500; // 차징 지속(짠! 까지) — 기대감 형성 구간

export function RankUpReveal({ prev = 0, now = 0, peakIdx = 0, onDone, hold = false }) {
  const prevT = earTier(prev);
  const nowT = earTier(now);
  const tierUp = nowT.idx > prevT.idx;
  const tierDown = nowT.idx < prevT.idx;
  const start = tierUp ? 0 : Math.round(prevT.progress * 100);
  const end = Math.round(nowT.progress * 100);
  const [w, setW] = useState(start);
  const [phase, setPhase] = useState(tierUp ? 'charge' : 'done'); // 상승만 charge 단계를 거침
  const shakeRef = useRef(null); // 차징 실루엣(rAF로 떨림+확대 구동)
  useEffect(() => {
    if (tierDown) { haptic(12); return undefined; }             // 하락은 가볍게 한 번(정적)
    if (!tierUp) { haptic([15, 30]); const t = setTimeout(() => setW(end), 280); return () => clearTimeout(t); }
    // ── 상승: 차징 → 짠! ──
    const timers = [];
    [0, 470, 840, 1120, 1330].forEach((d) => timers.push(setTimeout(() => haptic(9), d))); // 점점 빨라지는 두근거림
    timers.push(setTimeout(() => { setPhase('done'); setW(end); haptic([30, 55, 25, 70]); }, CHARGE_MS)); // 짠!
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 차징 실루엣: 떨림(진폭↑)+확대(가속)+글로우(강해짐)를 rAF로 매 프레임 구동
  useEffect(() => {
    if (!(tierUp && phase === 'charge')) return undefined;
    let raf, alive = true; const t0 = performance.now();
    const tick = (nowT2) => {
      if (!alive) return;
      const el = shakeRef.current; // 매 프레임 새로 읽음 — done 전환으로 언마운트되면 null → 중단(흰색 잔상 방지)
      if (!el) return;
      const p = Math.min(1, (nowT2 - t0) / CHARGE_MS);
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
  const gained = Math.max(0, now - prev);
  const peak = EAR_TIERS[Math.min(EAR_TIERS.length - 1, Math.max(peakIdx | 0, prevT.idx))]; // 최고 기록(최소한 방금 잃은 등급)
  const done = phase === 'done';
  const charging = tierUp && !done;
  const showGlow = !tierDown && done; // 색 글로우/떠다니는 반짝임은 짠! 이후(차징 땐 흰 실루엣만 — 색 스포일러 방지)
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 130, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: charging ? 'rgba(20,16,24,0.92)' : 'rgba(28,24,32,0.85)', transition: 'background .35s ease', padding: 24 }}>
      <style>{`
        @keyframes ru-pop{0%{opacity:0;transform:scale(.5)}55%{opacity:1;transform:scale(1.12)}100%{opacity:1;transform:scale(1)}}
        @keyframes ru-sink{0%{opacity:0;transform:translateY(-8px)}100%{opacity:1;transform:translateY(0)}}
        @keyframes ru-tada{0%{opacity:0;transform:scale(1.3)}28%{opacity:1;transform:scale(1.18)}60%{transform:scale(.96)}100%{transform:scale(1)}}
        @keyframes ru-hintpulse{0%,100%{opacity:.45}50%{opacity:.9}}
        @keyframes ru-converge{0%{opacity:0;transform:translate(var(--fx),var(--fy)) scale(1)}22%{opacity:.95}100%{opacity:0;transform:translate(0,0) scale(.2)}}
      `}</style>
      {/* eyebrow */}
      <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 16, marginBottom: 8,
        color: tierDown ? '#cfc8bf' : charging ? 'rgba(255,255,255,0.66)' : tierUp ? '#FFC94D' : nowT.spark,
        animation: tierDown ? 'ru-sink .45s ease both' : charging ? 'ru-hintpulse 1s ease-in-out infinite' : 'ru-pop .5s cubic-bezier(.34,1.56,.64,1) both' }}>
        {tierDown ? '등급이 내려갔어요' : charging ? '등급이 오르고 있어요…' : tierUp ? '✨ 등급 상승!' : `✨ 단어 ${gained}개 마스터!`}
      </span>
      {/* 엠블럼 영역 */}
      <div style={{ position: 'relative', width: '100%', height: 168, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* 색 글로우 헤일로 — 짠! 이후에만(차징 땐 흰 실루엣) */}
        {showGlow && (
          <div aria-hidden="true" style={{ position: 'absolute', width: 220, height: 220, borderRadius: '50%', pointerEvents: 'none', background: `radial-gradient(closest-side, ${nowT.glow}66, ${nowT.glow}1a 55%, ${nowT.glow}00 72%)` }} />
        )}
        {/* 떠다니는 반짝임 — 짠! 이후 */}
        {showGlow && PARTICLE_POS.slice(0, nowT.particles).map(([dx, dy, sz], i) => (
          <div key={i} aria-hidden="true" style={{ position: 'absolute', left: '50%', top: '50%', transform: `translate(${dx}px, ${dy}px)`, pointerEvents: 'none' }}>
            <div style={{ animation: `tg-sparkle ${2.2 + i * 0.3}s ease-in-out ${i * 0.4}s infinite` }}>
              <svg viewBox="0 0 24 24" width={sz} height={sz} aria-hidden="true"><path d="M12 0 L14 10 L24 12 L14 14 L12 24 L10 14 L0 12 L10 10 Z" fill={nowT.spark} /></svg>
            </div>
          </div>
        ))}
        {/* 빨려드는 에너지 입자 — 차징 단계만(중심으로 흡수) */}
        {charging && PARTICLE_POS.map(([dx, dy], i) => (
          <div key={`cv${i}`} aria-hidden="true" style={{ position: 'absolute', left: '50%', top: '50%', width: 7, height: 7, marginLeft: -3.5, marginTop: -3.5,
            borderRadius: '50%', background: '#fff', boxShadow: `0 0 6px ${nowT.glow}`,
            '--fx': `${dx * 1.7}px`, '--fy': `${dy * 1.7}px`,
            animation: `ru-converge ${0.85 + (i % 3) * 0.12}s ease-in ${i * 0.13}s infinite` }} />
        ))}
        {/* 짠! 순간 — 흰 플래시가 교체를 덮음 + 색종이(엠블럼 중심) */}
        {tierUp && done && (
          <>
            <CrispFlash radial color="rgba(255,255,255,0.97)" dur={0.36} zIndex={2} />
            <ConfettiBurst count={26} power={1.25} size={9} zIndex={3} />
            <ConfettiBurst colors={LIGHT_CONFETTI} count={14} power={1.05} size={5} zIndex={3} />
          </>
        )}
        {/* 엠블럼 — 차징=흰 실루엣(rAF 떨림+확대), 짠!=실제 색 ru-tada, 그 외/하락=기존 */}
        {charging ? (
          // ★key로 done img와 노드 분리 — 안 하면 React가 같은 <img> 노드를 재사용, 전환 직후 늦은 rAF 프레임이
          //   흰 필터를 재적용하고 멈춰 흰 실루엣이 고정됨(버그). 다른 key면 언마운트되어 안전.
          <img key="em-charge" ref={shakeRef} src={nowT.emblem} alt="" width={150} height={150} style={{ position: 'relative', zIndex: 4,
            transform: 'scale(0.82)', filter: `brightness(0) invert(1) drop-shadow(0 0 8px ${nowT.glow}) drop-shadow(0 0 6px #fff)`, willChange: 'transform, filter' }} />
        ) : (
          <img key="em-done" src={nowT.emblem} alt="" width={150} height={150} style={{ position: 'relative', zIndex: 4,
            animation: tierUp && done ? 'ru-tada .58s cubic-bezier(.34,1.56,.64,1) both' : tierDown ? 'ru-sink .5s ease .1s both' : 'none',
            filter: tierDown ? 'grayscale(0.25) drop-shadow(0 8px 20px rgba(0,0,0,0.35))' : `drop-shadow(0 8px 20px ${nowT.glow}66)` }} />
        )}
      </div>
      {/* 단계명 — 차징 중엔 숨겨 짠! 때 등장(반전 강조) */}
      {!charging && (
        <span style={{ fontFamily: FONT_TITLE, fontSize: 22, color: '#fff', marginTop: 4, animation: tierUp && done ? 'ru-pop .5s cubic-bezier(.34,1.56,.64,1) .12s both' : 'none' }}>{nowT.name}</span>
      )}
      {tierDown ? (
        <>
          {/* 최고 기록 칩 — 성취의 기억은 안 뺏음 + 회복 경로 안내 */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(255,246,232,0.14)', padding: '5px 13px', borderRadius: 12, marginTop: 14, animation: 'ru-sink .45s ease .2s both' }}>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: '#FFC94D' }}>🏆 최고 기록 · {peak.name}</span>
          </div>
          <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 10, animation: 'ru-sink .45s ease .3s both' }}>복습하면 금방 되찾을 수 있어요</span>
        </>
      ) : !charging && (
        <>
          {/* 게이지 (이전→새 차오름) — '단어만 마스터'(티어 유지) 때만. 등급 상승 순간엔 새 구간 바닥(거의 빈 바)이라
              김 빠져서 숨기고 마스터 수만 보여줌(도착의 순간=축하, 진행도 표시는 내 등급 화면에서). */}
          {!(tierUp && done) && (
            <div style={{ width: 220, height: 9, borderRadius: 5, background: 'rgba(255,255,255,0.18)', overflow: 'hidden', marginTop: 14 }}>
              <div style={{ width: `${w}%`, height: '100%', borderRadius: 5, background: nowT.glow, transition: 'width .9s cubic-bezier(.4,0,.2,1)' }} />
            </div>
          )}
          <span style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: tierUp && done ? 12 : 8 }}>마스터한 단어 {now}개</span>
        </>
      )}
      {/* 확인 — 차징 중엔 숨김(짠! 이후 등장) */}
      {!hold && !charging && (
        <button onClick={onDone} className="tg-press" style={{ marginTop: 40, padding: '14px 44px', borderRadius: 16, border: 'none', cursor: 'pointer', background: tierDown ? 'rgba(255,255,255,0.14)' : TG.CORAL_GRAD, boxShadow: tierDown ? 'none' : '0 10px 24px rgba(242,72,76,0.32)', fontFamily: FONT_BODY, fontWeight: 700, fontSize: 17, color: '#fff' }}>확인</button>
      )}
    </div>
  );
}
