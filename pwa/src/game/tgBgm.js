// 성조게임 배경음(BGM) — Web Audio 시퀀서 + **실제 악기 샘플**.
// ▶ 음원: FluidR3 GM 사운드폰트를 음별 mp3로 잘라둔 gleitz/midi-js-soundfonts.
//   **CC BY 3.0 — 출처 표기 필수**(게임 설정/링크허브에 크레딧). 곡 자체는 우리가 쓴 시퀀스다.
//   합성으로 기타·피아노를 흉내내면 아무리 만져도 신스 티가 난다(2026-08-09 반복 확인) → 샘플로 전환.
//   4반음 간격으로만 받아(23개·476KB) 그 사이 음은 playbackRate로 ±2반음 시프트한다.
// 스킬 `.claude/skills/game-audio`(opusgamelabs/game-creator, MIT)의 룩어헤드 시퀀서 패턴을 따른다:
//   100ms 앞서 스케줄 + 25ms마다 점검 → 프레임 지터와 무관한 샘플 정확 타이밍.
//
// ▶ 왜 mp3를 버렸나 (2026-08-09)
//   SUNO mp3(menu.mp3)는 3.6MB 다운로드 + 디코딩 20~58MB였다. SNS 유입 깔때기인 게임에서
//   배경음 하나가 첫 로딩을 가장 무겁게 만들고 있었다. 합성으로 바꾸면 둘 다 0이 된다.
//   (이전 신스 엔진 백업: docs/tgBgm.synth.bak.js — 그건 BPM 126 카툰 caper였고, 지금은
//    지금은 게임 이름 '성조다락방'에 맞춰 아기자기한 오르골 톤으로 다시 썼다)
//
// 톤: C장조 · BPM 104 · 스윙 · **기타가 메인 멜로디** + **피아노 반주** + 부-웁 베이스 + 드럼.
//   ※ 멜로디를 기타로 옮기며 **한 옥타브 내렸다**(도4~미5) — 기타 음역을 벗어나면 뜯는 소리가
//     삐 하는 신스가 된다. 오르골은 B섹션 반짝 한 방울로만 남았다.
//   ※ **리프 중심 구성**(2026-08-09). 그 전엔 당김음을 여기저기 뿌려 '정신사납다'는 지적을 받았다 —
//     당김을 늘린 건 밀도지 그루브가 아니다. 그루브는 **귀가 붙잡을 반복 figure**에서 나온다.
//     · **역할 분담**(2026-08-09 사용자): 베이스·퍼커션이 **중심**을 잡고, 리프는 **포인트**만 찍는다.
//       - 바닥: 베이스는 네 박 전부 정박, 킥 1·3박, 우드블록 2·4박, 하이햇 8분. 흔들지 않는다.
//       - 리프: **마디 앞 반절에만** 3음(1박·2박·2박&). 뒷 반절은 비워 바닥과 피아노가 채운다.
//     · ⚠️ **당김음은 반드시 '받쳐줘야' 한다** — 리프만 홀로 어긋난 자리에 놓이면 뜬금없이 들린다.
//       리프의 오프비트(2박&)는 하이햇이 같은 자리를 세게 짚고, 묶음 끝 마디의 밀어주는 음은
//       킥·하이햇·베이스가 **한꺼번에** 같은 스텝을 친다. 그래야 실수가 아니라 의도로 들린다.
//
// ▶ 곡 구조 — **16마디 AABA'**(약 37초). 마디마다 화음·멜로디를 한 묶음(BARS)으로 들고 있어
//   베이스·패드·멜로디가 **항상 같은 화음 위**에 놓인다.
//   ⚠️ 2026-08-09 1차 편곡의 실수: 반복 방지랍시고 베이스를 12스텝 주기로 돌렸는데, 베이스는
//     화성을 떠받치는 줄이라 코드가 바뀌어도 제멋대로 움직여 F 위에 도가 깔리는 식이 됐다.
//     레이어 길이를 어긋내는 기법은 **텍스처에만** 쓸 것 — 베이스·패드엔 절대 쓰지 말 것.
//   진행(2026-08-10 긴장/해소 강화): C–Am–F–G | C–Am–Dm–**G7** | F–**E7**–Am–**G7** | C–Am–F–C
//     · G7 = 딸림7화음(파-시 트라이톤) → C로 끌어당김.  E7 = 부속7화음(솔#) → Am으로 해결.
//     · 다이아토닉만 쓰면 어디로도 안 당겨 밋밋하다 — 긴장은 **화성 밖 음**(파·솔#)에서 나온다.
//     · 여기에 셈여림을 얹는다: B섹션 +12%, 12마디(G7) 뒷반절은 드럼을 빼 숨을 만들고
//       13마디에서 전부 복귀 → 비웠다 채우는 게 가장 확실한 해소다.
//   A(1~4) 훅 제시 → A'(5~8) 같은 훅, 이번엔 으뜸음으로 착지 → B(9~12) 높은 음역 대비
//   → A''(13~16) 훅 재등장 + 종결. 훅이 세 번 돌아오므로 흥얼거릴 수 있다.
//   ※ 멜로디엔 무작위 생략을 걸지 않는다 — 훅 음이 빠지면 곡이 무너진다(텍스처에만 허용).
//   볼륨은 스킬 mixing-guide.md 표(멜로디 0.10~0.18 · 베이스 0.15~0.22 · 텍스처 0.03~0.08)를 지킨다.
// 메뉴 화면에서만 흐르고 게임 중엔 정지. 음소거는 isBgmMuted()/setBgmMuted() ('tg_bgm_muted').
// 사용법: initBgm()(진입 1회) → 메뉴 startBgm() / 게임 진입 stopBgm().

