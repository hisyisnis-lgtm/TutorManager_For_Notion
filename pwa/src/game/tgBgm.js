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
  { gtr: [N.C3, N.E3, N.G3, N.C4], root: N.C3, fifth: N.G3, riff: [N.C4, N.G4, N.E4] },   // 16 C
  // ── C 섹션(17~20): 브레이크다운 ── 드럼을 빼고 기타·베이스만. 긴 루프가 늘어지지 않으려면
  //  '한 번 비우는' 구간이 필요하다. 상대단조(Am)에서 시작해 밝아지며 돌아온다.
  { gtr: [N.A2, N.E3, N.A3, N.C4], root: N.A2, fifth: N.E3, riff: [N.C4, N.A4, N.E4] },   // 17 Am
  { gtr: [N.F2, N.C3, N.F3, N.A3], root: N.F2, fifth: N.C3, riff: [N.C4, N.A4, N.F4] },   // 18 F
  { gtr: [N.C3, N.E3, N.G3, N.C4], root: N.C3, fifth: N.G3, riff: [N.C4, N.G4, N.E4] },   // 19 C
  { gtr: [N.G2, N.D3, N.G3, N.B3], root: N.G2, fifth: N.D3, riff: [N.D4, N.B4, N.G4] },   // 20 G  복귀 준비
  // ── 최종 재현(21~24) ── 전부 복귀 후 종결
  { gtr: [N.C3, N.E3, N.G3, N.D4], root: N.C3, fifth: N.G3, riff: [N.C4, N.G4, N.E4] },   // 21 Cadd9 복귀
  { gtr: [N.A2, N.E3, N.A3, N.C4], root: N.A2, fifth: N.E3, riff: [N.C4, N.A4, N.E4] },   // 22 Am
  { gtr: [N.F2, N.C3, N.F3, N.A3], root: N.F2, fifth: N.C3, riff: [N.C4, N.A4, N.F4] },   // 23 F
  { gtr: [N.C3, N.E3, N.G3, N.C4], root: N.C3, fifth: N.G3, riff: [N.C4, N.G4, N.E4],
    // 턴어라운드 — 뒷반절만 G7로 돌려 루프가 매번 '끝났다'로 닫히지 않고 1마디로 밀어준다.
    turn: { gtr: [N.G2, N.D3, N.F3, N.B3], root: N.G2, fifth: N.D3 } },                    // 24 C→G7
];
// 리프 리듬(반박자 8스텝 기준) — **정박 2 + 오프비트 1**. 이 뼈대는 곡 내내 그대로 둔다.
//  ⚠️ 당겨 치는 음을 여럿 두면 정신사나워진다(2026-08-09 지적). 밀어치는 자리는 딱 하나.
// ── 멜로디 = 4마디 **악구**(2026-08-10 재작성) ─────────────────────────
//  ⚠️ 그 전엔 마디마다 '리프 3음'만 찍고 뒷 반절은 침묵이었다. 그래서 선율이 아니라 도장 16개였고
//   "의미없이 끊긴다"는 지적이 나왔다. 악구 문서 진단 그대로:
//   "멜로디가 미완성처럼 들리면 대개 악구 구조 문제" — 악구의 3요소 ①내적 응집 ②종지로 닫기
//   ③호흡 중 **닫는 지점**이 통째로 없었다.
//
//  구조: 8마디 대악절 두 개. 앞악구(열고) + 뒷악구(같은 동기로 시작해 닫기 = parallel period).
//   1~4  앞악구 — 동기 제시, 4마디 끝은 **열어둔다**(반종지)
//   5~8  뒷악구 — 같은 시작, 8마디에서 **으뜸음으로 닫는다**
//   9~12 B      — 대비 악구, 10마디에 정점(미5), 12마디는 숨
//   13~16 재현  — 앞악구 회귀 + 종결
//  ★배치는 전부 짝수 스텝(하이햇이 짚는 자리). 홀수에 홀로 두면 '뜬금없는 당김음'이 된다.
//  ★마지막 음을 8스텝 이후에 둬서 **마디를 넘어 이어지게** 한다 — 이게 없으면 다시 도장이 된다.
const PHRASE = [
  // 앞악구(1~4): 열기
  [[0, N.C4], [4, N.G4], [6, N.E4], [10, N.G4], [14, N.A4]],   // 1  C   동기 제시
  [[0, N.C5], [4, N.A4], [8, N.E4], [12, N.C4]],                // 2  Am  정점 찍고 하강(응답)
  [[0, N.A4], [4, N.F4], [6, N.A4], [10, N.C5], [14, N.A4]],    // 3  F   다시 상행
  [[0, N.B4], [4, N.G4], [8, N.D4], [12, N.G4]],                // 4  G   열린 채 멈춤(반종지)
  // 뒷악구(5~8): 같은 동기로 시작해 닫기
  [[0, N.C4], [2, N.E4], [4, N.G4], [6, N.E4], [10, N.A4], [14, N.G4]],  // 5  C  **장식**(10번) — 지나가는 음을 끼우고 끝 두 음을 뒤집었다
  [[0, N.B4], [4, N.A4], [8, N.E4], [12, N.G4]],                // 6  Am **순차진행**(2번) — 2마디를 한 음 아래로. 9도(시)로 열고 근음(라)에 착지
  [[0, N.A4], [4, N.F4], [8, N.D4], [12, N.F4]],                // 7  Dm  어두워지며 하강
  [[0, N.D4], [4, N.F4], [8, N.D4], [12, N.B4]],                // 8  G7  전부 G7 코드톤. 끝을 **이끔음(시)**로
  //   ↑ 여기서 '도'로 닫으면 딸림7 위에 해결 안 된 4도가 남는다. 8마디는 닫는 자리가 아니라
  //     B로 밀어주는 자리 — 열어두는 게 맞다(실제 종결은 16마디).
  // B(9~12): 대비 악구
  [[0, N.C5], [4, N.A4], [6, N.C5], [10, N.F4], [14, N.A4]],    // 9  F
  [[0, N.B4], [4, N.E5], [8, N.B4], [12, N.Ab4]],               // 10 E7  정점(미5) + 긴장음(솔#)
  [[0, N.A4], [4, N.C5], [6, N.A4], [10, N.E4], [14, N.C4]],    // 11 Am  해결하며 하강
  [],                                                            // 12 G7  숨(드럼도 비는 구간)
  // 재현(13~16)
  [[0, N.C4], [4, N.G4], [12, N.E4]],                           // 13 C  **확대**(6번) — 같은 음을 절반 개수로 길게. 해소 지점이라 무겁게
  [[0, N.E4], [4, N.C5], [8, N.A4], [12, N.E4]],                // 14 Am **반행**(3번) — 2마디의 하행을 뒤집어 위로 뻗었다 내려온다
  [[0, N.A4], [4, N.F4], [8, N.G4], [12, N.E4]],                // 15 F
  [[0, N.D4], [4, N.E4], [8, N.C4]],                            // 16 C   여백을 두고 C섹션으로
  // C 섹션(17~20) — 브레이크다운. 성글게, 낮은 음역에서 조용히.
  [[0, N.E4], [6, N.C4], [12, N.A4]],                           // 17 Am
  [[0, N.F4], [6, N.A4], [12, N.C5]],                           // 18 F
  [[0, N.G4], [4, N.E4], [8, N.C4], [12, N.G4]],                // 19 C
  [[0, N.D4], [6, N.G4], [12, N.B4]],                           // 20 G  **확대**(6번) — 4마디를 성글게 뒤집어 상행. 복귀 직전의 들숨
  // 최종 재현(21~24)
  [[0, N.C5], [4, N.G4], [6, N.E4], [8, N.C4], [12, N.E4], [14, N.G4]],  // 21 C  **옥타브 전위 + 단편화**(7번) — 위에서 떨어져 동기 앞부분을 되풀이
  [[0, N.E4], [4, N.A4], [8, N.C5], [12, N.A4]],                // 22 Am **반행**(3번) — 14마디의 하행을 뒤집어 상행으로
  [[0, N.A4], [2, N.C5], [4, N.F4], [8, N.A4], [12, N.F4]],     // 23 F  **장식**(10번) — 15마디에 지나가는 음을 얹어 마지막을 조금 화려하게
  [[0, N.D4], [4, N.E4], [8, N.C4]],                            // 24 C   으뜸음으로 닫고 여백
];
// 피아노 = **화음 반주**(2026-08-10 재정의).
//  ⚠️ 원래는 기타가 쉬는 마디에서 '답'하는 역할이었는데, 멜로디를 악구로 바꾸며 기타가 전 마디를
//   채우게 되자 같은 자리에서 부딪혔다(6마디·9군데). 주고받기가 아니라 뭉침이 된다.
//   → 멜로디는 기타가 갖고, 피아노는 **화음을 얇게 받쳐주는 층**으로 되돌린다.
const PIANO_STEPS = [2, 10];   // 1박a·3박a — 정박을 피해 들어가는 컴핑의 기본 자리
const PUSH_STEP = 14;           // 묶음 끝 마디의 밀어주는 음. 킥·하이햇·베이스가 같이 친다.
// 베이스 — 네 박 전부 정박. 바닥은 흔들지 않는다.
const BASS_PAT = 'R ~ ~ ~  5 ~ ~ ~  R ~ ~ ~  5 ~ ~ ~'.trim().split(/\s+/);
const FORM = BARS.length * BAR;                    // 384스텝(24마디) ≈ 55초 (+ 앞에 인트로 2마디)

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
function sample(ctx, dest, kind, midi, t, vol, dur, opt) {
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
    //  ★컷오프 4200Hz — 픽이 줄을 긁는 소리는 3~6kHz에 있다. 2100Hz로 자르면 알갱이가
    //   통째로 사라져 뭉갠 소리가 된다. 롤에만 열어뒀더니 그 톤이 더 낫다고 해서
    //   기타 전체 기본값으로 올렸다(2026-08-10). 따뜻함은 컷오프가 아니라 아래 260Hz 부스트가 만든다.
    lp.type = 'lowpass'; lp.frequency.value = (opt && opt.cut) || 4200; lp.Q.value = 0.4;
    const warm = ctx.createBiquadFilter();
    //  컷오프를 2100→4200으로 열어 고역이 늘었으므로 중저역을 조금 더 올려 균형을 잡는다.
    warm.type = 'peaking'; warm.frequency.value = 260; warm.Q.value = 0.8; warm.gain.value = 4.5;
    src.connect(lp).connect(warm);
    head = warm;
  }
  const a = ctx.createGain();
  const g = vol * BOOST[kind];
  // 어택 — 기타는 피크가 줄을 긁는 순간을 **뭉갠다**(30ms). 날카로움이 사라지고 부드럽게 울린다.
  //  ★어택 8ms — 30ms는 피크가 줄을 긁는 순간을 뭉개서 '뜯었다'가 아니라 '차올랐다'로 들린다.
  //   롤(6ms)에서 그 알갱이가 살아난 게 더 낫다고 해서 기본값도 같은 계열로 내렸다(2026-08-10).
  const atk = (opt && opt.atk) || (kind === 'guitar' ? 0.008 : kind === 'piano' ? 0.008 : 0.004);
  a.gain.setValueAtTime(0.0001, t);
  a.gain.exponentialRampToValueAtTime(g, t + atk);
  //  ★샘플의 자연 감쇠를 최대한 살리고 **끝에서만** 닫는다. 일찍 닫으면(0.6) 뜯은 소리가
  //   중간에 잘려 어색하다 — 실제 줄은 계속 울린다(2026-08-09).
  //  ★릴리스 — dur는 '온전히 울리는 시간', 그 뒤 **긴 꼬리**로 잦아든다. dur에서 딱 닫으면
  //   음이 매번 툭 끊긴다("의미없이 끊긴다", 2026-08-10). 실제 줄·건반은 스스로 잦아든다.
  //   베이스만 꼬리를 짧게 — 길면 다음 근음과 겹쳐 저역이 탁해진다.
  const rel = kind === 'bass' ? 0.28 : 0.95;
  a.gain.setValueAtTime(g, t + dur);
  a.gain.linearRampToValueAtTime(0.0001, t + dur + rel);
  head.connect(a);
  a.connect(dest);
  // 잔향 send — 기타를 넉넉히, 피아노는 살짝. 베이스는 보내지 않는다.
  const send = kind === 'guitar' ? 0.42 : kind === 'piano' ? 0.2 : 0;
  if (send && wet) {
    const sg = ctx.createGain();
    sg.gain.value = send;
    a.connect(sg).connect(wet);
  }
  src.start(t); src.stop(t + dur + rel + 0.05);
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
let stepIndex = 0;          // 곡 진행 위치 — 0이면 인트로부터
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
const vGuitar = (ctx, d, midi, t, vol, dur, opt) => { if (!sample(ctx, d, 'guitar', midi, t, vol, dur, opt)) pluck(ctx, d, mtof(midi), t, vol, dur); };
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

