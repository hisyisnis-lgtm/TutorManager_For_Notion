// 성조게임 화면 공통 빌딩블록 — 모든 화면 컴포넌트가 공유.
// 스타일 주입(ToneGameStyles)·반응형 컨테이너(FigmaScreen)·등장 래퍼(Reveal)·코치 말풍선·
// 단어 카드/성조 버튼·카운트다운 비주얼·토스트·흔들림 버튼.
// 참조 메모리: tone_game_redesign.md §5(단어카드)·§10-B(FigmaScreen)·§10-C(연출)
import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { DoubleAltArrowRight, Lock, CheckCircle, VolumeLoud, VolumeCross, AltArrowLeft, Star, Eye,
  HandStars, NotebookBookmark, Home as HomeIcon, Cup, Stars, Pause } from '@solar-icons/react';
import { TG, HOME, FONT_HANZI, FONT_PINYIN, TYPE, SHADOW, DUR, TOUCH_OPT, TONE_COLORS, TONE_KEY_COLORS, ASSETS,
  haptic, isMeaningHidden, setMeaningHidden, isPinyinHidden, setPinyinHidden, RADIUS, SPACE } from '../tgTokens.js';
import { ToneMark } from '../tgWidgets.jsx';
import { TONES } from '../../constants/toneGameWords.js';
import { play as playSfx } from '../tgSfx.js';
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
    // ★수명은 **벽시계(ms)**, 이동 적분만 프레임 정규화 dt.
    //   구버전은 나이도 dt(프레임)로 쌓아, 프레임률이 떨어지면 수명까지 같이 늘어나 색종이가
    //   슬로모션으로 화면에 남았다(업적 모달이 연달아 뜨는 순간에 발사 지점 높이에 줄지어 멈춤 —
    //   2026-08-08 사용자 지적). 이제 프레임이 아무리 튀어도 정해진 시간에 사라진다.
    const MS_PER_FRAME = 16.667;
    const tick = (now) => {
      if (!alive) return;
      const rawMs = Math.max(0, now - last); last = now;
      const dt = Math.min(3, rawMs / MS_PER_FRAME); // 이동은 한 프레임에 3프레임분까지만(순간이동 방지)
      let anyAlive = false;
      for (let k = 0; k < cfg.current.length; k++) {
        const el = refs.current[k]; const s = cfg.current[k]; if (!el) continue;
        s.age += rawMs / MS_PER_FRAME; // 나이는 클램프 없이 실제 경과분 그대로
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
    // 안전장치 — rAF가 아예 멈춘 구간(탭 비활성·긴 작업)에서는 위 루프가 돌지 않아 조각이 그 자리에 얼어붙는다.
    //  타이머는 그래도 발화하므로, 최대 수명이 지나면 무조건 지운다.
    const maxLifeMs = cfg.current.reduce((m, s) => Math.max(m, s.life), 0) * MS_PER_FRAME + 250;
    const kill = setTimeout(() => {
      alive = false; cancelAnimationFrame(raf);
      refs.current.forEach((el) => { if (el) el.style.opacity = '0'; });
    }, maxLifeMs);
    return () => { alive = false; cancelAnimationFrame(raf); clearTimeout(kill); };
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
      /* 감탄로드 탄탄체 — 타이틀 리디자인(2026-07-28) 필·안내문용. 상업용 무료(강원특별자치도×투게더그룹), fonts-archive CDN */
      @font-face { font-family: 'GamtanRoad Tantan'; font-weight: normal; font-display: swap;
        src: url('https://cdn.jsdelivr.net/gh/fonts-archive/GamtanRoadTantan/GamtanRoadTantan.woff2') format('woff2'),
             url('https://cdn.jsdelivr.net/gh/fonts-archive/GamtanRoadTantan/GamtanRoadTantan.woff') format('woff'); }
      @keyframes tg-shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-6px)} 40%{transform:translateX(6px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)} }
      @keyframes tg-pulse { 0%,100%{opacity:.35} 50%{opacity:.9} }
      @keyframes tg-heartbeat { 0%,100%{transform:scale(1)} 28%{transform:scale(1.2)} 42%{transform:scale(1)} 58%{transform:scale(1.12)} 72%{transform:scale(1)} }
      /* 탭바 레드닷 — 미확인 획득 알림. 점은 고정, 뒤에서 파문만 퍼진다(점이 튀면 탭바가 산만해진다).
         2.2s로 느리게 반복 — 주목은 시키되 눈을 붙잡아 두지는 않는다. */
      @keyframes tg-dot-ring { 0%,64%{transform:scale(.7);opacity:0} 74%{opacity:.55} 100%{transform:scale(2.5);opacity:0} }
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
      /* 모달·팝오버 등장 — blur 제거하고 스케일+페이드만 남긴 깔끔한 팝인(2026-08-10 사용자).
         blur는 렌더 비용도 크고 글자가 한 번 뭉개졌다 잡히는 게 '느리게 뜨는' 인상을 준다. 오버슛도 없음. */
      @keyframes tg-enter { from{opacity:0; transform:scale(.96)} to{opacity:1; transform:scale(1)} }
      /* 모달 아이콘 IDLE — 모달이 떠 있는 동안 히어로 아이콘이 천천히 숨 쉰다(2026-08-10 사용자).
         ★위아래 '둥둥'은 쓰지 않는다(사용자가 레드닷에서 거절한 결) — 크기 호흡만. 느리게(2.6s)·약하게(7%). */
      @keyframes tg-idle { 0%,100%{transform:scale(1)} 50%{transform:scale(1.07)} }
      @keyframes tg-count { 0%{transform:scale(.4);opacity:0} 45%{transform:scale(1.06);opacity:1} 100%{transform:scale(1);opacity:1} }
      @keyframes tg-touch { 0%,100%{opacity:.5} 50%{opacity:1} }
      @keyframes tg-ripple { 0%{transform:translate(-50%,-50%) scale(.5);opacity:.4} 70%{opacity:.1} 100%{transform:translate(-50%,-50%) scale(2);opacity:0} }
      /* 그리기 예시 획(튜토리얼 전용) — 성조 곡선이 스스로 그려졌다가 잠깐 머문 뒤 사라지고 반복.
         dasharray는 어떤 성조 path보다 긴 고정값(200)이라 길이 계산 없이 '그려지는' 연출이 된다. */
      @keyframes tg-demo-stroke { 0%{stroke-dashoffset:200;opacity:0} 8%{opacity:1} 55%{stroke-dashoffset:0;opacity:1} 82%{stroke-dashoffset:0;opacity:1} 100%{stroke-dashoffset:0;opacity:0} }
      /* 연출 동심원(RevealRings) — In: 안쪽부터 퍼지는 충격파(살짝 오버슛) · Idle: 아주 느린 호흡.
         ★두 애니메이션 모두 transform을 쓰므로 **목록 뒤쪽(idle)이 delay 후 앞쪽(in)을 넘겨받는** 방식으로 이어 붙인다.
           in에 both(fill)를 줘야 idle 시작 전까지 최종 scale(1)이 유지된다. */
      @keyframes tg-ring-in { 0%{opacity:0;transform:scale(.55)} 70%{opacity:1;transform:scale(1.045)} 100%{opacity:1;transform:scale(1)} }
      /* Idle — 안쪽부터 바깥으로 번지는 맥동. 진폭 1.032는 거의 정지처럼 보였다(2026-08-09 사용자) */
      @keyframes tg-ring-idle { 0%,100%{transform:scale(1)} 45%{transform:scale(1.075)} }
      /* Out — 바깥 원부터 차례로 부풀며 사라진다(퍼져 나가듯) */
      @keyframes tg-ring-out { 0%{opacity:1;transform:scale(1)} 100%{opacity:0;transform:scale(1.5)} }
      /* 스플래시 성조 캐릭터 파도타기 — 옆으로 차례차례 넘어가는 웨이브(캐릭터마다 delay만 다르게) */
      @keyframes tg-wave { 0%,55%,100%{transform:translateY(0)} 25%{transform:translateY(-13px)} }
      /* 로딩 문구의 '...' — 점이 하나씩 켜졌다 함께 꺼지며 반복 */
      @keyframes tg-ellipsis { 0%,82%,100%{opacity:0} 26%,72%{opacity:1} }
      /* 비트/연출 퇴장 — 딤은 루트가 페이드, 콘텐츠는 살짝 오므라들며 빠진다(등장 팝의 반대) */
      @keyframes tg-beat-out { from{opacity:1;transform:translateY(0) scale(1);filter:blur(0)} to{opacity:0;transform:translateY(-6px) scale(.985);filter:blur(4px)} }
      /* ── 아이콘 의미별 등장(2026-08-08) ──────────────────────────────
         아이콘이 **그 순간의 주인공**인 자리에만 건다(연출·비트·결과 통계).
         탭바·업적 목록처럼 상시 노출되는 곳엔 쓰지 말 것 — 아이콘마다 다른 모션이 겹치면 산만해진다.
         ★타이밍 규칙: 300ms 안팎으로 **짧고 딱 끊기게**. 500~600ms로 늘리면 같은 동작도 물렁해 보인다. */
      @keyframes tg-ic-flame  { 0%{opacity:0;transform:translateY(7px) scale(.86,.5)} 50%{opacity:1;transform:translateY(-2px) scale(1.02,1.12)} 100%{opacity:1;transform:translateY(0) scale(1,1)} }
      @keyframes tg-ic-bolt   { 0%{opacity:0;transform:scale(.4) rotate(-16deg)} 26%{opacity:1;transform:scale(1.22) rotate(6deg)} 44%{transform:scale(.94) rotate(-3deg)} 100%{opacity:1;transform:scale(1) rotate(0)} }
      @keyframes tg-ic-trophy { 0%{opacity:0;transform:translateY(-18px) scale(.9)} 52%{opacity:1;transform:translateY(3px) scale(1.04)} 76%{transform:translateY(-2px) scale(1)} 100%{opacity:1;transform:translateY(0) scale(1)} }
      @keyframes tg-ic-medal  { 0%{opacity:0;transform:scale(.55) rotate(-14deg)} 55%{opacity:1;transform:scale(1.12) rotate(6deg)} 100%{opacity:1;transform:scale(1) rotate(0)} }
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
      /* (구 tg-rise/tg-screen-in/tg-fade-in = 화면 등장 연출 — 2026-08-10 사용자 결정으로 전부 제거.
         "순서대로 뜨니 로딩이 느린 것 같다". 포인트가 필요한 자리가 생기면 그때 개별로 되살린다.
         모달 팝인(tg-enter)·게임 연출(비트·축하·콤보)은 성격이 다르므로 그대로 유지.) */
      @keyframes tg-toast { 0%{opacity:0; transform:translateY(8px)} 12%{opacity:1; transform:translateY(0)} 86%{opacity:1; transform:translateY(0)} 100%{opacity:0; transform:translateY(-4px)} }
      /* 타이틀 로고 효과 */
      @keyframes tg-logo-pop { 0%{opacity:0; transform:scale(.7)} 60%{opacity:1; transform:scale(1.05)} 100%{opacity:1; transform:scale(1)} }
      @keyframes tg-smoke-rise { 0%{transform:translate(-2px,-6px) scale(.18); opacity:0} 12%{opacity:.95} 100%{transform:translate(-27px,-74px) scale(1); opacity:0} }
      @keyframes tg-smoke-sway { from{transform:translateX(-6px)} to{transform:translateX(6px)} }
      @keyframes tg-leaf-fall { 0%{transform:translate(-40px,-6vh) rotate(0deg)} 100%{transform:translate(150px,105vh) rotate(340deg)} }
      @keyframes tg-leaf-sway { from{transform:translateX(-18px)} to{transform:translateX(18px)} }
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
      /* 등장 이징 — 초반에 빠르게 붙고 끝이 길게 안착(ease-out-expo 계열). 탭 화면·요소가 같은 곡선을 쓴다. */
      /* 이징은 강한 ease-out 하나로 통일 — 내장 easing은 약해서 의도가 안 읽히고, ease-in은 시작이 느려 굼떠 보인다 */
      .tg-toast{ animation: tg-toast 1.7s ease both }
      @media (prefers-reduced-motion: reduce){ .tg-enter, .tg-idle{ animation: none !important } }
      .tg-shake{ animation: tg-shake .42s ease }
      .tg-enter{ animation: tg-enter .18s cubic-bezier(.23,1,.32,1) both }
      .tg-idle{ display: flex; animation: tg-idle 2.6s ease-in-out infinite }
      /* 누를 땐 빠르게 쏙 들어가고(.09s), 뗄 땐 살짝 튕기며 부드럽게 복귀(back-out 스프링) */
      /* 누름 피드백 — 하루에 수백 번. 복귀가 280ms면 손을 뗀 뒤에도 버튼이 늘어져 굼떠 보인다 → 140ms(권장 100~160) */
      .tg-press{ transition: transform .14s cubic-bezier(.23,1,.32,1) }
      .tg-press:active{ transform: scale(.96); transition: transform .09s cubic-bezier(.23,1,.32,1) }
      /* ── 히트영역 44px 확보 — 보이는 크기는 그대로 두고 탭 영역만 넓힌다(2026-08-18 검수) ──────
         인게임 보조 버튼(발음 듣기·정답보기 h30)과 일시정지(40)가 44 미만이라 시간 제한 중 오조작이 났다.
         시안 실측값(h30·카드 272)을 건드리지 않으려고 ::before 투명 레이어로만 넓힌다 →
         레이아웃에 영향 0. width/height 100%에 min 44를 얹어 원래 크기보다 줄어들 일도 없다.
         ⚠️ 버튼을 감싸는 컨테이너에 overflow:hidden이 있으면 잘리니, 카드 안쪽 여백이 7px 미만인 곳엔 쓰지 말 것. */
      .tg-hit44{ position: relative }
      .tg-hit44::before{ content:''; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
        width:100%; height:100%; min-width:44px; min-height:44px }
      .tg-root, .tg-root *, .tg-root *::before, .tg-root *::after { box-sizing: border-box; }
      .tg-noscroll::-webkit-scrollbar { display: none; }
      /* ── iOS 화면 전체가 딸려 스크롤되는 것 차단(2026-08-09 실기기 제보) ──────────
         게임은 position:fixed 한 화면이라 문서가 스크롤될 일이 없는데도, 안쪽 목록을
         끝까지 넘기면 iOS가 **문서로 스크롤을 연쇄(scroll chaining)**시켜 화면 전체가
         고무줄처럼 밀려 올라간다(탭바가 화면 중간에 뜨고 아래가 빈 여백).
         ① 게임이 떠 있는 동안 문서 자체를 잠그고 ② 안쪽 스크롤러가 연쇄를 끊는다.
         overscroll-behavior는 스크롤 컨테이너에만 작용하므로 후손 전체에 걸어도 부작용이 없다 —
         화면마다 클래스를 달지 않아도 새로 생기는 스크롤 영역까지 자동으로 보호된다. */
      html.tg-lock, html.tg-lock body { height: 100%; overflow: hidden; overscroll-behavior: none; }
      .tg-root, .tg-root * { overscroll-behavior: contain; }
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
// 스크롤 컨테이너 안의 `position: sticky` 블록이 **상단에 붙었는지**를 판정하는 공용 훅.
//  업적(14)·오답 노트(13)가 같은 규칙을 쓴다 — 붙는 순간에만 배경·구분선·글자크기가 바뀐다.
//
//  ⚠️ 두 가지를 다 피해야 한다(둘 다 2026-08-10 사용자 지적):
//   ① `scrollTop > 4` 같은 임의 임계 → 블록이 아직 제목 아래를 흘러가는 동안(업적 기준 약 120px)
//      배경이 먼저 켜져 "스크롤 중에 배경이 생기는" 어색함.
//   ② onScroll에서 좌표를 재는 방식 → 관성 스크롤에선 scroll 이벤트가 프레임마다 오지 않아
//      배경이 한 박자 늦게 켜지고, 그 사이 행이 비쳐 **틈처럼** 보인다.
//
//  → 경계에 **센티넬(높이 0)** 을 두고 IntersectionObserver로 감시한다. 스크롤 이벤트 빈도와 무관하게
//    경계를 넘는 순간 정확히 발화하므로 위 둘 다 생기지 않는다.
//
//  사용법 — 센티넬이 sticky 블록의 '자연 위치'에 정확히 놓이도록, 블록이 갖고 있던 음수 top 마진을
//   센티넬로 옮긴다(레이아웃 총합은 그대로):
//     const { scrollRef, sentinelRef, stuck } = useStickyHeader();
//     <div ref={scrollRef}>
//       …제목…
//       <div ref={sentinelRef} aria-hidden style={{ height: 0, marginTop: -30 }} />
//       <div style={{ position:'sticky', top:0, margin:'0 -24px 0' }}>…</div>
export function useStickyHeader() {
  const scrollRef = useRef(null);
  const sentinelRef = useRef(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const root = scrollRef.current, s = sentinelRef.current;
    if (!root || !s || typeof IntersectionObserver === 'undefined') return undefined;
    // 센티넬이 컨테이너 상단 밖으로 나가면 = 블록이 붙은 상태.
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { root, threshold: 0 });
    io.observe(s);
    return () => io.disconnect();
  }, []);
  return { scrollRef, sentinelRef, stuck };
}

