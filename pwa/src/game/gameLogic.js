// 성조게임 — 잠금 사다리 / 무한모드 / 헤드라인 최고점 등 순수 로직 헬퍼.
// React 무관. localStorage 베스트 캐시(tgTokens) 위에서 동작 → 화면 컴포넌트·상태머신이 공유.
// 참조 메모리: tone_game_redesign.md (잠금 사다리·무한·헤드라인)
import { loadBest, saveBest } from './tgTokens.js';
import { DIFFICULTIES, THEMES } from '../constants/toneGameWords.js';

// 통합 최고점수 — 3난이도 기록 중 최고(+ 그 난이도 라벨). 타이틀 카드는 '내 최고 실력'을 보여줌.
export function bestLabelForKey(gameKey) { const d = DIFFICULTIES.find((x) => x.gameKey === gameKey); return d ? d.label : '초급'; }
export function overallBestFromLocal(token) {
  let top = null;
  for (const d of DIFFICULTIES) {
    const b = loadBest(token, d.gameKey);
    if (b && (b.bestScore || 0) > 0 && (!top || b.bestScore > top.bestScore)) top = { ...b, label: d.label };
  }
  return top;
}
export function overallBestFromServer(bests) {
  let top = null;
  for (const b of (bests || [])) {
    const sc = b.bestScore || 0;
    if (sc > 0 && (!top || sc > top.bestScore)) top = { bestScore: sc, bestMaxCombo: b.bestMaxCombo || 0, bestAvgMs: (b.bestAvgSec || 0) * 1000, playCount: b.playCount || 0, label: bestLabelForKey(b.gameKey) };
  }
  return top;
}

// ── 잠금 사다리 / 무한모드 ──────────────────────────────
// 잠금 사다리 = DIFFICULTIES 배열 순서에서 파생: 첫 난이도(항상) → 이후는 '직전 난이도 ≥ 1000점' → 무한(마지막 난이도 ≥ 1000점).
// 새 난이도는 toneGameWords.js DIFFICULTIES에 항목만 추가하면 잠금·문구·업적이 자동으로 따라온다(하드코딩 금지).
export const UNLOCK_THRESHOLD = 1000;
export const GAMEKEY = Object.fromEntries(DIFFICULTIES.map((d) => [d.id, d.gameKey]));
export const ENDLESS_BEST_KEY = 'tone-endless'; // localStorage 캐시 키(헤드라인 최고). 서버 동기화는 meta.eb.
// 서버 meta 필드 규약(매직 스트링 단일화) — eb=무한 최고점(마지막 난이도 행에 얹음), w=단어 숙련도 부분집합.
export const META_ENDLESS_BEST = 'eb';
export const META_WORD_STATS = 'w';
export function diffBestScore(token, diffId) { const b = loadBest(token, GAMEKEY[diffId]); return b ? (b.bestScore || 0) : 0; }
export function isDifficultyUnlocked(token, diffId) {
  const idx = DIFFICULTIES.findIndex((d) => d.id === diffId);
  if (idx < 0) return false;
  if (idx === 0) return true;
  return diffBestScore(token, DIFFICULTIES[idx - 1].id) >= UNLOCK_THRESHOLD;
}
export function isEndlessUnlocked(token) { return diffBestScore(token, DIFFICULTIES[DIFFICULTIES.length - 1].id) >= UNLOCK_THRESHOLD; }
function prevDiffLabel(diffId) {
  const idx = DIFFICULTIES.findIndex((d) => d.id === diffId);
  return idx > 0 ? DIFFICULTIES[idx - 1].label : null;
}
export function unlockReqText(diffId) {
  const prev = prevDiffLabel(diffId);
  return prev ? `${prev} ${UNLOCK_THRESHOLD.toLocaleString()}점 달성 시 해제` : '';
}
export function unlockToastText(diffId) {
  const prev = prevDiffLabel(diffId);
  return prev ? `${prev} ${UNLOCK_THRESHOLD.toLocaleString()}점을 달성하면 열려요` : '';
}
// 무한 모드 해제 연출(마지막 난이도 1000점 돌파 시) — 난이도별 연출은 DIFFICULTIES[].unlockReveal(데이터)이 담당.
export const ENDLESS_UNLOCK_REVEAL = { icon: 'Infinity', label: '무한 모드', desc: '끝없이 이어지는 무한 모드가 열렸어요', accent: '#8B5CF6' };

