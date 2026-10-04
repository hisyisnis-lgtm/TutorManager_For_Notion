import { z } from 'zod';
import catalog from '../../03_data/panda/wardrobe.json' with { type: 'json' };

export const PANDA_PRICES = Object.freeze(Object.fromEntries(catalog.slots.map(({ id, price }) => [id, price])));
export const PANDA_SET_LEVELS = Object.freeze(Object.fromEntries(catalog.sets.map(({ id, level }) => [id, level])));
export const PANDA_SLOTS = Object.freeze(catalog.slots.map(({ id }) => id));
export const PANDA_ITEMS = Object.freeze(Object.keys(PANDA_SET_LEVELS).flatMap(set => PANDA_SLOTS.map(slot => `${set}:${slot}`)));
const adultFed = catalog.growth.thresholds[catalog.growth.adultLevel - 1];
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const itemId = z.enum(PANDA_ITEMS);
const slot = z.enum(PANDA_SLOTS);
const nickname = z.string().refine(value => !/[\u0000-\u001f\u007f-\u009f]/u.test(value))
  .transform(value => value.normalize('NFC').trim()).refine(value => [...value].length <= catalog.nameMaxLength);
const profileSchema = z.object({
  fedTotal: count, spentFood: count, refundFood: count,
  owned: z.array(itemId).max(PANDA_ITEMS.length),
  equipped: z.object(Object.fromEntries(PANDA_SLOTS.map(key => [key, itemId.nullable()]))).strict(),
  purchasePrices: z.record(itemId, count).optional(),
  nickname, namingPromptSeen: z.boolean(),
}).strict();
const base = { requestId: z.string().regex(/^[A-Za-z0-9_-]{16,80}$/), expectedRevision: count };
const command = (type, fields = {}) => z.object({ ...base, type: z.literal(type), ...fields }).strict();
export const PandaActionSchema = z.discriminatedUnion('type', [
  command('feed', { count: count.min(1) }),
  command('buy', { itemId }), command('sell', { itemId }),
  command('equip', { slot, itemId: itemId.nullable() }),
  command('nickname', { nickname: nickname.refine(value => [...value].length >= 1) }),
  command('dismiss-naming'), command('dismiss-transition'),
]);

export function pandaLevel(fedTotal) {
  if (fedTotal >= adultFed) return catalog.growth.adultLevel + Math.floor((fedTotal - adultFed) / catalog.growth.foodPerAdultLevel);
  return catalog.growth.thresholds.filter(min => fedTotal >= min).length;
}

export function newPandaProfile() {
  return { fedTotal: 0, spentFood: 0, refundFood: 0, owned: [],
    equipped: Object.fromEntries(PANDA_SLOTS.map(key => [key, null])), purchasePrices: {}, nickname: '', namingPromptSeen: false };
}

export function parsePandaProfile(input) {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return null;
  const profile = parsed.data;
  if (new Set(profile.owned).size !== profile.owned.length || profile.refundFood > profile.spentFood) return null;
  // Existing rows predate this field. Preserve their original current-price refund
  // behavior once; all new purchases retain the exact price paid across repricing.
  if (profile.purchasePrices === undefined) profile.purchasePrices = Object.fromEntries(profile.owned.map(id => [id, PANDA_PRICES[id.split(':')[1]]]));
  if (Object.keys(profile.purchasePrices).some(id => !profile.owned.includes(id))
    || profile.owned.some(id => !Number.isSafeInteger(profile.purchasePrices[id]))) return null;
  for (const key of PANDA_SLOTS) {
    const item = profile.equipped[key];
    if (item && (!profile.owned.includes(item) || item.split(':')[1] !== key
      || PANDA_SET_LEVELS[item.split(':')[0]] > pandaLevel(profile.fedTotal))) return null;
  }
  return profile;
}

export function pandaError(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

export function pandaAvailable(profile, earnedTotal) {
  const available = earnedTotal - profile.fedTotal - profile.spentFood + profile.refundFood;
  if (!Number.isSafeInteger(available) || available < 0) throw pandaError('invalid_saved_profile', '저장된 먹이 기록을 확인하지 못했습니다. 기존 기록은 유지됩니다.');
  return available;
}

export function applyPandaAction(profile, action, earnedTotal) {
  const next = structuredClone(profile);
  const available = pandaAvailable(profile, earnedTotal);
  const requireFunds = cost => { if (available < cost) throw pandaError('insufficient_food', '먹이가 부족해요.'); };
  const requireItem = id => { if (!profile.owned.includes(id)) throw pandaError('not_owned', '아직 가지고 있지 않은 파츠예요.'); };
  const requireLevel = id => {
    if (pandaLevel(profile.fedTotal) < PANDA_SET_LEVELS[id.split(':')[0]]) throw pandaError('level_locked', '아직 사용할 수 없는 레벨의 파츠예요.');
  };
  switch (action.type) {
    case 'feed':
      requireFunds(action.count);
      next.fedTotal += action.count;
      // 첫 성체 도달 거래에 안내 이력을 함께 저장해 응답 재시도에도 반복하지 않는다.
      if (profile.fedTotal < adultFed && next.fedTotal >= adultFed) next.namingPromptSeen = true;
      break;
    case 'buy': {
      requireLevel(action.itemId);
      if (profile.owned.includes(action.itemId)) throw pandaError('already_owned', '이미 가지고 있는 파츠예요.');
      const price = PANDA_PRICES[action.itemId.split(':')[1]];
      requireFunds(price); next.spentFood += price; next.owned.push(action.itemId); next.owned.sort();
      next.purchasePrices[action.itemId] = price; break;
    }
    case 'sell':
      requireItem(action.itemId);
      next.refundFood += Math.floor(next.purchasePrices[action.itemId] / catalog.economy.saleRefundDivisor);
      next.owned = next.owned.filter(id => id !== action.itemId);
      delete next.purchasePrices[action.itemId];
      for (const key of PANDA_SLOTS) if (next.equipped[key] === action.itemId) next.equipped[key] = null;
      break;
    case 'equip':
      if (action.itemId) {
        requireItem(action.itemId); requireLevel(action.itemId);
        if (action.itemId.split(':')[1] !== action.slot) throw pandaError('slot_mismatch', '이 위치에 착용할 수 없는 파츠예요.', 400);
      }
      next.equipped[action.slot] = action.itemId; break;
    case 'nickname':
      if (profile.fedTotal < adultFed) throw pandaError('level_locked', `Lv.${catalog.growth.adultLevel}부터 이름을 지을 수 있어요.`);
      next.nickname = action.nickname; next.namingPromptSeen = true; break;
    case 'dismiss-naming':
      if (profile.fedTotal < adultFed) throw pandaError('level_locked', `Lv.${catalog.growth.adultLevel}부터 이름을 지을 수 있어요.`);
      next.namingPromptSeen = true; break;
    // The account-wide notice is updated beside this profile in the same DB transaction.
    case 'dismiss-transition': break;
    default: throw pandaError('invalid_action', '지원하지 않는 요청입니다.', 400);
  }
  if (!parsePandaProfile(next)) throw pandaError('invalid_action', '변경할 기록을 확인하지 못했습니다. 기존 기록은 유지됩니다.', 400);
  pandaAvailable(next, earnedTotal);
  return next;
}
