import { EMPTY_PANDA_WARDROBE, PANDA_WARDROBE_SLOTS, getPandaItem, readPandaWardrobe } from './pandaWardrobe.js';
import catalog from '../../../03_data/panda/wardrobe.json';

export const PANDA_DEFAULT_NAME = '랴오랴오';
export const PANDA_NAME_MAX_LENGTH = catalog.nameMaxLength;
export const getPandaGameStorageKey = feedKey => `${feedKey}_game_v2`;
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const validCount = value => Number.isSafeInteger(value) && value >= 0;
const adultFed = catalog.growth.thresholds[catalog.growth.adultLevel - 1];

export function isValidPandaGameProfile(value, { requireVersion = true } = {}) {
  if (!value || (requireVersion && value.version !== 2)
    || !['fedTotal', 'spentFood', 'refundFood', 'revision'].every(key => validCount(value[key]))
    || value.refundFood > value.spentFood || !Array.isArray(value.owned)
    || new Set(value.owned).size !== value.owned.length || value.owned.some(id => !getPandaItem(id))
    || !value.equipped || typeof value.equipped !== 'object' || Array.isArray(value.equipped)
    || typeof value.nickname !== 'string' || /[\u0000-\u001f\u007f-\u009f]/u.test(value.nickname)
    || [...value.nickname.normalize('NFC').trim()].length > PANDA_NAME_MAX_LENGTH
    || typeof value.namingPromptSeen !== 'boolean') return false;
  const slots = PANDA_WARDROBE_SLOTS.map(slot => slot.id);
  if (Object.keys(value.equipped).some(slot => !slots.includes(slot))) return false;
  for (const slot of slots) {
    const id = value.equipped[slot], item = getPandaItem(id);
    if (id !== null && (!item || !value.owned.includes(id) || item.slot !== slot || value.fedTotal < item.minFed)) return false;
  }
  // Older remote profiles did not carry purchase prices; only that absent field is migrated.
  if (value.purchasePrices !== undefined && (!value.purchasePrices || typeof value.purchasePrices !== 'object'
    || Array.isArray(value.purchasePrices) || Object.keys(value.purchasePrices).some(id => !value.owned.includes(id))
    || value.owned.some(id => !validCount(value.purchasePrices[id])))) return false;
  return true;
}

export function normalizePandaGameProfile(value = {}) {
  const owned = [...new Set(Array.isArray(value.owned) ? value.owned.filter(id => getPandaItem(id)) : [])];
  const equipped = Object.fromEntries(PANDA_WARDROBE_SLOTS.map(({ id }) => [id,
    owned.includes(value.equipped?.[id]) && getPandaItem(value.equipped[id])?.slot === id ? value.equipped[id] : null,
  ]));
  return {
    version: 2, fedTotal: integer(value.fedTotal), spentFood: integer(value.spentFood), refundFood: integer(value.refundFood),
    owned, equipped,
    purchasePrices: Object.fromEntries(owned.map(id => [id, validCount(value.purchasePrices?.[id]) ? value.purchasePrices[id] : getPandaItem(id).price])),
    nickname: typeof value.nickname === 'string' ? [...value.nickname.normalize('NFC').trim()].slice(0, PANDA_NAME_MAX_LENGTH).join('') : '',
    namingPromptSeen: value.namingPromptSeen === true,
    revision: integer(value.revision),
  };
}

export function readPandaGameProfile(feedKey, { strict = false } = {}) {
  try {
    const stored = JSON.parse(localStorage.getItem(getPandaGameStorageKey(feedKey)));
    if (stored !== null) {
      if (!isValidPandaGameProfile(stored)) throw new Error('저장된 랴오랴오 기록을 확인할 수 없어요. 기존 기록은 변경하지 않았어요.');
      return normalizePandaGameProfile(stored);
    }
    const fedTotal = Math.max(0, parseInt(localStorage.getItem(feedKey) || '0', 10) || 0);
    const legacy = readPandaWardrobe(feedKey);
    const equipped = Object.fromEntries(PANDA_WARDROBE_SLOTS.map(({ id }) => [id, legacy[id] ? `${legacy[id]}:${id}` : null]));
    const owned = Object.values(equipped).filter(Boolean);
    return normalizePandaGameProfile({ fedTotal, equipped, owned, purchasePrices: Object.fromEntries(owned.map(id => [id, 0])) });
  } catch (failure) {
    if (strict) throw Object.assign(new Error('저장된 랴오랴오 기록을 읽지 못했어요. 기존 기록은 변경하지 않았어요.', { cause: failure }), { code: 'invalid_saved_profile' });
    return normalizePandaGameProfile();
  }
}

export function getPandaFoodBalance(profile, earnedTotal) {
  return Math.max(0, integer(earnedTotal) - profile.fedTotal - profile.spentFood + profile.refundFood);
}

export function getPandaSalePrice(profile, itemId) {
  const paid = profile.purchasePrices?.[itemId];
  return Math.floor((validCount(paid) ? paid : getPandaItem(itemId)?.price || 0) / catalog.economy.saleRefundDivisor);
}

