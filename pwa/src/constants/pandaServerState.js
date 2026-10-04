import { isValidPandaGameProfile, normalizePandaGameProfile } from './pandaGameState.js';

const count = value => Number.isSafeInteger(value) && value >= 0;
export const getPandaServerCacheKey = storageKey => `${storageKey}_server_v1`;

export function isValidPandaSnapshot(data) {
  const transition = data?.transition;
  return Boolean(data && count(data.earnedTotal) && count(data.availableFood)
    && isValidPandaGameProfile(data.profile, { requireVersion: false })
    && data.earnedTotal - data.profile.fedTotal - data.profile.spentFood + data.profile.refundFood === data.availableFood
    && transition?.version === 1 && typeof transition.initializedAt === 'string'
    && Number.isFinite(Date.parse(transition.initializedAt))
    && count(transition.startingFood) && transition.startingFood <= data.earnedTotal
    && typeof transition.noticeSeen === 'boolean');
}

// A cache can display the last confirmed state, but never authorizes a transaction.
// Keep it separate from both the old live panda and local-only preview profiles.
export function readPandaServerCache(storageKey) {
  try {
    const cached = JSON.parse(localStorage.getItem(getPandaServerCacheKey(storageKey)));
    return isValidPandaSnapshot(cached) ? cached : null;
  } catch { return null; }
}

export function persistPandaServerCache(storageKey, snapshot) {
  if (!isValidPandaSnapshot(snapshot)) return;
  const cached = JSON.stringify({ profile: normalizePandaGameProfile(snapshot.profile),
    earnedTotal: snapshot.earnedTotal, availableFood: snapshot.availableFood, transition: snapshot.transition });
  const key = getPandaServerCacheKey(storageKey);
  // Avoid cross-tab refresh loops when both tabs receive the same server state.
  if (localStorage.getItem(key) !== cached) localStorage.setItem(key, cached);
}
