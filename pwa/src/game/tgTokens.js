// 성조게임 리디자인 — 자체 완결 디자인 토큰 + 게임 유틸
// 메인 PWA 디자인시스템(#7f0005 딥레드)에 비의존. 게임은 "밝고 친근 캐주얼"(코랄) 팔레트.
// 나중에 별도 앱으로 분리해도 이 파일 + tgWidgets + gameApi + toneGameWords만 들고 가면 됨.
// 참조 메모리: tone_game_redesign.md §3 (디자인 토큰)

// ── 원색 램프 (Primitives) — 역할 토큰(SEM)만 이 값을 참조한다. 화면 코드에서 PRIM을 직접 쓰지 말 것. (2026-09-04 규칙화)
//   단계 50~900. 앵커는 그때까지 쓰던 실제 값이라 화면 변화 없음. 빈 단계는 필요할 때 램프 사이를 보간해 추가.
export const PRIM = {
  neutral: { 0: '#FFFFFF', 50: '#FFFDF8', 100: '#F3EFE9', 200: '#EBE5DE', 250: '#D8D2C8', 300: '#B8B0A8', 500: '#767079', 700: '#4A4550', 800: '#3C3C3C', 900: '#2B2730' },
  red:     { 50: '#FFF3F3', 100: '#FFE8E8', 200: '#F0BCBE', 400: '#F96163', 500: '#F2484C', 600: '#E64244', 700: '#C23F41' },
  green:   { 50: '#F2FCF7', 400: '#36C98D', 500: '#2BB583', 600: '#1FA86A', 700: '#219169' },
  yellow:  { 100: '#FFEDD4', 200: '#FFE79D', 300: '#FFC94D', 400: '#FFC23C', 500: '#F0A91E' },
  orange:  { 300: '#FFBD6B', 400: '#F3A75B', 500: '#FF6C28', 600: '#E77E33' },
  steel:   { 100: '#E4EDF5', 200: '#CFDBE6', 300: '#AAB2BD', 400: '#98A2B0', 500: '#66727C' },
  purple:  { 500: '#7C5CFF' },
  brown:   { 250: '#E2D7C1', 300: '#C29271', 500: '#A65E2E', 700: '#734728', 900: '#452C1C' },
};

// ── 역할 토큰 (Semantic) — 이름은 용도만 말한다. 값은 전부 PRIM 별칭.
export const SEM = {
  bg:     { page: PRIM.neutral[50], card: PRIM.neutral[0], subtle: PRIM.neutral[100], track: PRIM.yellow[100], disabled: PRIM.neutral[200], starOff: PRIM.neutral[250], bubble: PRIM.neutral[800] },
  border: { default: PRIM.neutral[200], keycap: PRIM.steel[100], keycapLocked: PRIM.steel[200] },
  text:   { primary: PRIM.neutral[900], secondary: PRIM.neutral[500], disabled: PRIM.neutral[300], button: PRIM.steel[500], buttonSoft: PRIM.steel[400], onAction: PRIM.neutral[0] },
  icon:   { locked: PRIM.steel[300] },
  action: { primary: PRIM.red[400], primaryEdge: PRIM.red[600], tabEdge: PRIM.red[700], danger: PRIM.red[500], tint: PRIM.red[100], tintSoft: PRIM.red[50], tintEdge: PRIM.red[200] },
  status: { success: PRIM.green[600], successGlow: PRIM.green[400], successTint: PRIM.green[50], warning: PRIM.yellow[400], gold: PRIM.yellow[500], goldSoft: PRIM.yellow[300] },
  brand:  { train: PRIM.green[500], trainEdge: PRIM.green[700], endless: PRIM.orange[400], endlessEdge: PRIM.orange[600], theme: PRIM.purple[500] },
  home:   { ink: PRIM.brown[900], accent: PRIM.brown[500], tabSoft: PRIM.brown[300], gaugeTrack: PRIM.brown[250], flame: PRIM.orange[500], flameSoft: PRIM.orange[300] },
};