// 롤 스트럼("다라라랑") — 줄을 **하나씩 들리게** 천천히 훑어 올린다.
//  일반 스트럼(34ms×4줄 ≈ 100ms)은 화음처럼 뭉쳐 들린다. 롤은 간격을 벌리고 줄 수를 늘려
//  '다-라-라-랑' 하고 굴러가는 소리를 만든다. 악구 첫머리·복귀 지점의 구두점으로만 쓴다.
//  간격 58ms × 5칸 = 290ms = 정확히 16분음표 2칸. 앞꾸밈으로 치면 맨 윗줄이 강박에 딱 착지한다.
const ROLL_MS = 0.058;
//  롤 전용 음색 — 어택을 6ms로 세우고 컷오프를 4200Hz로 열어 픽 소리를 살린다.
//  (평소 기타는 30ms/2100Hz의 따뜻한 톤 그대로 — 여기만 예외)
const ROLL_TONE = { atk: 0.006, cut: 4200 };
// 4줄 보이싱 위에 옥타브 위 두 줄을 얹어 기타 6줄로. 정렬해 낮은 줄→높은 줄 순서를 보장한다
//  (E7처럼 3음이 반음 올라간 화음은 단순 append만 하면 순서가 뒤집힌다).
const rollVoicing = (gtr) => [...gtr, gtr[1] + 12, gtr[2] + 12].sort((a, b) => a - b);
function roll(ctx, dest, gtr, t, vol, dur) {
  rollVoicing(gtr).forEach((m, k) => {
    // 낮은 줄이 세고 위로 갈수록 여려진다 — 엄지로 훑어 내리는 실제 다운스트로크의 세기 분포.
    vGuitar(ctx, dest, m, t + k * ROLL_MS, vol * (1 - k * 0.07), dur - k * ROLL_MS, ROLL_TONE);
  });
}

