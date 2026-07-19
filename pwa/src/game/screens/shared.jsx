// 성조게임 화면 공통 빌딩블록 — 모든 화면 컴포넌트가 공유.
// 스타일 주입(ToneGameStyles)·반응형 컨테이너(FigmaScreen)·등장 래퍼(Reveal)·코치 말풍선·
// 단어 카드/성조 버튼·카운트다운 비주얼·토스트·흔들림 버튼.
// 참조 메모리: tone_game_redesign.md §5(단어카드)·§10-B(FigmaScreen)·§10-C(연출)
import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { LockSimpleIcon, CheckCircleIcon, SpeakerHighIcon, SpeakerSlashIcon, VibrateIcon, XIcon, CaretLeftIcon, StarIcon, EyeIcon } from '@phosphor-icons/react';
import { TG, FONT_HANZI, FONT_PINYIN, TYPE, SHADOW, DUR, TOUCH_OPT, TONE_TINTS, TONE_BORDERS, TONE_COLORS, ASSETS,
  haptic, isHapticMuted, setHapticMuted, RADIUS, SPACE } from '../tgTokens.js';
import { ToneMark, ComboChip } from '../tgWidgets.jsx';
import { TONES, DIFFICULTIES } from '../../constants/toneGameWords.js';
import { play as playSfx, isSfxMuted, setSfxMuted } from '../tgSfx.js';
import { classifyStroke } from '../toneDraw.js';

// 카운트다운 슬라이드 가장자리 진폭 폭(px) — keyframes(tg-cd-out)와 CdWaveEdge가 공유.
export const CD_WAVE_W = 12;

// 성조 발사체 타이밍(ms) — GameScreen(발사체)과 WordCard(착탄 동기 팝 지연)가 공유.
// 판정·점수는 탭 순간 즉시(연출 전용 지연). 시퀀스: 글자 근처 '뿅' 생성 → 제자리 둥실 → 직선 가속 착탄(사용자 확정안).
export const TONE_SHOT_HOVER_MS = 300; // 생성 후 정지 시간(1000은 너무 길다 — 사용자 튜닝 0.3초)
export const TONE_FLIGHT_MS = 160;      // 가속 직선 비행 시간
export const TONE_IMPACT_MS = TONE_SHOT_HOVER_MS + TONE_FLIGHT_MS; // 탭 → 착탄까지(글자 팝·히트스톱 동기 기준)

// 모션 최소화(접근성) — matchMedia 1회 조회 캐시. 장식성 파티클(ConfettiBurst·EmberRise) 생략 판단용.
let _reducedMotion = null;
export function prefersReducedMotion() {
  if (_reducedMotion === null) _reducedMotion = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  return _reducedMotion;
}

// 크리스프 플래시 — 카메라 플래시처럼 순간 확 밝아졌다 스냅오프. 글로우·번짐 없는 깔끔한 '번쩍'.
// radial=중심에서 부드럽게(카드 위 등), 아니면 꽉 찬 화이트. 비차단·CSS keyframe(짧음). 재발동은 부모 key 변경.
export function CrispFlash({ color = 'rgba(255,255,255,0.9)', dur = 0.17, radial = false, borderRadius = 0, zIndex = 24, style }) {
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, borderRadius, pointerEvents: 'none', zIndex,
      background: radial ? `radial-gradient(closest-side, ${color}, rgba(255,255,255,0))` : color,
      animation: `tg-crispflash ${dur}s ease-out forwards`, ...style }} />
  );
}

