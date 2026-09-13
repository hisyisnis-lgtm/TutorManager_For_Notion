// 회원 저장은 여러 기기의 오래된 사본이 도착할 수 있다. 획득한 기록은
// 되돌리지 않고, 정확도·복습 상태는 시도 수가 많은 단어의 최신 값을 따른다.
// mc(현재 숙련 수)와 frz(소모품)는 감소가 정상이라 기존 최종 저장 값을 유지한다.
const peakFields = ['tier', 'xp', 'rk', 'rm', 'bp'];
const max = (a, b) => Math.max(a ?? 0, b ?? 0);

function mergeStreak(a, b) {
  if (!a) return b;
  if (!b) return a;
  const newer = a.lastDate >= b.lastDate ? a : b;
  const older = newer === a ? b : a;
  const gap = (Date.parse(`${newer.lastDate}T00:00:00Z`) - Date.parse(`${older.lastDate}T00:00:00Z`)) / 86400000;
  const current = gap === 0 ? max(a.current, b.current)
    : gap === 1 ? max(newer.current, older.current + 1) : newer.current;
  return { lastDate: newer.lastDate, current, longest: Math.max(a.longest, b.longest, current) };
}

export function mergeGameData(stored, incoming) {
  const merged = { ...stored, ...incoming };
  for (const key of peakFields) {
    if (key in stored || key in incoming) merged[key] = max(stored[key], incoming[key]);
  }
  if (stored.ach || incoming.ach) merged.ach = [...new Set([...(stored.ach || []), ...(incoming.ach || [])])];
  if (stored.stg || incoming.stg) {
    merged.stg = { ...stored.stg };
    for (const [key, score] of Object.entries(incoming.stg || {})) merged.stg[key] = max(merged.stg[key], score);
  }
  if (stored.best || incoming.best) {
    merged.best = { ...stored.best };
    for (const [key, record] of Object.entries(incoming.best || {})) {
      const old = merged.best[key];
      if (!old) { merged.best[key] = record; continue; }
      const winner = (record.bestScore ?? 0) > (old.bestScore ?? 0) ? record : old;
      merged.best[key] = { ...old, ...winner, playCount: max(old.playCount, record.playCount) };
      if ('bestMaxCombo' in old || 'bestMaxCombo' in record) merged.best[key].bestMaxCombo = max(old.bestMaxCombo, record.bestMaxCombo);
      if ('updatedAt' in old || 'updatedAt' in record) merged.best[key].updatedAt = max(old.updatedAt, record.updatedAt);
    }
  }
  for (const [key, countIndex] of [['words', 0], ['tone', 1]]) {
    if (!stored[key] && !incoming[key]) continue;
    merged[key] = { ...stored[key] };
    for (const [id, record] of Object.entries(incoming[key] || {})) {
      const old = merged[key][id];
      if (!old || record[countIndex] > old[countIndex]) merged[key][id] = record;
    }
  }
  if (stored.streak || incoming.streak) merged.streak = mergeStreak(stored.streak, incoming.streak);
  return merged;
}