export function ToneGameStyles() {
  return null;
}

// ── 반응형 화면 컨테이너 ────────────────────────────────
// 전체 높이 컬럼(최대폭 600, 가운데). 요소는 absolute로 상단=top / 하단=bottom 앵커 + left/right로 폭 채움.
// → 화면 폭이 넓어지면 요소가 넓어지고, 세로가 길어지면 상단·하단이 벌어지며 채워짐(잘림 없음).
// 상단 safe-area: 컬럼을 노치 아래에서 시작(top=safe-top)시켜 상단 요소(top:20 등)가 상태바에 안 가리게.
//   배경(bgImage)은 root(inset:0)라 노치까지 덮음. 하단은 각 CTA가 env(safe-area-inset-bottom)로 개별 처리.
// 레터박스(마스킹 영역 밖)는 전 화면 공통 고정색(TG.BG) — 화면별 bg는 컨테이너 '안'에만 칠함(2026-07-29)
// 게임 화면 컬럼 최대 폭 — 데스크톱에서 세로 9:16 유지. 화면전환(TxLayer)도 같은 값을 써야 '창 전체가 움직이는' 느낌이 안 난다.
export const TG_COL_MAXW = 'min(600px, 56.25vh)';
// enter — 탭 화면 진입 모션(페이드 + 8px 상승). 컬럼 div는 translateX(-50%) 정렬 transform을 쓰므로
//   애니메이션은 **안쪽 래퍼**에 건다(keyframes가 정렬 transform을 덮어쓰는 함정 회피).
export function FigmaScreen({ children, bg = TG.BG, bgImage, enter = false }) {
  // 안전영역 래퍼 — 화면 콘텐츠(절대좌표)는 예전처럼 노치 **아래**에서 시작한다.
  //  ★이 래퍼엔 transform을 절대 주지 말 것. transform이 붙으면 이게 fixed의 기준 박스가 되어
  //   모달·시트가 노치 높이만큼 짧은 박스 안에서 가운데 정렬 → iOS에서 아래로 쏠린다(2026-08-06 사용자 지적).
  const inner = (
    <div style={{ position: 'absolute', top: 'env(safe-area-inset-top)', bottom: 0, left: 0, right: 0, background: bg, overflow: 'hidden' }}>
      {bgImage && <img src={bgImage} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />}
      {children}
    </div>
  );
  return (
    <div className="tg-root" style={{ position: 'fixed', inset: 0, height: '100dvh', background: TG.BG, overflow: 'hidden' }}>
      <ToneGameStyles />
      {/* 웹(데스크톱)에선 세로 16:9(=9:16) 비율로 제한 — 폭 = min(600px, 화면높이×9/16). 모바일 세로 화면은 기존 그대로(100%).
          overflow hidden = 9:16 영역 마스킹 — 와이드 장식(타이틀 동산·홈 배경 등)이 레터박스로 새지 않게.
          ★컬럼(과 enter 래퍼)은 **화면 전체 높이** — 안쪽 fixed 모달이 이 박스를 기준으로 잡히므로 여기서 노치를 빼면 안 된다. */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: TG_COL_MAXW, overflow: 'hidden' }}>
        {inner}
      </div>
    </div>
  );
}