const MASTER = 0.5;         // 배경음 볼륨(SFX·발음을 방해 안 하게)
const FADE_IN = 900;        // ms
const FADE_OUT = 450;       // ms
const DUCK = 0.35;          // 더킹 시 볼륨 = MASTER × DUCK (발음이 또렷하게)
const BPM = 104;            // 통통 튀는 템포 — 귀엽게(가이드: 160+는 정신없음)
const STEPS_PER_BEAT = 4;   // **16분음표** — 그루브는 8분 격자가 아니라 16분의 'e·a' 자리에서 나온다
const BEAT = 60 / BPM;
const STEP = BEAT / STEPS_PER_BEAT;   // 길이는 STEP이 아니라 BEAT 배수로 적는다(격자가 바뀌어도 안 흔들리게)
const LOOKAHEAD = 0.1;      // 스킬 권장: 100ms 앞서 스케줄
const TICK = 25;            // 25ms마다 점검
const SWING = 0.13;         // 16분 뒷자리를 STEP의 13%만큼 늦춘다(16분 스윙은 8분보다 얕게)

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const N = { // 쓰는 음만 — C장조 5음계 + 베이스
  E2: 40, F2: 41, G2: 43, A2: 45, B2: 47,
  C3: 48, D3: 50, E3: 52, F3: 53, G3: 55, A3: 57, B3: 59,
  Ab2: 44, Ab3: 56, Ab4: 68,
  C4: 60, D4: 62, E4: 64, F4: 65, G4: 67, A4: 69, B4: 71,
  C5: 72, D5: 74, E5: 76, F5: 77, G5: 79, A5: 81, B5: 83,
  C6: 84, D6: 86, E6: 88,
};
// ★정렬용 이중 공백이 들어가므로 반드시 \s+ 로 쪼갠다. split(' ')는 빈 토큰을 만들어
//  한 마디가 8스텝을 넘어가고 박자가 통째로 밀린다(2026-08-09에 실제로 그랬다).
const parse = (str) => str.trim().split(/\s+/).map((s) => (s === '~' ? 0 : N[s]));

