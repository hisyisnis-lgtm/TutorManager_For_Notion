// 홈 허브 — 게임 로비. 아이작식 탑다운 방 안을 성조마크 캐릭터(idle/walk/talk)가 돌아다님.
// 좌상단 내 정보(등급 앰블럼+스트릭+등급 게이지) · 중앙 작은 로고 · 우상단 메뉴 · 하단 플레이 CTA + 보조(놀러가기/등급/업적).
// Figma "25. 홈 허브". 타이틀(터치) 다음 화면. 시스템 액션(소리/햅틱/도움말/로그인/나가기)은 메뉴로 모음.
import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import {
  Settings, Play, HandStars, MedalStar, Cup, Flame, Snowflake,
  QuestionCircle, Logout, AltArrowRight, AltArrowLeft, VolumeLoud, VolumeCross, SmartphoneVibration, CloseCircle,
  MusicNotes, MusicNote, Pen, InfoCircle, LinkCircle,
} from '@solar-icons/react';
import { TG, TYPE, TOUCH_OPT, haptic, isHapticMuted, setHapticMuted, RADIUS, SPACE } from '../tgTokens.js';
import { TONES } from '../../constants/toneGameWords.js';
import { ToneMark, useCountUp } from '../tgWidgets.jsx';
import { rankInfo, levelInfo } from '../gameXp.js';
import { play as playSfx, isSfxMuted, setSfxMuted } from '../tgSfx.js';
import { isBgmMuted, setBgmMuted, startBgm } from '../tgBgm.js';
import { FigmaScreen, EmberRise } from './shared.jsx';
import { markSize, Eyes } from './eyes.jsx';
import { PlayModal, DebugScoreModal } from './gameModals.jsx';
import { LinkHubScreen } from './LinkHubScreen.jsx';
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
  { selector: '[data-coach="tg-play"]', label: '준비됐으면 플레이를 눌러 시작해요!' },
];