// 1D 부드러운 값 노이즈(-1..1) — 잉걸불 좌우 난류·밝기 깜빡임용(GameScreen ComboSparks와 동일 방식).
function emberNoise(x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  const h = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
  return (h(i) * (1 - u) + h(i + 1) * u) * 2 - 1;
}
// 잉걸불(rising ember) — 불꽃 위로 불티가 흔들리며 피어올라 깜빡이다 식어 사라짐(무한 루프).
// ★rAF+노이즈(CSS 직선 아님): 상승 중 좌우 난류(위로 갈수록↑)·부력·밝기 깜빡임 → 진짜 잉걸불 움직임. 부모 position:relative 필요.
export const EMBER_COLORS = ['#ff8f34', TG.SUN, '#ff6b3d', '#ffd98a', '#ff5e3a'];
// 래퍼 — 모션 최소화 설정이면 장식 파티클 생략(훅 없는 바깥에서 분기해 훅 규칙 안전).
export function EmberRise(props) {
  if (prefersReducedMotion()) return null;
  return <EmberRiseInner {...props} />;
}
function EmberRiseInner({ colors = EMBER_COLORS, count = 10, spread = 22, rise = 42, size = 3.4, zIndex = 0, style }) {
  const refs = useRef([]);
  const cfg = useRef(null);
  if (!cfg.current) {
    const R = Math.random;
    cfg.current = Array.from({ length: count }, () => ({
      x0: (R() - 0.5) * spread, amp: 2.5 + R() * 6.5, freq: 1.3 + R() * 2.4, seed: R() * 100,
      rise: rise * (0.72 + R() * 0.55), life: 1.5 + R() * 1.5, t: -R() * 3.2, sz: size * (0.7 + R() * 0.85),
      color: colors[(R() * colors.length) | 0],
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
        if (s.t >= s.life) s.t %= s.life;   // 루프(재점화)
        if (s.t < 0) { el.style.opacity = '0'; continue; }
        const t = s.t / s.life;
        const up = -s.rise * (1 - (1 - t) * (1 - t));                     // ease-out 상승
        const wob = emberNoise(s.seed + t * s.freq) * s.amp * (0.4 + t);  // 위로 갈수록 흔들림↑
        const env = Math.min(1, t * 6) * Math.max(0, 1 - Math.pow(t, 1.8)); // 페이드 인/아웃
        const flick = 0.5 + 0.5 * emberNoise(s.seed * 1.7 + t * s.freq * 3.4); // 밝기 깜빡임
        el.style.opacity = String(Math.max(0, env * flick));
        el.style.transform = `translate(${(s.x0 + wob).toFixed(1)}px, ${up.toFixed(1)}px) scale(${(1 - 0.5 * t).toFixed(2)})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, []);
  return (
    <div aria-hidden="true" style={{ position: 'absolute', left: '50%', bottom: '28%', width: 0, height: 0, pointerEvents: 'none', zIndex, ...style }}>
      {cfg.current.map((s, k) => (
        <span key={k} ref={(n) => { refs.current[k] = n; }} style={{
          position: 'absolute', left: 0, bottom: 0, width: s.sz, height: s.sz, marginLeft: -s.sz / 2,
          borderRadius: '50%', background: s.color, boxShadow: `0 0 ${4 + s.sz * 1.4}px ${(s.sz * 0.5).toFixed(1)}px ${s.color}`,
          opacity: 0, willChange: 'transform, opacity',
        }} />
      ))}
    </div>
  );
}

// 파티클 버스트(색종이) — 정답·축하 등 긍정 순간의 색종이 폭발. rAF 물리(초기 폭발+중력 포물선+공기저항+나풀거림+회전/3D플립).
// 빛 알갱이(글리터)도 이 컴포넌트에 흰/골드 팔레트(LIGHT_CONFETTI)·작은 size로 겹쳐 쓰면 동일한 물리로 움직임(별도 스파크 컴포넌트 폐기 — 촌스러움).
export const CONFETTI_COLORS = [TG.CORAL, TG.SUN, TG.SUCCESS_GLOW, '#4D8DFF', '#7c5cff', '#ff8f34'];
export const LIGHT_CONFETTI = ['#ffffff', '#fff6cf', '#ffe89a', '#ffd166', '#fff0f0']; // 흰/골드 글리터(빛 알갱이)
// 래퍼 — 모션 최소화 설정이면 장식 파티클 생략(훅 없는 바깥에서 분기해 훅 규칙 안전).
export function ConfettiBurst(props) {
  if (prefersReducedMotion()) return null;
  return <ConfettiBurstInner {...props} />;
}
function ConfettiBurstInner({ colors = CONFETTI_COLORS, count = 16, power = 1, size = 9, zIndex = 25, style }) {
  const refs = useRef([]);
  const cfg = useRef(null);
  if (!cfg.current) {
    const R = Math.random;
    cfg.current = Array.from({ length: count }, () => {
      const ang = R() * Math.PI * 2;                    // 360° 방사
      const speed = (3.0 + R() * 4.4) * power;           // 초기 폭발 속도(px/frame)
      const sz = size * (0.6 + R() * 0.85);
      return {
        x: 0, y: 0,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed - (1.7 + R() * 1.6) * power, // 위로 살짝 팝(축포 느낌)
        rot: R() * 360, vrot: (R() - 0.5) * 30,
        sway: 0.5 + R() * 1.9, swayPh: R() * 6.283, swaySpeed: 0.05 + R() * 0.11, // 나풀거림
        life: 64 + R() * 50, age: 0, sz, rect: R() < 0.62,
        color: colors[(R() * colors.length) | 0], flip: 5 + R() * 13, // rect=3D 회전(종이 뒤집힘)
      };
    });
  }
  useLayoutEffect(() => {
    let raf, alive = true, last = performance.now();
    const GRAV = 0.19, DRAG = 0.985;
    const tick = (now) => {
      if (!alive) return;
      const dt = Math.min(2.2, (now - last) / 16.667); last = now;
      let anyAlive = false;
      for (let k = 0; k < cfg.current.length; k++) {
        const el = refs.current[k]; const s = cfg.current[k]; if (!el) continue;
        s.age += dt;
        if (s.age < s.life) anyAlive = true;
        const drag = Math.pow(DRAG, dt);
        s.vx *= drag; s.vy = s.vy * drag + GRAV * dt;    // 공기저항 + 중력
        s.x += s.vx * dt; s.y += s.vy * dt;
        s.rot += s.vrot * dt;
        const lt = s.age / s.life;
        const op = lt < 0.1 ? lt / 0.1 : Math.max(0, 1 - Math.pow((lt - 0.1) / 0.9, 1.7));
        el.style.opacity = String(op);
        const swayX = Math.sin(s.age * s.swaySpeed + s.swayPh) * s.sway;
        const fl = s.rect ? ` rotateX(${(s.age * s.flip).toFixed(0)}deg)` : '';
        el.style.transform = `translate(${(s.x + swayX).toFixed(1)}px, ${s.y.toFixed(1)}px) rotate(${s.rot.toFixed(0)}deg)${fl}`;
      }
      if (anyAlive) raf = requestAnimationFrame(tick); // 전부 소멸하면 rAF 정지(perf)
    };
    raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, []);
  return (
    <div aria-hidden="true" style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, pointerEvents: 'none', zIndex, ...style }}>
      {cfg.current.map((s, k) => (
        <span key={k} ref={(n) => { refs.current[k] = n; }} style={{
          position: 'absolute', left: 0, top: 0, width: s.sz, height: s.rect ? s.sz * 0.5 : s.sz,
          marginLeft: -s.sz / 2, marginTop: -s.sz / 2, borderRadius: s.rect ? 1.5 : '50%', background: s.color,
          opacity: 0, willChange: 'transform, opacity',
        }} />
      ))}
    </div>
  );
}

// ── keyframes / 글로벌 게임 스타일 ─────────────────────
// FigmaScreen마다 <style>이 중복 주입돼 화면 전환 중 시트가 2벌 존재하던 것 → 모듈 로드 시 document.head에 1회만 주입.
const TONE_GAME_CSS = `
      @keyframes tg-shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-6px)} 40%{transform:translateX(6px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)} }
      @keyframes tg-pulse { 0%,100%{opacity:.35} 50%{opacity:.9} }
      @keyframes tg-heartbeat { 0%,100%{transform:scale(1)} 28%{transform:scale(1.2)} 42%{transform:scale(1)} 58%{transform:scale(1.12)} 72%{transform:scale(1)} }
      @keyframes tg-screenshake { 0%,100%{transform:translate(0,0)} 15%{transform:translate(-7px,2px)} 30%{transform:translate(6px,-2px)} 45%{transform:translate(-5px,1px)} 60%{transform:translate(4px,-1px)} 80%{transform:translate(-2px,0)} }
      @keyframes tg-punch { 0%{transform:scale(1)} 35%{transform:scale(var(--tg-punch-s,1.06))} 100%{transform:scale(1)} }
      /* 콤보 브레이크 — 콤보 칩이 기울며 떨어져 사라짐(상실 연출) + 가장자리 붉은 원샷 플래시 */
      @keyframes tg-combodrop { 0%{opacity:1; transform:translateY(0) rotate(0deg)} 18%{transform:translateY(-6px) rotate(-5deg)} 100%{opacity:0; transform:translateY(74px) rotate(17deg)} }
      @keyframes tg-redflash { 0%{opacity:0} 14%{opacity:1} 100%{opacity:0} }
      @keyframes tg-flash { 0%{opacity:0} 18%{opacity:.7} 100%{opacity:0} }
      @keyframes tg-fade-out { to { opacity:0 } }
      @keyframes tg-vignette { 0%,100%{opacity:.45} 50%{opacity:1} }
      @keyframes tg-card-in { 0%{opacity:0;transform:translateY(16px) scale(.965)} 100%{opacity:1;transform:translateY(0) scale(1)} }
      @keyframes tg-pop { 0%{transform:scale(.6);opacity:0} 60%{transform:scale(1.15)} 100%{transform:scale(1);opacity:1} }
      /* 착탄 임팩트 팝 — 이미 보이는 글자가 사라지지 않고 그 자리에서 튀어오름(발사체 착탄용, opacity 무변) */
      @keyframes tg-pop-impact { 0%{transform:scale(1)} 55%{transform:scale(1.24)} 100%{transform:scale(1)} }
      @keyframes tg-float { 0%{transform:translateY(0) scale(.9);opacity:0} 20%{opacity:1} 100%{transform:translateY(-28px) scale(1.05);opacity:0} }
      @keyframes tg-enter { 0%{transform:translateY(10px);opacity:0} 100%{transform:translateY(0);opacity:1} }
      @keyframes tg-count { 0%{transform:scale(.4);opacity:0} 45%{transform:scale(1.06);opacity:1} 100%{transform:scale(1);opacity:1} }
      @keyframes tg-touch { 0%,100%{opacity:.5} 50%{opacity:1} }
      @keyframes tg-ripple { 0%{transform:translate(-50%,-50%) scale(.5);opacity:.4} 70%{opacity:.1} 100%{transform:translate(-50%,-50%) scale(2);opacity:0} }
      @keyframes tg-bob { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
      @keyframes tg-hop { 0%,100%{transform:translateY(0)} 38%{transform:translateY(-15px)} }
      @keyframes tg-blinkeye { 0%,90%,100%{transform:scaleY(1)} 95%{transform:scaleY(.1)} }
      @keyframes tg-cta-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.018)} }
      /* 시작 버튼 강조(공용) — 스케일+글로우 호흡. 글로우 색은 --fab-glow(/-lg)로 파라미터화(기본=코랄). 테마 카드·난이도 카드 공용. */
      @keyframes tg-fab-pulse { 0%,100%{transform:scale(1); box-shadow:0 5px 12px var(--fab-glow,rgba(242,72,76,0.42))} 50%{transform:scale(1.09); box-shadow:0 7px 20px var(--fab-glow-lg,rgba(242,72,76,0.62))} }
      /* 채워진 성취 별 반짝임 — 주기 대부분은 평상, 끝자락에 밝아졌다 복귀(별마다 시차) */
      @keyframes tg-star-shine { 0%,70%,100%{filter:brightness(1)} 80%{filter:brightness(1.8) drop-shadow(0 0 5px rgba(255,194,60,0.9))} 90%{filter:brightness(1)} }
      @keyframes tg-dotpulse { 0%,100%{transform:scale(.85)} 50%{transform:scale(1.3)} }
      @keyframes tg-needme { 0%,68%,100%{transform:rotate(0)} 76%{transform:rotate(-6deg)} 84%{transform:rotate(6deg)} 92%{transform:rotate(-3deg)} }
      @keyframes tg-sheet-up { from{transform:translateY(100%)} to{transform:translateY(0)} }
      @keyframes tg-sheet-down { from{transform:translateY(0)} to{transform:translateY(100%)} }
      @keyframes tg-dim-in { from{opacity:0} to{opacity:1} }
      @keyframes tg-loadbar { from{width:0%} to{width:100%} }
      @keyframes tg-drift { 0%{transform:translateY(0);opacity:.0} 25%{opacity:.9} 75%{opacity:.9} 100%{transform:translateY(-26px);opacity:0} }
      @keyframes tg-dot { 0%,100%{transform:translateY(0);opacity:.4} 50%{transform:translateY(-6px);opacity:1} }
      @keyframes tg-cd-in { from{transform:translateX(100%)} to{transform:translateX(0)} }
      @keyframes tg-cd-out { from{transform:translateX(0)} to{transform:translateX(calc(-100% - ${CD_WAVE_W + 8}px))} }
      .tg-caret::after { content:'|'; margin-left:1px; opacity:.8; animation: tg-blink .8s step-end infinite }
      @keyframes tg-blink { 50%{opacity:0} }
      @keyframes tg-timer { from{width:100%} to{width:0%} }
      @keyframes tg-rise { from{opacity:0; transform:translateY(14px)} to{opacity:1; transform:translateY(0)} }
      @keyframes tg-toast { 0%{opacity:0; transform:translateY(8px)} 12%{opacity:1; transform:translateY(0)} 86%{opacity:1; transform:translateY(0)} 100%{opacity:0; transform:translateY(-4px)} }
      /* 타이틀 로고 효과 */
      @keyframes tg-logo-pop { 0%{opacity:0; transform:scale(.7)} 60%{opacity:1; transform:scale(1.05)} 100%{opacity:1; transform:scale(1)} }
      /* 브랜드 스플래시 컷(제작사 오프닝) — 페이드 인 → 유지 → 페이드 아웃 */
      @keyframes tg-brandcut { 0%{opacity:0; transform:scale(.94)} 22%{opacity:1; transform:scale(1)} 78%{opacity:1; transform:scale(1)} 100%{opacity:0; transform:scale(1.02)} }
      @keyframes tg-shine { 0%{background-position:160% 0} 22%{background-position:-60% 0} 100%{background-position:-60% 0} }
      @keyframes tg-sparkle { 0%,100%{opacity:0; transform:scale(0) rotate(0deg)} 50%{opacity:1; transform:scale(1) rotate(45deg)} }
      /* 첫 게임 논블로킹 힌트 — 페이드 인 → 유지 → 페이드 아웃(1회, 타이머 방해 없음) */
      @keyframes tg-hint { 0%{opacity:0; transform:translateY(-5px)} 12%{opacity:1; transform:translateY(0)} 84%{opacity:1; transform:translateY(0)} 100%{opacity:0; transform:translateY(-3px)} }
      /* 콤보 불티 — rAF+노이즈로 JS에서 갱신(GameScreen ComboSparks). 여기선 외곽 글로우 플리커만. */
      @keyframes tg-emberflicker { 0%,100%{opacity:1} 42%{opacity:.66} 68%{opacity:.9} }
      /* 크리스프 플래시 — 카메라 플래시처럼 순간 확 밝아졌다 스냅오프(글로우·번짐 없이 깔끔한 '번쩍') */
      @keyframes tg-crispflash { 0%{opacity:0} 9%{opacity:1} 100%{opacity:0} }
      /* 현재 글자 은은한 숨쉬기(색 대신 명도+애니로 강조) */
      @keyframes tg-breathe { 0%,100%{transform:scale(1)} 50%{transform:scale(1.07)} }
      /* 연음 마크 — 정답 순간 획이 그려지고(반3성→2성 이어짐) 화살촉이 뒤이어 나타남 */
      @keyframes tg-lianyin-draw { from{stroke-dashoffset:100} to{stroke-dashoffset:0} }
      @keyframes tg-lianyin-in { to{opacity:1} }
      .tg-lianyin-stroke{ stroke-dasharray:100; stroke-dashoffset:100; animation: tg-lianyin-draw .5s ease-out .12s forwards }
      .tg-lianyin-barb{ opacity:0; animation: tg-lianyin-in .16s ease-out .58s forwards }
      @media (prefers-reduced-motion: reduce){ .tg-lianyin-stroke{ stroke-dashoffset:0; animation:none !important } .tg-lianyin-barb{ opacity:1; animation:none !important } }
      /* 3성 변조 — 칩이 뒤집히듯 2성으로 팝(변화를 확실히 '느끼게') + 위로 뜨는 '→ 2성' 큐 */
      @keyframes tg-sandhi-pop { 0%{transform:rotateX(82deg) scale(.82)} 55%{transform:rotateX(0) scale(1.22)} 78%{transform:scale(.96)} 100%{transform:scale(1)} }
      @keyframes tg-sandhi-cue { 0%{opacity:0;transform:translate(-50%,6px) scale(.85)} 22%{opacity:1;transform:translate(-50%,-7px) scale(1.05)} 70%{opacity:1;transform:translate(-50%,-12px)} 100%{opacity:0;transform:translate(-50%,-26px)} }
      .tg-reveal{ animation: tg-rise .4s cubic-bezier(.22,1,.36,1) both }
      .tg-toast{ animation: tg-toast 1.7s ease both }
      @media (prefers-reduced-motion: reduce){ .tg-reveal{ animation: none !important } }
      .tg-shake{ animation: tg-shake .42s ease }
      .tg-enter{ animation: tg-enter .36s cubic-bezier(.22,1,.36,1) both }
      /* 누를 땐 빠르게 쏙 들어가고(.09s), 뗄 땐 살짝 튕기며 부드럽게 복귀(back-out 스프링) */
      .tg-press{ transition: transform .28s cubic-bezier(0.34,1.56,0.64,1) }
      .tg-press:active{ transform: scale(.95); transition: transform .09s ease-out }
      .tg-root, .tg-root *, .tg-root *::before, .tg-root *::after { box-sizing: border-box; }
      .tg-noscroll::-webkit-scrollbar { display: none; }
