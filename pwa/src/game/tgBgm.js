// 성조게임 배경음(BGM) — Web Audio API 프로시저럴 신스 엔진 (아기자기 카툰 바운스 톤).
// 오디오 파일 없이(0KB) 브라우저에서 실시간 합성해 무한 루프. tgSfx.js와 같은 Web Audio 방식.
// 레퍼런스: bgmpresident "데굴데굴 토리"(#뛰어노는음악 #경쾌함 #신나는) — 귀엽고 통통 튀는 만화풍 caper.
//   요소: ①마림바/실로폰 말렛 멜로디 ②피치카토 스타카토 스탭 ③바운시 베이스 ④우드블록·셰이커·소프트 킥/클랩
//        ⑤짧은 리버브(드라이). C장조 5음계(궁상각치우) 멜로디로 동양 색도 살짝. 8마디·BPM 126.
// 메뉴 화면에서만 흐르고 게임 중엔 정지. 음소거는 isBgmMuted()/setBgmMuted() (localStorage 'tg_bgm_muted', SFX와 별개).
// 사용법: initBgm()(진입 1회) → 메뉴 화면 startBgm() / 게임 진입 시 stopBgm().

const MASTER = 0.32;
const BPM = 126;             // "신나는/경쾌" — 통통 튀는 빠른 템포
const SEC16 = 60 / BPM / 4;
const LOOKAHEAD = 0.14;
const TICK = 30;
const BARS = 8;

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ─── 곡 데이터 (C장조, 밝은 I–V–vi–IV) ────────────────────────────────
const CHORDS = [
  { pad: [64, 67], bass: 36 }, // 1 C  (3도·5도 = 피치카토 스탭용)
  { pad: [62, 67], bass: 43 }, // 2 G
  { pad: [60, 64], bass: 45 }, // 3 Am
  { pad: [57, 60], bass: 41 }, // 4 F
  { pad: [64, 67], bass: 36 }, // 5 C
  { pad: [62, 67], bass: 43 }, // 6 G
  { pad: [57, 60], bass: 41 }, // 7 F
  { pad: [62, 67], bass: 43 }, // 8 G
];
// 멜로디(마림바): [MIDI, 시작스텝, 길이]. 전부 C장조 5음계, 데굴데굴 굴러가는 8분 런.
const MELODY = [
  [[76, 0, 2], [79, 2, 2], [81, 4, 2], [84, 6, 2], [81, 8, 2], [79, 10, 2], [81, 12, 2], [79, 14, 2]], // 1
  [[76, 0, 2], [74, 2, 2], [76, 4, 2], [79, 6, 2], [81, 8, 4], [79, 12, 2], [76, 14, 2]],               // 2
  [[79, 0, 2], [81, 2, 2], [84, 4, 2], [86, 6, 2], [84, 8, 2], [81, 10, 2], [79, 12, 2], [81, 14, 2]], // 3
  [[79, 0, 4], [76, 4, 2], [74, 6, 2], [72, 8, 4], [76, 12, 4]],                                        // 4
  [[84, 0, 2], [81, 2, 2], [79, 4, 2], [81, 6, 2], [84, 8, 2], [86, 10, 2], [88, 12, 4]],               // 5
  [[86, 0, 2], [84, 2, 2], [81, 4, 2], [79, 6, 2], [81, 8, 2], [79, 10, 2], [76, 12, 2], [74, 14, 2]], // 6
  [[79, 0, 2], [81, 2, 2], [79, 4, 2], [76, 6, 2], [79, 8, 2], [81, 10, 2], [84, 12, 4]],               // 7
  [[81, 0, 2], [79, 2, 2], [76, 4, 2], [74, 6, 2], [72, 8, 8]],                                         // 8
];
// 바운시 베이스: {s,rel,v}. 걸음마 베이스(루트·5도·경과음).
const BASSLINE = [
  { s: 0, rel: 0, v: 0.95 }, { s: 4, rel: 0, v: 0.55 }, { s: 8, rel: 0, v: 0.95 },
  { s: 11, rel: 7, v: 0.45 }, { s: 14, rel: 5, v: 0.4 },
];
const PIZZ_STEPS = [2, 6, 10, 14];   // 피치카토 오프비트 스탭("pah")
const KICK_STEPS = [0, 8];
const CLAP_STEPS = [4, 12];
const HAT_STEPS = [0, 2, 4, 6, 8, 10, 12, 14]; // 셰이커 8분(구르는 momentum)
const WOOD_STEPS = [6, 14];          // 우드블록 "톡"(장난스러운 악센트)

