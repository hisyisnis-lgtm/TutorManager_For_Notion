// 게임 화면 (Figma 좌표 절대배치) — 점수·일시정지·타이머·단어카드·코치·성조버튼 + 콤보/신기록 버스트 연출(P4b).
import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { StarIcon, PauseIcon, TimerIcon, SpeakerHighIcon, EyeIcon, TicketIcon, SkullIcon } from '@phosphor-icons/react';
import { TG, FONT_TITLE, FONT_NUM, FONT_BODY, TOUCH_OPT } from '../tgTokens.js';
import { play as playSfx } from '../tgSfx.js';
import { Reveal, WordCard, ToneButtons, DrawPad, CoachBubble, ConfettiBurst, CrispFlash, LIGHT_CONFETTI } from './shared.jsx';
import { useTabTip } from '../../hooks/useTabTip.js';
import CoachMarkOverlay from '../../components/ui/CoachMarkOverlay.jsx';

// 연습 모드 첫 진입 코치마크(1회) — 시간 제한 없음 + 발음듣기/정답보기 안내. 연습은 타이머가 없어 딤 오버레이가 안전.
const PRACTICE_COACH = [
  { selector: '[data-coach="prac-badge"]', label: '연습 모드예요. 시간 제한이 없으니 천천히 생각해도 괜찮아요.' },
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
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <span style={{ fontFamily: FONT_TITLE, fontSize: 40, color: data.color, textShadow: '0 0 8px #fffdf8, 0 0 8px #fffdf8, 0px 4px 12px rgba(43,39,48,0.18)', whiteSpace: 'nowrap' }}>{data.text}</span>
          {data.sub && <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: data.subColor, textShadow: '0 0 6px #fffdf8, 0 0 6px #fffdf8' }}>{data.sub}</span>}
        </div>
      </div>
    </div>
  );
}