`;
let tgStylesInjected = false;
function injectToneGameStyles() {
  if (tgStylesInjected || typeof document === 'undefined') return;
  tgStylesInjected = true;
  const el = document.createElement('style');
  el.dataset.tgStyles = '1';
  el.textContent = TONE_GAME_CSS;
  document.head.appendChild(el);
}
injectToneGameStyles(); // import 시 1회 주입

// 호환용 no-op — 기존 <ToneGameStyles /> 사용처(FigmaScreen·랩)는 그대로 두되 실제 주입은 위에서 1회만.
export function ToneGameStyles() {
  return null;
}

// ── 반응형 화면 컨테이너 ────────────────────────────────
// 전체 높이 컬럼(최대폭 600, 가운데). 요소는 absolute로 상단=top / 하단=bottom 앵커 + left/right로 폭 채움.
// → 화면 폭이 넓어지면 요소가 넓어지고, 세로가 길어지면 상단·하단이 벌어지며 채워짐(잘림 없음).
// 상단 safe-area: 컬럼을 노치 아래에서 시작(top=safe-top)시켜 상단 요소(top:20 등)가 상태바에 안 가리게.
//   배경(bgImage)은 root(inset:0)라 노치까지 덮음. 하단은 각 CTA가 env(safe-area-inset-bottom)로 개별 처리.
export function FigmaScreen({ children, bg = TG.BG, bgImage }) {
  return (
    <div className="tg-root" style={{ position: 'fixed', inset: 0, background: bg, overflow: 'hidden' }}>
      <ToneGameStyles />
      {/* 배경을 화면 전체에 깔아 여백까지 채움 */}
      {bgImage && <img src={bgImage} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />}
      <div style={{ position: 'absolute', top: 'env(safe-area-inset-top)', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 600 }}>
        {children}
      </div>
    </div>
  );
}

// ── 순차 등장 래퍼 ─────────────────────────────────────
// 바깥 div = 기존 위치/정렬(absolute·translateX 등) 그대로, 안쪽 div = 아래서 페이드업(tg-rise).
// → 정렬 transform과 등장 transform이 다른 노드라 충돌 없음. i 순서대로 시차(base+i*step ms).
// play=false면 숨김 유지(opacity0) — 게임화면처럼 '특정 시점부터' 등장시킬 때 사용.
export function Reveal({ i = 0, base = 80, step = 70, play = true, style, children }) {
  return (
    <div style={style}>
      <div className={play ? 'tg-reveal' : undefined}
        style={play ? { animationDelay: `${base + i * step}ms` } : { opacity: 0 }}>
        {children}
      </div>
    </div>
  );
}

// 뒤로가기(공용) — 원/배경 없이 아이콘만. 40x40 탭 영역만 유지(히트영역). 게임 화면 헤더/단독 뒤로가기에 공용.
export function BackButton({ onClick, style }) {
  return (
    <button onClick={onClick} aria-label="뒤로" className="tg-press" style={{
      width: 40, height: 40, marginLeft: -8, borderRadius: RADIUS.xl, background: 'none', boxShadow: 'none',
      border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT, ...style,
    }}>
      <CaretLeftIcon size={24} weight="bold" color={TG.INK} />
    </button>
  );
}

// 게임 화면 공용 헤더 — 상단 고정 뒤로가기 + 타이틀 + 우측 슬롯(옵션). 모드·테마·난이도·등급·업적 등 공통.
//   솔리드 바가 상태바(노치)까지 덮음: 바는 FigmaScreen 콘텐츠(세이프에어리어만큼 내려옴) 위로 -inset만큼 끌어올려 채운다.
//   52px 밴드에 40px 내용 세로중앙(위아래 6). 타이틀은 넘치면 말줄임. 바(z3, DOM 먼저)>스크롤러(z2), 내용(z3, 나중)이 바 위.
export function GameHeader({ title, onBack, right = null, bg = '#fff' }) {
  return (
    <>
      <div aria-hidden="true" style={{
        position: 'absolute', top: 'calc(-1 * env(safe-area-inset-top))', left: 0, right: 0,
        height: 'calc(52px + env(safe-area-inset-top))', zIndex: 3, pointerEvents: 'none',
        background: bg, borderBottom: '1px solid rgba(43,39,48,0.06)',
      }} />
      <Reveal i={0} style={{ position: 'absolute', left: 24, top: 6, right: 24, zIndex: 3 }}>
        <div style={{ height: 40, display: 'flex', gap: SPACE.md, alignItems: 'center' }}>
          <BackButton onClick={onBack} />
          <span style={{ flex: 1, minWidth: 0, ...TYPE.head, color: TG.INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
          {right}
        </div>
      </Reveal>
    </>
  );
}

// 풀폭 CTA 버튼(공용) — 그라디언트+가운데 콘텐츠. 색/그림자/높이/반경은 prop(기본=코랄). children=아이콘+라벨.
export function PrimaryButton({ onClick, children, height = 56, radius = 18, background = TG.CORAL_GRAD, shadow = '0px 10px 20px rgba(242,72,76,0.32)', disabled = false, style }) {
  return (
    <button className="tg-press" onClick={onClick} disabled={disabled} style={{
      width: '100%', height, borderRadius: radius, border: 'none', cursor: disabled ? 'default' : 'pointer',
      background, boxShadow: shadow, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.md, ...TOUCH_OPT, ...style,
    }}>
      {children}
    </button>
  );
}

// 별 진행 행(공용) — 채운 별(filled개)/빈 별. 크기·간격·색·샤인 애니(테마 카드)·컨테이너 style 파라미터화.
export function StarRow({ filled = 0, total = 3, size = 16, gap = 3, on = TG.SUN, off = '#e2dccf', shine = false, style }) {
  return (
    <div style={{ display: 'flex', gap, alignItems: 'center', ...style }}>
      {Array.from({ length: total }, (_, i) => {
        const f = i < filled;
        return (
          <span key={i} style={{ display: 'flex', animation: (shine && f && !prefersReducedMotion()) ? `tg-star-shine 2.8s ease-in-out ${i * 0.3}s infinite` : 'none' }}>
            <StarIcon size={size} weight="fill" color={f ? on : off} />
          </span>
        );
      })}
    </div>
  );
}

// 공용 모달 셸 — 고정 딤 오버레이(백드롭 탭 닫기) + tg-enter 카드. 게임 모달들의 동일한 껍데기를 통일.
//   기본값 = 표준 안내 모달(322·radius28·padding28/24/20·gap16·가운데정렬). 차이나는 모달은 prop으로 오버라이드.
export function ModalCard({ onClose, zIndex = 60, maxWidth = 322, radius = 28, padding = '28px 24px 20px', gap = 16, align = 'center', children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex, background: 'rgba(26,16,20,0.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: SPACE.x4, ...TOUCH_OPT }}>
      <div className="tg-enter" onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth, background: TG.CARD, borderRadius: radius, padding,
        boxShadow: '0 20px 50px rgba(26,16,20,0.3)', display: 'flex', flexDirection: 'column', alignItems: align, gap,
      }}>
        {children}
      </div>
    </div>
  );
}

// 코치 말풍선 (Figma 다이얼로그 구조)
// 타이핑 연출 — 글자 하나씩 노출, 탭하면 즉시 완성
export function useTypewriter(text, speed = 35) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(0);
    if (!text) return undefined;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setCount(i);
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  const done = count >= (text ? text.length : 0);
  return [text ? text.slice(0, count) : '', done, () => setCount(text ? text.length : 0)];
}

export function CoachBubble({ text }) {
  const [shown, done, skip] = useTypewriter(text);
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {/* 판다·말풍선 분리 — 같은 주기(3s)에 고정 위상차(-1s)만. 항상 일정 간격으로 따라다녀 깔끔 */}
      <img src={ASSETS.pandaCoach} width={73} height={63} alt="" style={{ flexShrink: 0, filter: 'drop-shadow(0px 4px 10px rgba(43,39,48,0.08))', animation: 'tg-bob 3s ease-in-out infinite', animationDelay: '-1s' }} />
      <div style={{ position: 'relative', marginLeft: 8.8, animation: 'tg-bob 3s ease-in-out infinite' }}>
        <div onClick={(e) => { if (!done) { e.stopPropagation(); skip(); } }} style={{ background: '#3c3c3c', padding: '10px 14px', borderRadius: RADIUS.md, cursor: done ? 'default' : 'pointer' }}>
          <span className={done ? '' : 'tg-caret'} style={{ ...TYPE.sub, color: '#fff', whiteSpace: 'nowrap' }}>{shown}</span>
        </div>
        {/* 꼬리 — Figma 벡터(41:39) 그대로, 회전 없음(이미 왼쪽 향함). 말풍선 좌측 -8.8px·top 9.27 (Figma 절대좌표) */}
        <span style={{ position: 'absolute', left: -8.8, top: 9.27, lineHeight: 0 }}>
          <svg width="12" height="16" viewBox="0 0 12 15" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0.19488 1.59069C-0.28873 0.93007 0.18306 0 1.00178 0L10.076 0C10.6282 0 11.076 0.447715 11.076 1L11.076 13.3955C11.076 14.3624 9.84019 14.7664 9.26906 13.9862L0.19488 1.59069Z" fill="#3C3C3C" />
          </svg>
        </span>
      </div>
    </div>
  );
}

// ── 단어 카드 (반응형 + 고정 슬롯, 메모리 §5) ──────────
// 연음(반3성) 마크 — 하늘쌤 판서 이음 기호. 좌우 대칭 ˇ(3성) + 오른쪽 화살촉으로
// "반만 내렸다 2성으로 이어짐"을 나타낸다. 정답 순간 두 글자 위에 그려져 규칙을 각인.
export const LIANYIN_COLOR = '#7c5cff';
export function LianyinMark({ width = 108, color = LIANYIN_COLOR, stroke = 7, animate = true }) {
  return (
    <svg width={width} height={width * 48 / 80} viewBox="22 8 80 48" fill="none" aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
      <path d="M 30 20 L 60 47 L 94 16" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={animate ? 'tg-lianyin-stroke' : ''} />
      <path d="M 94 16 L 92 31 M 94 16 L 79 17" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={animate ? 'tg-lianyin-barb' : ''} />
    </svg>
  );
}

// 3성 변조 칩 — 3성+3성에서 앞 3성이 발음상 2성으로 바뀜(你好 nǐ→ní hǎo). 완성 후 3성 칩을 잠깐 보여준 뒤
// 마크(ˇ→／)·칩 색·라벨을 2성으로 모프해 규칙을 가르친다. 표기·정답 키는 3성 원형 유지(연출 전용, 채점 무관).
function SandhiToneChip({ big = false }) {
  const [to2, setTo2] = useState(false);
  useEffect(() => {
    if (prefersReducedMotion()) { setTo2(true); return undefined; }
    const t = setTimeout(() => setTo2(true), 1000); // 정답 연출(3성)이 먼저 인식된 뒤 → 별도 비트로 2성 변조(교육 단어 dwell 2.4s가 이걸 수용)
    return () => clearTimeout(t);
  }, []);
  const ms = big ? 16 : 13;
  const reduce = prefersReducedMotion();
  const c3 = TONES.find((t) => t.num === 3)?.color ?? TG.INK;
  const c2 = TONES.find((t) => t.num === 2)?.color ?? TG.INK;
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
      {/* 변조 순간 위로 뜨는 큐 — 변화를 놓치지 않게 */}
      {to2 && !reduce && (
        <span aria-hidden="true" style={{ position: 'absolute', bottom: '108%', left: '50%', whiteSpace: 'nowrap',
          ...TYPE.labelSm, fontSize: big ? 12 : 11, fontWeight: 800, color: c2, animation: 'tg-sandhi-cue 1.1s ease-out forwards', pointerEvents: 'none' }}>→ 2성</span>
      )}
      <span key={to2 ? '2' : '3'} style={{ display: 'inline-flex', alignItems: 'center', gap: SPACE.xs, padding: '3px 8px', borderRadius: RADIUS.pill,
        background: to2 ? c2 : c3, color: '#fff', transition: 'background .35s ease', transformStyle: 'preserve-3d',
        animation: reduce ? 'none' : (to2 ? 'tg-sandhi-pop .52s cubic-bezier(.34,1.7,.5,1) both' : 'tg-pop .3s cubic-bezier(.34,1.56,.64,1) both') }}>
        <ToneMark tone={to2 ? 2 : 3} size={ms} />
        <span style={{ ...TYPE.labelSm, fontSize: big ? 12 : 10 }}>{to2 ? '2성' : '3성'}</span>
      </span>
    </span>
  );
}

export function WordCard({ word, entered, currentSyl, completed, timedOut, progressText, combo, comboFlash, floatScore, hideProgress, listen = false, audioOff = false, onReplay, onCantHear, onHint, hintUsed = false, draw = false, lianyinAt = -1, practice = false, onSpeak, onReveal, sandhiAt = -1 }) {
  const listening = listen && !audioOff && !completed && !timedOut; // 듣기 모드: 답하기 전엔 한자 가리고 소리 패널
  // 한자 모드 발음 힌트 — 답하기 전에만, 음소거 아닐 때만. 소리=정답이라 처음 쓰면 콤보가 끊긴다(hintUsed=이미 끊긴 상태면 무료).
  const canHint = onHint && !listening && !completed && !timedOut && !audioOff;
  const n = word.tones.length;
  let hz, colW, gap, twoRow = false, perRow = n;
  if (n <= 4) { hz = 66; colW = 72; gap = 14; }
  else if (n === 5) { hz = 44; colW = 52; gap = 8; }
  else { hz = 36; colW = 44; gap = 8; twoRow = true; perRow = Math.ceil(n / 2); }

  const glow = completed && !timedOut ? SHADOW.correctGlow : timedOut ? SHADOW.timeoutGlow : SHADOW.card;
  const guide = completed && !timedOut ? { text: '정답', color: TG.SUCCESS }
    : timedOut ? { text: '시간초과', color: TG.DANGER }
    : { text: `${currentSyl + 1}번째 글자의 성조를 ${draw ? '그려보세요' : '누르세요'}`, color: TG.GUIDE };

  // 발사체 착탄 동기 — 공개 팝을 착탄 시점(생성 정지+비행)만큼 지연해 '마크가 부딪히는 순간 채워지는' 인과로 보이게.
  // 그리기 문제(발사체 없음)·모션 최소화는 즉시 공개(기존 동작).
  const popDelay = (!draw && !prefersReducedMotion()) ? `${TONE_IMPACT_MS}ms` : '0ms';
  const Syllable = (i) => {
    const revealed = i < entered.length;
    const tone = revealed ? entered[i] : null;
    const toneColor = tone != null ? (TONES.find((t) => t.num === tone)?.color ?? TG.INK) : TG.INK;
    const isCurrent = i === currentSyl && !completed;
    // 연음 쌍(3성·2성)은 완성 시 성조칩을 숨기고 그 자리에 연음 마크를 얹는다(칩과 겹침 방지).
    const inLianyin = completed && lianyinAt >= 0 && (i === lianyinAt || i === lianyinAt + 1);
    // 3성 변조 글자(3+3의 앞 3성) — 완성 시 성조칩이 3성→2성으로 모프.
    const isSandhi = completed && sandhiAt >= 0 && i === sandhiAt && !inLianyin;
    return (
      <div key={i} style={{ width: colW, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.xs }}>
        <div style={{ height: hz > 50 ? 34 : 26, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {inLianyin ? null : isSandhi ? (
            <SandhiToneChip big={hz > 50} />
          ) : revealed ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: SPACE.xs, padding: '3px 8px', borderRadius: RADIUS.pill,
              background: toneColor, color: '#fff', animation: `tg-pop .3s cubic-bezier(.34,1.56,.64,1) ${popDelay} both`,
            }}>
              <ToneMark tone={tone} size={hz > 50 ? 16 : 13} />
              <span style={{ ...TYPE.labelSm, fontSize: hz > 50 ? 12 : 10 }}>{tone === 0 ? '경' : `${tone}성`}</span>
            </span>
          ) : (
            <div style={{
              width: hz > 50 ? 28 : 22, height: 5, borderRadius: RADIUS.pill,
              background: isCurrent ? TG.INK : TG.BORDER, // 현재 글자 표시 — 색 대신 진한 명도로(톤 색과 안 겹치게)
              animation: isCurrent ? 'tg-pulse 1.1s ease-in-out infinite' : 'none',
            }} />
          )}
        </div>
        {listening && !revealed ? (
          // 듣기 중 미공개 글자 — 스피커. 현재 글자 강조는 색 대신 명도+애니(중립 배경·진한 아이콘·breathe), 미도래는 연하게. 맞히면 아래 한자로 공개됨
          <div data-syl={i} style={{ width: hz, height: hz, borderRadius: RADIUS.lg, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: isCurrent ? '#f2ede6' : 'transparent',
            border: isCurrent ? '2px solid #e3dbce' : '2px solid transparent',
            animation: isCurrent ? 'tg-breathe 1.7s ease-in-out infinite' : 'none', transition: `all ${DUR.state} ease` }}>
            <SpeakerHighIcon size={Math.round(hz * 0.52)} weight="fill" color={isCurrent ? TG.INK : TG.MUTED} />
          </div>
        ) : (
          <div data-syl={i} style={{
            fontFamily: FONT_HANZI, fontWeight: 700, fontSize: hz, lineHeight: 1.05,
            // 강조는 색 대신 명도+애니: 현재=진한 잉크(은은한 breathe), 아직 안 푼 글자=연한 회색, 완료=성조색(착탄 동기 지연).
            // 이미 보이는 글자는 사라지면 안 됨 → 임팩트 팝(opacity 무변)+색 전환 지연. 듣기 모드는 글자가 '새로 등장'이라 기존 숨김 팝.
            color: revealed ? toneColor : (isCurrent ? TG.INK : TG.MUTED),
            transition: `color ${DUR.state} ease ${revealed && !listen ? popDelay : '0ms'}`,
            animation: revealed
              ? `${listen ? 'tg-pop' : 'tg-pop-impact'} .32s cubic-bezier(.34,1.56,.64,1) ${popDelay} both`
              : (isCurrent ? 'tg-breathe 1.7s ease-in-out infinite' : 'none'),
          }}>{word.hanzi[i] ?? ''}</div>
        )}
        <div style={{ height: hz > 50 ? 26 : 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {completed && (
            <span style={{ fontFamily: FONT_PINYIN, fontWeight: 600, fontSize: hz > 50 ? 17 : 14, color: TG.SUB,
              animation: timedOut ? 'none' : `tg-pop .3s cubic-bezier(.34,1.56,.64,1) ${popDelay} both` }}>{word.pinyin[i] ?? ''}</span>
          )}
        </div>
      </div>
    );
  };

  const cols = Array.from({ length: n }, (_, i) => i);
  const rows = twoRow ? [cols.slice(0, perRow), cols.slice(perRow)] : [cols];
  // 연음(반3성) 마크 — 완성 순간 3성+2성 두 글자 위(성조칩 자리)에 걸치게. 단일 행에서만.
  const step = colW + gap;
  const totalW = n * colW + (n - 1) * gap;
  const showLianyin = completed && !timedOut && lianyinAt >= 0 && lianyinAt + 1 < n && !twoRow;
  const showSandhi = completed && !timedOut && sandhiAt >= 0;
  const lyOffset = showLianyin ? (lianyinAt * step + colW / 2 + step / 2 - totalW / 2) : 0;
  const lyW = colW + Math.round(gap) + 22;

  return (
    <div style={{
      position: 'relative', background: TG.CARD, borderRadius: RADIUS.card, width: '100%', height: 292, padding: SPACE.x3, overflow: 'hidden',
      display: 'flex', flexDirection: 'column', boxShadow: glow, transition: `box-shadow ${DUR.state} ease`,
    }}>
      {!hideProgress && (
        <div style={{ position: 'absolute', left: 16, top: 16, ...TYPE.num, fontSize: 16, display: 'flex', gap: SPACE.xs, alignItems: 'center' }}>
          <span style={{ color: TG.CORAL_DK }}>{progressText.split('/')[0]}</span>
          {/* 분모(총 문제수)는 있을 때만 — 무한모드는 숫자만이라 '/ ' 안 보이게 */}
          {progressText.split('/')[1] && <span style={{ color: TG.SUB, fontSize: 14 }}>/ {progressText.split('/')[1]}</span>}
        </div>
      )}
      <div style={{ position: 'absolute', right: 16, top: 14 }}><ComboChip combo={combo} flash={comboFlash} /></div>
      {floatScore && (
        <div style={{
          position: 'absolute', right: 20, top: 44, zIndex: 2, ...TYPE.numMd, fontSize: 22,
          color: TG.SUCCESS, animation: 'tg-float 1.3s ease-out forwards', pointerEvents: 'none',
        }}>{floatScore}</div>
      )}
      {/* 뜻 — 듣기 중엔 가림(완료 시 공개="아 이 말이었구나") */}
      <div style={{ height: 22, marginTop: SPACE.md, textAlign: 'center', flexShrink: 0 }}>
        {!listening && <span style={{ ...TYPE.sub, color: TG.SUB }}>{word.meaning}</span>}
      </div>
      {/* 음절 — 듣기 중 미공개 글자는 스피커, 맞히면 한자 공개 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: SPACE.sm }}>
        {rows.map((row, ri) => (
          <div key={ri} style={{ position: 'relative', display: 'flex', justifyContent: 'center', gap }}>
            {row.map((i) => Syllable(i))}
            {showLianyin && ri === 0 && (
              <div style={{ position: 'absolute', top: -8, left: `calc(50% + ${lyOffset}px)`, transform: 'translateX(-50%)', pointerEvents: 'none', zIndex: 3 }}>
                <LianyinMark width={lyW} />
              </div>
            )}
          </div>
        ))}
      </div>
      {/* 하단 — 듣기면 안내 + 다시듣기/못들어요, 아니면 가이드 */}
      {listening ? (
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.md, paddingTop: SPACE.xxs }}>
          <span style={{ ...TYPE.labelSm, color: TG.GUIDE }}>{`${currentSyl + 1}번째 글자의 성조를 들어보세요`}</span>
          <div style={{ display: 'flex', gap: SPACE.md }}>
            <button onClick={onReplay} className="tg-press" style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, padding: '10px 16px', borderRadius: RADIUS.lg, background: '#fff', border: `1.5px solid ${TG.CORAL_BG}`, cursor: 'pointer', ...TOUCH_OPT }}>
              <SpeakerHighIcon size={17} weight="fill" color={TG.CORAL_DK} />
              <span style={{ ...TYPE.labelSm, color: TG.INK }}>다시 듣기</span>
            </button>
            <button onClick={onCantHear} className="tg-press" style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, padding: '10px 16px', borderRadius: RADIUS.lg, background: '#fff', border: '1.5px solid #ebe5de', cursor: 'pointer', ...TOUCH_OPT }}>
              <SpeakerSlashIcon size={17} weight="fill" color="#767676" />
              <span style={{ ...TYPE.labelSm, color: TG.INK }}>지금은 못 들어요</span>
            </button>
          </div>
        </div>
      ) : (
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.sm, minHeight: 28, justifyContent: 'center' }}>
          <span key={guide.text} style={{ ...TYPE.label, color: guide.color, transition: `color ${DUR.state} ease`,
            // '정답'은 착탄 순간 등장(발사체 동기) — 진행 안내·시간초과는 즉시
            animation: (completed && !timedOut) ? `tg-pop .25s cubic-bezier(.34,1.56,.64,1) ${popDelay} both` : 'none' }}>{guide.text}</span>
          {showSandhi && (
            <span style={{ ...TYPE.labelSm, color: TONES.find((t) => t.num === 2)?.color ?? TG.SUB }}>3성+3성 → 앞은 2성으로 발음</span>
          )}
          {showLianyin && (
            <span style={{ ...TYPE.labelSm, color: LIANYIN_COLOR }}>연음 · 3성+2성은 반3성으로 이어서</span>
          )}
          {practice ? (
            /* 트레이닝 — 발음 듣기 / 정답 보기 (일반 모드 발음힌트와 같은 카드 하단 자리로 통일). 트레이닝은 콤보·점수 없어 무페널티 */
            <div data-coach="prac-actions" style={{ display: 'flex', gap: SPACE.md, marginTop: SPACE.xxs }}>
              <button onClick={onSpeak} className="tg-press" aria-label="발음 듣기" style={{
                display: 'inline-flex', alignItems: 'center', gap: SPACE.sm, padding: '8px 14px', borderRadius: RADIUS.lg,
                background: '#fff', border: `1.5px solid ${TG.CORAL_BG}`, cursor: 'pointer', ...TOUCH_OPT,
              }}>
                <SpeakerHighIcon size={16} weight="fill" color={TG.CORAL_DK} />
                <span style={{ ...TYPE.labelSm, color: TG.INK }}>발음 듣기</span>
              </button>
              <button onClick={onReveal} disabled={completed} className="tg-press" aria-label="정답 보기" style={{
                display: 'inline-flex', alignItems: 'center', gap: SPACE.sm, padding: '8px 14px', borderRadius: RADIUS.lg,
                background: '#fff', border: '1.5px solid #ebe5de', cursor: completed ? 'default' : 'pointer', opacity: completed ? 0.5 : 1, ...TOUCH_OPT,
              }}>
                <EyeIcon size={16} weight="fill" color={TG.SUB} />
                <span style={{ ...TYPE.labelSm, color: TG.INK }}>정답 보기</span>
              </button>
            </div>
          ) : canHint ? (
            <button onClick={onHint} className="tg-press" aria-label={hintUsed ? '발음 다시 듣기' : '발음 힌트 듣기 (콤보가 끊겨요)'} style={{
              display: 'inline-flex', alignItems: 'center', gap: SPACE.sm, padding: '7px 13px', borderRadius: RADIUS.md,
              background: '#fff', border: `1.5px solid ${hintUsed ? TG.BORDER : TG.CORAL_BG}`, cursor: 'pointer', ...TOUCH_OPT,
            }}>
              <SpeakerHighIcon size={15} weight="fill" color={hintUsed ? TG.SUB : TG.CORAL_DK} />
              <span style={{ ...TYPE.labelSm, color: hintUsed ? TG.SUB : TG.INK }}>
                {hintUsed ? '다시 듣기' : '발음 힌트'}
              </span>
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── 성조 버튼 5개 (성조색 소프트 틴트 배경) ────────────
// heat(0~1, 콤보 고조) — 리플이 콤보와 함께 커져 타격감이 자람.
export function ToneButtons({ onTone, wrongBtn, disabled, heat = 0 }) {
  const [ripple, setRipple] = useState(null); // { num, key } — 탭 순간 성조색 리플
  const seqRef = useRef(0);
  const downRef = useRef({ num: null, at: 0 }); // 직전 pointerdown 판정 기록 — 뒤따르는 click 중복 실행 방지
  const handle = (num) => { seqRef.current += 1; setRipple({ num, key: seqRef.current }); onTone(num); };
  // 손가락이 닿는 순간(pointerdown) 바로 판정 — 뗄 때(click) 판정보다 체감 반응이 빠름.
  const handleDown = (e, num) => {
    if (disabled) return;
    if (e.button != null && e.button !== 0) return; // 우클릭 등 주 버튼 외 무시
    downRef.current = { num, at: performance.now() };
    handle(num);
  };
  // click은 키보드(Enter/Space) 접근성 경로 유지 — 직전 400ms 내 같은 버튼 pointerdown이 이미 처리했으면 무시.
  const handleClick = (num) => {
    if (disabled) return;
    const d = downRef.current;
    if (d.num === num && performance.now() - d.at < 400) return;
    handle(num);
  };
  return (
    <div style={{ display: 'flex', gap: SPACE.lg, height: 81, alignItems: 'stretch' }}>
      {TONES.map((t) => {
        const isWrong = wrongBtn === t.num;
        return (
          <button
            key={t.num} onPointerDown={(e) => handleDown(e, t.num)} onClick={() => handleClick(t.num)} disabled={disabled} aria-label={t.name} data-nosfx="true"
            className={`tg-press ${isWrong ? 'tg-shake' : ''}`}
            style={{
              position: 'relative', overflow: 'hidden',
              flex: 1, minWidth: 0, height: '100%', cursor: disabled ? 'default' : 'pointer', borderRadius: RADIUS.xl,
              background: isWrong ? '#FFD9D9' : TONE_TINTS[t.num],
              border: `1.5px solid ${isWrong ? TG.DANGER : TONE_BORDERS[t.num]}`,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: SPACE.xs,
              paddingTop: SPACE.x2, paddingBottom: SPACE.xl, color: t.color, ...TOUCH_OPT,
            }}
          >
            {/* 탭 순간 성조색 리플 — 타격감 + 성조-색 각인 */}
            {ripple && ripple.num === t.num && (
              <span key={ripple.key} aria-hidden="true" style={{
                position: 'absolute', left: '50%', top: '50%', width: 90 + heat * 50, height: 90 + heat * 50, borderRadius: '50%',
                background: t.color, animation: 'tg-ripple .5s ease-out forwards', pointerEvents: 'none', zIndex: 0,
              }} />
            )}
            <ToneMark tone={t.num} size={34} />
            <span style={{ position: 'relative', zIndex: 1, ...TYPE.labelSm, color: t.color }}>{t.name}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── 그리기 패드 ('그려서 답하기' 문제) ──────────────────
// 손가락/마우스로 성조 곡선을 그으면 classifyStroke가 1~4성으로 판별해 onDraw로 넘김(→ 기존 handleTone 재사용).
// 성조 버튼을 대체. Pointer Events라 터치·마우스 공용. 힌트 없음(빈 캔버스 + 안내 문구만).
// expectedTone: 현재 음절의 정답 성조 — '떼는 순간' 로컬 플래시(초록/빨강) 색만 결정(그리기 전엔 안 보임 = 힌트 아님).
// resetKey: 값이 바뀌면(음절/단어 전환) 획 초기화.
export function DrawPad({ expectedTone, onDraw, disabled = false, resetKey = 0 }) {
  const boxRef = useRef(null);
  const ptsRef = useRef([]);
  const drawingRef = useRef(false);
  const [pts, setPtsState] = useState([]);
  const [flash, setFlash] = useState(null); // { ok, tone } | null
  const flashTimerRef = useRef(null);
  const setPts = (next) => { ptsRef.current = next; setPtsState(next); };

  useEffect(() => { // 음절/단어 전환 초기화
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    drawingRef.current = false; setFlash(null); setPts([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);
  useEffect(() => () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); }, []);

  // 경성(0) 음절 = 그리기 애매 → 자동 정답 처리(잠깐 안내 후 onDraw(0)로 통과). 카운트다운·일시정지·완료 시엔 대기.
  const neutral = expectedTone === 0;
  useEffect(() => {
    if (!neutral || disabled) return undefined; // disabled=완료·카운트다운·일시정지 중엔 자동통과 보류(해제되면 재실행)
    const t = setTimeout(() => onDraw(0), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neutral, disabled, resetKey]);

  const localPt = (e) => {
    const r = boxRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const start = (e) => {
    if (disabled || flash || neutral) return; // 경성 음절은 자동 통과 — 그리기 입력 무시
    if (e.button != null && e.button !== 0) return; // 주 버튼(좌클릭/터치)만
    drawingRef.current = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    setPts([localPt(e)]);
  };
  const move = (e) => {
    if (!drawingRef.current) return;
    const p = localPt(e);
    const arr = ptsRef.current;
    const last = arr[arr.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 3) return; // 거리 스로틀
    setPts([...arr, p]);
  };
  const end = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const guess = classifyStroke(ptsRef.current);
    if (guess == null) { setPts([]); return; } // 탭/너무 작음 — 조용히 비움(판정·패널티 없음)
    const ok = guess === expectedTone;
    setFlash({ ok, tone: guess });
    haptic(ok ? [10, 20, 30] : [40, 30, 40]);
    onDraw(guess);
    flashTimerRef.current = setTimeout(() => { setFlash(null); setPts([]); }, ok ? 380 : 560);
  };

  const strokeCol = flash ? (flash.ok ? TG.SUCCESS : TG.DANGER) : TG.CORAL;
  const borderCol = flash ? (flash.ok ? TG.SUCCESS : TG.DANGER) : 'rgba(255,107,107,0.45)';
  const bg = flash ? (flash.ok ? '#F2FCF7' : '#FFF3F3') : '#fff';
  const tail = pts[pts.length - 1];
  const guessName = flash ? (TONES.find((t) => t.num === flash.tone)?.name || `${flash.tone}성`) : '';
  return (
    <div ref={boxRef} data-coach="draw-pad"
      onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      className={flash && !flash.ok ? 'tg-shake' : ''}
      style={{
        position: 'relative', width: '100%', height: '100%', borderRadius: RADIUS.xxl,
        background: bg, border: `2px ${flash ? 'solid' : 'dashed'} ${borderCol}`,
        boxShadow: flash && flash.ok ? SHADOW.correctGlow : SHADOW.card,
        touchAction: 'none', WebkitTapHighlightColor: 'transparent', userSelect: 'none',
        cursor: disabled ? 'default' : 'crosshair', overflow: 'hidden',
        transition: 'border-color .15s ease, background .15s ease',
      }}>
      {/* 경성 음절 — 자동 통과 안내(그리기 불가) */}
      {neutral ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: SPACE.md, pointerEvents: 'none', padding: SPACE.md }}>
          <div style={{ width: 52, height: 52, borderRadius: RADIUS.card, background: '#eef0f3', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: TONE_COLORS[0] }}>
            <ToneMark tone={0} size={30} />
          </div>
          <span style={{ ...TYPE.btn, color: TG.INK }}>경성이에요</span>
          <span style={{ ...TYPE.meta, color: TG.SUB }}>자동으로 넘어가요</span>
        </div>
      ) : (pts.length === 0 && !flash && (
        /* 빈 상태 안내 — 힌트 없이 '여기 그려요'만 */
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: SPACE.md, pointerEvents: 'none', padding: SPACE.md }}>
          <div style={{ width: 52, height: 52, borderRadius: RADIUS.card, background: TG.CORAL_BG, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width={30} height={30} viewBox="0 0 60 60" fill="none" aria-hidden="true">
              <path d="M 14 38 C 20 22 26 22 30 30 C 34 38 40 38 46 22" stroke={TG.CORAL} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span style={{ ...TYPE.btn, color: TG.INK }}>성조를 그려보세요</span>
          <span style={{ ...TYPE.meta, color: TG.SUB }}>손가락으로 획을 그으면 돼요</span>
        </div>
      ))}
      {/* 그린 획 */}
      {pts.length > 1 && (
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} aria-hidden="true">
          <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={strokeCol} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {/* 지문 끝점 표시(그리는 중) */}
      {!flash && tail && drawingRef.current && (
        <span aria-hidden="true" style={{ position: 'absolute', left: tail.x, top: tail.y, width: 14, height: 14, marginLeft: -7, marginTop: -7, borderRadius: '50%', background: TG.CORAL, boxShadow: `0 0 8px ${TG.CORAL}`, pointerEvents: 'none' }} />
      )}
      {/* 인식 결과 라벨(떼는 순간) — 무엇으로 읽었는지 투명하게 */}
      {flash && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 12, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: SPACE.sm, ...TYPE.h2, color: flash.ok ? TG.SUCCESS : TG.DANGER, background: '#fff', padding: '5px 12px', borderRadius: RADIUS.md, boxShadow: '0 2px 8px rgba(43,39,48,0.1)' }}>
            {flash.ok ? `${guessName} · 정답!` : `${guessName}으로 그렸어요`}
          </span>
        </div>
      )}
    </div>
  );
}

// ── 카운트다운 비주얼 (난이도 핀 포함) ──────────────────
const DIFF_HANZI = Object.fromEntries(DIFFICULTIES.map((d) => [d.id, d.hanzi])); // 라벨·한자는 DIFFICULTIES에서 파생
export function CountdownVisual({ n, difficulty }) {
  const pinHz = DIFF_HANZI[difficulty?.tier || difficulty?.id]; // 스테이지는 tier로 조회. 테마 등 난이도 외엔 생략
  return (
    <>
      {/* 숫자 + 안내 (Figma top290.5 = 34.4%) */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: '34.4%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.xs }}>
        <div key={n} style={{ width: 160, height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', filter: 'drop-shadow(0px 14px 15px rgba(242,72,76,0.3))', animation: 'tg-count .85s ease forwards' }}>
          <span style={{ ...TYPE.numHero, fontSize: 120, color: '#fff', lineHeight: 'normal' }}>{n > 0 ? n : ''}</span>
        </div>
        <Reveal i={1} base={140}>
          <span style={{ display: 'block', ...TYPE.body, color: '#fff', textAlign: 'center' }}>성조를 빠르게 찾아 탭하세요!</span>
        </Reveal>
      </div>
      {/* 난이도 핀 (Figma top575.5 = 68.2%) */}
      <Reveal i={2} base={140} style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: '68.2%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, background: '#fff3d6', padding: '10px 16px', borderRadius: RADIUS.lg }}>
        {pinHz && <span style={{ fontFamily: FONT_HANZI, fontWeight: 700, fontSize: 15, color: '#e0a21a' }}>{pinHz}</span>}
        <span style={{ ...TYPE.labelSm, color: '#b07d12' }}>{difficulty?.label || DIFFICULTIES[0].label}</span>
      </div>
      </Reveal>
    </>
  );
}

// 카운트다운 슬라이드 가장자리 — 세로 사인파 실루엣.
// 슬라이드 컨테이너 좌/우 '바깥쪽'에 코랄 띠를 붙여, 가운데 정렬(전체 덮음)일 땐 화면 밖이라 안 보이고
// 슬라이드 중에만 게임 위로 물결 경계가 드러나게 한다.
const CD_WAVE_PATH = (() => {
  const N = 13, H = 1000, steps = 80, amp = CD_WAVE_W / 2;
  // 오른쪽 직선변(x=W) → 아래로 → 왼쪽 사인 실루엣을 따라 위로 → 닫기
  let d = `M ${CD_WAVE_W} 0 L ${CD_WAVE_W} ${H}`;
  for (let i = steps; i >= 0; i--) {
    const y = (H / steps) * i;
    const x = amp + amp * Math.sin((i / steps) * N * Math.PI * 2);
    d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${d} Z`;
})();
export function CdWaveEdge({ side, color = '#f96c6e' }) {
  const isLeft = side === 'left';
  return (
    <svg width={CD_WAVE_W} height="100%" viewBox={`0 0 ${CD_WAVE_W} 1000`} preserveAspectRatio="none" aria-hidden="true"
      style={{
        position: 'absolute', top: 0, height: '100%', [isLeft ? 'left' : 'right']: 0,
        transform: isLeft ? 'translateX(-100%)' : 'translateX(100%) scaleX(-1)', display: 'block',
      }}>
      <path d={CD_WAVE_PATH} fill={color} />
    </svg>
  );
}