function reject(message) { throw new Error(message); }

// 거래가 먼저 계산되고, 호출자가 이 객체를 하나의 JSON으로 저장한 뒤 화면에 반영한다.
export function applyPandaGameAction(profile, action, earnedTotal) {
  const next = normalizePandaGameProfile(profile);
  const balance = getPandaFoodBalance(next, earnedTotal);
  const item = getPandaItem(action.itemId);
  switch (action.type) {
    case 'feed':
      if (!Number.isSafeInteger(action.count) || action.count <= 0) reject('먹이 수량을 확인해 주세요.');
      if (action.count > balance) reject('먹이가 부족해요.');
      next.fedTotal += action.count;
      // 팝업을 열기 전에 먹이 기록과 같은 JSON으로 첫 안내 이력을 저장한다.
      if (profile.fedTotal < adultFed && next.fedTotal >= adultFed) next.namingPromptSeen = true;
      break;
    case 'buy':
      if (!item) reject('아이템을 찾을 수 없어요.');
      if (next.fedTotal < item.minFed) reject(`Lv.${item.level}부터 구매할 수 있어요.`);
      if (next.owned.includes(item.id)) reject('이미 가지고 있는 아이템이에요.');
      if (balance < item.price) reject(`먹이가 ${item.price - balance}개 부족해요.`);
      next.spentFood += item.price;
      next.owned.push(item.id);
      next.purchasePrices[item.id] = item.price;
      break;
    case 'sell':
      if (!item || !next.owned.includes(item.id)) reject('가지고 있는 아이템만 판매할 수 있어요.');
      next.refundFood += getPandaSalePrice(next, item.id);
      next.owned = next.owned.filter(id => id !== item.id);
      delete next.purchasePrices[item.id];
      if (next.equipped[item.slot] === item.id) next.equipped[item.slot] = null;
      break;
    case 'equip':
      if (!PANDA_WARDROBE_SLOTS.some(slot => slot.id === action.slot)) reject('착용 부위를 확인해 주세요.');
      if (action.itemId === null) { next.equipped[action.slot] = null; break; }
      if (!item || item.slot !== action.slot || !next.owned.includes(item.id)) reject('가지고 있는 아이템만 착용할 수 있어요.');
      if (next.fedTotal < item.minFed) reject(`Lv.${item.level}부터 착용할 수 있어요.`);
      next.equipped[action.slot] = item.id;
      break;
    case 'nickname': {
      if (next.fedTotal < adultFed) reject(`Lv.${catalog.growth.adultLevel}부터 이름을 지을 수 있어요.`);
      if (typeof action.nickname !== 'string' || /[\u0000-\u001f\u007f-\u009f]/u.test(action.nickname)) reject('이름에 줄바꿈이나 제어 문자를 넣을 수 없어요.');
      const name = action.nickname.normalize('NFC').trim();
      if (!name || [...name].length > PANDA_NAME_MAX_LENGTH) reject(`이름은 1~${PANDA_NAME_MAX_LENGTH}자로 입력해 주세요.`);
      next.nickname = name;
      next.namingPromptSeen = true;
      break;
    }
    case 'dismiss-naming':
      if (next.fedTotal < adultFed) reject('아직 이름을 지을 수 없어요.');
      next.namingPromptSeen = true;
      break;
    default: reject('지원하지 않는 동작이에요.');
  }
  next.revision += 1;
  if (!isValidPandaGameProfile(next)) reject('변경할 기록을 확인하지 못했어요. 기존 기록은 유지됩니다.');
  return next;
}

// Read again inside the shared browser lock: a second tab cannot spend an old snapshot.
export async function commitPandaGameAction(feedKey, expected, action, earnedTotal) {
  const commit = () => {
    const current = readPandaGameProfile(feedKey, { strict: true });
    if (JSON.stringify(current) !== JSON.stringify(expected)) {
      throw Object.assign(new Error('다른 화면의 최신 기록을 불러왔어요. 다시 확인해 주세요.'), { code: 'revision_conflict', profile: current });
    }
    const next = applyPandaGameAction(current, action, earnedTotal);
    try { persistPandaGameProfile(feedKey, next); }
    catch { throw new Error('저장하지 못했어요. 저장 공간을 확인한 뒤 다시 시도해 주세요.'); }
    return next;
  };
  // Web Locks is available in supported secure-context browsers. The fallback still
  // detects stale snapshots before writing, but cannot guarantee cross-tab atomicity.
  return globalThis.navigator?.locks?.request
    ? navigator.locks.request(`panda:${getPandaGameStorageKey(feedKey)}`, commit) : commit();
}

export function persistPandaGameProfile(feedKey, profile) {
  // 이 JSON이 정본이다. 기존 fed 키는 이전 화면/도구와의 호환용이며 별도 경제 계산에 사용하지 않는다.
  localStorage.setItem(getPandaGameStorageKey(feedKey), JSON.stringify(profile));
  try { localStorage.setItem(feedKey, String(profile.fedTotal)); } catch { /* 정본 저장은 이미 완료 */ }
}

export { EMPTY_PANDA_WARDROBE };
