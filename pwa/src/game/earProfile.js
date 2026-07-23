// 성조게임 등급 엠블럼 — 급(입문/실전/고수)과 1:1. rank(승급시험·배치로 오르는 0~2)로 인덱싱(gameXp.rankInfo).
//   ★2026-07-23: 구 '마스터 단어 수 기준 4단계·강등' 모델을 보스 사다리로 대체하며 급과 통일(3단계) — earTier/min 제거.
//   엠블럼 = 브론즈(입문)·실버(실전)·골드(고수). glow/spark = 글로우·반짝임 색, particles = 파티클 개수(단계 오를수록 화려).
export const EAR_TIERS = [
  { name: '입문', emblem: '/game/emblems/tier1.png', glow: '#C9A063', spark: '#DCBB7C', particles: 3 }, // 브론즈
  { name: '실전', emblem: '/game/emblems/tier2.png', glow: '#9FB0C4', spark: '#C2CDDB', particles: 4 }, // 실버
  { name: '고수', emblem: '/game/emblems/tier3.png', glow: '#FFB02E', spark: '#FFC94D', particles: 5 }, // 골드
];

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
