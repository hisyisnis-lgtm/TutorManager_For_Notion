import { describe, expect, it } from 'vitest';
import { GameDataSchema } from './schemas.js';
import { mergeGameData } from './gameDataMerge.js';
import { updateGameData } from './gameDb.js';

describe('회원 온보딩 선택 완료', () => {
  it.each([{}, { onboardingDone: true }, { onboardingDone: false }])('선택적 boolean 필드를 허용한다: %j', data => {
    expect(GameDataSchema.parse(data)).toEqual(data);
  });

  it.each([null, 1, 'true', {}, []])('boolean 이외의 완료 값은 거부한다: %j', onboardingDone => {
    expect(GameDataSchema.safeParse({ onboardingDone }).success).toBe(false);
  });

  it('새 필드가 생겨도 모르는 데이터는 계속 거부한다', () => {
    expect(GameDataSchema.safeParse({ onboardingDone: true, unknown: true }).success).toBe(false);
  });

  it.each([{}, { onboardingDone: false }, { onboardingDone: true }])('완료된 회원에게 오래된 사본 %j이 와도 true를 보존한다', incoming => {
    expect(mergeGameData({ onboardingDone: true }, incoming).onboardingDone).toBe(true);
  });

  it('첫 선택을 받아들이고 아직 선택하지 않은 계정에 완료 필드를 만들지 않는다', () => {
    expect(mergeGameData({}, { onboardingDone: true })).toEqual({ onboardingDone: true });
    expect(mergeGameData({}, {})).toEqual({});
    expect(mergeGameData({ onboardingDone: false }, {})).toEqual({ onboardingDone: false });
  });

  it('실제 D1 저장 경로도 기존 완료를 보존한 결과를 저장·반환한다', async () => {
    let saved;
    const db = {
      prepare: () => ({
        bind: (...args) => ({
          first: async () => ({ id: 'member-a', game_data: '{"onboardingDone":true}' }),
          run: async () => { saved = JSON.parse(args[0]); return { success: true, meta: { changes: 1 } }; },
        }),
      }),
    };
    const result = await updateGameData(db, 'member-a', { onboardingDone: false });
    expect(saved.onboardingDone).toBe(true);
    expect(result.gameData.onboardingDone).toBe(true);
  });
});
