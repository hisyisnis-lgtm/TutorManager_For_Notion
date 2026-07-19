// 성조게임 — 잠금 사다리 / 무한모드 / 헤드라인 최고점 등 순수 로직 헬퍼.
// React 무관. localStorage 베스트 캐시(tgTokens) 위에서 동작 → 화면 컴포넌트·상태머신이 공유.
// 참조 메모리: tone_game_redesign.md (잠금 사다리·무한·헤드라인)
import { loadBest, saveBest, getTimeLimitForCombo } from './tgTokens.js';
import { DIFFICULTIES, THEMES, ROUND_LENGTH } from '../constants/toneGameWords.js';

// 통합 최고점수 — 3난이도 기록 중 최고(+ 그 난이도 라벨). 타이틀 카드는 '내 최고 실력'을 보여줌.
export function bestLabelForKey(gameKey) { const d = DIFFICULTIES.find((x) => x.gameKey === gameKey); return d ? d.label : (DIFFICULTIES[0]?.label || ''); }
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
// 무한 모드 해제 = 마지막 급(고수) '보스'까지 통과 = rank가 보스 수(DIFFICULTIES.length=3)에 도달(2026-07-19 보스 사다리 개편, 구 '고수5 스테이지 해제' 폐기).
//  token은 호출부 시그니처 호환용(현재 미사용) — 해제는 순수 rank 함수.
export function isEndlessUnlocked(token, rank = 0) { return rank >= DIFFICULTIES.length; } // eslint-disable-line no-unused-vars
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

// ── 스테이지(난이도 세분화, 2026-07-16) ─────────────────
// 각 난이도(티어)를 난이도순 5밴드로 나눔. 밴드=티어 풀을 난이도순 5구간으로 나눠 플레이. 새 단어 안 만들고 정렬만.
// gameKey는 티어 유지(무한·업적·헤드라인·서버 동기 호환) — 스테이지별 점수는 별도 경량 저장(stageScores)으로 별·해제 계산.
export const STAGES_PER_TIER = 5;
export const STARS_PER_STAGE = 3;
// 급 전환(초→중→고): 이전 급을 '다 깨야'(모든 스테이지 별 1개↑) — 비연속 잠금 없이 깔끔한 순차(2026-07-16 사용자 결정, 구 별7개 폐기)
export const STAGES = DIFFICULTIES.flatMap((d) => Array.from({ length: STAGES_PER_TIER }, (_, i) => ({
  tier: d.id, tierLabel: d.label, bandIndex: i,
  id: `${d.id}-${i + 1}`, label: `${d.label} ${i + 1}`,
  gameKey: d.gameKey, timeMultiplier: d.timeMultiplier, // 기록·페이스는 티어 공유
})));
// 1판(ROUND_LENGTH단어) 이론상 최고점 — 무실수+즉답(콤보 보너스 i*20 + 시간보너스 timeLimit/100). 별 임계 기준.
export function tierMaxScore(mult) {
  let sum = 0;
  for (let i = 1; i <= ROUND_LENGTH; i += 1) {
    const tl = Math.max(4000, getTimeLimitForCombo(i - 1, mult)); // 단어 i 타이머 = 콤보(i-1) 기준
    sum += 100 + i * 20 + Math.floor(tl / 100);
  }
  return sum;
}
// 스테이지 별 3개 임계 = 1판 최고점의 1/3·2/3·3/3(사용자 결정 2026-07-16)
export function stageStarScores(mult) {
  const m = tierMaxScore(mult);
  return [Math.round(m / 3), Math.round((m * 2) / 3), m];
}
// 스테이지별 최고 점수 — 경량 별도 저장(기록 gameKey는 티어 공유라 스테이지 구분 불가 → 여기서 별 계산)
function stageScoresKey(token) { return `game_stage_scores_${token}`; }
export function loadStageScores(token) { try { return JSON.parse(localStorage.getItem(stageScoresKey(token)) || '{}') || {}; } catch { return {}; } }
export function stageScoreOf(token, id) { return loadStageScores(token)[id] || 0; }
export function saveStageScore(token, id, score) {
  try { const m = loadStageScores(token); if ((score || 0) > (m[id] || 0)) { m[id] = score; localStorage.setItem(stageScoresKey(token), JSON.stringify(m)); } } catch { /* noop */ }
}
export function stageStars(token, stage) {
  const best = stageScoreOf(token, stage.id);
  return stageStarScores(stage.timeMultiplier).filter((s) => best >= s).length;
}
export function stageStarFlags(token, stage) {
  const best = stageScoreOf(token, stage.id);
  return stageStarScores(stage.timeMultiplier).map((s) => best >= s);
}
export function tierTotalStars(token, tierId) {
  return STAGES.filter((s) => s.tier === tierId).reduce((sum, s) => sum + stageStars(token, s), 0);
}
// 급 클리어 진행 — 별 1개 이상인 스테이지 수 / 5
export function tierClearedCount(token, tierId) {
  return STAGES.filter((s) => s.tier === tierId).filter((s) => stageStars(token, s) >= 1).length;
}
export function isTierCleared(token, tierId) {
  return tierClearedCount(token, tierId) >= STAGES_PER_TIER;
}