// ─── 곡 데이터 ────────────────────────────────────────────────────────
// 한 마디 = 8스텝(8분음표 8개, 4/4). 마디마다 기타 보이싱(gtr 4줄)·베이스 루트/5도·멜로디를 함께 들고 있어
// 세 줄이 어긋날 수 없다. mel은 8토큰 고정.
const BAR = 16;   // 한 마디 = 16분음표 16개
const BARS = [
  { gtr: [N.C3, N.E3, N.G3, N.C4], root: N.C3, fifth: N.G3, riff: [N.C4, N.G4, N.E4] },   // A — 제시
  { gtr: [N.A2, N.E3, N.A3, N.C4], root: N.A2, fifth: N.E3, riff: [N.C4, N.A4, N.E4] },
  { gtr: [N.F2, N.C3, N.F3, N.A3], root: N.F2, fifth: N.C3, riff: [N.C4, N.A4, N.F4] },
  { gtr: [N.G2, N.D3, N.G3, N.B3], root: N.G2, fifth: N.D3, riff: [N.D4, N.B4, N.G4] },   // 열린 끝(G)
  { gtr: [N.C3, N.E3, N.G3, N.C4], root: N.C3, fifth: N.G3, riff: [N.C4, N.G4, N.E4] },   // A' — 재제시
  { gtr: [N.A2, N.E3, N.A3, N.C4], root: N.A2, fifth: N.E3, riff: [N.C4, N.A4, N.E4] },
  { gtr: [N.D3, N.F3, N.A3, N.D4], root: N.D3, fifth: N.A3, riff: [N.D4, N.A4, N.F4] },   // Dm으로 살짝 어두워지고
  { gtr: [N.G2, N.D3, N.F3, N.B3], root: N.G2, fifth: N.D3, riff: [N.D4, N.B4, N.F4] },   // G7이 강하게 당김
  { gtr: [N.F2, N.C3, N.F3, N.A3], root: N.F2, fifth: N.C3, riff: [N.C4, N.A4, N.C5] },   // B — 긴장 구간
  { gtr: [N.E2, N.B2, N.E3, N.Ab3], root: N.E2, fifth: N.B2, riff: [N.E4, N.B4, N.E5] },   // E7 = 부속7화음(Am으로 해결)
  { gtr: [N.A2, N.E3, N.A3, N.C4], root: N.A2, fifth: N.E3, riff: [N.C4, N.A4, N.C5] },   // 해결
  { gtr: [N.G2, N.D3, N.F3, N.B3], root: N.G2, fifth: N.D3, riff: [N.D4, N.B4, N.F4] },   // G7 — 최대 긴장
  { gtr: [N.C3, N.E3, N.G3, N.D4], root: N.C3, fifth: N.G3, riff: [N.C4, N.G4, N.E4] },   // A'' — 해소(Cadd9: 레를 얹어 따뜻하게. 컬러 화음은 여기 한 곳만)
  { gtr: [N.A2, N.E3, N.A3, N.C4], root: N.A2, fifth: N.E3, riff: [N.C4, N.A4, N.E4] },
  { gtr: [N.F2, N.C3, N.F3, N.A3], root: N.F2, fifth: N.C3, riff: [N.C4, N.A4, N.F4] },
  { gtr: [N.C3, N.E3, N.G3, N.C4], root: N.C3, fifth: N.G3, riff: [N.C4, N.G4, N.E4],
    // 턴어라운드 — 뒷반절만 G7로 돌려 루프가 매번 '끝났다'로 닫히지 않고 1마디로 밀어준다.
    //  (종지 자료: 완전종지는 최대 종결감 → 반복 루프엔 과하다. 딸림화음으로 '쉼표'를 만든다)
    turn: { gtr: [N.G2, N.D3, N.F3, N.B3], root: N.G2, fifth: N.D3 } },
];
// 리프 리듬(반박자 8스텝 기준) — **정박 2 + 오프비트 1**. 이 뼈대는 곡 내내 그대로 둔다.
//  ⚠️ 당겨 치는 음을 여럿 두면 정신사나워진다(2026-08-09 지적). 밀어치는 자리는 딱 하나.
// 리프 변형 — [스텝, 리프음 번호]. 같은 3음을 마디마다 **다르게 배치**한다.
//  ⚠️ 16마디 내내 같은 자리에서 같은 모양이면 아무리 좋은 리프도 벽지가 된다(2026-08-10 지적).
//  ★모든 배치는 짝수 스텝(=하이햇이 치는 자리)에만 둔다. 하이햇이 안 짚는 자리에 혼자 나오면
//   앞서 지적받은 '뜬금없는 당김음'이 된다.
const R_FULL   = [[0, 0], [4, 1], [6, 2]];            // 기본
const R_SHORT  = [[0, 0], [4, 1]];                    // 뒤를 잘라 숨을 줌
const R_LATE   = [[2, 0], [6, 1]];                    // 한 박 늦게 들어옴(변위)
const R_EXT    = [[0, 0], [4, 1], [6, 2], [10, 1]];   // 뒤로 한 음 더
const R_SPARSE = [[4, 0]];                            // 한 음만
const R_REST   = [];                                  // 쉼 — 베이스·피아노가 자리를 지킨다
// 16마디 배치. 긴장 구간(B)은 촘촘하게, 최대 긴장(12마디 G7)에선 **아예 쉬어** 해소를 준비한다.
const RIFF_PLAN = [
  R_FULL, R_REST,  R_FULL,  R_SHORT,   // A   — 2마디는 비우고 피아노가 답한다
  R_FULL, R_REST,  R_LATE,  R_REST,    // A'  — 8마디(G7)는 기타를 빼 피아노만 남긴다
  R_EXT,  R_FULL,  R_REST,  R_REST,    // B   — 12마디는 완전한 숨(드럼도 비는 구간)
  R_FULL, R_REST,  R_EXT,   R_SPARSE,  // A'' — 마지막은 한 음만(턴어라운드)
];
// 피아노 '답' — **기타가 쉬는 마디에만** 놓는다. 둘이 겹치면 주고받기가 아니라 뭉침이다.
//  전부 그 마디 화음의 코드톤. 뒷 반절(8·10·12)에 둬서 기타 리프와 시간대가 갈린다.
const PIANO_ANS = {
  1:  [[8, N.E4], [12, N.C5]],                 // Am — 상행으로 답
  5:  [[8, N.C5], [10, N.A4], [12, N.E4]],     // Am — 하행
  7:  [[8, N.D5], [12, N.F4]],                 // G7 — 7음(파)으로 긴장을 이어받음
  10: [[8, N.A4], [12, N.C5]],                 // Am — 해결
  13: [[8, N.E4], [10, N.C5], [12, N.A4]],     // Am
  15: [[8, N.G4], [12, N.C5]],                 // C  — 종결
};
const PUSH_STEP = 14;           // 묶음 끝 마디의 밀어주는 음. 킥·하이햇·베이스가 같이 친다.
// 베이스 — 네 박 전부 정박. 바닥은 흔들지 않는다.
const BASS_PAT = 'R ~ ~ ~  5 ~ ~ ~  R ~ ~ ~  5 ~ ~ ~'.trim().split(/\s+/);
const FORM = BARS.length * BAR;                    // 256스텝(16마디) ≈ 37초

// ─── 악기 샘플 ────────────────────────────────────────────────────────
// 4반음 간격 샘플 → 가장 가까운 음을 골라 playbackRate로 시프트(최대 ±2반음).
const SAMPLES = {
  // 기타는 **리드**라 쓰는 음을 전부 받는다 — 피치 시프트를 걸면(±2반음) 어택이 뭉개져 어색해진다.
  //  (2026-08-09: 나일론 4반음 간격 → 스틸 어쿠스틱 전음으로 교체)
  guitar: { dir: 'guitar', notes: {
    40: 'E2', 41: 'F2', 43: 'G2', 44: 'Ab2', 45: 'A2', 47: 'B2',
    48: 'C3', 50: 'D3', 52: 'E3', 53: 'F3', 55: 'G3', 56: 'Ab3', 57: 'A3', 59: 'B3',
    60: 'C4', 62: 'D4', 64: 'E4', 65: 'F4', 67: 'G4', 68: 'Ab4', 69: 'A4', 71: 'B4',
    72: 'C5', 74: 'D5', 76: 'E5' } },
  piano:  { dir: 'piano',  notes: { 52: 'E3', 56: 'Ab3', 60: 'C4', 64: 'E4', 68: 'Ab4', 72: 'C5', 76: 'E5' } },
  bass:   { dir: 'bass',   notes: { 40: 'E2', 44: 'Ab2', 48: 'C3', 52: 'E3', 55: 'G3' } },
};
const PERC = { woodblock: 'woodblock', kick: 'kick' };
// 샘플은 합성음보다 진폭이 훨씬 작다(실측 피크 0.033 vs 0.187) → 악기별 보정.
//  ★볼륨 숫자(0.17 등)는 '음악적 세기'로 계속 읽히게 두고, 물리적 보정은 여기서만 한다.
const BOOST = { guitar: 4.5, piano: 4.5, bass: 5, perc: 3.5 };
const BUF = { guitar: {}, piano: {}, bass: {}, perc: {} };
let samplesReady = false;
let loadingSamples = null;

