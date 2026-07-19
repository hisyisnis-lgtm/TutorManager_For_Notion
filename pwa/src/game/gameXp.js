// 성조게임 경험치(XP)·등급 — 누적 XP로 등급을 산정(투명 게이지). '마스터한 단어 수' 기준을 대체.
// 마스터/약점 개념은 복습·약점 학습 루프에 그대로 남고, 여기선 '등급 표시'만 XP로 분리한다.
//
// ★병합 규칙 = max(멱등). best/tierPeak와 동일. sum 금지 — applyGameDataToLocal은 게스트 1회 병합뿐
//   아니라 매 서버 pull에서도 호출되므로, sum이면 pull마다 local+server가 더해져 무한 인플레된다
//   (예전 재화 시스템을 철회하며 남긴 'earned 병합안전' 교훈이 정확히 이 지점).
//
// 등급 이름·엠블럼·글로우·파티클은 earProfile.EAR_TIERS 재사용(중복 정의 금지 — 좌표/에셋은 한 곳에서).
import { EAR_TIERS } from './earProfile.js';

// 등급 진입 누적 XP 임계값(EAR_TIERS와 같은 4단계). 1판 점수가 대략 1천~수천이라(computeScore: 100+콤보×20+시간)
// 첫 등급은 몇 판 만에, 최고 등급은 수십 판에 걸쳐 도달하도록 잡은 첫 튜닝값 — 실사용 XP 분포 보고 조정 가능.
export const XP_TIER_MIN = [0, 5000, 25000, 100000];

// 게임 1판 XP = 획득 점수 + 정답수×3 + (신기록 시 +100). 일반·무한·테마만 적립(연습·복습은 호출부에서 제외).
export const XP_PER_CORRECT = 3;
export const XP_NEWBEST_BONUS = 100;
export function gameXpGain({ score = 0, correct = 0, isNewBest = false }) {
  const s = Math.max(0, Math.round(score || 0));
  const c = Math.max(0, Math.floor(correct || 0));
  return s + c * XP_PER_CORRECT + (isNewBest ? XP_NEWBEST_BONUS : 0);
}

// 누적 XP → 등급. earTier와 같은 형태를 반환(idx·name·emblem·glow·spark·particles·next·toNext·progress·isMax)하되
// toNext/progress는 XP 기준. 소비처(HomeScreen·ProfileModal·MasteryScreen)는 earTier와 동일하게 쓴다.
export function xpTier(totalXp = 0) {
  const xp = Math.max(0, Math.floor(totalXp || 0));
  let idx = 0;
  for (let i = 0; i < XP_TIER_MIN.length; i++) if (xp >= XP_TIER_MIN[i]) idx = i;
  const cur = EAR_TIERS[idx];
  const next = EAR_TIERS[idx + 1] || null;
  const curMin = XP_TIER_MIN[idx];
  const nextMin = idx + 1 < XP_TIER_MIN.length ? XP_TIER_MIN[idx + 1] : null;
  const toNext = nextMin != null ? Math.max(0, nextMin - xp) : 0;
  const progress = nextMin != null ? Math.min(1, Math.max(0, (xp - curMin) / (nextMin - curMin))) : 1;
  return { idx, name: cur.name, emblem: cur.emblem, glow: cur.glow, spark: cur.spark, particles: cur.particles, next, toNext, progress, xp, isMax: !next };
}

