// 게임 화면 (Figma 좌표 절대배치) — 점수·일시정지·타이머·단어카드·코치·성조버튼 + 콤보/신기록 버스트 연출(P4b).
import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { StarIcon, PauseIcon, TimerIcon, SpeakerHighIcon, TicketIcon, SkullIcon, SignOutIcon } from '@phosphor-icons/react';
import { TG, TYPE, TOUCH_OPT, RADIUS, SPACE } from '../tgTokens.js';
import { play as playSfx } from '../tgSfx.js';
import { Reveal, WordCard, ToneButtons, DrawPad, CoachBubble, ConfettiBurst, CrispFlash, LIGHT_CONFETTI, prefersReducedMotion, TONE_SHOT_HOVER_MS, TONE_FLIGHT_MS, TONE_IMPACT_MS } from './shared.jsx';
import { ComboChip, ToneMark } from '../tgWidgets.jsx';
import { TONES } from '../../constants/toneGameWords.js';
import { useTabTip } from '../../hooks/useTabTip.js';
import CoachMarkOverlay from '../../components/ui/CoachMarkOverlay.jsx';

// 연습 모드 첫 진입 코치마크(1회) — 시간 제한 없음 + 발음듣기/정답보기 안내. 연습은 타이머가 없어 딤 오버레이가 안전.
const PRACTICE_COACH = [
  { selector: '[data-coach="prac-badge"]', label: '트레이닝 모드예요. 시간 제한이 없으니 천천히 생각해도 괜찮아요.' },
  { selector: '[data-coach="prac-actions"]', label: '발음을 듣거나 정답을 볼 수 있어요. 부담 없이 익혀봐요! 🐼' },
];

