// 성조별 정답률 — 1·2·3·4·경성(0) 각각 [정답, 시도, ema]. 성조 레이더(P2)·약점 진단·홈 캐릭터 레벨의 데이터.
// 단어별 숙련도(tgWordStats)와 별개: 그건 "어느 단어가 약한가", 이건 "어느 성조가 약한가".
// 기록 단위 = 성조 버튼 탭 1회(기대 성조 기준). 저장: localStorage(게스트 포함, 기기별 — 서버 동기화는 후속).
// ★ ema(3번째 원소) = 최근 가중 정확도(지수이동평균, α=0.1 ≈ 최근 ~20회 반영). 평생 누적은 시도가 쌓일수록
//   한 판의 성과가 반영 안 돼 레벨이 고착 → 화면 표시·레벨·약점 진단은 전부 ema 기준으로 통일.
//   레거시 [정답,시도] 2원소 항목은 첫 기록 때 누적 정확도로 시드(자동 마이그레이션)·구버전은 3번째 원소 무시(롤백 안전).
// 참조 메모리: tone_game_redesign.md (성취 레이어 P1 · EMA 전환)

export const TONE_NUMS = [1, 2, 3, 4, 0]; // 경성=0
export const EMA_ALPHA = 0.1; // 최근 가중치 — 크면 요요(레벨 널뛰기), 작으면 고착. 0.1 = 완만한 최근 반영

// 탭 1건 반영(stats를 직접 변형 후 반환). tone=기대 성조, correct=맞췄는지.
export function recordTone(stats, tone, correct) {
  const e = Array.isArray(stats[tone]) ? [...stats[tone]] : [0, 0]; // 손상·레거시 비배열 엔트리 spread TypeError 방지
  const x = correct ? 1 : 0;
  // ema 시드: 기존 ema > 레거시 누적 정확도 > 첫 기록이면 이번 결과
  const seed = typeof e[2] === 'number' ? e[2] : (e[1] > 0 ? e[0] / e[1] : x);
  e[1] += 1;            // 시도
  if (correct) e[0] += 1; // 정답
  e[2] = seed + (x - seed) * EMA_ALPHA; // 첫 기록은 seed=x라 그대로 x
  stats[tone] = e;
  return stats;
}

// 정답률 — ema(최근 가중) 우선, 레거시 항목은 누적 정확도 폴백. 시도 0이면 0.
export function toneAccuracy(e) {
  if (!e || !(e[1] > 0)) return 0;
  return typeof e[2] === 'number' ? e[2] : e[0] / e[1];
}

// 가장 약한 성조(시도 minAttempts 이상 중 정답률 최저). 없으면 null.
export function weakestTone(stats, minAttempts = 3) {
  let worst = null;
  for (const t of TONE_NUMS) {
    const e = stats[t];
    if (!e || e[1] < minAttempts) continue;
    const acc = toneAccuracy(e);
    if (worst === null || acc < worst.acc) worst = { tone: t, acc };
  }
  return worst;
}

// 모든 성조(시도 minAttempts 이상)가 정답률 threshold 이상인가. 성조 마스터 업적용.
// 시도 부족한 성조가 하나라도 있으면 false(아직 판정 불가).
export function allTonesAbove(stats, threshold = 0.9, minAttempts = 5) {
  for (const t of TONE_NUMS) {
    const e = stats[t];
    if (!e || e[1] < minAttempts) return false;
    if (toneAccuracy(e) < threshold) return false;
  }
  return true;
}

// 조건(시도 minAttempts 이상 + 정답률 threshold 이상)을 만족하는 성조 수(0~5). 성조 마스터 업적 진행도용.
export function countTonesAbove(stats, threshold = 0.9, minAttempts = 5) {
  let n = 0;
  for (const t of TONE_NUMS) {
    const e = (stats || {})[t];
    if (e && e[1] >= minAttempts && toneAccuracy(e) >= threshold) n++;
  }
  return n;
}

// ── localStorage ──────────────────────────────────────
function toneKey(token) { return token ? `game_tone_${token}` : 'game_tone'; }
export function loadToneStats(token) {
  try { const raw = localStorage.getItem(toneKey(token)); return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}
export function saveToneStats(token, stats) {
  try { localStorage.setItem(toneKey(token), JSON.stringify(stats)); } catch { /* 무시 */ }
}
