import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameDataSchema, GameEventSchema } from './schemas.js';
import { collectLocalGameData } from '../../pwa/src/game/gameStore.js';
import { saveBest } from '../../pwa/src/game/tgTokens.js';
import { saveWordStats } from '../../pwa/src/game/tgWordStats.js';
import { saveToneStats } from '../../pwa/src/game/toneStats.js';
import { saveStageScore } from '../../pwa/src/game/gameLogic.js';

vi.mock('../../pwa/src/api/gameApi.js', () => ({ fetchGameMe: vi.fn(), saveGameMe: vi.fn() }));
beforeEach(() => {
  const values = new Map();
  vi.stubGlobal('localStorage', { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k) });
});
afterEach(() => vi.unstubAllGlobals());

describe('game data trust boundary', () => {
  it('실제 클라이언트가 수집한 기본값·기록·레거시 단어 통계를 손실 없이 받는다', () => {
    saveBest('test', 'tone-cooking', { bestScore: 100, bestMaxCombo: 3, bestAvgMs: 800.25, playCount: 2, updatedAt: 1788860000000 });
    saveWordStats('test', { 好: [3, 2, 3000, 3], 妈妈: [5, 5, 5000, 5, 1], 学生: [6, 3, 4500, 4, 0, 2] });
    saveToneStats('test', { 1: [5, 6], 2: [4, 5, 0.891] });
    saveStageScore('test', 'easy-1', 1500);
    const input = collectLocalGameData('test');
    const result = GameDataSchema.safeParse(input);
    expect(result.success, JSON.stringify(result.error)).toBe(true);
    expect(result.data).toEqual(input);
    expect(GameDataSchema.parse({})).toEqual({});
  });

  it.each([
    [], { best: { '<img>': { bestScore: 1 } } }, { best: { 'tone-easy': { bestScore: '<svg>' } } },
    { best: { 'tone-easy': { bestScore: Infinity } } }, { best: { 'tone-easy': { bestScore: -1 } } },
    { words: { 好: [1, 2, 10, 1] } }, { words: { 好: [2, 1, 10, 1, 1, 4] } },
    { words: JSON.parse('{"__proto__":[1,1,10,1]}') }, { words: { constructor: [1, 1, 10, 1] } },
    { tone: { 5: [1, 1] } }, { tone: { 1: [2, 1, 0.8] } }, { tone: { 1: [1, 1, 2] } },
    { stg: { 'easy-99': 5 } }, { xp: '123' }, { extra: '<script>' }, { ach: ['<img>'] },
  ])('손상·HTML 키·잘못된 수치·prototype 키를 저장 전에 거부한다: %j', (input) => {
    expect(GameDataSchema.safeParse(input).success).toBe(false);
  });

  it('실제 트레이닝·스테이지·테마·채널 이벤트는 허용하고 자유 라벨은 거부한다', () => {
    for (const m of ['training', 'easy-1', 'hard-5', 'cooking', 'insta', 'youtube', 'blog', 'kakao-channel']) expect(GameEventSchema.safeParse({ e: 'run_start', m, k: 'member', src: 'web' }).success).toBe(true);
    expect(GameEventSchema.safeParse({ e: 'exam_end', m: 'normal', k: 'member', v: 10 }).success).toBe(true);
    for (const m of ['__proto__', 'constructor', '<svg>', 'arbitrary']) expect(GameEventSchema.safeParse({ e: 'run_start', m }).success).toBe(false);
    expect(GameEventSchema.safeParse({ e: 'enter', src: '<b>' }).success).toBe(false);
    expect(GameEventSchema.safeParse({ e: 'run_end', v: -1 }).success).toBe(false);
  });
});