// ── 연출 무대 ─────────────────────────────────────────
// 연출들은 시안 390×844 프레임의 **절대 y좌표**를 그대로 쓴다(top: 327 등).
//  화면이 844보다 짧으면(iOS 인앱 브라우저 등) 그 좌표가 전부 아래쪽으로 쏠려 보인다.
//  → 844 높이의 무대를 화면 세로 중앙에 놓고 그 안에서 시안 좌표를 쓰면, 짧은 화면에서도 구도가 가운데 유지된다.
export const STAGE_H = 844;
export function RevealStage({ children, style }) {
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: STAGE_H, transform: 'translateY(-50%)', ...style }}>
      {children}
    </div>
  );
}

// ── 비트 공용 딤 ────────────────────────────────────────
// 종료 체인(게임오버/신기록 → XP → 등급승급 → 모드해제)은 비트가 **연달아** 뜨는데, 예전엔 각 비트가
// 자기 딤을 갖고 있어 앞 비트가 300ms 페이드아웃 → 다음 비트가 즉시/페이드인 하며 **사이가 밝아졌다 다시 어두워졌다**
// (2026-08-08 사용자 지적 "비트가 이어지면 딤이 깜빡거리면 안 될 것 같은데").
//   → 딤을 비트 **밖 한 겹**으로 올려, 체인이 시작될 때 한 번 켜지고 끝날 때 한 번 꺼지게 한다.
//   체인에 속한 비트들은 배경을 투명으로 두고 콘텐츠만 그린다.
const BEAT_DIM_OUT_MS = 300;
export function BeatDim({ active, zIndex = 118 }) {
  const [shown, setShown] = useState(active);
  useEffect(() => {
    if (active) { setShown(true); return undefined; }
    const t = setTimeout(() => setShown(false), BEAT_DIM_OUT_MS);
    return () => clearTimeout(t);
  }, [active]);
  if (!shown) return null;
  return (
    <div aria-hidden="true" style={{
      position: 'fixed', inset: 0, zIndex, pointerEvents: 'none',
      background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
      animation: active ? 'tg-dim-in .35s ease both' : `tg-fade-out ${BEAT_DIM_OUT_MS}ms ease forwards`,
    }} />
  );
}

// ── 비트/연출 콘텐츠 레이어 ─────────────────────────────
// 비트 오버레이는 닫힐 때 루트가 페이드아웃하지만 **콘텐츠는 제자리에 그대로** 있어 등장만 있고 퇴장이 없었다
// (2026-08-08 사용자 요청). 이 레이어가 닫힘 순간 콘텐츠만 살짝 오므리며 빠지게 한다.
//   ★자체 transform(translate 등)을 가진 콘텐츠 위에 덧씌우면 키프레임이 그걸 덮으므로, **한 겹 밖**에서 감싼다.
//   각 비트의 closing 후 onDone까지가 ≈300ms라 그 안에 끝나는 260ms.
export function BeatContent({ closing = false, children }) {
  const out = closing && !prefersReducedMotion();
  return (
    <div data-beat-content={closing ? 'out' : 'in'} style={{
      position: 'absolute', inset: 0, transformOrigin: '50% 50%',
      // 퇴장도 ease-out — ease-in은 시작이 느려 '끌려 나가는' 느낌을 준다(UI 애니메이션에 ease-in 금지)
      ...(out ? { animation: 'tg-beat-out 170ms cubic-bezier(.23,1,.32,1) forwards' } : null),
    }}>
      {children}
    </div>
  );
}

// ── 연출 동심원 배경 (2026-08-07 시안 개편) ─────────────
// 승급시험·신기록·모드해제·등급승급 **연출 5종이 공유**하는 배경. 딤 위에 검정 20% 원 3겹을 화면 정중앙에
// 겹쳐 안쪽으로 갈수록 어두워지는 과녁을 만든다(시안: 지름 246 / 394 / 542, 중심 = 프레임 정중앙 195,422).
//   ★딤(오버레이 자신의 background) 바로 위·콘텐츠 아래에 오도록 **오버레이의 첫 자식**으로 둘 것.
//   ⚠️ 글로우/그림자 없음 — 시안의 drop shadow는 전부 visible:false(꺼둔 이펙트)다. 넣지 말 것(2026-08-08).
// 모션(2026-08-08 사용자 요청) — In: 안쪽 원부터 차례로 퍼지는 충격파. Idle: 그 뒤 아주 느린 호흡이 바깥으로 번진다.
//   DOM 순서는 바깥→안(큰 원이 먼저 그려져야 안쪽 원이 위에 겹친다)이라, 지연은 **지름이 작을수록 먼저**로 계산한다.
const REVEAL_RING_D = [542, 394, 246];
// 타이밍은 짧게 — 560/110은 과녁이 느릿하게 열려 물렁했다(2026-08-08). Idle은 배경 호흡이라 길게 유지.
const RING_IN_MS = 380, RING_STEP_MS = 70;
// Idle — 링마다 위상을 어긋내(IDLE_STEP) 안쪽에서 바깥으로 번지는 맥동으로 보이게. 4200ms/진폭 1.032는 멈춘 듯했다.
const RING_IDLE_MS = 2400, RING_IDLE_STEP_MS = 260;
// Out — 바깥 원부터 순차 확대+소멸(2026-08-09 사용자 요청)
const RING_OUT_MS = 320, RING_OUT_STEP_MS = 85;
// tone — 'dark'(연출 5종, 어두운 딤 위 검정 20%) | 'light'(스플래시, 크림 배경 위 흰색 50%)
export function RevealRings({ tone = 'dark', out = false }) {
  const still = prefersReducedMotion();
  const ringBg = tone === 'light' ? 'rgba(255,255,254,0.5)' : 'rgba(0,0,0,0.2)';
  return (
    <div aria-hidden="true" style={{
      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none', overflow: 'hidden',
    }}>
      {REVEAL_RING_D.map((d, i) => {
        const order = REVEAL_RING_D.length - 1 - i; // 안쪽(246)=0 → 가장 먼저
        const inDelay = order * RING_STEP_MS;
        return (
          <span key={d} style={{
            position: 'absolute', width: d, height: d, borderRadius: '50%', background: ringBg,
            ...(still ? null : {
              // out은 **바깥(i=0)부터** — in/idle의 order(안쪽부터)와 반대 방향이라 지연 기준도 반대다
              animation: out
                ? `tg-ring-out ${RING_OUT_MS}ms cubic-bezier(.22,1,.36,1) ${i * RING_OUT_STEP_MS}ms forwards`
                : `tg-ring-in ${RING_IN_MS}ms cubic-bezier(.22,1,.36,1) ${inDelay}ms both,`
                  + ` tg-ring-idle ${RING_IDLE_MS}ms ease-in-out ${inDelay + RING_IN_MS + order * RING_IDLE_STEP_MS}ms infinite`,
              willChange: 'transform',
            }),
          }} />
        );
      })}
    </div>
  );
}

// ── 순차 등장 래퍼 ─────────────────────────────────────
// 바깥 div = 기존 위치/정렬(absolute·translateX 등) 그대로, 안쪽 div = 그 자리를 차지하던 블록.
// → 정렬 transform과 등장 transform이 다른 노드라 충돌 없음. i 순서대로 시차(base+i*step ms).
// play=false면 숨김 유지(opacity0) — 게임화면처럼 '특정 시점부터' 등장시킬 때 사용.
// 화면 등장 연출은 2026-08-10 사용자 결정으로 **전부 제거**했다(순서대로 뜨는 게 로딩 지연처럼 보임).
//  포인트를 주고 싶은 자리가 생기면 그때 개별적으로 되살린다 — 전역 스태거로 되돌리지 말 것.
// eslint-disable-next-line no-unused-vars -- i/base/step/play는 호출부(수십 곳) 유지를 위해 받기만 한다
export function Reveal({ i, base, step, play, style, children }) {
  // ★래퍼 2겹 구조는 그대로 둔다 — 바깥은 절대배치/정렬 transform, 안쪽은 그 자리를 차지하던 블록.
  //  한 겹으로 줄이면 안쪽 높이가 부모로 전달돼 일부 화면(그리기 패드 등) 레이아웃이 바뀐다.
  return (
    <div style={style}>
      <div>{children}</div>
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
      <AltArrowLeft size={24} weight="Bold" color={TG.INK} />
    </button>
  );
}

// 일시정지(공용) — 뒤로가기와 같은 40×40 아이콘 버튼, 헤더 **우측** 슬롯용.
//  ★인게임 헤더는 2026-08-12부터 좌측 뒤로가기 대신 이 버튼이다(사용자 지정).
//   구버전은 좌측 뒤로가기(aria-label="뒤로")가 실제로는 일시정지 모달을 열어 라벨·아이콘과 동작이 어긋났고,
//   "뒤로"라 읽히니 판을 버리는 문으로 오해되기도 했다. 이제 아이콘·라벨·동작이 전부 '일시정지'로 일치한다.
//   (하드웨어/브라우저 뒤로가기는 그대로 일시정지 모달로 연결된다 — ToneGamePage의 back guard)
export function PauseButton({ onClick, style }) {
  return (
    <button onClick={onClick} aria-label="일시정지" className="tg-press tg-hit44" style={{
      width: 40, height: 40, marginRight: -8, borderRadius: RADIUS.xl, background: 'none', boxShadow: 'none',
      border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT, ...style,
    }}>
      <Pause size={24} weight="Bold" color={TG.INK} />
    </button>
  );
}