// 잠긴 버튼 흔들기 — shakeOnClick일 때 클릭 시 좌우 흔들림(tg-shake) + onClick(토스트)
export function ShakeButton({ shakeOnClick, onClick, className = '', style, children, ...rest }) {
  const [shaking, setShaking] = useState(false);
  useEffect(() => { if (!shaking) return undefined; const t = setTimeout(() => setShaking(false), 450); return () => clearTimeout(t); }, [shaking]);
  const handle = () => {
    if (shakeOnClick) { setShaking(false); requestAnimationFrame(() => setShaking(true)); playSfx('locked'); }
    if (onClick) onClick();
  };
  return <button onClick={handle} className={`${className} ${shaking ? 'tg-shake' : ''}`.trim()} style={style} {...rest}>{children}</button>;
}

// 중앙 토스트 — 다크 알약 + 상황별 아이콘 + 문구. tg-toast로 페이드 인·아웃.
//  kind: 'lock'(잠금 안내·기본) | 'done'(이미 달성 등 완료) | 'info'(문구에 자체 이모지 있어 아이콘 생략)
export function GameToast({ msg, kind = 'lock' }) {
  const Icon = kind === 'done' ? CheckCircleIcon : kind === 'info' ? null : LockSimpleIcon;
  // 광학 중앙 보정: 정중앙(50%)이면 눈에는 아래로 쏠려 보임(하단 CTA로 무게중심도 아래) → 하단 패딩을 키워 살짝 위로.
  // 애니메이션(tg-toast)이 transform:translateY를 쓰므로 토스트 박스가 아닌 바깥 컨테이너 패딩으로 올림. safe-area-top도 함께 정합.
  return (
    <div style={{ position: 'fixed', top: 'env(safe-area-inset-top)', bottom: 0, left: 0, right: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', padding: '24px 24px calc(24px + 12vh)' }}>
      <div className="tg-toast" style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, background: 'rgba(43,39,48,0.94)', boxShadow: '0 8px 22px rgba(26,16,20,0.28)', borderRadius: RADIUS.lg, padding: '12px 18px 12px 16px', maxWidth: '90%' }}>
        {Icon && <Icon size={16} weight="fill" color="#fff" style={{ flexShrink: 0 }} />}
        <span style={{ ...TYPE.sub, color: '#fff', whiteSpace: 'normal', lineHeight: 1.35, wordBreak: 'keep-all' }}>{msg}</span>
      </div>
    </div>
  );
}

