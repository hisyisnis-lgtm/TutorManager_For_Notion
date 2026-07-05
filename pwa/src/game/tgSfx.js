// 성조게임 효과음(SFX) — Web Audio API 프로시저럴 신스 엔진.
// 오디오 파일 없이(0KB) 브라우저에서 실시간 합성. tgBgm.js와 같은 아기자기 카툰 팔레트
// (마림바/벨·피치카토·우드블록·필터드 노이즈)로 통일 — "데굴데굴 토리"풍 톤과 어울리게.
// 외부 인터페이스 유지: play(key, volOverride, rate) / initSfx / isSfxMuted / setSfxMuted.
//   - rate: 음정 배율(콤보 피치 래더 = 2^(콤보/12)). 음정 있는 SFX의 주파수에 곱함.
// 이전 버전은 Dustyroom WAV(fetch+decodeAudioData) 방식 — 파일 의존 제거하고 전부 코드 합성으로 대체.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// 기본 볼륨(볼륨 오버라이드 없을 때).
const BASE = {
  tap: 0.3, button: 0.3, count: 0.4, correct: 0.5, combo: 0.5, score: 0.4,
  go: 0.5, wrong: 0.42, timeout: 0.5, win: 0.46, gameover: 0.47, unlock: 0.46, // win·unlock·gameover=다중 마림바라 튐 → 낮춤(음량 밸런스)
  whoosh: 0.4, locked: 0.45,
  // 성조 캐릭터 목소리(자주 나므로 낮게)
  tone1: 0.2, tone2: 0.2, tone3: 0.2, tone4: 0.2, tone0: 0.22,
};

let ctx = null;
let bus = null;      // 마스터 버스(로우패스+컴프)
let noiseBuf = null;
let muted = false;

function makeNoise(seconds) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function ensureCtx() {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 3; comp.attack.value = 0.003; comp.release.value = 0.15;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9500; // 거슬리는 고역 정리
    bus = ctx.createGain(); bus.gain.value = 1;
    bus.connect(lp).connect(comp).connect(ctx.destination);
    noiseBuf = makeNoise(0.5);
  } catch { ctx = null; }
  return ctx;
}