// ── 보스(급 관문 = 승급시험, 2026-07-19 보스 사다리) ─────
// 각 급 끝의 보스 = 승급시험. 급 5스테이지를 다 깨면(isTierCleared) 응시 가능, 합격하면 rank+1 → 다음 급 해제 + 등급↑.
// rank(=깬 보스 수, gameXp에 저장)로 진행 인코딩: 급 idx i 보스 통과 ⟺ rank > i. 보스 3개로 등급(rank) 0→3 구동.
export const BOSSES = DIFFICULTIES.map((d, i) => ({
  tier: d.id, tierLabel: d.label, tierIdx: i, kind: 'boss',
  id: `${d.id}-boss`, label: `${d.label} 보스`,
  gameKey: d.gameKey, timeMultiplier: d.timeMultiplier,
}));
export function bossOfTier(tierId) { return BOSSES.find((b) => b.tier === tierId) || null; }
export function bossTierIdx(tierId) { return DIFFICULTIES.findIndex((d) => d.id === tierId); }
// 보스 상태: 'beaten'(이미 통과) | 'ready'(급 클리어·응시 가능) | 'locked'(급 미클리어) | 'prev'(앞 급 보스부터)
export function bossState(token, tierIdx, rank = 0) {
  if (rank > tierIdx) return 'beaten';
  if (rank < tierIdx) return 'prev';
  return isTierCleared(token, DIFFICULTIES[tierIdx].id) ? 'ready' : 'locked';
}
export function isBossUnlocked(token, tierIdx, rank = 0) { return bossState(token, tierIdx, rank) === 'ready'; }

