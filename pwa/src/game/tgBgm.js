// 성조게임 배경음(BGM) — 오디오 파일(SUNO 제작) 재생 버전.
// public/game/bgm/menu.mp3 를 HTMLAudioElement로 루프 재생. 인터페이스·동작은 신스 버전과 동일:
//   메뉴 화면에서만 재생·게임 중 정지(ToneGamePage), 음소거(localStorage 'tg_bgm_muted'), 페이드인/아웃, 백그라운드 처리.
// ▶ 이전 프로시저럴 신스 엔진 백업: docs/tgBgm.synth.bak.js (되돌리려면 이 파일에 덮어쓰기).
// 사용법: initBgm()(진입 1회) → 메뉴 startBgm() / 게임 진입 stopBgm().

const SRC = '/game/bgm/menu.mp3';
const MASTER = 0.5;         // 배경음 볼륨(SFX/TTS·성조 재생을 방해 안 하게) — 필요시 조정
const FADE_IN = 900;        // ms
const FADE_OUT = 450;       // ms
const DUCK = 0.35;          // 더킹 시 볼륨 = MASTER × DUCK (TTS 발음이 또렷하게 들리도록 BGM을 잠깐 낮춤)

let audio = null;
let muted = false;
let wantPlaying = false;    // 재생 의도(화면상태 무관) — 백그라운드 복귀·제스처 언락 판단용
let fadeRaf = null;
let ducked = false;
let duckReleaseT = null;
// ⚠️ iOS Safari는 HTMLAudioElement.volume 세터를 무시(항상 풀 볼륨) → 페이드·마스터·더킹 전부 무효.
//   → Web Audio 경유: 엘리먼트를 MediaElementSource로 물려 GainNode.gain으로 볼륨 제어.
//   AudioContext 미지원/생성 실패 시엔 기존 el.volume 방식으로 폴백.
let actx = null;
let gain = null;            // 볼륨 제어 GainNode(있으면 이걸로, 없으면 el.volume)
let srcNode = null;         // createMediaElementSource는 엘리먼트당 1회만 가능 — 엘리먼트와 함께 보관
let vol = 0;                // 현재 논리 볼륨(0~1) — iOS에선 el.volume이 신뢰 불가라 자체 보관

function ensureAudio() {
  if (audio) return audio;
  try {
    audio = new Audio(SRC);
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 0;
    vol = 0;
    // 파일 없음/디코딩 실패는 조용히 무음(에러로 앱 안 죽게).
    audio.addEventListener('error', () => { /* noop — BGM만 안 나옴 */ });
    // Web Audio 경유 볼륨 제어 연결(1회) — 실패하면 el.volume 폴백 그대로.
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        actx = new AC();
        srcNode = actx.createMediaElementSource(audio);
        gain = actx.createGain();
        gain.gain.value = 0;
        srcNode.connect(gain).connect(actx.destination);
        audio.volume = 1; // 볼륨은 이제 GainNode가 담당(el.volume은 소스에 곱해지므로 1로 고정)
      }
    } catch { actx = null; gain = null; srcNode = null; }
  } catch { audio = null; }
  return audio;
}

// 현재 볼륨 적용 — GainNode 우선(iOS 대응), 없으면 el.volume.
function setVol(v) {
  vol = Math.max(0, Math.min(1, v));
  if (gain) { try { gain.gain.value = vol; } catch { /* noop */ } }
  else if (audio) { try { audio.volume = vol; } catch { /* noop */ } }
}

// 볼륨 페이드(rAF). target=0이면 끝나고 pause.
function fadeTo(target, ms, thenPause) {
  const a = audio;
  if (!a) return;
  if (fadeRaf) { cancelAnimationFrame(fadeRaf); fadeRaf = null; }
  const from = vol;
  let t0 = null;
  const step = (ts) => {
    if (t0 == null) t0 = ts;
    const k = ms > 0 ? Math.min(1, (ts - t0) / ms) : 1;
    setVol(from + (target - from) * k);
    if (k < 1) { fadeRaf = requestAnimationFrame(step); }
    else { fadeRaf = null; if (thenPause) { try { a.pause(); } catch { /* noop */ } } }
  };
  fadeRaf = requestAnimationFrame(step);
}