// ── 설정 모달 ─────────────────────────────────────────
// ⚙️ 설정 — 소리(SFX)·햅틱(진동) on/off. 시작화면·일시정지 모달에서 공용. Figma "18. 설정 모달" 기준.
function SettingRow({ Icon, label, on, onToggle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.xl }}>
        <div style={{ width: 36, height: 36, borderRadius: RADIUS.md, background: on ? 'rgba(242,72,76,0.12)' : TG.TRACK, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={20} weight="fill" color={on ? TG.CORAL_DK : TG.MUTED} />
        </div>
        <span style={{ ...TYPE.btnSm, color: TG.INK }}>{label}</span>
      </div>
      <button onClick={onToggle} role="switch" aria-checked={on} aria-label={label} className="tg-press"
        style={{ width: 48, height: 28, borderRadius: RADIUS.lg, border: 'none', cursor: 'pointer', padding: 0, background: on ? TG.CORAL_DK : TG.MUTED, position: 'relative', transition: 'background .2s ease', ...TOUCH_OPT }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 22, height: 22, borderRadius: RADIUS.md, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left .18s ease' }} />
      </button>
    </div>
  );
}

export function SettingsModal({ onClose }) {
  const [sfxOn, setSfxOn] = useState(() => !isSfxMuted());
  const [hapticOn, setHapticOn] = useState(() => !isHapticMuted());
  const toggleSfx = () => { const next = !sfxOn; setSfxOn(next); setSfxMuted(!next); if (next) playSfx('button'); };
  const toggleHaptic = () => { const next = !hapticOn; setHapticOn(next); setHapticMuted(!next); if (next) haptic(20); };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(26,16,20,0.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: SPACE.x4, ...TOUCH_OPT }}>
      <div className="tg-enter" onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: 300, background: TG.CARD, borderRadius: RADIUS.xxl, padding: '20px 22px 22px',
        boxShadow: '0 20px 50px rgba(26,16,20,0.3)', display: 'flex', flexDirection: 'column', gap: SPACE.x2,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ ...TYPE.cta, color: TG.INK }}>설정</span>
          {/* 히트영역 44×44(음수 마진으로 레이아웃 자리는 30 유지), 시각 크기는 안쪽 30×30 원 그대로 */}
          <button onClick={onClose} aria-label="닫기" className="tg-press"
            style={{ width: 44, height: 44, margin: -7, padding: 0, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT }}>
            <span style={{ width: 30, height: 30, borderRadius: RADIUS.lg, background: TG.SURFACE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <XIcon size={14} weight="bold" color={TG.SUB} />
            </span>
          </button>
        </div>
        <SettingRow Icon={sfxOn ? SpeakerHighIcon : SpeakerSlashIcon} label="소리" on={sfxOn} onToggle={toggleSfx} />
        <SettingRow Icon={VibrateIcon} label="햅틱" on={hapticOn} onToggle={toggleHaptic} />
      </div>
    </div>
  );
}