// ── 호환 별칭 (TG/HOME) — 화면 코드가 쓰는 이름. 값은 SEM에서만 온다. 새 색이 필요하면 PRIM 단계 → SEM 역할 순으로 추가하고 여기엔 별칭만.
export const TG = {
  // 배경 / 표면
  BG: SEM.bg.page,          // 웜 화이트
  CARD: SEM.bg.card,
  // 메인 액센트 (coral)
  CORAL_DK: SEM.action.danger,    // 코랄 진함 · 오답/시간초과(구 DANGER 흡수 — 같은 값이었다, 2026-09-04)
  CORAL_GRAD: 'linear-gradient(135deg, #FF7A7A 0%, #F2484C 100%)',
  CORAL_BG: SEM.action.tint,    // 소프트 틴트 (콤보 칩 등)
  // 포인트
  SUN: SEM.status.warning,         // 콤보·별·타이머
  SUCCESS: SEM.status.success,     // 성공 텍스트
  SUCCESS_GLOW: SEM.status.successGlow,
  // 주 CTA 키캡(2026-08-31 승격 — 파일마다 CTA_RED/RES_RED/BAR_FILL 등으로 재선언되던 값을 단일 출처로)
  CTA: SEM.action.primary,         // 주 CTA·활성 탭·게이지 채움 레드 · 액센트(구 CORAL #FF6B6B 흡수 — 거리 14, 2026-09-04) (구 HOME.TAB_RED 흡수, 2026-09-04 A단계)
  CTA_EDGE: SEM.action.primaryEdge,    // CTA 키캡 인너 엣지 (구 HOME.CTA_EDGE 흡수)
  KEY_EDGE: SEM.border.keycap,    // 흰 키캡 버튼 인너 엣지·하드 파스텔 섀도 (구 HOME.CARD_SHADOW 흡수)
  STEEL: SEM.text.button,       // 쿨 그레이 — 보조 버튼 텍스트·취소 라벨(#8F9CA7·#637481 근접 통합). 2026-09-03 대비 3.5→4.9(AA)
  // 텍스트 (의미별 계층 — 비슷한 회색은 여기로 통합, 2026-07-18)
  INK: SEM.text.primary,       // 본문·제목
  SUB: SEM.text.secondary,       // 보조 텍스트(비슷한 회색 #8f887f·#8b8580·#a49da6 등 통합). 2026-09-03 대비 2.9→4.7(AA) — 설명문 56곳이 이 값을 쓴다 (구 ICON·GUIDE 흡수)
  MUTED: SEM.text.disabled,     // 비활성·플레이스홀더(#c3bcb2·#c9c2b8·#d8d2c8 등 통합)
  // 표면 / 라인 (웜 오프화이트 계열 통합)
  SURFACE: SEM.bg.subtle,   // 소프트 칩 배경(#f4efe8·#f7f3ee 통합)
  BORDER: SEM.border.default,    // 카드 보더·구분선(#efeae4·#e7e0d8·#ece5da·#e5ded5 통합) (구 HOME.TAB_BORDER #E9E6DE 흡수)
  TRACK: SEM.bg.track,     // 진행 게이지 트랙 (greige → 웜 브라이트, 2026-07-26 색감 리프레시)
  // 코드 로컬 상수·리터럴에서 승격(2026-09-04 B단계)
  TRAIN: SEM.brand.train,       // 트레이닝 아이덴티티(시안 461:339)
  TRAIN_EDGE: SEM.brand.trainEdge,  // 트레이닝 키캡 엣지
  ENDLESS: SEM.brand.endless,     // 무한 모드 오렌지(오브·배지·모드 해제)
  ENDLESS_EDGE: SEM.brand.endlessEdge,// 무한 오브 엣지
  LOCKED: SEM.bg.disabled,
  KEY_EDGE_LOCKED: SEM.border.keycapLocked, // 잠긴 칩 인셋 엣지(steel/200, 구 #CFDBE6)
  CORAL_BG_SOFT: SEM.action.tintSoft,  // 오답 플래시 배경(red/50)
  CORAL_BG_EDGE: SEM.action.tintEdge,  // 오답 키캡 엣지·튜토리얼 점(red/200)
  SUCCESS_BG: SEM.status.successTint,  // 정답 플래시 배경(green/50)
  GOLD: SEM.status.gold,               // 골드 텍스트·상태(yellow/500)
  GOLD_SOFT: SEM.status.goldSoft,      // 골드 수치·밝은 골드(yellow/300)
  THEME: SEM.brand.theme,              // 테마 모드·연음 마크 퍼플
  ICON_LOCKED: SEM.icon.locked,   // 미획득 아이콘(steel/300, 구 #A6B4C1)
  STEEL_SOFT: SEM.text.buttonSoft, // 옅은 쿨 그레이 수치(steel/400, 구 #8F9CA7)      // 잠긴 오브 면
  STAR_OFF: SEM.bg.starOff,    // 빈 별
  BUBBLE: SEM.bg.bubble,      // 코치 말풍선 면
  // 라인(반투명)
  LINE: 'rgba(43,39,48,0.08)',
};

