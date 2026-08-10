// 단어별 숙련도 통계 — 무실수 정답률 + 평균 반응속도 + 오답 노트 카운터.
// 하이브리드 저장: localStorage 글로벌(표시·복습선정의 source) + 난이도별 게임기록 meta.w 동기화(영구).
// entry 형식(압축): [attempts, perfect, totalCompletedMs, completedCount, mastered?, noteLeft?]
//   attempts        : 단어가 등장해 끝난(완료/시간초과) 횟수
//   perfect         : 무실수 클리어(오답·시간초과 없이 한 번에) 횟수
//   totalCompletedMs: 시간초과 아닌 완료들의 소요시간 합
//   completedCount  : 시간초과 아닌 완료 횟수 (평균속도 분모)
//   mastered        : ★마스터 플래그(0/1, 히스테리시스 — 2026-07-04 등급 강등 도입). 진입 ≥80%, 해제는 <60%로
//                     떨어질 때만 → 경계(80%) 걸친 단어의 등급 요요 방지. 레거시 4튜플은 첫 기록 때 기존 규칙으로 시드.
//   noteLeft        : ★오답 노트 카운터(0=노트 밖, 1~3=노트 안이며 졸업까지 남은 정답 횟수) — 2026-08-10 규칙 개편.
//                     구 규칙(누적 정답률<80%)은 시도가 쌓인 단어가 영영 못 나가고, 새 단어는 한 번에 나가 예측이 안 됐다.
// 참조 메모리: tone_game_redesign.md (단어 숙련도/복습 · 등급 강등)

export const MASTER_MIN_ATTEMPTS = 2;      // 마스터 판정 최소 시도수(1회 우연 100% 방지)
export const MASTER_ACCURACY = 0.8;        // 마스터 '진입' 정답률 기준
export const MASTER_EXIT_ACCURACY = 0.6;   // 마스터 '해제' 정답률(진입보다 낮게 — 히스테리시스)
export const NOTE_TARGET = 3;              // 오답 노트 졸업에 필요한 정답 횟수(연속 아님 — 누적)

function statsKey(token) { return token ? `game_words_${token}` : 'game_words'; }