const WALL = '#E9E3D9', FLOOR = '#FCFAF6', OUTSIDE = '#F1EDE6'; // 밝고 깔끔한 모던 — 크림/화이트

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
// ── 성조 영토(레벨별 바닥 물들임) ──────────────────────────────
// 각 성조 캐릭터가 발밑 바닥을 격자로 물들인다. 레벨↑ = 물든 반경↑ → "어떤 성조를 잘하나"가 한눈에.
// TERRA = id→{x,y,r,tone}. 매 프레임 캐릭터가 갱신, FloorTerritory 캔버스가 읽어 그림.
const TERRA = new Map();
// 영토 반경(물리평면 px) — 레벨별 격차 강화(lv1=35 … lv5=95). 비겹침 반발이 커지므로 방이 붐비면 살짝 낮출 것.
const territoryRadius = (level) => 20 + Math.min(5, Math.max(1, level || 1)) * 15;
// 메인끼리 영토가 안 겹치게 밀어냄(팔로워·몸통 충돌과 별개 패스). resolveColl과 동형.
function resolveTerritory(id, x, y, r) {
  for (const [oid, o] of TERRA) {
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

// 2.5D 원근 투영 — 물리(이동·충돌)는 평면 좌표 그대로, "그리는 위치"만 변환.
// y가 작을수록(방 뒤쪽) 가로로 중앙에 모이고·작아지고·뒤로 그려짐(앞 캐릭터가 겹쳐 가림).
const BACK_CONV = 0.86;  // 뒤쪽 가로 수렴 배율(1=수렴 없음·클수록 방 넓음) — 바닥 사다리꼴 상단 폭(=7~93%)·옆벽 얇게
const BACK_SCALE = 0.66; // 뒤쪽 크기 배율
const FLOOR_TOP = 0.17;  // 바닥 뒤 모서리 화면 위치(그 위=뒤 벽, HUD가 얹힘) — 창은 UI와 겹쳐도 OK(사용자)
const FRONT_GAP = 210;   // 바닥 앞 모서리 = 화면 하단에서 위로 N px(도크 166 + 여유 ~44) — 캐릭터가 도크에 안 붙음
function project(x, y, W, H) {
  const d = H > 0 ? Math.min(1, Math.max(0, y / H)) : 0.5; // 0=뒤 … 1=앞
  const conv = BACK_CONV + (1 - BACK_CONV) * d;
  const sx = W / 2 + (x - W / 2) * conv;
  const backY = FLOOR_TOP * H, frontY = Math.max(backY + 60, H - FRONT_GAP); // 앞 한계는 도크 위로 고정 간격(픽셀)
  const sy = backY + (frontY - backY) * d; // 걷는 영역을 HUD~도크사이 밴드로
  const dScale = BACK_SCALE + (1 - BACK_SCALE) * d;
  return [sx, sy, dScale, d];
}
// 원근 방(못 가는 경계=벽) — 못 가는 영역을 벽으로 빈틈없이 꽉 채움 + 사다리꼴 바닥. SVG.
// 뒤 벽(상단 띠) + 좌·우 벽(뒤로 수렴)이 컨테이너 위/옆을 전부 덮고, 그 안에 바닥 사다리꼴.
function Room3D() {
  const bl = 50 - BACK_CONV * 50, br = 50 + BACK_CONV * 50, tb = FLOOR_TOP * 100; // 7, 93, 17(바닥 뒤 모서리)
  const BH = 2.4;                 // 걸레받이(baseboard) 두께(viewBox y-units)
  // 걸레받이 = 벽↔바닥 이음선 바로 위(벽 쪽) 띠. 뒤·좌·우 3면(창문은 위로 올려 걸레받이와 간격 확보).
  const baseBack = `${bl},${tb - BH} ${br},${tb - BH} ${br},${tb} ${bl},${tb}`;
  const baseLeft = `0,100 ${bl},${tb} ${bl},${tb - BH} 0,${100 - BH}`;
  const baseRight = `${br},${tb} 100,100 100,${100 - BH} ${br},${tb - BH}`;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} aria-hidden="true">
      <defs>
        <linearGradient id="tgBackW" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#DFD6C6" /><stop offset="1" stopColor="#D3C8B5" /></linearGradient>
        <linearGradient id="tgSideL" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#C8BCA7" /><stop offset="1" stopColor="#DCD3C2" /></linearGradient>
        <linearGradient id="tgSideR" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#DCD3C2" /><stop offset="1" stopColor="#C8BCA7" /></linearGradient>
        <linearGradient id="tgFloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#EFE8DB" /><stop offset="0.5" stopColor="#FBF8F3" /><stop offset="1" stopColor="#FEFDFB" /></linearGradient>
        {/* 걸레받이 트림(밝은 오프화이트·상단 밝고 하단 살짝 음영) */}
        <linearGradient id="tgBase" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F2EDE3" /><stop offset="1" stopColor="#E1D8C8" /></linearGradient>
        {/* 벽지 무늬 — 은은한 세로 줄무늬(톤온톤). 벽 3면에만 오버레이. */}
        <pattern id="tgWP" patternUnits="userSpaceOnUse" width="3.2" height="4"><rect x="0" y="0" width="1.7" height="4" fill="#7A6B4E" opacity="0.06" /></pattern>
      </defs>
      {/* 뒤 벽(상단 전체 띠) */}
      <polygon points={`${bl},0 ${br},0 ${br},${tb} ${bl},${tb}`} fill="url(#tgBackW)" />
      {/* 왼 벽(위·왼쪽 전부 채움) */}
      <polygon points={`0,0 ${bl},0 ${bl},${tb} 0,100`} fill="url(#tgSideL)" />
      {/* 오른 벽 */}
      <polygon points={`${br},0 100,0 100,100 ${br},${tb}`} fill="url(#tgSideR)" />
      {/* 바닥(사다리꼴) */}
      <polygon points={`${bl},${tb} ${br},${tb} 100,100 0,100`} fill="url(#tgFloor)" />
      {/* 벽지 무늬(세로 줄무늬) — 벽 3면에만(바닥 제외) */}
      <polygon points={`${bl},0 ${br},0 ${br},${tb} ${bl},${tb}`} fill="url(#tgWP)" />
      <polygon points={`0,0 ${bl},0 ${bl},${tb} 0,100`} fill="url(#tgWP)" />
      <polygon points={`${br},0 100,0 100,100 ${br},${tb}`} fill="url(#tgWP)" />
      {/* 걸레받이(baseboard) 띠 — 뒤·좌·우 3면 */}
      <polygon points={baseBack} fill="url(#tgBase)" />
      <polygon points={baseLeft} fill="url(#tgBase)" />
      <polygon points={baseRight} fill="url(#tgBase)" />
      {/* 걸레받이 상단 몰딩 하이라이트(벽 경계선) */}
      <polyline points={`0,${100 - BH} ${bl},${tb - BH} ${br},${tb - BH} 100,${100 - BH}`} fill="none" stroke="#F7F2E9" strokeWidth="0.5" strokeLinejoin="round" />
      {/* 벽↔바닥 접합 그림자(그라운딩) */}
      <polyline points={`0,100 ${bl},${tb} ${br},${tb} 100,100`} fill="none" stroke="rgba(120,105,80,0.13)" strokeWidth="0.9" strokeLinejoin="round" />
    </svg>
  );
}
// 바닥 영토 물들임 — 각 성조 캐릭터 영토(TERRA)를 하프톤 도트로 표현(중심=큰 도트 → 가장자리로 작아지며 사라짐).
// project()로 원근 투영(뒤로 갈수록 도트·간격 작아짐). 캔버스라 매 프레임 수백 도트도 가벼움. 바닥 SVG 위·캐릭터(z300+) 뒤.
function FloorTerritory() {
  const cvRef = useRef(null);
  useLayoutEffect(() => {
    const cv = cvRef.current; const par = cv && cv.parentElement; if (!par) return undefined;
    const ctx = cv.getContext('2d');
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const NX = 46; // 가로 칸 수 — 세로는 정사각형 셀이 되도록 파생(NYc)
    let W = 0, H = 0;
    const resize = () => {
      W = par.clientWidth; H = par.clientHeight;
      cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
    };
    resize();
    const TILE = '#e2d8c6'; // 물들임 색 = 바닥색에서 살짝 어두운 톤. 성조별로 안 나누고 통일(크기만 비교되면 됨).
    const draw = () => {
      if (!W || !H) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!TERRA.size) return;
      // 각 캐릭터의 '그림자(발)' 스크린 위치 + 스크린 반경(깊이 스케일 반영). 그림자 = elRef의 (중심x, top+44)=스케일 원점.
      const chars = [];
      for (const o of TERRA.values()) {
        const p = project(o.x, o.y, W, H); // [sx, sy, ds]
        const cxo = markSize(o.tone) * (o.tone === 0 ? 0.42 : 1) / 2;
        chars.push({ sx: p[0] + cxo, sy: p[1] + 44, r: o.r * p[2] }); // 그림자 스크린 중심 + 스크린 반경
      }
      // 걸레받이(뒤·좌·우 벽 트림) 위로 안 넘치게 — 바닥 사다리꼴을 안쪽으로 살짝 좁혀 클립
      ctx.save();
      { const byT = FLOOR_TOP * H, bx0 = (0.5 - BACK_CONV * 0.5) * W, bx1 = (0.5 + BACK_CONV * 0.5) * W, mx = 5, my = 5; // 걸레받이 두께만큼(px)만 안쪽 — 딱 맞게
        ctx.beginPath(); ctx.moveTo(bx0 + mx, byT + my); ctx.lineTo(bx1 - mx, byT + my); ctx.lineTo(W - mx, H); ctx.lineTo(mx, H); ctx.closePath(); ctx.clip(); }
      const cell = W / NX; // 격자 간격(cell) — 각 셀 중심에 하프톤 도트
      // 확장 투영 — 그리드를 앞쪽 바닥끝(화면 하단)까지 내림. project는 frontY에서 sy가 멈춰 원 아랫부분이 평평하게 잘리므로,
      //   여기선 d(깊이)를 1로 클램프하지 않아(sx 수렴만 클램프) 앞쪽 캐릭터의 원이 자연스럽게 이어져 도크 뒤로 사라진다.
      const by = FLOOR_TOP * H, fy = Math.max(by + 60, H - FRONT_GAP);
      const projT = (x, y) => { const d = y / H, cd = Math.min(1, Math.max(0, d)); return [W / 2 + (x - W / 2) * (BACK_CONV + (1 - BACK_CONV) * cd), by + (fy - by) * d]; };
      const NYc = Math.ceil((fy > by ? (H * (H - by)) / (fy - by) : H) / cell); // sy=H(화면 하단) 되는 물리 y까지
      ctx.fillStyle = TILE; // 통일색(솔리드) — 루프 밖 1회 설정
      // 45° 회전 격자(다이아몬드 하프톤) — 물리 격자점 P(i,j)=((i-j)k, (i+j)k), k=cos45·cell. 이웃 간격=cell 유지.
      const k = 0.70710678 * cell, PW = W, PH = NYc * cell;
      // 물리 사각영역 [0,PW]×[0,PH]를 덮는 (i,j) 범위 산출(4코너). i=(px+py)/2k, j=(py−px)/2k.
      let iMin = Infinity, iMax = -Infinity, jMin = Infinity, jMax = -Infinity;
      for (const [px, py] of [[0, 0], [PW, 0], [0, PH], [PW, PH]]) {
        const i = (px + py) / (2 * k), j = (py - px) / (2 * k);
        if (i < iMin) iMin = i; if (i > iMax) iMax = i; if (j < jMin) jMin = j; if (j > jMax) jMax = j;
      }
      iMin = Math.floor(iMin) - 1; iMax = Math.ceil(iMax) + 1; jMin = Math.floor(jMin) - 1; jMax = Math.ceil(jMax) + 1;
      for (let i = iMin; i <= iMax; i += 1) {
        for (let j = jMin; j <= jMax; j += 1) {
          const px = (i - j) * k, py = (i + j) * k; // 45° 회전 격자 물리좌표
          if (px < -cell || px > PW + cell || py < -cell || py > PH + cell) continue;
          const cp = projT(px, py);
          // 하프톤 gv — 속한 캐릭터 중 중심에 가장 가까운 값(중심=1 → 가장자리=0). 안 속하면 스킵.
          let gv = 0;
          for (const ch of chars) { const dd = Math.hypot(cp[0] - ch.sx, cp[1] - ch.sy); if (dd < ch.r) { const g = 1 - dd / ch.r; if (g > gv) gv = g; } }
          if (gv <= 0.02) continue;
          // 이웃 격자점(u·v 방향)까지 스크린 거리의 절반을 도트 상한으로(원근 반영·안 겹치게)
          const pr = projT(px + k, py + k), pd = projT(px - k, py + k);
          const cellR = Math.min(Math.hypot(pr[0] - cp[0], pr[1] - cp[1]), Math.hypot(pd[0] - cp[0], pd[1] - cp[1])) / 2;
          const r = cellR * 0.9 * Math.min(1, gv * 1.12); // 중심 큰 도트 → 가장자리로 작아짐(하프톤 그라데이션)
          if (r < 0.35) continue;
          ctx.beginPath(); ctx.arc(cp[0], cp[1], r, 0, 6.2832); ctx.fill();
        }
      }
    };
    addTick(draw);
    window.addEventListener('resize', resize);
    return () => { removeTick(draw); window.removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={cvRef} aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />;
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
      const spd0 = Math.hypot(BALL.vx, BALL.vy); let bumped = false; // 타격 감지용(충돌 전 속도)
      for (const o of COLL.values()) {
        const dx = BALL.x - o.x, dy = BALL.y - o.y, d = Math.hypot(dx, dy), minD = o.r + RB;
        if (d > 0.01 && d < minD) {
          bumped = true;
          const ux = dx / d, uy = dy / d;
          BALL.x = o.x + ux * minD; BALL.y = o.y + uy * minD;
          const along = BALL.vx * ux + BALL.vy * uy; // 파고드는 성분 반사
          if (along < 0) { BALL.vx -= along * ux * 1.3; BALL.vy -= along * uy * 1.3; }
          BALL.vx += ux * 46; BALL.vy += uy * 46;
        }
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
      const nowSpd = Math.hypot(BALL.vx, BALL.vy);
      if (BALL.fx) { spawnImpact(icx, icy, BALL.fx, 'kick'); BALL.fx = 0; }
      else if (((bumped && (spd0 > 70 || nowSpd - spd0 > 45)) || (wallHit && wallSpd > 80)) && now - lastBumpAt > 90) {
        lastBumpAt = now; spawnImpact(icx, icy, Math.max(spd0, nowSpd, wallSpd), 'bump'); // 캐릭터 부딪힘·벽 튕김 공용
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
    <div ref={elRef} aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', willChange: 'transform' }}>
      {/* 접지 그림자 — 중심을 투영점(=공 바닥 접점)에 맞춤 */}
      <div style={{ position: 'absolute', left: '50%', top: 0, transform: 'translate(-50%,-50%)', width: S * 0.94, height: S * 0.3, borderRadius: '50%', background: 'rgba(70,62,52,0.17)', filter: 'blur(1.5px)' }} />
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
    const speed = 34 + Math.random() * 38; // 캐릭터별 고유 속도(34~72 px/s)
    const crBase = tone.num === 0 ? markSize(0) * 0.42 * 0.55 : markSize(tone.num) * 0.44; // 충돌 반경 기본(캐릭터 크기 기반) — 레벨 배율은 매 프레임 levelRef로 곱함
    const mId = 'm' + i;
    let W = par.clientWidth, H = par.clientHeight;
    const rnd = () => ({ x: WALL_M + Math.random() * Math.max(1, W - WALL_M - MARK_W), y: WALL_M + Math.random() * Math.max(1, H - WALL_M - MARK_H) });
    // 뭉침 방지 — 후보 여러 개 중 다른 메인에서 가장 멀리(한적한) 곳을 목표로 선택
    const pickTarget = () => {
      let best = rnd(), bestScore = -1;
      for (let n = 0; n < 5; n++) {
        const c = rnd(); let minD = Infinity;
        for (let j = 0; j < 5; j++) { if (j === i) continue; const o = COLL.get('m' + j); if (!o) continue; const d = Math.hypot(c.x - o.x, c.y - o.y); if (d < minD) minD = d; }
        if (minD > bestScore) { bestScore = minD; best = c; }
      }
      return best;
    };
    let pos = rnd(), target = pos, mode = 'idle', v = { x: 0, y: 0 }, stuck = 0, ballChase = false;
    let until = performance.now() + 300 + i * 480; // 캐릭터별 시차 시작(첫 쉼)
    // 위치 반영 — left/top(매 프레임 레이아웃 무효화) 대신 translate3d(합성 전용). left/top은 0 고정.
    // ⚠️ 초기 배치도 rAF tick과 반드시 같은 함수(apply)로 — 과거 초기배치와 rAF 코드가 달라 머리 UI 스케일 버그났던 전례.
    const apply = (sx, sy, ds, z) => {
      el.style.transform = `translate3d(${sx}px, ${sy}px, 0)`; el.style.zIndex = z;
      const bd = bodyRef.current; if (bd) bd.style.transform = `scale(${ds})`;                  // 몸통만 원근 스케일
      const hd = headRef.current; if (hd) hd.style.transform = `translate(-50%, -100%) translateY(${44 * (1 - ds) - 8}px)`; // 머리 UI는 스케일 없이 위치만(축소된 머리 위)
    };
    { const [sx, sy, ds, d] = project(pos.x, pos.y, W, H); apply(sx, sy, ds, String(depthZ(d))); }
    COLL.set(mId, { x: pos.x, y: pos.y, r: crBase * levelScale(levelRef.current) });
    TERRA.set(mId, { x: pos.x, y: pos.y, r: territoryRadius(levelRef.current), tone: tone.num });
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
      if (r < 0.4) { target = pickTarget(); setTilt(target.x > pos.x ? 1 : -1); mode = 'move'; setSt('walk'); }
      // 공이 멈춰 있으면(누가 막 찬 게 아니면) 가끔 다가가 뻥 — 공을 향해 이동
      else if (r < 0.5 && BALL.live && Math.hypot(BALL.vx, BALL.vy) < 40) { ballChase = true; target = { x: BALL.x, y: BALL.y }; setTilt(BALL.x > pos.x ? 1 : -1); mode = 'move'; setSt('walk'); }
      else if (r < 0.85) { mode = 'idle'; setSt('idle'); setTilt(0); until = now + 1800 + Math.random() * 3000; }
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
      const tr = territoryRadius(levelRef.current); // 영토 반경(물들임·비겹침)
      // 스포트라이트 중 — 제자리 정지 + 딤(z610) 위로(z640)
      if (revealRef.current) {
        v.x = 0; v.y = 0;
        COLL.set(mId, { x: pos.x, y: pos.y, r: cr });
        TERRA.set(mId, { x: pos.x, y: pos.y, r: tr, tone: tone.num });
        const [sx, sy, ds] = project(pos.x, pos.y, W, H);
        apply(sx, sy, ds, '640');
        return;
      }
      // 대화(듀엣) 중 — 제자리 정지·마주본 채. 밀림/영토 반발도 스킵(서로 떨어지지 않게).
      if (mode === 'chat') {
        v.x = 0; v.y = 0;
        COLL.set(mId, { x: pos.x, y: pos.y, r: cr });
        TERRA.set(mId, { x: pos.x, y: pos.y, r: tr, tone: tone.num });
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
        else if (dist < 3 && Math.hypot(v.x, v.y) < 8) { mode = 'idle'; setSt('idle'); setTilt(0); until = now + 1200 + Math.random() * 2400; }
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
      { const [rx, ry] = resolveTerritory(mId, pos.x, pos.y, tr); pos = { x: rx, y: ry }; }
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
      TERRA.set(mId, { x: pos.x, y: pos.y, r: tr, tone: tone.num });
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
    return () => { alive = false; removeTick(tick); clearTimeout(hopT.current); window.removeEventListener('resize', onResize); COLL.delete(mId); TERRA.delete(mId); MARKS.delete(mId); for (let k = 0; k < slots.length; k++) COLL.delete('f' + i + '_' + k); };
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
            <div style={{ position: 'absolute', left: '50%', top: fs * 0.55, transform: 'translateX(-50%)', width: fs * 0.5, height: fs * 0.14, borderRadius: '50%', background: 'rgba(70,62,52,0.09)', filter: 'blur(1px)' }} />
            <div ref={(node) => { followerTiltRefs.current[k] = node; }} style={{ display: 'inline-block', transition: 'transform .25s ease' }}>
              <div style={{ position: 'relative', display: 'inline-block', color: tone.color }}>
                <ToneMark tone={tone.num} size={fs} />
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
        <div style={{ position: 'absolute', left: '50%', top: 44, transform: `translateX(-50%) scale(${jump ? 0.66 : 1})`, width: 46, height: 11, borderRadius: '50%', background: 'rgba(70,62,52,0.13)', filter: 'blur(1.5px)', transition: 'transform .22s ease', pointerEvents: 'none' }} />
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
              <ToneMark tone={tone.num} size={markSize(tone.num)} />
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

// 메뉴 토글 행 (소리/햅틱)
function MenuToggle({ Icon, label, on, onToggle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.xl }}>
        <Icon size={27} weight="Bold" color={on ? TG.CORAL_DK : TG.MUTED} />
        <span style={{ ...TYPE.btnSm, color: TG.INK }}>{label}</span>
      </div>
      <button onClick={onToggle} role="switch" aria-checked={on} aria-label={label} className="tg-press"
        style={{ width: 46, height: 27, borderRadius: RADIUS.lg, border: 'none', cursor: 'pointer', padding: 0, background: on ? TG.CORAL_DK : TG.MUTED, position: 'relative', transition: 'background .2s ease', ...TOUCH_OPT }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 22 : 3, width: 21, height: 21, borderRadius: RADIUS.md, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left .18s ease' }} />
      </button>
    </div>
  );
}

// 메뉴 액션 행 (도움말/로그인/나가기 등)
function MenuAction({ Icon, label, sub, color = TG.INK, onClick }) {
  return (
    <button onClick={onClick} className="tg-press" style={{ display: 'flex', alignItems: 'center', gap: SPACE.xl, width: '100%', padding: '10px 4px', background: 'none', border: 'none', cursor: 'pointer', ...TOUCH_OPT }}>
      <Icon size={25} weight="Bold" color={color} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, textAlign: 'left', ...TYPE.btnSm, color }}>{label}</span>
      {sub && <span style={{ ...TYPE.meta, color: TG.SUB }}>{sub}</span>}
      <AltArrowRight size={18} weight="Bold" color="#c9c2bb" />
    </button>
  );
}

function HomeMenu({ onClose, onHelp, onCredits, onLogin, isMemberUser, memberName, onEditNickname, onLogout, onExit, onDebugIntro, onDebugScore }) {
  const [sfxOn, setSfxOn] = useState(() => !isSfxMuted());
  const [bgmOn, setBgmOn] = useState(() => !isBgmMuted());
  const [hapticOn, setHapticOn] = useState(() => !isHapticMuted());
  const toggleSfx = () => { const n = !sfxOn; setSfxOn(n); setSfxMuted(!n); if (n) playSfx('button'); };
  const toggleBgm = () => { const n = !bgmOn; setBgmOn(n); setBgmMuted(!n); if (n) startBgm(); }; // 켜면 홈=메뉴화면이라 즉시 재생
  const toggleHaptic = () => { const n = !hapticOn; setHapticOn(n); setHapticMuted(!n); if (n) haptic(20); };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(26,16,20,0.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: SPACE.x4, ...TOUCH_OPT }}>
      <div className="tg-enter" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 320, background: TG.CARD, borderRadius: RADIUS.xxl, padding: '20px 22px 18px', boxShadow: '0 20px 50px rgba(26,16,20,0.3)', display: 'flex', flexDirection: 'column', gap: SPACE.x2 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ ...TYPE.head, fontSize: 18, color: TG.INK }}>메뉴</span>
          {/* 히트영역 44×44(음수 마진으로 레이아웃 자리는 30 유지), 시각 크기는 안쪽 30×30 원 그대로 */}
          <button onClick={onClose} aria-label="닫기" className="tg-press" style={{ width: 44, height: 44, margin: -7, padding: 0, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', ...TOUCH_OPT }}>
            <CloseCircle weight="Bold" size={28} color={TG.SUB} />
          </button>
        </div>
        <MenuToggle Icon={sfxOn ? VolumeLoud : VolumeCross} label="소리" on={sfxOn} onToggle={toggleSfx} />
        <MenuToggle Icon={bgmOn ? MusicNotes : MusicNote} label="음악" on={bgmOn} onToggle={toggleBgm} />
        <MenuToggle Icon={SmartphoneVibration} label="햅틱" on={hapticOn} onToggle={toggleHaptic} />
        <div style={{ height: 1, background: TG.BORDER }} />
        {onHelp && <MenuAction Icon={QuestionCircle} label="게임 방법" onClick={() => { onClose(); onHelp(); }} />}
        {onLogin && <MenuAction Icon={Logout} label="로그인" sub="기록 저장" color={TG.CORAL_DK} onClick={() => { onClose(); onLogin(); }} />}
        {isMemberUser && onEditNickname && <MenuAction Icon={Pen} label="닉네임 변경" sub={memberName || ''} onClick={() => { onClose(); onEditNickname(); }} />}
        {isMemberUser && <MenuAction Icon={Logout} label="로그아웃" onClick={() => { onClose(); onLogout && onLogout(); }} />}
        <MenuAction Icon={Logout} label="게임 나가기" onClick={() => { onClose(); onExit && onExit(); }} />
        <div style={{ height: 1, background: TG.BORDER }} />
        <MenuAction Icon={InfoCircle} label="자료출처" onClick={() => { onClose(); onCredits && onCredits(); }} />
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
        <div style={{ textAlign: 'center', ...TYPE.micro, color: '#c2bbb2', marginTop: SPACE.xxs, letterSpacing: 0.2 }}>버전 {__APP_VERSION__}</div>
      </div>
    </div>
  );
}

// 자료출처(아이콘 저작권 표기) — Solar 아이콘이 CC BY 4.0이라 크레딧 명시 의무. (폰트=OFL·음성=서비스는 인앱 표기 불필요)
// 실제 쓰는 아이콘 세트만 정직하게. name=에셋, by=저작자, license=라이선스, url=출처.
const CREDITS = [
  { name: 'Solar Icons', by: '480 Design', license: 'CC BY 4.0', url: 'https://www.figma.com/community/file/1166831539721848736' },
  { name: 'Phosphor Icons', by: 'Phosphor', license: 'MIT', url: 'https://phosphoricons.com' },
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

// 내 정보 카드 — 등급 앰블럼 + 닉네임(상단) + 진행 게이지(하단).
// 탭 → 게스트·회원 공통으로 프로필 모달(로그인 상태·닉네임·수정·등급·SNS로그인)을 먼저 띄운다.
function MyInfo({ tier, nickname, onClick }) {
  const displayName = nickname || '게스트'; // 게스트(로그인 안 함) 폴백
  const lv = levelInfo(tier.xp || 0);       // 게이지 = 레벨(Lv.N) 진행. 엠블럼 = 등급(보스 클리어).
  const pct = Math.round(lv.progress * 100);
  return (
    <button onClick={onClick} className="tg-press" data-coach="tg-myinfo"
      aria-label="내 프로필 열기" style={{
      position: 'absolute', left: 24, top: 20, width: 172, height: 60, display: 'flex', alignItems: 'center', gap: SPACE.xl,
      padding: '0 14px 0 9px', borderRadius: RADIUS.btn, background: '#fff', border: 'none', cursor: 'pointer',
      boxShadow: '0 5px 14px rgba(43,39,48,0.07)', zIndex: 5, ...TOUCH_OPT,
    }}>
      {/* 앰블럼 — 자체 완결 배지라 소켓(색 사각) 제거로 정리. 등급명은 앰블럼이 대표(카드엔 텍스트 생략). 승급은 사다리 보스로 이관 → 여기 시험 배지 없음. */}
      <img src={tier.emblem} alt="" width={48} height={48} style={{ display: 'block', flexShrink: 0 }} />
      {/* 닉네임(전체 폭 한 줄, 길면 말줄임) + 등급 게이지. */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: SPACE.md }}>
        <span style={{ ...TYPE.label, fontWeight: 800, color: TG.INK, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</span>
        <div style={{ width: '100%', height: 6, borderRadius: RADIUS.xs, background: TG.BORDER, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', borderRadius: RADIUS.xs, background: TG.CORAL_GRAD, transition: 'width .5s ease' }} />
        </div>
      </div>
    </button>
  );
}

// 스트릭 불꽃 티어 — 연속일수가 스테이크(끊기면 회색 0으로 리셋, 눈에 보이는 스팅). 색/글로우/이름 상승.
const STREAK_TIERS = [
  { min: 30, label: '불기둥', color: '#8B5CF6', glow: '#B79CF2' },
  { min: 14, label: '이글이글', color: '#4D8DFF', glow: '#8FBEFF' },
  { min: 7, label: '활활', color: TG.CORAL_DK, glow: '#FF9A6B' },
  { min: 3, label: '불꽃', color: '#F0A91E', glow: '#FFC94D' },
  { min: 1, label: '불씨', color: '#F5B942', glow: '#FFD98A' },
  { min: 0, label: '꺼진 재', color: '#b9a89f', glow: 'transparent' },
];
const streakTier = (days) => STREAK_TIERS.find((t) => (days || 0) >= t.min) || STREAK_TIERS[STREAK_TIERS.length - 1];
const STREAK_MILESTONES = [3, 7, 14, 30];

// 스트릭 칩 — 우상단(메뉴 왼쪽). 불꽃(티어색+글로우) + 연속일 + ❄️보유. 탭→상세 시트. 우측 앵커.
function StreakPill({ streak, freezes = 0, onClick }) {
  const animStreak = useCountUp(streak, 800);
  const tier = streakTier(streak);
  return (
    <button onClick={onClick} className="tg-press" data-coach="tg-streak" style={{ position: 'absolute', right: 72, top: 20, height: 40, display: 'flex', alignItems: 'center', gap: SPACE.sm, padding: '0 12px', borderRadius: RADIUS.xl, background: '#fff', boxShadow: '0 5px 14px rgba(43,39,48,0.07)', border: 'none', cursor: 'pointer', zIndex: 5, ...TOUCH_OPT }}>
      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        {streak > 0 && <EmberRise colors={[tier.color, tier.glow]} count={6} spread={12} rise={22} size={2.4} zIndex={0} style={{ bottom: '38%' }} />}
        <Flame size={16} weight="Bold" color={tier.color} style={{ position: 'relative', filter: streak > 0 ? `drop-shadow(0 0 5px ${tier.glow})` : 'none' }} />
      </span>
      <span style={{ ...TYPE.numMd, fontSize: 15, color: TG.INK, lineHeight: 1 }}>{animStreak}</span>
      <span style={{ ...TYPE.labelSm, color: TG.SUB }}>일</span>
      {freezes > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 1, marginLeft: SPACE.xs }} aria-label={`보호권 ${freezes}개`}><Snowflake size={13} weight="Bold" color="#4D8DFF" /><span style={{ ...TYPE.numMd, fontSize: 12, color: '#4D8DFF' }}>{freezes}</span></span>}
    </button>
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
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', width: '100%', maxWidth: 440, background: TG.CARD, borderRadius: '26px 26px 0 0', padding: '24px 22px calc(24px + env(safe-area-inset-bottom))', boxShadow: '0 -10px 40px rgba(26,16,20,0.25)', animation: closing ? 'tg-sheet-down .26s ease forwards' : 'tg-sheet-up .32s cubic-bezier(.2,.85,.25,1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.x2, marginBottom: SPACE.x3 }}>
          <div style={{ position: 'relative', width: 56, height: 56, borderRadius: RADIUS.btn, background: `${tier.color}1c`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {streak > 0 && <EmberRise colors={[tier.color, tier.glow]} count={12} spread={26} rise={48} size={3.6} zIndex={0} style={{ bottom: '22%' }} />}
            <Flame size={32} weight="Bold" color={tier.color} style={{ position: 'relative', filter: streak > 0 ? `drop-shadow(0 0 6px ${tier.glow})` : 'none' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE.md }}>
              <span style={{ ...TYPE.titleLg, color: TG.INK }}>{streak}일</span>
              <span style={{ ...TYPE.labelSm, color: tier.color }}>{tier.label}</span>
            </div>
            <span style={{ ...TYPE.meta, color: TG.SUB }}>{sub}</span>
          </div>
          {/* 히트영역 44×44(음수 마진으로 레이아웃 자리는 30 유지), 시각 크기는 안쪽 30×30 원 그대로 */}
          <button onClick={close} aria-label="닫기" className="tg-press" style={{ width: 44, height: 44, margin: -7, padding: 0, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT }}>
            <CloseCircle weight="Bold" size={28} color={TG.SUB} />
          </button>
        </div>
        {next ? (
          <div style={{ marginBottom: SPACE.x2 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: SPACE.sm }}>
              <span style={{ ...TYPE.meta, color: TG.SUB }}>다음 목표 {next}일</span>
              <span style={{ ...TYPE.labelSm, color: TG.INK }}>{Math.max(0, next - streak)}일 남음</span>
            </div>
            <div style={{ height: 8, borderRadius: RADIUS.xs, background: '#ece6dd', overflow: 'hidden' }}>
              <div style={{ width: `${Math.round(prog * 100)}%`, height: '100%', borderRadius: RADIUS.xs, background: tier.color, transition: 'width .5s ease' }} />
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: SPACE.x2, ...TYPE.labelSm, color: TG.SUCCESS_GLOW }}>모든 마일스톤 달성! 🎉</div>
        )}
        <div style={{ display: 'flex', gap: SPACE.lg, marginBottom: SPACE.x2 }}>
          <CardStat label="최장 기록" value={`${longest}일`} />
          <div style={{ flex: 1, background: TG.SURFACE, borderRadius: RADIUS.lg, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
              <Snowflake size={22} weight="Bold" color="#4D8DFF" />
              <span style={{ ...TYPE.numMd, fontSize: 22, color: TG.INK, lineHeight: 1.1 }}>{freezes}/2</span>
            </div>
            <div style={{ ...TYPE.meta, color: TG.SUB, marginTop: SPACE.xxs }}>보호권</div>
          </div>
        </div>
        <p style={{ margin: 0, ...TYPE.meta, lineHeight: 1.5, color: TG.SUB }}>보호권은 하루 빠져도 연속학습을 지켜줘요. 7일마다 하나씩 모여요.</p>
      </div>
    </div>
  );
}

// 성조 미니 카드 — 캐릭터 탭 시. 순수 진단(정확도·시도·상태). 하단 시트(슬라이드 업/다운).
// 연습/복습 CTA는 뺌(사용자 지적): 성조 하나만 나오는 문제는 만들 수 없고, 안다고 풀면 성조 학습 의미가 없음.
const STATE_LABEL = { unknown: '아직 데이터가 적어요', weak: '아직 헷갈려요', mid: '꽤 익숙해요', strong: '탄탄해요' };
const STATE_COLOR = { unknown: TG.SUB, weak: TG.CORAL_DK, mid: '#F0A91E', strong: TG.SUCCESS_GLOW };
const STATE_NOTE = { unknown: '게임을 더 하면 이 성조 실력이 보여요.', weak: '게임에서 이 성조가 나올 때 귀 기울여보세요.', mid: '조금만 더 하면 탄탄해져요.', strong: '이 성조는 거의 마스터했어요! 👍' };
function CardStat({ label, value }) {
  return (
    <div style={{ flex: 1, background: TG.SURFACE, borderRadius: RADIUS.lg, padding: '12px 14px' }}>
      <div style={{ ...TYPE.numMd, fontSize: 22, color: TG.INK, lineHeight: 1.1 }}>{value}</div>
      <div style={{ ...TYPE.meta, color: TG.SUB, marginTop: SPACE.xxs }}>{label}</div>
    </div>
  );
}
function ToneCard({ tone, status, level, onClose }) {
  const [closing, setClosing] = useState(false);
  const close = () => { if (closing) return; setClosing(true); setTimeout(onClose, 270); }; // 슬라이드 다운 후 언마운트
  const s = status || { acc: 0, attempts: 0, state: 'unknown' };
  const accTxt = s.attempts > 0 ? `${Math.round(s.acc * 100)}%` : '—';
  return (
    <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', ...TOUCH_OPT }}>
      {/* Dim — 별도 레이어로 분리(카드와 형제). opacity 페이드가 카드에 안 번지게 */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,16,20,0.5)', backdropFilter: 'blur(2px)', animation: closing ? 'tg-fade-out .28s ease forwards' : 'tg-dim-in .28s ease' }} />
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', width: '100%', maxWidth: 440, background: TG.CARD, borderRadius: '26px 26px 0 0', padding: '22px 22px calc(24px + env(safe-area-inset-bottom))', boxShadow: '0 -10px 40px rgba(26,16,20,0.25)', animation: closing ? 'tg-sheet-down .26s ease forwards' : 'tg-sheet-up .32s cubic-bezier(.2,.85,.25,1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.x2, marginBottom: SPACE.x2 }}>
          <div style={{ width: 54, height: 54, borderRadius: RADIUS.lg, background: `${tone.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tone.color, flexShrink: 0 }}>
            <ToneMark tone={tone.num} size={tone.num === 0 ? 30 : 46} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md }}>
              <span style={{ ...TYPE.head, color: TG.INK }}>{tone.name}</span>
              <span style={{ ...TYPE.micro, fontWeight: 800, color: '#fff', background: TG.INK, padding: '2px 7px', borderRadius: RADIUS.sm }}>Lv.{level}</span>
            </div>
            <span style={{ ...TYPE.labelSm, color: STATE_COLOR[s.state] }}>{STATE_LABEL[s.state]}</span>
          </div>
          {/* 히트영역 44×44(음수 마진으로 레이아웃 자리는 30 유지), 시각 크기는 안쪽 30×30 원 그대로 */}
          <button onClick={close} aria-label="닫기" className="tg-press" style={{ width: 44, height: 44, margin: -7, padding: 0, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...TOUCH_OPT }}>
            <CloseCircle weight="Bold" size={28} color={TG.SUB} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: SPACE.lg, marginBottom: SPACE.x2 }}>
          <CardStat label="정확도" value={accTxt} />
          <CardStat label="시도" value={`${s.attempts}`} />
        </div>
        <p style={{ margin: 0, ...TYPE.meta, lineHeight: 1.5, color: TG.SUB }}>{STATE_NOTE[s.state]}</p>
      </div>
    </div>
  );
}


export function HomeScreen({
  streak = 0, streakLongest = 0, freezes = 0, xp = 0, rank = 0, onExam, examPrompt = false, onExamPromptClose, toneLevels = {}, toneStatus = {}, coachTone = null, celebrateTone = null,
  levelReveals = [], onRevealsDone, revealHold = false,
  homeReady = true,
  onPlay, onMastery, onAchievements, achDot = false, onHelp,
  onLogin, isMemberUser, memberName, nickname = null, onEditNickname, onLogout, onExit, studentToken, onRefreshBest, onDebugIntro,
}) {
  const tier = { ...rankInfo(rank), xp }; // 엠블럼·이름 = 등급(rank=급). xp는 MyInfo·ProfileModal의 레벨 게이지(levelInfo)용
  const isGuest = !!onLogin; // onLogin은 게스트일 때만 내려온다(회원/학생은 null)
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [nickEditOpen, setNickEditOpen] = useState(false);
  // 놀러가기 첫 방문 유도 레드닷 — 한 번 열면 사라짐(로컬 플래그). 채널 유입 넛지.
  const [playDot, setPlayDot] = useState(() => { try { return !localStorage.getItem('tg_play_visited'); } catch { return false; } });
  const openPlay = () => { setPlayOpen(true); setPlayDot(false); try { localStorage.setItem('tg_play_visited', '1'); } catch { /* noop */ } };
  const [playOpen, setPlayOpen] = useState(false);
  // 하늘하늘중국어 링크 허브(우측 플로팅 天 버튼) — 놀러가기와 동일한 첫 방문 레드닷 패턴
  const [hubOpen, setHubOpen] = useState(false);
  const [hubDot, setHubDot] = useState(() => { try { return !localStorage.getItem('tg_hub_visited'); } catch { return false; } });
  const openHub = () => { setHubOpen(true); setHubDot(false); try { localStorage.setItem('tg_hub_visited', '1'); } catch { /* noop */ } };
  const [debugScoreOpen, setDebugScoreOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false); // 자료출처 화면(오픈소스 저작권 표기)
  const [cardTone, setCardTone] = useState(null); // 탭한 성조 미니 카드
  const [streakOpen, setStreakOpen] = useState(false); // 스트릭 상세 시트
  const [showIntro, setShowIntro] = useState(() => { try { return !localStorage.getItem('tg_home_intro'); } catch { return false; } });
  const coach = useTabTip('game-home', true); // 첫 방문 코치마크 가이드(1회)
  // (홈 방 목소리 게이트 effect는 introActive 선언 뒤로 이동 — 아래 참조)
  // 성조 레벨 변화 스포트라이트 — 홈 도착 후 바뀐 성조를 하나씩(방 딤 + 캐릭터 강조·콜아웃)
  const [revealIdx, setRevealIdx] = useState(-1);
  const [revealPos, setRevealPos] = useState(null);  // 스포트라이트 구멍 중심(컨테이너 좌표, 캐릭터가 보고)
  const [holeSize, setHoleSize] = useState(2600);     // 구멍 지름 — 화면보다 크게 시작해 좁힘
  const firstRevealRef = useRef(true);
  const HOLE = 180;
  const onRevealPos = (p) => {
    setRevealPos(p);
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
    homeRoomActive = !(menuOpen || profileOpen || nickEditOpen || playOpen || hubOpen || streakOpen || debugScoreOpen || !!cardTone || introActive);
    return () => { homeRoomActive = false; };
  }, [menuOpen, profileOpen, nickEditOpen, playOpen, hubOpen, streakOpen, debugScoreOpen, cardTone, introActive]);
  // 첫 방문 코치 1회 — 약점 성조가 정해지면 표시·플래그 저장, 잠시 후 종료. 플래그 저장은 말풍선이 실제로 뜨는 경로에서만.
  useEffect(() => {
    if (!(introActive && coachTone != null)) return undefined;
    try { localStorage.setItem('tg_home_intro', '1'); } catch { /* noop */ }
    const id = setTimeout(() => setShowIntro(false), 6500);
    return () => clearTimeout(id);
  }, [introActive, coachTone]);
  const aux = [
    { key: 'play', Icon: HandStars, label: '놀러가기', color: TG.CORAL_DK, tint: 'rgba(242,72,76,0.12)', onClick: openPlay, dot: playDot },
    { key: 'rank', Icon: MedalStar, label: '등급', color: '#F0A91E', tint: 'rgba(240,169,30,0.14)', onClick: onMastery, dot: false }, // 승급은 사다리 보스에서(등급 화면은 정보 표시)
    { key: 'ach', Icon: Cup, label: '업적', color: '#8B5CF6', tint: 'rgba(139,92,246,0.13)', onClick: () => onAchievements && onAchievements(), dot: achDot }, // 미확인 획득
  ];
  return (
    <FigmaScreen bg={OUTSIDE}>
      {/* 방 (아이작식 탑다운 챔버) — 반응형으로 상단 HUD와 하단 CTA 사이를 채움 */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
        {/* 풀블리드 + 독립 stacking context(zIndex:0) — 캐릭터(내부 z300~600)가 UI(HUD/도크/버튼) 위로 안 뜨고 방 안에만. */}
        <Room3D />
        {/* 바닥 격자 물들임 — 성조 캐릭터 영토(레벨↑=넓게). 바닥 위·빛/캐릭터 아래 */}
        <FloorTerritory />
        {/* 앞쪽 바닥 빛 웅덩이 */}
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(90% 60% at 50% 88%, rgba(255,255,255,0.4), rgba(255,255,255,0) 62%)', pointerEvents: 'none' }} />
        {/* 상단 벽 세로 십자창 2개(대칭) — 바닥빛(창문빛)은 제거(2026-07-23 사용자 요청, 타일 영토와 겹쳐서) */}
        {(() => {
          const fX = (fx, d) => 50 + (fx - 0.5) * (BACK_CONV + (1 - BACK_CONV) * d) * 100; // floor fraction → 화면 x
          const WINS = [0.30, 0.70]; // 좌우 대칭 창 중심
          return (
            <>
              {WINS.map((fc, i) => (
                <div key={i} style={{ position: 'absolute', left: `${fX(fc, 0)}%`, top: '1.5%', width: '16%', height: '10.5%', transform: 'translateX(-50%)', borderRadius: RADIUS.sm, boxSizing: 'border-box', background: '#BCA986', padding: 'clamp(2px, 2%, 4px)', boxShadow: '0 0 22px rgba(255,240,205,0.55), 0 2px 6px rgba(120,105,80,0.18)', display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 'clamp(2px, 2%, 4px)', pointerEvents: 'none' }}>
                  {[0, 1, 2, 3].map((k) => <div key={k} style={{ borderRadius: RADIUS.xs, background: 'linear-gradient(135deg, #FEFAF0, #F3E7CC)' }} />)}
                </div>
              ))}
            </>
          );
        })()}
        {/* 캐릭터 컨테이너 — 좌표계(투영은 각 마크 내부에서). overflow visible(말풍선·머리 배지) */}
        <div style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
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
        </div>
        {/* 타격 이펙트 — 캐릭터 위 오버레이(공 차기·부딪힘 시 팝) */}
        <ImpactFX />
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

      {/* 상단 HUD — 내 정보(좌) · 로고(중앙) · 메뉴(우) */}
      <MyInfo tier={tier} nickname={nickname} onClick={() => setProfileOpen(true)} />
      <StreakPill streak={streak} freezes={freezes} onClick={() => setStreakOpen(true)} />
      <button onClick={() => setMenuOpen(true)} aria-label="메뉴" className="tg-press"
        style={{ position: 'absolute', right: 24, top: 20, width: 40, height: 40, borderRadius: RADIUS.xl, background: '#fff', boxShadow: '0 5px 14px rgba(43,39,48,0.07)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5, ...TOUCH_OPT }}>
        <Settings size={20} weight="Bold" color={TG.INK} />
      </button>

      {/* 하늘하늘중국어 링크 허브 입구 — 흰 타일 유지, 심볼 뒤 틴트만 제거 + 검정 심볼(brightness 0) + 좁은 간격(사용자 요청) */}
      <button className="tg-press" onClick={() => { playSfx('button'); openHub(); }} aria-label={hubDot ? '하늘하늘 · 새 소식' : '하늘하늘'} style={{
        position: 'absolute', right: 24, top: 110, zIndex: 4, padding: '9px 13px', background: '#F3EEE4', border: 'none', borderRadius: RADIUS.btn,
        boxShadow: '0 5px 14px rgba(26,16,20,0.10)', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, ...TOUCH_OPT,
      }}>
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <img src="/symbol-red.png" alt="" style={{ width: 27, height: 27, objectFit: 'contain', filter: 'brightness(0)', display: 'block' }} />
          {hubDot && <span aria-hidden="true" style={{ position: 'absolute', top: -5, right: -5, width: 10, height: 10, borderRadius: '50%', background: TG.CORAL_DK, border: '2px solid #fff', animation: 'tg-dotpulse 1.1s ease-in-out infinite' }} />}
        </span>
        <span style={{ ...TYPE.micro, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1, color: TG.INK }}>하늘하늘</span>
      </button>

      {/* 하단 컨트롤 도크 배경 — 깔끔한 흰색·라운드 없음(사용자 요청). 상단 그림자로만 방과 분리 */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 'calc(166px + env(safe-area-inset-bottom))', background: '#fff', boxShadow: '0 -6px 18px rgba(43,39,48,0.06)', pointerEvents: 'none', zIndex: 2 }} />

      {/* 하단 — 플레이 CTA(은은한 펄스) + 보조 3 */}
      <div style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(88px + env(safe-area-inset-bottom))', zIndex: 3, animation: 'tg-cta-pulse 2.6s ease-in-out infinite' }}>
        <button className="tg-press" data-coach="tg-play" onClick={() => { playSfx('button'); if (coach.visible) coach.dismiss(); onPlay && onPlay(); }} style={{
          width: '100%', height: 60, borderRadius: RADIUS.xl, border: 'none', cursor: 'pointer',
          background: TG.CORAL_GRAD, boxShadow: '0px 10px 20px rgba(242,72,76,0.32)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.md, ...TOUCH_OPT,
        }}>
          <span style={{ ...TYPE.cta, fontSize: 21, color: '#fff' }}>모드 선택</span>
          <Play size={18} weight="Bold" color="#fff" />
        </button>
      </div>
      <div style={{ position: 'absolute', left: 24, right: 24, bottom: 'calc(24px + env(safe-area-inset-bottom))', zIndex: 3, display: 'flex', gap: SPACE.xl }}>
        {aux.map(({ key, Icon, label, onClick, dot }) => (
          <button key={key} className="tg-press" onClick={onClick} aria-label={dot ? `${label} · 새 소식` : undefined} style={{
            position: 'relative', flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: SPACE.md, padding: '9px 0', borderRadius: RADIUS.lg,
            background: TG.SURFACE, border: 'none', cursor: 'pointer', ...TOUCH_OPT,
          }}>
            {/* 레드닷 — 알림/할 일 있음. 점 자체가 커졌다 작아졌다(스케일 펄스)로 강조. */}
            {dot && <span aria-hidden="true" style={{ position: 'absolute', top: 7, right: 9, width: 8, height: 8, borderRadius: '50%', background: TG.CORAL_DK, animation: 'tg-dotpulse 1.1s ease-in-out infinite' }} />}
            {/* 아이콘 배경(틴트) 제거 — 아이콘 직접. 색은 텍스트와 통일(TG.INK). 크기 균형(20 / 14) */}
            <Icon size={20} weight="Bold" color={TG.INK} style={{ flexShrink: 0 }} />
            <span style={{ ...TYPE.label, color: TG.INK }}>{label}</span>
          </button>
        ))}
      </div>

      {cardTone != null && <ToneCard tone={TONES.find((t) => t.num === cardTone)} status={toneStatus[cardTone]} level={Math.min(5, (toneLevels[cardTone] || {}).lv || 1)} onClose={() => setCardTone(null)} />}
      {streakOpen && <StreakSheet streak={streak} longest={streakLongest} freezes={freezes} onClose={() => setStreakOpen(false)} />}
      {profileOpen && <ProfileModal tier={tier} nickname={nickname} isGuest={isGuest} isMemberUser={isMemberUser} userId={studentToken}
        onEditNickname={onEditNickname ? () => { setProfileOpen(false); setNickEditOpen(true); } : null}
        onExam={null}
        onLogout={onLogout} onMastery={() => { setProfileOpen(false); onMastery && onMastery(); }}
        onClose={() => setProfileOpen(false)} />}
      {menuOpen && <HomeMenu onClose={() => setMenuOpen(false)} onHelp={onHelp} onCredits={() => setCreditsOpen(true)} onLogin={onLogin} isMemberUser={isMemberUser} memberName={memberName} onEditNickname={onEditNickname ? () => setNickEditOpen(true) : null} onLogout={onLogout} onExit={onExit} onDebugIntro={onDebugIntro} onDebugScore={() => setDebugScoreOpen(true)} />}
      {creditsOpen && <CreditsModal onClose={() => setCreditsOpen(false)} />}
      {nickEditOpen && <NicknameEditModal current={nickname || memberName || ''} onSave={onEditNickname} onClose={() => setNickEditOpen(false)} />}
      {playOpen && <PlayModal onClose={() => setPlayOpen(false)} />}
      {hubOpen && <LinkHubScreen onClose={() => setHubOpen(false)} />}
      {import.meta.env.DEV && debugScoreOpen && <DebugScoreModal studentToken={studentToken} onClose={() => setDebugScoreOpen(false)} onApplied={() => onRefreshBest && onRefreshBest()} />}

      {/* 첫 방문 코치마크 가이드 — 방/등급/연속학습/플레이 순서로 안내(1회). 타이틀→홈 전환(homeTx)이 끝난 뒤에만 표시 */}
      <CoachMarkOverlay visible={homeReady && coach.visible} onDone={coach.dismiss} steps={COACH_STEPS} delay={160} showControls={false} forceLastStep />
    </FigmaScreen>
  );
}
