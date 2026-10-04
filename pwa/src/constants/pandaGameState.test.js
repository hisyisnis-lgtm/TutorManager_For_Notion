import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyPandaGameAction, commitPandaGameAction, getPandaFoodBalance, getPandaGameStorageKey, getPandaSalePrice, normalizePandaGameProfile, persistPandaGameProfile, readPandaGameProfile } from './pandaGameState.js';
import { PANDA_WARDROBE_ITEMS, pandaWardrobeForSet, savePandaWardrobe } from './pandaWardrobe.js';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());
const adult = () => normalizePandaGameProfile({ fedTotal: 192 });
const act = (state, type, fields = {}, earned = 236) => applyPandaGameAction(state, { type, ...fields }, earned);

describe('판다 먹이 경제와 소유권', () => {
  it('확정된 12상품 가격과 해금 레벨을 사용한다', () => {
    expect(PANDA_WARDROBE_ITEMS).toHaveLength(12);
    for (const item of PANDA_WARDROBE_ITEMS) {
      expect(item.price).toBe({ hat: 6, costume: 8, neck: 4, hand: 6 }[item.slot]);
      expect(item.level).toBe({ gardener: 6, strawberry: 7, reader: 8 }[item.setId]);
    }
  });
  it('구매·판매는 경험치를 바꾸지 않고 판매는 절반을 돌려주며 착용을 해제한다', () => {
    const purchased = act(adult(), 'buy', { itemId: 'reader:costume' });
    expect(purchased.fedTotal).toBe(192);
    expect(getPandaFoodBalance(purchased, 236)).toBe(36);
    const equipped = act(purchased, 'equip', { slot: 'costume', itemId: 'reader:costume' });
    const sold = act(equipped, 'sell', { itemId: 'reader:costume' });
    expect(sold).toMatchObject({ fedTotal: 192, spentFood: 8, refundFood: 4, owned: [], equipped: { costume: null } });
    expect(getPandaFoodBalance(sold, 236)).toBe(40);
  });
  it('중복 구매·중복 판매는 잔액이나 원본 상태를 바꾸지 않는다', () => {
    const purchased = act(adult(), 'buy', { itemId: 'gardener:hat' });
    expect(() => act(purchased, 'buy', { itemId: 'gardener:hat' })).toThrow('이미');
    const sold = act(purchased, 'sell', { itemId: 'gardener:hat' });
    expect(() => act(sold, 'sell', { itemId: 'gardener:hat' })).toThrow('가지고');
    expect(purchased.owned).toEqual(['gardener:hat']);
    expect(purchased.spentFood).toBe(6);
  });
  it('구매 잠금·부족·다른 부위 및 미소유 착용을 거부한다', () => {
    expect(() => act(normalizePandaGameProfile({ fedTotal: 111 }), 'buy', { itemId: 'gardener:hat' })).toThrow('Lv.6');
    expect(() => act(normalizePandaGameProfile({ fedTotal: 151 }), 'buy', { itemId: 'strawberry:hat' })).toThrow('Lv.7');
    expect(() => act(adult(), 'buy', { itemId: 'reader:hat' }, 197)).toThrow('1개');
    expect(() => act(adult(), 'equip', { itemId: 'reader:hat', slot: 'hat' })).toThrow('가지고');
    const purchased = act(adult(), 'buy', { itemId: 'reader:hat' });
    expect(() => act(purchased, 'equip', { itemId: 'reader:hat', slot: 'hand' })).toThrow('가지고');
  });
  it('먹인 정확한 수량만 경험치와 잔액에 반영하고 구매로 쓴 먹이를 다시 먹일 수 없다', () => {
    const purchased = act(adult(), 'buy', { itemId: 'gardener:hat' }, 200);
    expect(() => act(purchased, 'feed', { count: 5 }, 200)).toThrow('부족');
    const fed = act(purchased, 'feed', { count: 2 }, 200);
    expect(fed.fedTotal).toBe(194);
    expect(getPandaFoodBalance(fed, 200)).toBe(0);
    expect(() => act(fed, 'feed', { count: -1 })).toThrow('수량');
  });
  it('기존에 실제 장착한 파츠만 0원 소유로 이관하고 판매 환급도 0이다', () => {
    localStorage.setItem('legacy', '192');
    savePandaWardrobe('legacy', { ...pandaWardrobeForSet('reader'), neck: null, hand: null });
    const migrated = readPandaGameProfile('legacy', { strict: true });
    expect(migrated.owned).toEqual(['reader:hat', 'reader:costume']);
    expect(getPandaSalePrice(migrated, 'reader:hat')).toBe(0);
    expect(act(migrated, 'sell', { itemId: 'reader:hat' }).refundFood).toBe(0);
    expect(readPandaGameProfile('other-student').owned).toEqual([]);
  });
  it('손상된 정본은 쓰기용 reader에서 실패하고 기존 문자열은 그대로 둔다', () => {
    localStorage.setItem(getPandaGameStorageKey('broken'), '{bad');
    expect(() => readPandaGameProfile('broken', { strict: true })).toThrow('읽지 못');
    expect(readPandaGameProfile('broken').fedTotal).toBe(0);
    expect(localStorage.getItem(getPandaGameStorageKey('broken'))).toBe('{bad');
  });
  it.each([
    { refundFood: 100 },
    { owned: ['retired:hat'] },
    { owned: ['reader:hat', 'reader:hat'] },
    { equipped: { hat: 'reader:hat', costume: null, neck: null, hand: null } },
    { owned: ['reader:hat'], purchasePrices: { 'reader:hat': -1 } },
    { nickname: 'bad\nname' },
  ])('의미가 손상된 정본 %j는 정규화로 숨기거나 덮어쓰지 않는다', async corrupt => {
    const source = JSON.stringify({ ...adult(), ...corrupt });
    localStorage.setItem(getPandaGameStorageKey('corrupt'), source);
    expect(() => readPandaGameProfile('corrupt', { strict: true })).toThrow('읽지 못');
    await expect(commitPandaGameAction('corrupt', adult(), { type: 'feed', count: 1 }, 236)).rejects.toThrow('읽지 못');
    expect(localStorage.getItem(getPandaGameStorageKey('corrupt'))).toBe(source);
  });
  it('구입 당시 가격을 다시 읽어도 유지하고 현재 정가 대신 그 절반만 환급한다', () => {
    const previous = normalizePandaGameProfile({ fedTotal: 192, spentFood: 8, owned: ['reader:hat'], purchasePrices: { 'reader:hat': 8 } });
    persistPandaGameProfile('priced', previous);
    const loaded = readPandaGameProfile('priced', { strict: true });
    expect(loaded.purchasePrices['reader:hat']).toBe(8);
    expect(act(loaded, 'sell', { itemId: 'reader:hat' }).refundFood).toBe(4);
  });
  it('다른 탭이 변경한 기록은 오래된 화면으로 덮지 않고 최신 스냅샷과 함께 거부한다', async () => {
    const previous = adult();
    const latest = act(previous, 'buy', { itemId: 'reader:hat' });
    persistPandaGameProfile('tabs', latest);
    await expect(commitPandaGameAction('tabs', previous, { type: 'feed', count: 5 }, 236)).rejects.toMatchObject({ code: 'revision_conflict', profile: latest });
    expect(readPandaGameProfile('tabs', { strict: true })).toEqual(latest);
  });
});

