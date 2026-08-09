// 게임 종료 경험치 획득 연출 — 게임오버 비트 다음, 결과화면 전(등급업 연출과 같은 자리·풀스크린 오버레이).
//  환산 요소(점수·정답·신기록)가 하나씩 '쾅' 팝인하며 총 XP가 오르고 '레벨(Lv.N)' 게이지가 차오른다.
//  XP는 레벨을 채운다(등급은 사다리 보스로만) — 게이지가 다음 레벨을 넘기면 '레벨 업!'. XP 적립 판(일반·무한·테마)만.
import { useEffect, useState, useRef, useLayoutEffect } from 'react';
import { TG, TYPE, haptic, RADIUS, SPACE } from '../tgTokens.js';
import { RevealStage } from './shared.jsx';
import { rankInfo, levelInfo, XP_PER_CORRECT, XP_NEWBEST_BONUS } from '../gameXp.js';
import { play as playSfx } from '../tgSfx.js';
import { useCountUp } from '../tgWidgets.jsx';

// 시안(461:9) 값 — 이 연출 전용 원오프 색.
const GAUGE_FILL = '#FF5E62';      // 레벨 게이지 채움(단색)
const XP_VALUE = '#FFC94D';        // 환산 내역 수치(골드)
const ROW_BG = 'rgba(255,255,255,0.08)';
const SUB_WHITE = 'rgba(255,255,255,0.55)';
// 스파크 색 — 게이지 채움과 같은 계열.
const SPARK_COLORS = ['#FF7A7A', TG.CORAL_DK];
const SPARK_POOL = 28; // 재사용 DOM 노드 풀

