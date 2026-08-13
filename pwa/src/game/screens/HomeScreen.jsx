// 홈 허브 — 게임 로비. 플랫 카툰 룸(벽·몰딩·타일 바닥) 안을 성조마크 캐릭터(idle/walk/talk)가 돌아다님.
// 좌상단 내 정보(아바타+등급명+게이지%) · 우상단 메뉴 · 중앙 하단 스트릭+게임시작 키캡 CTA · 하단 공통 탭바.
// 2026-07-27 리디자인(사용자 Figma 시안 442:2): 2.5D 원근·바닥 영토 제거, 도크·플로팅 허브 → 탭바로 통합.
import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import {
  Settings, Play, Flame, Snowflake,
  QuestionCircle, Logout, AltArrowRight, AltArrowLeft, VolumeLoud, VolumeCross, SmartphoneVibration, CloseCircle,
  MusicNotes, MusicNote, Pen, InfoCircle, LinkCircle, Notebook, TextField, Refresh, TrashBinTrash,
} from '@solar-icons/react';
import { TG, HOME, TYPE, TOUCH_OPT, TONE_KEY_COLORS, FONT_HANZI, FONT_PINYIN, haptic, isHapticMuted, setHapticMuted, isMeaningHidden, setMeaningHidden, isPinyinHidden, setPinyinHidden, RADIUS, SPACE } from '../tgTokens.js';
import { TONE_SAMPLES } from '../tutorialWords.js';
import { speakWord } from '../tgTts.js';
import { TONES } from '../../constants/toneGameWords.js';
import { ToneMark, useCountUp } from '../tgWidgets.jsx';
import { rankInfo, levelInfo } from '../gameXp.js';
import { play as playSfx, isSfxMuted, setSfxMuted } from '../tgSfx.js';
import { isBgmMuted, setBgmMuted, startBgm } from '../tgBgm.js';
import { EmberRise, MenuToggle, TgTabBar, TAB_BAR_H, TG_COL_MAXW, ModalCard, ModalBody, KeycapCta, ModalTextButton } from './shared.jsx';
import { markSize, Eyes } from './eyes.jsx';
import { DebugScoreModal } from './gameModals.jsx';
import { resetGameData, getMemberSession } from '../gameStore.js';
import { deleteGameMe } from '../../api/gameApi.js';
import { NicknameEditModal } from './NicknameEditModal.jsx';
import { ProfileModal } from './ProfileModal.jsx';
import CoachMarkOverlay from '../../components/ui/CoachMarkOverlay.jsx';
import { useTabTip } from '../../hooks/useTabTip.js';

// 홈 허브 코치마크 — 첫 방문 1회(useTabTip 'game-home'). 학생앱과 동일한 스포트라이트 오버레이 재사용.
// 캐릭터는 계속 움직여 스포트라이트 고정이 안 되므로 방 소개는 selector:null(중앙 툴팁)로.
const COACH_STEPS = [
  { selector: null, label: '여긴 성조 친구들이 사는 방이에요. 친구를 탭하면 그 성조의 실력을 볼 수 있어요 🎵' },
  { selector: '[data-coach="tg-myinfo"]', label: '게임을 할수록 등급이 올라가요. 탭하면 등급 상세를 볼 수 있어요.' },
  { selector: '[data-coach="tg-streak"]', label: '매일 한 판이면 연속학습이 쌓여요. 불꽃을 키워보세요! 🔥' },
  // ★버튼 라벨과 같은 말을 쓸 것 — '플레이'라고 안내하면 화면엔 없는 버튼을 찾게 된다(2026-08-07 UX 검수)
  { selector: '[data-coach="tg-play"]', label: '다음 판은 여기서! [모드 선택]을 눌러 시작해요.' },
];

// 방 지오메트리(플랫) — 몰딩 하단(146) 아래가 바닥. 캐릭터 걷기 영역은 렌더의 컨테이너가 정의.
const ROOM_TOP = 146;

// 캐릭터 말풍선 카피 — 성조별 풀(랜덤)
const TALK_LINES = {
  1: ['1성!', '안녕!', '같이 놀자'],
  2: ['2성~', '올라가요', '신난다'],
  3: ['3성!', '요리조리', '쉿—'],
  4: ['4성!', '데구르르', '간다!'],
  0: ['경성…', '졸려~', '히히'],
};
// 방 안을 돌아다니는 성조마크 — 캐릭터마다 고유 이동속도(px/s). rAF로 매 프레임 그 속도만큼
// 랜덤 목표를 향해 걸음(거리 무관 속도 일정) → 도착 후 idle/talk 쉼 → 새 목표. 탭하면 점프+성조 외침.
const MARK_W = 70, MARK_H = 46, WALL_M = 24; // 마크 대략 크기 + 벽 여백
// 모든 캐릭터(메인+팔로워) 충돌박스 공유 — id → {x,y,r}. 겹치면 절반씩 밀어내 안 겹치게.
const COLL = new Map();
function resolveColl(id, x, y, r) {
  for (const [oid, o] of COLL) {
    if (oid === id) continue;
    const ox = x - o.x, oy = y - o.y, d = Math.hypot(ox, oy), minD = r + o.r;
    if (d > 0.01 && d < minD) { const push = (minD - d) / 2; x += (ox / d) * push; y += (oy / d) * push; }
  }
  return [x, y];
}
// ── 성조 듀엣(캐릭터끼리 대화) ──────────────────────────────
// 가까이 있는 두 캐릭터가 잠깐 마주보고 번갈아 한마디씩(각자 성조 소리) 주고받는다.
// 각 WanderingMark가 mount 시 대화 API를 MARKS에 등록 → 발화 시작자가 근처 자유 파트너를 찾아 스크립트 진행.
//  reserve(즉시 마주봄·정지) → A speak(부름) → 1.15s 뒤 B speak(응답) → 2.6s 뒤 둘 다 release(복귀).
const MARKS = new Map();
// 인사·리액션 짝(부름 → 응답). 짧게(말풍선 한 줄). 성조 소리는 각자 speak가 냄 → 지나가듯 성조를 또 듣게 됨(게임 정체성).
const DUET = [
  ['안녕!', '안녕~'], ['같이 놀래?', '좋아!'], ['뭐해?', '히히'], ['기분 좋다~', '나도!'],
  ['내 성조 어때?', '멋져!'], ['짠!', '우와~'], ['오늘도 화이팅', '읏차!'], ['들어봐', '오~'],
];
const CHAT_RANGE = 150;   // 물리평면 px — 이 안에 자유로운 파트너가 있으면 대화
let chatCooldown = 0;     // 모듈 전역 최소 간격(대화 과다 방지) — 방 전체에서 한 번에 한 듀엣만
// A(발화 시작자 id)가 근처 자유 파트너 B를 찾아 듀엣 시작. 성공 시 true(→ A는 대화 상태로 전환됨).
function startDuet(aId, range = CHAT_RANGE) {
  const a = MARKS.get(aId); if (!a) return false;
  const now = performance.now();
  if (now < chatCooldown) return false;
  const ap = a.getPos();
  let b = null, bId = null, best = range;
  for (const [oid, o] of MARKS) {
    if (oid === aId || !o.free()) continue;
    const op = o.getPos(), d = Math.hypot(ap.x - op.x, ap.y - op.y);
    if (d < best) { best = d; b = o; bId = oid; }
  }
  if (!b) return false;
  chatCooldown = now + 5200;
  const bp = b.getPos();
  const [l1, l2] = DUET[Math.floor(Math.random() * DUET.length)];
  a.reserve(bp.x, bp.y); b.reserve(ap.x, ap.y);   // 둘 다 즉시 예약(마주보고 정지) → 다른 틱이 못 데려감
  a.speak(l1, bp.x, bp.y);                          // A 부름
  // 1.15s 뒤 B 응답(A 말풍선은 지움 → 턴테이킹). 언마운트 안전: 매번 MARKS에서 다시 조회.
  setTimeout(() => {
    const A = MARKS.get(aId), B = MARKS.get(bId);
    if (A && B) { A.hush(); const p = A.getPos(); B.speak(l2, p.x, p.y); }
    else if (A) A.release();
  }, 1150);
  // 2.6s 뒤 종료
  setTimeout(() => { const A = MARKS.get(aId), B = MARKS.get(bId); if (A) A.release(); if (B) B.release(); }, 2600);
  return true;
}
// DEV 전용 검수 훅 — 근접·쿨다운 무시하고 즉시 듀엣(프로덕션 빌드에선 import.meta.env.DEV=false → dead-code 제거).
if (typeof window !== 'undefined' && import.meta.env && import.meta.env.DEV) {
  window.__tgForceDuet = () => { chatCooldown = 0; const id = [...MARKS.keys()][0]; return id ? startDuet(id, Infinity) : false; };
  window.__tgKickBall = (vx = 320, vy = -230) => { if (!BALL.live) return false; BALL.vx = vx; BALL.vy = vy; BALL.fx = Math.hypot(vx, vy); return true; };
}

// 단일 rAF 티커 — 캐릭터(메인 5)마다 독립 rAF 루프를 돌리던 것을 하나로 합침.
// 등록된 update 콜백(Set)을 한 프레임에 순회하고, 콜백이 0개가 되면 루프 정지.
const TICKS = new Set();
let ticksRaf = 0;
const runTicks = (now) => { for (const cb of TICKS) cb(now); ticksRaf = TICKS.size ? requestAnimationFrame(runTicks) : 0; };
const addTick = (cb) => { TICKS.add(cb); if (!ticksRaf) ticksRaf = requestAnimationFrame(runTicks); };
const removeTick = (cb) => { TICKS.delete(cb); if (!TICKS.size && ticksRaf) { cancelAnimationFrame(ticksRaf); ticksRaf = 0; } };

// 마크 크기(markSize)·눈(EYES/Eyes)은 ./eyes.jsx 공용 모듈 사용(정본 — 홈 버전에서 추출됨).
// 레벨 → 캐릭터 크기 배율(성장). lv1 작게 → lv4가 최대(1.0=기본크기), lv4 이상은 캡. 색상 변화는 안 씀(사용자 요청).
const levelScale = (lv) => 0.62 + (Math.min(5, Math.max(1, lv || 1)) - 1) / 4 * 0.48; // lv1=.62 lv2=.74 lv3=.86 lv4=.98 lv5=1.1 (레벨 격차 강화)