// 인게임 배경 — 컬러 블롭 메시(단색·선형 띠 대신 유기적 공기감. 2026-07-26 색감 리프레시, Figma 35번 프레임).
// radial 5겹(하늘·피치·민트·코랄·웜크림)을 비대칭으로 흩뿌리고 베이스는 맑은 웜화이트.
export const BG_MESH = [
  'radial-gradient(60% 42% at 12% 5%, rgba(191,227,250,0.50), transparent 70%)',
  'radial-gradient(55% 36% at 90% 22%, rgba(255,225,194,0.42), transparent 70%)',
  'radial-gradient(45% 30% at 8% 55%, rgba(216,245,227,0.32), transparent 70%)',
  'radial-gradient(40% 26% at 92% 62%, rgba(255,217,217,0.28), transparent 70%)',
  'radial-gradient(70% 36% at 45% 98%, rgba(255,233,200,0.55), transparent 70%)',
].join(', ') + ', #FDFEFB';

// 홈 허브 팔레트 — 플랫 카툰 룸 + 공통 탭바 (2026-07-27 사용자 Figma 시안 442:2에서 추출).
// 시그니처: 하드(블러0) 파스텔 섀도(TG.KEY_EDGE) · 키캡 인너엣지(TAB_RED_EDGE) · 브라운 잉크 계열. 탭 레드·CTA 엣지·카드섀도·탭보더·BROWN은 2026-09-04 A단계에서 TG로 흡수/삭제.
// 홈 허브 방 일러스트 팔레트(벽·몰딩·바닥·창) — UI 토큰(TG/HOME)과 섞이지 않게 분리(2026-09-04 B단계). 일러스트 전용, 버튼·텍스트에 쓰지 말 것.
export const SCENE = {
  WALL: '#D9BA84',              // 상단 벽(탄)
  WALL_BAND: '#EFE4CF',         // 벽 하부 연크림 띠
  MOLD_DARK: '#734728',         // 몰딩 외곽 라인·창문 스트로크
  MOLD_LIGHT: '#C48C64',        // 몰딩 상단
  MOLD_MID: '#A46F4A',          // 몰딩 본체·창문 프레임·창턱
  FLOOR: '#FEF3DE',             // 바닥
  TILE: '#FBEFD7',              // 바닥 타일(라운드 사각 반복)
  GLASS: '#FFE79D',             // 창문 유리
  PANEL: '#D2B17B',             // 벽 세로 패널 스트라이프 — 시안 #F7F3ED MULTIPLY×벽(#D9BA84) 평탄화 값(2026-07-28 색 수정)
  SMOKE: '#EEE9D3',              // 굴뚝 연기 퍼프
  RAIL: '#9AAC5D',               // 난이도 사다리 레일(들판 올리브)
  PANEL_LINE: '#905E3D',        // 하부 웨인스코팅 패널 아웃라인 — 시안 #E0D7D1 MULTIPLY×밴드(#A46F4A) 평탄화 값
};

export const HOME = {
  // 방 일러스트 색은 SCENE으로 분리(2026-09-04 B단계) — 여기는 HUD·탭바 등 홈 UI 색만
  CARD: SEM.bg.card,              // 카드·탭바 배경(순백 — 2026-08-03 시안 개선안에서 웜 아이보리 #FFF9EE에서 변경)
  INK: SEM.home.ink,               // 잉크 브라운(닉네임·수치)
  ACCENT: SEM.home.accent,            // 등급명 — TAB_INACTIVE와 거리 13이라 brown/500 하나로 통합(2026-09-04 규칙화)
  TAB_INACTIVE: SEM.home.accent,      // 탭 비활성·홈 설정 아이콘(듀오톤 주색). 2026-09-04 채도 있는 시에나 — 대비 4.9(AA) 유지하면서 8F6650의 탁함 제거
  TAB_INACTIVE_SOFT: SEM.home.tabSoft, // 탭 비활성 듀오톤 보조색 — 실제 렌더는 TAB_INACTIVE @ opacity .72(shared.jsx .tg-tab-duo-off)이고 이 값은 그 평탄화 값(Figma 시안과 동일). 2026-09-04
  TAB_RED_EDGE: SEM.action.tabEdge,      // 활성 탭 키캡 인너 엣지
  GAUGE_TRACK: SEM.home.gaugeTrack,       // HUD 게이지 트랙
  STREAK_FLAME: SEM.home.flame,      // 스트릭 불꽃(기본 티어) — 시안 개선안
  STREAK_FLAME_SOFT: SEM.home.flameSoft, // 스트릭 불꽃 안쪽 코어·글로우
};

