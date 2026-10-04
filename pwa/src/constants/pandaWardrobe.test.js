import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import catalog from '../../../03_data/panda/wardrobe.json';
import { EMPTY_PANDA_WARDROBE, PANDA_ART_VIEWBOX, PANDA_PART_BOUNDS, PANDA_PART_LAYERS, PANDA_PART_RARITIES, PANDA_STICKER_SPEC, PANDA_WARDROBE_ITEMS, PANDA_WARDROBE_SETS, getPandaLevelInfo, getPandaWardrobeStorageKey, getWearablePandaWardrobe, pandaWardrobeForSet, readPandaWardrobe, savePandaWardrobe } from './pandaWardrobe.js';

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('랴오랴오 옷장 해금과 저장', () => {
  it.each([[0, 1, 3], [3, 2, 20], [111, 5, 112], [112, 6, 152], [151, 6, 152], [152, 7, 192], [191, 7, 192], [192, 8, 232], [231, 8, 232], [232, 9, 272]])(
    '먹이 %i에서 Lv.%i이고 다음 레벨은 %i에 열린다', (fed, level, nextAt) => {
      expect(getPandaLevelInfo(fed)).toMatchObject({ level, nextAt });
    },
  );

  it('성체 전에는 모든 파츠를 숨기고 각 세트 해금 경계를 적용한다', () => {
    const mixed = { hat: 'gardener', costume: 'strawberry', neck: 'reader', hand: 'reader' };
    expect(getWearablePandaWardrobe(mixed, 111)).toEqual(EMPTY_PANDA_WARDROBE);
    expect(getWearablePandaWardrobe(mixed, 112)).toEqual({ ...EMPTY_PANDA_WARDROBE, hat: 'gardener' });
    expect(getWearablePandaWardrobe(mixed, 151)).toEqual({ ...EMPTY_PANDA_WARDROBE, hat: 'gardener' });
    expect(getWearablePandaWardrobe(mixed, 152)).toEqual({ ...EMPTY_PANDA_WARDROBE, hat: 'gardener', costume: 'strawberry' });
    expect(getWearablePandaWardrobe(mixed, 191)).toEqual({ ...EMPTY_PANDA_WARDROBE, hat: 'gardener', costume: 'strawberry' });
    expect(getWearablePandaWardrobe(mixed, 192)).toEqual(mixed);
  });

  it('다른 학생·QA의 저장소를 건드리지 않으며 재접속하면 복원한다', () => {
    savePandaWardrobe('student-a', pandaWardrobeForSet('gardener'));
    savePandaWardrobe('qa-student', pandaWardrobeForSet('reader'));
    expect(readPandaWardrobe('student-a')).toEqual(pandaWardrobeForSet('gardener'));
    expect(readPandaWardrobe('student-b')).toEqual(EMPTY_PANDA_WARDROBE);
    expect(readPandaWardrobe('qa-student')).toEqual(pandaWardrobeForSet('reader'));
    expect(getPandaWardrobeStorageKey('student-a')).not.toBe(getPandaWardrobeStorageKey('qa-student'));
  });

  it('손상되거나 모르는 파츠가 저장되어도 안전하게 기본 착장으로 돌아간다', () => {
    localStorage.setItem(getPandaWardrobeStorageKey('student'), 'broken');
    expect(readPandaWardrobe('student')).toEqual(EMPTY_PANDA_WARDROBE);
    localStorage.setItem(getPandaWardrobeStorageKey('student'), JSON.stringify({ equipped: { hat: 'unknown', hand: 'reader' } }));
    expect(readPandaWardrobe('student')).toEqual({ ...EMPTY_PANDA_WARDROBE, hand: 'reader' });
  });

  it('저장 실패를 성공으로 보고하지 않는다', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(savePandaWardrobe('student', pandaWardrobeForSet('gardener'))).toBe(false);
    vi.restoreAllMocks();
  });
});

describe('공통 파츠 카탈로그 계약', () => {
  it('제작된 모든 아이템에 정확히 한 슬롯·레이어·유효 경계가 있고 실제 SVG가 존재한다', () => {
    const layers = Object.values(PANDA_PART_LAYERS).flat();
    expect(new Set(layers).size).toBe(layers.length);
    expect([...layers].sort()).toEqual([...catalog.art.layerOrder].sort());
    expect(Object.keys(PANDA_PART_BOUNDS).sort()).toEqual(PANDA_WARDROBE_ITEMS.map(item => item.id).sort());
    expect(new Set(PANDA_WARDROBE_ITEMS.map(item => item.id)).size).toBe(PANDA_WARDROBE_ITEMS.length);
    for (const item of PANDA_WARDROBE_ITEMS) {
      const [x, y, width, height] = PANDA_PART_BOUNDS[item.id];
      expect([x, y, width, height].every(Number.isFinite)).toBe(true);
      expect(width).toBeGreaterThan(0); expect(height).toBeGreaterThan(0);
      expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0);
      expect(x + width).toBeLessThanOrEqual(PANDA_ART_VIEWBOX[2]);
      expect(y + height).toBeLessThanOrEqual(PANDA_ART_VIEWBOX[3]);
      for (const layer of PANDA_PART_LAYERS[item.slot]) {
        const source = readFileSync(path.resolve(process.cwd(), `public/panda/wardrobe/${item.setId}-${layer}.svg`), 'utf8');
        expect(source).toContain(`viewBox="${PANDA_ART_VIEWBOX.join(' ')}"`);
        expect(source).not.toMatch(/<(?:image|script|foreignObject)\b/);
      }
    }
  });

  it('세트의 해금 레벨·먹이 경계·기획 등급과 성장 정책이 일치한다', () => {
    for (const set of PANDA_WARDROBE_SETS) {
      expect(getPandaLevelInfo(set.minFed).level).toBe(set.level);
      expect(getPandaLevelInfo(set.minFed - 1).level).toBe(set.level - 1);
      expect(set.level).toBeGreaterThanOrEqual(PANDA_PART_RARITIES[set.rarity].minLevel);
      expect(set.level).toBeLessThanOrEqual(PANDA_PART_RARITIES[set.rarity].maxLevel);
      expect(set.sourceFile).toMatch(/^[^/\\]+\.ai$/);
    }
    expect(catalog.growth.thresholds).toHaveLength(catalog.growth.adultLevel);
    expect(catalog.growth.thresholds.every((value, i, values) => Number.isSafeInteger(value) && (i === 0 ? value === 0 : value > values[i - 1]))).toBe(true);
    expect(catalog.slots.every(slot => Number.isSafeInteger(slot.price) && slot.price > 0)).toBe(true);
    expect(PANDA_STICKER_SPEC.width).toBeGreaterThan(0);
    expect(PANDA_STICKER_SPEC.height).toBeGreaterThan(0);
  });
});