// 평면 좌표(원근 제거 — 2026-07-27 리디자인). 물리 좌표 = 화면 좌표 그대로.
// 깊이감은 zIndex만 y 기준 유지(앞(아래쪽) 캐릭터가 뒤 캐릭터를 겹쳐 가림). 크기 변환 없음(레벨 크기만).
function project(x, y, W, H) {
  const d = H > 0 ? Math.min(1, Math.max(0, y / H)) : 0.5; // 0=뒤 … 1=앞(zIndex용)
  return [x, y, 1, d];
}
// 플랫 카툰 룸 v2 — 사용자 Figma 시안(442:2, 2026-07-27 2차 수정) 그대로.
// 벽 = 탄 바탕 + 연크림 세로 패널(20w·40피치, x5 시작) · 하부 = 브라운 웨인스코팅(패널 아웃라인 장식)
// 창문 = 상단 차양판 + 프레임(스트로크 없음) + 유리 상단 하드섀도 + 두께감 창턱. 다크 브라운 라인은 시안에서 제거됨.
const TILE_PATTERN = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='90' height='70'><rect x='0' y='0' width='40' height='30' rx='8' fill='${HOME.TILE}'/><rect x='45' y='35' width='40' height='30' rx='8' fill='${HOME.TILE}'/></svg>`,
)}")`;
const PANEL_LINE_PATTERN = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='39'><rect x='5.5' y='0.5' width='19' height='25' fill='none' stroke='${HOME.PANEL_LINE}'/></svg>`,
)}")`;
function RoomWindow({ left, right }) {
  // 유리 4장 — 모서리는 창틀 바깥쪽만 2px(per-corner), 위 2장은 차양 하드섀도(0 2px)
  const glassR = ['2px 0 0 0', '0 2px 0 0', '0 0 0 2px', '0 0 2px 0'];
  return (
    <div style={{ position: 'absolute', left, right, top: 12, width: 76, height: 60 }}>
      {/* 상단 차양 판 — 프레임보다 2.3px 위로 노출 */}
      <div style={{ position: 'absolute', left: 3, top: 0, width: 70, height: 36, borderRadius: 4, background: HOME.MOLD_LIGHT }} />
      {/* 프레임 + 유리 2×2 */}
      <div style={{ position: 'absolute', left: 3, top: 2.3, width: 70, height: 55, borderRadius: 4, background: HOME.MOLD_MID, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 4, padding: 4, boxSizing: 'border-box' }}>
        {[0, 1, 2, 3].map((k) => <div key={k} style={{ background: HOME.GLASS, borderRadius: glassR[k], boxShadow: k < 2 ? `0 2px 0 ${HOME.MOLD_LIGHT}` : 'none' }} />)}
      </div>
      {/* 창턱 — 하단 인셋으로 두께감 */}
      <div style={{ position: 'absolute', left: 0, top: 52, width: 76, height: 8, borderRadius: 2, background: HOME.MOLD_LIGHT, boxShadow: `inset 0 -4px 0 ${HOME.MOLD_MID}` }} />
    </div>
  );
}
function FlatRoom() {
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {/* 바닥 + 타일(40×30 r8, 가로 피치 90·행 피치 35·반칸 오프셋 45 — 시안 실측) */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 144, bottom: 0, backgroundColor: HOME.FLOOR, backgroundImage: TILE_PATTERN, backgroundSize: '90px 70px', backgroundPosition: '-73px 3px' }} />
      {/* 벽(탄) + 연크림 세로 패널 스트라이프 */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 105, backgroundColor: HOME.WALL, backgroundImage: `repeating-linear-gradient(90deg, transparent 0 5px, ${HOME.PANEL} 5px 25px, transparent 25px 40px)` }} />
      {/* 하부 웨인스코팅(브라운) — 상단 라이트 라인 + 패널 아웃라인 */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 105, height: 39, background: HOME.MOLD_MID, boxShadow: `inset 0 1.7px 0 ${HOME.MOLD_LIGHT}`, backgroundImage: PANEL_LINE_PATTERN, backgroundRepeat: 'repeat-x', backgroundPosition: '0 0' }} />
      {/* 걸레받이 라이트 라인 */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 129, height: 2, background: HOME.MOLD_LIGHT }} />
      {/* 창문 2(벽 장식) — 좌 left81·우 right81(390 기준 시안과 동일, 와이드에선 좌우 대칭) */}
      <RoomWindow left={81} />
      <RoomWindow right={81} />
    </div>
  );
}
const depthZ = (d) => 300 + Math.round(d * 300); // 깊이 → zIndex(앞이 위)
// 홈 방이 실제로 화면에 보이는 중인지 — 성조 캐릭터 목소리(playSfx 'tone*') 게이트.
// 오버레이(허브·메뉴·프로필·시트 등)가 방을 덮고 있거나 앱이 백그라운드면 소리 안 냄("홈 방을 보고있지 않으면 안 남").
// 모듈 스코프: WanderingMark(캐릭터)와 메인 HomeScreen이 같은 파일이라 공유. 홈은 동시에 하나만 마운트됨.
let homeRoomActive = false;
const charCanSpeak = () => homeRoomActive && (typeof document === 'undefined' || document.visibilityState === 'visible');
// ── 장난감 공(물리) ──────────────────────────────────────────
// 방에 공 하나. 마찰로 구르다 멈추고·벽에 튕기고·메인 캐릭터 몸에 닿으면 밀린다(자연 드리블).
// 가끔 캐릭터가 다가와 다른 캐릭터 쪽으로 뻥 찬다(패스). 물리평면 좌표(캐릭터와 동일계) + project로 렌더.
const BALL = { x: 0, y: 0, vx: 0, vy: 0, r: 13, live: false, fx: 0 };
const BALL_MAXV = 470;
// 타격 이펙트(불규칙 뾰족뾰족 노란 별 단일) — 공 tick이 화면좌표로 spawn, ImpactFX 캔버스가 그림.
const IMPACTS = [];
function spawnImpact(x, y, power, kind) {
  const big = kind === 'kick';
  const n = big ? 12 : 9;                                   // 뾰족 개수
  const base = (big ? 17 : 10) + Math.min(1, power / 320) * (big ? 14 : 7);
  const rot = Math.random() * 6.2832;
  const spikes = [];
  for (let k = 0; k < n; k++) {
    const a = rot + (k / n) * 6.2832 + (Math.random() - 0.5) * 0.6;  // 각도 지터(더 불규칙)
    spikes.push({ a, ro: base * (0.58 + Math.random() * 0.9), ri: base * (0.24 + Math.random() * 0.13) }); // 뾰족 길이 제각각·깊은 골(날카롭게)
  }
  IMPACTS.push({ x, y, t0: performance.now(), spikes, rotDir: Math.random() < 0.5 ? -1 : 1, big });
  if (IMPACTS.length > 20) IMPACTS.shift();
}
// 공 차기 — kicker(메인 id) 기준 공을 다른 랜덤 메인 쪽으로(없으면 랜덤) 뻥.
function kickBall(kickerId) {
  if (!BALL.live) return;
  const others = [];
  for (const [id, o] of COLL) if (id[0] === 'm' && id !== kickerId) others.push(o);
  let ang;
  if (others.length) { const t = others[Math.floor(Math.random() * others.length)]; ang = Math.atan2(t.y - BALL.y, t.x - BALL.x); }
  else ang = Math.random() * Math.PI * 2;
  ang += (Math.random() - 0.5) * 0.5; // 살짝 빗나감(사람 같은 부정확)
  const power = 250 + Math.random() * 175;
  BALL.vx = Math.cos(ang) * power; BALL.vy = Math.sin(ang) * power;
  BALL.fx = power; // 다음 프레임 공 tick이 타격 이펙트 spawn(화면좌표 필요)
  if (charCanSpeak()) playSfx('kick');
}
// 타격 이펙트 렌더 — 방 위 오버레이 캔버스(캐릭터 위). 방사선 + 확장 링이 짧게 팝하고 사라짐.
function ImpactFX() {
  const cvRef = useRef(null);
  useLayoutEffect(() => {
    const cv = cvRef.current, par = cv && cv.parentElement; if (!par) return undefined;
    const ctx = cv.getContext('2d');
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    let W = 0, H = 0;
    const resize = () => { W = par.clientWidth; H = par.clientHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; };
    resize();
    const LIFE = 300;
    // 뾰족 별 경로를 현재 스케일·회전으로 ctx에 구성.
    const starPath = (im, scale, rotOff) => {
      const sp = im.spikes, n = sp.length;
      ctx.beginPath();
      for (let k = 0; k < n; k++) {
        const s = sp[k], a = s.a + rotOff;
        const ox = im.x + Math.cos(a) * s.ro * scale, oy = im.y + Math.sin(a) * s.ro * scale;
        if (k === 0) ctx.moveTo(ox, oy); else ctx.lineTo(ox, oy);
        const nx = sp[(k + 1) % n]; let na = nx.a; if (na < s.a) na += 6.2832;
        const va = (s.a + na) / 2 + rotOff, vr = s.ri;
        ctx.lineTo(im.x + Math.cos(va) * vr * scale, im.y + Math.sin(va) * vr * scale);
      }
      ctx.closePath();
    };
    const easeBack = (x) => { const c1 = 2.2, c3 = c1 + 1; const p = x - 1; return 1 + c3 * p * p * p + c1 * p * p; }; // 탄성 오버슈트
    const draw = (now) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.lineJoin = 'miter'; ctx.miterLimit = 3; // 날카로운 뾰족
      for (let i = IMPACTS.length - 1; i >= 0; i--) {
        const im = IMPACTS[i]; const t = (now - im.t0) / LIFE;
        if (t >= 1) { IMPACTS.splice(i, 1); continue; }
        const scale = 0.3 + easeBack(Math.min(1, t / 0.4)) * 0.75;  // 작게→탄성 오버슈트→안착
        const alpha = t < 0.62 ? 1 : 1 - (t - 0.62) / 0.38;         // 오래 선명하게 유지 후 페이드
        const rotOff = im.rotDir * 0.14 * (1 - (1 - t) * (1 - t));  // 팝하며 아주 살짝 회전
        starPath(im, scale, rotOff);
        ctx.fillStyle = `rgba(255,199,20,${alpha.toFixed(3)})`;      // 플랫 노랑 단일(아웃라인 없음)
        ctx.fill();
      }
    };
    addTick(draw);
    window.addEventListener('resize', resize);
    return () => { removeTick(draw); window.removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={cvRef} aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 620 }} />;
}
// 축구공 검은 오각형 = 정이십면체 12꼭짓점(단위구). draw 시 앞면(z>0)만 원근으로 그림.
const ICOSA = (() => {
  const P = 1.6180339887, IN = 1 / Math.hypot(1, P);
  return [[0, 1, P], [0, 1, -P], [0, -1, P], [0, -1, -P], [1, P, 0], [1, -P, 0], [-1, P, 0], [-1, -P, 0], [P, 0, 1], [P, 0, -1], [-P, 0, 1], [-P, 0, -1]].map((v) => [v[0] * IN, v[1] * IN, v[2] * IN]);
})();
function ToyBall() {
  const elRef = useRef(null);
  const cvRef = useRef(null); // 캔버스 — 회전하는 3D 구(축구공 검은 오각형 12개를 구면에서 굴림)
  useLayoutEffect(() => {
    const el = elRef.current; const par = el && el.parentElement; if (!par) return undefined;
    const cv = cvRef.current, ctx = cv.getContext('2d');
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const S = BALL.r * 2;
    cv.width = Math.round(S * dpr); cv.height = Math.round(S * dpr);
    let W = par.clientWidth, H = par.clientHeight;
    const RB = BALL.r;
    BALL.x = W * 0.5; BALL.y = H * 0.56; BALL.vx = 0; BALL.vy = 0; BALL.live = true;
    let last = performance.now(), lastBumpAt = 0; // lastBumpAt = 부딪힘음 연사 방지
    // 지금 공에 닿아 있는 캐릭터 id — '닿기 시작한 프레임'(enter)과 '계속 닿아 있음'(stay)을 구분하려고 든다.
    //  이게 없으면 겹친 동안 매 프레임이 새 충돌로 취급돼 밀치기·소리가 초당 수십 번 반복된다(=비벼짐).
    let ballTouch = new Set();
    const BUMP_MIN_SPD = 70; // 이 속도 이상으로 파고들 때만 소리·타격 이펙트(살짝 스치는 접촉은 무음)
    // ── 갇힘 탈출 ────────────────────────────────────────
    // 레벨이 오르면 팔로워가 캐릭터당 (레벨-1)개씩 붙어 Lv.5에선 충돌체가 25개가 된다(반경도 1.8배).
    //  그 밀도에선 공이 사방에서 밀려 벽으로 몰리고 **영영 못 빠져나온다**(2026-08-11 사용자 지적).
    //  접촉당 임펄스를 어떻게 튜닝해도 해결이 안 되므로, '갇힘'을 상태로 감지해 빈 쪽으로 뻥 차서 꺼낸다.
    let stuckMs = 0, lastEscapeAt = 0;
    const STUCK_SPD = 26;    // 이 속도 아래로 캐릭터에 닿아 있으면 '갇히는 중'
    const STUCK_MS = 600;    // 이만큼 지속되면 탈출 킥
    const ESCAPE_V = 300;    // 탈출 킥 속도(벽에서 확실히 떨어져 나올 만큼)
    // 밀기 세기 — 파고든 깊이를 속도로 환산(=미는 캐릭터 속도)한 뒤 GAIN을 곱해 **캐릭터보다 조금 빠르게** 굴러나가게.
    //  고정 임펄스와 달리 실제 파고든 만큼만 주므로 살짝 닿으면 살짝, 세게 밀면 세게 — 떨림도 끌려다님도 없다.
    const PUSH_GAIN = 1.6, PUSH_V_MAX = 190;
    // 회전 상태를 verts에 누적(방향이 바뀌어도 연속). 초기 = 정이십면체 꼭짓점.
    let verts = ICOSA.map((v) => [v[0], v[1], v[2]]);
    const cx = S / 2, cy = S / 2, Rin = S / 2 - 1.2, spotR = Rin * 0.36;
    // Rodrigues 회전(축 kz=0): v' = v·c + (k×v)·s + k(k·v)(1-c)
    const rot = (v, kx, ky, c, s) => {
      const dot = kx * v[0] + ky * v[1];
      return [v[0] * c + (ky * v[2]) * s + kx * dot * (1 - c), v[1] * c + (-kx * v[2]) * s + ky * dot * (1 - c), v[2] * c + (kx * v[1] - ky * v[0]) * s];
    };
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, S, S);
      ctx.beginPath(); ctx.arc(cx, cy, Rin, 0, 6.2832); ctx.fillStyle = '#fff'; ctx.fill(); // 외곽선 없음(사용자 요청)
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, Rin, 0, 6.2832); ctx.clip();
      ctx.fillStyle = '#2b2730';
      for (const v of verts) {
        const z = v[2]; // +z = 화면 앞쪽(보이는 면)
        if (z < -0.2) continue;
        const zc = Math.max(0, z);
        const r = spotR * (0.45 + 0.55 * zc); if (r < 0.4) continue;
        const px = cx + v[0] * Rin, py = cy - v[1] * Rin; // y는 위로
        ctx.globalAlpha = z < 0 ? Math.max(0, 1 + z / 0.2) : 1; // 실루엣 근처 페이드
        ctx.beginPath(); ctx.ellipse(px, py, r, r * (0.55 + 0.45 * zc), 0, 0, 6.2832); ctx.fill(); // 가장자리일수록 눌린 타원(구면 원근)
      }
      ctx.globalAlpha = 1;
      // 구 형태 음영(form shadow) — 빛=좌상단, 우하단으로 갈수록 어두워짐(매트 셰이딩). 흰 부분=하이라이트.
      const lx = cx - Rin * 0.32, ly = cy - Rin * 0.4;
      const sg = ctx.createRadialGradient(lx, ly, Rin * 0.1, lx, ly, Rin * 1.9);
      sg.addColorStop(0, 'rgba(18,14,10,0)');
      sg.addColorStop(0.5, 'rgba(18,14,10,0.04)');
      sg.addColorStop(0.82, 'rgba(18,14,10,0.2)');
      sg.addColorStop(1, 'rgba(18,14,10,0.42)');
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(cx, cy, Rin, 0, 6.2832); ctx.fill();
      ctx.restore();
    };
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const damp = Math.max(0, 1 - 1.6 * dt); BALL.vx *= damp; BALL.vy *= damp; // 구르다 멈춤(마찰)
      if (Math.abs(BALL.vx) < 1.5 && Math.abs(BALL.vy) < 1.5) { BALL.vx = 0; BALL.vy = 0; }
      const sp = Math.hypot(BALL.vx, BALL.vy); if (sp > BALL_MAXV) { BALL.vx = BALL.vx / sp * BALL_MAXV; BALL.vy = BALL.vy / sp * BALL_MAXV; }
      BALL.x += BALL.vx * dt; BALL.y += BALL.vy * dt;
      // 벽 반사(탄성 0.62) — 튕김 감지(타격 이펙트·사운드용). wallSpd=반사 직전 속도.
      const minX = WALL_M + RB, maxX = W - WALL_M - RB, minY = WALL_M + RB, maxY = H - WALL_M - RB;
      let wallHit = false; const wallSpd = Math.hypot(BALL.vx, BALL.vy);
      if (BALL.x < minX) { BALL.x = minX; BALL.vx = Math.abs(BALL.vx) * 0.62; wallHit = true; }
      else if (BALL.x > maxX) { BALL.x = maxX; BALL.vx = -Math.abs(BALL.vx) * 0.62; wallHit = true; }
      if (BALL.y < minY) { BALL.y = minY; BALL.vy = Math.abs(BALL.vy) * 0.62; wallHit = true; }
      else if (BALL.y > maxY) { BALL.y = maxY; BALL.vy = -Math.abs(BALL.vy) * 0.62; wallHit = true; }
      // 캐릭터 몸 충돌(메인+팔로워 모두) — 겹치면 밀어내고 굴림 임펄스(자연 드리블).
      //  ★접촉 '시작'과 '유지'를 구분한다(2026-08-10 사용자: 공이 캐릭터에 비벼지고 소리가 지저분함).
      //   구버전은 밀치기 임펄스(+46)를 겹친 **모든 프레임**에 넣었다. 캐릭터가 걸어다니며 공을 계속 따라잡으니
      //   초당 60번 밀치는 상태가 됐고, 소리 판정까지 `nowSpd - spd0 > 45`라 그 임펄스를 자기가 충돌로 오인해
      //   초당 열 번 넘게 울렸다. → 겹침 해소는 매 프레임, **임펄스·소리는 새 접촉일 때만**.
      const touching = new Set();
      let hitSpd = 0; // 이번 프레임 새 접촉 중 가장 세게 파고든 속도(소리·이펙트 세기)
      for (const [id, o] of COLL) {
        // ★팔로워도 공과 부딪힌다 — 공이 작은 애들을 통과하면 그게 더 어색하다(2026-08-11 사용자).
        //  고밀도 갇힘은 '통과'가 아니라 아래 **탈출 킥**으로 푼다.
        const dx = BALL.x - o.x, dy = BALL.y - o.y, d = Math.hypot(dx, dy), minD = o.r + RB;
        if (d > 0.01 && d < minD) {
          touching.add(id);
          const ux = dx / d, uy = dy / d;
          const depth = minD - d;                             // 이번 프레임 파고든 깊이
          BALL.x = o.x + ux * minD; BALL.y = o.y + uy * minD; // 겹침 해소는 항상(파고들어 보이면 안 됨)
          const along = BALL.vx * ux + BALL.vy * uy;          // 음수 = 파고드는 중
          if (along < 0) { BALL.vx -= along * ux * 1.3; BALL.vy -= along * uy * 1.3; } // 파고드는 성분만 반사
          // 비례 밀기 — 파고든 깊이/dt = 캐릭터가 미는 속도. 거기에 GAIN을 곱해 공이 앞서 굴러가게 한다.
          const pushV = Math.min(PUSH_V_MAX, (depth / Math.max(dt, 1 / 120)) * PUSH_GAIN);
          if (pushV > 0) { BALL.vx += ux * pushV; BALL.vy += uy * pushV; }
          if (!ballTouch.has(id) && along < 0) hitSpd = Math.max(hitSpd, -along); // 새 접촉의 실제 충돌 속도만 소리로
        }
      }
      ballTouch = touching;
      // 갇힘 판정 — 캐릭터에 닿은 채 거의 안 움직이는 상태가 STUCK_MS 이상 지속되면 빈 쪽으로 차서 꺼낸다.
      const spdNow = Math.hypot(BALL.vx, BALL.vy);
      // [DEV] 갇힘 검수용 관찰 훅 — '정지'와 '갇힘'은 다르다(혼자 멈춘 건 정상). 접촉 수까지 봐야 구분된다.
      //  ★프레임 단위로 **누적**한다 — 밖에서 10Hz로 샘플링하면 1~2프레임짜리 짧은 접촉을 통째로 놓친다.
      if (import.meta.env.DEV) {
        const b = (window.__tgBall ||= { frames: 0, contactFrames: 0, maxStuckMs: 0, escapes: 0 });
        b.v = spdNow; b.touch = touching.size; b.stuckMs = stuckMs;
        b.frames += 1; if (touching.size > 0) b.contactFrames += 1;
        b.maxStuckMs = Math.max(b.maxStuckMs, stuckMs);
      }
      if (touching.size > 0 && spdNow < STUCK_SPD) stuckMs += dt * 1000; else stuckMs = 0;
      if (stuckMs > STUCK_MS && now - lastEscapeAt > 1200) {
        stuckMs = 0; lastEscapeAt = now;
        // 방향 = 주변 캐릭터들의 반대편 + 방 중앙 쪽을 섞는다(벽에 몰린 경우 중앙 성분이 빼준다).
        let ax = 0, ay = 0, n = 0;
        for (const o of COLL.values()) {
          if (Math.hypot(BALL.x - o.x, BALL.y - o.y) < o.r + RB + 70) { ax += o.x; ay += o.y; n += 1; }
        }
        const awx = n ? BALL.x - ax / n : 0, awy = n ? BALL.y - ay / n : 0;
        const cwx = W / 2 - BALL.x, cwy = H / 2 - BALL.y;
        const la = Math.hypot(awx, awy) || 1, lc = Math.hypot(cwx, cwy) || 1;
        let ex = (awx / la) * 0.6 + (cwx / lc) * 0.9, ey = (awy / la) * 0.6 + (cwy / lc) * 0.9;
        const le = Math.hypot(ex, ey) || 1; ex /= le; ey /= le;
        BALL.vx = ex * ESCAPE_V; BALL.vy = ey * ESCAPE_V;
        BALL.fx = ESCAPE_V; // 킥 이펙트 예약(아래 spawnImpact가 소비) — '캐릭터가 빼줬다'로 읽히게
        if (charCanSpeak()) playSfx('kick');
        if (import.meta.env.DEV) { const b = (window.__tgBall ||= {}); b.escapes = (b.escapes || 0) + 1; }
      }
      // 3D 구름 — 굴림 축 = 이동 방향에 수직(화면평면 내). 매 프레임 구면 회전을 verts에 누적(dθ=거리/반지름).
      const spd = Math.hypot(BALL.vx, BALL.vy);
      if (spd > 1) {
        // 굴림축 k = (n̂ × v)/|v|. draw는 월드 y가 위(화면 y는 아래)라 vy 부호를 뒤집어야 세로가 맞음 → kx = ny.
        const nx = BALL.vx / spd, ny = BALL.vy / spd, kx = ny, ky = nx;
        const dth = spd * dt / RB, c = Math.cos(dth), s = Math.sin(dth);
        for (let i = 0; i < verts.length; i++) { const w = rot(verts[i], kx, ky, c, s); const L = Math.hypot(w[0], w[1], w[2]) || 1; verts[i] = [w[0] / L, w[1] / L, w[2] / L]; }
      }
      draw();
      const [sx, sy, ds, dep] = project(BALL.x, BALL.y, W, H);
      // 캐릭터와 동일 규약: 앵커(투영점)에서 발(그림자)이 +44 아래. 공도 발을 +44에 둬야 같은 바닥선에서 부딪히고
      // z 정렬도 캐릭터(머리=투영점 기준)와 자연히 일치 → 앞 캐릭터가 공을 가리고 뒤 캐릭터는 공에 가려짐.
      el.style.transform = `translate3d(${sx.toFixed(1)}px, ${(sy + 44).toFixed(1)}px, 0) scale(${ds.toFixed(3)})`;
      el.style.zIndex = String(depthZ(dep));
      // 타격 이펙트 — 공 중심(화면좌표)에 spawn. 킥(강함)은 kickBall이 예약(BALL.fx), 부딪힘은 여기서 강도로 판정.
      const icx = sx, icy = sy + 44 - RB * ds; // 공 중심
      if (BALL.fx) { spawnImpact(icx, icy, BALL.fx, 'kick'); BALL.fx = 0; }
      // 부딪힘음 — 판정 근거는 **실제 파고든 속도**(hitSpd)다. 구버전의 `nowSpd - spd0 > 45`는 방금 우리가 준
      //  임펄스를 재는 자기충족 조건이라 항상 참이었다. 캐릭터가 걸어와 살짝 미는 접촉은 hitSpd가 작아 무음.
      else if (((hitSpd >= BUMP_MIN_SPD) || (wallHit && wallSpd > 80)) && now - lastBumpAt > 160) {
        lastBumpAt = now; spawnImpact(icx, icy, Math.max(hitSpd, wallSpd), 'bump'); // 캐릭터 부딪힘·벽 튕김 공용
        if (charCanSpeak()) playSfx('bump');
      }
    };
    addTick(tick);
    const onResize = () => { W = par.clientWidth; H = par.clientHeight; };
    window.addEventListener('resize', onResize);
    return () => { removeTick(tick); BALL.live = false; window.removeEventListener('resize', onResize); };
  }, []);
  const S = BALL.r * 2;
  return (
    <div ref={elRef} data-tg-ball="1" aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', willChange: 'transform' }}>
      {/* 접지 그림자 — 성조 캐릭터 그림자와 **같은 스타일**(블러 없는 단색 타원 rgba(70,62,52,0.13), 가로:세로 ≈ 46:11).
          위치는 공 바닥(접점 y=0)에 살짝 물리게 — 아래로 떨어뜨리면 공이 떠 보인다(2026-08-07 사용자 지적). */}
      <div style={{ position: 'absolute', left: '50%', top: -2, transform: 'translateX(-50%)', width: S * 1.08, height: S * 0.27, borderRadius: '50%', background: 'rgba(70,62,52,0.13)' }} />
      {/* 공 — 회전하는 3D 구(캔버스). 접점에서 반지름만큼 위(그림자 위에 얹힘) */}
      <canvas ref={cvRef} style={{ position: 'absolute', left: '50%', top: -BALL.r, transform: 'translate(-50%,-50%)', width: S, height: S, display: 'block' }} />
    </div>
  );
}
// 레벨 변화 콜아웃 — 스포트라이트 중 캐릭터 머리 위(흰 카드+꼬리). 상승=성조색 강조 / 하락=담백.
function LevelCallout({ change, color }) {
  const up = change.dir === 'up';
  return (
    <div style={{ position: 'relative', background: '#fff', borderRadius: RADIUS.lg, padding: '10px 18px', textAlign: 'center', boxShadow: '0 8px 22px rgba(43,39,48,0.32)' }}>
      <div style={{ ...TYPE.h1, color: up ? color : TG.SUB, lineHeight: 1.15 }}>{up ? '레벨 업!' : '레벨 다운'}</div>
      <div style={{ ...TYPE.label, color: TG.INK, marginTop: SPACE.xs, whiteSpace: 'nowrap' }}>Lv.{change.from} → Lv.{change.to}</div>
      <div style={{ position: 'absolute', left: '50%', bottom: -8, transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '8px solid transparent', borderRight: '8px solid transparent', borderTop: '9px solid #fff' }} />
    </div>
  );
}