// 4마디 묶음의 마지막 마디 = 필(fill).
// ── 기타 오른손 주법(articulation) ──────────────────────────────────
//  기타 관용어법 자료: "오른손 리듬(스트럼/피킹 패턴)이 코드 이름보다 스타일을 더 결정한다."
//  단음 멜로디만 24마디를 끌면 단조롭다 → 마디마다 주법을 바꿔 한 사람이 연주하듯 다채롭게.
//   MEL   단음 멜로디만
//   ARP   멜로디 + 빈칸에 아르페지오(핑거피킹 — 엄지 저음, 손가락 윗현)
//   STRUM 멜로디 + 다운/업 스트럼(악구 끝·전환에서)
//   BLOCK 멜로디 + 코드를 한꺼번에(종지·강조 — 스트럼과 달리 시차 없음)
//   ROLL  멜로디 + 6줄 롤 스트럼('다라라랑' — 악구 첫머리의 구두점)
//  ROLL은 **직전 마디 14스텝이 비어 있는 마디**에만 둔다(앞꾸밈으로 치기 때문).
//   9마디는 8마디의 미는 음이 이미 끌고 들어가므로 롤을 겹치지 않고 STRUM으로 둔다.
const ART = [
  'ROLL',  'MEL',   'ARP',   'STRUM',   //  1~4  A     — 루프 첫 마디를 롤로 크게 연다
  'MEL',   'ARP',   'MEL',   'BLOCK',   //  5~8  A'    — 8마디 종지에 한 방
  'STRUM', 'MEL',   'ARP',   'MEL',     //  9~12 B     — 진입은 8마디의 미는 음이 담당
  'ROLL',  'MEL',   'ARP',   'MEL',     // 13~16 A''   — 해소를 롤로. 앞 마디가 '숨'이라 가장 잘 들린다
  'ROLL',  'ARP',   'MEL',   'STRUM',   // 17~20 C     — 브레이크다운 진입
  'ROLL',  'MEL',   'ARP',   'BLOCK',   // 21~24 재현  — 복귀를 롤로 알리고 코드로 닫는다
];
// 아르페지오가 들어갈 자리(16분 격자) — 멜로디가 없는 칸에만 놓는다.
const ARP_STEPS = [2, 6, 10, 14];