// 게임 화면 공용 헤더 — 상단 고정 뒤로가기 + 타이틀 + 우측 슬롯(옵션). 모드·테마·난이도·등급·업적 등 공통.
//   솔리드 바가 상태바(노치)까지 덮음: 바는 FigmaScreen 콘텐츠(세이프에어리어만큼 내려옴) 위로 -inset만큼 끌어올려 채운다.
//   52px 밴드에 40px 내용 세로중앙(위아래 6). 타이틀은 넘치면 말줄임. 바(z3, DOM 먼저)>스크롤러(z2), 내용(z3, 나중)이 바 위.
// glass — 시안 "04. 모드선택"(643:1617) 헤더: 높이 60 · 반투명 크림(#FFFDF8 50%) + 배경 블러 10 · 하선 없음.
// center — 타이틀을 헤더 가운데 정렬(뒤로가기는 왼쪽 고정). glass와 별개로 켤 수 있다.
// z — 튜토리얼처럼 딤(zIndex 5) 위에 헤더를 올려야 하는 화면에서 상향(기본 3).
export function GameHeader({ title, onBack, right = null, bg = '#fff', glass = false, center = false, z = 3 }) {
  const H = glass ? 60 : 52;
  return (
    <>
      <div aria-hidden="true" style={{
        position: 'absolute', top: 'calc(-1 * env(safe-area-inset-top))', left: 0, right: 0,
        height: `calc(${H}px + env(safe-area-inset-top))`, zIndex: z, pointerEvents: 'none',
        background: glass ? 'rgba(255,253,248,0.5)' : bg,
        backdropFilter: glass ? 'blur(10px)' : undefined,
        WebkitBackdropFilter: glass ? 'blur(10px)' : undefined,
        borderBottom: glass ? 'none' : '1px solid rgba(43,39,48,0.06)',
      }} />
      <Reveal i={0} style={{ position: 'absolute', left: 24, top: (H - 40) / 2, right: 24, zIndex: z }}>
        <div style={{ position: 'relative', height: 40, display: 'flex', gap: SPACE.md, alignItems: 'center' }}>
          {/* 뒤로가기 없는 화면(시안 12 결과 등)은 onBack을 안 넘긴다 — center 정렬은 버튼 유무와 무관 */}
          {onBack && <BackButton onClick={onBack} />}
          {center ? (
            // 가운데 정렬 — 뒤로가기/우측 요소와 겹치지 않게 좌우 40px 여백 안에서 가운데(포인터 통과)
            <span style={{ position: 'absolute', left: 40, right: 40, textAlign: 'center', pointerEvents: 'none', ...TYPE.head, color: TG.INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
          ) : (
            <span style={{ flex: 1, minWidth: 0, ...TYPE.head, color: TG.INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
          )}
          {center && <span style={{ flex: 1 }} />}
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
            <Star size={size} weight="Bold" color={f ? on : off} />
          </span>
        );
      })}
    </div>
  );
}

// 공용 모달 셸 — 고정 딤 오버레이(백드롭 탭 닫기) + tg-enter 카드. 게임 모달들의 동일한 껍데기를 통일.
//   기본값 = **시안 표준 안내 모달**(330 · r24 · padding 28/22/22 · gap 16 · 가운데정렬, 2026-08-06 전 모달 통일).
export function ModalCard({ onClose, zIndex = 60, maxWidth = 330, radius = 24, padding = '28px 22px 22px', gap = 16, align = 'center', children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: SPACE.x4, ...TOUCH_OPT }}>
      <div className="tg-enter" onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth, background: TG.CARD, borderRadius: radius, padding,
        boxShadow: '0px 4px 18px rgba(43,39,48,0.07)', display: 'flex', flexDirection: 'column', alignItems: align, gap,
      }}>
        {children}
      </div>
    </div>
  );
}