function tryPlay() {
  const a = ensureAudio();
  if (!a) return;
  if (actx && actx.state !== 'running') actx.resume().catch(() => {}); // Web Audio 언락(suspended/iOS interrupted 복구)
  const p = a.play();
  if (p && p.catch) p.catch(() => {}); // autoplay 차단 시 조용히 — 다음 제스처(unlockOnGesture)에서 재시도
  fadeTo(ducked ? MASTER * DUCK : MASTER, FADE_IN, false); // 더킹 중이면 낮은 볼륨으로 시작
}

// ─── 공개 API ───────────────────────────────────────────────────────
export function isBgmMuted() {
  try { return localStorage.getItem('tg_bgm_muted') === '1'; } catch { return false; }
}
export function setBgmMuted(m) {
  muted = !!m;
  try { localStorage.setItem('tg_bgm_muted', m ? '1' : '0'); } catch { /* noop */ }
  if (m) stopBgm();
}

// 첫 사용자 제스처에서 오디오 언락 — autoplay 정책상 첫 재생은 제스처 필요.
function unlockOnGesture() {
  if (actx && actx.state !== 'running') actx.resume().catch(() => {}); // 제스처 안에서 Web Audio ctx도 함께 언락
  if (wantPlaying && !muted && audio && audio.paused
    && !(typeof document !== 'undefined' && document.hidden)) tryPlay();
}
// 탭 백그라운드/화면잠금 → 일시정지(재생 의도 wantPlaying 보존), 복귀 시 자동 재개.
function onVisibility() {
  if (typeof document === 'undefined') return;
  if (document.hidden) {
    if (audio && !audio.paused) { if (fadeRaf) { cancelAnimationFrame(fadeRaf); fadeRaf = null; } try { audio.pause(); } catch { /* noop */ } }
  } else if (wantPlaying && !muted) { tryPlay(); }
}

// 진입 시 1회 — 음소거 상태 읽고 제스처 언락·가시성 리스너 등록.
export function initBgm() {
  muted = isBgmMuted();
  try {
    window.addEventListener('pointerdown', unlockOnGesture);
    window.addEventListener('keydown', unlockOnGesture);
    document.addEventListener('visibilitychange', onVisibility);
  } catch { /* noop */ }
}

// 배경음 시작 — 메뉴 화면에서 호출. 음소거면 no-op.
export function startBgm() {
  if (muted) return;
  wantPlaying = true;
  if (typeof document !== 'undefined' && document.hidden) return; // 백그라운드면 보류(복귀 시 재개)
  tryPlay();
}

// 배경음 정지 — 게임 진입 등에서 호출. 페이드아웃 후 일시정지.
export function stopBgm() {
  wantPlaying = false;
  if (!audio) return;
  fadeTo(0, FADE_OUT, true);
}

// ── 더킹 — TTS 발음 등이 나올 때 BGM을 잠깐 낮춰 콘텐츠를 또렷하게 ──
function applyDuckVolume() {
  if (!audio || audio.paused || muted) return; // 재생 중일 때만 의미
  fadeTo(ducked ? MASTER * DUCK : MASTER, ducked ? 140 : 420, false); // 내릴 땐 빠르게, 복귀는 부드럽게
}
// 더킹 시작(또는 연장). hold ms 후 자동 복귀(놓친 경로 안전망). releaseBgmDuck()으로 즉시 복귀.
export function duckBgm(hold = 2500) {
  ducked = true;
  applyDuckVolume();
  if (duckReleaseT) clearTimeout(duckReleaseT);
  duckReleaseT = setTimeout(releaseBgmDuck, hold);
}
export function releaseBgmDuck() {
  if (duckReleaseT) { clearTimeout(duckReleaseT); duckReleaseT = null; }
  if (!ducked) return;
  ducked = false;
  applyDuckVolume();
}
