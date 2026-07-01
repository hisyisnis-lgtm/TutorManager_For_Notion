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

// 보호권(스트릭 프리즈) — "하루 빠져도 스트릭을 지켜줌". 벌어서 갖고, 공백 시 자동 소비.
//  압박(FOMO) 완화 장치: 벌은 없고 방어만. 저장은 스트릭과 분리(지갑).
export const FREEZE_CAP = 2;         // 최대 보유
export const FREEZE_EARN_EVERY = 7;  // current가 7의 배수 도달 시 +1 (주간 리필)

// 순수 전이 — 이전 스트릭 상태 + 오늘 날짜키(+보유 보호권) → 새 상태.
//  prev: { lastDate, current, longest } | null
//  같은 날=무변화 / 다음날=+1 / 공백이라도 빠진 날 수 ≤ 보호권(최대 2)이면 브릿지(+1) / 그 외=리셋.
//  freezes 미전달(=0)이면 기존 동작 그대로(공백=리셋). 시계 역행(gap≤0)=무변화. longest는 최댓값 유지.
export function advanceStreak(prev, todayKey, freezes = 0) {
  if (!prev || !prev.lastDate) return { lastDate: todayKey, current: 1, longest: 1 };
  if (prev.lastDate === todayKey) return { ...prev };           // 오늘 이미 셈 — 변화 없음
  const gap = diffDays(prev.lastDate, todayKey);
  if (gap <= 0) return { ...prev };                             // 시계 역행 등 — 무변화(리셋 안 함)
  const missed = gap - 1;                                       // 빠진 날 수(gap1=0)
  const bridged = missed >= 1 && missed <= freezes && missed <= FREEZE_CAP; // 보호권으로 공백 메움
  const current = (gap === 1 || bridged) ? (prev.current || 0) + 1 : 1;
  const longest = Math.max(prev.longest || 0, current);
  return { lastDate: todayKey, current, longest };
}

// 오늘 플레이 안 했어도, 마지막 플레이가 (보호권으로 못 메우는) 과거면 현재 스트릭은 사실상 끊긴 상태.
// 표시용: 저장값을 건드리지 않고 "지금 시점의 유효 현재 스트릭"을 계산. 보호권이 지켜줄 공백은 살아있음으로 표시.
export function effectiveCurrent(state, todayKey, freezes = 0) {
  if (!state || !state.lastDate) return 0;
  if (state.lastDate === todayKey) return state.current || 0;
  const gap = diffDays(state.lastDate, todayKey);
  if (gap <= 0) return state.current || 0;
  const missed = gap - 1;
  return missed <= Math.min(freezes, FREEZE_CAP) ? (state.current || 0) : 0; // gap1(missed0)도 여기서 살아있음
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

function freezeKey(token) { return token ? `game_streak_freeze_${token}` : 'game_streak_freeze'; }
export function loadFreezes(token) {
  try { const n = parseInt(localStorage.getItem(freezeKey(token)) || '0', 10); return Number.isFinite(n) ? Math.max(0, Math.min(FREEZE_CAP, n)) : 0; }
  catch { return 0; }
}
export function saveFreezes(token, n) {
  try { localStorage.setItem(freezeKey(token), String(Math.max(0, Math.min(FREEZE_CAP, n || 0)))); } catch { /* 무시 */ }
}

// 오늘 플레이 1건 반영 — load → advance → save + 보호권 소비/획득.
//  반환: { lastDate, current, longest, freezeUsed, freezeEarned, freezes } (freezeUsed/Earned=이번 판 알림용)
export function recordPlay(token, now = new Date()) {
  const today = dateKeyKST(now);
  const prev = loadStreak(token);
  const prevFreezes = loadFreezes(token);
  const next = advanceStreak(prev, today, prevFreezes);
  saveStreak(token, next);
  // 소비 — advanceStreak이 브릿지한 만큼(빠진 날 수). 브릿지 여부는 current가 이어졌는지로 판정.
  const gap = prev && prev.lastDate ? diffDays(prev.lastDate, today) : 0;
  const missed = gap > 0 ? gap - 1 : 0;
  const freezeUsed = (missed >= 1 && next.current > 1 && missed <= prevFreezes) ? missed : 0;
  let freezes = prevFreezes - freezeUsed;
  // 획득 — 이번 플레이로 current가 전진했고 새 current가 7의 배수(cap 초과분은 버려짐 → earned 0).
  let freezeEarned = 0;
  if (next.current > (prev?.current || 0) && next.current % FREEZE_EARN_EVERY === 0) {
    const before = freezes; freezes = Math.min(FREEZE_CAP, freezes + 1); freezeEarned = freezes - before;
  }
  saveFreezes(token, freezes);
  return { ...next, freezeUsed, freezeEarned, freezes };
}