// 성조 5색 — toneGameWords.js TONES.color와 동일하게 유지(단일 출처는 TONES, 여기는 참조용 상수).
export const TONE_COLORS = {
  1: '#FF4D6D',
  2: '#FF9F40',
  3: '#36C98D',
  4: '#4D8DFF',
  0: '#AAB2BD',
};

// 성조 키 3단(위 밝음→기본→아래 두께 엣지) — 인게임 성조 버튼 키캡용 (2026-07-26 색감 리프레시 4차).
// 경성은 흰 라벨 대비 위해 기본색 자체를 반 단계 어둡게 잡음(#AAB2BD 대신 #98A2B0 계열).
export const TONE_KEY_COLORS = {
  1: { light: '#FF7089', base: '#FF4D6D', dark: '#D93A57' },
  2: { light: '#FFB466', base: '#FF9F40', dark: '#DB7F1F' },
  3: { light: '#5CD9A6', base: '#36C98D', dark: '#23A870' },
  4: { light: '#7AA9FF', base: '#4D8DFF', dark: '#3570DB' },
  0: { light: '#AEB8C4', base: '#98A2B0', dark: '#7E8894' },
};

// 난이도별 강조색 (Figma get_design_context 정확값). { accent, tint(0.14), glow(0.16) }
export const DIFF_COLORS = {
  easy:   { accent: '#36C98D', tint: 'rgba(54,201,141,0.14)',  glow: 'rgba(54,201,141,0.16)' },
  normal: { accent: '#FFC23C', tint: 'rgba(255,194,60,0.14)',  glow: 'rgba(255,194,60,0.16)' },
  hard:   { accent: '#F96163', tint: 'rgba(255,107,107,0.14)', glow: 'rgba(255,107,107,0.16)' },
};

// Figma에서 추출한 게임 이미지 에셋 (pwa/public/game/)
export const ASSETS = {
  startBg: '/game/start-bg.png',
  startTitle: '/game/start-title.png',
  pandaCoach: '/game/panda-coach.png',
  // 축하 판다 3단계: 01 차분 · 02 손흔들기 · 03 만세+반짝이(신기록)
  celebrate: ['/game/panda-celebrate-01.png', '/game/panda-celebrate-02.png', '/game/panda-celebrate-03.png'],
};

// 결과 성과에 따라 축하 판다 단계 선택 — 신기록=03, 콤보 좋음=02, 무난=01
export function pickCelebratePanda(isNewBest, maxCombo) {
  if (isNewBest) return ASSETS.celebrate[2];
  if (maxCombo >= 5) return ASSETS.celebrate[1];
  return ASSETS.celebrate[0];
}

// ── 폰트 ───────────────────────────────────────────────
export const FONT_TITLE = '"Jua", "Noto Sans KR", sans-serif';        // 타이틀(둥근 한글)
export const FONT_NUM = '"Roboto", "Noto Sans SC", sans-serif';        // 숫자·점수 — 시안과 통일(2026-08-04, 구 Baloo 2)
export const FONT_TANTAN = '"GamtanRoad Tantan", "Jua", "Noto Sans KR", sans-serif'; // 감탄로드 탄탄체 — 타이틀 필·안내문(2026-07-28 리디자인)
export const FONT_BODY = '"Noto Sans SC", "Noto Sans KR", system-ui, sans-serif'; // 본문·버튼 — 한글·한자 한 서체로 통일(Noto CJK는 한글 글리프 공유, 2026-08-04)
// 병음 — 성조 마크롱(ā ē ī ō ū) 렌더 안정성 위해 Noto Sans KR 대신 OS 네이티브 라틴 폰트 스택.
// (일부 기기에서 Noto Sans KR이 1성 마크롱 글리프를 폴백→옆으로 밀려 보이는 버그 회피. SF/Segoe UI/Roboto는 정상)
export const FONT_PINYIN = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
// 한자 — 용량 큰 Noto SC 웹폰트 대신 시스템 스택(OS 설치 폰트)으로 처리.
export const FONT_HANZI = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Heiti SC", sans-serif';