// ─── 합성 유닛 ─────────────────────────────────────────────────────
// 마림바/벨 — 사인 배음 합, 빠른 지수감쇠. 보상감 있는 음정 SFX용.
function mallet(freq, t, vol, dur = 0.4) {
  [[1, 1], [2, 0.3], [3, 0.1]].forEach(([m, g]) => {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * m;
    const a = ctx.createGain();
    a.gain.setValueAtTime(0.0001, t);
    a.gain.linearRampToValueAtTime(vol * g, t + 0.003);
    a.gain.exponentialRampToValueAtTime(0.0001, t + dur * (0.4 + 0.6 / m));
    o.connect(a).connect(bus); o.start(t); o.stop(t + dur + 0.05);
  });
}
// 단순 톤(글라이드 지원) — 블립·버즈·슬라이드용.
function blip(freq, t, dur, vol, type = 'triangle', freqEnd) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bus); o.start(t); o.stop(t + dur + 0.03);
}
// 우드블록 "톡" — 피치 드롭 사인 짧게.
function woodblock(freq, t, vol) {
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.03);
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  o.connect(g).connect(bus); o.start(t); o.stop(t + 0.06);
}
// 노이즈 스윕 — 휘익/반짝임용.
function noiseSweep(t, dur, vol, f0, f1, type = 'bandpass') {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = 0.8;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(bus); s.start(t); s.stop(t + dur + 0.05);
}
// 성조 목소리 — 캐릭터가 말할 때. "말하는 듯한" 보컬 합성(source-filter):
//   성대 진동 같은 톱니 소스 → 모음 포먼트(병렬 밴드패스 3개) + 비브라토 + 2음절 진폭("N-성!"처럼 툭툭).
//   피치 곡선은 성조 그대로(1평탄·2상승·3요철·4하강·경성 가볍게 살짝↓). → "삐용"이 아니라 귀여운 캐릭터가 말하는 느낌.
function toneVoice(num, t, v) {
  const dur = num === 0 ? 0.26 : 0.34; // 경성도 2음절로(존재감), 살짝 짧게만
  // 성문 소스(톱니+스퀘어) + 비브라토
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  const o2 = ctx.createOscillator(); o2.type = 'square';
  const o2g = ctx.createGain(); o2g.gain.value = 0.3;
  const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 6;
  const lfoG = ctx.createGain(); lfoG.gain.value = 14; // ±14 cents 비브라토
  lfo.connect(lfoG); lfoG.connect(o.detune); lfoG.connect(o2.detune);
  // 피치 컨투어(성조)
  const set = (fn) => { fn(o.frequency); fn(o2.frequency); };
  if (num === 1) set((x) => { x.setValueAtTime(680, t); x.setValueAtTime(680, t + dur); });
  else if (num === 2) set((x) => { x.setValueAtTime(470, t); x.exponentialRampToValueAtTime(760, t + dur); });
  else if (num === 3) set((x) => { x.setValueAtTime(560, t); x.exponentialRampToValueAtTime(380, t + dur * 0.5); x.exponentialRampToValueAtTime(600, t + dur); });
  else if (num === 4) set((x) => { x.setValueAtTime(800, t); x.exponentialRampToValueAtTime(340, t + dur * 0.9); });
  else set((x) => { x.setValueAtTime(540, t); x.exponentialRampToValueAtTime(470, t + dur); }); // 경성: 가볍게 살짝 내려가는 중간음
  // 모음 포먼트(병렬 밴드패스) — 보컬 모음 음색
  const src = ctx.createGain(); o.connect(src); o2.connect(o2g).connect(src);
  const amp = ctx.createGain();
  [[720, 9, 1.0], [1180, 11, 0.65], [2600, 12, 0.25]].forEach(([fq, q, gg]) => {
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = fq; f.Q.value = q;
    const fg = ctx.createGain(); fg.gain.value = gg;
    src.connect(f).connect(fg).connect(amp);
  });
  // 진폭: 2음절(연결된 말소리처럼 툭-툭) — 타이밍은 dur 비례라 길이 달라도 자연스럽게
  const g = amp.gain;
  g.setValueAtTime(0.0001, t);
  g.linearRampToValueAtTime(v * 0.9, t + 0.02);       // 음절1 어택
  g.linearRampToValueAtTime(v * 0.45, t + dur * 0.34);
  g.linearRampToValueAtTime(v * 0.12, t + dur * 0.43); // 음절 사이(완전 무음 아님)
  g.linearRampToValueAtTime(v, t + dur * 0.56);        // 음절2 어택
  g.linearRampToValueAtTime(v, t + dur * 0.88);
  g.exponentialRampToValueAtTime(0.0001, t + dur + 0.06);
  amp.connect(bus);
  const end = t + dur + 0.12;
  o.start(t); o2.start(t); lfo.start(t);
  o.stop(end); o2.stop(end); lfo.stop(end);
}