describe('성체 이름', () => {
  it.each([[110, 1, false], [111, 1, true], [110, 5, true], [112, 1, false]])('먹이 %i에서 %i개를 줄 때 첫 성체 도달 안내 이력은 %s다', (fedTotal, count, namingPromptSeen) => {
    const previous = normalizePandaGameProfile({ fedTotal });
    const next = act(previous, 'feed', { count });
    expect(next).toMatchObject({ fedTotal: fedTotal + count, namingPromptSeen, revision: 1 });
    expect(previous).toMatchObject({ fedTotal, namingPromptSeen: false, revision: 0 });
  });
  it('잔액 부족은 첫 안내 이력을 소비하지 않고 이후 먹이주기는 저장된 이력을 유지한다', () => {
    const previous = normalizePandaGameProfile({ fedTotal: 111 });
    expect(() => act(previous, 'feed', { count: 1 }, 111)).toThrow('부족');
    expect(previous.namingPromptSeen).toBe(false);
    const grown = act(previous, 'feed', { count: 1 });
    expect(act(grown, 'feed', { count: 1 })).toMatchObject({ fedTotal: 113, namingPromptSeen: true, revision: 2 });
  });
  it('NFC·trim하고 이름 저장 및 나중에 선택 시 최초 안내를 완료한다', () => {
    expect(act(adult(), 'nickname', { nickname: '  하오  ' })).toMatchObject({ nickname: '하오', namingPromptSeen: true });
    expect(act(adult(), 'dismiss-naming')).toMatchObject({ nickname: '', namingPromptSeen: true });
  });
  it.each(['', '   ', '\n이름', '이름\t', '1234567890123'])('유효하지 않은 이름 %j는 저장하지 않는다', nickname => {
    expect(() => act(adult(), 'nickname', { nickname })).toThrow();
  });
  it('성체 전 이름짓기는 막고 12코드포인트 이름은 허용한다', () => {
    expect(() => act(normalizePandaGameProfile({ fedTotal: 111 }), 'nickname', { nickname: '하오' })).toThrow('Lv.6');
    expect(act(adult(), 'nickname', { nickname: '🐼'.repeat(12) }).nickname).toBe('🐼'.repeat(12));
  });
});