// ── 타이포 스케일(2026-07-18) ──────────────────────────
// 2026-09-04 규칙화: 크기 스케일 11·12·13·15·17·20·24·28·32·60 · 굵기는 500(본문)/700(강조) 둘뿐(800 폐기). title 22→20 · head 21→20 · h1 18→17 · h2/btn 16→15 · label 14→13 · numLg 26→24.
// 흩어진 fontSize 하드코딩(35종)을 의미 기반 프리셋으로 통일. family+weight+size만 묶고 색·letterSpacing은 개별 지정.
//   사용: style={{ ...TYPE.h1, color: TG.INK }}  ·  적용 시 근처 값은 스케일에 스냅(예 16.5→16, 12.5→12).
//   숫자 히어로(결과 60·XP 52 등)는 원오프라 TYPE.numHero에 fontSize 오버라이드로 사용.
export const TYPE = {
  // 타이틀(FONT_TITLE — 단일 굵기 디스플레이체, weight 불필요)
  titleLg: { fontFamily: FONT_TITLE, fontSize: 24 },  // 모달·히어로 제목
  title:   { fontFamily: FONT_TITLE, fontSize: 20},  // 등급명·테마명 등 히어로
  head:    { fontFamily: FONT_BODY, fontWeight: 700, fontSize: 20},  // 화면 헤더 — 깔끔한 고딕 볼드(2026-07-23, 구 Jua 둥근체에서 변경)
  // 디스플레이 숫자(FONT_NUM)
  numHero: { fontFamily: FONT_NUM, fontWeight: 700, fontSize: 60 }, // 결과 점수(원오프는 size 오버라이드)
  numLg:   { fontFamily: FONT_NUM, fontWeight: 700, fontSize: 24}, // 통계 수치
  numMd:   { fontFamily: FONT_NUM, fontWeight: 700, fontSize: 20 }, // 소형 수치
  num:     { fontFamily: FONT_NUM, fontWeight: 700, fontSize: 13 }, // 인라인 미니 수치
  // 본문 강조(FONT_BODY) — 제목·버튼
  h1:      { fontFamily: FONT_BODY, fontWeight: 700, fontSize: 17}, // 카드·섹션 강조 제목
  h2:      { fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15}, // 소제목 강조
  cta:     { fontFamily: FONT_BODY, fontWeight: 700, fontSize: 17}, // 주요 CTA 라벨
  btn:     { fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15}, // 버튼·리스트 항목
  btnSm:   { fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15 }, // 보조 버튼
  // 본문/라벨(FONT_BODY)
  label:   { fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13}, // 라벨(강)
  labelSm: { fontFamily: FONT_BODY, fontWeight: 700, fontSize: 12 }, // 소형 라벨/배지
  body:    { fontFamily: FONT_BODY, fontWeight: 500, fontSize: 15 }, // 기본 본문
  sub:     { fontFamily: FONT_BODY, fontWeight: 500, fontSize: 13 }, // 보조 설명
  meta:    { fontFamily: FONT_BODY, fontWeight: 500, fontSize: 12 }, // 메타·캡션
  micro:   { fontFamily: FONT_BODY, fontWeight: 500, fontSize: 11 }, // 초소형
};