// ─── SFX 정의 ──────────────────────────────────────────────────────
// 각 fn(t, vol, rate) — t=시작시각, vol=해결된 볼륨, rate=음정 배율.
const SYNTH = {
  tap: (t, v, r) => blip(660 * r, t, 0.07, v, 'triangle', 780 * r),           // 부분정답 진행: 밝은 틱
  button: (t, v) => blip(300, t, 0.09, v, 'triangle', 200),                    // UI 버튼: 부드러운 팝
  count: (t, v) => woodblock(880, t, v),                                       // 카운트다운: 우드블록 틱
  correct: (t, v, r) => { mallet(mtof(76) * r, t, v, 0.32); mallet(mtof(81) * r, t + 0.06, v, 0.4); }, // 정답: 2음 상승 벨
  combo: (t, v, r) => {                                                        // 콤보: 스냅한 2음(피치 래더) + 반짝
    blip(mtof(81) * r, t, 0.05, v * 0.8, 'square');
    blip(mtof(88) * r, t + 0.05, 0.12, v, 'square');
    noiseSweep(t, 0.09, v * 0.28, 4000, 9000, 'highpass');
  },
  score: (t, v, r) => { blip(988 * r, t, 0.05, v, 'square'); blip(1319 * r, t + 0.06, 0.12, v, 'square'); }, // 코인 "딩딩"
  go: (t, v) => {                                                              // 시작: 상승 3음 + 악센트
    [60, 64, 67].forEach((m, i) => blip(mtof(m), t + i * 0.045, 0.1, v, 'square'));
    blip(mtof(72), t + 0.145, 0.2, v, 'square');
  },
  wrong: (t, v) => {                                                           // 오답: 부드러운 하강 버즈(거슬리지 않게)
    blip(mtof(52), t, 0.16, v, 'square', mtof(49));
    blip(mtof(52) * 1.01, t, 0.16, v * 0.45, 'sawtooth', mtof(49));
  },
  timeout: (t, v) => blip(520, t, 0.32, v, 'triangle', 150),                   // 시간초과: 아래로 슬라이드
  win: (t, v) => {                                                             // 신기록: 상승 아르페지오 팡파르 + 반짝
    [72, 76, 79, 84].forEach((m, i) => mallet(mtof(m), t + i * 0.09, v, 0.5));
    noiseSweep(t + 0.1, 0.28, v * 0.25, 5000, 11000, 'highpass');
  },
  gameover: (t, v) => {                                                       // 게임오버: 벌 주는 소리 X — 잔잔하고 따뜻한 장조 마무리 화음(촌스러운 효과 없이 리버브로 은은히 안착)
    [60, 64, 67, 72].forEach((m, i) => mallet(mtof(m), t + i * 0.05, v * 0.5, 1.0)); // C E G C 부드럽게 롤링하며 울림
  },
  unlock: (t, v) => {                                                          // 잠금해제: 5음계 상승 반짝
    [72, 76, 79, 81, 84].forEach((m, i) => mallet(mtof(m), t + i * 0.06, v * 0.9, 0.4));
    noiseSweep(t + 0.05, 0.3, v * 0.25, 6000, 12000, 'highpass');
  },
  whoosh: (t, v) => noiseSweep(t, 0.25, v, 600, 6000, 'bandpass'),             // 전환: 휘익
  locked: (t, v) => { blip(150, t, 0.1, v, 'square'); blip(150, t + 0.13, 0.12, v, 'square'); }, // 거절 "부-부"
  // 성조 캐릭터 목소리(말할 때) — 각 성조 음높이 곡선
  tone1: (t, v) => toneVoice(1, t, v),
  tone2: (t, v) => toneVoice(2, t, v),
  tone3: (t, v) => toneVoice(3, t, v),
  tone4: (t, v) => toneVoice(4, t, v),
  tone0: (t, v) => toneVoice(0, t, v),
};

// ─── 공개 API ──────────────────────────────────────────────────────
export function isSfxMuted() { try { return localStorage.getItem('tg_sfx_muted') === '1'; } catch { return false; } }
export function setSfxMuted(m) { muted = !!m; try { localStorage.setItem('tg_sfx_muted', m ? '1' : '0'); } catch { /* noop */ } }

// 첫 사용자 제스처에서 오디오 언락.
function unlockOnGesture() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }

// 진입 시 1회 — 음소거 상태만 읽어둠(ctx는 첫 재생 시 지연 생성). 제스처 언락 리스너 등록.
export function initSfx() {
  muted = isSfxMuted();
  try {
    window.addEventListener('pointerdown', unlockOnGesture);
    window.addEventListener('keydown', unlockOnGesture);
  } catch { /* noop */ }
}

// 효과음 재생 — 지연 0, 겹쳐 재생 자유. rate=음정 배율(콤보 래더 등).
let lastBtnAt = 0; // 'button' 초근접 중복(전역 pointerdown 리스너 + 명시 onClick) 1회로 합침
export function play(key, volOverride, rate) {
  if (muted) return;
  if (key === 'button') {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (now - lastBtnAt < 200) return; // 200ms 내 중복 버튼음 무시
    lastBtnAt = now;
  }
  const c = ensureCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {}); // 첫 제스처에서 unlock
  const fn = SYNTH[key];
  if (!fn) return;
  const vol = volOverride != null ? volOverride : (BASE[key] ?? 0.4);
  try { fn(c.currentTime + 0.001, vol, rate && rate > 0 ? rate : 1); } catch { /* noop */ }
}
