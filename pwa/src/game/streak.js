// 일일 스트릭 — "며칠 연속 플레이했나". 습관 루프(소개③ "하루 1분이 습관" 약속의 이행).
// 톤 원칙: 압박/FOMO 금지(서비스 정체성). 끊겨도 데이터는 그냥 1로 리셋 — "다시 왔네요"는 UI가 격려로 표현.
// 저장: localStorage(게스트 포함). 날짜 경계는 KST(UTC+9) 기준 — 자정 넘김이 한국 시간 기준.
// 참조 메모리: tone_game_redesign.md (성취 레이어 P1)

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// KST 기준 'YYYY-MM-DD' 날짜키. (UTC에 9시간 더한 뒤 날짜 부분만)
export function dateKeyKST(date = new Date()) {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

// 두 날짜키('YYYY-MM-DD') 사이 일수 차(b - a). 같은 날=0, 다음날=1.
export function diffDays(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

// 순수 전이 — 이전 스트릭 상태 + 오늘 날짜키 → 새 상태.
//  prev: { lastDate, current, longest } | null
//  같은 날 재플레이=무변화 / 바로 다음날=+1 / 그 외(공백·역행)=1로 리셋. longest는 항상 최댓값 유지.
export function advanceStreak(prev, todayKey) {
  if (!prev || !prev.lastDate) return { lastDate: todayKey, current: 1, longest: 1 };
  if (prev.lastDate === todayKey) return { ...prev };           // 오늘 이미 셈 — 변화 없음
  const gap = diffDays(prev.lastDate, todayKey);
  const current = gap === 1 ? (prev.current || 0) + 1 : 1;       // 연속이면 +1, 끊기면 다시 1
  const longest = Math.max(prev.longest || 0, current);
  return { lastDate: todayKey, current, longest };
}

// 오늘 플레이 안 했어도, 마지막 플레이가 어제보다 오래면 현재 스트릭은 사실상 끊긴 상태.
// 표시용: 저장값을 건드리지 않고 "지금 시점의 유효 현재 스트릭"을 계산.
export function effectiveCurrent(state, todayKey) {
  if (!state || !state.lastDate) return 0;
  if (state.lastDate === todayKey) return state.current || 0;
  return diffDays(state.lastDate, todayKey) === 1 ? (state.current || 0) : 0;
}

// ── localStorage ──────────────────────────────────────
function streakKey(token) { return token ? `game_streak_${token}` : 'game_streak'; }
export function loadStreak(token) {
  try { const raw = localStorage.getItem(streakKey(token)); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
export function saveStreak(token, data) {
  try { localStorage.setItem(streakKey(token), JSON.stringify(data)); } catch { /* quota 등 무시 */ }
}

// 오늘 플레이 1건 반영 — load → advance → save. 새 상태 반환.
export function recordPlay(token, now = new Date()) {
  const next = advanceStreak(loadStreak(token), dateKeyKST(now));
  saveStreak(token, next);
  return next;
}
