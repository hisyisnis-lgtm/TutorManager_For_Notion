import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPandaProfile, performPandaAction } from './pandaDb.js';
import { PANDA_ITEMS, PANDA_PRICES, PANDA_SET_LEVELS, PANDA_SLOTS, PandaActionSchema, newPandaProfile, pandaLevel } from './pandaRules.js';
import { pandaD1 } from '../tests/helpers/pandaD1.js';
import { getPandaItem, getPandaLevelInfo, PANDA_WARDROBE_ITEMS } from '../../pwa/src/constants/pandaWardrobe.js';
import catalog from '../../03_data/panda/wardrobe.json';

let local, sequence;
const student = '11111111111141118111111111111111';
const command = (type, fields = {}, revision = 0) => ({ requestId: `request-${String(++sequence).padStart(12, '0')}`, expectedRevision: revision, type, ...fields });
const send = (action, earned = 200, owner = student) => performPandaAction(local.db, owner, earned, action);
const feedTo = (fed = 112, earned = 200) => send(command('feed', { count: fed }), earned);
beforeEach(() => { local = pandaD1(); sequence = 0; });
afterEach(() => local.close());

describe('판다 서버 원장과 원자적 요청', () => {
  it('클라이언트·서버는 같은 상품·가격·슬롯·성장 경계 계약을 해석한다', () => {
    expect(PANDA_ITEMS).toHaveLength(12);
    expect(PANDA_PRICES).toEqual({ neck: 4, hat: 6, hand: 6, costume: 8 });
    expect(Object.values(PANDA_PRICES).reduce((sum, price) => sum + price, 0)).toBe(24);
    expect([...PANDA_ITEMS].sort()).toEqual(PANDA_WARDROBE_ITEMS.map(item => item.id).sort());
    expect(PANDA_SLOTS).toEqual(catalog.slots.map(slot => slot.id));
    for (const id of PANDA_ITEMS) {
      const item = getPandaItem(id);
      expect(PANDA_PRICES[item.slot]).toBe(item.price);
      expect(PANDA_SET_LEVELS[item.setId]).toBe(item.level);
      expect(pandaLevel(item.minFed)).toBe(item.level);
      expect(pandaLevel(item.minFed - 1)).toBe(item.level - 1);
    }
    const boundaries = [...catalog.growth.thresholds, ...catalog.sets.map(set => set.minFed)];
    for (const boundary of boundaries) for (const offset of [-1, 0, 1, catalog.growth.foodPerAdultLevel]) {
      const fed = Math.max(0, boundary + offset);
      expect(pandaLevel(fed)).toBe(getPandaLevelInfo(fed).level);
    }
  });
  it('1~6단계 경계를 보존하고 성체 이후 매 레벨은 먹이 40개 간격으로 성장한다', () => {
    expect([0, 2, 3, 19, 20, 47, 48, 79, 80, 111, 112, 151, 152, 191, 192].map(pandaLevel)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8]);
    for (const level of [7, 8, 9, 12, 24, 60, 100]) {
      const threshold = 112 + (level - 6) * 40;
      expect(pandaLevel(threshold - 1)).toBe(level - 1);
      expect(pandaLevel(threshold)).toBe(level);
    }
  });

  it('구매는 정가를 차감하고 판매는 절반을 돌려주며 착용 해제와 EXP 보존을 함께 처리한다', async () => {
    await feedTo();
    const buy = await send(command('buy', { itemId: 'gardener:costume' }, 1));
    expect(buy).toMatchObject({ availableFood: 80, profile: { fedTotal: 112, spentFood: 8, refundFood: 0, owned: ['gardener:costume'], revision: 2 } });
    await send(command('equip', { slot: 'costume', itemId: 'gardener:costume' }, 2));
    const sold = await send(command('sell', { itemId: 'gardener:costume' }, 3));
    expect(sold).toMatchObject({ availableFood: 84, profile: { fedTotal: 112, spentFood: 8, refundFood: 4, owned: [], equipped: { costume: null }, revision: 4 } });
    await expect(send(command('sell', { itemId: 'gardener:costume' }, 4))).rejects.toMatchObject({ code: 'not_owned' });
  });

  it('슬롯별 가격, 레벨·소유권·잔액·착용 위치를 서버에서 검증한다', async () => {
    await feedTo(112, 118);
    await expect(send(command('buy', { itemId: 'strawberry:neck' }, 1), 118)).rejects.toMatchObject({ code: 'level_locked' });
    await expect(send(command('equip', { slot: 'hat', itemId: 'gardener:hat' }, 1), 118)).rejects.toMatchObject({ code: 'not_owned' });
    await expect(send(command('buy', { itemId: 'gardener:costume' }, 1), 118)).rejects.toMatchObject({ code: 'insufficient_food' });
    const bought = await send(command('buy', { itemId: 'gardener:hat' }, 1), 118);
    expect(bought.availableFood).toBe(0);
    await expect(send(command('equip', { slot: 'neck', itemId: 'gardener:hat' }, 2), 118)).rejects.toMatchObject({ code: 'slot_mismatch' });
    await expect(send(command('feed', { count: 1 }, 2), 118)).rejects.toMatchObject({ code: 'insufficient_food' });
    await expect(send(command('buy', { itemId: 'gardener:hat' }, 2), 118)).rejects.toMatchObject({ code: 'already_owned' });
  });

  it('같은 요청은 나중에 재전송해도 재차 차감하지 않고 최신 상태를 반환한다', async () => {
    const action = command('feed', { count: 3 });
    await send(action);
    await send(command('feed', { count: 2 }, 1));
    expect(await send(action)).toMatchObject({ action: { requestId: action.requestId }, profile: { fedTotal: 5, revision: 2 }, availableFood: 195 });
    expect((await getPandaProfile(local.db, student, 200)).profile.fedTotal).toBe(5);
    await expect(send({ ...action, count: 4 })).rejects.toMatchObject({ code: 'request_id_reused' });
    expect(local.sqlite.prepare('SELECT count(*) AS count FROM student_panda_actions').get().count).toBe(2);
  });

  it.each([false, true])('첫 영수증 조회 뒤 동일 ID가 완료된 경쟁에서 요청 변경=%s를 정확히 구분한다', async changed => {
    const original = command('feed', { count: 1 });
    let receiptRead = false, injected = false;
    const racingDb = { ...local.db, prepare(sql) {
      return { bind(...args) {
        const statement = local.db.prepare(sql).bind(...args);
        if (sql.startsWith('SELECT * FROM student_panda_actions')) return { ...statement, async first() {
          const value = await statement.first(); receiptRead = true; return value;
        } };
        if (sql.startsWith('SELECT * FROM student_panda_profiles')) return { ...statement, async first() {
          if (receiptRead && !injected) { injected = true; await send(original); }
          return statement.first();
        } };
        return statement;
      } };
    } };
    const pending = performPandaAction(racingDb, student, 200, changed ? { ...original, count: 2 } : original);
    if (changed) await expect(pending).rejects.toMatchObject({ code: 'request_id_reused' });
    else await expect(pending).resolves.toMatchObject({ ok: true, action: { requestId: original.requestId }, profile: { fedTotal: 1, revision: 1 } });
    expect(local.sqlite.prepare('SELECT count(*) AS count FROM student_panda_actions').get().count).toBe(1);
    expect((await getPandaProfile(local.db, student, 200)).profile).toMatchObject({ fedTotal: 1, revision: 1 });
  });

  it.each([8, 6, undefined])('저장 가격 %s를 보존하며 구형 가격 필드 누락은 현재 정가 환급과 호환된다', async recordedPrice => {
    const initial = await feedTo();
    const { revision, ...profile } = initial.profile;
    profile.owned = ['gardener:hat'];
    profile.spentFood = recordedPrice ?? 6;
    if (recordedPrice === undefined) delete profile.purchasePrices;
    else profile.purchasePrices = { 'gardener:hat': recordedPrice };
    local.sqlite.prepare('UPDATE student_panda_profiles SET profile = ? WHERE student_id = ?').run(JSON.stringify(profile), student);
    const loaded = await getPandaProfile(local.db, student, 200);
    expect(loaded.profile.purchasePrices['gardener:hat']).toBe(recordedPrice ?? 6);
    const sold = await send(command('sell', { itemId: 'gardener:hat' }, revision));
    expect(sold.profile).toMatchObject({ refundFood: recordedPrice === 8 ? 4 : 3, owned: [], purchasePrices: {} });
  });

  it.each([[110, 1, false], [111, 1, true], [110, 5, true], [112, 1, true]])('먹이 %i에서 %i개를 줄 때 첫 성체 도달 안내 이력은 %s다', async (fedTotal, count, namingPromptSeen) => {
    expect((await feedTo(fedTotal)).profile.namingPromptSeen).toBe(fedTotal >= 112);
    const result = await send(command('feed', { count }, 1));
    expect(result.profile).toMatchObject({ fedTotal: fedTotal + count, namingPromptSeen, revision: 2 });
    expect((await getPandaProfile(local.db, student, 200)).profile).toEqual(result.profile);
  });

  it('첫 성체 도달 응답이 유실되어 재요청해도 안내 이력과 먹이는 한 번만 반영한다', async () => {
    await feedTo(111);
    const action = command('feed', { count: 1 }, 1);
    await send(action); // 클라이언트가 이 응답을 받지 못한 상황.
    const retried = await send(action);
    expect(retried).toMatchObject({ availableFood: 88, profile: { fedTotal: 112, namingPromptSeen: true, revision: 2 } });
    expect(local.sqlite.prepare('SELECT count(*) AS count FROM student_panda_actions').get().count).toBe(2);
    expect((await send(command('feed', { count: 1 }, 2))).profile).toMatchObject({ fedTotal: 113, namingPromptSeen: true, revision: 3 });
  });

  it('영수증 확인 직후 같은 ID의 다른 요청이 완료되어도 후속 변경을 커밋하지 않는다', async () => {
    const original = command('feed', { count: 1 });
    let receiptRead = false, injected = false;
    const racingDb = { ...local.db, prepare(sql) {
      return { bind(...args) {
        const statement = local.db.prepare(sql).bind(...args);
        if (sql.startsWith('SELECT * FROM student_panda_actions')) return { ...statement, async first() {
          const value = await statement.first(); receiptRead = true; return value;
        } };
        if (sql.startsWith('SELECT * FROM student_panda_profiles')) return { ...statement, async first() {
          if (receiptRead && !injected) { injected = true; await send(original); }
          return statement.first();
        } };
        return statement;
      } };
    } };
    await expect(performPandaAction(racingDb, student, 200, { ...original, expectedRevision: 1, count: 2 })).rejects.toMatchObject({ code: 'request_id_reused' });
    expect((await getPandaProfile(local.db, student, 200)).profile).toMatchObject({ fedTotal: 1, revision: 1 });
  });

  it('동시 구매는 한 번만 차감되고 오래된 revision은 최신 상태와 함께 거부된다', async () => {
    await feedTo(112, 118);
    const actions = ['hat', 'hand'].map(slot => command('buy', { itemId: `gardener:${slot}` }, 1));
    const results = await Promise.allSettled(actions.map(action => send(action, 118)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected').reason).toMatchObject({ code: 'revision_conflict', profile: { revision: 2 }, availableFood: 0 });
    expect((await getPandaProfile(local.db, student, 118)).profile.spentFood).toBe(6);
    const repeated = command('feed', { count: 1 });
    const duplicate = await Promise.all(Array.from({ length: 4 }, () => send(repeated, 10, 'another-student')));
    expect(duplicate.every(result => result.profile.fedTotal === 1)).toBe(true);
  });

  it('요청 영수증 저장 실패는 성장과 첫 이름 안내 이력을 함께 롤백한다', async () => {
    await getPandaProfile(local.db, student, 200);
    local.sqlite.exec("CREATE TRIGGER reject_panda_receipt BEFORE INSERT ON student_panda_actions BEGIN SELECT RAISE(ABORT, 'fixture receipt failure'); END;");
    await expect(send(command('feed', { count: 112 }))).rejects.toThrow('fixture receipt failure');
    expect(await getPandaProfile(local.db, student, 200)).toMatchObject({ availableFood: 200, profile: { fedTotal: 0, namingPromptSeen: false, revision: 0 } });
  });

  it('누적 먹이 전액을 알과 함께 한 번 지급하고 먹인 양을 이중 환급하지 않는다', async () => {
    const initial = await getPandaProfile(local.db, student, 169);
    expect(initial).toMatchObject({ earnedTotal: 169, availableFood: 169,
      profile: { fedTotal: 0, spentFood: 0, refundFood: 0, revision: 0, owned: [] },
      transition: { version: 1, startingFood: 169, noticeSeen: false } });
    expect(Number.isFinite(Date.parse(initial.transition.initializedAt))).toBe(true);
    const grown = await feedTo(112, 169);
    expect(grown).toMatchObject({ availableFood: 57, profile: { fedTotal: 112, revision: 1 }, transition: initial.transition });
    const reconnected = await getPandaProfile(local.db, student, 171);
    expect(reconnected).toMatchObject({ availableFood: 59, earnedTotal: 171, profile: grown.profile, transition: initial.transition });
  });

  it('전환 버전 0의 기존 DB 기록은 원자적으로 한 번 초기화하고 기존 확정 먹이와 영수증은 보존한다', async () => {
    const previousAction = command('feed', { count: 112 });
    await send(previousAction, 169);
    await send(command('buy', { itemId: 'gardener:hat' }, 1), 169);
    await send(command('nickname', { nickname: '옛이름' }, 2), 169);
    // Simulate a DB initialized by migration 0005, before version 1 existed.
    local.sqlite.exec('UPDATE student_panda_profiles SET transition_version = 0, transition_initialized_at = NULL, transition_starting_food = 0; UPDATE student_panda_actions SET transition_version = 0;');
    const results = await Promise.all(Array.from({ length: 4 }, () => getPandaProfile(local.db, student, 150)));
    expect(results.every(result => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true);
    const reset = results[0];
    expect(reset).toMatchObject({ earnedTotal: 169, availableFood: 169,
      profile: { ...newPandaProfile(), revision: 4 },
      transition: { version: 1, startingFood: 169, noticeSeen: false } });
    await expect(send(previousAction, 169)).rejects.toMatchObject({ code: 'request_id_reused', profile: reset.profile, transition: reset.transition });
    expect(local.sqlite.prepare('SELECT count(*) AS count FROM student_panda_actions').get().count).toBe(3);
    await expect(send(command('feed', { count: 1 }, 3), 169)).rejects.toMatchObject({ code: 'revision_conflict' });
    await send(command('feed', { count: 1 }, 4), 169);
    expect(await getPandaProfile(local.db, student, 169)).toMatchObject({ availableFood: 168, profile: { fedTotal: 1, revision: 5 }, transition: reset.transition });
  });

  it('동시 최초 접속과 전환 응답 유실 후 재접속은 저장된 성장을 다시 초기화하지 않는다', async () => {
    const initialized = await Promise.all(Array.from({ length: 4 }, () => getPandaProfile(local.db, student, 169)));
    expect(initialized.every(result => JSON.stringify(result) === JSON.stringify(initialized[0]))).toBe(true);
    // Initial response was lost; another device received it and fed the panda.
    await feedTo(112, 169);
    expect(await getPandaProfile(local.db, student, 169)).toMatchObject({ availableFood: 57,
      profile: { fedTotal: 112, revision: 1 }, transition: initialized[0].transition });
    expect(local.sqlite.prepare('SELECT count(*) AS count FROM student_panda_profiles').get().count).toBe(1);
  });

  it('일회성 안내 확인은 응답 유실 후 재시도와 다른 기기에서도 유지한다', async () => {
    const initial = await getPandaProfile(local.db, student, 169);
    const dismiss = command('dismiss-transition');
    await send(dismiss, 169);
    await send(command('feed', { count: 3 }, 1), 169);
    expect(await send(dismiss, 169)).toMatchObject({ availableFood: 166, profile: { fedTotal: 3, revision: 2 },
      transition: { ...initial.transition, noticeSeen: true } });
    expect((await getPandaProfile(local.db, student, 169)).transition.noticeSeen).toBe(true);
    expect((await getPandaProfile(local.db, 'other-student', 169)).transition.noticeSeen).toBe(false);
  });

  it('전환 안내 확인의 영수증 저장 실패는 확인 여부와 revision도 함께 롤백한다', async () => {
    await getPandaProfile(local.db, student, 169);
    local.sqlite.exec("CREATE TRIGGER reject_panda_receipt BEFORE INSERT ON student_panda_actions BEGIN SELECT RAISE(ABORT, 'fixture receipt failure'); END;");
    await expect(send(command('dismiss-transition'), 169)).rejects.toThrow('fixture receipt failure');
    expect(await getPandaProfile(local.db, student, 169)).toMatchObject({ profile: { revision: 0 }, transition: { noticeSeen: false } });
  });

  it('불완전 적립 입력은 최초 지급을 확정하지 않고 구형 성장 이관도 거부한다', async () => {
    for (const invalid of [undefined, NaN, -1, 1.2]) {
      await expect(getPandaProfile(local.db, student, invalid)).rejects.toMatchObject({ code: 'earnings_unavailable' });
    }
    expect(local.sqlite.prepare('SELECT count(*) AS count FROM student_panda_profiles').get().count).toBe(0);
    expect(PandaActionSchema.safeParse(command('migrate', { fedTotal: 112 })).success).toBe(false);
    await expect(send(command('migrate', { fedTotal: 112 }))).rejects.toMatchObject({ code: 'invalid_action' });
    expect((await getPandaProfile(local.db, student, 200)).profile).toMatchObject({ fedTotal: 0, revision: 0 });
  });

  it('적립 조회가 감소해도 확정된 먹이를 회수하거나 저장 기록을 초기화하지 않는다', async () => {
    await feedTo();
    expect(await getPandaProfile(local.db, student, 0)).toMatchObject({ earnedTotal: 200, availableFood: 88, profile: { fedTotal: 112 } });
    local.sqlite.prepare('UPDATE student_panda_profiles SET profile = ? WHERE student_id = ?').run('{broken', student);
    await expect(getPandaProfile(local.db, student, 200)).rejects.toMatchObject({ code: 'invalid_saved_profile' });
    expect(local.sqlite.prepare('SELECT profile FROM student_panda_profiles WHERE student_id = ?').get(student).profile).toBe('{broken');
  });

  it('요청의 가격·소유목록 주입, 음수·분수와 잘못된 이름을 거부하고 NFC를 적용한다', () => {
    for (const action of [command('buy', { itemId: 'gardener:hat', price: 0 }), command('feed', { count: -1 }), command('feed', { count: 1.5 }), command('migrate', { fedTotal: 10, owned: ['gardener:hat'] }), command('nickname', { nickname: '   ' }), command('nickname', { nickname: 'x'.repeat(13) }), command('nickname', { nickname: 'a\u0085b' })]) {
      expect(PandaActionSchema.safeParse(action).success).toBe(false);
    }
    expect(PandaActionSchema.parse(command('nickname', { nickname: '  \u1100\u1161  ' })).nickname).toBe('가');
    expect(PandaActionSchema.safeParse(command('nickname', { nickname: '🐼'.repeat(12) })).success).toBe(true);
  });
});