// ─── 오디오 그래프 ─────────────────────────────────────────────────
let ctx = null;
let master = null, comp = null, dryBus = null, reverb = null, revSend = null, noiseBuf = null;

let running = false;
let timer = null;
let gen = 0;
let step = 0;
let nextTime = 0;
let muted = false;
let wantPlaying = false;   // 재생 의도(화면 상태 무관) — 백그라운드 복귀 시 자동 재개 판단용

function makeReverbIR(seconds, decayPow) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) { const t = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decayPow); }
  }
  return buf;
}
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

    master = ctx.createGain(); master.gain.value = 0.0001;
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -15; comp.knee.value = 22; comp.ratio.value = 3.2;
    comp.attack.value = 0.005; comp.release.value = 0.2;
    const masterLP = ctx.createBiquadFilter(); masterLP.type = 'lowpass'; masterLP.frequency.value = 9500;
    comp.connect(masterLP).connect(master).connect(ctx.destination);

    dryBus = ctx.createGain(); dryBus.gain.value = 1; dryBus.connect(comp);

    reverb = ctx.createConvolver(); reverb.buffer = makeReverbIR(1.2, 3.2);
    const revReturn = ctx.createGain(); revReturn.gain.value = 0.42; // 드라이(만화풍)
    const revHP = ctx.createBiquadFilter(); revHP.type = 'highpass'; revHP.frequency.value = 500;
    revSend = ctx.createGain(); revSend.gain.value = 1;
    revSend.connect(revHP).connect(reverb).connect(revReturn).connect(comp);

    noiseBuf = makeNoise(0.4);
  } catch { ctx = null; }
  return ctx;
}

// ─── 보이스 ─────────────────────────────────────────────────────────
// 마림바/실로폰 말렛 — 사인 배음 합, 빠른 지수감쇠(고배음 더 빨리). 또랑또랑.
function mallet(freq, t, vol) {
  const partials = [[1, 1, 0.7], [2, 0.32, 0.4], [3, 0.12, 0.25], [4.2, 0.06, 0.14]];
  partials.forEach(([mult, g, dec]) => {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * mult;
    const a = ctx.createGain();
    a.gain.setValueAtTime(0.0001, t);
    a.gain.linearRampToValueAtTime(vol * g, t + 0.003);
    a.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    o.connect(a); a.connect(dryBus); if (mult <= 2) a.connect(revSend);
    o.start(t); o.stop(t + dec + 0.05);
  });
}

// 피치카토 스탭 — 삼각+톱니, 아주 짧게. 만화 특유의 "촉" 반주.
function pizz(freq, t, vol, pan) {
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
  const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = freq;
  const og = ctx.createGain(); og.gain.value = 0.28;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
  const a = ctx.createGain();
  a.gain.setValueAtTime(0.0001, t); a.gain.linearRampToValueAtTime(vol, t + 0.004);
  a.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  o.connect(lp); o2.connect(og).connect(lp); lp.connect(a);
  const p = ctx.createStereoPanner(); p.pan.value = pan || 0; a.connect(p); p.connect(dryBus);
  o.start(t); o2.start(t); o.stop(t + 0.2); o2.stop(t + 0.2);
}

// 바운시 베이스 — 삼각+로우패스, 스타카토. 둥근 만화 걸음마 베이스.
function bass(freq, t, dur, vol) {
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(lp); o2.connect(lp); lp.connect(g).connect(dryBus);
  o.start(t); o2.start(t); o.stop(t + dur + 0.03); o2.stop(t + dur + 0.03);
}

// 우드블록 — 피치 드롭 사인 짧게. 장난스러운 "톡".
function woodblock(t, vol, freq) {
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.03);
  const a = ctx.createGain(); a.gain.setValueAtTime(vol, t); a.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  o.connect(a).connect(dryBus); o.start(t); o.stop(t + 0.06);
}

// 킥 / 클랩 / 셰이커
function kick(t, vol) {
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.08);
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
  o.connect(g).connect(dryBus); o.start(t); o.stop(t + 0.15);
}
function clap(t, vol) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.9;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  s.connect(bp).connect(g).connect(dryBus); s.start(t); s.stop(t + 0.11);
}
function shaker(t, vol) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 8000;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  s.connect(hp).connect(g).connect(dryBus); s.start(t); s.stop(t + 0.045);
}