// 불티 온도 색 — 0 뜨거움(흰-노랑) · 1 중간(오렌지) · 2 식음(진빨강). bg=코어 그라디언트, sh=글로우색.
const SPARK_COLORS = [
  { bg: 'radial-gradient(circle, #fff7de 0%, #ffc058 40%, #ff7a2a 76%, rgba(255,110,30,0) 100%)', sh: 'rgba(255,140,50,0.8)' },
  { bg: 'radial-gradient(circle, #ffe6b2 0%, #ff8f34 44%, #f0421a 78%, rgba(240,60,20,0) 100%)', sh: 'rgba(240,74,24,0.78)' },
  { bg: 'radial-gradient(circle, #ffc891 0%, #f2611c 46%, #cf2c10 80%, rgba(200,40,15,0) 100%)', sh: 'rgba(210,44,18,0.72)' },
];
// 1D 부드러운 값 노이즈(-1..1) — 웨이포인트 없이 연속 난류. 정수 격자 해시 + smoothstep 보간.
function sparkNoise(x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  const h = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
  return (h(i) * (1 - u) + h(i + 1) * u) * 2 - 1;
}
// 콤보 불티 — 각 가장자리(하단↑·상단↓·좌→·우←)에서 안쪽으로. rAF로 매 프레임 위치를 노이즈로 갱신(연속 난류·부력·트윙클·수축·루프).
function ComboSparks({ heatRef }) {
  const refs = useRef([]);
  const cfg = useRef(null);
  const startRef = useRef(null); // rAF 재시작 함수 — heat=0로 정지한 뒤 heat 재점화 시 사용
  if (!cfg.current) {
    const R = Math.random, arr = [];
    for (const [edge, n] of [['up', 9], ['down', 7], ['right', 5], ['left', 5]]) {
      for (let i = 0; i < n; i++) {
        arr.push({
          edge,
          ex: edge === 'left' ? 100 : edge === 'right' ? 0 : 5 + R() * 90, // 시작 x%
          ey: edge === 'up' ? 100 : edge === 'down' ? 0 : 7 + R() * 86,     // 시작 y%
          dist: 42 + R() * 66,   // 주 이동 px
          amp: 11 + R() * 17,    // 노이즈 난류 진폭(잔잔하게 11~28)
          freq: 1.6 + R() * 2.6, // 경로 따라 노이즈 주파수(느긋하게 1.6~4.2)
          seed: R() * 100,
          life: 1.1 + R() * 1.0, // 수명(s)
          t: -R() * 2.2,         // 시작 경과(음수=시차)
          sz: 2.5 + R() * 2.6,
          c: (R() * 3) | 0,
        });
      }
    }
    cfg.current = arr;
  }
  useLayoutEffect(() => {
    let raf, alive = true, running = false, last = 0;
    const tick = (now) => {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const heat = heatRef.current || 0;
      for (let k = 0; k < cfg.current.length; k++) {
        const el = refs.current[k]; const s = cfg.current[k]; if (!el) continue;
        if (heat <= 0) { el.style.opacity = '0'; continue; }
        s.t += dt;
        if (s.t >= s.life) s.t %= s.life;   // 루프(재발생)
        if (s.t < 0) { el.style.opacity = '0'; continue; }
        const t = s.t / s.life;
        const prim = s.dist * (1 - (1 - t) * (1 - t));      // ease-out 주 이동
        const nz = sparkNoise(s.seed + t * s.freq) * s.amp;  // 연속 노이즈 수직 난류
        const buoy = -t * 12;                                // 부력 살짝 위로
        let tx, ty;
        if (s.edge === 'up') { tx = nz; ty = -prim + buoy; }
        else if (s.edge === 'down') { tx = nz; ty = prim + buoy * 0.25; }
        else if (s.edge === 'right') { tx = prim; ty = nz + buoy; }
        else { tx = -prim; ty = nz + buoy; }
        const env = Math.min(1, t * 7) * Math.max(0, 1 - Math.pow(t, 1.7)); // 페이드 인/아웃
        const flick = 0.6 + 0.4 * sparkNoise(s.seed * 1.7 + t * s.freq * 3.2); // 노이즈 트윙클
        el.style.opacity = String(Math.max(0, env * flick));
        el.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${(1 - 0.82 * t).toFixed(3)})`;
      }
      // heat=0이면 위에서 전부 즉시 숨겨져 살아있는 불티가 없음 → rAF 정지(재시작은 heat 재점화 시 start)
      if (heat > 0) raf = requestAnimationFrame(tick);
      else running = false;
    };
    const start = () => {
      if (!alive || running) return;
      running = true; last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    startRef.current = start;
    start();
    return () => { alive = false; running = false; startRef.current = null; cancelAnimationFrame(raf); };
  }, [heatRef]);
  // 부모 재렌더(콤보 변화)마다 확인 — 정지 상태에서 heat가 다시 오르면 rAF 재시작
  useEffect(() => { if ((heatRef.current || 0) > 0 && startRef.current) startRef.current(); });
  return cfg.current.map((s, k) => {
    const st = SPARK_COLORS[s.c];
    return (
      <span key={k} ref={(n) => { refs.current[k] = n; }} style={{
        position: 'absolute', left: `${s.ex}%`, top: `${s.ey}%`, width: s.sz, height: s.sz, marginLeft: -s.sz / 2, marginTop: -s.sz / 2,
        borderRadius: '50%', background: st.bg, boxShadow: `0 0 ${Math.round(3 + s.sz * 1.1)}px 0.5px ${st.sh}`,
        opacity: 0, willChange: 'transform, opacity',
      }} />
    );
  });
}

// 성조 발사체 — 누른 버튼에서 현재 글자로 날아가 정답=꽂힘(WordCard 착탄 동기 팝이 임팩트), 오답=글자가 쳐내 회전하며 튕겨 떨어짐.
// 판정·점수·타이머는 탭 순간 이미 끝난 상태(연출 전용) — 즉시 판정(pointerdown) 손맛과 공정성 유지.
// 건너뛰기 티켓 소모 연출 — 버튼에서 티켓이 뿅 떠올라 카드로 날아가 도착 순간(TONE_IMPACT_MS ≈ 글자 공개) 흡수 페이드.
function SkipTicketFx({ fx, onDone }) {
  const ref = useRef(null);
  const doneRef = useRef(onDone); doneRef.current = onDone;
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return undefined;
    let alive = true;
    const dx = fx.to.x - fx.from.x, dy = fx.to.y - fx.from.y;
    const at = (x, y, sc, rot) => `translate(-50%,-50%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${sc}) rotate(${rot}deg)`;
    // 도착 시점 = 전체의 0.8 지점 → duration을 역산해 TONE_IMPACT_MS에 정확히 착지
    const anim = el.animate([
      { transform: at(0, 0, 0.4, 0), opacity: 0, easing: 'cubic-bezier(.34,1.7,.64,1)' },
      { transform: at(0, -16, 1, -8), opacity: 1, offset: 0.2, easing: 'cubic-bezier(.5,0,.55,1)' }, // 뿅 떠오름
      { transform: at(dx, dy, 1, 10), opacity: 1, offset: 0.8, easing: 'ease-out' },                 // 카드로 비행
      { transform: at(dx, dy, 1.5, 10), opacity: 0 },                                                // 흡수 페이드
    ], { duration: Math.round(TONE_IMPACT_MS / 0.8), fill: 'forwards' });
    anim.onfinish = () => { if (alive) doneRef.current(); };
    return () => { alive = false; anim.cancel(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div aria-hidden="true" data-skipfx="1" style={{ position: 'absolute', left: fx.from.x, top: fx.from.y, zIndex: 22, pointerEvents: 'none' }}>
      <span ref={ref} style={{
        position: 'absolute', left: 0, top: 0, display: 'flex', width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
        borderRadius: '50%', background: '#fff', willChange: 'transform, opacity',
        boxShadow: `0 4px 12px rgba(43,39,48,0.20), 0 0 16px 3px ${TG.CORAL}55`,
      }}>
        <TicketIcon size={26} weight="fill" color={TG.CORAL} style={{ transform: 'rotate(45deg)' }} />
      </span>
    </div>
  );
}

// 잔상 고스트 — 발사 구간에서만 본체를 지연 추적(모션블러 느낌). 진짜 방향성 블러 필터는 모바일 성능 리스크라 트레일로.
const SHOT_GHOSTS = [{ delay: 40, opacity: 0.35, blur: 1 }, { delay: 80, opacity: 0.16, blur: 2 }];
function ToneShot({ shot, onDone, onMissImpact }) {
  const ref = useRef(null);
  const ghostRefs = useRef([]);
  const doneRef = useRef(onDone); doneRef.current = onDone;
  const missRef = useRef(onMissImpact); missRef.current = onMissImpact;
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return undefined;
    let alive = true;
    const dx = shot.to.x - shot.from.x, dy = shot.to.y - shot.from.y;
    // 시퀀스(사용자 확정): '뿅' 바운스 생성 → 제자리 둥실(TONE_SHOT_HOVER_MS) → 직선 가속 착탄(TONE_FLIGHT_MS).
    // 곡선 폐기 — 근거리에선 직선+가속이 더 명확. 세그먼트별 easing은 각 키프레임의 easing이 다음 구간에 적용됨.
    const at = (x, y, sc) => `translate(-50%,-50%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${sc})`;
    const total = TONE_IMPACT_MS;
    const oPop = Math.min(240, TONE_SHOT_HOVER_MS * 0.8) / total; // 뿅 (바운스 오버슈트) — 정지 시간 안에서
    const oHold = TONE_SHOT_HOVER_MS / total;                     // 정지 끝 = 발사 시점
    const frames = [
      { transform: at(0, 0, 0.1), opacity: 0, easing: 'cubic-bezier(.34,1.7,.64,1)' },
      { transform: at(0, 0, 1), opacity: 1, offset: oPop, easing: 'linear' },
      { transform: at(0, 0, 1), opacity: 1, offset: oHold, easing: 'cubic-bezier(.65,-0.05,.95,.5)' }, // 발사 — 강한 가속
      { transform: at(dx, dy, 1.05), opacity: 1 },
    ];
    const fly = el.animate(frames, { duration: total, fill: 'forwards' });
    // 사운드 동기 — 발사 '슉'은 정지가 끝나는 순간(생성음은 과해서 뺌 — 사용자 결정. 음소거는 play()가 처리)
    const flyTimer = setTimeout(() => { if (alive) playSfx('shotFly'); }, TONE_SHOT_HOVER_MS);
    // 잔상 — 본체와 같은 궤적을 지연 재생(transform)·발사 직후 빠르게 나타남(opacity 별도 트랙, 한 트랙에 섞으면 착탄 직전에야 보임)
    const ghostAnims = [];
    SHOT_GHOSTS.forEach((g, gi) => {
      const gel = ghostRefs.current[gi]; if (!gel) return;
      ghostAnims.push(gel.animate(frames.map(({ opacity, ...rest }) => rest), { duration: total, delay: g.delay, fill: 'both' }));
      ghostAnims.push(gel.animate([
        { opacity: 0 }, { opacity: 0, offset: oHold }, { opacity: g.opacity, offset: Math.min(0.99, oHold + 0.07) }, { opacity: g.opacity },
      ], { duration: total, delay: g.delay, fill: 'both' }));
    });
    const hideGhosts = () => {
      ghostAnims.forEach((a) => a.cancel());
      ghostRefs.current.forEach((g) => { if (g) g.style.opacity = '0'; });
    };
    fly.onfinish = () => {
      if (!alive) return;
      hideGhosts(); // 착탄 순간 트레일 소멸 — 임팩트가 잔상을 삼킨 듯이
      if (shot.ok) { playSfx('shotHit'); doneRef.current(shot.key); return; } // 착탄 '톡' — 임팩트 비주얼은 칩 팝(동기 지연)이 맡음
      playSfx('shotMiss'); // 튕김 '팅'
      missRef.current?.(shot); // 한자 쳐냄 반응(밀렸다 복귀) — 마크 반사와 같은 순간
      // 오답 — 들어온 방향 그대로 반사 + 중력 낙하(사용자 확정안). 탄도(반발 속도 + 중력)를 8구간 샘플링.
      const L = Math.hypot(dx, dy) || 1;
      const ux = -dx / L, uy = -dy / L;              // 반사 방향(입사 반대)
      const S = Math.min(320, 140 + L * 0.6);        // 반발 속도(px/s) — 멀리서 온 만큼 세게 튕김
      const G = 1500;                                 // 중력(px/s²)
      const T = 0.52;
      const NB = 8;
      const bframes = Array.from({ length: NB + 1 }, (_, k) => {
        const t = (k / NB) * T;
        const bx = dx + ux * S * t;
        const by = dy + uy * S * t + 0.5 * G * t * t;
        const o = t < T * 0.55 ? 1 : Math.max(0, 1 - (t - T * 0.55) / (T * 0.45));
        return { transform: `translate(-50%,-50%) translate(${bx.toFixed(1)}px,${by.toFixed(1)}px) rotate(${Math.round(ux * 260 * t)}deg) scale(${(1 - 0.25 * (t / T)).toFixed(2)})`, opacity: o.toFixed(2) };
      });
      const bounce = el.animate(bframes, { duration: T * 1000, easing: 'linear', fill: 'forwards' });
      bounce.onfinish = () => { if (alive) doneRef.current(shot.key); };
    };
    return () => { alive = false; clearTimeout(flyTimer); fly.cancel(); ghostAnims.forEach((a) => a.cancel()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 성조색 원판 + 흰 마크(성조 칩과 동일 문법) — 흰 원판보다 흰 카드 위 시인성·구분이 좋음(사용자 피드백)
  const toneColor = TONES.find((t) => t.num === shot.tone)?.color ?? TG.CORAL;
  const puck = (
    <span style={{
      display: 'flex', width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: '50%',
      background: toneColor, color: '#fff',
      boxShadow: `0 4px 12px rgba(43,39,48,0.20), 0 0 16px 3px ${toneColor}55`,
    }}>
      <ToneMark tone={shot.tone} size={26} />
    </span>
  );
  return (
    <div aria-hidden="true" data-shot={shot.ok ? 'ok' : 'miss'} style={{ position: 'absolute', left: shot.from.x, top: shot.from.y, zIndex: 22, pointerEvents: 'none' }}>
      {/* 본체가 첫 자식(QA가 firstElementChild로 위치 추적) — 잔상은 zIndex로 본체 아래 깔림 */}
      <span ref={ref} style={{ position: 'absolute', left: 0, top: 0, display: 'block', zIndex: 1, willChange: 'transform, opacity' }}>{puck}</span>
      {SHOT_GHOSTS.map((g, i) => (
        <span key={i} ref={(n) => { ghostRefs.current[i] = n; }} style={{ position: 'absolute', left: 0, top: 0, display: 'block', zIndex: 0, opacity: 0, filter: `blur(${g.blur}px)`, willChange: 'transform, opacity' }}>{puck}</span>
      ))}
    </div>
  );
}

// 화면 중앙 버스트(P4b) — 콤보 마일스톤·신기록 순간 별 파티클 + 큰 텍스트가 팝하고 사라짐. 비차단.
function CenterBurst({ data }) {
  if (!data) return null;
  const stars = Array.from({ length: 8 }, (_, i) => i);
  return (
    <div key={data.key} style={{ position: 'absolute', left: 0, right: 0, top: 252, display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 20 }}>
      <style>{`
        @keyframes tgb-pop{0%{transform:scale(.4);opacity:0}22%{transform:scale(1.16);opacity:1}68%{transform:scale(1);opacity:1}100%{transform:scale(1);opacity:0}}
        @keyframes tgb-pop-hold{0%{transform:scale(.4);opacity:0}45%{transform:scale(1.16);opacity:1}100%{transform:scale(1);opacity:1}}
        @keyframes tgb-star{0%{transform:translate(0,0) scale(.4);opacity:0}25%{opacity:1}100%{transform:translate(var(--tgx),var(--tgy)) scale(1);opacity:0}}
      `}</style>
      <div style={{ position: 'relative', animation: `${data.hold ? 'tgb-pop-hold' : 'tgb-pop'} 1.2s ease-out forwards` }}>
        {/* 화이트 헤일로 — 단어카드 위에서도 텍스트가 또렷이 떠 보이게 */}
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 250, height: 124, background: 'radial-gradient(closest-side, rgba(255,253,248,0.95), rgba(255,253,248,0.6) 55%, rgba(255,253,248,0))', pointerEvents: 'none' }} />
        {stars.map((i) => {
          const a = (i / stars.length) * Math.PI * 2; const r = 74;
          return (
            <div key={i} style={{ position: 'absolute', left: '50%', top: '50%', width: 11, height: 11, marginLeft: -5.5, marginTop: -5.5, '--tgx': `${Math.cos(a) * r}px`, '--tgy': `${Math.sin(a) * r}px`, animation: 'tgb-star 1s ease-out .04s forwards' }}>
              <svg viewBox="0 0 24 24" width={11} height={11} aria-hidden="true"><path d="M12 0 L14.4 9.6 L24 12 L14.4 14.4 L12 24 L9.6 14.4 L0 12 L9.6 9.6 Z" fill={data.particleColor} /></svg>
            </div>
          );
        })}
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.xxs }}>
          <span style={{ ...TYPE.titleLg, fontSize: 40, color: data.color, textShadow: '0 0 8px #fffdf8, 0 0 8px #fffdf8, 0px 4px 12px rgba(43,39,48,0.18)', whiteSpace: 'nowrap' }}>{data.text}</span>
          {data.sub && <span style={{ ...TYPE.labelSm, color: data.subColor, textShadow: '0 0 6px #fffdf8, 0 0 6px #fffdf8' }}>{data.sub}</span>}
        </div>
      </div>
    </div>
  );
}

export function GameScreen({ word, entered, currentSyl, completed, timedOut, wordIndex, wordsLen, wordTimeLimit, gaugeOffsetMs = 0, lowTime = false, paused, combo, comboFlash, floatScore, score, coachText, onTone, wrongBtn, wrongShakeKey = 0, onPause, onEndTraining, playReveal = true, endless = false, lives = 3, onSkip, showSudden = false, runId = 0, recordToBeat = 0, practice = false, endKind = 'complete', listen = false, audioOff = false, onReplay, onCantHear, onHint, hintUsed = false, onSpeak, onReveal, draw = false, drawExpectedTone, onDraw, drawResetKey = 0, lianyinAt = -1, sandhiAt = -1, demoFx = null }) {
  lowTime = lowTime || demoFx === 'low'; // [DEV] 미리보기 텐션 데모(?screen=game&fx=low) — 머지 전 백도어 제거 대상
  // ── 버스트 연출(P4b): 콤보 마일스톤(5·10·15…) + 라이브 신기록. 비차단·자동 소멸 ──
  const [burst, setBurst] = useState(null);
  const prevComboRef = useRef(0);
  const recordShownRef = useRef(false);
  const burstSeqRef = useRef(0);
  const burstTimerRef = useRef(null);
  const fireBurst = (d) => {
    burstSeqRef.current += 1;
    setBurst({ key: burstSeqRef.current, ...d });
    if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
    burstTimerRef.current = setTimeout(() => setBurst(null), 1250);
  };
  useEffect(() => { // 콤보 마일스톤(5의 배수, 증가 시점만) + 콤보 브레이크(5 이상에서 끊김 — 칩 낙하·붉은 플래시)
    const prev = prevComboRef.current; prevComboRef.current = combo;
    if (combo > prev && combo >= 5 && combo % 5 === 0) fireBurst({ text: `콤보 ${combo}!`, color: TG.CORAL_DK, particleColor: TG.SUN });
    if (combo === 0 && prev >= 5) {
      breakSeqRef.current += 1;
      setComboBreak({ key: breakSeqRef.current, combo: prev });
      if (breakTimerRef.current) clearTimeout(breakTimerRef.current);
      breakTimerRef.current = setTimeout(() => setComboBreak(null), 750);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combo]);
  useEffect(() => { // 라이브 신기록 — 진행 중 이전 최고기록 돌파(1회)
    if (recordToBeat > 0 && score > recordToBeat && !recordShownRef.current) {
      recordShownRef.current = true;
      playSfx('score');
      fireBurst({ text: '신기록!', sub: '최고 기록을 넘었어요', color: '#FF9500', subColor: '#c98300', particleColor: TG.SUN });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score, recordToBeat]);
  useEffect(() => { prevComboRef.current = 0; recordShownRef.current = false; setFlashKey(0); setComboBreak(null); setFreeze(false); setPunch(false); }, [runId]); // 새 런 리셋(완성 연출도 초기화)
  useEffect(() => () => { if (burstTimerRef.current) clearTimeout(burstTimerRef.current); if (breakTimerRef.current) clearTimeout(breakTimerRef.current); }, []);
  useEffect(() => { // [DEV] 미리보기 버스트 데모(?screen=game&fx=combo|record) — hold로 유지(검수용). 머지 전 백도어 제거 대상
    if (demoFx !== 'combo' && demoFx !== 'record') return; // 'low'(텐션 데모) 등은 버스트 미발생
    burstSeqRef.current += 1;
    setBurst(demoFx === 'record'
      ? { key: burstSeqRef.current, hold: true, text: '신기록!', sub: '최고 기록을 넘었어요', color: '#FF9500', subColor: '#c98300', particleColor: TG.SUN }
      : { key: burstSeqRef.current, hold: true, text: '콤보 10!', color: TG.CORAL_DK, particleColor: TG.SUN });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoFx]);
  useEffect(() => { // [DEV] 콤보 브레이크 데모(?screen=game&fx=break) — 1.6s 간격 반복 발동(검수용). 머지 전 백도어 제거 대상
    if (demoFx !== 'break') return undefined;
    const fire = () => { breakSeqRef.current += 1; setComboBreak({ key: breakSeqRef.current, combo: 8 }); };
    fire();
    const iv = setInterval(fire, 1600);
    return () => clearInterval(iv);
  }, [demoFx]);
  // ── 임팩트 연출: 오답=화면 셰이크, 정답 완성=임팩트 프레임(히트스톱)→카드 펀치+화이트 플래시, 콤보 브레이크=칩 낙하+붉은 플래시 ──
  const shakeRef = useRef(null);
  const [punch, setPunch] = useState(false);
  const [freeze, setFreeze] = useState(false); // 히트스톱 — 완성 순간 카드가 살짝 확대된 채 정지, 이후 펀치·플래시가 터짐
  const [flashKey, setFlashKey] = useState(0);
  const [comboBreak, setComboBreak] = useState(null); // { key, combo } — 방금 잃은 콤보
  const breakSeqRef = useRef(0);
  const breakTimerRef = useRef(null);
  // ── 성조 발사체(연출 전용 — 판정은 onTone에서 즉시) ──
  const [shots, setShots] = useState([]); // [{ key, tone, ok, from, to }]
  const shotSeqRef = useRef(0);
  const shotIdxRef = useRef(0); // 연타 대응 — entered prop 재렌더 전에 정답 탭이 겹치면 낙관적으로 다음 음절을 겨냥
  useEffect(() => { shotIdxRef.current = entered.length; }, [entered]);
  useEffect(() => { setShots([]); setSkipFx(null); shotIdxRef.current = 0; }, [wordIndex, runId]); // 단어 전환·새 런 — 비행 중 발사체·티켓 연출 정리
  const removeShot = (key) => setShots((s) => s.filter((x) => x.key !== key));
  // 발사 지오메트리 — 글자 주변 반경 80~130px 랜덤 방향(고정 위치는 단조롭다 — 사용자 피드백). 화면 밖·HUD 침범 클램프 +
  // 다른 한자와 겹치면 리샘플(최대 12회) — 옆 글자 위에 뿅 나타나면 어느 글자를 겨냥하는지 헷갈림.
  const spawnShot = (num, idx, ok) => {
    const root = shakeRef.current; if (!root) return;
    const chip = root.querySelector(`[data-syl="${idx}"]`);
    if (!chip) return;
    const rr = root.getBoundingClientRect(); const cr = chip.getBoundingClientRect();
    const cx = cr.left + cr.width / 2 - rr.left; const cy = cr.top + cr.height / 2 - rr.top;
    const sylRects = [...root.querySelectorAll('[data-syl]')].map((el) => el.getBoundingClientRect());
    const PUCK = 26; // 원판 반경+여유
    let fx = cx, fy = cy + 110; // 폴백(전부 겹치면) — 글자 아래
    for (let tryN = 0; tryN < 12; tryN++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 80 + Math.random() * 50;
      const px = Math.max(26, Math.min(rr.width - 26, cx + Math.cos(ang) * rad));
      const py = Math.max(84, Math.min(rr.height - 170, cy + Math.sin(ang) * rad));
      const gx = px + rr.left, gy = py + rr.top;
      const hit = sylRects.some((q) => gx > q.left - PUCK && gx < q.right + PUCK && gy > q.top - PUCK && gy < q.bottom + PUCK);
      if (!hit) { fx = px; fy = py; break; }
    }
    shotSeqRef.current += 1;
    setShots((s) => [...s.slice(-9), { // 안전 상한 10개 — 오답 연타도 연달아 보이게(사용자 결정 5~10개)
      key: shotSeqRef.current, tone: num, ok, idx,
      from: { x: fx, y: fy },
      to: { x: cx, y: cy },
    }]);
  };
  const fireShot = (num) => {
    if (draw || completed || !word || prefersReducedMotion()) return;
    const idx = Math.max(entered.length, shotIdxRef.current);
    if (idx >= word.tones.length) return;
    const expected = word.tones[idx];
    // 오답 잠금(450ms) 중 반복 오답도 발사체는 나온다 — 판정·패널티는 handleTone이 계속 무시(연출만, 사용자 결정 "연달아 나와도")
    const ok = num === expected;
    if (ok) shotIdxRef.current = idx + 1;
    spawnShot(num, idx, ok);
  };
  // 건너뛰기 연출 — 성조 마크가 아니라 '티켓 소모'가 보여야 맞음(사용자 지적: 성조 버튼을 안 눌렀는데 성조가 나오면 이상).
  // 버튼에서 티켓이 뿅 떠올라 카드로 날아가 도착 순간(TONE_IMPACT_MS, 글자 공개와 동기) 흡수되며 사라짐 — 완성 히트스톱·플래시가 임팩트를 받음.
  const [skipFx, setSkipFx] = useState(null); // { key, from, to }
  const handleSkip = onSkip ? (e) => {
    if (!prefersReducedMotion()) {
      const root = shakeRef.current;
      const br = e.currentTarget.getBoundingClientRect();
      if (root) {
        const rr = root.getBoundingClientRect();
        shotSeqRef.current += 1;
        setSkipFx({
          key: shotSeqRef.current,
          from: { x: br.left + br.width / 2 - rr.left, y: br.top + br.height / 2 - rr.top },
          to: { x: rr.width / 2, y: 129 + 146 }, // 단어 카드 중앙(top129 + h292/2)
        });
        playSfx('shotFly');
      }
    }
    onSkip();
  } : undefined;
  const handleToneTap = (num) => { fireShot(num); onTone(num); };
  // 키보드(1~5·0)도 발사체 연출 — 판정용 전역 keydown(ToneGamePage handleTone)은 GameScreen을 우회하므로 연출만 여기서 미러.
  // 가드도 handleTone과 동일하게(일시정지·카운트다운·서든데스 인트로), 키 맵도 동일.
  const fireShotRef = useRef(fireShot); fireShotRef.current = fireShot;
  const shotGateRef = useRef(false); shotGateRef.current = paused || !playReveal || showSudden;
  useEffect(() => {
    const handler = (e) => {
      if (e.repeat || shotGateRef.current) return;
      const map = { 1: 1, 2: 2, 3: 3, 4: 4, 0: 0, 5: 0 };
      const tone = map[e.key];
      if (tone === undefined) return;
      fireShotRef.current(tone);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  // 오답 착탄 — 한자가 마크를 쳐냄: 들어온 방향으로 밀렸다가 탄성 복귀(WAAPI, breathe와 잠깐 겹쳐도 종료 후 복원)
  const onMissImpact = (s) => {
    const el = shakeRef.current?.querySelector(`[data-syl="${s.idx}"]`);
    if (!el) return;
    const ddx = s.to.x - s.from.x, ddy = s.to.y - s.from.y;
    const l = Math.hypot(ddx, ddy) || 1;
    const px = (ddx / l) * 9, py = (ddy / l) * 9;
    const rot = px >= 0 ? 5 : -5;
    el.animate([
      { transform: 'translate(0px,0px) rotate(0deg)' },
      { transform: `translate(${px.toFixed(1)}px,${py.toFixed(1)}px) rotate(${rot}deg)`, offset: 0.28 },
      { transform: `translate(${(-px * 0.35).toFixed(1)}px,${(-py * 0.35).toFixed(1)}px) rotate(${-rot * 0.5}deg)`, offset: 0.62 },
      { transform: 'translate(0px,0px) rotate(0deg)' },
    ], { duration: 320, easing: 'ease-out' });
  };
  useEffect(() => { // 오답마다 화면 전체 셰이크 — Web Animations API로 매번 처음부터 무조건 재생(React 토글의 배칭/재시작 불안정 회피)
    if (wrongShakeKey === 0 || !shakeRef.current) return; // 초기값 — 게임 시작·재시작 시 미발동
    shakeRef.current.animate(
      [
        { transform: 'translate(0,0)' }, { transform: 'translate(-8px,2px)' }, { transform: 'translate(7px,-2px)' },
        { transform: 'translate(-5px,1px)' }, { transform: 'translate(4px,-1px)' }, { transform: 'translate(0,0)' },
      ],
      { duration: 420, easing: 'ease-in-out' },
    );
  }, [wrongShakeKey]);
  useEffect(() => { // 정답으로 단어 완성(시간초과 제외) — 발사체 착탄 대기 → 임팩트 프레임(60~100ms 정지, 콤보 고조 시 길게) → 카드 펀치 + 플래시
    if (!completed || timedOut || endKind === 'reveal') return undefined; // 정답보기는 발사체가 없어 축하 임팩트 생략(차분히 공개)
    if (prefersReducedMotion()) { setFlashKey((n) => n + 1); return undefined; } // 모션 최소화 — 정지·펀치 없이 플래시만
    const lead = draw ? 0 : TONE_IMPACT_MS; // 마지막 발사체가 글자에 닿는 순간부터 임팩트 시퀀스(그리기는 발사체 없음)
    const freezeMs = 60 + Math.round(heatRef.current * 40);
    const t0 = setTimeout(() => setFreeze(true), lead);
    const a = setTimeout(() => { setFreeze(false); setPunch(true); setFlashKey((n) => n + 1); }, lead + freezeMs);
    const b = setTimeout(() => setPunch(false), lead + freezeMs + 360);
    return () => { clearTimeout(t0); clearTimeout(a); clearTimeout(b); setFreeze(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completed, timedOut]);
  // 콤보 히트 — 콤보가 오를수록 0→1로 고조(콤보2부터, 12에서 최대). 콤보 화염(외곽 불씨+글로우) 강도에 사용.
  // demoFx='combo'는 [DEV] 미리보기서 화염 강제(?screen=game&fx=combo). 머지 전 백도어 제거 대상.
  const heat = demoFx === 'combo' ? 0.8 : (combo >= 2 ? Math.min((combo - 1) / 11, 1) : 0);
  const heatRef = useRef(heat); heatRef.current = heat; // rAF 불티가 매 프레임 참조(강도)
  // 건너뛰기 패스 소모 연출 — 건너뛰기로 lives가 줄면 방금 빈 티켓(index=lives)을 '팟' 튕겨 소모를 명확히 보여줌.
  const prevLivesRef = useRef(lives);
  const [lostHeart, setLostHeart] = useState(-1);
  useEffect(() => {
    if (lives < prevLivesRef.current) { setLostHeart(lives); const t = setTimeout(() => setLostHeart(-1), 520); prevLivesRef.current = lives; return () => clearTimeout(t); }
    prevLivesRef.current = lives; return undefined;
  }, [lives]);
  useEffect(() => { prevLivesRef.current = lives; setLostHeart(-1); }, [runId]); // 새 런 리셋
  // 1판 1힌트 큐(각 1회) — 우선순위: 타이머(game-play) → 건너뛰기(game-skip-v1) → 발음 힌트(game-hint-v1).
  // 건너뛰기 패스(옛 하트, 생명 아님)·발음 힌트는 기존 유저도 처음 만나는 기능이라 판마다 하나씩 순차 안내.
  // 딤/블로킹 없음(타이머 안 멈춤·탭 방해 없음). 조작법은 튜토리얼이 이미 가르침.
  const tipPlay = useTabTip('game-play', true);
  const tipSkip = useTabTip('game-skip-v1', true);
  const tipHint = useTabTip('game-hint-v1', true);
  const pracTip = useTabTip('game-practice', true); // 연습 첫 진입 코치마크(1회, 딤 스포트라이트)
  const [runTip, setRunTip] = useState(null);
  useEffect(() => {
    if (practice || !playReveal || draw) return undefined; // 그리기 문제는 탭 기준 팁(문구·위치)이 안 맞아 생략 — 다음 탭 문제에서 표시
    let pick = null;
    if (tipPlay.visible) pick = { id: 'play', dismiss: tipPlay.dismiss };
    else if (tipSkip.visible && onSkip) pick = { id: 'skip', dismiss: tipSkip.dismiss };
    else if (tipHint.visible && onHint && !listen) pick = { id: 'hint', dismiss: tipHint.dismiss };
    if (!pick) return undefined;
    const wait = showSudden ? 2600 : 300; // 서든데스 킥오프 배너(2.35s)와 겹치지 않게 배너 뒤 등장
    const a = setTimeout(() => setRunTip(pick.id), wait);
    const b = setTimeout(() => { setRunTip(null); pick.dismiss(); }, wait + 4800);
    return () => { clearTimeout(a); clearTimeout(b); };
    // showSudden도 deps에: 배너가 effect 실행 '후'에 켜지면(무한 첫 팁) 팁이 배너 아래 깔림 → 재스케줄로 배너 뒤 등장 보장
  }, [playReveal, practice, showSudden, draw]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={shakeRef} data-tg-shake-root="1" style={{ position: 'absolute', inset: 0 }}>
      {/* 콤보 화염 — '불붙는다'는 긍정적 모멘텀(피격 비네트 아님). 사방 외곽에서 불씨가 피어오름 + 골드 글로우 플리커. 콘텐츠 뒤(zIndex0)·비차단 */}
      {heat > 0 && (
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0, opacity: 0.72 + heat * 0.28 }}>
          {/* 따뜻한 외곽 화염 글로우(골드→오렌지) + 은은한 플리커 */}
          <div style={{ position: 'absolute', inset: 0, boxShadow: `inset 0 0 ${46 + heat * 80}px ${7 + heat * 24}px rgba(255,140,40,${0.14 + heat * 0.32})`, animation: 'tg-emberflicker 1.5s ease-in-out infinite', transition: 'box-shadow .45s ease' }} />
          {/* 나무 타듯 각 가장자리에서 안쪽으로 튀는 불티 — rAF+노이즈로 연속 난류(웨이포인트 없음) */}
          <ComboSparks heatRef={heatRef} />
        </div>
      )}
      {/* 콤보 브레이크 붉은 플래시 — 콤보를 '잃었다'는 원샷 큐(저시간 비네트의 무한 맥동과 달리 1회 페이드). 비차단 */}
      {comboBreak && (
        <div key={`cbf-${comboBreak.key}`} aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3,
          boxShadow: 'inset 0 0 70px 20px rgba(242,72,76,0.45)', animation: 'tg-redflash .55s ease-out forwards' }} />
      )}
      {/* 성조 발사체 — 버튼→현재 글자 비행(정답=착탄 팝 동기, 오답=튕겨 낙하). 비차단·연출 전용 */}
      {shots.map((s) => <ToneShot key={s.key} shot={s} onDone={removeShot} onMissImpact={onMissImpact} />)}
      {/* 건너뛰기 티켓 소모 — 버튼→카드 비행 후 흡수(글자 공개와 동기) */}
      {skipFx && <SkipTicketFx key={skipFx.key} fx={skipFx} onDone={() => setSkipFx(null)} />}
      {/* 저시간 비네트 — 막바지에 화면 가장자리 붉은 맥동(텐션 램프 보강·게이지 심박과 동기). 비차단 */}
      {lowTime && !practice && (
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3,
          boxShadow: 'inset 0 0 72px 26px rgba(242,72,76,0.42)', animation: 'tg-vignette .85s ease-in-out infinite' }} />
      )}
      {/* 점수 (상단 중앙) — 트레이닝은 기록·점수 개념이 없어 숨김 */}
      {!practice && (
      <Reveal i={0} play={playReveal} style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, background: '#fff', padding: '9px 14px', borderRadius: RADIUS.lg, boxShadow: '0px 3px 8px rgba(43,39,48,0.06)' }}>
        <StarIcon size={13} weight="fill" color={TG.SUN} />
        <span style={{ ...TYPE.numMd, fontSize: 17, color: TG.INK }}>{score}</span>
      </div>
      </Reveal>
      )}
      {/* 일시정지 (우상단) — 계속/다시하기/그만두기 메뉴 포함 */}
      <Reveal i={0} play={playReveal} style={{ position: 'absolute', right: 20, top: 23 }}>
      <button onClick={onPause} aria-label="일시정지" className="tg-press" style={{ width: 40, height: 40, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT }}>
        <PauseIcon size={20} weight="fill" color={TG.SUB} />
      </button>
      </Reveal>
      {/* 타이머 top69 — 연습 모드는 게이지 대신 '연습 모드' 배지 */}
      {practice ? (
        <Reveal i={1} play={playReveal} style={{ position: 'absolute', left: 20, right: 20, top: 69, display: 'flex', justifyContent: 'center' }}>
          <div data-coach="prac-badge" style={{ display: 'inline-flex', alignItems: 'center', padding: '8px 14px', borderRadius: RADIUS.lg, background: 'rgba(54,201,141,0.14)' }}>
            <span style={{ ...TYPE.labelSm, color: TG.SUCCESS }}>트레이닝 · 시간 제한 없음</span>
          </div>
        </Reveal>
      ) : (
        <Reveal i={1} play={playReveal} style={{ position: 'absolute', left: 20, right: 20, top: 69 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md }}>
          <div style={{ width: 32, height: 32, borderRadius: RADIUS.lg, background: lowTime ? TG.CORAL_DK : '#ff5e62', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: lowTime ? '0px 0px 10px rgba(242,72,76,0.7)' : '0px 3px 4.5px rgba(255,94,98,0.45)', animation: lowTime ? 'tg-heartbeat .85s ease-in-out infinite' : 'none' }}>
            <TimerIcon size={20} weight="fill" color="#fff" />
          </div>
          <div style={{ flex: 1, height: 12, borderRadius: RADIUS.sm, background: TG.TRACK, overflow: 'hidden', boxShadow: lowTime ? '0 0 0 2px rgba(242,72,76,0.35)' : 'none', transition: 'box-shadow .2s ease' }}>
            <div key={`${runId}-${wordIndex}-${wordTimeLimit}-${gaugeOffsetMs}`} style={{ height: '100%', width: '100%', borderRadius: RADIUS.sm, background: lowTime ? 'linear-gradient(90deg,#ff5e62,#f2484c)' : 'linear-gradient(90deg,#ffc23c,#ff6b6b)', animation: `tg-timer ${wordTimeLimit}ms linear forwards`, animationDelay: `-${gaugeOffsetMs}ms`, animationPlayState: (paused || completed) ? 'paused' : 'running' }} />
          </div>
        </div>
        </Reveal>
      )}
      {/* 1판 1힌트(각 1회) — 타이머/건너뛰기/발음힌트 안내. 건너뛰기 안내만 버튼 근처(하단), 나머지는 타이머 아래. 비차단·자동 페이드 */}
      {runTip && !practice && (
        <div style={{ position: 'absolute', left: 20, right: 20,
          ...(runTip === 'skip' ? { bottom: 'calc(184px + env(safe-area-inset-bottom))' } : { top: 103 }),
          display: 'flex', justifyContent: 'center', zIndex: 24, pointerEvents: 'none', animation: 'tg-hint 5.1s ease forwards' }} aria-hidden="true">
          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, background: TG.INK, color: '#fff', ...TYPE.labelSm, lineHeight: 1, padding: '7px 12px', borderRadius: RADIUS.md, boxShadow: '0 4px 12px rgba(43,39,48,0.22)', whiteSpace: 'nowrap' }}>
            {runTip === 'play' && <><TimerIcon size={13} weight="fill" color="#ff9f6b" />타이머가 끝나기 전에 성조를 골라요!</>}
            {runTip === 'skip' && <><TicketIcon size={13} weight="fill" color={TG.CORAL} />틀려도 안 죽어요 · 어려우면 건너뛰기!</>}
            {runTip === 'hint' && <><SpeakerHighIcon size={13} weight="fill" color="#ff9f6b" />발음 힌트를 들으면 콤보가 끊겨요!</>}
          </div>
        </div>
      )}
      {/* 단어카드 top129 (폭 채움) — 단어 바뀔 때마다 키 변경으로 입장 모션(tg-card-in) */}
      <Reveal i={2} play={playReveal} style={{ position: 'absolute', left: 20, right: 20, top: 129 }}>
        <div style={{ position: 'relative' }}>
          <div key={`card-${runId}-${wordIndex}`} style={{ animation: 'tg-card-in .38s cubic-bezier(.22,1,.36,1) both' }}>
            <div style={{ position: 'relative', transform: freeze ? 'scale(1.035)' : 'none', animation: punch ? 'tg-punch .35s ease-out' : 'none', '--tg-punch-s': (1.05 + heat * 0.05).toFixed(3) }}>
              <WordCard word={word} entered={entered} currentSyl={currentSyl} completed={completed} timedOut={timedOut} progressText={endless ? `${wordIndex + 1}` : `${wordIndex + 1}/${wordsLen}`} hideProgress={practice} combo={combo} comboFlash={comboFlash} floatScore={practice ? null : floatScore} listen={listen} audioOff={audioOff} onReplay={onReplay} onCantHear={onCantHear} onHint={onHint} hintUsed={hintUsed} draw={draw} lianyinAt={lianyinAt} sandhiAt={sandhiAt} practice={practice} onSpeak={onSpeak} onReveal={onReveal} />
            </div>
          </div>
          {/* 정답 완성 연출 — 크리스프 플래시(번쩍) + 색색 색종이 + 흰/골드 글리터. ★단어 키 래퍼 '밖'에 둠: 안에 두면 새 단어 등장 때마다 리마운트되어 오발. flashKey 증가(정답 완성) 시에만 발동 */}
          {flashKey > 0 && <CrispFlash key={`fl-${flashKey}`} radial borderRadius={24} color="rgba(255,255,255,0.95)" zIndex={7} />}
          {flashKey > 0 && <ConfettiBurst key={`cf-${flashKey}`} count={16 + Math.round(heat * 12)} power={0.85 + heat * 0.35} size={9} zIndex={6} />}
          {flashKey > 0 && <ConfettiBurst key={`cg-${flashKey}`} colors={LIGHT_CONFETTI} count={9 + Math.round(heat * 7)} power={0.95 + heat * 0.3} size={5} zIndex={6} />}
          {/* 콤보 브레이크 — 방금 잃은 콤보 칩이 기울며 떨어져 사라짐(상실을 보여줘야 다음 판에 지키고 싶어짐). 칩 실제 위치(right16 top14)에서 낙하 */}
          {comboBreak && !prefersReducedMotion() && (
            <div key={`cb-${comboBreak.key}`} aria-hidden="true" style={{ position: 'absolute', right: 16, top: 14, zIndex: 8, pointerEvents: 'none', animation: 'tg-combodrop .6s cubic-bezier(.5,-0.1,.85,.5) forwards' }}>
              <ComboChip combo={comboBreak.combo} />
            </div>
          )}
        </div>
      </Reveal>
      {/* 코치 — 일반 모드만. 연습 모드는 카드 힌트 + 발음듣기/정답보기 버튼이 안내하고,
          4겹(카드·코치·연습버튼·성조버튼)이라 짧은 화면서 겹쳐 미표시.
          ★top 고정 금지: 단어카드 하단(129+292=421)~건너뛰기 행 위(bottom 130+버튼38+여유) 사이 밴드에 flex 세로중앙 —
          짧은 화면(사파리 툴바 ~660-720px)서 하단 고정 건너뛰기 버튼과 겹치지 않게(시작/결과화면과 동일 원칙). */}
      {!practice && !draw && (
        <Reveal i={3} play={playReveal} style={{ position: 'absolute', left: 24, right: 24, top: 428, bottom: 'calc(178px + env(safe-area-inset-bottom))', display: 'flex', alignItems: 'center' }}>
          <CoachBubble text={coachText} />
        </Reveal>
      )}
      {/* 트레이닝 종료 — 무한이라 자발적 종료용. 발음듣기/정답보기는 카드로 이관됨 → 성조버튼과 카드 사이 밴드에 배치(오터치 방지) */}
      {practice && onEndTraining && (
        <Reveal i={3} play={playReveal} style={{ position: 'absolute', left: 0, right: 0, bottom: 'calc(150px + env(safe-area-inset-bottom))', display: 'flex', justifyContent: 'center' }}>
          <button onClick={onEndTraining} className="tg-press" style={{ display: 'inline-flex', alignItems: 'center', gap: SPACE.sm, padding: '9px 18px', borderRadius: RADIUS.lg, background: '#fff', border: '1.5px solid #ebe5de', boxShadow: '0px 2px 6px rgba(43,39,48,0.05)', cursor: 'pointer', ...TOUCH_OPT }}>
            <SignOutIcon size={15} weight="bold" color={TG.SUB} />
            <span style={{ ...TYPE.label, color: TG.SUB }}>트레이닝 종료</span>
          </button>
        </Reveal>
      )}
      {/* 건너뛰기 — 못 풀겠는 단어를 건너뛰기 패스 1개 쓰고 넘김. 남은 티켓 3칸을 버튼 안에 함께 표시(예산 HUD 통합):
          fill=남음·흐림=소진, 소모 시 방금 빈 티켓을 '팟' 튕겨(tg-skiplose) 소진을 명확히. 0이면 비활성(스킵만 불가, 게임은 계속). 연습 모드는 미노출. */}
      {onSkip && (
        <Reveal i={4} play={playReveal} style={{ position: 'absolute', left: 0, right: 0, bottom: draw ? 'calc(40px + env(safe-area-inset-bottom))' : 'calc(130px + env(safe-area-inset-bottom))', display: 'flex', justifyContent: 'center' }}>
          <style>{`@keyframes tg-skiplose{0%{transform:rotate(45deg) scale(1)}28%{transform:rotate(37deg) scale(1.4)}55%{transform:rotate(51deg) scale(.7)}100%{transform:rotate(45deg) scale(.82)}}`}</style>
          {(() => {
            const disabled = completed || lives <= 0;
            return (
              <button onClick={handleSkip} disabled={disabled} className="tg-press"
                aria-label={lives > 0 ? `건너뛰기 · 남은 ${lives}개 (1회 소모)` : '건너뛰기를 다 써서 넘길 수 없어요'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: SPACE.md, padding: '9px 16px', borderRadius: RADIUS.lg,
                  background: '#fff', border: '1.5px solid #ebe5de', cursor: disabled ? 'default' : 'pointer',
                  opacity: disabled ? 0.5 : 1, boxShadow: '0px 2px 6px rgba(43,39,48,0.05)', ...TOUCH_OPT }}>
                <span style={{ ...TYPE.labelSm, color: TG.INK }}>건너뛰기</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: SPACE.sm }} aria-hidden="true">
                  {[0, 1, 2].map((i) => {
                    const on = i < lives;
                    return (
                      <TicketIcon key={i} size={17} weight={on ? 'fill' : 'regular'} color={on ? TG.CORAL : TG.MUTED}
                        style={{ transition: 'transform 200ms ease, color 200ms ease', transform: on ? 'rotate(45deg) scale(1)' : 'rotate(45deg) scale(0.82)',
                          animation: i === lostHeart ? 'tg-skiplose 520ms ease-out' : 'none' }} />
                    );
                  })}
                </span>
              </button>
            );
          })()}
        </Reveal>
      )}
      {/* 하단 입력 — 그리기 문제면 그리기 패드, 아니면 성조버튼.
          ★패드는 top/bottom으로 높이를 잡으므로 Reveal(이중 div, 안쪽 height 없음) 대신 단일 positioned div로 감싸 height:100%가 살게 함 */}
      {draw ? (
        <div className={playReveal ? 'tg-reveal' : undefined}
          style={{ position: 'absolute', left: 20, right: 20, top: 436, bottom: 'calc(90px + env(safe-area-inset-bottom))', animationDelay: '430ms', ...(playReveal ? {} : { opacity: 0 }) }}>
          <DrawPad expectedTone={drawExpectedTone} onDraw={onDraw} disabled={completed || !playReveal || paused} resetKey={drawResetKey} />
        </div>
      ) : (
        <Reveal i={5} play={playReveal} style={{ position: 'absolute', left: 20, right: 20, bottom: 'calc(30px + env(safe-area-inset-bottom))' }}>
          <ToneButtons onTone={handleToneTap} wrongBtn={wrongBtn} disabled={completed} heat={heat} />
        </Reveal>
      )}
      {/* 콤보 마일스톤 · 라이브 신기록 버스트(P4b) */}
      <CenterBurst data={burst} />
      {/* 정답 판정(완벽/훌륭/좋아) + 점수 — 카드 중앙에 크게 팝(코너 플로트는 시선이 안 가서 이관). 밀레스톤 버스트 뜰 땐 양보. 연습=점수 없음. */}
      {!practice && floatScore && !burst && (() => {
        const J = { best: { label: '완벽!', color: '#F5A623', size: 38, glow: true }, mid: { label: '훌륭!', color: '#1fa86a', size: 32 }, base: { label: '좋아!', color: '#8a8590', size: 27 } }[floatScore.judge] || { label: '', color: TG.SUB, size: 27 };
        return (
          <div key={`jp-${score}`} style={{ position: 'absolute', left: 0, right: 0, top: 240, display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 19 }}>
            <style>{`@keyframes tg-judge{0%{transform:translateY(8px) scale(.5);opacity:0}20%{transform:translateY(0) scale(1.14);opacity:1}58%{transform:translateY(0) scale(1);opacity:1}100%{transform:translateY(-22px) scale(1);opacity:0}}`}</style>
            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, animation: 'tg-judge 1.25s ease-out forwards' }}>
              <div aria-hidden="true" style={{ position: 'absolute', left: '50%', top: '46%', transform: 'translate(-50%,-50%)', width: 210, height: 112, background: 'radial-gradient(closest-side, rgba(255,253,248,0.92), rgba(255,253,248,0.5) 55%, rgba(255,253,248,0))' }} />
              {floatScore.judge && (
                <span style={{ position: 'relative', ...TYPE.titleLg, fontSize: J.size, fontWeight: 800, color: J.color, textShadow: '0 0 8px #fffdf8, 0 0 8px #fffdf8, 0px 3px 10px rgba(43,39,48,0.16)', whiteSpace: 'nowrap' }}>{J.label}{J.glow ? ' ✨' : ''}</span>
              )}
              <span style={{ position: 'relative', ...TYPE.numMd, fontSize: 26, fontWeight: 800, color: TG.SUCCESS, textShadow: '0 0 6px #fffdf8, 0 0 6px #fffdf8' }}>+{floatScore.n}</span>
            </div>
          </div>
        );
      })()}
      {/* 연습 첫 진입 코치마크 — 카운트다운 끝나 배지·버튼 뜬 뒤 스포트라이트(연습은 타이머 없어 딤 안전) */}
      <CoachMarkOverlay visible={practice && playReveal && pracTip.visible} onDone={pracTip.dismiss} steps={PRACTICE_COACH} delay={360} showControls={false} />
      {/* 무한 서든데스 킥오프 연출 — 런 시작 시 뒤 배경 딤+블러 위에 중앙 큰 '서든데스 / 한 번 틀리면 끝!'. 연출 중 타이머 정지(부모가 paused 처리). */}
      {showSudden && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 40,
          background: 'rgba(24,18,26,0.5)', backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)',
          animation: 'tg-suddenbg 2.35s ease forwards' }} aria-hidden="true">
          <style>{`
            @keyframes tg-suddenbg{0%{opacity:0}12%{opacity:1}82%{opacity:1}100%{opacity:0}}
            @keyframes tg-sudden{0%{opacity:0;transform:scale(.6)}14%{opacity:1;transform:scale(1.1)}28%{transform:scale(1)}82%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.96)}}
          `}</style>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.xl, animation: 'tg-sudden 2.35s ease forwards' }}>
            <div style={{ width: 88, height: 88, borderRadius: RADIUS.card, background: 'linear-gradient(135deg,#ff5e62,#b3050a)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 14px 40px rgba(179,5,10,0.55)' }}>
              <SkullIcon size={50} weight="fill" color="#fff" />
            </div>
            <span style={{ ...TYPE.titleLg, fontSize: 42, lineHeight: 1, color: '#fff', textShadow: '0 3px 18px rgba(0,0,0,0.45)' }}>서든데스</span>
            <span style={{ ...TYPE.btn, color: 'rgba(255,255,255,0.92)', textShadow: '0 2px 10px rgba(0,0,0,0.4)' }}>한 번 틀리면 끝!</span>
          </div>
        </div>
      )}
    </div>
  );
}