export function loadWordStats(token) {
  try { const raw = localStorage.getItem(statsKey(token)); return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}
export function saveWordStats(token, stats) {
  try { localStorage.setItem(statsKey(token), JSON.stringify(stats)); } catch { /* quota 등 무시 */ }
}

// 한 단어 결과 1건 반영(글로벌 stats를 직접 변형 후 반환). 마스터 플래그·오답 노트 카운터도 여기서 갱신.
export function recordWordResult(stats, hanzi, { perfect, timedOut, ms }) {
  const e = Array.isArray(stats[hanzi]) ? [...stats[hanzi]] : [0, 0, 0, 0]; // 손상·레거시 비배열 엔트리 spread TypeError 방지
  // 이번 결과 반영 '전' 마스터 상태 — 레거시 4튜플은 기존 규칙(누적 ≥80%)으로 시드(자동 마이그레이션)
  const prevMastered = e.length > 4 && typeof e[4] === 'number'
    ? !!e[4]
    : (e[0] >= MASTER_MIN_ATTEMPTS && (e[0] > 0 ? e[1] / e[0] : 0) >= MASTER_ACCURACY);
  const prevLeft = noteLeft(e); // ★반영 '전' 값 — 레거시 시드가 이번 판 결과에 오염되지 않게 attempts 증가보다 먼저
  e[0] += 1;
  if (perfect) e[1] += 1;
  if (!timedOut) { e[2] += Math.max(0, Math.round(ms || 0)); e[3] += 1; }
  const acc = e[1] / e[0];
  // 히스테리시스: 미마스터→진입은 ≥80%(시도 2+), 마스터→해제는 <60%일 때만(그 사이 60~80%는 현상 유지)
  e[4] = (prevMastered ? acc >= MASTER_EXIT_ACCURACY : (e[0] >= MASTER_MIN_ATTEMPTS && acc >= MASTER_ACCURACY)) ? 1 : 0;
  // 오답 노트 카운터 — perfect(혼자 힘으로 한 번에 맞힘)만 졸업 1칸. 나머지(성조 틀림·시간초과·건너뛰기·정답보기·힌트)는 전부 '오답'.
  //  노트 밖에서 틀리면 신규 등록(3), 노트 안에서 또 틀리면 리셋이 아니라 한 칸 후퇴(+1, 최대 3) —
  //  "연속 정답은 요구하지 않는다"는 규칙과 어긋나지 않게(2026-08-10 사용자 결정).
  e[5] = perfect
    ? Math.max(0, prevLeft - 1)
    : (prevLeft === 0 ? NOTE_TARGET : Math.min(NOTE_TARGET, prevLeft + 1));
  stats[hanzi] = e;
  return stats;
}

export function accuracy(e) { return e && e[0] > 0 ? e[1] / e[0] : 0; }
export function avgMs(e) { return e && e[3] > 0 ? e[2] / e[3] : 0; }
// 마스터 판정 — 플래그(히스테리시스) 우선, 플래그 없는 레거시 항목은 기존 규칙 폴백
export function isMastered(e) {
  if (!e) return false;
  if (e.length > 4 && typeof e[4] === 'number') return !!e[4];
  return e[0] >= MASTER_MIN_ATTEMPTS && accuracy(e) >= MASTER_ACCURACY;
}
// 오답 노트 졸업까지 남은 정답 횟수(0=노트 밖). 카운터 도입 전 엔트리는 구 규칙(시도≥1 & 정답률<80%)으로 시드 —
//  이미 노트에 떠 있던 단어가 업데이트 순간 사라지지 않고, 앞으로 정답 3번이면 졸업한다.
export function noteLeft(e) {
  if (!e) return 0;
  if (e.length > 5 && typeof e[5] === 'number') return e[5];
  return (e[0] > 0 && accuracy(e) < MASTER_ACCURACY) ? NOTE_TARGET : 0;
}
// 리스트 노출 대상 = 오답 노트에 등록된 단어(1번 이상 틀렸고 아직 정답 3번을 못 채움)
export function needsReview(e) { return noteLeft(e) > 0; }

// 글로벌 stats + 단어맵(hanzi→word) → 오답 노트 리스트(멀리 남은 순). word엔 {hanzi,pinyin,tones,meaning,(diff)}.
export function buildReviewList(stats, wordMap) {
  const rows = [];
  for (const hz of Object.keys(stats)) {
    const w = wordMap[hz];
    if (!w) continue;                 // 풀에 없는(삭제된) 단어는 제외
    const left = noteLeft(stats[hz]);
    if (left <= 0) continue;
    rows.push({ word: w, e: stats[hz], acc: accuracy(stats[hz]), avg: avgMs(stats[hz]), left });
  }
  rows.sort((a, b) => b.left - a.left || a.acc - b.acc || b.avg - a.avg); // 갈 길 먼 순 → 정답률 낮은 순 → 느린 순
  return rows;
}
export function masteredCount(stats, wordMap) {
  let n = 0;
  for (const hz of Object.keys(stats)) { if (wordMap[hz] && isMastered(stats[hz])) n += 1; }
  return n;
}

// 라운드 단어 선택 — 교육적 가중 추첨(은은하게).
// 완전 랜덤 대신, 단어별 가중치로 비복원 추첨해 약점 단어를 더 자주 노출하되
// 신규·마스터 단어도 계속 섞여 나오게 한다(같은 단어 반복 피로 방지·전체 노출 보장).
// 가중치: 약점(오답 노트 등록) 3.0 > 신규(미시도) 2.5 > 익숙(1회 양호·마스터 전) 1.5 > 마스터 1.0.
// 마스터도 0이 아니라 1.0 → 영구 제외 없음(망각 방지). 첫 플레이(통계 0)엔 전부 신규=거의 균등.
// 풀 크기가 n 이하면 가중치 의미 없으므로 전부 셔플 반환.
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
export function buildRoundWords(pool, stats, n) {
  const list = Array.isArray(pool) ? [...pool] : [];
  if (list.length <= n) return shuffleInPlace(list);
  const weightOf = (w) => {
    const e = stats && stats[w.hanzi];
    if (!e || e[0] === 0) return 2.5;   // 신규(미시도)
    if (needsReview(e)) return 3.0;     // 약점(오답 노트에 올라 있음)
    if (isMastered(e)) return 1.0;      // 마스터(가끔 복습)
    return 1.5;                         // 익숙(1회 양호, 마스터 전)
  };
  const cand = list.map((w) => ({ w, weight: weightOf(w) }));
  const picked = [];
  while (picked.length < n && cand.length > 0) {
    let total = 0;
    for (const c of cand) total += c.weight;
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < cand.length - 1; idx++) { r -= cand[idx].weight; if (r <= 0) break; }
    picked.push(cand[idx].w);
    cand.splice(idx, 1);
  }
  return picked;
}

// 난이도별 meta.w 동기화용: 해당 풀에 있는 단어 통계만 추림(블롭 작게).
export function subsetForPool(stats, pool) {
  const out = {};
  for (const w of (pool || [])) { if (stats[w.hanzi]) out[w.hanzi] = stats[w.hanzi]; }
  return out;
}
// 서버 meta.w(여러 난이도) → 글로벌 병합. 단어별 시도수(attempts) 많은 쪽을 최신으로 채택.
//  단 오답 노트 카운터만은 양쪽 중 '더 진행된 쪽'(작은 값)을 살린다 — 다른 기기에서 3번 맞혀 졸업시킨 단어가
//  시도수만 많은 오래된 사본 때문에 노트로 되살아나지 않게.
export function mergeStats(base, incoming) {
  const out = { ...(base || {}) };
  for (const hz of Object.keys(incoming || {})) {
    const inc = incoming[hz];
    if (!Array.isArray(inc)) continue;
    const cur = out[hz];
    if (!Array.isArray(cur)) { out[hz] = inc; continue; }
    const merged = [...(inc[0] > cur[0] ? inc : cur)];
    if (typeof merged[4] !== 'number') merged[4] = isMastered(merged) ? 1 : 0; // 레거시 4튜플 — 아래 [5] 대입이 구멍(hole) 남기지 않게
    merged[5] = Math.min(noteLeft(cur), noteLeft(inc));
    out[hz] = merged;
  }
  return out;
}