export function GameScreen({ word, entered, currentSyl, completed, timedOut, wordIndex, wordsLen, wordTimeLimit, gaugeOffsetMs = 0, lowTime = false, paused, combo, comboFlash, floatScore, score, coachText, onTone, wrongBtn, wrongShakeKey = 0, onPause, playReveal = true, endless = false, lives = 3, onSkip, showSudden = false, runId = 0, recordToBeat = 0, practice = false, listen = false, audioOff = false, onReplay, onCantHear, onHint, hintUsed = false, onSpeak, onReveal, draw = false, drawExpectedTone, onDraw, drawResetKey = 0, demoFx = null }) {
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
  useEffect(() => { // 콤보 마일스톤(5의 배수, 증가 시점만)
    const prev = prevComboRef.current; prevComboRef.current = combo;
    if (combo > prev && combo >= 5 && combo % 5 === 0) fireBurst({ text: `콤보 ${combo}!`, color: TG.CORAL_DK, particleColor: TG.SUN });
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
  useEffect(() => { prevComboRef.current = 0; recordShownRef.current = false; setFlashKey(0); }, [runId]); // 새 런 리셋(완성 연출도 초기화)
  useEffect(() => () => { if (burstTimerRef.current) clearTimeout(burstTimerRef.current); }, []);
  useEffect(() => { // [DEV] 미리보기 버스트 데모(?screen=game&fx=combo|record) — hold로 유지(검수용). 머지 전 백도어 제거 대상
    if (demoFx !== 'combo' && demoFx !== 'record') return; // 'low'(텐션 데모) 등은 버스트 미발생
    burstSeqRef.current += 1;
    setBurst(demoFx === 'record'
      ? { key: burstSeqRef.current, hold: true, text: '신기록!', sub: '최고 기록을 넘었어요', color: '#FF9500', subColor: '#c98300', particleColor: TG.SUN }
      : { key: burstSeqRef.current, hold: true, text: '콤보 10!', color: TG.CORAL_DK, particleColor: TG.SUN });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoFx]);
  // ── 임팩트 연출: 오답=화면 셰이크, 정답 완성=카드 펀치+화이트 플래시 ──
  const shakeRef = useRef(null);
  const [punch, setPunch] = useState(false);
  const [flashKey, setFlashKey] = useState(0);
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
  useEffect(() => { // 정답으로 단어 완성(시간초과 제외) — 카드 펀치 + 플래시
    if (!completed || timedOut) return undefined;
    setPunch(true); setFlashKey((n) => n + 1);
    const t = setTimeout(() => setPunch(false), 360);
    return () => clearTimeout(t);
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
      {/* 저시간 비네트 — 막바지에 화면 가장자리 붉은 맥동(텐션 램프 보강·게이지 심박과 동기). 비차단 */}
      {lowTime && !practice && (
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3,
          boxShadow: 'inset 0 0 72px 26px rgba(242,72,76,0.42)', animation: 'tg-vignette .85s ease-in-out infinite' }} />
      )}
      {/* 점수 (상단 중앙) */}
      <Reveal i={0} play={playReveal} style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#fff', padding: '9px 14px', borderRadius: 15, boxShadow: '0px 3px 8px rgba(43,39,48,0.06)' }}>
        <StarIcon size={13} weight="fill" color={TG.SUN} />
        <span style={{ fontFamily: FONT_NUM, fontWeight: 800, fontSize: 17, color: '#2b2730' }}>{score}</span>
      </div>
      </Reveal>
      {/* 일시정지 (우상단) */}
      <Reveal i={0} play={playReveal} style={{ position: 'absolute', right: 20, top: 23 }}>
      <button onClick={onPause} aria-label="일시정지" className="tg-press" style={{ width: 40, height: 40, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT }}>
        <PauseIcon size={20} weight="fill" color={TG.SUB} />
      </button>
      </Reveal>
      {/* 타이머 top69 — 연습 모드는 게이지 대신 '연습 모드' 배지 */}
      {practice ? (
        <Reveal i={1} play={playReveal} style={{ position: 'absolute', left: 20, right: 20, top: 69, display: 'flex', justifyContent: 'center' }}>
          <div data-coach="prac-badge" style={{ display: 'inline-flex', alignItems: 'center', padding: '8px 14px', borderRadius: 16, background: 'rgba(54,201,141,0.14)' }}>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: TG.SUCCESS }}>연습 모드 · 시간 제한 없음</span>
          </div>
        </Reveal>
      ) : (
        <Reveal i={1} play={playReveal} style={{ position: 'absolute', left: 20, right: 20, top: 69 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: 16, background: lowTime ? '#f2484c' : '#ff5e62', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: lowTime ? '0px 0px 10px rgba(242,72,76,0.7)' : '0px 3px 4.5px rgba(255,94,98,0.45)', animation: lowTime ? 'tg-heartbeat .85s ease-in-out infinite' : 'none' }}>
            <TimerIcon size={20} weight="fill" color="#fff" />
          </div>
          <div style={{ flex: 1, height: 12, borderRadius: 6, background: '#f0ebe4', overflow: 'hidden', boxShadow: lowTime ? '0 0 0 2px rgba(242,72,76,0.35)' : 'none', transition: 'box-shadow .2s ease' }}>
            <div key={`${runId}-${wordIndex}-${wordTimeLimit}-${gaugeOffsetMs}`} style={{ height: '100%', width: '100%', borderRadius: 6, background: lowTime ? 'linear-gradient(90deg,#ff5e62,#f2484c)' : 'linear-gradient(90deg,#ffc23c,#ff6b6b)', animation: `tg-timer ${wordTimeLimit}ms linear forwards`, animationDelay: `-${gaugeOffsetMs}ms`, animationPlayState: (paused || completed) ? 'paused' : 'running' }} />
          </div>
        </div>
        </Reveal>
      )}
      {/* 1판 1힌트(각 1회) — 타이머/건너뛰기/발음힌트 안내. 건너뛰기 안내만 버튼 근처(하단), 나머지는 타이머 아래. 비차단·자동 페이드 */}
      {runTip && !practice && (
        <div style={{ position: 'absolute', left: 20, right: 20,
          ...(runTip === 'skip' ? { bottom: 'calc(184px + env(safe-area-inset-bottom))' } : { top: 103 }),
          display: 'flex', justifyContent: 'center', zIndex: 24, pointerEvents: 'none', animation: 'tg-hint 5.1s ease forwards' }} aria-hidden="true">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#2b2730', color: '#fff', fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12, lineHeight: 1, padding: '7px 12px', borderRadius: 11, boxShadow: '0 4px 12px rgba(43,39,48,0.22)', whiteSpace: 'nowrap' }}>
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
            <div style={{ position: 'relative', animation: punch ? 'tg-punch .35s ease-out' : 'none' }}>
              <WordCard word={word} entered={entered} currentSyl={currentSyl} completed={completed} timedOut={timedOut} progressText={endless ? `${wordIndex + 1}` : `${wordIndex + 1}/${wordsLen}`} combo={combo} comboFlash={comboFlash} floatScore={floatScore} listen={listen} audioOff={audioOff} onReplay={onReplay} onCantHear={onCantHear} onHint={onHint} hintUsed={hintUsed} draw={draw} />
            </div>
          </div>
          {/* 정답 완성 연출 — 크리스프 플래시(번쩍) + 색색 색종이 + 흰/골드 글리터. ★단어 키 래퍼 '밖'에 둠: 안에 두면 새 단어 등장 때마다 리마운트되어 오발. flashKey 증가(정답 완성) 시에만 발동 */}
          {flashKey > 0 && <CrispFlash key={`fl-${flashKey}`} radial borderRadius={24} color="rgba(255,255,255,0.95)" zIndex={7} />}
          {flashKey > 0 && <ConfettiBurst key={`cf-${flashKey}`} count={16} power={0.85} size={9} zIndex={6} />}
          {flashKey > 0 && <ConfettiBurst key={`cg-${flashKey}`} colors={LIGHT_CONFETTI} count={9} power={0.95} size={5} zIndex={6} />}
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
      {/* 연습 모드 — 발음 듣기 / 정답 보기 (성조버튼 위) */}
      {practice && (
        <Reveal i={4} play={playReveal} style={{ position: 'absolute', left: 20, right: 20, bottom: 'calc(130px + env(safe-area-inset-bottom))' }}>
          <div data-coach="prac-actions" style={{ display: 'flex', gap: 10 }}>
            <button onClick={onSpeak} className="tg-press" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '13px 0', borderRadius: 16, background: '#fff', border: '1.5px solid #ebe5de', cursor: 'pointer', ...TOUCH_OPT }}>
              <SpeakerHighIcon size={20} weight="fill" color={TG.SUCCESS_GLOW} />
              <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: '#2b2730' }}>발음 듣기</span>
            </button>
            <button onClick={onReveal} disabled={completed} className="tg-press" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '13px 0', borderRadius: 16, background: '#fff', border: '1.5px solid #ebe5de', cursor: completed ? 'default' : 'pointer', opacity: completed ? 0.5 : 1, ...TOUCH_OPT }}>
              <EyeIcon size={20} weight="fill" color="#767676" />
              <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14, color: '#2b2730' }}>정답 보기</span>
            </button>
          </div>
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
              <button onClick={onSkip} disabled={disabled} className="tg-press"
                aria-label={lives > 0 ? `건너뛰기 · 남은 ${lives}개 (1회 소모)` : '건너뛰기를 다 써서 넘길 수 없어요'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 14,
                  background: '#fff', border: '1.5px solid #ebe5de', cursor: disabled ? 'default' : 'pointer',
                  opacity: disabled ? 0.5 : 1, boxShadow: '0px 2px 6px rgba(43,39,48,0.05)', ...TOUCH_OPT }}>
                <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: '#2b2730' }}>건너뛰기</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} aria-hidden="true">
                  {[0, 1, 2].map((i) => {
                    const on = i < lives;
                    return (
                      <TicketIcon key={i} size={17} weight={on ? 'fill' : 'regular'} color={on ? TG.CORAL : '#d8d0c7'}
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
          <ToneButtons onTone={onTone} wrongBtn={wrongBtn} disabled={completed} />
        </Reveal>
      )}
      {/* 콤보 마일스톤 · 라이브 신기록 버스트(P4b) */}
      <CenterBurst data={burst} />
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
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, animation: 'tg-sudden 2.35s ease forwards' }}>
            <div style={{ width: 88, height: 88, borderRadius: 28, background: 'linear-gradient(135deg,#ff5e62,#b3050a)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 14px 40px rgba(179,5,10,0.55)' }}>
              <SkullIcon size={50} weight="fill" color="#fff" />
            </div>
            <span style={{ fontFamily: FONT_TITLE, fontSize: 42, lineHeight: 1, color: '#fff', textShadow: '0 3px 18px rgba(0,0,0,0.45)' }}>서든데스</span>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 16, color: 'rgba(255,255,255,0.92)', textShadow: '0 2px 10px rgba(0,0,0,0.4)' }}>한 번 틀리면 끝!</span>
          </div>
        </div>
      )}
    </div>
  );
}