function WanderingMark({ tone, i, level = 0, prog = 0, state = 'mid', celebrate = false, reveal = null, onRevealPos, introLine = null, onOpenCard }) {
  const elRef = useRef(null);
  const revealRef = useRef(null); // 스포트라이트 중이면 이동 정지·z 상승(rAF가 매 프레임 읽음)
  const bodyRef = useRef(null); // 몸통(원근 스케일 받음)
  const headRef = useRef(null); // 머리 위 UI(원근 스케일 영향 없음 — 위치만 추적)
  const followerRefs = useRef([]); // 레벨만큼의 작은 추종 캐릭터
  const followerTiltRefs = useRef([]); // 팔로워 기울임 래퍼(이동 방향)
  const [st, setSt] = useState('idle');
  const [say, setSay] = useState(null);
  const [jump, setJump] = useState(false);
  const [tilt, setTilt] = useState(0);
  const [sparkle, setSparkle] = useState(false);
  const hopT = useRef(null);
  const doHop = () => { setJump(false); requestAnimationFrame(() => setJump(true)); clearTimeout(hopT.current); hopT.current = setTimeout(() => setJump(false), 540); };
  // 레벨 → 크기(성장). 색상은 안 바꿈(사용자 요청). 충돌박스 cr도 같은 배율로 맞춰 물리 일관.
  const vScale = levelScale(level);
  const cx = markSize(tone.num) * (tone.num === 0 ? 0.42 : 1) / 2; // 마크 중심 x(머리 UI 정렬)
  // 정확도 상태 → 움직임 신호(약점 진단, 색 없이): 약하면 느릿(졸림)+가끔 '나 좀 봐줘' 흔들·강하면 활발.
  const idleBob = state === 'weak' ? 4.4 : state === 'strong' ? 2.4 : 3;
  const wobble = state === 'weak' && st !== 'walk';
  // 성장 축하 — 게임 후 가장 많이 맞힌 성조가 점프+반짝
  useEffect(() => {
    if (!celebrate) return undefined;
    doHop(); setSparkle(true);
    const id = setTimeout(() => setSparkle(false), 2400);
    return () => clearTimeout(id);
  }, [celebrate]);
  // 레벨 스포트라이트 — 이 캐릭터 차례면 점프+(상승 시)반짝. rAF는 revealRef로 정지/z상승 판단.
  useEffect(() => {
    revealRef.current = reveal;
    if (!reveal) { setSparkle(false); return undefined; }
    doHop();
    if (reveal.dir === 'up') setSparkle(true);
    // 스포트라이트 구멍 위치 = 프리즈된 마크 중심(컨테이너 좌표). tick이 위치 세팅한 다음 프레임에 읽어 보고.
    let raf1, raf2;
    raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => {
      const bd = bodyRef.current, el = elRef.current, par = el && el.offsetParent;
      if (bd && par && onRevealPos) {
        const r = bd.getBoundingClientRect(), pr = par.getBoundingClientRect();
        onRevealPos({ x: r.left - pr.left + r.width / 2, y: r.top - pr.top + r.height / 2 });
      }
    }); });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [reveal]);
  // 첫 방문 코치 한 줄 — 약점 캐릭터 위 말풍선(살짝 뒤 등장 → 사라짐)
  useEffect(() => {
    if (!introLine) return undefined;
    const a = setTimeout(() => { setSay(introLine); if (charCanSpeak()) playSfx('tone' + tone.num); }, 650);
    const b = setTimeout(() => setSay((s) => (s === introLine ? null : s)), 5400);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [introLine]);
  // level은 ref로만 읽음(물리 effect deps에서 제외) — 레벨이 바뀌어도(거의 매 런 후) 물리 상태를 재초기화하지
  // 않아 위치 연속 유지(순간이동 제거). 크기·충돌 반경은 tick이 매 프레임 levelRef로 읽어 다음 프레임부터 자연 반영.
  const levelRef = useRef(level);
  levelRef.current = level;
  useLayoutEffect(() => {
    const el = elRef.current; const par = el && el.parentElement; if (!par) return undefined;
    let alive = true;
    const speed = 24 + Math.random() * 22; // 캐릭터별 고유 속도(24~46 px/s — 차분하게, 2026-07-28 하향)
    const crBase = tone.num === 0 ? markSize(0) * 0.42 * 0.55 : markSize(tone.num) * 0.44; // 충돌 반경 기본(캐릭터 크기 기반) — 레벨 배율은 매 프레임 levelRef로 곱함
    const mId = 'm' + i;
    let W = par.clientWidth, H = par.clientHeight;
    // 골고루 분산 — 캐릭터별 전용 구역(5분할 앵커). 배치·목표 모두 자기 구역 근방으로 제한(2026-07-28).
    const ANCHORS = [[0.2, 0.22], [0.78, 0.2], [0.5, 0.5], [0.24, 0.76], [0.76, 0.78]];
    const [ax, ay] = ANCHORS[i % ANCHORS.length];
    const clampRoom = (x, y) => ({
      x: Math.min(W - WALL_M - MARK_W, Math.max(WALL_M, x)),
      y: Math.min(H - WALL_M - MARK_H, Math.max(WALL_M, y)),
    });
    // 구역 근방 랜덤 지점 — 앵커 ±(짧은 반경)만 배회(멀리 안 감)
    const rnd = () => clampRoom(ax * W + (Math.random() - 0.5) * 150, ay * H + (Math.random() - 0.5) * 120);
    // 뭉침 방지 — 구역 후보 중 다른 메인에서 가장 멀리(한적한) 곳을 목표로 선택.
    // 60px 미만 잔이동 후보는 제외(꼼지락 방지) — 움직일 땐 의미 있는 거리로(2026-07-28).
    const pickTarget = () => {
      let best = null, bestScore = -1;
      for (let n = 0; n < 8; n++) {
        const c = rnd();
        if (Math.hypot(c.x - pos.x, c.y - pos.y) < 60) continue;
        let minD = Infinity;
        for (let j = 0; j < 5; j++) { if (j === i) continue; const o = COLL.get('m' + j); if (!o) continue; const d = Math.hypot(c.x - o.x, c.y - o.y); if (d < minD) minD = d; }
        if (minD > bestScore) { bestScore = minD; best = c; }
      }
      return best; // 후보가 다 잔이동이면 null → 이번엔 안 움직임
    };
    // 초기 배치 = 앵커 + 소지터 → 로드 직후부터 골고루
    let pos = clampRoom(ax * W + (Math.random() - 0.5) * 60, ay * H + (Math.random() - 0.5) * 50);
    let target = pos, mode = 'idle', v = { x: 0, y: 0 }, stuck = 0, ballChase = false;
    let until = performance.now() + 800 + i * 700; // 캐릭터별 시차 시작(첫 쉼)
    // 위치 반영 — left/top(매 프레임 레이아웃 무효화) 대신 translate3d(합성 전용). left/top은 0 고정.
    // ⚠️ 초기 배치도 rAF tick과 반드시 같은 함수(apply)로 — 과거 초기배치와 rAF 코드가 달라 머리 UI 스케일 버그났던 전례.
    const apply = (sx, sy, ds, z) => {
      el.style.transform = `translate3d(${sx}px, ${sy}px, 0)`; el.style.zIndex = z;
      const bd = bodyRef.current; if (bd) bd.style.transform = `scale(${ds})`;                  // 몸통만 원근 스케일
      const hd = headRef.current; if (hd) hd.style.transform = `translate(-50%, -100%) translateY(${44 * (1 - ds) - 8}px)`; // 머리 UI는 스케일 없이 위치만(축소된 머리 위)
    };
    { const [sx, sy, ds, d] = project(pos.x, pos.y, W, H); apply(sx, sy, ds, String(depthZ(d))); }
    COLL.set(mId, { x: pos.x, y: pos.y, r: crBase * levelScale(levelRef.current) });
    // 듀엣 대화 API — 오케스트레이터(startDuet)가 이 캐릭터를 잠깐 대화에 참여시킴(closure로 mode/pos/until 공유).
    MARKS.set(mId, {
      getPos: () => pos,
      free: () => mode !== 'move' && mode !== 'chat' && !revealRef.current,          // 걷는 중·이미 대화 중·스포트라이트면 제외
      reserve: (tx, ty) => { if (revealRef.current) return; mode = 'chat'; setSt('idle'); setSay(null); setTilt(tx > pos.x ? 1 : -1); until = performance.now() + 999999; }, // 마주보고 정지
      speak: (line, tx, ty) => { if (revealRef.current) return; mode = 'chat'; setSt('talk'); setTilt(tx > pos.x ? 1 : -1); setSay(line); doHop(); if (charCanSpeak()) playSfx('tone' + tone.num); },
      hush: () => setSay(null),
      release: () => { if (mode === 'chat') { mode = 'idle'; setSt('idle'); setTilt(0); setSay(null); until = performance.now() + 900 + Math.random() * 1600; } },
    });
    const pick = (now) => {
      ballChase = false;
      const r = Math.random();
      // 위치 변경은 드물게(평균 1~2분에 한 번), 대신 움직일 땐 의미 있는 거리로(2026-07-28 2차 조정)
      const t = r < 0.1 ? pickTarget() : null;
      if (t) { target = t; setTilt(target.x > pos.x ? 1 : -1); mode = 'move'; setSt('walk'); }
      // 공이 멈춰 있으면(누가 막 찬 게 아니면) 아주 가끔 다가가 뻥 — 공을 향해 이동
      else if (r >= 0.1 && r < 0.14 && BALL.live && Math.hypot(BALL.vx, BALL.vy) < 40) { ballChase = true; target = { x: BALL.x, y: BALL.y }; setTilt(BALL.x > pos.x ? 1 : -1); mode = 'move'; setSt('walk'); }
      else if (r < 0.96) { mode = 'idle'; setSt('idle'); setTilt(0); until = now + 6000 + Math.random() * 8000; }
      // 근처에 자유로운 친구가 있으면 듀엣(마주보고 주고받기) — 성공하면 상태는 startDuet가 몰음. 없으면 솔로 한마디.
      else if (!startDuet(mId)) { mode = 'talk'; setSt('talk'); setTilt(0); doHop(); const p = TALK_LINES[tone.num] || ['!']; setSay(p[Math.floor(Math.random() * p.length)]); if (charCanSpeak()) playSfx('tone' + tone.num); until = now + 1900; }
    };
    // 팔로워 — 메인 기준 슬롯(유지 거리·각도). 현재위치 fp가 슬롯을 lerp로 쫓아옴 → 일정 간격 두고 따라오는 느낌.
    // 레벨 변동 시 effect 재실행 없이 tick 안에서 슬롯을 추가/정리(레벨은 levelRef로 읽음).
    const makeSlot = (k, nfAll) => {
      const a = (k / Math.max(1, nfAll)) * Math.PI * 2 + Math.random() * 0.6;
      const f = Math.max(0.42, 0.58 - k * 0.05); const fcr = crBase * f;
      // 슬롯 거리는 메인 충돌 반경 밖(cr+fcr 부근) + 최고속도 상한(큰애의 55~83%) → 못 따라잡고 쫓아오되 안 겹침.
      return { ang: a, rad: crBase * levelScale(levelRef.current) + fcr + Math.random() * 12, fcr, tilt: 0, fspeed: speed * (0.55 + Math.random() * 0.28), phx: Math.random() * 6.28, phy: Math.random() * 6.28, sx: 0.5 + Math.random() * 0.4, sy: 0.6 + Math.random() * 0.4 };
    };
    const nf0 = Math.max(0, levelRef.current - 1);
    const slots = Array.from({ length: nf0 }, (_, k) => makeSlot(k, nf0));
    const fp = slots.map(() => ({ x: pos.x, y: pos.y }));
    let last = performance.now();
    const tick = (now) => {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const cr = crBase * levelScale(levelRef.current); // 충돌 반경 — 레벨 변동은 다음 프레임부터 자연 반영
      // 스포트라이트 중 — 제자리 정지 + 딤(z610) 위로(z640)
      if (revealRef.current) {
        v.x = 0; v.y = 0;
        COLL.set(mId, { x: pos.x, y: pos.y, r: cr });
        const [sx, sy, ds] = project(pos.x, pos.y, W, H);
        apply(sx, sy, ds, '640');
        return;
      }
      // 대화(듀엣) 중 — 제자리 정지·마주본 채. 밀림/영토 반발도 스킵(서로 떨어지지 않게).
      if (mode === 'chat') {
        v.x = 0; v.y = 0;
        COLL.set(mId, { x: pos.x, y: pos.y, r: cr });
        const [sx, sy, ds, d] = project(pos.x, pos.y, W, H);
        apply(sx, sy, ds, String(depthZ(d)));
        return;
      }
      const px0 = pos.x, py0 = pos.y;
      // 가속도 — 목표를 향해 속도가 점점 붙고, 도착 가까이서 감속(arrive)
      if (mode === 'move') {
        if (ballChase) { if (BALL.live) target = { x: BALL.x, y: BALL.y }; else ballChase = false; } // 공은 움직이니 매 프레임 추적
        const dx = target.x - pos.x, dy = target.y - pos.y, dist = Math.hypot(dx, dy);
        if (ballChase && BALL.live && dist < cr + BALL.r + 10) { kickBall(mId); ballChase = false; mode = 'idle'; setSt('idle'); setTilt(0); doHop(); until = now + 1500 + Math.random() * 2200; }
        else if (dist < 3 && Math.hypot(v.x, v.y) < 8) { mode = 'idle'; setSt('idle'); setTilt(0); until = now + 6000 + Math.random() * 8000; }
        else {
          const arrive = Math.min(speed, dist * 2.6), ux = dx / (dist || 1), uy = dy / (dist || 1), resp = Math.min(1, 3.5 * dt);
          v.x += (ux * arrive - v.x) * resp; v.y += (uy * arrive - v.y) * resp;
          // 진행 방향 앞에 다른 (메인) 캐릭터가 있으면 옆으로 조향 → 밀지 않고 피해 감(생명체감)
          const spd = Math.hypot(v.x, v.y);
          if (spd > 6) {
            const dxu = v.x / spd, dyu = v.y / spd, lx = -dyu, ly = dxu; // 진행방향·왼쪽 단위벡터
            let stx = 0, sty = 0, near = false;
            for (const [oid, o] of COLL) {
              if (oid === mId || oid[0] !== 'm') continue; // 다른 메인만 회피(팔로워 무시)
              const ox = o.x - pos.x, oy = o.y - pos.y, od = Math.hypot(ox, oy), look = cr + o.r + 42;
              if (od < 0.01 || od > look) continue;
              const ahead = (ox * dxu + oy * dyu) / od; // 진행방향 정렬(앞쪽=+)
              if (ahead <= 0.25) continue;
              near = true;
              const sign = (ox * lx + oy * ly) > 0 ? -1 : 1; // 상대 반대쪽으로
              const w = (1 - od / look) * ahead;
              stx += lx * sign * w; sty += ly * sign * w;
            }
            if (near) {
              v.x += stx * speed * 2.6 * dt; v.y += sty * speed * 2.6 * dt;
              const sp2 = Math.hypot(v.x, v.y); if (sp2 > speed) { v.x = v.x / sp2 * speed; v.y = v.y / sp2 * speed; }
              setTilt(v.x > 4 ? 1 : v.x < -4 ? -1 : 0); // 실제 진행 방향으로 기울임 갱신
            }
          }
        }
      } else if (now >= until) { if (mode === 'talk') setSay(null); pick(now); }
      if (mode !== 'move') { v.x *= 0.86; v.y *= 0.86; } // 정지 마찰
      pos = { x: pos.x + v.x * dt, y: pos.y + v.y * dt };
      // 겹침 해결 — 미는 쪽은 계속 밀고 밀리는 쪽이 밀려남(넉백 없음)
      { const [rx, ry] = resolveColl(mId, pos.x, pos.y, cr); pos = { x: rx, y: ry }; }
      // 영토 비겹침 — 메인끼리 물든 영역이 안 겹치게 추가 반발(idle일 때도 적용)
      // 벽 충돌 — 경계 넘으면 막고 반대로 튕김(넉백) + 막히면 목표 포기
      const minX = WALL_M, maxX = W - WALL_M - MARK_W, minY = WALL_M, maxY = H - WALL_M - MARK_H;
      let wall = false;
      if (pos.x < minX) { pos.x = minX; v.x = Math.abs(v.x); wall = true; }
      else if (pos.x > maxX) { pos.x = maxX; v.x = -Math.abs(v.x); wall = true; }
      if (pos.y < minY) { pos.y = minY; v.y = Math.abs(v.y); wall = true; }
      else if (pos.y > maxY) { pos.y = maxY; v.y = -Math.abs(v.y); wall = true; }
      if (wall && mode === 'move') { mode = 'idle'; setSt('idle'); setTilt(0); until = now + 250 + Math.random() * 450; }
      // 진짜 꽉 막혀 진행이 거의 없으면(밀어도 안 됨) 목표 포기 → 새 목표
      if (mode === 'move') {
        if (Math.hypot(pos.x - px0, pos.y - py0) < speed * dt * 0.22) stuck++; else stuck = 0;
        if (stuck > 38) { stuck = 0; mode = 'idle'; setSt('idle'); setTilt(0); until = now + 200 + Math.random() * 500; }
      } else stuck = 0;
      COLL.set(mId, { x: pos.x, y: pos.y, r: cr });
      { const [sx, sy, ds, d] = project(pos.x, pos.y, W, H); apply(sx, sy, ds, String(depthZ(d))); }
      // 팔로워 수를 현재 레벨에 맞춤(effect 재실행 없이) — 늘면 슬롯 추가, 줄면 슬롯·충돌박스 정리
      const nfNow = Math.max(0, levelRef.current - 1);
      while (slots.length < nfNow) { slots.push(makeSlot(slots.length, nfNow)); fp.push({ x: pos.x, y: pos.y }); }
      while (slots.length > nfNow) { COLL.delete('f' + i + '_' + (slots.length - 1)); slots.pop(); fp.pop(); }
      // 팔로워 — 슬롯(메인+거리/각)을 lerp로 쫓아옴(일정 간격 두고 따라오는 느낌) + 사인 흔들림
      const t = now / 1000; const fr = followerRefs.current;
      for (let k = 0; k < slots.length; k++) {
        const o = slots[k], p = fp[k]; if (!fr[k]) continue;
        const tx = pos.x + Math.cos(o.ang) * o.rad + Math.sin(t * o.sx + o.phx) * 5;
        const ty = pos.y + Math.sin(o.ang) * o.rad * 0.8 - 6 + Math.sin(t * o.sy + o.phy) * 5;
        const ddx = tx - p.x, ddy = ty - p.y, dd = Math.hypot(ddx, ddy), fstep = o.fspeed * dt;
        if (dd > fstep) {
          let dirx = ddx / dd, diry = ddy / dd;
          // 작은 캐릭터도 회피 조향 — 진행방향 앞의 다른 캐릭터(자기 주인·같은 무리 제외) 반대쪽으로 틀기
          const lx = -diry, ly = dirx, ownM = 'm' + i, sib = 'f' + i + '_';
          let stx = 0, sty = 0, near = false;
          for (const [oid, ob] of COLL) {
            if (oid === ownM || oid.startsWith(sib)) continue;
            const ox = ob.x - p.x, oy = ob.y - p.y, od = Math.hypot(ox, oy), look = o.fcr + ob.r + 26;
            if (od < 0.01 || od > look) continue;
            const ahead = (ox * dirx + oy * diry) / od;
            if (ahead <= 0.2) continue;
            near = true;
            const sign = (ox * lx + oy * ly) > 0 ? -1 : 1;
            const w = (1 - od / look) * ahead;
            stx += lx * sign * w; sty += ly * sign * w;
          }
          if (near) { dirx += stx * 1.6; diry += sty * 1.6; const dl = Math.hypot(dirx, diry) || 1; dirx /= dl; diry /= dl; }
          p.x += dirx * fstep; p.y += diry * fstep;
        } else { p.x = tx; p.y = ty; }
        const fid = 'f' + i + '_' + k;
        const [rx, ry] = resolveColl(fid, p.x, p.y, o.fcr); p.x = rx; p.y = ry;
        // 팔로워도 벽 안에 가둠
        p.x = Math.max(WALL_M * 0.4, Math.min(W - WALL_M * 0.4 - o.fcr * 2.2, p.x));
        p.y = Math.max(WALL_M * 0.4, Math.min(H - WALL_M * 0.4 - o.fcr * 2.2, p.y));
        COLL.set(fid, { x: p.x, y: p.y, r: o.fcr });
        { const [fsx, fsy, fds, fdp] = project(p.x, p.y, W, H); fr[k].style.transform = `translate3d(${fsx}px, ${fsy}px, 0) scale(${fds})`; fr[k].style.zIndex = String(depthZ(fdp)); }
        // 이동 방향으로 기울임(메인처럼) — 방향 바뀔 때만 갱신
        const want = ddx > 6 ? 7 : ddx < -6 ? -7 : 0;
        if (o.tilt !== want) { o.tilt = want; const te = followerTiltRefs.current[k]; if (te) te.style.transform = `rotate(${want}deg)`; }
      }
    };
    addTick(tick); // 단일 티커에 등록 — 캐릭터별 독립 rAF 대신 한 프레임에서 일괄 순회
    const onResize = () => { W = par.clientWidth; H = par.clientHeight; };
    window.addEventListener('resize', onResize);
    return () => { alive = false; removeTick(tick); clearTimeout(hopT.current); window.removeEventListener('resize', onResize); COLL.delete(mId); MARKS.delete(mId); for (let k = 0; k < slots.length; k++) COLL.delete('f' + i + '_' + k); };
  }, [tone.num, i]);
  const onTap = (e) => {
    e.stopPropagation();
    doHop(); playSfx('tap'); haptic(12);
    onOpenCard && onOpenCard(); // 탭 → 성조 미니 카드(정확도·상태·연습 동선)
  };
  return (
    <>
      {/* 레벨만큼의 작은 추종 캐릭터(같은 성조색·눈 없음) — 메인 주변에 구름처럼 모여 떠다님 */}
      {Array.from({ length: Math.max(0, level - 1) }).map((_, k) => {
        const f = Math.max(0.42, 0.58 - k * 0.05);
        const fs = markSize(tone.num) * f;
        return (
          <div key={k} ref={(node) => { followerRefs.current[k] = node; }} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', transformOrigin: `50% ${fs * 0.55}px`, willChange: 'transform' }}>
            <div style={{ position: 'absolute', left: '50%', top: fs * 0.55, transform: 'translateX(-50%)', width: fs * 0.5, height: fs * 0.14, borderRadius: '50%', background: 'rgba(70,62,52,0.09)' }} />
            <div ref={(node) => { followerTiltRefs.current[k] = node; }} style={{ display: 'inline-block', transition: 'transform .25s ease' }}>
              <div style={{ position: 'relative', display: 'inline-block', color: tone.color }}>
                <ToneMark tone={tone.num} size={fs} outline={TONE_KEY_COLORS[tone.num].dark} />
                <Eyes num={tone.num} i={i + k + 1} scale={f} />
              </div>
            </div>
          </div>
        );
      })}
    <div ref={elRef} onClick={onTap} style={{ position: 'absolute', left: 0, top: 0, cursor: 'pointer', willChange: 'transform' }}>
      {/* 몸통 — 원근 스케일은 여기만(머리 UI 제외). transformOrigin=발 */}
      <div ref={bodyRef} style={{ transformOrigin: '50% 44px', willChange: 'transform' }}>
        {/* 접지 그림자 — 점프하면 작아짐 */}
        <div style={{ position: 'absolute', left: '50%', top: 44, transform: `translateX(-50%) scale(${jump ? 0.66 : 1})`, width: 46, height: 11, borderRadius: '50%', background: 'rgba(70,62,52,0.13)', transition: 'transform .22s ease', pointerEvents: 'none' }} />
        {/* 성장 축하 반짝 */}
        {sparkle && [0, 1, 2].map((k) => (
          <div key={k} style={{ position: 'absolute', left: 4 + k * 24, top: -8 - (k % 2) * 12, width: 13, height: 13, pointerEvents: 'none', zIndex: 7, animation: `tg-sparkle 1.1s ease-in-out ${k * 0.2}s 2` }}>
            <svg viewBox="0 0 24 24" width={13} height={13} aria-hidden="true"><path d="M12 0 L14 10 L24 12 L14 14 L12 24 L10 14 L0 12 L10 10 Z" fill="#FFD166" /></svg>
          </div>
        ))}
        {/* 약점 흔들 → 점프 → 둥둥 → 기울임 (transform 분리 합성) */}
        <div style={{ animation: wobble ? 'tg-needme 3.4s ease-in-out infinite' : 'none' }}>
        <div style={{ animation: jump ? 'tg-hop .54s cubic-bezier(.3,.9,.4,1)' : 'none' }}>
          <div style={{ animation: st === 'walk' ? 'tg-bob .5s ease-in-out infinite' : `tg-bob ${idleBob}s ease-in-out infinite` }}>
            {/* 성조색 — ToneMark는 currentColor 사용 → 래퍼 color로 채색. 레벨로 크기 신호(색 변화 없음). 스포트라이트 시 살짝 커짐 */}
            <div style={{ position: 'relative', display: 'inline-block', color: tone.color, transform: `rotate(${tilt * 7}deg) scale(${vScale * (reveal ? 1.3 : 1)})`, transition: 'transform .35s cubic-bezier(.22,1,.36,1)' }}>
              {reveal && <div aria-hidden="true" style={{ position: 'absolute', left: '50%', top: '50%', width: 100, height: 100, transform: 'translate(-50%,-50%)', borderRadius: '50%', pointerEvents: 'none', background: reveal.dir === 'up' ? `radial-gradient(closest-side, ${tone.color}55, ${tone.color}00 72%)` : 'radial-gradient(closest-side, rgba(255,255,255,0.3), rgba(255,255,255,0) 72%)' }} />}
              <ToneMark tone={tone.num} size={markSize(tone.num)} outline={TONE_KEY_COLORS[tone.num].dark} />
              <Eyes num={tone.num} i={i} />
            </div>
          </div>
        </div>
        </div>
      </div>
      {/* 머리 위 UI — 원근 스케일 영향 없음(위치만 rAF로 추적: translateY, top은 0 고정). 말풍선 or Lv 배지+게이지 */}
      <div ref={headRef} style={{ position: 'absolute', left: cx, top: 0, transform: 'translate(-50%, -100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2.5, pointerEvents: 'none', zIndex: 6, willChange: 'transform' }}>
        {reveal ? null /* 레벨 콜아웃은 딤 위(화면 레벨)에서 렌더 — 딤에 안 가려지게 */ : say ? (
          // 말풍선 — HUD 배지(다크 알약)와 정반대: 흰 배경 + 다크 글씨 + 아래 꼬리. "말하는 것"으로 명확히 구분.
          <div style={{ position: 'relative', background: '#fff', color: TG.INK, ...TYPE.labelSm, lineHeight: 1.3, textAlign: 'center', padding: '5px 10px', borderRadius: RADIUS.md, whiteSpace: say.length > 7 ? 'normal' : 'nowrap', maxWidth: 150, width: 'max-content', boxShadow: '0 4px 12px rgba(43,39,48,0.2)' }}>
            {say}
            {/* 아래로 향하는 꼬리 — 캐릭터 머리를 가리킴 */}
            <div style={{ position: 'absolute', left: '50%', bottom: -6, transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: '7px solid #fff' }} />
          </div>
        ) : (
          <>
            <div style={{ height: 15, padding: '0 5px', borderRadius: RADIUS.sm, background: TG.INK, display: 'flex', alignItems: 'center', boxShadow: '0 1px 3px rgba(43,39,48,0.2)' }}>
              <span style={{ ...TYPE.micro, fontWeight: 800, fontSize: 9, color: '#fff', lineHeight: 1, whiteSpace: 'nowrap' }}>Lv.{level}</span>
            </div>
            <div style={{ width: 28, height: 4, borderRadius: RADIUS.xs, background: 'rgba(43,39,48,0.16)', overflow: 'hidden' }}>
              <div style={{ width: `${Math.round((prog || 0) * 100)}%`, height: '100%', borderRadius: RADIUS.xs, background: tone.color, transition: 'width .4s ease' }} />
            </div>
          </>
        )}
      </div>
    </div>
    </>
  );
}

// 메뉴 액션 행 (도움말/로그인/나가기 등) — 시안 461:277: 행 36 · 아이콘 25 · 라벨 16 Bold · 화살표 18
function MenuAction({ Icon, label, sub, color = TG.INK, onClick }) {
  return (
    <button onClick={onClick} className="tg-press" style={{ display: 'flex', alignItems: 'center', gap: SPACE.xl, width: '100%', height: 36, padding: 0, background: 'none', border: 'none', cursor: 'pointer', ...TOUCH_OPT }}>
      <Icon size={25} weight="Bold" color={color} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, textAlign: 'left', ...TYPE.btn, color }}>{label}</span>
      {sub && <span style={{ ...TYPE.meta, color: TG.SUB }}>{sub}</span>}
      <AltArrowRight size={18} weight="Bold" color="#c9c2bb" />
    </button>
  );
}