function loadSamples(ctx) {
  if (samplesReady) return Promise.resolve(true);
  if (loadingSamples) return loadingSamples;
  const one = (url, bag, key) => fetch(url)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('404'))))
    .then((ab) => ctx.decodeAudioData(ab))
    .then((b) => { bag[key] = b; });
  const jobs = [];
  Object.values(SAMPLES).forEach((inst) => {
    Object.entries(inst.notes).forEach(([midi, name]) => {
      jobs.push(one(`/game/inst/${inst.dir}/${name}.mp3`, BUF[inst.dir], +midi));
    });
  });
  Object.entries(PERC).forEach(([key, file]) => {
    jobs.push(one(`/game/inst/perc/${file}.mp3`, BUF.perc, key));
  });
  loadingSamples = Promise.all(jobs)
    .then(() => { samplesReady = true; return true; })
    .catch(() => false)            // 하나라도 실패하면 합성 폴백으로 간다
    .finally(() => { loadingSamples = null; });
  return loadingSamples;
}

// 샘플 한 음 재생 — 가장 가까운 샘플을 골라 피치 시프트 + 볼륨/감쇠 포락선.
function sample(ctx, dest, kind, midi, t, vol, dur) {
  const bag = BUF[kind];
  const keys = Object.keys(SAMPLES[kind].notes).map(Number);
  const near = keys.reduce((a, b) => (Math.abs(b - midi) < Math.abs(a - midi) ? b : a));
  const buf = bag[near];
  if (!buf) return false;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = Math.pow(2, (midi - near) / 12);
  // 기타 톤 셰이핑 — 스틸 기타는 그대로 두면 쨍하다. 고역을 덜고 중저역을 살짝 올려 따뜻하게.
  let head = src;
  if (kind === 'guitar') {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2100; lp.Q.value = 0.4;
    const warm = ctx.createBiquadFilter();
    warm.type = 'peaking'; warm.frequency.value = 260; warm.Q.value = 0.8; warm.gain.value = 3.5;
    src.connect(lp).connect(warm);
    head = warm;
  }
  const a = ctx.createGain();
  const g = vol * BOOST[kind];
  // 어택 — 기타는 피크가 줄을 긁는 순간을 **뭉갠다**(30ms). 날카로움이 사라지고 부드럽게 울린다.
  const atk = kind === 'guitar' ? 0.03 : kind === 'piano' ? 0.008 : 0.004;
  a.gain.setValueAtTime(0.0001, t);
  a.gain.exponentialRampToValueAtTime(g, t + atk);
  //  ★샘플의 자연 감쇠를 최대한 살리고 **끝에서만** 닫는다. 일찍 닫으면(0.6) 뜯은 소리가
  //   중간에 잘려 어색하다 — 실제 줄은 계속 울린다(2026-08-09).
  a.gain.setValueAtTime(g, t + dur * 0.85);
  a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  head.connect(a);
  a.connect(dest);
  // 잔향 send — 기타를 넉넉히, 피아노는 살짝. 베이스는 보내지 않는다.
  const send = kind === 'guitar' ? 0.42 : kind === 'piano' ? 0.2 : 0;
  if (send && wet) {
    const sg = ctx.createGain();
    sg.gain.value = send;
    a.connect(sg).connect(wet);
  }
  src.start(t); src.stop(t + dur + 0.05);
  return true;
}
// 타악기 원샷 — 피치 시프트로 음색을 조금 바꾼다(rate>1 = 밝고 짧게).
function percHit(ctx, dest, key, t, vol, rate = 1) {
  const buf = BUF.perc[key];
  if (!buf) return false;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const a = ctx.createGain();
  a.gain.setValueAtTime(vol * BOOST.perc, t);
  src.connect(a).connect(dest);
  src.start(t); src.stop(t + buf.duration / rate + 0.02);
  return true;
}

