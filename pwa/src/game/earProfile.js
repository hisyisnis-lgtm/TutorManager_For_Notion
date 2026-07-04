// "나의 중국어 귀" 성장 단계 — 마스터한 단어 수 기준. 단계별 엠블럼(AI 생성 PNG).
// ★2026-07-04 등급 강등 도입: 현재 등급은 마스터 수를 정직하게 반영해 내려갈 수 있음(마스터 해제는
//   tgWordStats 히스테리시스가 완만하게). 대신 '최고 등급'은 아래 tierPeak로 영구 보존(안 뺏는 원칙)
//   — 강등 알림·압박 카피는 쓰지 않고, 회복 경로는 복습 모드(약한 단어 풀에 자동 포함).
// glow/spark = 단계별 글로우·반짝임 색, particles = 파티클 개수(단계 오를수록 화려)
export const EAR_TIERS = [
  { name: '성조 입문', min: 0, emblem: '/game/emblems/tier1.png', glow: '#C9A063', spark: '#DCBB7C', particles: 3 },     // 브론즈 ⭐1
  { name: '귀가 열리는 중', min: 1, emblem: '/game/emblems/tier2.png', glow: '#9FB0C4', spark: '#C2CDDB', particles: 4 }, // 실버 ⭐2
  { name: '성조가 들리기 시작', min: 10, emblem: '/game/emblems/tier3.png', glow: '#FFB02E', spark: '#FFC94D', particles: 5 }, // 골드 ⭐3
  { name: '성조가 들리는 사람', min: 25, emblem: '/game/emblems/tier4.png', glow: '#8A6BE8', spark: '#B79CF2', particles: 7 }, // 퍼플+👑 ⭐4
];

// 마스터 수 → 현재 단계 + 다음 단계 진행도
export function earTier(mastered = 0) {
  let idx = 0;
  for (let i = 0; i < EAR_TIERS.length; i++) if (mastered >= EAR_TIERS[i].min) idx = i;
  const cur = EAR_TIERS[idx];
  const next = EAR_TIERS[idx + 1] || null;
  const toNext = next ? Math.max(0, next.min - mastered) : 0;
  const progress = next ? Math.min(1, Math.max(0, (mastered - cur.min) / (next.min - cur.min))) : 1;
  return { idx, name: cur.name, emblem: cur.emblem, glow: cur.glow, spark: cur.spark, particles: cur.particles, next, toNext, progress, mastered, isMax: !next };
}

// 엠블럼 주변 반짝임 위치 [중심대비 dx, dy, 크기] — 단계 particles 수만큼 앞에서부터 사용.
// MasteryScreen 히어로·RankUpReveal 공용(중복 정의 금지 — 좌표 조정은 여기 한 곳).
export const TIER_SPARK_POS = [[-92, -28, 13], [86, -42, 10], [-100, 42, 9], [96, 30, 12], [4, -84, 11], [-58, 76, 9], [72, 70, 10]];

// ── 최고 등급 기록(peak) — 이것만은 오르기만 함. 강등돼도 성취의 기억은 보존("최고 골드 · 현재 실버") ──
function tierPeakKey(token) { return token ? `game_tier_peak_${token}` : 'game_tier_peak'; }
export function loadTierPeak(token) {
  try { const n = parseInt(localStorage.getItem(tierPeakKey(token)) || '0', 10); return Number.isFinite(n) && n > 0 ? n : 0; }
  catch { return 0; }
}
export function bumpTierPeak(token, idx) {
  const next = Math.max(loadTierPeak(token), idx | 0);
  try { localStorage.setItem(tierPeakKey(token), String(next)); } catch { /* noop */ }
  return next;
}