function HomeMenu({ onClose, onHelp, onCredits, onReset, onDeleteAccount, onLogin, isMemberUser, memberName, onEditNickname, onLogout, onExit, onDebugIntro, onDebugScore }) {
  const [sfxOn, setSfxOn] = useState(() => !isSfxMuted());
  const [bgmOn, setBgmOn] = useState(() => !isBgmMuted());
  const [hapticOn, setHapticOn] = useState(() => !isHapticMuted());
  const toggleSfx = () => { const n = !sfxOn; setSfxOn(n); setSfxMuted(!n); if (n) playSfx('button'); };
  const toggleBgm = () => { const n = !bgmOn; setBgmOn(n); setBgmMuted(!n); if (n) startBgm(); }; // 켜면 홈=메뉴화면이라 즉시 재생
  const toggleHaptic = () => { const n = !hapticOn; setHapticOn(n); setHapticMuted(!n); if (n) haptic(20); };
  // 단어 뜻·병음 = 전역 기본값('g'). 각 모드에서 따로 끄면 그 모드만 덮어쓴다(isMeaningHidden의 폴백).
  const [meaningOn, setMeaningOn] = useState(() => !isMeaningHidden('g'));
  const [pinyinOn, setPinyinOn] = useState(() => !isPinyinHidden('g'));
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: SPACE.x4, ...TOUCH_OPT }}>
      <div className="tg-enter" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 330, background: TG.CARD, borderRadius: RADIUS.xxl, padding: '20px 22px 18px', boxShadow: '0px 4px 18px rgba(43,39,48,0.04)', display: 'flex', flexDirection: 'column', gap: SPACE.x2 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ ...TYPE.head, fontSize: 18, color: TG.INK }}>메뉴</span>
          {/* 히트영역 44×44(음수 마진으로 레이아웃 자리는 30 유지), 시각 크기는 안쪽 30×30 원 그대로 */}
          <button onClick={onClose} aria-label="닫기" className="tg-press" style={{ width: 44, height: 44, margin: -7, padding: 0, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT }}>
            {/* 시안 461:210 — 잉크색 원 + 흰 X(회색 아님) */}
            <CloseCircle weight="Bold" size={28} color={TG.INK} />
          </button>
        </div>
        {/* 토글 묶음 — 시안 802:701(행 간격 6) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
          <MenuToggle Icon={sfxOn ? VolumeLoud : VolumeCross} label="소리" on={sfxOn} onToggle={toggleSfx} />
          <MenuToggle Icon={bgmOn ? MusicNotes : MusicNote} label="음악" on={bgmOn} onToggle={toggleBgm} />
          <MenuToggle Icon={SmartphoneVibration} label="햅틱" on={hapticOn} onToggle={toggleHaptic} />
          <MenuToggle Icon={Notebook} label="단어 뜻" on={meaningOn} onToggle={() => { const n = !meaningOn; setMeaningOn(n); setMeaningHidden('g', !n); }} />
          <MenuToggle Icon={TextField} label="병음" on={pinyinOn} onToggle={() => { const n = !pinyinOn; setPinyinOn(n); setPinyinHidden('g', !n); }} />
        </div>
        <div style={{ height: 1, background: TG.BORDER }} />
        {/* 액션 묶음 — 시안 802:702(행 간격 6) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
          {onHelp && <MenuAction Icon={QuestionCircle} label="게임 방법" onClick={() => { onClose(); onHelp(); }} />}
          {onLogin && <MenuAction Icon={Logout} label="로그인" color={TG.CORAL_DK} onClick={() => { onClose(); onLogin(); }} />}
          {isMemberUser && onEditNickname && <MenuAction Icon={Pen} label="닉네임 변경" sub={memberName || ''} onClick={() => { onClose(); onEditNickname(); }} />}
          {isMemberUser && <MenuAction Icon={Logout} label="로그아웃" onClick={() => { onClose(); onLogout && onLogout(); }} />}
          <MenuAction Icon={Logout} label="게임 나가기" onClick={() => { onClose(); onExit && onExit(); }} />
        </div>
        <div style={{ height: 1, background: TG.BORDER }} />
        <MenuAction Icon={InfoCircle} label="자료출처" onClick={() => { onClose(); onCredits && onCredits(); }} />
        {/* 파괴적 동작 — 위험색으로 구분하고, 누르면 확인창을 한 번 더 띄운다 */}
        {/* 초기화 vs 계정 삭제는 **둘 중 하나만** 보인다(2026-08-10 사용자 지정).
            게스트는 지울 서버 계정이 없으니 '데이터 초기화', 회원은 계정째 지우는 '계정 삭제'.
            둘 다 띄우면 무엇이 어디까지 지워지는지 헷갈린다. */}
        {!isMemberUser
          ? <MenuAction Icon={Refresh} label="데이터 초기화" color={TG.CORAL_DK} onClick={() => { onClose(); onReset && onReset(); }} />
          : <MenuAction Icon={TrashBinTrash} label="계정 삭제" color={TG.CORAL_DK} onClick={() => { onClose(); onDeleteAccount && onDeleteAccount(); }} />}
        {import.meta.env.DEV && onDebugIntro && (
          <>
            <div style={{ height: 1, background: TG.BORDER }} />
            <div style={{ display: 'flex', gap: SPACE.md }}>
              <button onClick={() => { onClose(); onDebugIntro(); }} className="tg-press" style={{ flex: 1, height: 36, borderRadius: RADIUS.md, border: '1.5px solid #ebe5de', background: '#fff', cursor: 'pointer', ...TYPE.labelSm, color: TG.INK, ...TOUCH_OPT }}>🛠 소개부터</button>
              <button onClick={() => { onClose(); onDebugScore(); }} className="tg-press" style={{ flex: 1, height: 36, borderRadius: RADIUS.md, border: '1.5px solid #ebe5de', background: '#fff', cursor: 'pointer', ...TYPE.labelSm, color: TG.INK, ...TOUCH_OPT }}>🛠 점수</button>
            </div>
          </>
        )}
        {/* 버전 — 배포 빌드에서 태그로 동기화되는 __APP_VERSION__ (담백하게 하단 표기) */}
        <div style={{ textAlign: 'center', ...TYPE.micro, fontWeight: 700, color: '#c2bbb2', marginTop: SPACE.xxs, letterSpacing: 0.2 }}>버전 {__APP_VERSION__}</div>
      </div>
    </div>
  );
}