// ── 보스 사다리 마이그레이션(2026-07-19) ──
// 기존 유저가 구 스테이지 시스템에서 (isTierCleared로) 이미 연 급을 보스 rank로 1회 승계 — 개편 전 진행 손실 방지.
// 아래(입문)부터 연속으로 5스테이지 클리어된 급 수 = 승계 rank.
export function earnedRankFromTiers(token) {
  let r = 0;
  for (let i = 0; i < DIFFICULTIES.length; i += 1) {
    if (isTierCleared(token, DIFFICULTIES[i].id)) r = i + 1; else break;
  }
  return r;
}
// 1회 마이그레이션 — 플래그 없으면 rank를 max(현재, 급클리어 승계)로 올리고 플래그 세팅. 이후엔 보스로만 오름(신규 진행 자동승급 방지).
export function migrateRankForBoss(token, currentRank = 0) {
  const KEY = `game_boss_migrated_${token}`;
  try {
    if (localStorage.getItem(KEY)) return currentRank;
    const earned = earnedRankFromTiers(token);
    localStorage.setItem(KEY, '1');
    return Math.max(currentRank, earned);
  } catch { return currentRank; }
}
// 단어 난이도 추정 — 음절 수 지배 + 성조 난이도(3성>경성>2성>1·4성). 강사님 단어가 들어와도 자동 정렬됨.
export function wordDifficulty(w) {
  const tones = (w && w.tones) || [];
  let tone = 0;
  for (const t of tones) tone += (t === 3 ? 3 : t === 0 ? 2 : t === 2 ? 1 : 0);
  return tones.length * 100 + tone;
}
// 티어 풀 → 난이도순 5밴드(각 밴드 = 단어 배열)
export function stageBands(pool) {
  const sorted = [...(pool || [])].sort((a, b) => wordDifficulty(a) - wordDifficulty(b));
  const bands = Array.from({ length: STAGES_PER_TIER }, () => []);
  const n = sorted.length || 1;
  sorted.forEach((w, i) => bands[Math.min(STAGES_PER_TIER - 1, Math.floor((i * STAGES_PER_TIER) / n))].push(w));
  return bands;
}
// 스테이지 한 판 단어 풀 = 해당 밴드 + 부족분을 인접 밴드에서 보충(≥minCount). 단어가 늘면 밴드만으로 참.
export function stageRoundPool(pool, bandIndex, minCount = 10) {
  const bands = stageBands(pool);
  let out = [...(bands[bandIndex] || [])];
  for (let dd = 1; dd < STAGES_PER_TIER && out.length < minCount; dd++) {
    if (bands[bandIndex - dd]) out = out.concat(bands[bandIndex - dd]);
    if (out.length < minCount && bands[bandIndex + dd]) out = out.concat(bands[bandIndex + dd]);
  }
  return out.length ? out : (pool || []);
}
function prevStageOf(stage) { return stage.bandIndex > 0 ? STAGES.find((s) => s.tier === stage.tier && s.bandIndex === stage.bandIndex - 1) : null; }
// 해제 규칙: 급 첫 스테이지=이전 급 별 총합 ≥ TIER_ADVANCE_STARS(초급1은 항상). 그 외=직전 스테이지 별 ≥ 1.
export function isStageUnlocked(token, stage, rank = 0) {
  if (stage.bandIndex === 0) {
    const tierIdx = DIFFICULTIES.findIndex((d) => d.id === stage.tier);
    if (tierIdx <= 0) return true;
    // 급 첫 스테이지 = 이전 급 '보스(승급시험)' 통과로 열림. rank=깬 보스 수 → rank>=tierIdx면 이전 급 보스 통과.
    return rank >= tierIdx;
  }
  const prev = prevStageOf(stage);
  return prev ? stageStars(token, prev) >= 1 : true; // 급 내: 직전 스테이지 별 1개↑
}
// 트레이닝 풀 = 현재 '열린' 스테이지들의 밴드 단어 합집합(hanzi 중복 제거). 진도 따라 자동 확장 —
//   입문1만 열렸으면 입문1 단어만, 스테이지가 열릴수록 범위가 넓어진다. 잠긴 스테이지 단어는 안 섞임.
//   wordPoolByDiff: { [tier]: word[] }. 밴드는 티어별 1회만 계산(sort 반복 방지). 선정 가중은 호출부 buildRoundWords가 담당.
export function unlockedTrainingPool(token, wordPoolByDiff, rank = 0) {
  const seen = new Set(); const out = []; const bandsByTier = {};
  for (const stage of STAGES) {
    if (!isStageUnlocked(token, stage, rank)) continue;
    const pool = (wordPoolByDiff && wordPoolByDiff[stage.tier]) || [];
    if (pool.length === 0) continue;
    const bands = bandsByTier[stage.tier] || (bandsByTier[stage.tier] = stageBands(pool));
    for (const w of (bands[stage.bandIndex] || [])) {
      if (!seen.has(w.hanzi)) { seen.add(w.hanzi); out.push(w); }
    }
  }
  return out;
}
// 해제 진행(게이지·문구용) — 급경계=이전 급 클리어 수({kind:'cleared',cur,need:5}), 급내=직전 스테이지 별1 점수({kind:'score',cur,need}). 열려있으면 null.
export function stageUnlockProgress(token, stage, rank = 0) {
  if (isStageUnlocked(token, stage, rank)) return null;
  if (stage.bandIndex === 0) {
    // 급 첫 스테이지는 이전 급 '보스(승급시험)' 통과로 열림.
    const tierIdx = DIFFICULTIES.findIndex((d) => d.id === stage.tier);
    const prevTier = tierIdx > 0 ? DIFFICULTIES[tierIdx - 1] : null;
    return { kind: 'boss', prevLabel: prevTier ? prevTier.label : '' };
  }
  const prev = prevStageOf(stage);
  const firstStar = stageStarScores(prev.timeMultiplier)[0];
  return { kind: 'score', cur: stageScoreOf(token, prev.id), need: firstStar, prevLabel: prev.label };
}
export function stageUnlockToastText(token, stage, rank = 0) {
  const p = stageUnlockProgress(token, stage, rank);
  if (!p) return '';
  return p.kind === 'boss'
    ? `${p.prevLabel} 보스를 이기면 열려요`
    : `${p.prevLabel} 별 하나면 열려요`;
}

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
// 테마 성취 별(0~3) — 한 판 최고점 구간별 별 개수. **콤보 조건 없이 순수 점수 기준**(2026-07-16 사용자 결정).
// 점수 임계가 오름차순이라 별은 항상 왼쪽부터 연속 채워짐(구멍 없음). ★2=1000은 잠금 해제 기준(UNLOCK_THRESHOLD)과 정합.
// 임계값(특히 ③1800)은 점수 분포 보고 튜닝 여지. 1판 이론상 최고 ≈3,440(무실수+즉답), 현실 풀콤보 ≈2,500~2,900.
export const THEME_STAR_SCORES = [500, 1000, 1800];
export function themeStars(best) { return THEME_STAR_SCORES.filter((s) => best >= s).length; }
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
// 스테이지 단위 신기록 판정 — 입문4의 기록은 입문4끼리만 비교(티어 공유 아님, 2026-07-18 사용자 결정).
//  티어 best(resolveEndOutcome)는 헤드라인·서버·업적·무한해제용으로 그대로 유지하고, 여기서 display/비트/사운드만
//  스테이지 baseline으로 덮어쓴다. 무한 해제음(unlock)은 티어 1000점 임계 기준이라 그대로 둔다.
export function stageOutcome(token, stage, tierOutcome, score) {
  const previousBest = stageScoreOf(token, stage.id);
  const isNewBest = score > previousBest;
  const sfx = tierOutcome.sfx === 'unlock' ? 'unlock' : (isNewBest ? 'win' : 'gameover');
  return { ...tierOutcome, isNewBest, previousBest, sfx };
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