// ── 인트로(8마디) ─────────────────────────────────────────────────────
//  루프에 곧장 떨어지지 않고 **층을 하나씩 쌓아** 문을 연다. 앞 4마디는 기타 혼자,
//  5마디에서 베이스, 7마디에서 퍼커션이 합류한다. **킥은 인트로 내내 아낀다** —
//  본편 1마디에서 킥이 처음 울려야 그 순간이 '시작'으로 들린다(비웠다 채우기).
//  BGM이 끊겼다 다시 나올 때마다 여기부터 재생된다(2026-08-10 사용자 요청).
const INTRO_BARS = 8;
const INTRO_STEPS = INTRO_BARS * BAR;
const INTRO = [
  { gtr: [N.C3, N.E3, N.G3, N.C4], root: N.C3 },   // 1 C
  { gtr: [N.A2, N.E3, N.A3, N.C4], root: N.A2 },   // 2 Am
  { gtr: [N.F2, N.C3, N.F3, N.A3], root: N.F2 },   // 3 F
  { gtr: [N.G2, N.D3, N.G3, N.B3], root: N.G2 },   // 4 G   — 앞 절반을 열어둔 채 끝낸다
  { gtr: [N.C3, N.E3, N.G3, N.C4], root: N.C3 },   // 5 C   — 베이스 합류
  { gtr: [N.A2, N.E3, N.A3, N.C4], root: N.A2 },   // 6 Am
  { gtr: [N.F2, N.C3, N.F3, N.A3], root: N.F2 },   // 7 F   — 퍼커션 합류
  { gtr: [N.G2, N.D3, N.F3, N.B3], root: N.G2 },   // 8 G7  — 본편 1마디(C)로 강하게 당긴다
];
//  5마디에서 본편 첫 마디 주제를 **미리 한 번** 들려준다 — 루프가 시작될 때 '아는 가락'이 된다.
//  8마디는 상행(레-파-솔-시)으로 1마디 첫음(도)까지 밀어올려 도착지를 예고한다.
const INTRO_PHRASE = [
  [[0, N.C4], [6, N.E4], [10, N.G4]],
  [[0, N.A4], [8, N.E4]],
  [[0, N.C4], [4, N.A4], [10, N.F4]],
  [[0, N.G4], [8, N.B4]],
  [[0, N.C4], [4, N.G4], [6, N.E4], [10, N.G4], [14, N.A4]],
  [[0, N.C5], [4, N.A4], [8, N.E4], [12, N.C4]],
  [[0, N.A4], [4, N.F4], [8, N.C5], [12, N.A4]],
  [[0, N.D4], [4, N.F4], [8, N.G4], [12, N.B4]],
];

