// 단어별 숙련도 통계 — 무실수 정답률 + 평균 반응속도.
// 하이브리드 저장: localStorage 글로벌(표시·복습선정의 source) + 난이도별 게임기록 meta.w 동기화(영구).
// entry 형식(압축): [attempts, perfect, totalCompletedMs, completedCount]
//   attempts        : 단어가 등장해 끝난(완료/시간초과) 횟수
//   perfect         : 무실수 클리어(오답·시간초과 없이 한 번에) 횟수
//   totalCompletedMs: 시간초과 아닌 완료들의 소요시간 합
//   completedCount  : 시간초과 아닌 완료 횟수 (평균속도 분모)
// 참조 메모리: tone_game_redesign.md (단어 숙련도/복습)

export const MASTER_MIN_ATTEMPTS = 2;   // 마스터 판정 최소 시도수(1회 우연 100% 방지)
export const MASTER_ACCURACY = 0.8;     // 마스터 판정 정답률 기준

function statsKey(token) { return token ? `game_words_${token}` : 'game_words'; }

export function loadWordStats(token) {
  try { const raw = localStorage.getItem(statsKey(token)); return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}
export function saveWordStats(token, stats) {
  try { localStorage.setItem(statsKey(token), JSON.stringify(stats)); } catch { /* quota 등 무시 */ }
}

// 한 단어 결과 1건 반영(글로벌 stats를 직접 변형 후 반환).
export function recordWordResult(stats, hanzi, { perfect, timedOut, ms }) {
  const e = stats[hanzi] ? [...stats[hanzi]] : [0, 0, 0, 0];
  e[0] += 1;
  if (perfect) e[1] += 1;
  if (!timedOut) { e[2] += Math.max(0, Math.round(ms || 0)); e[3] += 1; }
  stats[hanzi] = e;
  return stats;
}

export function accuracy(e) { return e && e[0] > 0 ? e[1] / e[0] : 0; }
export function avgMs(e) { return e && e[3] > 0 ? e[2] / e[3] : 0; }
export function isMastered(e) { return !!e && e[0] >= MASTER_MIN_ATTEMPTS && accuracy(e) >= MASTER_ACCURACY; }
// 리스트 노출 대상: 시도 1+ 이고 정답률 80% 미만(= 아직 약한 단어)
export function needsReview(e) { return !!e && e[0] > 0 && accuracy(e) < MASTER_ACCURACY; }

// 글로벌 stats + 단어맵(hanzi→word) → 복습필요 리스트(약한 순). word엔 {hanzi,pinyin,tones,meaning,(diff)}.
export function buildReviewList(stats, wordMap) {
  const rows = [];
  for (const hz of Object.keys(stats)) {
    const w = wordMap[hz];
    if (!w) continue;                 // 풀에 없는(삭제된) 단어는 제외
    if (!needsReview(stats[hz])) continue;
    rows.push({ word: w, e: stats[hz], acc: accuracy(stats[hz]), avg: avgMs(stats[hz]) });
  }
  rows.sort((a, b) => a.acc - b.acc || b.avg - a.avg); // 정답률 낮은 순, 동률이면 느린 순
  return rows;
}
export function masteredCount(stats, wordMap) {
  let n = 0;
  for (const hz of Object.keys(stats)) { if (wordMap[hz] && isMastered(stats[hz])) n += 1; }
  return n;
}

// 난이도별 meta.w 동기화용: 해당 풀에 있는 단어 통계만 추림(블롭 작게).
export function subsetForPool(stats, pool) {
  const out = {};
  for (const w of (pool || [])) { if (stats[w.hanzi]) out[w.hanzi] = stats[w.hanzi]; }
  return out;
}
// 서버 meta.w(여러 난이도) → 글로벌 병합. 단어별 시도수(attempts) 많은 쪽을 최신으로 채택.
export function mergeStats(base, incoming) {
  const out = { ...(base || {}) };
  for (const hz of Object.keys(incoming || {})) {
    const inc = incoming[hz];
    if (!Array.isArray(inc)) continue;
    if (!out[hz] || inc[0] > out[hz][0]) out[hz] = inc;
  }
  return out;
}
