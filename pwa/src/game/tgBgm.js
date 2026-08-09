// 성조게임 배경음(BGM) — 오디오 파일(SUNO 제작) 재생 버전.
// public/game/bgm/menu.mp3 를 **Web Audio 버퍼**로 루프 재생. 인터페이스·동작은 이전과 동일:
//   메뉴 화면에서만 재생·게임 중 정지(ToneGamePage), 음소거(localStorage 'tg_bgm_muted'), 페이드인/아웃, 백그라운드 처리.
// ▶ 이전 프로시저럴 신스 엔진 백업: docs/tgBgm.synth.bak.js (되돌리려면 이 파일에 덮어쓰기).
// 사용법: initBgm()(진입 1회) → 메뉴 startBgm() / 게임 진입 stopBgm().
//
// ⚠️ **왜 HTMLAudioElement를 안 쓰는가** (2026-08-09 사용자 제보로 전환)
//   <audio>로 긴 오디오를 재생하면 iOS가 이를 "지금 재생 중"으로 등록해 **잠금화면에 음악 플레이어
//   컨트롤이 뜬다**(재생/10초 이동/AirPlay). 게임 배경음일 뿐인데 음악 앱처럼 보인다.
//   Web Audio 버퍼 재생은 미디어 세션을 만들지 않아 이 컨트롤이 생기지 않는다.
//   덤으로 iOS의 el.volume 무시 문제(페이드·더킹이 안 먹던 것)도 원천적으로 사라진다.
//
// ⚠️ **메모리** — 디코딩한 오디오는 압축이 풀린 채로 메모리에 올라간다.
//   원본 48kHz 스테레오 159초를 그대로 풀면 58MB. 배경음악에 그만한 값을 쓸 이유가 없어
//   **32kHz 모노(약 20MB)**로 낮춘다. 컨텍스트를 32kHz로 만들면 decodeAudioData가 알아서
//   리샘플링하고(피치 변화 없음), 디코딩 직후 모노로 합쳐 스테레오 버퍼는 버린다.
//   휴대폰 스피커는 모노이고 이 곡은 볼륨 50%로 뒤에 깔려서, 체감 차이가 없다.
//   (근본 개선은 음원을 짧은 루프로 다시 뽑는 것 — 다운로드 3.6MB도 같이 줄어든다)

const SRC = '/game/bgm/menu.mp3';
const RATE = 32000;         // 디코딩 샘플레이트(원본 48k → 리샘플). 메모리 = 길이 × RATE × 4바이트
const MASTER = 0.5;         // 배경음 볼륨(SFX/TTS·성조 재생을 방해 안 하게) — 필요시 조정
const FADE_IN = 900;        // ms
const FADE_OUT = 450;       // ms
const DUCK = 0.35;          // 더킹 시 볼륨 = MASTER × DUCK (TTS 발음이 또렷하게 들리도록 BGM을 잠깐 낮춤)

let actx = null;
let gain = null;
let buffer = null;          // 디코딩된 모노 버퍼(1회 로드)
let loadingP = null;        // 로드 진행 중 프로미스(중복 fetch 방지)
let node = null;            // 현재 재생 중인 AudioBufferSourceNode
let muted = false;
let wantPlaying = false;    // 재생 의도(화면상태 무관) — 백그라운드 복귀·제스처 언락 판단용
let ducked = false;
let duckReleaseT = null;
let offset = 0;             // 곡 내 재개 지점(초) — stop 시 보존해 이어 재생
let startedAt = 0;          // 이번 재생을 시작한 actx.currentTime
let stopT = null;           // 페이드아웃 뒤 실제 stop 예약 타이머
let fading = null;          // 페이드아웃 중이라 **아직 살아 있는** 노드 — 재진입 시 반드시 먼저 죽인다

function ensureCtx() {
  if (actx) return actx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC({ sampleRate: RATE });
    gain = actx.createGain();
    gain.gain.value = 0;
    gain.connect(actx.destination);
  } catch { actx = null; gain = null; }
  return actx;
}

// mp3 → 모노 버퍼. 실패(파일 없음·디코딩 불가)하면 buffer=null로 남아 조용히 무음.
function ensureBuffer() {
  if (buffer) return Promise.resolve(buffer);
  if (loadingP) return loadingP;
  const c = ensureCtx();
  if (!c) return Promise.resolve(null);
  loadingP = fetch(SRC)
    .then((r) => r.arrayBuffer())
    .then((ab) => c.decodeAudioData(ab))
    .then((decoded) => {
      // 모노 다운믹스 — 채널 평균. 여기서 스테레오 원본을 버려 메모리를 절반으로 떨군다.
      if (decoded.numberOfChannels === 1) { buffer = decoded; return buffer; }
      const mono = c.createBuffer(1, decoded.length, decoded.sampleRate);
      const out = mono.getChannelData(0);
      const chs = [];
      for (let ch = 0; ch < decoded.numberOfChannels; ch += 1) chs.push(decoded.getChannelData(ch));
      for (let i = 0; i < decoded.length; i += 1) {
        let sum = 0;
        for (let ch = 0; ch < chs.length; ch += 1) sum += chs[ch][i];
        out[i] = sum / chs.length;
      }
      buffer = mono;
      return buffer;
    })
    .catch(() => { buffer = null; return null; }) // 조용히 무음(BGM만 안 나옴)
    .finally(() => { loadingP = null; });
  return loadingP;
}