// ─── 스케줄 ─────────────────────────────────────────────────────────
function scheduleStep(absStep, t) {
  const bar = Math.floor(absStep / 16) % BARS;
  const pos = absStep % 16;
  const chord = CHORDS[bar];

  // 드럼/퍼커션
  if (KICK_STEPS.includes(pos)) kick(t, 0.42);
  if (CLAP_STEPS.includes(pos)) clap(t, 0.15);
  if (HAT_STEPS.includes(pos)) shaker(t, pos % 4 === 2 ? 0.075 : 0.045); // 오프비트 악센트
  if (WOOD_STEPS.includes(pos)) woodblock(t, 0.17, pos === 6 ? 1200 : 900);
  // 베이스(바운시)
  BASSLINE.forEach((b) => { if (b.s === pos) bass(mtof(chord.bass + b.rel), t, SEC16 * 1.5, 0.2 * b.v + 0.02); });
  // 피치카토 스탭(오프비트 화음 = "pah")
  if (PIZZ_STEPS.includes(pos)) {
    chord.pad.forEach((m, i) => pizz(mtof(m + 12), t, 0.06, i ? 0.35 : -0.35));
  }
  // 멜로디(마림바)
  MELODY[bar].forEach(([m, s]) => { if (s === pos) mallet(mtof(m), t, 0.22); });
}

function scheduler(myGen) {
  if (!running || myGen !== gen) return;
  // 오디오 포커스 상실·기기 잠금 등으로 ctx가 suspended면 currentTime이 얼어붙어 영영 무음이 된다 → 재개.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  // 탭 백그라운드·화면잠금 등으로 스케줄러가 지연되면 nextTime이 현재시각보다 뒤처진다.
  // 그대로 두면 과거시각 노트가 한꺼번에 울려 "끊김(버스트)"이 되므로 현재시각으로 리싱크.
  if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.03;
  while (nextTime < ctx.currentTime + LOOKAHEAD) {
    scheduleStep(step, nextTime);
    nextTime += SEC16;
    step += 1;
  }
  timer = setTimeout(() => scheduler(myGen), TICK);
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

// 첫 사용자 제스처에서 오디오 언락 — BGM은 자체 ctx라 SFX와 별도로 resume 필요.
function unlockOnGesture() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }

// 탭이 백그라운드로 가면 setTimeout이 1초+로 스로틀되어 BGM이 끊기고, 복귀 시 과거 노트가 몰려 지직거린다.
// → 숨으면 스케줄러만 정지(재생 의도 wantPlaying은 보존), 다시 보이면 자동 재개.
function onVisibility() {
  if (typeof document === 'undefined') return;
  if (document.hidden) {
    _haltScheduler();
  } else if (wantPlaying && !muted) {
    startBgm();
  }
}

// 진입 시 1회 — 음소거 상태만 읽어둠(ctx는 재생 시점에 지연 생성). 제스처 언락·가시성 리스너 등록.
export function initBgm() {
  muted = isBgmMuted();
  try {
    window.addEventListener('pointerdown', unlockOnGesture);
    window.addEventListener('keydown', unlockOnGesture);
    document.addEventListener('visibilitychange', onVisibility);
  } catch { /* noop */ }
}

// 배경음 시작 — 메뉴 화면에서 호출. 음소거면 no-op. 이미 재생 중이면 무시.
export function startBgm() {
  if (muted) return;
  wantPlaying = true;
  // 백그라운드에선 시작해도 즉시 끊기므로 보류 — 다시 보일 때 onVisibility가 재개.
  if (typeof document !== 'undefined' && document.hidden) return;
  const c = ensureCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  if (running) return;
  running = true;
  gen += 1;
  const myGen = gen;
  if (timer) { clearTimeout(timer); timer = null; }
  step = 0;
  nextTime = c.currentTime + 0.1;
  master.gain.cancelScheduledValues(c.currentTime);
  master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), c.currentTime);
  master.gain.linearRampToValueAtTime(MASTER, c.currentTime + 0.9);
  scheduler(myGen);
}

// 스케줄러 중단 + 페이드아웃(재생 의도는 건드리지 않음) — 정지/백그라운드 진입 공용.
function _haltScheduler() {
  if (!ctx || !running) return;
  running = false;
  gen += 1;
  if (timer) { clearTimeout(timer); timer = null; }
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
  master.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
}

// 배경음 정지 — 게임 진입 등에서 호출. 재생 의도를 끄고 스케줄러 중단.
export function stopBgm() {
  wantPlaying = false;
  _haltScheduler();
}