// ── 반경 / 그림자 ──────────────────────────────────────
// 스케일(4px 기반) + 의미 별칭(btn/card). chip(=md)은 2026-09-04 삭제. 근접값은 스케일로 스냅(예 14·15→lg 16, 22·23→xxl 24). pill=완전 둥근 알약.
export const RADIUS = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, pill: 999, btn: 20, card: 24 }; // 2026-09-04 규칙화: btn 18→xl 20, card 28→xxl 24(별칭)
export const SHADOW = {
  ctaGlow: '0 10px 20px rgba(242,72,76,0.10)', // CTA 키캡의 옅은 레드 글로우 리프트(홈 모드선택·복습 CTA)
  // 높이 3단(2026-09-04 규칙화) — level1 카드/행, level2 키캡·모달, level3 바텀시트. 인라인 리터럴 대신 이 셋을 쓴다.
  level1: '0 4px 18px rgba(43,39,48,0.04)',
  level2: '0 4px 18px rgba(43,39,48,0.07)',
  level3: '0 -10px 40px rgba(26,16,20,0.25)',
  // 카드 섀도 — 무채색 → 옅은 블루·코랄 틴트 2겹(공기감, 2026-07-26 색감 리프레시)
  card: '0 10px 28px rgba(89,128,192,0.10), 0 3px 12px rgba(255,107,107,0.06)',
  btn: '0 6px 16px rgba(242,72,76,0.28)',
  // 정답 글로우 — 하드 테두리 금지, 부드러운 다층 드롭섀도(메모리 §4)
  correctGlow: '0 10px 28px rgba(43,39,48,0.07), 0 0 40px rgba(54,201,141,0.24), 0 2px 16px rgba(54,201,141,0.16)',
  timeoutGlow: '0 10px 28px rgba(43,39,48,0.07), 0 0 40px rgba(242,72,76,0.22), 0 2px 16px rgba(242,72,76,0.16)',
};

// ── 키캡 규칙(2026-09-04) — 게임의 모든 '눌리는 면'은 이 한 함수로 그린다. depth 4 = 버튼/오브/성조 키, 2 = 카드/칩/HUD. lift = 높이(level1 카드, level2 버튼·모달, null 없음, 또는 글로우 문자열).
export const keycap = (edge, { depth = 4, lift = SHADOW.level2 } = {}) => lift ? `inset 0 -${depth}px 0 ${edge}, ${lift}` : `inset 0 -${depth}px 0 ${edge}`;

// ── 스페이싱 토큰 ──────────────────────────────────────
// 4px 기반 스케일. gap·margin·단일 padding 등 개별 숫자값에 사용. 근접값은 스냅(예 7→md 8, 14·15→x2 16).
// 복합 shorthand padding('14px 16px')은 레이아웃 특화·가독성 위해 토큰화 대상 아님(리터럴 유지).
export const SPACE = { xxs: 4, xs: 4, sm: 8, md: 8, lg: 12, xl: 12, x2: 16, x3: 20, x4: 24, x5: 32 }; // 2026-09-04 규칙화: 4px 격자. xxs·sm·lg는 xs·md·xl의 별칭(구 2·6·10)

// ── 모션 토큰 ──────────────────────────────────────────
export const DUR = { micro: '150ms', state: '220ms', enter: '360ms' };

// 인터랙티브 요소 공통 — 모바일 탭 지연 제거 + iOS tap highlight 끔
export const TOUCH_OPT = {
  touchAction: 'manipulation',
  WebkitTapHighlightColor: 'transparent',
};

// ── 웹폰트 로더 ────────────────────────────────────────
// 게임 진입 시 1회만 Google Fonts(Jua·Baloo 2·Noto Sans KR) 주입. 자체 완결 위해 index.html 비의존.
// ⚠️ index.html의 <link id="tg-fonts">가 먼저 들어가 있으면 아래 주입은 건너뛴다 — 두 곳의 패밀리·굵기를 항상 같이 고칠 것.
const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Jua&family=Noto+Sans+KR:wght@400;500;700'
  + '&family=Noto+Sans+SC:wght@400;500;700;900&family=Roboto:wght@500;700;900&display=swap';
export function ensureGameFonts() {
  if (typeof document === 'undefined') return;
  // 게임 단독 앱은 @fontsource로 폰트를 번들(main.game.jsx)하므로 CDN 주입 불필요 — 오프라인 동작.
  if (__GAME_APP__) return;
  if (document.getElementById('tg-fonts')) return;
  // preconnect (성능)
  for (const [id, href, cross] of [
    ['tg-fonts-pc1', 'https://fonts.googleapis.com', false],
    ['tg-fonts-pc2', 'https://fonts.gstatic.com', true],
  ]) {
    if (!document.getElementById(id)) {
      const l = document.createElement('link');
      l.id = id; l.rel = 'preconnect'; l.href = href;
      if (cross) l.crossOrigin = 'anonymous';
      document.head.appendChild(l);
    }
  }
  const link = document.createElement('link');
  link.id = 'tg-fonts';
  link.rel = 'stylesheet';
  link.href = FONT_HREF;
  document.head.appendChild(link);
}