// ── 안내 모달 구성요소(시안 2026-08-06 통일 규격) ─────────
// 배지 72 r24(모달별 색) + 아이콘 38 흰색 · 간격 10 · 제목 24 Bold(라인 29)
export function ModalHead({ Icon, badgeBg, iconColor = '#fff', title }) {
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.lg }}>
      <div style={{ width: 72, height: 72, borderRadius: RADIUS.xxl, background: badgeBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {/* IDLE 호흡 — 아이콘 컴포넌트가 className을 넘겨준다는 보장이 없어 span으로 감싼다 */}
        <span className="tg-idle"><Icon size={38} weight="Bold" color={iconColor} /></span>
      </div>
      <span style={{ ...TYPE.head, fontSize: 24, lineHeight: '29px', color: TG.INK, textAlign: 'center' }}>{title}</span>
    </div>
  );
}
// 본문 — 14 Regular(라인 22) 회색, 가운데. 줄바꿈은 배열로 넘긴다(시안 줄바꿈 위치 고정).
export function ModalBody({ lines }) {
  return (
    <div style={{ width: '100%', ...TYPE.body, fontWeight: 400, fontSize: 14, lineHeight: '22px', color: '#7E8A94', textAlign: 'center' }}>
      {lines.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  );
}
// 키캡 CTA — 60 r20 + 하단 인너 엣지 4px(모달 공통). 아이콘은 있으면 라벨 오른쪽 8 간격.
export function KeycapCta({ bg = '#F96163', edge = '#E64244', label, Icon, onClick }) {
  return (
    <button className="tg-press" onClick={onClick} style={{
      width: '100%', height: 60, borderRadius: RADIUS.xl, border: 'none', cursor: 'pointer', paddingBottom: 4,
      background: bg, boxShadow: `0px 4px 18px rgba(43,39,48,0.07), inset 0 -4px 0 ${edge}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.md, ...TOUCH_OPT,
    }}>
      <span style={{ ...TYPE.head, color: '#fff' }}>{label}</span>
      {Icon && <Icon size={18} weight="Bold" color="#fff" />}
    </button>
  );
}
// 보조 텍스트 버튼 — '닫기'/'나중에' 등. 14 Bold 회색(라인 24).
export function ModalTextButton({ label = '닫기', color = '#7E8A94', onClick }) {
  return (
    <button className="tg-press" onClick={onClick} style={{ width: '100%', padding: 0, background: 'none', border: 'none', cursor: 'pointer', ...TOUCH_OPT }}>
      <span style={{ ...TYPE.label, lineHeight: '24px', color }}>{label}</span>
    </button>
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
    // ★위로 떠오르던 '→ 2성' 큐는 제거(2026-08-06 사용자 결정) — 칩 바로 위가 '뜻' 줄이라 큐가 그 줄을 지나가 겹쳤다.
    //  변화 신호는 칩 자체(ˇ→／ 마크·색·라벨이 3성→2성으로 뒤집힘) + 카드 하단 규칙 문구가 담당한다.
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
      <span key={to2 ? '2' : '3'} style={{ display: 'inline-flex', alignItems: 'center', gap: SPACE.xs, padding: '3px 8px', borderRadius: RADIUS.pill,
        background: to2 ? c2 : c3, color: '#fff', transition: 'background .35s ease', transformStyle: 'preserve-3d',
        animation: reduce ? 'none' : (to2 ? 'tg-sandhi-pop .52s cubic-bezier(.34,1.7,.5,1) both' : 'tg-pop .3s cubic-bezier(.34,1.56,.64,1) both') }}>
        <ToneMark tone={to2 ? 2 : 3} size={ms} />
        <span style={{ ...TYPE.labelSm, fontSize: big ? 12 : 10 }}>{to2 ? '2성' : '3성'}</span>
      </span>
    </span>
  );
}

// 카드 하단 액션 버튼(발음 듣기·정답보기) — 시안 09 실측 스타일. 문구는 상태와 무관하게 고정.
const CARD_ACT_ICON = '#637481', CARD_ACT_TEXT = '#7E8A94';
const CARD_ACT_BTN = { height: 30, padding: '0 13px', borderRadius: 10, background: '#fff', border: '1px solid #E2E7EB', display: 'inline-flex', alignItems: 'center', gap: 6, ...TOUCH_OPT };

export function WordCard({ word, entered, currentSyl, completed, timedOut, progressText, reviewDots = null, floatScore, hideProgress, listen = false, audioOff = false, onReplay, onCantHear, draw = false, lianyinAt = -1, practice = false, onSpeak, onReveal, hideMeaning = false, hidePinyin = false, sandhiAt = -1 }) {
  const listening = listen && !audioOff && !completed && !timedOut; // 듣기 모드: 답하기 전엔 한자 가리고 소리 패널
  // hideMeaning/hidePinyin = 보조바퀴 토글(현재 컨텍스트) — 병음/뜻 숨김으로 '소리·성조 체득' 강화. ToneGamePage가 ctx별 값을 전달.
  // ※ 구 onHint('발음 힌트') 버튼은 제거 — 아래 액션 행이 onSpeak/onReveal을 항상 받아 이 분기가 렌더될 수 없었고,
  //   그 바람에 '발음을 들으면 콤보가 끊긴다'는 규칙이 통째로 사라져 있었다. 페널티는 onSpeak(발음 듣기)이 물려받음.
  const n = word.tones.length;
  let hz, colW, gap, twoRow = false, perRow = n;
  if (n <= 4) { hz = 66; colW = 72; gap = 14; }
  else if (n === 5) { hz = 44; colW = 52; gap = 8; }
  else { hz = 36; colW = 44; gap = 8; twoRow = true; perRow = Math.ceil(n / 2); }

  const glow = completed && !timedOut ? SHADOW.correctGlow : timedOut ? SHADOW.timeoutGlow : SHADOW.card;
  const guide = completed && !timedOut ? { text: '정답', color: TG.SUCCESS }
    : timedOut ? { text: '시간초과', color: TG.DANGER }
    // 진행 안내문은 제거(시안 09 — 카드엔 뜻·마크·한자만). 정답/시간초과 결과 문구만 남긴다.
    : { text: '', color: TG.GUIDE };

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
          ) : isCurrent ? (
            /* 현재 글자 포인터 — 시안 09(2026-08-04): 아래를 가리키는 라운드 삼각형(22×18, 모서리 r3, INK).
               구 28×5 가로 막대는 '어느 글자 차례인지'가 약했음. 라운드는 stroke+linejoin round로 만든다(둥근 삼각형 path 대체). */
            <svg width={hz > 50 ? 14 : 12} height={hz > 50 ? 12 : 10} viewBox="0 0 14 12" aria-hidden="true"
              style={{ display: 'block', animation: 'tg-pulse 1.1s ease-in-out infinite', overflow: 'visible' }}>
              {/* ★크기 기준은 폴리곤 박스(22×18)가 아니라 **실제 렌더 잉크 13.5×11.3** — Figma 폴리곤은 박스에 내접+라운드로 작아진다.
                  stroke 6(=r3 라운드)이 사방 3씩 키우므로 기본 삼각형은 7.5×5.3으로 잡는다. */}
              <polygon points="3,3 10.5,3 6.75,8.3" fill={TG.INK} stroke={TG.INK} strokeWidth="6" strokeLinejoin="round" />
            </svg>
          ) : null}
        </div>
        {listening && !revealed ? (
          // 듣기 중 미공개 글자 — 스피커. 맞히면 아래 한자로 공개됨.
          // 시안 09-5: 타일 66 · r16 · **배경/테두리 없음** · 스피커 아이콘 60(타일의 0.91).
          // 현재 글자 강조는 색(INK)과 breathe로만 — 베이지 박스는 시안에 없다.
          <div data-syl={i} style={{ width: hz, height: hz, borderRadius: RADIUS.lg, display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: isCurrent ? 'tg-breathe 1.7s ease-in-out infinite' : 'none', transition: `all ${DUR.state} ease` }}>
            <VolumeLoud size={Math.round(hz * 0.91)} weight="Bold" color={isCurrent ? TG.INK : TG.MUTED} />
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
          {completed && !hidePinyin && (
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
  // 규칙 문구(3성 변조·연음) — '정답'과 **같은 한 줄**을 교대로 쓴다(정답 먼저 → 잠시 뒤 규칙).
  //  ★줄을 하나 더 쌓으면 카드(272)에 19px이 모자라 한자가 밀리고 버튼이 바닥에 붙는다(2026-08-06 사용자 지적).
  //  등장 시점은 칩 모프(SandhiToneChip 1000ms)·연음 마크 그리기(≈0.6s)와 박자를 맞춘다.
  const note = showSandhi ? { text: '3성+3성 → 앞은 2성으로 발음', color: TONES.find((t) => t.num === 2)?.color ?? TG.SUB, delay: 1000 }
    : showLianyin ? { text: '연음 · 3성+2성은 반3성으로 이어서', color: LIANYIN_COLOR, delay: 700 }
    : null;
  const [noteOn, setNoteOn] = useState(false);
  useEffect(() => {
    if (!note) { setNoteOn(false); return undefined; }
    if (prefersReducedMotion()) { setNoteOn(true); return undefined; }
    setNoteOn(false);
    const t = setTimeout(() => setNoteOn(true), note.delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.text, word.hanzi]);

  return (
    <div style={{
      // 시안 09 실측: 342×272 · 안쪽 y = 진행13 · 뜻31 · 포인터77.8 · 한자101.3 · 버튼218(하단여백 24)
      position: 'relative', background: TG.CARD, borderRadius: RADIUS.card, width: '100%', height: 272, padding: '20px 20px 24px', overflow: 'hidden',
      display: 'flex', flexDirection: 'column', boxShadow: glow, transition: `box-shadow ${DUR.state} ease`,
    }}>
      {/* 좌상단 슬롯 — 복습이면 '이 단어의 졸업 진행'(동그라미), 그 외엔 문제 번호.
          복습에서 숫자(졸업단어수/전체)를 쓰면 "지금 이 단어를 몇 번 더 맞혀야 하나"가 안 보인다(2026-08-18). */}
      {!hideProgress && (reviewDots
        ? (
          <div
            role="img"
            aria-label={`졸업까지 ${reviewDots.total}번 중 ${reviewDots.done}번 완료`}
            style={{ position: 'absolute', left: 16, top: 15, display: 'flex', gap: 5, alignItems: 'center' }}
          >
            {Array.from({ length: reviewDots.total }, (_, i) => (
              <span key={i} style={{
                width: 9, height: 9, borderRadius: '50%',
                background: i < reviewDots.done ? TG.CORAL_DK : 'transparent',
                border: `1.5px solid ${i < reviewDots.done ? TG.CORAL_DK : TG.TRACK}`,
                transition: `background ${DUR.state} ease, border-color ${DUR.state} ease`,
              }} />
            ))}
          </div>
        )
        : (
          <div style={{ position: 'absolute', left: 16, top: 13, ...TYPE.num, fontSize: 16, display: 'flex', gap: SPACE.xs, alignItems: 'center' }}>
            <span style={{ color: TG.CORAL_DK }}>{progressText.split('/')[0]}</span>
            {/* 분모(총 문제수)는 있을 때만 — 무한모드는 숫자만이라 '/ ' 안 보이게 */}
            {progressText.split('/')[1] && <span style={{ color: TG.SUB, fontSize: 14 }}>/ {progressText.split('/')[1]}</span>}
          </div>
        )
      )}
      {/* 정답 판정(완벽/훌륭/좋아)+점수는 카드 코너가 아니라 화면 중앙 팝으로 — GameScreen JudgePop(시선 집중) */}
      {/* 뜻 — 듣기 중엔 가림(완료 시 공개="아 이 말이었구나"). 보조바퀴 토글로 숨기면 항상 가림 */}
      <div style={{ height: 22, marginTop: SPACE.lg, textAlign: 'center', flexShrink: 0 }}>
        {!listening && !hideMeaning && <span style={{ ...TYPE.sub, color: TG.SUB }}>{word.meaning}</span>}
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
          {/* 듣기 모드 버튼도 시안 09-5는 **일반 모드와 같은 규격** — 카드 하단 액션 버튼 스타일(CARD_ACT_*) 공용 */}
          <div style={{ display: 'flex', gap: 16 }}>
            <button onClick={onReplay} className="tg-press tg-hit44" style={{ ...CARD_ACT_BTN, cursor: 'pointer' }}>
              <VolumeLoud size={16} weight="Bold" color={CARD_ACT_ICON} />
              <span style={{ ...TYPE.labelSm, fontSize: 14, color: CARD_ACT_TEXT }}>발음 듣기</span>
            </button>
            <button onClick={onCantHear} className="tg-press tg-hit44" style={{ ...CARD_ACT_BTN, cursor: 'pointer' }}>
              <VolumeCross size={16} weight="Bold" color={CARD_ACT_ICON} />
              <span style={{ ...TYPE.labelSm, fontSize: 14, color: CARD_ACT_TEXT }}>지금은 못 들어요</span>
            </button>
          </div>
        </div>
      ) : (
        // 하단 블록 = 안내 한 줄(19) + 6 + 버튼(30) 자리를 **항상 확보**(55).
        //  안내가 없을 때도 높이가 같아, 정답을 맞혀도 한자·병음·버튼이 1px도 안 움직인다(2026-08-06).
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.sm, minHeight: 55, justifyContent: 'flex-end' }}>
          {/* 안내 한 줄 — 평소 '정답', 반3성·연음 단어면 그 자리를 규칙 문구가 물려받는다(줄 수·여백 불변) */}
          {noteOn && note ? (
            <span key="tg-note" style={{ ...TYPE.labelSm, color: note.color,
              animation: 'tg-pop .28s cubic-bezier(.34,1.56,.64,1) both' }}>{note.text}</span>
          ) : guide.text ? (
            <span key={guide.text} style={{ ...TYPE.label, color: guide.color, transition: `color ${DUR.state} ease`,
              // '정답'은 착탄 순간 등장(발사체 동기) — 진행 안내·시간초과는 즉시
              animation: (completed && !timedOut) ? `tg-pop .25s cubic-bezier(.34,1.56,.64,1) ${popDelay} both` : 'none' }}>{guide.text}</span>
          ) : null}
          {/* 발음 듣기 / 정답 보기 — 시안 09부터 **일반 모드에도** 노출(구 건너뛰기 대체). 정답보기는 횟수 제한 없음 */}
          {(onSpeak && onReveal) ? (
            /* 트레이닝·일반 공용. 트레이닝은 콤보·점수가 없어 무페널티, 일반은 발음듣기가 콤보를 끊는 기존 규칙 유지 */
            <div data-coach="prac-actions" style={{ display: 'flex', gap: 16 }}>
              {/* 시안 09 실측: 버튼 h30·r10·흰색+1px #E2E7EB / 아이콘 16 #637481 / 텍스트 14 #7E8A94 / 아이콘-텍스트 6 / 버튼 간격 16 */}
              <button onClick={onSpeak} className="tg-press tg-hit44" aria-label="발음 듣기"
                style={{ ...CARD_ACT_BTN, cursor: 'pointer' }}>
                <VolumeLoud size={16} weight="Bold" color={CARD_ACT_ICON} />
                <span style={{ ...TYPE.labelSm, fontSize: 14, color: CARD_ACT_TEXT }}>발음 듣기</span>
              </button>
              <button onClick={onReveal} disabled={completed} className="tg-press tg-hit44" aria-label="정답보기"
                style={{ ...CARD_ACT_BTN, cursor: completed ? 'default' : 'pointer', opacity: completed ? 0.5 : 1 }}>
                <DoubleAltArrowRight size={16} weight="Bold" color={CARD_ACT_ICON} />
                <span style={{ ...TYPE.labelSm, fontSize: 14, color: CARD_ACT_TEXT }}>정답보기</span>
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── 성조 버튼 5개 (성조색 소프트 틴트 배경) ────────────
// heat(0~1, 콤보 고조) — 리플이 콤보와 함께 커져 타격감이 자람.
// highlight — 튜토리얼 전용: 정답 키캡을 성조색 테두리+리플로 안내(게임에선 안 씀).
export function ToneButtons({ onTone, wrongBtn, disabled, heat = 0, highlight = null }) {
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
    <div style={{ display: 'flex', gap: 5.5, height: 81, alignItems: 'stretch' }}>
      {TONES.map((t) => {
        const isWrong = wrongBtn === t.num;
        return (
          <button
            key={t.num} onPointerDown={(e) => handleDown(e, t.num)} onClick={() => handleClick(t.num)} disabled={disabled} aria-label={t.name} data-nosfx="true"
            className={`tg-press ${isWrong ? 'tg-shake' : ''}`}
            style={{
              position: 'relative', overflow: 'hidden',
              flex: 1, minWidth: 0, height: '100%', cursor: disabled ? 'default' : 'pointer', borderRadius: RADIUS.xl,
              // ★흰 키캡 — 시안 '09. 게임'(2026-08-04): 흰 카드 + 1px 연한 테두리 + 아래 4px 안쪽 엣지.
              //   색은 성조 마크가 전담(키캡은 중립) → 배경 들판 위에서도 눌린 카드처럼 읽힌다.
              background: isWrong ? '#FFE9EA' : '#fff',
              border: highlight === t.num ? `2px solid ${t.color}` : '1px solid #E4EDF5',
              boxShadow: isWrong
                ? 'inset 0 -4px 0 #F0BCBE, 0 4px 18px rgba(43,39,48,0.04)'
                : highlight === t.num
                  ? `inset 0 -4px 0 #E4EDF5, 0 0 0 4px ${t.color}22`
                  : 'inset 0 -4px 0 #E4EDF5, 0 4px 18px rgba(43,39,48,0.04)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: 9,
              paddingTop: 20, paddingBottom: 0, color: t.color, ...TOUCH_OPT, // 마크(currentColor)=성조색
            }}
          >
            {/* 튜토리얼 정답 안내 리플 — 어디를 눌러야 하는지 시선 유도(2연속 무한).
                ★배경은 **탭 리플과 같은 옅은 틴트**. 구버전은 솔리드 `t.color`라 리플이 작게 시작하는 순간
                  마크와 같은 색의 진한 원이 마크를 통째로 삼켰다(2026-08-07 사용자 지적).
                  강조 자체는 버튼의 2px 테두리 + 4px 글로우가 이미 담당하므로 리플은 은은해도 충분하다. */}
            {highlight === t.num && [0, 750].map((delay) => (
              <span key={`hl${delay}`} aria-hidden="true" style={{
                position: 'absolute', left: '50%', top: '50%', width: 46, height: 46, borderRadius: '50%',
                background: `${TONE_KEY_COLORS[t.num].base}2E`, transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: 0,
                animation: `tg-ripple 1500ms ease-out ${delay}ms infinite`,
              }} />
            ))}
            {/* 탭 순간 리플 — 솔리드 성조색 배경이라 흰 리플로(같은 색이면 안 보임) */}
            {ripple && ripple.num === t.num && (
              <span key={ripple.key} aria-hidden="true" style={{
                position: 'absolute', left: '50%', top: '50%', width: 90 + heat * 50, height: 90 + heat * 50, borderRadius: '50%',
                background: `${TONE_KEY_COLORS[t.num].base}2E`, animation: 'tg-ripple .5s ease-out forwards', pointerEvents: 'none', zIndex: 0,
              }} />
            )}
            {/* ★마크는 리플 '위'에 — 리플 span들이 position:absolute(z-index:0)라, 위치 지정이 없는 마크는
                CSS 페인팅 순서상 그 아래로 깔린다. 관용 래퍼로 올려야 어떤 리플에도 안 가려진다. */}
            <span style={{ position: 'relative', zIndex: 1, display: 'flex' }}>
              <ToneMark tone={t.num} size={34} stroke={5.6} dotR={6} />
            </span>
            {/* 라벨 — 흰 키캡이라 아웃라인 스택 불필요. 시안 색(#7E8A94) 단색 */}
            <span style={{ position: 'relative', zIndex: 1, ...TYPE.labelSm, color: '#7E8A94' }}>{t.name}</span>
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
// 성조별 예시 획 path — 100×100 정사각 뷰박스 기준(y는 아래로 증가). 1성 수평 · 2성 상승 · 3성 V · 4성 하강.
//  튜토리얼에서만 쓴다(demoTone). 인게임은 빈 캔버스 유지 = 힌트가 되면 안 되므로.
const DEMO_STROKE = {
  1: 'M 18 42 L 82 42',
  2: 'M 20 70 L 80 30',
  3: 'M 20 30 L 50 72 L 80 30',
  4: 'M 20 30 L 80 70',
};

/* demoTone: 지정하면 '이렇게 그려요' 예시 획이 반복 재생된다(튜토리얼 전용). 사용자가 긋기 시작하면 사라짐. */
export function DrawPad({ expectedTone, onDraw, disabled = false, resetKey = 0, demoTone = null }) {
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
        // 시안 09-2: 평상시 **점선**(대시 8 / 간격 6) 코랄 테두리 — CSS dashed는 리듬이 6/6쯤이라 아래 SVG로 정확히 그린다.
        // 평상시엔 border를 빼고(box-sizing:border-box라 바깥 크기 불변) SVG가 그 2px 자리를 그린다. 판정 플래시 때만 실선 테두리.
        background: flash ? bg : '#fff', border: flash ? `2px solid ${borderCol}` : 'none',
        boxShadow: flash && flash.ok ? SHADOW.correctGlow : SHADOW.card,
        touchAction: 'none', WebkitTapHighlightColor: 'transparent', userSelect: 'none',
        cursor: disabled ? 'default' : 'crosshair', overflow: 'hidden',
        transition: 'border-color .15s ease, background .15s ease',
      }}>
      {/* 점선 테두리 — 사각형을 1px 안쪽에 두고 stroke 2를 걸치면 바깥 0~2px(테두리 자리)에 정확히 그려진다. 크기는 CSS calc(SVG 기하 속성)로 따라간다 */}
      {!flash && (
        <svg aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          <rect x="1" y="1" width="100%" height="100%" rx={RADIUS.xxl - 1} ry={RADIUS.xxl - 1}
            style={{ width: 'calc(100% - 2px)', height: 'calc(100% - 2px)' }}
            fill="none" stroke="#FF6B6B" strokeWidth="2" strokeDasharray="8 6" />
        </svg>
      )}
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
        (demoTone != null && DEMO_STROKE[demoTone]) ? (
          /* 예시 획(튜토리얼) — 정답 성조의 곡선이 스스로 그려지며 반복. 빈 점선 패드만 보고
             "뭘 어떻게 그으라는 거지"에서 멈추는 것을 막는다(2026-08-07 UX 검수). 모션 민감이면 정지 상태로. */
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', padding: SPACE.md }}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true"
              style={{ width: '100%', flex: 1, minHeight: 0, maxHeight: 190 }}>
              {/* 바탕 획(연하게 상시) + 그려지는 획 — 목표 모양이 늘 보이면서 방향까지 읽힌다 */}
              <path d={DEMO_STROKE[demoTone]} fill="none" stroke={TONE_COLORS[demoTone]} strokeOpacity={0.18} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
              <path d={DEMO_STROKE[demoTone]} fill="none" stroke={TONE_COLORS[demoTone]} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round"
                strokeDasharray={200}
                style={prefersReducedMotion()
                  ? { strokeDashoffset: 0 }
                  : { animation: 'tg-demo-stroke 2.4s ease-in-out infinite' }} />
            </svg>
            <span style={{ ...TYPE.btn, color: TG.INK, marginTop: SPACE.md }}>이렇게 따라 그려보세요</span>
          </div>
        ) : (
          /* 빈 상태 안내 — 힌트 없이 '여기 그려요'만 */
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: SPACE.lg, pointerEvents: 'none', padding: SPACE.md }}>
            <div style={{ width: 52, height: 52, borderRadius: RADIUS.card, background: TG.CORAL_BG, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width={30} height={30} viewBox="0 0 60 60" fill="none" aria-hidden="true">
                <path d="M 14 38 C 20 22 26 22 30 30 C 34 38 40 38 46 22" stroke={TG.CORAL} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span style={{ ...TYPE.btn, color: TG.INK }}>성조를 그려보세요</span>
          </div>
        )
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
// 시안 08(2026-08-05 수정): 숫자 + 안내문 **둘만**. 난이도 핀은 시안에서 삭제됨(어느 스테이지인지는 인게임 헤더가 알려준다).
export function CountdownVisual({ n }) {
  return (
    <>
      {/* 숫자 160 박스 (시안 y300.3 = 35.6%) — 글리프 120px, 코랄 그림자.
          ★센터링은 바깥 래퍼가 담당: tg-count 키프레임이 transform을 덮어써 translateX(-50%)가 무시된다(반복 함정) */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: '35.6%', display: 'flex', justifyContent: 'center' }}>
        <div key={n} style={{
          width: 160, height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center',
          filter: 'drop-shadow(0px 14px 15px rgba(242,72,76,0.3))', animation: 'tg-count .85s ease forwards',
        }}>
          <span style={{ ...TYPE.numHero, fontSize: 120, color: '#fff', lineHeight: 'normal' }}>{n > 0 ? n : ''}</span>
        </div>
      </div>
      {/* 안내문 (시안 y454.3 = 53.8%) — 15px Bold */}
      <Reveal i={1} base={140} style={{ position: 'absolute', left: 0, right: 0, top: '53.8%' }}>
        <span style={{ display: 'block', ...TYPE.btnSm, color: '#fff', textAlign: 'center' }}>성조를 찾아 탭하세요!</span>
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

// 들판 배경 — Figma "04. 모드선택 — 무한모드잠김/해제"(2026-08-03) 리디자인.
//  동산·나무·집·돌·구름이 벡터 조각 20여 개라 SVG 1장(public/game/mode-field.svg, 390×396)으로 export해 사용.
//  ★프레임 클리핑(마스킹) 없이 원본 전체(1287×942)를 뽑아 **원래 크기 그대로** 얹는다(2026-08-03 2차 수정).
//   - 구: 390폭 클리핑본 + objectFit:cover → 화면이 넓으면 위가 잘려 집·나무가 반토막(사용자 지적).
//   - 신: 스케일 0 = 세로는 절대 안 잘림. 가로는 화면보다 넓은 그림의 가운데를 보여줌(넓을수록 들판이 더 보임).
//   - bottom:-546 = 시안에서 그림 아래가 화면 밖으로 내려가 있던 값 → 지평선이 항상 바닥에서 396px.
const FIELD_W = 1287, FIELD_H = 942, FIELD_BOTTOM = -546;
const CHIMNEY = { x: 592.5, y: 101 }; // 그림 좌표계의 굴뚝 입구(연기 발원점)
// artRef — 그림 컨테이너 ref(패럴랙스용). 난이도 화면이 스크롤에 맞춰 translateY를 직접 써서 배경을 같이 움직인다.
//   (transform은 항상 `translateX(-50%) translateY(N)` 형태로 유지할 것 — 가로 센터링이 transform에 있음)
export function FieldBg({ artRef }) {
  const reduced = prefersReducedMotion();
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
      <div ref={artRef} style={{ position: 'absolute', left: '50%', bottom: FIELD_BOTTOM, width: FIELD_W, height: FIELD_H, transform: 'translateX(-50%)', willChange: 'transform' }}>
        <img src="/game/mode-field.svg" alt="" style={{ display: 'block', width: FIELD_W, height: FIELD_H, maxWidth: 'none' }} />
        {/* 굴뚝 연기 — 타이틀 화면과 같은 연출(피어올라 커지며 옅어짐 + 좌우 흔들림). 정적 퍼프는 SVG에서 제거했다 */}
        <div style={{ position: 'absolute', left: CHIMNEY.x, top: CHIMNEY.y }}>
          {reduced ? (
            <>
              <div style={{ position: 'absolute', left: -10.5, top: -17, width: 12, height: 11, borderRadius: 35, background: '#EEE9D3' }} />
              <div style={{ position: 'absolute', left: -4.5, top: -52, width: 38, height: 34, borderRadius: 35, background: '#EEE9D3' }} />
              <div style={{ position: 'absolute', left: -61.5, top: -101, width: 65, height: 58, borderRadius: 35, background: '#EEE9D3' }} />
            </>
          ) : (
            [0, 1, 2].map((i) => (
              // 상승·팽창(linear)과 좌우 흔들림(alternate)을 분리 — 한 키프레임에 합치면 방향 전환이 뚝 끊김
              <div key={i} style={{ position: 'absolute', left: -32, top: -29, animation: `tg-smoke-rise 5s linear ${(-i * 5) / 3}s infinite` }}>
                <div style={{ width: 65, height: 58, borderRadius: 35, background: '#EEE9D3', animation: `tg-smoke-sway ${2.3 + i * 0.4}s ease-in-out ${-i * 0.9}s infinite alternate` }} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── 게임 무대(스테이지) ────────────────────────────────
// 게임 전체를 9:16 가운데 컬럼 하나로 가둔다. 바깥(레터박스)엔 아무것도 안 보인다.
//  ★핵심: 컬럼에 transform을 걸면 CSS상 '고정 위치의 컨테이닝 블록'이 되어, 안쪽 position:fixed 요소
//    (모달·시트·코치마크·전환·토스트)까지 전부 이 컬럼 기준으로 배치되고 overflow:hidden에 잘린다.
//    transform 없이는 fixed가 뷰포트 기준이라 PC에서 창 전체로 퍼진다(2026-08-03 사용자 요청).
export function GameStage({ children }) {
  return (
    // height:100dvh = '지금 실제로 보이는 높이'. iOS에서 fixed+inset:0은 툴바가 접힌 큰 뷰포트 기준으로
    //  잡혀 하단(탭바)이 툴바 뒤로 숨고, 그걸 드러내려 페이지가 스크롤되며 화면이 통째로 밀린다.
    //  inset:0은 dvh 미지원 브라우저용 폴백으로 남긴다(높이가 지정되면 bottom은 무시됨).
    <div style={{ position: 'fixed', inset: 0, height: '100dvh', background: TG.BG, display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
      {/* data-tg-stage — document.body로 포탈되는 코치마크가 이 컬럼 좌표를 읽어 밖으로 안 새게 클리핑한다 */}
      <div data-tg-stage="" style={{ position: 'relative', width: '100%', maxWidth: TG_COL_MAXW, height: '100%', overflow: 'hidden', transform: 'translateZ(0)' }}>
        {children}
      </div>
    </div>
  );
}

// ── 화면전환 레이어 ────────────────────────────────────
// 카운트다운·'오늘의 팁' 웨이브 전환의 공용 껍데기. 실제로 슬라이드하는 건 **게임 컬럼(9:16)** 뿐이다.
//  구조: fixed inset0(입력 차단·레터박스 클리핑) > 가운데 컬럼(애니메이션 적용) > 배경색 + 안전영역 콘텐츠.
//  ⚠️ 2026-08-03 수정 전에는 fixed inset0 자체가 슬라이드해서, PC 와이드에서 '창 전체가 밀리는' 느낌이었다.
//     콘텐츠(FigmaScreen)는 9:16 컬럼인데 전환만 창 전체라 폭이 어긋난 게 원인.
export function TxLayer({ style, bg = '#f96c6e', children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
      <div style={{ position: 'relative', width: '100%', maxWidth: TG_COL_MAXW, height: '100%', ...style }}>
        {/* 좌우 물결 가장자리 — 컬럼 바깥이라 정지 상태에선 안 보이고, 슬라이드 중에만 걸쳐 보인다 */}
        <CdWaveEdge side="left" color={bg} />
        <CdWaveEdge side="right" color={bg} />
        <div style={{ position: 'absolute', inset: 0, background: bg, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 'env(safe-area-inset-top)', bottom: 0, left: 0, right: 0 }}>{children}</div>
        </div>
      </div>
    </div>
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
  const Icon = kind === 'done' ? CheckCircle : kind === 'info' ? null : Lock;
  // 광학 중앙 보정: 정중앙(50%)이면 눈에는 아래로 쏠려 보임(하단 CTA로 무게중심도 아래) → 하단 패딩을 키워 살짝 위로.
  // 애니메이션(tg-toast)이 transform:translateY를 쓰므로 토스트 박스가 아닌 바깥 컨테이너 패딩으로 올림. safe-area-top도 함께 정합.
  return (
    <div style={{ position: 'fixed', top: 'env(safe-area-inset-top)', bottom: 0, left: 0, right: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', padding: '24px 24px calc(24px + 12vh)' }}>
      <div className="tg-toast" style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, background: 'rgba(43,39,48,0.94)', boxShadow: '0 8px 22px rgba(26,16,20,0.28)', borderRadius: RADIUS.lg, padding: '12px 18px 12px 16px', maxWidth: '90%' }}>
        {Icon && <Icon size={16} weight="Bold" color="#fff" style={{ flexShrink: 0 }} />}
        <span style={{ ...TYPE.sub, color: '#fff', whiteSpace: 'normal', lineHeight: 1.35, wordBreak: 'keep-all' }}>{msg}</span>
      </div>
    </div>
  );
}

// ── 설정 토글 행(공용) ─────────────────────────────────
// 소리·음악·햅틱·단어 뜻·병음 한 줄. 시안 461:212(메뉴 모달)·807:724(일시정지 모달) 동일 규격:
//  행 36 · 아이콘 27 · 라벨 16 Bold · 스위치 46×27(노브 21). 홈 메뉴와 일시정지 모달이 같은 컴포넌트를 쓴다.
export function MenuToggle({ Icon, label, on, onToggle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', height: 36 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.xl }}>
        <Icon size={27} weight="Bold" color={on ? TG.CORAL_DK : TG.MUTED} />
        <span style={{ ...TYPE.btn, color: TG.INK }}>{label}</span>
      </div>
      <button onClick={onToggle} role="switch" aria-checked={on} aria-label={label} className="tg-press"
        style={{ width: 46, height: 27, borderRadius: RADIUS.lg, border: 'none', cursor: 'pointer', padding: 0, background: on ? TG.CORAL_DK : TG.MUTED, position: 'relative', transition: 'background .2s ease', ...TOUCH_OPT }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 22 : 3, width: 21, height: 21, borderRadius: RADIUS.md, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left .18s ease' }} />
      </button>
    </div>
  );
}

// 보조바퀴 토글 행(공용) — '단어카드설정: 뜻/병음'. ctx별 저장(스테이지 easy-1·보스 easy-boss·무한 endless·트레이닝 training·테마 th-drama).
//  각 시작 화면(스테이지 카드·무한 모달·테마)·인게임 설정에서 재사용. key={ctx}로 렌더하면 컨텍스트 바뀔 때 저장값으로 재초기화.
export function CrutchRow({ ctx, style }) {
  const [meaningOn, setMeaningOn] = useState(() => !isMeaningHidden(ctx));
  const [pinyinOn, setPinyinOn] = useState(() => !isPinyinHidden(ctx));
  // 클릭음은 전역 pointerdown 핸들러(.tg-press)가 재생 — 여기서 playSfx 호출하면 이중음
  const items = [
    { label: '뜻', on: meaningOn, t: (e) => { e.stopPropagation(); const n = !meaningOn; setMeaningOn(n); setMeaningHidden(ctx, !n); } },
    { label: '병음', on: pinyinOn, t: (e) => { e.stopPropagation(); const n = !pinyinOn; setPinyinOn(n); setPinyinHidden(ctx, !n); } },
  ];
  return (
    <div style={{ paddingTop: SPACE.md, borderTop: `1px solid ${TG.BORDER}`, display: 'flex', alignItems: 'center', ...style }}>
      <span style={{ ...TYPE.meta, color: TG.MUTED }}>단어카드설정</span>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: SPACE.x2 }}>
        {items.map((cc) => (
          <div key={cc.label} style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
            <span style={{ ...TYPE.btnSm, color: cc.on ? TG.INK : TG.MUTED }}>{cc.label}</span>
            {/* div role=switch (button 아님) — 테마 카드가 ShakeButton(button) 안이라 버튼 중첩 금지 회피 */}
            <div onClick={cc.t} role="switch" aria-checked={cc.on} aria-label={cc.label} tabIndex={0} className="tg-press"
              style={{ width: 42, height: 24, borderRadius: RADIUS.lg, cursor: 'pointer', position: 'relative', flexShrink: 0, background: cc.on ? TG.CORAL_DK : TG.MUTED, transition: 'background .2s ease', ...TOUCH_OPT }}>
              <span style={{ position: 'absolute', top: 3, left: cc.on ? 21 : 3, width: 18, height: 18, borderRadius: RADIUS.md, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left .18s ease' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 공통 하단 탭바 — 홈 허브 리디자인(2026-07-27, 사용자 Figma 시안 정밀 추출값). 놀러가기·오답 노트·홈·업적·하늘하늘 5탭.
// 활성 탭 = 레드 키캡(110×74·r30 상단·인너 -4px 엣지), 비활성 = 듀오톤(BoldDuotone) 40px + 라벨 12.
// 활성 아이콘도 BoldDuotone(흰색)로 글리프 동일 유지 — 홈 활성만 시안 커스텀(흰 몸체+레드 도어).
export const TAB_BAR_H = 90; // 화면 콘텐츠 paddingBottom 계산용(+ env(safe-area-inset-bottom))
const TG_TABS = [
  { key: 'play', label: '놀러가기', Icon: HandStars },
  { key: 'mastery', label: '오답 노트', Icon: NotebookBookmark }, // 시안 개선안(442:2) — 라벨·아이콘 교체. 목적지는 아직 '내 등급'
  { key: 'home', label: '홈', Icon: HomeIcon },
  { key: 'ach', label: '업적', Icon: Cup },
  { key: 'hub', label: '하늘하늘', Icon: Stars },
];
// 홈 활성 아이콘 — 시안 그대로: 몸체 흰 솔리드 + 도어바 레드(배경 컷아웃)
function HomeActiveIcon({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2 12.2039C2 9.91549 2 8.77128 2.5192 7.82274C3.0384 6.87421 3.98695 6.28551 5.88403 5.10813L7.88403 3.86687C9.88939 2.62229 10.8921 2 12 2C13.1079 2 14.1106 2.62229 16.116 3.86687L18.116 5.10812C20.0131 6.28551 20.9616 6.87421 21.4808 7.82274C22 8.77128 22 9.91549 22 12.2039V13.725C22 17.6258 22 19.5763 20.8284 20.7881C19.6569 22 17.7712 22 14 22H10C6.22876 22 4.34315 22 3.17157 20.7881C2 19.5763 2 17.6258 2 13.725V12.2039Z" fill="#FFFFFF" />
      <path d="M9 17.25C8.58579 17.25 8.25 17.5858 8.25 18C8.25 18.4142 8.58579 18.75 9 18.75H15C15.4142 18.75 15.75 18.4142 15.75 18C15.75 17.5858 15.4142 17.25 15 17.25H9Z" fill={HOME.TAB_RED} />
    </svg>
  );
}
// 탭 전환 애니메이션 — 아이콘·라벨은 제자리, **빨간 키캡 배경만** 별도 레이어로 이전 탭 → 새 탭 슬라이드(사용자 요청).
// 화면(탭바 인스턴스)이 통째로 바뀌므로 직전 탭은 모듈 변수로 기억(FLIP). Web Animations API라 keyframes 충돌 없음.
let tgLastTab = null;
// dot = 레드닷을 띄울 탭 key(예: 'ach') | null. 지금은 '업적'의 미확인 획득 알림 하나만 쓴다.
export function TgTabBar({ active, onNav, dot = null }) {
  const barRef = useRef(null);
  const pillRef = useRef(null);
  useLayoutEffect(() => {
    const bar = barRef.current, pill = pillRef.current;
    if (!bar || !pill) return undefined;
    // 슬롯 left 계산 — 활성 110 고정, 비활성은 남는 폭 4등분(flex:1과 동일)
    const place = (animFromKey) => {
      const W = bar.clientWidth - 12; // 좌우 패딩 6
      const iw = (W - 109) / 4;
      const leftOf = (activeKey, slotKey) => {
        let x = 6;
        for (const t of TG_TABS) {
          const w = t.key === activeKey ? 109 : iw;
          if (t.key === slotKey) return x;
          x += w;
        }
        return 6;
      };
      const nx = leftOf(active, active);
      pill.style.transform = `translateX(${nx}px)`;
      if (animFromKey) {
        const EASE = { duration: 280, easing: 'cubic-bezier(.22,1,.36,1)' };
        const px = leftOf(animFromKey, animFromKey); // 이전 레이아웃에서의 옛 키캡 위치
        if (Math.abs(px - nx) > 1) pill.animate(
          [{ transform: `translateX(${px}px)` }, { transform: `translateX(${nx}px)` }], EASE,
        );
        // 버튼들도 FLIP — 간격이 벌어지고 좁혀지는 재배치가 순간이동 대신 같은 타이밍으로 흐르게(중심 기준).
        const centerOf = (activeKey, slotKey) => leftOf(activeKey, slotKey) + (slotKey === activeKey ? 109 : iw) / 2;
        const btns = [...bar.children].filter((el) => el.tagName === 'BUTTON');
        btns.forEach((el, i) => {
          const key = TG_TABS[i].key;
          const dx = centerOf(animFromKey, key) - centerOf(active, key);
          if (Math.abs(dx) > 1) el.animate(
            [{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0)' }], EASE,
          );
        });
      }
    };
    const prev = tgLastTab;
    tgLastTab = active;
    place(prev && prev !== active ? prev : null);
    const onResize = () => place(null);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [active]);
  return (
    <div ref={barRef} style={{
      position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 30,
      height: `calc(${TAB_BAR_H}px + env(safe-area-inset-bottom))`,
      background: HOME.CARD,
      display: 'flex', alignItems: 'flex-start', padding: '8px 6px 0',
    }}>
      {/* 상단 구분선 2px — 시안 개선안(442:2) 추가. 흰 탭바가 밝은 바닥과 붙어 경계가 사라지는 걸 막음 */}
      <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 2, background: HOME.TAB_BORDER }} />
      {/* 이동하는 키캡 배경 — 버튼들 아래 레이어(버튼은 position:relative로 위에) */}
      {/* 시안 개선안(442:2, 2026-08-04): 바닥에 붙은 키캡 → **전 모서리 r20으로 떠 있는 키캡** 109×74 @top8 */}
      <div ref={pillRef} aria-hidden="true" style={{ position: 'absolute', left: 0, top: 8, width: 109, height: 74, borderRadius: 20, background: HOME.TAB_RED, willChange: 'transform' }} />
      {TG_TABS.map(({ key, label, Icon }) => {
        const on = key === active;
        return (
          <button key={key} className="tg-press" onClick={() => { if (!on) onNav(key); }}
            aria-label={label} aria-current={on ? 'page' : undefined} style={on ? {
              position: 'relative', width: 109, flexShrink: 0, height: 74, border: 'none', cursor: 'default',
              background: 'transparent',
              paddingTop: 10, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
              display: 'flex', flexDirection: 'column', alignItems: 'center', ...TOUCH_OPT,
            } : {
              position: 'relative', flex: 1, minWidth: 0, height: 68, border: 'none', cursor: 'pointer', background: 'transparent', borderRadius: 16,
              // ★shorthand(padding) 금지 — 탭바가 화면 전환에도 살아남게 되면서 같은 버튼이 활성↔비활성으로 바뀐다.
              //  shorthand와 longhand를 섞으면 React가 "conflicting property" 경고를 낸다(2026-08-06).
              paddingTop: 10, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
              display: 'flex', flexDirection: 'column', alignItems: 'center', ...TOUCH_OPT,
            }}>
            {/* 아이콘 + 레드닷 — 닷은 **아이콘 우상단**에 얹는다(라벨이 아니라 아이콘 기준).
                흰 링을 둘러 활성(빨간 키캡) 위에서도 점이 묻히지 않게 한다. */}
            <span style={{ position: 'relative', display: 'flex' }}>
              {on && key === 'home'
                ? <HomeActiveIcon size={40} />
                : <Icon size={40} weight="BoldDuotone" color={on ? '#fff' : HOME.TAB_INACTIVE} />}
              {dot === key && (
                <span aria-hidden="true" style={{ position: 'absolute', top: 1, right: 1, width: 10, height: 10 }}>
                  {/* 파문 — 점 뒤에서 퍼졌다 사라짐. 모션 최소화 설정에선 생략 */}
                  {!prefersReducedMotion() && (
                    <span style={{
                      position: 'absolute', inset: 0, borderRadius: '50%', background: TG.CORAL,
                      animation: 'tg-dot-ring 2.2s ease-out infinite',
                    }} />
                  )}
                  {/* 점 자체는 가만히 있는다 — 흰 테두리·튀는 모션 없이 파문만으로 주목시킨다(2026-08-10 사용자) */}
                  <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: TG.CORAL }} />
                </span>
              )}
            </span>
            <span style={{ ...TYPE.labelSm, fontWeight: 800, color: on ? '#fff' : HOME.TAB_INACTIVE, lineHeight: '14px' }}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
