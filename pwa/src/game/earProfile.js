// "나의 중국어 귀" 성장 단계 — 마스터한 단어 수 기준(오르기만 함=격려·노FOMO). 단계별 엠블럼(AI 생성 PNG).
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