// ─── 신스 보이스(샘플 로드 실패 시 폴백) ──────────────────────────────
// 공용 노이즈(기타 피크·하이햇) — 한 번 만들어 재사용.
//  ★0.8초로 길게 잡는다: 하이햇이 **매번 다른 구간**을 재생해야 한다(아래 이유 참고).
let noiseBuf = null;
function ensureNoise(ctx) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.8), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 오르골 — 비정수 배음을 섞어 '띵' 하는 종소리 색. 마림바보다 맑고 귀엽다.
function mallet(ctx, dest, freq, t, vol, dur) {
  [[1, 1], [2.01, 0.3], [3.94, 0.12], [5.4, 0.05]].forEach(([mul, g]) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * mul, t);
    const a = ctx.createGain();
    a.gain.setValueAtTime(0.0001, t);
    a.gain.exponentialRampToValueAtTime(vol * g, t + 0.008);   // 툭 치는 어택
    a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(a).connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  });
}
// 피아노 — 해머로 때린 뒤 길게 울리는 소리. 배음을 정수배로 쌓고(오르골의 비정수 배음과 반대)
//  타건 순간만 밝았다가 금세 어두워지게 필터를 닫는다. 반주로 뒤에 깔릴 만큼만 얇게.
function piano(ctx, dest, freq, t, vol, dur) {
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(Math.min(6000, freq * 7), t);
  f.frequency.exponentialRampToValueAtTime(Math.max(400, freq * 2.2), t + dur * 0.5);
  const a = ctx.createGain();
  a.gain.setValueAtTime(0.0001, t);
  a.gain.exponentialRampToValueAtTime(vol, t + 0.006);      // 타건 = 빠른 어택
  a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  f.connect(a).connect(dest);
  [[1, 1], [2, 0.34], [3, 0.11], [4, 0.05]].forEach(([mul, g]) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * mul, t);
    const og = ctx.createGain(); og.gain.value = g;
    o.connect(og).connect(f);
    o.start(t); o.stop(t + dur + 0.03);
  });
}
// 기타 한 줄 뜯기 — 샘플 없이 뜯는 소리를 만든다.
//  ⚠️ 2026-08-09 1차 시도가 "깨지고 노이즈가 심하다"는 지적을 받은 원인 3가지와 대응:
//   ①피크 노이즈를 볼륨의 50%나 광대역(하이패스)으로 넣어 4줄이 겹치면 히스가 됐다
//     → 밴드패스 '틱'으로 바꾸고 12%로 낮춤. 노이즈는 존재를 알리는 정도면 충분하다.
//   ②로우패스 컷오프를 3200Hz로 **고정**해서 낮은 줄(도3=130Hz)은 배음이 다 살아 톱니가 그대로
//     드러나 웅웅댔다 → **컷오프가 음정을 따라가게**(freq 배수). 이게 기타다움의 핵심 레버다.
//   ③몸통을 톱니 위주로 써서 거칠었다 → **삼각파 위주 + 톱니는 22%만** 섞어 배음의 각을 죽임.
function pluck(ctx, dest, freq, t, vol, dur) {
  const open = Math.min(5200, freq * 9);      // 뜯는 순간의 밝기
  const close = Math.max(320, freq * 2.6);    // 감쇠 후 남는 음색
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(open, t);
  f.frequency.exponentialRampToValueAtTime(close, t + dur * 0.55);
  f.Q.value = 0.5;                            // Q가 높으면 '삐' 하는 링잉이 노이즈로 들린다
  const a = ctx.createGain();
  a.gain.setValueAtTime(0.0001, t);
  a.gain.exponentialRampToValueAtTime(vol, t + 0.012);   // 12ms — 4ms는 딸깍 클릭이 났다
  a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  f.connect(a).connect(dest);
  [['triangle', 1, -4], ['sawtooth', 0.22, 5]].forEach(([type, g, cents]) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq * Math.pow(2, cents / 1200), t);
    const og = ctx.createGain();
    og.gain.value = g;
    o.connect(og).connect(f);
    o.start(t); o.stop(t + dur + 0.05);
  });
  // 피크 — 밴드패스 '틱'. 광대역이면 히스로 들린다.
  const n = ctx.createBufferSource(); n.buffer = ensureNoise(ctx);
  const nf = ctx.createBiquadFilter();
  nf.type = 'bandpass'; nf.frequency.setValueAtTime(1800, t); nf.Q.value = 1.2;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(vol * 0.12, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
  n.connect(nf).connect(ng).connect(dest);
  n.start(t); n.stop(t + 0.03);
}
// 스트럼 — 줄을 동시에 치지 않고 아래→위(다운) 또는 위→아래(업)로 훑는다.
//  줄 사이 지연(STRUM_MS)이 스트럼의 정체다. 없으면 그냥 화음이 '뿅' 하고 만다.
const STRUM_MS = 0.034;   // 줄 사이 간격 — 16ms는 뭉쳐 들려서 28ms로(2026-08-09 사용자)
function strum(ctx, dest, notes, t, vol, dur, up = false) {
  const order = up ? [...notes].reverse() : notes;   // 다운=낮은 줄부터, 업=높은 줄부터
  order.forEach((m, k) => {
    // 업스트로크는 높은 줄만 가볍게 스치는 게 자연스럽다
    const v = up ? vol * (0.5 + k * 0.12) : vol * (1 - k * 0.08);
    pluck(ctx, dest, mtof(m), t + k * STRUM_MS, v, dur);
  });
}
// 베이스 — 만화풍 '부-웁'. 살짝 위에서 떨어뜨려 통통 튀는 느낌을 준다.
function bass(ctx, dest, freq, t, vol, dur) {
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(freq * 1.32, t);
  o.frequency.exponentialRampToValueAtTime(freq, t + 0.05);   // 피치 드롭 = 바운스
  const a = ctx.createGain();
  a.gain.setValueAtTime(0.0001, t);
  a.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(a).connect(dest);
  o.start(t); o.stop(t + dur + 0.02);
}
// 우드블록 — 짧게 '똑'. 셰이커보다 만화적이라 귀여운 리듬에 맞는다.
function woodblock(ctx, dest, t, vol) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(1100, t);
  o.frequency.exponentialRampToValueAtTime(560, t + 0.03);
  const a = ctx.createGain();
  a.gain.setValueAtTime(vol, t);
  a.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  o.connect(a).connect(dest);
  o.start(t); o.stop(t + 0.08);
}
// 킥 — 낮은 사인의 피치 드롭. 박을 잡아주되 쿵쿵대지 않게 짧게.
function kick(ctx, dest, t, vol) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(115, t);
  o.frequency.exponentialRampToValueAtTime(46, t + 0.06);
  const a = ctx.createGain();
  a.gain.setValueAtTime(vol, t);
  a.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  o.connect(a).connect(dest);
  o.start(t); o.stop(t + 0.2);
}
// 하이햇 — '치' 하는 닫힌 하이햇.
//  ⚠️ 2026-08-09 "정전기 튀는 소리 같다"는 지적의 원인 3가지와 대응:
//   ①7500Hz 하이패스만 걸어 몸통 없는 고역 히스였다 → **6k~11k 대역으로 묶어** 금속 울림처럼.
//   ②게인을 순간 최대값으로 세워 광대역 클릭이 났다 → 1.5ms 어택 램프로 모서리를 없앰.
//   ③**매번 노이즈 버퍼의 같은 앞부분을 재생**했다. 초당 7번 동일 파형이 반복되면 잡음이 아니라
//     주기적인 버즈로 들린다 → 재생 시작 위치를 매번 무작위로(가장 큰 원인).
function hat(ctx, dest, t, vol) {
  const buf = ensureNoise(ctx);
  const s = ctx.createBufferSource();
  s.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.setValueAtTime(6000, t); hp.Q.value = 0.7;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(11000, t); lp.Q.value = 0.7;
  const a = ctx.createGain();
  const dur = 0.028 + Math.random() * 0.012;            // 길이도 조금씩 달라야 기계적이지 않다
  a.gain.setValueAtTime(0.0001, t);
  a.gain.linearRampToValueAtTime(vol, t + 0.0015);      // 짧지만 램프 — 클릭 제거
  a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(hp).connect(lp).connect(a).connect(dest);
  const off = Math.random() * (buf.duration - 0.1);     // ★매번 다른 구간
  s.start(t, off); s.stop(t + dur + 0.02);
}

