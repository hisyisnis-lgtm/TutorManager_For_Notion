// 성조게임 — 잠금 사다리 / 무한모드 / 헤드라인 최고점 등 순수 로직 헬퍼.
// React 무관. localStorage 베스트 캐시(tgTokens) 위에서 동작 → 화면 컴포넌트·상태머신이 공유.
// 참조 메모리: tone_game_redesign.md (잠금 사다리·무한·헤드라인)
import { loadBest, saveBest } from './tgTokens.js';
import { DIFFICULTIES } from '../constants/toneGameWords.js';

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
// 초급(항상) → 중급(초급≥1000) → 고급(중급≥1000) → 무한(고급≥1000). 점수는 난이도별 캐시(localStorage).
export const UNLOCK_THRESHOLD = 1000;
export const GAMEKEY = { easy: 'tone-easy', normal: 'tone-normal', hard: 'tone-hard' };
export const ENDLESS_BEST_KEY = 'tone-endless'; // localStorage 캐시 키(헤드라인 최고). 서버 동기화는 meta.eb.
export function diffBestScore(token, diffId) { const b = loadBest(token, GAMEKEY[diffId]); return b ? (b.bestScore || 0) : 0; }
export function isDifficultyUnlocked(token, diffId) {
  if (diffId === 'easy') return true;
  if (diffId === 'normal') return diffBestScore(token, 'easy') >= UNLOCK_THRESHOLD;
  if (diffId === 'hard') return diffBestScore(token, 'normal') >= UNLOCK_THRESHOLD;
  return false;
}
export function isEndlessUnlocked(token) { return diffBestScore(token, 'hard') >= UNLOCK_THRESHOLD; }
export function unlockReqText(diffId) {
  if (diffId === 'normal') return '초급 1,000점 달성 시 해제';
  if (diffId === 'hard') return '중급 1,000점 달성 시 해제';
  return '';
}
export function unlockToastText(diffId) {
  if (diffId === 'normal') return '초급 1,000점을 달성하면 열려요';
  if (diffId === 'hard') return '중급 1,000점을 달성하면 열려요';
  return '';
}
// 무한모드 제한시간 — 누적 클리어 수에 따라 점점 짧아지고 하한 고정.
export function getEndlessTimeLimit(cleared) { return Math.max(2500, 6500 - cleared * 180); }

// ── 점수 공식 ──────────────────────────────────────────
// 정답 1단어 획득 점수. 밸런싱을 한곳에 모음(handleTone에서 인라인 분산 → 여기로).
//  - perfect(무실수): 기본 100 + 콤보 보너스(newCombo*20) + 남은시간 보너스(remaining/100)
//  - 실수 있음: 기본 50 + 남은시간 보너스 절반(콤보 없음)
export function computeScore({ perfect, newCombo = 0, remainingMs = 0 }) {
  const timeBonus = Math.floor(Math.max(0, remainingMs) / 100);
  return perfect ? (100 + newCombo * 20 + timeBonus) : (50 + Math.floor(timeBonus / 2));
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