function scheduleIntro(t0, idx) {
  const ctx = actx;
  const barIdx = Math.floor(idx / BAR);
  const st = idx % BAR;
  const t = (st % 2 === 1) ? t0 + STEP * SWING : t0;   // 본편과 같은 스윙
  const bar = INTRO[barIdx];
  const built = barIdx >= 4;                           // 뒷 4마디 = 층을 쌓는 구간
  // 곡의 서명 제스처(다라라랑)로 문을 열고, 뒷 절반이 시작될 때 한 번 더.
  if ((barIdx === 0 || barIdx === 4) && st === 0) roll(ctx, gain, bar.gtr, t, 0.11, BEAT * 5.0);
  INTRO_PHRASE[barIdx].forEach(([sp, m], q) => {
    if (sp !== st) return;
    vGuitar(ctx, gain, m, t, (q === 0 ? 0.17 : 0.14) * (built ? 1 : 0.9), BEAT * 2.4);
  });
  // 아르페지오 — 기타 혼자인 앞 4마디가 허전하지 않게 빈칸을 굴린다.
  if (ARP_STEPS.includes(st) && !INTRO_PHRASE[barIdx].some((n) => n[0] === st)) {
    vGuitar(ctx, gain, bar.gtr[(ARP_STEPS.indexOf(st) + 1) % bar.gtr.length], t, 0.030, BEAT * 2.0);
  }
  // 베이스는 5마디부터 — 바닥이 늦게 들어와야 층이 쌓이는 게 들린다.
  if (built && (st === 0 || st === 8)) vBass(ctx, gain, bar.root, t, 0.20, BEAT * 1.4);
  // 퍼커션은 7마디부터. 킥은 넣지 않는다(본편 1마디 몫).
  if (barIdx >= 6) {
    if (st === 4 || st === 12) vWood(ctx, gain, t, 0.05);
    if (st % 2 === 0 && st !== 14) hat(ctx, gain, t, (st % 4 === 0 ? 0.030 : 0.018));
  }
  // 인트로 끝 14스텝 = 본편 1마디로 넘기는 앞꾸밈 롤(ROLL 마디와 정확히 같은 방식).
  if (barIdx === INTRO_BARS - 1 && st === 14) roll(ctx, gain, BARS[0].gtr, t, 0.105, BEAT * 4.4);
}