// ─── 상태 ─────────────────────────────────────────────────────────────
let actx = null;
let gain = null;            // 마스터 게인(페이드·더킹·음소거 전부 여기서)
let reverb = null;          // 잔향(컨볼버)
let wet = null;             // 잔향으로 보내는 입구
let muted = false;
let wantPlaying = false;
let ducked = false;
let duckReleaseT = null;
let timerId = null;
let stepIndex = 0;          // 곡 진행 위치 — 정지해도 보존해 '이어 듣기'
let nextStepTime = 0;
let running = false;

function ensureCtx() {
  if (actx) return actx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
    gain = actx.createGain();
    gain.gain.value = 0;
    // 헤드룸 안전망 — 기타 4줄 + 멜로디 + 베이스 + 드럼이 겹치면 피크가 넘쳐 찌그러진다.
    //  믹서로 쓰는 게 아니라 넘칠 때만 잡아주는 용도(스킬 mixing-guide.md).
    // ── 잔향(리버브) ── 임펄스 응답을 코드로 만든다(파일 0KB).
    //  지수 감쇠 노이즈 = 방의 잔향. 기타·피아노만 여기로 보내(send) 부드럽게 울리게 하고,
    //  베이스·킥은 보내지 않는다 — 저역이 잔향에 뭉개지면 바닥이 흐려진다.
    const RT = 1.6;                                   // 잔향 길이(초)
    const ir = actx.createBuffer(2, Math.floor(actx.sampleRate * RT), actx.sampleRate);
    for (let ch = 0; ch < 2; ch += 1) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < d.length; i += 1) {
        const k = i / d.length;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, 2.6);   // 뒤로 갈수록 조용해짐
      }
    }
    reverb = actx.createConvolver();
    reverb.buffer = ir;
    const rvHp = actx.createBiquadFilter();            // 잔향의 저역은 잘라 탁해지지 않게
    rvHp.type = 'highpass'; rvHp.frequency.value = 350;
    wet = actx.createGain();
    wet.gain.value = 1;
    wet.connect(rvHp).connect(reverb);

    const comp = actx.createDynamicsCompressor();
    //  ★임계값을 낮게(-14dB) 두면 평상 피크(0.26)에서도 계속 눌러 뜯는 어택이 뭉갠다.
    //   실측 피크가 0.26이므로 -6dB(≈0.5)로 올려 **넘칠 때만** 걸리게 한다.
    comp.threshold.value = -6;
    comp.knee.value = 6;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    reverb.connect(gain);                              // 잔향도 마스터(페이드·더킹) 아래로
    gain.connect(comp).connect(actx.destination);
  } catch { actx = null; gain = null; }
  return actx;
}