// 볼륨 램프 — 오디오 스레드가 처리해 rAF보다 매끄럽고, 탭이 바빠도 끊기지 않는다.
function rampTo(target, ms) {
  if (!gain || !actx) return;
  const now = actx.currentTime;
  const cur = gain.gain.value;
  try {
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(cur, now);
    gain.gain.linearRampToValueAtTime(target, now + Math.max(0.001, ms / 1000));
  } catch { /* noop */ }
}

// 지금 나야 할 볼륨(더킹 반영)
const targetVol = () => (ducked ? MASTER * DUCK : MASTER);

// 실제 재생 시작 — 버퍼가 준비된 뒤 호출된다.
function startNode() {
  const c = ensureCtx();
  if (!c || !buffer || node) return;
  try {
    node = c.createBufferSource();
    node.buffer = buffer;
    node.loop = true;
    node.connect(gain);
    node.start(0, offset % buffer.duration);
    startedAt = c.currentTime;
  } catch { node = null; }
}

// 페이드아웃 중인 노드를 즉시 정리 — 재생을 다시 시작하기 전에 반드시 호출한다.
//  ⚠️ 예약된 stop만 취소하면 옛 노드가 살아남아 새 노드와 **겹쳐 재생**된다(정지 시 node=null로 비워
//     참조를 잃기 때문). 위치(offset)는 이미 stopNode에서 저장돼 있어 즉시 끊어도 이어 듣기엔 지장 없다.
function killFading() {
  if (stopT) { clearTimeout(stopT); stopT = null; }
  if (fading) { try { fading.stop(); } catch { /* noop */ } fading = null; }
}

// 재생 중지 + 재개 지점 보존. fadeMs>0이면 페이드아웃 뒤 멈춘다.
function stopNode(fadeMs) {
  killFading();
  if (!node || !actx || !buffer) return;
  const n = node;
  node = null;
  offset = (offset + (actx.currentTime - startedAt)) % buffer.duration; // 이어 듣기 위치 기억
  if (fadeMs > 0) {
    rampTo(0, fadeMs);
    fading = n;
    stopT = setTimeout(() => {
      try { n.stop(); } catch { /* noop */ }
      if (fading === n) fading = null;
      stopT = null;
    }, fadeMs + 60);
  } else {
    rampTo(0, 1);
    try { n.stop(); } catch { /* noop */ }
  }
}

function tryPlay() {
  const c = ensureCtx();
  if (!c) return;
  if (c.state !== 'running') c.resume().catch(() => {}); // 언락(suspended/iOS 'interrupted' 복구)
  killFading();                                          // 페이드아웃 도중 재진입 — 옛 노드를 확실히 끊는다
  ensureBuffer().then(() => {
    if (!wantPlaying || muted) return;  // 로드가 끝나기 전에 상황이 바뀌었으면 무시
    if (!node) startNode();
    rampTo(targetVol(), FADE_IN);
  });
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
  if (actx && actx.state !== 'running') actx.resume().catch(() => {});
  if (wantPlaying && !muted && !node
    && !(typeof document !== 'undefined' && document.hidden)) tryPlay();
}
// 탭 백그라운드/화면잠금 → 컨텍스트 정지(재생 의도 wantPlaying 보존), 복귀 시 자동 재개.
//  suspend는 재생 위치를 그대로 얼려두므로 곡이 처음부터 다시 시작하지 않는다.
function onVisibility() {
  if (typeof document === 'undefined' || !actx) return;
  if (document.hidden) { if (actx.state === 'running') actx.suspend().catch(() => {}); }
  else if (wantPlaying && !muted) tryPlay();
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

// 배경음 정지 — 게임 진입 등에서 호출. 페이드아웃 후 정지.
export function stopBgm() {
  wantPlaying = false;
  stopNode(FADE_OUT);
}

// ── 더킹 — TTS 발음 등이 나올 때 BGM을 잠깐 낮춰 콘텐츠를 또렷하게 ──
function applyDuckVolume() {
  if (!node || muted) return; // 재생 중일 때만 의미
  rampTo(targetVol(), ducked ? 140 : 420); // 내릴 땐 빠르게, 복귀는 부드럽게
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
