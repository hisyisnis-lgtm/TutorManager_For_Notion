// 성조게임 효과음(SFX) — Web Audio API 엔진.
// 외부 인터페이스(play/initSfx/isSfxMuted/setSfxMuted/SFX_FILES/VOL)는 유지하고 내부만 AudioContext 기반.
// 이유: 기존 HTMLAudio+cloneNode 방식은 ①첫 재생 시 로드·디코딩 지연 ②cloneNode가 매 재생 재버퍼링
//       ③모바일에서 .play() 자체 지연·동시채널 제한 → "사운드가 타이밍에 안 맞게 늦게/안 남".
// Web Audio: 진입 시 전 키를 decodeAudioData로 메모리(AudioBuffer) 적재 → AudioBufferSourceNode로 지연 0·겹침 자유.

const SFX_BASE = '/game/sfx/';
// 키 → 파일 (Dustyroom "Casual Game Sounds" CC0, public/game/sfx/lib/).
// 파형 분석(길이·피치 상승/하강·음 개수·밝기)으로 자동 배정 — 들어보고 번호만 바꾸면 됨.
export const SFX_FILES = {
  tap: 'lib/DM-CGS-21.wav',      // 부분정답 진행
  button: 'lib/DM-CGS-21.wav',   // UI 버튼(사용자 선택)
  count: 'lib/DM-CGS-03.wav',    // 카운트다운 틱(사용자 선택)
  correct: 'lib/DM-CGS-26.wav',  // 정답(사용자 선택)
  combo: 'lib/DM-CGS-28.wav',    // 콤보(사용자 선택)
  score: 'lib/DM-CGS-31.wav',    // 점수/코인
  go: 'lib/DM-CGS-07.wav',       // 시작
  wrong: 'lib/DM-CGS-16.wav',    // 오답(사용자 선택)
  timeout: 'lib/DM-CGS-04.wav',  // 시간초과(사용자 선택)
  win: 'lib/DM-CGS-18.wav',      // 신기록 달성(사용자 선택)
  gameover: 'lib/DM-CGS-12.wav', // 게임오버(사용자 선택)
  unlock: 'lib/DM-CGS-23.wav',   // 잠금해제(사용자 선택)
  whoosh: 'lib/DM-CGS-20.wav',   // 전환(미배선)
  locked: 'lib/DM-CGS-14.wav',   // 잠금 거절
};
const VOL = {
  tap: 0.3, correct: 0.5, wrong: 0.45, timeout: 0.5, combo: 0.45,
  count: 0.4, go: 0.5, score: 0.35, win: 0.6, gameover: 0.55,
  button: 0.32, whoosh: 0.4, locked: 0.45, unlock: 0.6,
};

let ctx = null;            // AudioContext (지연 생성)
const buffers = {};        // key → AudioBuffer(디코딩 완료분)
const inflight = new Set(); // 중복 로드 방지(로딩 중 키)
let muted = false;
let loadStarted = false;

function ensureCtx() {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = AC ? new AC() : null;
  } catch { ctx = null; }
  return ctx;
}

// decodeAudioData — 최신은 Promise, 구형 webkit은 콜백만. 둘 다 커버.
function decode(c, arr) {
  return new Promise((resolve, reject) => {
    const p = c.decodeAudioData(arr, resolve, reject);
    if (p && p.then) p.then(resolve, reject);
  });
}

async function loadBuffer(key) {
  const c = ensureCtx();
  if (!c) return;
  const file = SFX_FILES[key];
  if (!file || (key in buffers) || inflight.has(key)) return;
  inflight.add(key);
  try {
    const res = await fetch(`${SFX_BASE}${file}`);
    const arr = await res.arrayBuffer();
    buffers[key] = await decode(c, arr);
  } catch { /* 없는 파일/디코딩 실패는 조용히 무시 */ }
  finally { inflight.delete(key); }
}

export function isSfxMuted() { try { return localStorage.getItem('tg_sfx_muted') === '1'; } catch { return false; } }
export function setSfxMuted(m) { muted = !!m; try { localStorage.setItem('tg_sfx_muted', m ? '1' : '0'); } catch { /* noop */ } }

// 진입 시 1회: 컨텍스트 생성 + 전 키를 미리 디코딩 적재(디코딩은 사용자 제스처 불필요).
// 재생(resume)만 제스처가 필요한데, 첫 사운드는 보통 버튼 탭이라 play()에서 unlock됨.
export function initSfx() {
  muted = isSfxMuted();
  ensureCtx();
  if (loadStarted) return;
  loadStarted = true;
  Object.keys(SFX_FILES).forEach(loadBuffer); // 음소거여도 적재(나중에 켜면 즉시)
}

// 효과음 재생 — AudioBufferSourceNode(1회용)+GainNode. 지연 0, 겹쳐 재생 자유.
// rate: 재생 속도(=음정). 1=원음, 2^(반음/12). 콤보 피치 래더 등에 사용.
let lastBtnAt = 0; // 'button' 마지막 재생 — 초근접 중복(전역 리스너 pointerdown + 명시 onClick) 1회로 합침(다른 키는 미적용: 콤보 래더 등 보호)
export function play(key, volOverride, rate) {
  if (muted) return;
  if (key === 'button') {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (now - lastBtnAt < 200) return; // 200ms 내 중복 버튼음 무시
    lastBtnAt = now;
  }
  const c = ensureCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {}); // 첫 제스처에서 오디오 unlock
  const buf = buffers[key];
  if (!buf) { loadBuffer(key); return; } // 아직 적재 전이면 로드만 걸어두고 이번은 스킵(다음부턴 즉시)
  try {
    const src = c.createBufferSource();
    src.buffer = buf;
    if (rate && rate > 0) src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = volOverride != null ? volOverride : (VOL[key] ?? 0.4);
    src.connect(g).connect(c.destination);
    src.start();
  } catch { /* noop */ }
}