// ── 게임 유틸 ──────────────────────────────────────────
// 햅틱(진동) 음소거 — 설정 시트의 '햅틱' 토글. SFX와 별도 키. 미지원 기기(iOS Safari 등)는 vibrate 자체가 no-op.
export function isHapticMuted() { try { return localStorage.getItem('tg_haptic_muted') === '1'; } catch { return false; } }
export function setHapticMuted(m) { try { localStorage.setItem('tg_haptic_muted', m ? '1' : '0'); } catch { /* noop */ } }

// 보조바퀴 토글 — 뜻(플레이 중 크러치)·병음(정답 공개 시)을 숨겨 '소리·성조로 체득'을 강화.
//  ★컨텍스트별 저장(2026-07-24): 스테이지(easy-1)·보스(easy-boss)·무한(endless)·트레이닝(training)·테마(th-drama)가 각각 기억.
//  각 시작 화면(스테이지 카드·무한 모달·테마·트레이닝)과 인게임 설정에서 '현재 컨텍스트' 값을 켜고 끔.
// ctx별 저장값이 없으면 **전역 기본값('g')** 을 따른다 — 홈 메뉴의 '단어 뜻/병음' 토글이 그 기본값을 쓴다(2026-08-06 시안 461:40).
export function isMeaningHidden(ctx = 'g') {
  try {
    const v = localStorage.getItem(`tg_hide_meaning_${ctx}`);
    return (v != null ? v : localStorage.getItem('tg_hide_meaning_g')) === '1';
  } catch { return false; }
}
export function setMeaningHidden(ctx, h) { try { localStorage.setItem(`tg_hide_meaning_${ctx}`, h ? '1' : '0'); } catch { /* noop */ } }
export function isPinyinHidden(ctx = 'g') {
  try {
    const v = localStorage.getItem(`tg_hide_pinyin_${ctx}`);
    return (v != null ? v : localStorage.getItem('tg_hide_pinyin_g')) === '1';
  } catch { return false; }
}
export function setPinyinHidden(ctx, h) { try { localStorage.setItem(`tg_hide_pinyin_${ctx}`, h ? '1' : '0'); } catch { /* noop */ } }

export function haptic(pattern) {
  if (isHapticMuted()) return;
  try { navigator.vibrate?.(pattern); } catch { /* noop */ }
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// 콤보 단계별 단어당 제한시간 (ms). 잘할수록 자동으로 빨라지고, 콤보 깨지면 회복됨.
// multiplier: 난이도별 시간 배수 (콤보0=초급30·중급20·고급10초 / 복습=30초 고정 / 무한=30→10초 별도 함수)
export function getTimeLimitForCombo(combo, multiplier = 1) {
  let base;
  if (combo >= 8) base = 3000;
  else if (combo >= 6) base = 3500;
  else if (combo >= 4) base = 4500;
  else if (combo >= 2) base = 5500;
  else base = 7000;
  return Math.round(base * multiplier);
}

// ── 베스트 기록 캐시 (localStorage) ────────────────────
// 학생=서버(D1 GAME_BEST)가 single source of truth고 localStorage는 빠른 표시용 캐시(진입 시 serverToCache로 복원).
// 게스트=로컬이 전부, 회원=/game/me JSON 블롭과 양방향 머지(gameStore).
export function getBestKey(studentToken, gameKey) {
  return studentToken ? `game_best_${gameKey}_${studentToken}` : `game_best_${gameKey}`;
}
export function loadBest(studentToken, gameKey) {
  try {
    const raw = localStorage.getItem(getBestKey(studentToken, gameKey));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
export function saveBest(studentToken, gameKey, data) {
  try { localStorage.setItem(getBestKey(studentToken, gameKey), JSON.stringify(data)); } catch { /* noop */ }
}
// (serverToCache 제거 — 학생 서버 베스트(GAME_BEST_DB) 복원 경로가 사라져 호출부가 없다, 2026-07-12.
//  회원 동기화는 gameStore의 applyGameDataToLocal이 /game/me JSON을 통째로 병합한다.)