// ── 연주 래퍼 — 샘플이 준비됐으면 샘플, 아니면 합성으로 폴백 ──
const vGuitar = (ctx, d, midi, t, vol, dur) => { if (!sample(ctx, d, 'guitar', midi, t, vol, dur)) pluck(ctx, d, mtof(midi), t, vol, dur); };
const vPiano  = (ctx, d, midi, t, vol, dur) => { if (!sample(ctx, d, 'piano',  midi, t, vol, dur)) piano(ctx, d, mtof(midi), t, vol, dur); };
const vBass   = (ctx, d, midi, t, vol, dur) => { if (!sample(ctx, d, 'bass',   midi, t, vol, dur)) bass(ctx, d, mtof(midi), t, vol, dur); };
const vWood   = (ctx, d, t, vol) => { if (!percHit(ctx, d, 'woodblock', t, vol * 1.6)) woodblock(ctx, d, t, vol); };
const vKick   = (ctx, d, t, vol) => { if (!percHit(ctx, d, 'kick', t, vol * 1.4, 1.35)) kick(ctx, d, t, vol); };
// 스트럼도 샘플 기타로 — 줄 사이 간격은 그대로.
function strumS(ctx, dest, notes, t, vol, dur, up = false) {
  const order = up ? [...notes].reverse() : notes;
  order.forEach((m, k) => {
    const v = up ? vol * (0.5 + k * 0.12) : vol * (1 - k * 0.08);
    vGuitar(ctx, dest, m, t + k * STRUM_MS, v, dur);
  });
}

// 4마디 묶음의 마지막 마디 = 필(fill).
const isFill = (b) => b % 4 === 3;

// 한 스텝 분량을 스케줄. t0는 '정박' 시각 — 16분 뒷자리면 스윙만큼 늦춰 연주한다.
function scheduleStep(t0, idx) {
  const ctx = actx;
  const i = idx % FORM;
  const barIdx = Math.floor(i / BAR);
  const st = i % BAR;                                  // 0~15
  const t = (st % 2 === 1) ? t0 + STEP * SWING : t0;   // 16분 스윙
  const barDef = BARS[barIdx];
  //  turn이 있는 마디는 뒷반절(8스텝~)부터 화음이 바뀐다 — 턴어라운드용
  const bar = (barDef.turn && st >= 8) ? { ...barDef, ...barDef.turn } : barDef;
  const sect = Math.floor(barIdx / 4);
  const fill = isFill(barIdx);
  const onBeat = st % 4 === 0;
  //  미는 자리는 A·A' 끝(4·8마디)에만. 12마디는 '숨' 구간이라 밀면 숨이 죽고,
  //  16마디는 곡을 닫는 자리라 밀면 끝맺음이 안 된다.
  const push = st === PUSH_STEP && (barIdx === 3 || barIdx === 7);
  // ── 셈여림 ── B섹션(긴장 구간)은 조금 세게. 12마디(G7) 뒷반절은 드럼을 비워 숨을 만든다
  //  → 13마디에서 전부 복귀하며 해소된다. 비웠다 채우는 게 가장 확실한 긴장/해소다.
  const dyn = sect === 2 ? 1.12 : 1;
  const breath = barIdx === 11 && st >= 8;             // 해소 직전의 '숨'

  // ── 바닥 ① 베이스: 네 박 정박. 곡의 중심. ──
  const bp = BASS_PAT[st];
  if (bp !== '~') vBass(ctx, gain, bp === 'R' ? bar.root : bar.fifth, t, 0.22 * dyn, BEAT * 0.6);
  if (push) vBass(ctx, gain, bar.root, t, 0.18, BEAT * 0.9);   // 미는 음 — 받쳐주는 층 ①
  // 접근음 — 마디 끝에서 다음 마디 루트로 반음/온음 다가간다. 베이스가 정박에만 있으면
  //  바닥이 굳는다(그루브 자료: 정박 정렬 후 오프비트 움직임을 더할 것).
  //  하이햇이 쉬는 자리(14)라 베이스가 그 빈틈을 메워 이음새가 매끄러워진다.
  if (st === 14 && !push) {
    const nx = BARS[(barIdx + 1) % BARS.length];
    const nextRoot = nx.root;
    if (nextRoot !== bar.root) {
      const app = nextRoot + (nextRoot > bar.root ? -2 : 2);
      vBass(ctx, gain, app, t, 0.12, BEAT * 0.45);
    }
  }

  // ── 바닥 ② 드럼: 킥 1·3박 / 우드블록 2·4박 / 하이햇 8분 ──
  if ((st === 0 || st === 8) && !breath) vKick(ctx, gain, t, 0.18 * dyn);
  if (push) vKick(ctx, gain, t, 0.15);                               // 미는 음 — 받쳐주는 층 ②
  if ((st === 4 || st === 12) && !breath) vWood(ctx, gain, t, 0.05 * dyn);
  if (st % 2 === 0) {
    // 리프가 어긋난 자리(2박&)를 하이햇이 **세게** 짚어준다 → 당김이 의도로 들린다
    //  ★'숨' 구간에서도 하이햇은 남긴다 — 전부 빼면 숨이 아니라 정지로 들린다(2026-08-10).
    const accent = onBeat || st === 6;
    // 14번 스텝(4박&)은 **쉰다** — 8분음표를 끝까지 채우면 기계적으로 들린다(그루브 진단).
    //  단, 미는 자리(push)일 땐 그 자리를 짚어줘야 하므로 예외.
    if (st !== 14 || push) hat(ctx, gain, t, (accent ? 0.032 : 0.02) * dyn * (breath ? 0.45 : 1));
  } else if (push) {
    hat(ctx, gain, t, 0.03);                                        // 미는 음 — 받쳐주는 층 ③
  }

  // ── 포인트: 리프(기타) — 마디마다 다른 변형 ──
  const plan = RIFF_PLAN[barIdx];
  for (let q = 0; q < plan.length; q += 1) {
    if (plan[q][0] !== st) continue;
    const ri = plan[q][1];
    // 앵커(0번 음)는 길고 세게 깔고, 도약(1)·착지(2)는 짧게 얹는다.
    //  세 음이 같은 길이면 리듬이 밋밋해 기억에 안 남는다(music-composition 진단).
    const anchor = ri === 0;
    vGuitar(ctx, gain, bar.riff[ri], t, (anchor ? 0.17 : 0.145) * dyn, BEAT * (anchor ? 3.6 : 1.7));
  }
  //  ⚠️ 미는 음을 0.5박짜리 토막으로 두면 마디 끝에서 '툭' 끊긴다(2026-08-10 지적).
  //   당김의 목적은 **다음 마디로 넘기는 것**이라 반드시 마디선을 넘어 울려야 한다.
  if (push) vGuitar(ctx, gain, bar.riff[0], t, 0.15, BEAT * 2.4);

  // ── 기타 스트럼: 마디 첫박만 ──
  // 스트럼 — 4마디 묶음의 첫 마디에만. 매 마디 치면 리프가 묻힌다.
  //  편곡 자료: '한 파트는 리듬, 한 파트는 지속, 한 파트는 멜로디'. 지속층이 없어서
  //  스트럼을 마디 전체로 늘려(4.6박) 잔향과 함께 배경을 채우게 한다.
  if (st === 0 && barIdx % 4 === 0) strumS(ctx, gain, bar.gtr, t, 0.038, BEAT * 4.6);

  // ── 피아노: **기타가 쉬는 마디에서만** 답한다(주고받기) ──
  //  같은 마디에 둘 다 넣으면 주고받기가 아니라 뭉침이다.
  const ans = PIANO_ANS[barIdx];
  if (ans) {
    for (let q = 0; q < ans.length; q += 1) {
      if (ans[q][0] === st) vPiano(ctx, gain, ans[q][1], t, 0.13 * dyn, BEAT * 1.6);
    }
  }
}