// ── 로컬 저장(토큰별) ──
function xpKey(token) { return token ? `game_xp_${token}` : 'game_xp'; }
// 키 없으면 null(=미시딩 신호), 있으면 정수(0 포함).
export function loadXp(token) {
  try {
    const v = localStorage.getItem(xpKey(token));
    if (v == null) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch { return null; }
}
export function saveXp(token, xp) {
  try { localStorage.setItem(xpKey(token), String(Math.max(0, Math.floor(xp || 0)))); } catch { /* noop */ }
}
// 적립 — 현재 XP + gain 저장, 새 총합 반환.
export function addXp(token, gain) {
  const cur = loadXp(token) || 0;
  const next = cur + Math.max(0, Math.floor(gain || 0));
  saveXp(token, next);
  return next;
}
// 병합 — max(멱등). 서버 pull·게스트 병합 공용. sum 금지(위 헤더 참고).
export function mergeXp(local, incoming) {
  return Math.max(Math.max(0, Math.floor(local || 0)), Math.max(0, Math.floor(incoming || 0)));
}
// 마이그레이션 시딩 — XP 키가 없을 때만, 현재 등급(마스터 기준 idx)을 보존하도록 그 등급의 min XP로 1회 시딩.
// 기존 유저가 0으로 리셋되지 않고 지금 보이는 등급을 그대로 유지한 채 XP를 새로 쌓게 한다.
export function seedXpIfMissing(token, currentTierIdx = 0) {
  const cur = loadXp(token);
  if (cur != null) return cur;
  const i = Math.max(0, Math.min(XP_TIER_MIN.length - 1, Math.floor(currentTierIdx || 0)));
  const seed = XP_TIER_MIN[i];
  saveXp(token, seed);
  return seed;
}

// ── 등급(rank) — XP와 분리 저장(Phase 2). 등급은 '승급 시험' 합격으로만 오르며, XP가 임계를 넘어도
//   시험 전엔 승급하지 않는다. 우상향(강등 없음) → 병합·저장 모두 max. ──
function rankKey(token) { return token ? `game_rank_${token}` : 'game_rank'; }
const clampRank = (i) => Math.max(0, Math.min(XP_TIER_MIN.length - 1, Math.floor(i || 0)));
export function loadRank(token) {
  try {
    const v = localStorage.getItem(rankKey(token));
    if (v == null) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? clampRank(n) : null;
  } catch { return null; }
}
export function saveRank(token, idx) {
  try { localStorage.setItem(rankKey(token), String(clampRank(idx))); } catch { /* noop */ }
}
export function mergeRank(local, incoming) { return Math.max(clampRank(local), clampRank(incoming)); } // 우상향
// 없으면 현재 XP가 도달한 등급으로 1회 시딩(Phase 1 자동승급 상태를 승계). 이후엔 시험 합격으로만 오름.
export function seedRankIfMissing(token, totalXp) {
  const cur = loadRank(token);
  if (cur != null) return cur;
  const seed = xpTier(totalXp).idx;
  saveRank(token, seed);
  return seed;
}

// 표시 등급 — 저장된 rank 기준(시험 게이트). 게이지는 XP 진행(현재 rank 밴드 내, 상한 100%).
// examReady = XP가 다음 등급 임계 도달(게이지 만땅) → '승급 시험' 응시 가능.
export function displayTier(rank, totalXp) {
  const idx = clampRank(rank);
  const cur = EAR_TIERS[idx];
  const next = EAR_TIERS[idx + 1] || null;
  const curMin = XP_TIER_MIN[idx];
  const nextMin = idx + 1 < XP_TIER_MIN.length ? XP_TIER_MIN[idx + 1] : null;
  const xp = Math.max(0, Math.floor(totalXp || 0));
  const toNext = nextMin != null ? Math.max(0, nextMin - xp) : 0;
  const progress = nextMin != null ? Math.min(1, Math.max(0, (xp - curMin) / (nextMin - curMin))) : 1;
  const examReady = nextMin != null && xp >= nextMin;
  return { idx, name: cur.name, emblem: cur.emblem, glow: cur.glow, spark: cur.spark, particles: cur.particles, next, toNext, progress, xp, isMax: !next, examReady };
}

// ── 승급 시험 판정 ──
export const EXAM_QUESTIONS = 20;
export const EXAM_PASS_RATIO = 0.8;    // 80% (16/20)
export const EXAM_FAIL_PENALTY = 0.15; // 불합격 시 현재 등급 밴드 요구 XP의 15% 차감
export function examPassed(correct, total = EXAM_QUESTIONS) {
  return total > 0 && (correct | 0) / total >= EXAM_PASS_RATIO;
}
// 불합격 XP — 현재 등급 밴드(다음까지 필요 XP)의 15% 차감. 단, 현재 등급 base 아래로는 안 내려감(등급 유지·재응시 위해 재충전 필요).
export function examFailXp(rank, totalXp) {
  const idx = clampRank(rank);
  const curMin = XP_TIER_MIN[idx];
  const nextMin = idx + 1 < XP_TIER_MIN.length ? XP_TIER_MIN[idx + 1] : curMin;
  const penalty = Math.round(Math.max(0, nextMin - curMin) * EXAM_FAIL_PENALTY);
  return Math.max(curMin, Math.floor(totalXp || 0) - penalty);
}

// ── 레벨(Lv.N) — 누적 XP 기반 연속 성장(2026-07-19 보스 사다리 개편). 등급(rank)과 별개 축. ──
//  등급 = 보스(승급시험) 클리어로만 오르는 실력 관문(EAR_TIERS 4단계). 레벨 = 플레이할수록 계속 오르는 성장 숫자(상한 없음).
export const LVL_BASE = 500;    // Lv1→Lv2 필요 XP
export const LVL_GROWTH = 150;  // 레벨마다 필요 XP 증가폭(점증) — 튜닝값
// Lv.L 도달 누적 XP(L≥1, Lv1=0). 증분 increment(k)=BASE+(k-1)*GROWTH의 누적.
export function xpForLevel(L) {
  const n = Math.max(1, Math.floor(L || 1)) - 1;
  return n * LVL_BASE + (LVL_GROWTH * (n * (n - 1))) / 2;
}
// 누적 XP → 레벨(≥1) + 게이지 정보(현재 Lv → 다음 Lv까지).
export function levelInfo(totalXp = 0) {
  const xp = Math.max(0, Math.floor(totalXp || 0));
  let L = 1;
  while (L < 999 && xpForLevel(L + 1) <= xp) L += 1; // 상한 가드
  const curMin = xpForLevel(L);
  const nextMin = xpForLevel(L + 1);
  const span = Math.max(1, nextMin - curMin);
  return { level: L, curMin, nextMin, toNext: Math.max(0, nextMin - xp), progress: Math.min(1, Math.max(0, (xp - curMin) / span)), xp };
}

// ── 등급(rank) 표시 — rank(=깬 보스 수)로 EAR_TIERS 엠블럼 결정. XP 게이지·examReady 없음(시험은 보스가 게이트). ──
export function rankInfo(rank = 0) {
  const idx = clampRank(rank);
  const cur = EAR_TIERS[idx];
  const next = EAR_TIERS[idx + 1] || null;
  return { idx, name: cur.name, emblem: cur.emblem, glow: cur.glow, spark: cur.spark, particles: cur.particles, next, isMax: !next };
}