const isFill = (b) => b % 4 === 3;

// 한 스텝 분량을 스케줄. t0는 '정박' 시각 — 16분 뒷자리면 스윙만큼 늦춰 연주한다.
function scheduleStep(t0, idx) {
  const ctx = actx;
  if (idx < INTRO_STEPS) { scheduleIntro(t0, idx); return; }   // 앞 2마디는 인트로
  const i = (idx - INTRO_STEPS) % FORM;
  const barIdx = Math.floor(i / BAR);
  const st = i % BAR;                                  // 0~15
  const t = (st % 2 === 1) ? t0 + STEP * SWING : t0;   // 16분 스윙
  const barDef = BARS[barIdx];
  //  turn이 있는 마디는 뒷반절(8스텝~)부터 화음이 바뀐다 — 턴어라운드용
  const bar = (barDef.turn && st >= 8) ? { ...barDef, ...barDef.turn } : barDef;
  const fill = isFill(barIdx);
  const onBeat = st % 4 === 0;
  //  미는 자리는 A·A' 끝(4·8마디)에만. 12마디는 '숨' 구간이라 밀면 숨이 죽고,
  //  16마디는 곡을 닫는 자리라 밀면 끝맺음이 안 된다.
  //  20마디(idx 19)에서 뺐다 — 같은 14스텝에 21마디 복귀를 알리는 앞꾸밈 롤이 들어간다.
  //   미는 음과 롤은 둘 다 '다음 마디 예고'라 겹치면 지저분해진다.
  const push = st === PUSH_STEP && (barIdx === 3 || barIdx === 7);
  // ── 셈여림 ── B섹션(긴장 구간)은 조금 세게. 12마디(G7) 뒷반절은 드럼을 비워 숨을 만든다
  //  → 13마디에서 전부 복귀하며 해소된다. 비웠다 채우는 게 가장 확실한 긴장/해소다.
  //  ── B섹션 진입은 **2마디에 걸쳐 단계적으로**(전환 진단: density jump) ──
  //   9마디=음역만 먼저 / 10마디=세기 도착(E7 정점) / 11마디=유지 / 12마디=숨
  //  C섹션(17~20)은 브레이크다운이라 더 여리게, 21마디 복귀에서 제자리로.
  const dyn = barIdx === 8 ? 1.04 : barIdx === 9 ? 1.12 : barIdx === 10 ? 1.10
    : (barIdx >= 16 && barIdx <= 19) ? 0.82 : 1;
  //  '숨' = 12마디 뒷반절(해소 직전) + **C섹션(17~20) 전체**는 드럼을 뺀 브레이크다운.
  const breath = (barIdx === 11 && st >= 8) || (barIdx >= 16 && barIdx <= 19);

  // ── 바닥 ① 베이스: 네 박 정박. 곡의 중심. ──
  const bp = BASS_PAT[st];
  if (bp !== '~') vBass(ctx, gain, bp === 'R' ? bar.root : bar.fifth, t, 0.22 * dyn, BEAT * 1.1);
  if (push) vBass(ctx, gain, bar.root, t, 0.18, BEAT * 1.2);   // 미는 음 — 받쳐주는 층 ①
  // 접근음 — 마디 끝에서 다음 마디 루트로 반음/온음 다가간다. 베이스가 정박에만 있으면
  //  바닥이 굳는다(그루브 자료: 정박 정렬 후 오프비트 움직임을 더할 것).
  //  하이햇이 쉬는 자리(14)라 베이스가 그 빈틈을 메워 이음새가 매끄러워진다.
  if (st === 14 && !push) {
    const nx = BARS[(barIdx + 1) % BARS.length];
    const nextRoot = nx.root;
    if (nextRoot !== bar.root) {
      const app = nextRoot + (nextRoot > bar.root ? -2 : 2);
      vBass(ctx, gain, app, t, 0.12, BEAT * 0.7);
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
  const line = PHRASE[barIdx];
  for (let q = 0; q < line.length; q += 1) {
    if (line[q][0] !== st) continue;
    // 마디 첫 음은 세게(악구의 시작), 마지막 음은 길게(마디를 넘어 다음으로 이어짐).
    const head = q === 0;
    const tail = q === line.length - 1;
    vGuitar(ctx, gain, line[q][1], t, (head ? 0.17 : 0.14) * dyn, BEAT * (tail ? 3.2 : 2.2));
  }
  //  ⚠️ 미는 음을 0.5박짜리 토막으로 두면 마디 끝에서 '툭' 끊긴다(2026-08-10 지적).
  //   당김의 목적은 **다음 마디로 넘기는 것**이라 반드시 마디선을 넘어 울려야 한다.
  if (push) vGuitar(ctx, gain, bar.riff[0], t, 0.15, BEAT * 3.0);

  // ── 기타 오른손 주법 — 마디마다 다르게(ART) ──
  const art = ART[barIdx];
  if (art === 'STRUM') {
    // 다운(1박) + 업(3박반) — 자료: "강박은 다운, 뒷박은 업"
    if (st === 0) strumS(ctx, gain, bar.gtr, t, 0.038 * dyn, BEAT * 4.6);
    else if (st === 10) strumS(ctx, gain, bar.gtr, t, 0.026 * dyn, BEAT * 1.6, true);
  } else if (art === 'ROLL') {
    // 강박은 앞 마디에서 넘어온 롤이 이미 울리고 있다. 뒷박만 가벼운 업으로 받아 리듬 유지.
    if (st === 10) strumS(ctx, gain, bar.gtr, t, 0.022 * dyn, BEAT * 1.4, true);
  } else if (art === 'BLOCK') {
    // 코드를 **한꺼번에** — 시차 0. 스트럼과 달리 '탁' 하고 한 덩어리로 들린다.
    if (st === 0) bar.gtr.forEach((m) => vGuitar(ctx, gain, m, t, 0.036 * dyn, BEAT * 4.2));
  } else if (art === 'ARP') {
    // 아르페지오 — 멜로디가 비운 칸에 화음 음을 하나씩 굴린다(핑거피킹).
    if (ARP_STEPS.includes(st) && !PHRASE[barIdx].some((n) => n[0] === st)) {
      const v = bar.gtr[(ARP_STEPS.indexOf(st) + 1) % bar.gtr.length];
      vGuitar(ctx, gain, v, t, 0.032 * dyn, BEAT * 2.0);
    }
    if (st === 0) strumS(ctx, gain, bar.gtr, t, 0.022 * dyn, BEAT * 3.0);   // 밑에 얇게 한 번
  }

  // ── 앞꾸밈 롤 — 다음 마디가 ROLL이면 **이 마디 14스텝**부터 훑어 올린다 ──
  //  강박(0스텝)에서 치면 킥·베이스·멜로디 첫음에 묻혀 롤로 안 들린다("다라라랑 느낌이 없다",
  //  2026-08-10). 하이햇이 쉬는 14스텝은 비어 있고, 290ms 뒤 맨 윗줄이 다음 마디 강박에
  //  정확히 착지한다 — 실제 기타리스트가 박 앞에서 훑기 시작하는 것과 같다.
  if (st === 14) {
    const nx = BARS[(barIdx + 1) % BARS.length];
    if (ART[(barIdx + 1) % ART.length] === 'ROLL') roll(ctx, gain, nx.gtr, t, 0.105 * dyn, BEAT * 4.4);
  }

  // ── 피아노: 화음을 얇게 받친다. **멜로디가 있는 칸은 피한다** ──
  //  같은 16분 자리에서 부딪히면 둘 다 흐려진다. 비는 칸에만 놓아 사이를 메운다.
  if (PIANO_STEPS.includes(st) && !PHRASE[barIdx].some((n) => n[0] === st)) {
    const top = bar.gtr.slice(2);                       // 화음 위 두 음(3도·옥타브 언저리)
    vPiano(ctx, gain, top[Math.floor(idx / 8) % top.length], t, 0.05 * dyn, BEAT * 1.8);
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
  //  ★멈췄다 다시 켤 때는 **언제나** 인트로부터(2026-08-10 사용자 요청).
  //   여기(running 가드 안쪽)에 둬야 메뉴 화면끼리 이동할 때 startBgm이 다시 불려도
  //   곡이 되감기지 않는다 — 실제로 정지했다 켜지는 경우에만 통과한다.
  stepIndex = 0;
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
//  다시 켜면 곡은 항상 인트로부터 시작한다(startSeq에서 되감음).
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