// ── 테마 모드(난이도와 별개 축) ──────────────────────────
// 각 테마는 자체 gameKey라 최고점·리더보드가 난이도처럼 자동으로 붙는다(종료 처리도 normal과 동일, gameKey만 다름).
// 잠금: theme.unlock=null이면 오픈, { byGameKey, score }면 그 게임키 최고점이 score 이상일 때 해제.
function labelForGameKey(gameKey) {
  const d = DIFFICULTIES.find((x) => x.gameKey === gameKey); if (d) return d.label;
  const t = THEMES.find((x) => x.gameKey === gameKey); if (t) return t.label;
  return '';
}
export function themeBestScore(token, gameKey) { const b = loadBest(token, gameKey); return b ? (b.bestScore || 0) : 0; }
export function isThemeUnlocked(token, theme) {
  if (!theme || !theme.unlock) return true;
  return themeBestScore(token, theme.unlock.byGameKey) >= theme.unlock.score;
}
export function themeUnlockReqText(theme) {
  if (!theme || !theme.unlock) return '';
  return `${labelForGameKey(theme.unlock.byGameKey)} ${theme.unlock.score.toLocaleString()}점 달성 시 해제`;
}
export function themeUnlockToastText(theme) {
  if (!theme || !theme.unlock) return '';
  return `${labelForGameKey(theme.unlock.byGameKey)} ${theme.unlock.score.toLocaleString()}점을 달성하면 열려요`;
}
// 무한모드 제한시간 — 두 축으로 단축(둘 다):
//  ① 클리어 램프: 30초 시작 → 단어당 1.4초씩 → 10초(약 14단어에 도달)
//  ② 콤보 가속: 콤보 쌓이면 추가로 빨라짐(콤보당 -5%, 콤보7+면 65%), 끊기면 회복
//  최종 절대 하한 4초.
export function getEndlessTimeLimit(cleared, combo = 0) {
  const byCleared = Math.max(10000, 30000 - cleared * 1400);
  const comboFactor = Math.max(0.65, 1 - combo * 0.05);
  return Math.max(4000, Math.round(byCleared * comboFactor));
}

// ── 점수 공식 ──────────────────────────────────────────
// 정답 1단어 획득 점수. 밸런싱을 한곳에 모음(handleTone에서 인라인 분산 → 여기로).
//  - perfect(무실수): 기본 100 + 콤보 보너스(newCombo*20) + 남은시간 보너스(remaining/100)
//  - 실수 있음: 기본 50 + 남은시간 보너스 절반(콤보 없음)
export function computeScore({ perfect, newCombo = 0, remainingMs = 0 }) {
  const timeBonus = Math.floor(Math.max(0, remainingMs) / 100);
  return perfect ? (100 + newCombo * 20 + timeBonus) : 50; // 오답 클리어는 시간보너스 없이 플랫 50(랜덤 탭 잠금해제 방지)
}
// ── 게임 종료 결과 판정 ──────────────────────────────────
// 모드별 최고기록 갱신·신기록 여부·효과음을 한곳에서 순수 계산한다(예전엔 end-effect에 4모드 인라인 중복).
// 부수효과(localStorage 저장·서버 submit·사운드 재생·updatedAt 스탬프)는 호출부가 수행.
//   mode : 'normal' | 'endless' | 'practice' | 'review'
//   prev : 이전 베스트 레코드(없으면 null) — normal=난이도별, endless=무한
// 반환:
//   tracksBest  : 최고기록을 갱신하는 모드인지(normal·endless=true, practice·review=false)
//   isNewBest   : 이번 점수가 신기록인지
//   previousBest: 이전 최고점(결과화면 표시용)
//   updated     : 저장할 베스트 레코드(updatedAt 제외) — tracksBest=false면 null
//   sfx         : 재생할 효과음 키('unlock'|'win'|'gameover')
export function resolveEndOutcome({ mode, prev, score, maxCombo = 0, avgMs = 0 }) {
  if (mode === 'practice' || mode === 'review') {
    return { tracksBest: false, isNewBest: false, previousBest: 0, updated: null, sfx: 'gameover' };
  }
  const previousBest = prev?.bestScore || 0;
  const isNewBest = score > previousBest;
  const updated = {
    bestScore: isNewBest ? score : previousBest,
    bestMaxCombo: isNewBest ? maxCombo : (prev?.bestMaxCombo || 0),
    bestAvgMs: isNewBest ? avgMs : (prev?.bestAvgMs || 0),
    playCount: (prev?.playCount || 0) + 1,
  };
  // 잠금 해제음은 난이도(normal) 모드에서 1000점 임계를 처음 넘을 때만(무한은 잠금해제 개념 없음).
  const justUnlocked = mode === 'normal' && previousBest < UNLOCK_THRESHOLD && updated.bestScore >= UNLOCK_THRESHOLD;
  const sfx = justUnlocked ? 'unlock' : (isNewBest ? 'win' : 'gameover');
  return { tracksBest: true, isNewBest, previousBest, updated, sfx };
}

// 무한모드 베스트 캐시(localStorage)
export function loadEndlessBest(token) { return loadBest(token, ENDLESS_BEST_KEY); }
export function saveEndlessBest(token, data) { saveBest(token, ENDLESS_BEST_KEY, data); }
// 타이틀 헤드라인 최고점수 = 무한 기록 우선, 없으면 난이도 통합 최고.
export function headlineBest(token) {
  const eb = loadEndlessBest(token);
  if (eb && (eb.bestScore || 0) > 0) return { ...eb, label: '무한' };
  return overallBestFromLocal(token);
}
