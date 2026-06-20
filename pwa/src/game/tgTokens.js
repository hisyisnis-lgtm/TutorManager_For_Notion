// 성조게임 리디자인 — 자체 완결 디자인 토큰 + 게임 유틸
// 메인 PWA 디자인시스템(#7f0005 딥레드)에 비의존. 게임은 "밝고 친근 캐주얼"(코랄) 팔레트.
// 나중에 별도 앱으로 분리해도 이 파일 + tgWidgets + gameApi + toneGameWords만 들고 가면 됨.
// 참조 메모리: tone_game_redesign.md §3 (디자인 토큰)

// ── 색상 토큰 ──────────────────────────────────────────
export const TG = {
  // 배경 / 표면
  BG: '#FFFDF8',          // 웜 화이트
  CARD: '#FFFFFF',
  // 메인 액센트 (coral)
  CORAL: '#FF6B6B',
  CORAL_DK: '#F2484C',
  CORAL_GRAD: 'linear-gradient(135deg, #FF7A7A 0%, #F2484C 100%)',
  CORAL_BG: '#FFE8E8',    // 소프트 틴트 (콤보 칩 등)
  // 포인트
  SUN: '#FFC23C',         // 콤보·별·타이머
  SUCCESS: '#1FA86A',     // 성공 텍스트
  SUCCESS_GLOW: '#36C98D',
  DANGER: '#F2484C',      // 시간초과·오답
  // 텍스트
  INK: '#2B2730',
  SUB: '#9A93A0',
  GUIDE: '#595959',
  // 라인
  LINE: 'rgba(43,39,48,0.08)',
};

// 성조 5색 — toneGameWords.js TONES.color와 동일하게 유지(단일 출처는 TONES, 여기는 참조용 상수).
export const TONE_COLORS = {
  1: '#FF4D6D',
  2: '#FF9F40',
  3: '#36C98D',
  4: '#4D8DFF',
  0: '#AAB2BD',
};

// 성조색 소프트 틴트 배경 (Figma: 각 성조색 0.14 알파)
export const TONE_TINTS = {
  1: 'rgba(255,77,109,0.14)',
  2: 'rgba(255,159,64,0.14)',
  3: 'rgba(54,201,141,0.14)',
  4: 'rgba(77,141,255,0.14)',
  0: 'rgba(170,178,189,0.14)',
};
// 성조버튼 테두리 (Figma: 각 성조색 0.3 알파)
export const TONE_BORDERS = {
  1: 'rgba(255,77,109,0.3)',
  2: 'rgba(255,159,64,0.3)',
  3: 'rgba(54,201,141,0.3)',
  4: 'rgba(77,141,255,0.3)',
  0: 'rgba(170,178,189,0.3)',
};

// 난이도별 강조색 (Figma get_design_context 정확값). { accent, tint(0.14), glow(0.16) }
export const DIFF_COLORS = {
  easy:   { accent: '#36C98D', tint: 'rgba(54,201,141,0.14)',  glow: 'rgba(54,201,141,0.16)' },
  normal: { accent: '#FFC23C', tint: 'rgba(255,194,60,0.14)',  glow: 'rgba(255,194,60,0.16)' },
  hard:   { accent: '#FF6B6B', tint: 'rgba(255,107,107,0.14)', glow: 'rgba(255,107,107,0.16)' },
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
export const FONT_NUM = '"Baloo 2", "Noto Sans KR", sans-serif';      // 숫자·점수
export const FONT_BODY = '"Noto Sans KR", system-ui, sans-serif';    // 본문·버튼
// 한자 — 용량 큰 Noto SC 웹폰트 대신 시스템 스택(OS 설치 폰트)으로 처리.
export const FONT_HANZI = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Heiti SC", sans-serif';

// ── 반경 / 그림자 ──────────────────────────────────────
export const RADIUS = { card: 28, btn: 18, chip: 12 };
export const SHADOW = {
  card: '0 10px 28px rgba(43,39,48,0.08)',
  btn: '0 6px 16px rgba(242,72,76,0.28)',
  // 정답 글로우 — 하드 테두리 금지, 부드러운 다층 드롭섀도(메모리 §4)
  correctGlow: '0 10px 28px rgba(43,39,48,0.07), 0 0 40px rgba(54,201,141,0.24), 0 2px 16px rgba(54,201,141,0.16)',
  timeoutGlow: '0 10px 28px rgba(43,39,48,0.07), 0 0 40px rgba(242,72,76,0.22), 0 2px 16px rgba(242,72,76,0.16)',
};

// ── 모션 토큰 ──────────────────────────────────────────
export const DUR = { micro: '150ms', state: '220ms', enter: '360ms' };

// 인터랙티브 요소 공통 — 모바일 탭 지연 제거 + iOS tap highlight 끔
export const TOUCH_OPT = {
  touchAction: 'manipulation',
  WebkitTapHighlightColor: 'transparent',
};

// ── 웹폰트 로더 ────────────────────────────────────────
// 게임 진입 시 1회만 Google Fonts(Jua·Baloo 2·Noto Sans KR) 주입. 자체 완결 위해 index.html 비의존.
const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Jua&family=Baloo+2:wght@600;700;800&family=Noto+Sans+KR:wght@400;500;700&display=swap';
export function ensureGameFonts() {
  if (typeof document === 'undefined') return;
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
export function haptic(pattern) {
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
// multiplier: 난이도별 시간 배수 (2.6=초급, 1.8=중급, 1.0=고급 / 복습=2.8 / 무한=별도 함수)
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
// Notion DB가 single source of truth. localStorage는 빠른 표시용 캐시.
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
// Notion 응답(서버) → localStorage 캐시 형태(클라이언트) 변환
export function serverToCache(serverBest) {
  if (!serverBest) return null;
  return {
    bestScore: serverBest.bestScore || 0,
    bestMaxCombo: serverBest.bestMaxCombo || 0,
    bestAvgMs: (serverBest.bestAvgSec || 0) * 1000,
    playCount: serverBest.playCount || 0,
    updatedAt: serverBest.lastPlayedAt ? new Date(serverBest.lastPlayedAt).getTime() : Date.now(),
  };
}