// 자료출처(아이콘 저작권 표기) — Solar 아이콘이 CC BY 4.0이라 크레딧 명시 의무. (폰트=OFL·음성=서비스는 인앱 표기 불필요)
// 실제 쓰는 아이콘 세트만 정직하게. name=에셋, by=저작자, license=라이선스, url=출처.
const CREDITS = [
  { name: 'Solar Icons', by: '480 Design', license: 'CC BY 4.0', url: 'https://www.figma.com/community/file/1166831539721848736' },
  { name: 'Phosphor Icons', by: 'Phosphor', license: 'MIT', url: 'https://phosphoricons.com' },
  { name: 'FluidR3 GM (배경음 악기)', by: 'Frank Wen', license: 'CC BY 3.0', url: 'https://github.com/gleitz/midi-js-soundfonts' },
];

// 자료출처 화면 — 메뉴 '자료출처'에서 진입. 뒤로가기(‹)로 닫음. 각 항목 탭 → 출처 링크(새 탭).
function CreditsModal({ onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 62, background: 'rgba(26,16,20,0.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: SPACE.x4, ...TOUCH_OPT }}>
      <div className="tg-enter" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 320, maxHeight: '82vh', background: TG.CARD, borderRadius: RADIUS.xxl, padding: '16px 22px 20px', boxShadow: '0 20px 50px rgba(26,16,20,0.3)', display: 'flex', flexDirection: 'column', gap: SPACE.x2, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md }}>
          <button onClick={onClose} aria-label="뒤로" className="tg-press" style={{ width: 44, height: 44, margin: '-7px -7px -7px -13px', padding: 0, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT }}>
            <AltArrowLeft weight="Bold" size={26} color={TG.SUB} />
          </button>
          <span style={{ ...TYPE.head, fontSize: 18, color: TG.INK }}>자료출처</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md, overflowY: 'auto', margin: `${SPACE.sm}px -6px 0`, padding: '0 6px' }}>
          {CREDITS.map((c) => (
            <a key={c.name} href={c.url} target="_blank" rel="noopener noreferrer" className="tg-press"
              style={{ display: 'flex', alignItems: 'center', gap: SPACE.xl, textDecoration: 'none', padding: '10px 12px', borderRadius: RADIUS.md, background: TG.SURFACE, ...TOUCH_OPT }}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ ...TYPE.btnSm, color: TG.INK }}>{c.name}</span>
                <span style={{ ...TYPE.meta, color: TG.SUB }}>{c.by} · {c.license}</span>
              </div>
              <LinkCircle size={20} weight="Bold" color={TG.MUTED} style={{ flexShrink: 0 }} />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

// 파괴적 동작 확인창(공용) — 데이터 초기화 / 계정 삭제가 같은 껍데기를 쓴다.
//  ★안내 모달 5종(gameModals.jsx)과 **같은 공용 규격**을 쓴다 — 카드 330 r24 · 제목 24/29 ·
//   본문 14/22 · 키캡 CTA 60 · 텍스트 버튼. 예전엔 이 화면만 자체 카드에 46px 버튼 두 개를
//   나란히 그려 결이 달랐다(2026-08-10 사용자 지적).
//  다만 **아이콘 배지는 넣지 않는다** — 확인만 받는 창에 72px 배지까지 얹으면 과하다(같은 날 지적).
//   그래서 ModalHead 대신 그 안의 제목 스타일만 그대로 가져다 쓴다.
//  zIndex는 설정 메뉴(HomeMenu) 위에 떠야 해서 기본 60이 아니라 64.
function ConfirmModal({ title, lines, confirmLabel, busy, onCancel, onConfirm }) {
  return (
    <ModalCard onClose={busy ? undefined : onCancel} zIndex={64}>
      <span style={{ ...TYPE.head, fontSize: 24, lineHeight: '29px', color: TG.INK, textAlign: 'center' }}>{title}</span>
      <ModalBody lines={lines} />
      {/* 처리 중엔 onClick을 비워 이중 탭을 막는다(공용 버튼에 disabled가 없어서). */}
      <KeycapCta label={busy ? '처리 중…' : confirmLabel} onClick={busy ? undefined : onConfirm} />
      <ModalTextButton label="취소" onClick={busy ? undefined : onCancel} />
    </ModalCard>
  );
}

// 내 정보 카드 — 아바타(등급 앰블럼) + 등급명 + 닉네임 + 진행 게이지(%). 사용자 시안(442:2) 값.
// 탭 → 게스트·회원 공통으로 프로필 모달(로그인 상태·닉네임·수정·등급·SNS로그인)을 먼저 띄운다.
function MyInfo({ tier, nickname, onClick }) {
  const displayName = nickname || '게스트'; // 게스트(로그인 안 함) 폴백
  const lv = levelInfo(tier.xp || 0);       // 게이지 = 레벨(Lv.N) 진행. 아바타 = 등급 앰블럼(보스 클리어).
  const pct = Math.round(lv.progress * 100);
  return (
    <button onClick={onClick} className="tg-press" data-coach="tg-myinfo"
      aria-label="내 프로필 열기" style={{
      position: 'absolute', left: 24, top: 20, width: 192, height: 72, display: 'flex', alignItems: 'center',
      padding: 0, borderRadius: 20, background: HOME.CARD, border: 'none', cursor: 'pointer',
      boxShadow: `inset 0 -2px 0 ${HOME.CARD_SHADOW}`, zIndex: 5, ...TOUCH_OPT,
    }}>
      {/* 내부는 시안 절대좌표 그대로 — 시안 453:2 실측(2026-08-10 사용자 개편, 구 172×60에서 확대):
          카드 192×72 · 앰블럼(2,1,70) · 등급명(75,8,14px) · 닉네임(75,27,16px) · 트랙(75,53,60×10) · %(139,50,14px) */}
      {/* 등급 앰블럼 — 브라운 원 자리표시 대신 실제 등급 이미지(rankInfo().emblem = /game/emblems/tierN.png).
          ★Figma가 내보낸 tier2 샘플이 아니라 **등급별로 바뀌는 프로젝트 에셋**을 계속 쓴다(크기만 시안에 맞춤). */}
      <img src={tier.emblem} alt="" style={{ position: 'absolute', left: 2, top: 1, width: 70, height: 70, maxWidth: 'none', objectFit: 'contain', display: 'block' }} />
      <span style={{ position: 'absolute', left: 75, top: 8, ...TYPE.labelSm, fontSize: 14, lineHeight: '17px', color: HOME.ACCENT, whiteSpace: 'nowrap' }}>{tier.name}</span>
      <span style={{ position: 'absolute', left: 75, top: 27, maxWidth: 105, ...TYPE.label, fontSize: 16, lineHeight: '19px', color: HOME.INK, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</span>
      {/* 트랙 r19 클립 → 채움은 왼쪽만 라운드(시안 per-corner)·오른쪽 플랫 */}
      <div style={{ position: 'absolute', left: 75, top: 53, width: 60, height: 10, borderRadius: 19, background: HOME.GAUGE_TRACK, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(13, pct)}%`, height: '100%', background: HOME.TAB_RED, transition: 'width .5s ease' }} />
      </div>
      {/* ★게이지 라벨은 `%`가 아니라 **`Lv.N`**(2026-08-12, 시안 453:2 동기화).
          이 게이지는 레벨 진행도(levelInfo(xp).progress)인데 등급명 바로 아래에 `%`만 있어
          '등급' 진행도로 읽혔다. 등급은 승급시험으로만 오르므로, 게이지를 100% 채워도 등급이
          그대로여서 "채웠는데 왜 안 올라?"가 된다. 진행량은 막대가 말하고, 라벨은 **무엇이**
          차오르는지를 말한다. (구 시안 노드명도 '정답률'이라 의미가 어긋나 있어 '레벨'로 교정) */}
      <span style={{ position: 'absolute', left: 139, top: 50, ...TYPE.num, fontWeight: 400, fontSize: 14, lineHeight: '16px', color: HOME.INK }}>Lv.{lv.level}</span>
    </button>
  );
}

// 스트릭 불꽃 티어 — 연속일수가 스테이크(끊기면 회색 0으로 리셋, 눈에 보이는 스팅). 색/글로우/이름 상승.
const STREAK_TIERS = [
  { min: 30, label: '불기둥', color: '#8B5CF6', glow: '#B79CF2' },
  { min: 14, label: '이글이글', color: '#4D8DFF', glow: '#8FBEFF' },
  { min: 7, label: '활활', color: TG.CORAL_DK, glow: '#FF9A6B' },
  { min: 3, label: '불꽃', color: '#F0A91E', glow: '#FFC94D' },
  { min: 1, label: '불씨', color: HOME.STREAK_FLAME, glow: HOME.STREAK_FLAME_SOFT }, // 시안 개선안 색(주황 2톤)
  { min: 0, label: '꺼진 재', color: '#b9a89f', glow: 'transparent' },
];
const streakTier = (days) => STREAK_TIERS.find((t) => (days || 0) >= t.min) || STREAK_TIERS[STREAK_TIERS.length - 1];
const STREAK_MILESTONES = [3, 7, 14, 30];

// 스트릭 칩 — 중앙 하단(게임시작 CTA 위). 불꽃(티어색+글로우) + 연속일 + ❄️보유. 탭→상세 시트. (2026-07-27 시안: 우상단→중앙 이동)
function StreakPill({ streak, freezes = 0, onClick }) {
  const animStreak = useCountUp(streak, 800);
  const tier = streakTier(streak);
  return (
    <button onClick={onClick} className="tg-press" data-coach="tg-streak" style={{ position: 'absolute', left: 0, right: 0, margin: '0 auto', width: 'fit-content', bottom: `calc(${TAB_BAR_H + 87}px + env(safe-area-inset-bottom))`, height: 38, display: 'flex', alignItems: 'center', gap: SPACE.sm, padding: '0 16px 4px 8px', borderRadius: 50, background: HOME.CARD, boxShadow: `inset 0 -2px 0 ${HOME.CARD_SHADOW}`, border: 'none', cursor: 'pointer', zIndex: 5, ...TOUCH_OPT }}>
      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        {streak > 0 && <EmberRise colors={[tier.color, tier.glow]} count={6} spread={12} rise={22} size={2.4} zIndex={0} style={{ bottom: '38%' }} />}
        {/* 시안 개선안: 26px 2톤 불꽃(BoldDuotone — 겉 티어색 + 안쪽 코어) */}
        <Flame size={26} weight="BoldDuotone" color={tier.color} style={{ position: 'relative', filter: streak > 0 ? `drop-shadow(0 0 5px ${tier.glow})` : 'none' }} />
      </span>
      {/* 숫자+단위를 한 덩어리로(시안 "1일" 16px 단일 텍스트) */}
      <span style={{ ...TYPE.numMd, fontSize: 16, color: TG.INK, lineHeight: 1 }}>{animStreak}일</span>
      {freezes > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 1, marginLeft: SPACE.xs }} aria-label={`보호권 ${freezes}개`}><Snowflake size={13} weight="Bold" color="#4D8DFF" /><span style={{ ...TYPE.numMd, fontSize: 12, color: '#4D8DFF' }}>{freezes}</span></span>}
    </button>
  );
}

// 하단 시트 공통 규격(시안 769:42 · 769:66) — 흰 카드 상단 r26 · 좌우 20 · 아래 40 · 그룹 간격 22.
const SHEET_STAT_BG = '#F7F6F5';   // 통계 카드 배경(시트 전용 — TG.SURFACE보다 밝은 웜그레이)
const SHEET_STAT_H = 69.1;
// 숫자+단위 한 쌍(‘5일’ ‘1성’) — 숫자는 Roboto Bold 28, 단위는 Noto Bold 24, 베이스라인 정렬.
//  ★lineHeight를 시안 텍스트 박스 높이(=cap 높이 20/18)로 맞춘다. 기본 라인박스로 두면 아래 문구와의
//   간격이 시안(cap 기준)보다 8~10px 벌어진다(2026-08-06 사용자 지적).
function BigCount({ num, unit }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE.xxs, color: TG.INK, whiteSpace: 'nowrap' }}>
      <span style={{ ...TYPE.numLg, fontWeight: 700, fontSize: 28, lineHeight: '20px' }}>{num}</span>
      <span style={{ ...TYPE.head, fontSize: 24, lineHeight: '18px' }}>{unit}</span>
    </div>
  );
}

// 스트릭 상세 시트 — Pill 탭. 티어·최장·다음 마일스톤·보호권. 하단 슬라이드(dim 페이드). 버튼 없음(순수 정보).
function StreakSheet({ streak, longest, freezes, onClose }) {
  const [closing, setClosing] = useState(false);
  const close = () => { if (closing) return; setClosing(true); setTimeout(onClose, 270); };
  const tier = streakTier(streak);
  const next = STREAK_MILESTONES.find((m) => m > streak) || null;
  const prevM = [...STREAK_MILESTONES].reverse().find((m) => m <= streak) || 0;
  const prog = next ? Math.max(0, Math.min(1, (streak - prevM) / (next - prevM))) : 1;
  const sub = streak > 0 ? '연속 플레이 중' : (longest > 0 ? '다시 불붙여봐요!' : '오늘 첫 불씨를 붙여봐요');
  return (
    <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', ...TOUCH_OPT }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,16,20,0.5)', backdropFilter: 'blur(2px)', animation: closing ? 'tg-fade-out .28s ease forwards' : 'tg-dim-in .28s ease' }} />
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', width: '100%', maxWidth: TG_COL_MAXW, background: TG.CARD, borderRadius: '26px 26px 0 0', padding: '20px 20px calc(40px + env(safe-area-inset-bottom))', boxShadow: '0 -10px 40px rgba(26,16,20,0.25)', display: 'flex', flexDirection: 'column', gap: 22, animation: closing ? 'tg-sheet-down .26s ease forwards' : 'tg-sheet-up .32s cubic-bezier(.2,.85,.25,1)' }}>
        {/* 헤더 — 불꽃 56 + [연속일 · 상태 한 줄] (닫기 버튼 없음: 딤 탭으로 닫는다) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ position: 'relative', width: 56, height: 56, borderRadius: RADIUS.lg, background: `${tier.color}1c`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {streak > 0 && <EmberRise colors={[tier.color, tier.glow]} count={12} spread={26} rise={48} size={3.6} zIndex={0} style={{ bottom: '22%' }} />}
            <Flame size={32} weight="Bold" color={tier.color} style={{ position: 'relative', filter: streak > 0 ? `drop-shadow(0 0 6px ${tier.glow})` : 'none' }} />
          </div>
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
            <BigCount num={streak} unit="일" />
            {/* 시안 769:50은 cap 박스(h10) — 라인박스로 두면 숫자와의 간격이 벌어진다 */}
            <span style={{ ...TYPE.body, fontWeight: 400, fontSize: 14, lineHeight: '10px', color: TG.INK }}>{sub}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.x2 }}>
          {next ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', ...TYPE.body, fontSize: 14, lineHeight: '19px' }}>
                <span style={{ color: TG.SUB }}>다음 목표 {next}일</span>
                <span style={{ fontWeight: 700, color: TG.INK }}>{Math.max(0, next - streak)}일 남음</span>
              </div>
              <div style={{ height: 8, borderRadius: RADIUS.xs, background: '#ece6dd', overflow: 'hidden' }}>
                <div style={{ width: `${Math.round(prog * 100)}%`, height: '100%', borderRadius: RADIUS.xs, background: tier.color, transition: 'width .5s ease' }} />
              </div>
            </div>
          ) : (
            <div style={{ ...TYPE.label, color: TG.SUCCESS_GLOW }}>모든 마일스톤 달성! 🎉</div>
          )}
          <div style={{ display: 'flex', gap: SPACE.lg }}>
            <CardStat label="최장 기록" value={`${longest}일`} />
            <CardStat label="보호권">
              <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
                <Snowflake size={22} weight="Bold" color="#4D8DFF" />
                <span style={{ ...TYPE.numLg, fontWeight: 900, fontSize: 22, lineHeight: '26.4px', color: TG.INK }}>{freezes}/2</span>
              </div>
            </CardStat>
          </div>
        </div>
      </div>
    </div>
  );
}

// 성조 미니 카드 — 캐릭터 탭 시. 순수 진단(정확도·시도·상태). 하단 시트(슬라이드 업/다운).
// 연습/복습 CTA는 뺌(사용자 지적): 성조 하나만 나오는 문제는 만들 수 없고, 안다고 풀면 성조 학습 의미가 없음.
const STATE_LABEL = { unknown: '아직 데이터가 적어요', weak: '아직 헷갈려요', mid: '꽤 익숙해요', strong: '탄탄해요' };
const STATE_COLOR = { unknown: TG.SUB, weak: TG.CORAL_DK, mid: '#F0A91E', strong: TG.SUCCESS_GLOW };
const STATE_NOTE = { unknown: '게임을 더 하면 이 성조 실력이 보여요.', weak: '게임에서 이 성조가 나올 때 귀 기울여보세요.', mid: '조금만 더 하면 탄탄해져요.', strong: '이 성조는 거의 마스터했어요! 👍' };
// 성조 '소리' 한 줄 — 표준 5도 표기법(1성 55 · 2성 35 · 3성 214 · 4성 51 / 경성은 자체 높이 없음)을 말로 푼 것.
//  ★출처 구분(chinese_tone_rules 규약): 아래는 **전부 표준 중국어 규범**이고, 하늘쌤 고유 교수 규칙은
//   '연음'(3성 보조설명) 하나뿐이다. 없는 규칙을 지어내거나 표준 규범을 하늘쌤 규칙이라 부르지 말 것.
const TONE_SOUND = {
  1: '높은 음을 평평하게 쭉 유지해요.',
  2: '중간에서 위로 끌어올려요.',
  3: '내렸다가 살짝 올려요.',
  4: '높은 데서 아래로 뚝 떨어뜨려요.',
  0: '짧고 가볍게 — 높이는 앞 성조가 정해요.',
};
// 보조 한 줄 — 규범상 덧붙일 게 있는 성조만. 3성의 연음이 게임의 하늘쌤 시그니처인데
//  튜토리얼에서 2.2초 스치고 다시 볼 곳이 없었다 → 여기가 그 자리.
const TONE_NOTE2 = {
  3: '뒤에 다른 성조가 오면 내리기만 해요(반3성). 그중 2성이 오면 끊지 않고 이어서 — 연음.',
};
// 시트 통계 카드 — 시안: 라벨(14 Medium)이 위, 수치(22 Roboto Black)가 아래. children으로 수치 자리를 대체할 수 있다.
function CardStat({ label, value, children }) {
  return (
    <div style={{ flex: 1, minWidth: 0, height: SHEET_STAT_H, background: SHEET_STAT_BG, borderRadius: RADIUS.lg, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: SPACE.xxs }}>
      <span style={{ ...TYPE.body, fontSize: 14, lineHeight: '19px', color: TG.INK }}>{label}</span>
      {children || <span style={{ ...TYPE.numLg, fontWeight: 900, fontSize: 22, lineHeight: '26.4px', color: TG.INK }}>{value}</span>}
    </div>
  );
}
function ToneCard({ tone, status, level, onClose }) {
  const [closing, setClosing] = useState(false);
  const close = () => { if (closing) return; setClosing(true); setTimeout(onClose, 270); }; // 슬라이드 다운 후 언마운트
  const s = status || { acc: 0, attempts: 0, state: 'unknown' };
  const accTxt = s.attempts > 0 ? `${Math.round(s.acc * 100)}%` : '—';
  const sample = TONE_SAMPLES[tone.num]; // 妈麻马骂吗 — 성조만 다른 최소대립쌍(TTS 기생성)
  return (
    <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', ...TOUCH_OPT }}>
      {/* Dim — 별도 레이어로 분리(카드와 형제). opacity 페이드가 카드에 안 번지게 */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,16,20,0.5)', backdropFilter: 'blur(2px)', animation: closing ? 'tg-fade-out .28s ease forwards' : 'tg-dim-in .28s ease' }} />
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', width: '100%', maxWidth: TG_COL_MAXW, background: TG.CARD, borderRadius: '26px 26px 0 0', padding: '23px 20px calc(40px + env(safe-area-inset-bottom))', boxShadow: '0 -10px 40px rgba(26,16,20,0.25)', display: 'flex', flexDirection: 'column', gap: 22, animation: closing ? 'tg-sheet-down .26s ease forwards' : 'tg-sheet-up .32s cubic-bezier(.2,.85,.25,1)' }}>
        {/* 헤더 — 성조 마크 54(아래에 Lv 배지가 걸침) + [n성 · 상태] (닫기 버튼 없음: 딤 탭으로 닫는다) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 54, display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
            <div style={{ width: 54, height: 54, borderRadius: RADIUS.lg, background: `${tone.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tone.color }}>
              <ToneMark tone={tone.num} size={tone.num === 0 ? 30 : 46} />
            </div>
            {/* Lv 배지 — 마크 박스 아래로 15 겹침(시안 800:664) */}
            <span style={{ marginTop: -15, display: 'flex', alignItems: 'center', padding: '2px 7px', borderRadius: RADIUS.sm, background: TG.INK, color: '#fff', whiteSpace: 'nowrap' }}>
              <span style={{ ...TYPE.label, fontWeight: 900, lineHeight: '17px' }}>Lv.</span>
              <span style={{ ...TYPE.numMd, fontWeight: 900, fontSize: 16, lineHeight: '17px' }}>{level}</span>
            </span>
          </div>
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
            <BigCount num={tone.num === 0 ? '' : tone.num} unit={tone.num === 0 ? tone.name : '성'} />
            <span style={{ ...TYPE.labelSm, lineHeight: '19px', color: STATE_COLOR[s.state] }}>{STATE_LABEL[s.state]}</span>
          </div>
        </div>
        {/* 소리 — "이 성조가 어떤 소리인지"를 **아무 때나** 볼 수 있는 자리(2026-08-12).
            구버전 시트는 정확도·시도 통계뿐이라 "3성이 뭐였지?"에 답하지 못했다. 성조 설명이 있는 곳은
            튜토리얼(다시 보려면 5단계 전부 재생)과 전환 화면 랜덤 팁(7개 중 3개)뿐이라 원할 때 못 봤다.
            ★샘플은 튜토리얼의 TONE_SAMPLES(妈麻马骂吗) 재사용 — 같은 'ma'라 **성조 차이만 남는 최소대립쌍**이고
              TTS 음성도 이미 생성돼 있다(새 에셋 0개).
            ※ 여기 CTA는 '들어보기'뿐 — 연습/복습 CTA는 이 시트에서 뺀 상태를 유지한다(위 주석). */}
        {sample && (
          <div style={{ background: SHEET_STAT_BG, borderRadius: RADIUS.lg, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
            <span style={{ ...TYPE.body, fontSize: 14, lineHeight: '21px', color: TG.INK }}>{TONE_SOUND[tone.num]}</span>
            {TONE_NOTE2[tone.num] && (
              <span style={{ ...TYPE.body, fontSize: 13, lineHeight: '19px', color: TG.SUB }}>{TONE_NOTE2[tone.num]}</span>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.lg }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE.md, minWidth: 0 }}>
                <span style={{ fontFamily: FONT_HANZI, fontWeight: 700, fontSize: 28, lineHeight: 1, color: TG.INK }}>{sample.hanzi}</span>
                <span style={{ fontFamily: FONT_PINYIN, fontSize: 15, color: tone.color }}>{sample.pinyin.join('')}</span>
                <span style={{ ...TYPE.labelSm, color: TG.SUB, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sample.meaning}</span>
              </div>
              <button type="button" className="tg-press" onClick={() => { playSfx('tap'); haptic(10); speakWord(sample); }}
                aria-label={`${tone.name} 예시 ${sample.hanzi} 발음 듣기`}
                style={{
                  flexShrink: 0, height: 34, padding: '0 12px', borderRadius: RADIUS.lg, border: 'none', cursor: 'pointer',
                  background: '#fff', boxShadow: 'inset 0 -2px 0 #E4EDF5, 0 2px 8px rgba(43,39,48,0.05)',
                  display: 'flex', alignItems: 'center', gap: SPACE.sm, ...TOUCH_OPT,
                }}>
                <VolumeLoud size={16} weight="Bold" color={TG.INK} />
                <span style={{ ...TYPE.labelSm, color: TG.INK, whiteSpace: 'nowrap' }}>들어보기</span>
              </button>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: SPACE.lg }}>
          <CardStat label="정확도" value={accTxt} />
          <CardStat label="시도" value={`${s.attempts}`} />
        </div>
      </div>
    </div>
  );
}


export function HomeScreen({
  // ※ onExam·examPrompt·onExamPromptClose 제거 — 본문에서 쓰이지 않는 죽은 배선이었다(유일한 소비처였을
  //   ProfileModal에는 onExam={null}이 하드코딩돼 있음). 승급시험 진입은 난이도 사다리와 결과화면이 담당한다.
  streak = 0, streakLongest = 0, freezes = 0, xp = 0, rank = 0, toneLevels = {}, toneStatus = {}, coachTone = null, celebrateTone = null,
  levelReveals = [], onRevealsDone, revealHold = false,
  homeReady = true,
  onPlay, onNavTab, onHelp,
  onLogin, isMemberUser, memberName, nickname = null, onEditNickname, onLogout, onExit, studentToken, onRefreshBest, onDebugIntro, achDot = false,
}) {
  const tier = { ...rankInfo(rank), xp }; // 엠블럼·이름 = 등급(rank=급). xp는 MyInfo·ProfileModal의 레벨 게이지(levelInfo)용
  const isGuest = !!onLogin; // onLogin은 게스트일 때만 내려온다(회원/학생은 null)
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [nickEditOpen, setNickEditOpen] = useState(false);
  // 놀러가기·하늘하늘은 탭바(전용 화면)로 이동(2026-07-27 리디자인) — 모달 상태·레드닷 제거
  const [debugScoreOpen, setDebugScoreOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false); // 자료출처 화면(오픈소스 저작권 표기)
  const [resetOpen, setResetOpen] = useState(false);     // 데이터 초기화 확인창
  const [delOpen, setDelOpen] = useState(false);         // 계정 삭제 확인창
  const [delBusy, setDelBusy] = useState(false);
  const [cardTone, setCardTone] = useState(null); // 탭한 성조 미니 카드
  const [streakOpen, setStreakOpen] = useState(false); // 스트릭 상세 시트
  const [showIntro, setShowIntro] = useState(() => { try { return !localStorage.getItem('tg_home_intro'); } catch { return false; } });
  const coach = useTabTip('game-home', true); // 첫 방문 코치마크 가이드(1회)
  // (홈 방 목소리 게이트 effect는 introActive 선언 뒤로 이동 — 아래 참조)
  // 성조 레벨 변화 스포트라이트 — 홈 도착 후 바뀐 성조를 하나씩(방 딤 + 캐릭터 강조·콜아웃)
  const [revealIdx, setRevealIdx] = useState(-1);
  const [revealPos, setRevealPos] = useState(null);  // 스포트라이트 구멍 중심 — **화면(스테이지) 좌표**
  const [holeSize, setHoleSize] = useState(2600);     // 구멍 지름 — 화면보다 크게 시작해 좁힘
  const firstRevealRef = useRef(true);
  const HOLE = 180;
  // ★캐릭터가 보고하는 좌표는 '캐릭터 컨테이너' 기준(top: ROOM_TOP)인데, 딤 SVG·콜아웃은 스테이지 전체(inset 0)에
  //   놓이므로 여기서 ROOM_TOP을 더해 화면 좌표로 변환한다. 안 하면 구멍이 캐릭터보다 146px 위에 뚫린다.
  const onRevealPos = (p) => {
    setRevealPos({ x: p.x, y: p.y + ROOM_TOP });
    if (firstRevealRef.current) { firstRevealRef.current = false; setHoleSize(2600); } // 첫 등장 = 화면보다 큰 구멍
    else setHoleSize(HOLE + 70);                                                        // 다음 캐릭터로 슬라이드하며 살짝 조임
    requestAnimationFrame(() => requestAnimationFrame(() => setHoleSize(HOLE)));         // → 좁혀지며 강조
  };
  useEffect(() => {
    if (levelReveals.length && homeReady && revealIdx === -1) { firstRevealRef.current = true; setHoleSize(2600); setRevealIdx(0); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelReveals, homeReady]);
  useEffect(() => {
    if (revealIdx < 0) return undefined;
    if (revealIdx >= levelReveals.length) { // 시퀀스 끝 — 구멍 넓히며 딤 해제(iris out) 후 정리
      setHoleSize(2600);
      const t = setTimeout(() => { setRevealPos(null); setRevealIdx(-1); onRevealsDone && onRevealsDone(); }, 600);
      return () => clearTimeout(t);
    }
    if (charCanSpeak()) playSfx('tone' + levelReveals[revealIdx].tone); // 그 성조 캐릭터가 자기 목소리로(홈 방 보고있을 때만)
    if (revealHold) return undefined; // 미리보기: 자동 진행 X(딤 탭으로 넘김)
    const id = setTimeout(() => setRevealIdx((n) => n + 1), 2200);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealIdx]);
  const activeReveal = revealIdx >= 0 && revealIdx < levelReveals.length ? levelReveals[revealIdx] : null;
  // 첫 방문 인트로 코치(tg_home_intro) 게이트 — 레벨 스포트라이트와 같은 홈 방문에 겹치면 말풍선이
  // 딤(z55) 아래(방 컨테이너 zIndex:0) 깔려 '안 보인 채 소모'되고 SFX만 이중 재생됨.
  // → 이번 방문에 스포트라이트가 예정/재생됐으면 래치로 인트로 보류(플래그 미저장 → 다음 홈 방문에 정상 노출).
  const introBlockedRef = useRef(false);
  if (levelReveals.length > 0 || revealIdx >= 0) introBlockedRef.current = true;
  const introActive = showIntro && !introBlockedRef.current;
  // 캐릭터 목소리 게이트 — 오버레이가 방을 덮으면 정지("홈 방을 보고있지 않으면 안 남"). 백그라운드는 charCanSpeak가 visibilityState로 별도 처리. 언마운트(다른 화면) 시 false.
  // ★인트로가 '보류'된 방문(스포트라이트 겹침)에는 showIntro가 true로 남아도 화면을 안 덮으므로, raw showIntro가 아니라 introActive로 게이트해야
  //  레벨업 스포트라이트 목소리(playSfx('tone'…))가 음소거되지 않음(2026-07-21 수정).
  useEffect(() => {
    homeRoomActive = !(menuOpen || profileOpen || nickEditOpen || streakOpen || debugScoreOpen || !!cardTone || introActive);
    return () => { homeRoomActive = false; };
  }, [menuOpen, profileOpen, nickEditOpen, streakOpen, debugScoreOpen, cardTone, introActive]);
  // 첫 방문 코치 1회 — 약점 성조가 정해지면 표시·플래그 저장, 잠시 후 종료. 플래그 저장은 말풍선이 실제로 뜨는 경로에서만.
  useEffect(() => {
    if (!(introActive && coachTone != null)) return undefined;
    try { localStorage.setItem('tg_home_intro', '1'); } catch { /* noop */ }
    const id = setTimeout(() => setShowIntro(false), 6500);
    return () => clearTimeout(id);
  }, [introActive, coachTone]);
  // ★루트는 프래그먼트 — 화면 컨테이너(FigmaScreen)는 ToneGamePage가 다른 탭과 **같은 자리**에서 그린다.
  //  홈만 자기 FigmaScreen을 그리면 탭 전환 때 컴포넌트 타입이 달라져 통째로 remount → 진입 페이드가 재생돼 탭바가 깜빡였다(2026-08-06).
  return (
    <>
      {/* 방 (플랫 카툰 룸) — 벽·몰딩·타일 바닥 위를 캐릭터가 돌아다님 */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
        {/* 풀블리드 + 독립 stacking context(zIndex:0) — 캐릭터(내부 z300~600)가 UI(HUD/탭바/버튼) 위로 안 뜨고 방 안에만. */}
        <FlatRoom />
        {/* 캐릭터 컨테이너 — 물리 좌표계(평면). 걷기 영역 = 몰딩 아래 ~ 스트릭 필 위. overflow visible(말풍선·머리 배지) */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: ROOM_TOP, bottom: `calc(${TAB_BAR_H + 130}px + env(safe-area-inset-bottom))`, overflow: 'visible' }}>
          {TONES.map((t, i) => {
            const d = toneLevels[t.num] || { lv: 1, prog: 0 };
            const stt = toneStatus[t.num] || { state: 'unknown' };
            return <WanderingMark key={t.num} tone={t} i={i} level={Math.min(5, d.lv || 1)} prog={d.prog || 0}
              state={stt.state} celebrate={celebrateTone === t.num}
              reveal={activeReveal && activeReveal.tone === t.num ? activeReveal : null} onRevealPos={onRevealPos}
              introLine={introActive && coachTone === t.num ? `난 너의 ${t.name}! 같이 연습하면 무럭무럭 자라요` : null}
              onOpenCard={() => setCardTone(t.num)} />;
          })}
          {/* 장난감 공 — 캐릭터와 같은 물리평면. 가끔 캐릭터가 와서 참(패스)·부딪히면 굴러감 */}
          <ToyBall />
          {/* 타격 이펙트 — 캐릭터 위 오버레이(공 차기·부딪힘 시 팝). 좌표계 공유를 위해 같은 컨테이너 안 */}
          <ImpactFX />
        </div>
      </div>

      {/* 레벨 스포트라이트 — 전체 화면 SVG + mask 구멍(CoachMarkOverlay와 같은 방식)을 화면 레벨(z55)에 둬
          UI(상단 정보·메뉴·플레이 등)까지 덮음. 구멍은 방 안 캐릭터(z640, 방=z0)를 뚫어 보여줌.
          화면보다 큰 구멍 → 캐릭터로 좁혀지며(iris-in) 강조. 래퍼가 화면 전체의 포인터를 받아(탭=다음 단계)
          그림자 영역 아래 플레이 CTA·메뉴가 연출 중 탭되는 클릭 통과를 차단(과거 box-shadow 홀은 원만 포인터를 받았음). */}
      {revealPos && (
        <div onClick={() => { if (activeReveal) setRevealIdx((n) => n + 1); }} style={{ position: 'absolute', inset: 0, zIndex: 55, pointerEvents: 'auto', cursor: 'pointer' }} aria-hidden="true">
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} xmlns="http://www.w3.org/2000/svg">
            <defs>
              <mask id="tg-lv-mask">
                <rect width="100%" height="100%" fill="white" />
                {/* 구멍 — cx/cy/r을 CSS(geometry property)로 줘 기존과 동일한 이동·조임 트랜지션 유지 */}
                <circle fill="black" style={{ cx: revealPos.x, cy: revealPos.y, r: holeSize / 2, transition: 'r .62s cubic-bezier(.33,0,.2,1), cx .5s cubic-bezier(.4,0,.2,1), cy .5s cubic-bezier(.4,0,.2,1)' }} />
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(18,13,22,0.72)" mask="url(#tg-lv-mask)" />
          </svg>
        </div>
      )}
      {/* 레벨 콜아웃 — 딤 위(z56)에 별도 렌더 → 딤에 절대 안 가려짐. 스포트라이트 캐릭터 머리 위에 위치. */}
      {activeReveal && revealPos && (
        <div style={{ position: 'absolute', left: revealPos.x, top: revealPos.y - 56, transform: 'translate(-50%, -100%)', zIndex: 56, pointerEvents: 'none' }}>
          <LevelCallout change={activeReveal} color={(TONES.find((t) => t.num === activeReveal.tone) || {}).color} />
        </div>
      )}

      {/* 상단 HUD — 내 정보(좌) · 메뉴(우). 시안: 카드 = HOME.CARD + 하드 파스텔 섀도 */}
      <MyInfo tier={tier} nickname={nickname} onClick={() => setProfileOpen(true)} />
      <StreakPill streak={streak} freezes={freezes} onClick={() => setStreakOpen(true)} />
      <button onClick={() => setMenuOpen(true)} aria-label="메뉴" className="tg-press"
        style={{ position: 'absolute', right: 24, top: 20, width: 50, height: 50, borderRadius: RADIUS.xl, background: HOME.CARD, boxShadow: `inset 0 -2px 0 ${HOME.CARD_SHADOW}`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5, ...TOUCH_OPT }}>
        <Settings size={30} weight="Bold" color={HOME.BROWN} />
      </button>

      {/* 모드 선택 키캡 CTA(중앙 하단·은은한 펄스) — 탭 시 모드선택 화면으로 */}
      {/* 센터링은 flex로(펄스 keyframes가 transform을 덮어써 translateX 센터링 불가) */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: `calc(${TAB_BAR_H + 17}px + env(safe-area-inset-bottom))`, zIndex: 3, display: 'flex', justifyContent: 'center', pointerEvents: 'none', animation: 'tg-cta-pulse 2.6s ease-in-out infinite' }}>
        <button className="tg-press" data-coach="tg-play" onClick={() => { playSfx('button'); if (coach.visible) coach.dismiss(); onPlay && onPlay(); }} style={{
          width: 160, height: 60, borderRadius: RADIUS.xl, border: 'none', cursor: 'pointer', pointerEvents: 'auto',
          background: HOME.TAB_RED, boxShadow: `0 10px 20px rgba(242,72,76,0.10), inset 0 -4px 0 ${HOME.CTA_EDGE}`,
          // 인너 엣지(4px)만큼 내부 요소를 올려 시각 균형(사용자 규칙: 그림자 두께 = 콘텐츠 리프트)
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.md, paddingBottom: 8, ...TOUCH_OPT,
        }}>
          <span style={{ ...TYPE.cta, fontWeight: 800, fontSize: 21, color: '#fff' }}>모드 선택</span>
          <Play size={18} weight="Bold" color="#fff" />
        </button>
      </div>

      {cardTone != null && <ToneCard tone={TONES.find((t) => t.num === cardTone)} status={toneStatus[cardTone]} level={Math.min(5, (toneLevels[cardTone] || {}).lv || 1)} onClose={() => setCardTone(null)} />}
      {streakOpen && <StreakSheet streak={streak} longest={streakLongest} freezes={freezes} onClose={() => setStreakOpen(false)} />}
      {profileOpen && <ProfileModal tier={tier} nickname={nickname} isGuest={isGuest} isMemberUser={isMemberUser} userId={studentToken}
        onEditNickname={onEditNickname ? () => { setProfileOpen(false); setNickEditOpen(true); } : null}
        onExam={null}
        onLogout={onLogout}
        onClose={() => setProfileOpen(false)} />}
      {menuOpen && <HomeMenu onClose={() => setMenuOpen(false)} onHelp={onHelp} onCredits={() => setCreditsOpen(true)} onReset={() => setResetOpen(true)} onDeleteAccount={() => setDelOpen(true)} onLogin={onLogin} isMemberUser={isMemberUser} memberName={memberName} onEditNickname={onEditNickname ? () => setNickEditOpen(true) : null} onLogout={onLogout} onExit={onExit} onDebugIntro={onDebugIntro} onDebugScore={() => setDebugScoreOpen(true)} />}
      {creditsOpen && <CreditsModal onClose={() => setCreditsOpen(false)} />}
      {resetOpen && (
        <ConfirmModal
          title="데이터를 초기화할까요?"
          confirmLabel="초기화"
          lines={[
            '점수·기록·업적이 모두 지워져요.',
            '되돌릴 수 없어요.',
          ]}
          onCancel={() => setResetOpen(false)}
          onConfirm={() => {
            resetGameData();
            // 새로고침 — 메모리에 남은 상태까지 털어내고 처음 화면부터 시작한다.
            try { window.location.reload(); } catch { /* noop */ }
          }} />
      )}
      {delOpen && (
        <ConfirmModal
          title="계정을 삭제할까요?"
          confirmLabel="계정 삭제"
          busy={delBusy}
          lines={[
            '계정이 완전히 삭제돼요.',
            '이 기기 기록도 함께 지워져요.',
            '다시 로그인하면 새 계정으로 시작해요.',
          ]}
          onCancel={() => setDelOpen(false)}
          onConfirm={async () => {
            setDelBusy(true);
            const sess = getMemberSession();
            try { if (sess?.token) await deleteGameMe(sess.token); } catch { /* 서버 실패해도 아래 로컬 정리는 진행 */ }
            resetGameData();
            try { window.location.reload(); } catch { /* noop */ }
          }} />
      )}
      {nickEditOpen && <NicknameEditModal current={nickname || memberName || ''} onSave={onEditNickname} onClose={() => setNickEditOpen(false)} />}
      {import.meta.env.DEV && debugScoreOpen && <DebugScoreModal studentToken={studentToken} onClose={() => setDebugScoreOpen(false)} onApplied={() => onRefreshBest && onRefreshBest()} />}

      {/* 공통 탭바 — 놀러가기·오답 노트·홈(활성)·업적·하늘하늘 */}
      <TgTabBar active="home" onNav={onNavTab} dot={achDot ? "ach" : null} />

      {/* 첫 방문 코치마크 가이드 — 방/등급/연속학습/플레이 순서로 안내(1회). 타이틀→홈 전환(homeTx)이 끝난 뒤에만 표시 */}
      <CoachMarkOverlay visible={homeReady && coach.visible} onDone={coach.dismiss} steps={COACH_STEPS} delay={160} showControls={false} forceLastStep />
    </>
  );
}