function tick() {
  if (!running || !actx) return;
  // 탭이 백그라운드였다 돌아오면 커서가 한참 뒤처져 있다 → 몰아서 스케줄하지 말고 현재로 리셋
  if (nextStepTime < actx.currentTime) nextStepTime = actx.currentTime + 0.05;
  while (nextStepTime < actx.currentTime + LOOKAHEAD) {
    scheduleStep(nextStepTime, stepIndex);
    stepIndex += 1;
    nextStepTime += STEP;
  }
  timerId = setTimeout(tick, TICK);
}

function rampTo(target, ms) {
  if (!gain || !actx) return;
  const now = actx.currentTime;
  try {
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(target, now + Math.max(0.001, ms / 1000));
  } catch { /* noop */ }
}

const targetVol = () => (ducked ? MASTER * DUCK : MASTER);

function startSeq() {
  if (running || !ensureCtx()) return;
  running = true;
  nextStepTime = actx.currentTime + 0.05;
  tick();
}
function stopSeq() {
  running = false;
  if (timerId) { clearTimeout(timerId); timerId = null; }
}

function tryPlay() {
  const c = ensureCtx();
  if (!c) return;
  if (c.state !== 'running') c.resume().catch(() => {}); // 언락(suspended/iOS 'interrupted')
  // 악기 샘플(476KB)을 받아 디코딩한 뒤 시작 — 다 받기 전에 시작하면 합성 소리로 몇 마디가 나간다.
  //  실패하면 samplesReady가 false로 남아 합성 폴백으로 그대로 연주된다.
  loadSamples(c).then(() => {
    if (!wantPlaying || muted) return;
    startSeq();
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
  if (wantPlaying && !muted && !running
    && !(typeof document !== 'undefined' && document.hidden)) tryPlay();
}
// 탭 백그라운드 → 컨텍스트 정지(스케줄러도 멈춤), 복귀 시 재개.
function onVisibility() {
  if (typeof document === 'undefined' || !actx) return;
  if (document.hidden) {
    stopSeq();
    if (actx.state === 'running') actx.suspend().catch(() => {});
  } else if (wantPlaying && !muted) tryPlay();
}

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
  if (typeof document !== 'undefined' && document.hidden) return; // 백그라운드면 보류
  tryPlay();
}

// 배경음 정지 — 게임 진입·화면전환 등. 페이드아웃 뒤 스케줄러 정지.
//  stepIndex는 그대로 둬서 다시 켜면 곡이 이어진다(처음부터 다시 시작하지 않음).
export function stopBgm() {
  wantPlaying = false;
  rampTo(0, FADE_OUT);
  if (timerId) { clearTimeout(timerId); timerId = null; }
  // 이미 스케줄된 꼬리(길어야 패드 1악구)가 페이드아웃 뒤 조용히 끝나도록 잠깐 뒤 멈춘다
  setTimeout(() => { if (!wantPlaying) stopSeq(); }, FADE_OUT + 60);
}

// ── 더킹 — 발음(TTS)이 나올 때 BGM을 잠깐 낮춰 또렷하게 ──
function applyDuckVolume() {
  if (!running || muted) return;
  rampTo(targetVol(), ducked ? 140 : 420); // 내릴 땐 빠르게, 복귀는 부드럽게
}
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
