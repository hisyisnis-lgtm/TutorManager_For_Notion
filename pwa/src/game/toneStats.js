// 성조별 정답률 — 1·2·3·4·경성(0) 각각 [정답, 시도]. 성조 레이더(P2)·약점 진단의 데이터.
// 단어별 숙련도(tgWordStats)와 별개: 그건 "어느 단어가 약한가", 이건 "어느 성조가 약한가".
// 기록 단위 = 성조 버튼 탭 1회(기대 성조 기준). 저장: localStorage(게스트 포함, 기기별 — 서버 동기화는 후속).
// 참조 메모리: tone_game_redesign.md (성취 레이어 P1)

export const TONE_NUMS = [1, 2, 3, 4, 0]; // 경성=0

// 탭 1건 반영(stats를 직접 변형 후 반환). tone=기대 성조, correct=맞췄는지.
export function recordTone(stats, tone, correct) {
  const e = stats[tone] ? [...stats[tone]] : [0, 0];
  e[1] += 1;            // 시도
  if (correct) e[0] += 1; // 정답
  stats[tone] = e;
  return stats;
}

export function toneAccuracy(e) { return e && e[1] > 0 ? e[0] / e[1] : 0; }
export function toneAttempts(e) { return e ? (e[1] || 0) : 0; }

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

// ── localStorage ──────────────────────────────────────
function toneKey(token) { return token ? `game_tone_${token}` : 'game_tone'; }
export function loadToneStats(token) {
  try { const raw = localStorage.getItem(toneKey(token)); return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}
export function saveToneStats(token, stats) {
  try { localStorage.setItem(toneKey(token), JSON.stringify(stats)); } catch { /* 무시 */ }
}
