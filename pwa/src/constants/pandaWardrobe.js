import catalog from '../../../03_data/panda/wardrobe.json';

// Only authored sets are enabled. The 30-set concept collection is not the app catalog.
export const PANDA_WARDROBE_SETS = catalog.sets;
export const PANDA_WARDROBE_SLOTS = catalog.slots;
export const EMPTY_PANDA_WARDROBE = Object.freeze(Object.fromEntries(catalog.slots.map(({ id }) => [id, null])));
export const PANDA_PART_PRICES = Object.freeze(Object.fromEntries(catalog.slots.map(({ id, price }) => [id, price])));
export const PANDA_PART_LAYERS = Object.freeze(Object.fromEntries(catalog.slots.map(({ id, layers }) => [id, layers])));
export const PANDA_PART_BOUNDS = catalog.art.bounds;
export const PANDA_STICKER_SPEC = catalog.art.sticker;
export const PANDA_ART_VIEWBOX = catalog.art.viewBox;
export const PANDA_PART_STICKER_COLOR = PANDA_STICKER_SPEC.color;
export const PANDA_PART_RARITIES = catalog.rarities;
export const PANDA_ADULT_LEVEL = catalog.growth.adultLevel;
export const PANDA_ADULT_FED = catalog.growth.thresholds[PANDA_ADULT_LEVEL - 1];
export const PANDA_ADULT_LEVEL_FOOD = catalog.growth.foodPerAdultLevel;
export const PANDA_WARDROBE_ITEMS = PANDA_WARDROBE_SETS.flatMap(set => PANDA_WARDROBE_SLOTS.map(slot => ({
  id: `${set.id}:${slot.id}`, setId: set.id, slot: slot.id,
  name: `${set.name} ${slot.name}`, setName: set.name, slotName: slot.name,
  level: set.level, minFed: set.minFed, price: PANDA_PART_PRICES[slot.id], rarity: set.rarity,
  thumbnailBackground: PANDA_PART_RARITIES[set.rarity].background,
  thumbnailBackgroundCenter: PANDA_PART_RARITIES[set.rarity].backgroundCenter,
})));

export function getPandaItem(itemId) {
  return PANDA_WARDROBE_ITEMS.find(item => item.id === itemId) || null;
}

export function pandaEquippedToWardrobe(equipped) {
  return Object.fromEntries(PANDA_WARDROBE_SLOTS.map(({ id }) => {
    const item = getPandaItem(equipped?.[id]);
    return [id, item?.slot === id ? item.setId : null];
  }));
}
export const PANDA_GROWTH_THRESHOLDS = catalog.growth.thresholds;
const GROWTH_THRESHOLDS = PANDA_GROWTH_THRESHOLDS;

export function getPandaLevelInfo(fedTotal) {
  const fed = Number.isFinite(fedTotal) ? Math.max(0, Math.floor(fedTotal)) : 0;
  if (fed >= PANDA_ADULT_FED) {
    const adultLevels = Math.floor((fed - PANDA_ADULT_FED) / PANDA_ADULT_LEVEL_FOOD);
    const min = PANDA_ADULT_FED + adultLevels * PANDA_ADULT_LEVEL_FOOD;
    return { level: PANDA_ADULT_LEVEL + adultLevels, min, nextAt: min + PANDA_ADULT_LEVEL_FOOD };
  }
  const index = GROWTH_THRESHOLDS.findIndex((min, i) => fed >= min && fed < GROWTH_THRESHOLDS[i + 1]);
  return { level: index + 1, min: GROWTH_THRESHOLDS[index], nextAt: GROWTH_THRESHOLDS[index + 1] };
}

// 먹이 저장 키로부터 파생하므로 학생별 저장과 로컬 QA 격리를 함께 유지한다.
export function getPandaWardrobeStorageKey(feedStorageKey) {
  return `${feedStorageKey}_wardrobe_v1`;
}

export function sanitizePandaWardrobe(value) {
  return Object.fromEntries(PANDA_WARDROBE_SLOTS.map(({ id }) => [
    id, PANDA_WARDROBE_SETS.some(set => set.id === value?.[id]) ? value[id] : null,
  ]));
}

export function getWearablePandaWardrobe(value, fedTotal) {
  const wardrobe = sanitizePandaWardrobe(value);
  return Object.fromEntries(Object.entries(wardrobe).map(([slot, id]) => [
    slot, PANDA_WARDROBE_SETS.some(set => set.id === id && fedTotal >= set.minFed) ? id : null,
  ]));
}

export function pandaWardrobeForSet(id) {
  return sanitizePandaWardrobe(Object.fromEntries(PANDA_WARDROBE_SLOTS.map(slot => [slot.id, id])));
}

export function readPandaWardrobe(feedStorageKey) {
  try {
    return sanitizePandaWardrobe(JSON.parse(localStorage.getItem(getPandaWardrobeStorageKey(feedStorageKey)))?.equipped);
  } catch {
    return { ...EMPTY_PANDA_WARDROBE };
  }
}

export function savePandaWardrobe(feedStorageKey, wardrobe) {
  try {
    localStorage.setItem(getPandaWardrobeStorageKey(feedStorageKey), JSON.stringify({ version: 1, equipped: sanitizePandaWardrobe(wardrobe) }));
    return true;
  } catch {
    return false;
  }
}