// 게이지 + 끝에서 튀는 스파크 — rAF 파티클 시스템.
//  채움(cur)을 rAF로 target까지 이징 → 채우는 동안 '끝(cur%)' 위치에서 파티클을 방출.
//  ★방출된 파티클은 방출구의 자식이 아니라 '월드 좌표(px)'로 레이어에 뿌려져, 게이지가 더 차올라도
//    끌려다니지 않고 방출된 자리에서 자기 속도·중력으로 살짝 튀며 자연 페이드(사용자 요구).
function SparkGauge({ pct }) {
  const barRef = useRef(null);
  const fillRef = useRef(null);
  const spanRefs = useRef([]);
  const S = useRef({ cur: pct, target: pct, parts: [], last: 0, emit: 0 });
  useEffect(() => { S.current.target = pct; }, [pct]);
  useLayoutEffect(() => {
    let raf, alive = true;
    S.current.last = performance.now();
    if (fillRef.current) fillRef.current.style.width = `${S.current.cur.toFixed(2)}%`; // 초기 폭(이후 폭은 rAF 전담)
    const tick = (now) => {
      if (!alive) return;
      const st = S.current;
      const dt = Math.min(0.05, (now - st.last) / 1000); st.last = now;
      const bw = barRef.current ? barRef.current.clientWidth : 0;
      const diff = st.target - st.cur;
      const moving = Math.abs(diff) > 0.15;
      st.cur += moving ? diff * Math.min(1, dt * 6.5) : diff; // target까지 이징
      if (fillRef.current) fillRef.current.style.width = `${st.cur.toFixed(2)}%`;
      // 방출 — 채우는 동안 끝(cur%)에서. 위쪽으로 퍼지는 초기 속도 + 랜덤.
      if (moving && bw > 0) {
        st.emit += dt;
        const rate = 0.013; // 파티클 간 간격(s)
        while (st.emit > rate && st.parts.length < SPARK_POOL) {
          st.emit -= rate;
          const ex = (st.cur / 100) * bw;
          const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.5; // 위쪽 ±약간
          const sp = 20 + Math.random() * 42; // 낮게 — 방출 지점 근처에서 살짝 튀고 페이드(위치 유지감)
          st.parts.push({ x: ex, y: 0, vx: Math.cos(ang) * sp + (Math.random() - 0.5) * 16, vy: Math.sin(ang) * sp,
            age: 0, life: 0.32 + Math.random() * 0.44, sz: 4 + Math.random() * 4.4, color: SPARK_COLORS[(Math.random() * SPARK_COLORS.length) | 0] });
        }
      }
      // 업데이트 — 중력 낙하 + 노화. (방출구와 무관·월드 좌표라 위치를 지킴)
      const g = 150;
      for (const p of st.parts) { p.age += dt; p.vy += g * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
      st.parts = st.parts.filter((p) => p.age < p.life);
      // 렌더 — 고정 풀에 배정, 나머지는 숨김
      for (let k = 0; k < SPARK_POOL; k++) {
        const el = spanRefs.current[k]; if (!el) continue;
        const p = st.parts[k];
        if (!p) { el.style.opacity = '0'; continue; }
        const t = p.age / p.life;
        el.style.opacity = String(Math.max(0, 1 - t * t)); // 자연 페이드아웃
        el.style.width = el.style.height = `${p.sz.toFixed(1)}px`;
        el.style.marginLeft = el.style.marginTop = `${(-p.sz / 2).toFixed(1)}px`; // 크기에 맞춰 중심 정렬
        el.style.background = p.color;
        el.style.boxShadow = `0 0 ${(3 + p.sz).toFixed(0)}px ${p.color}`;
        el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(${(1 - 0.4 * t).toFixed(2)})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, []);
  return (
    <div ref={barRef} style={{ position: 'relative', width: '100%', height: 9 }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: RADIUS.xs, background: 'rgba(255,255,255,0.16)', overflow: 'hidden' }}>
        <div ref={fillRef} style={{ height: '100%', borderRadius: RADIUS.xs, background: GAUGE_FILL }} />
      </div>
      {/* 스파크 레이어 — 파티클은 방출 위치(월드 좌표)를 지키고 자연 페이드. top=바 세로중앙 */}
      <div style={{ position: 'absolute', left: 0, top: 4.5, width: 0, height: 0, pointerEvents: 'none' }}>
        {Array.from({ length: SPARK_POOL }).map((_, k) => (
          <span key={k} ref={(n) => { spanRefs.current[k] = n; }} aria-hidden="true"
            style={{ position: 'absolute', left: 0, top: 0, marginLeft: -1.5, marginTop: -1.5, borderRadius: '50%', opacity: 0, willChange: 'transform, opacity' }} />
        ))}
      </div>
    </div>
  );
}

export function XpGainReveal({ gained, prevXp = 0, newXp = 0, score = 0, correct = 0, isNewBest = false, rank = 0, onDone, hold = false }) {
  // 환산 내역(점수·정답×3·신기록) — 0인 항목은 제외.
  const sources = [
    { key: 'score', label: '점수', val: Math.max(0, Math.round(score || 0)) },
    { key: 'correct', label: `정답 ${correct || 0}개`, val: Math.max(0, (correct || 0) * XP_PER_CORRECT) },
    ...(isNewBest ? [{ key: 'best', label: '신기록', val: XP_NEWBEST_BONUS }] : []),
  ].filter((s) => s.val > 0);

  const [step, setStep] = useState(0); // 지금까지 '쾅' 공개된 항목 수
  const addedSoFar = sources.slice(0, step).reduce((a, s) => a + s.val, 0);
  const animTotal = useCountUp(addedSoFar, 420); // 각 쾅마다 총 XP가 그 값까지 오름(숫자는 쾅과 함께)
  const grade = rankInfo(rank);            // 등급 — XP 무관(보스로만). 엠블럼 정체성 표시용.
  const prevLv = levelInfo(prevXp);
  const finalLv = levelInfo(newXp);
  const done = step >= sources.length;
  // ★게이지·캡션은 쾅쾅쾅이 '다 끝난 뒤'에 채운다 — done 후 짧은 텀을 두고 gaugeFilled.
  const [gaugeFilled, setGaugeFilled] = useState(false);
  const showLv = gaugeFilled ? finalLv : prevLv;              // 채우기 전엔 이전 레벨 유지 → 다 찍힌 뒤 최종
  const leveledUp = gaugeFilled && finalLv.level > prevLv.level; // 이번 XP로 레벨 업

  // 순차 공개 — 첫 항목 320ms, 이후 200ms(겹침). 각 항목마다 '쾅'(햅틱+올라가는 피치).
  useEffect(() => {
    if (done) return undefined;
    const t = setTimeout(() => {
      setStep((s) => s + 1);
      haptic([40, 22, 45]); // 쾅 — 강한 타격 햅틱
      playSfx('combo', undefined, Math.pow(2, step / 7)); // 쾅 — 스텝마다 올라가는 피치
    }, step === 0 ? 320 : 200); // 빠르게 연달아 → 애니메이션이 서로 겹침
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // 쾅쾅쾅이 다 끝난 뒤(짧은 텀) 게이지를 채운다.
  useEffect(() => {
    if (!done) return undefined;
    const t = setTimeout(() => setGaugeFilled(true), 240);
    return () => clearTimeout(t);
  }, [done]);
  // 레벨 업 순간 팡파레.
  useEffect(() => {
    if (leveledUp) { haptic([40, 60, 40]); playSfx('unlock'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gaugeFilled]);

  // 레벨 업이면 게이지를 가득(100%) 채워 '올라감' 느낌 — 아니면 최종 레벨 진행도.
  const pct = leveledUp ? 100 : Math.round(showLv.progress * 100);
  // 시안(461:9) 절대좌표 — 폭 260 중앙 컬럼. 텍스트 y는 시안 '잉크(cap) 좌표'에서 라인박스 오프셋을 뺀 값.
  const COL = { left: 'calc(50% - 130px)', width: 260 };
  return (
    <div onClick={() => { if (!hold && done) onDone && onDone(); }}
      // 딤은 BeatDim(비트 바깥 공용 레이어)이 담당 — 앞 비트가 페이드아웃하고 여기서 즉시 딤이 켜지며
      // 그 사이가 밝아졌다 어두워지는 '깜빡임'이 있었다(2026-08-08 사용자 지적).
      style={{ position: 'fixed', inset: 0, zIndex: 130, cursor: done && !hold ? 'pointer' : 'default' }}>
      <style>{`
        @keyframes xg-bang{0%{opacity:0;transform:scale(2.2)}36%{opacity:1;transform:scale(.8)}62%{transform:scale(1.1)}82%{transform:scale(.97)}100%{transform:scale(1)}}
        @keyframes xg-punch{0%{transform:scale(1)}20%{transform:scale(1.32)}52%{transform:scale(.95)}100%{transform:scale(1)}}
        @keyframes xg-pop{0%{opacity:0;transform:scale(.5)}60%{opacity:1;transform:scale(1.08)}100%{opacity:1;transform:scale(1)}}
        @keyframes xg-boxflash{0%{opacity:1}45%{opacity:.7}100%{opacity:0}}
      `}</style>
      <RevealStage>
      {/* eyebrow — 시안 잉크 y210 */}
      <span style={{ position: 'absolute', left: 0, right: 0, top: 203, textAlign: 'center', ...TYPE.btn, lineHeight: '24px', color: '#fff', animation: 'xg-pop .4s ease both' }}>경험치 획득</span>
      {/* 총 XP — 쾅마다 punch. 시안 잉크 y238 · 50 Roboto Bold(‘XP’ 접미사 없음) */}
      <div key={step} style={{ position: 'absolute', left: 0, right: 0, top: 225, textAlign: 'center', animation: step > 0 ? 'xg-punch .3s ease' : 'none' }}>
        <span style={{ ...TYPE.numHero, fontSize: 50, fontWeight: 700, lineHeight: '62.4px', color: '#fff' }}>+{animTotal.toLocaleString()}</span>
      </div>
      {/* 환산 내역 — 하나씩 '쾅' 등장. 시안 y304부터 37 높이 · 간격 8 */}
      {sources.map((s, i) => (
        <div key={s.key} style={{
          position: 'absolute', ...COL, top: 304 + i * 45, height: 37, overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px',
          borderRadius: 10, background: ROW_BG, opacity: i < step ? 1 : 0, // 시안 r10(토큰 스케일 사이값)
          animation: i < step ? 'xg-bang .42s cubic-bezier(.3,1.4,.5,1) both' : 'none',
        }}>
          {/* 박스 번쩍 — 이 항목이 찍히는 순간 박스 전체가 하얗게 번쩍(등장 시 1회) */}
          {i < step && <span aria-hidden="true" style={{ position: 'absolute', inset: 0, background: '#fff', opacity: 0, animation: 'xg-boxflash .4s ease-out both', pointerEvents: 'none' }} />}
          <span style={{ position: 'relative', ...TYPE.body, fontSize: 16, lineHeight: '20px', color: '#fff' }}>{s.label}</span>
          <span style={{ position: 'relative', ...TYPE.numMd, fontWeight: 700, lineHeight: '25px', color: XP_VALUE }}>+{s.val.toLocaleString()}</span>
        </div>
      ))}
      {/* 레벨 행 — 시안 y461(엠블럼 38 + Lv.N) · 우측 상태 라벨 */}
      <div style={{ position: 'absolute', ...COL, top: 461, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
          <img src={grade.emblem} alt="" width={38} height={38} style={{ display: 'block', flexShrink: 0, filter: `drop-shadow(0 3px 8px ${grade.glow}55)` }} />
          <span style={{ ...TYPE.h1, fontWeight: 900, lineHeight: '25px', color: '#fff' }}>Lv.{showLv.level}</span>
        </div>
        <span style={{ ...TYPE.label, lineHeight: '19px', color: leveledUp ? '#fff' : SUB_WHITE }}>{leveledUp ? '레벨 업!' : `다음 레벨까지 ${showLv.toNext.toLocaleString()} XP`}</span>
      </div>
      {/* 레벨 게이지 — 시안 y505 (항목 공개가 끝난 뒤 차오름) */}
      <div style={{ position: 'absolute', ...COL, top: 505 }}>
        <SparkGauge pct={pct} />
      </div>
      {/* 탭하여 계속 — 게이지까지 다 찬 뒤 텍스트 안내(화면 아무 곳이나 탭하면 결과로). 시안 y555 */}
      {!hold && gaugeFilled && (
        <span style={{ position: 'absolute', left: 0, right: 0, top: 555, textAlign: 'center', ...TYPE.body, fontSize: 14, lineHeight: '20px', color: 'rgba(255,255,255,0.5)', animation: 'xg-pop .4s ease .1s both' }}>탭하여 계속</span>
      )}
      </RevealStage>
    </div>
  );
}
