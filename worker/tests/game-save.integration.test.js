import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { signTypedToken } from '../lib/auth.js';
import { getGameUserById, updateGameData } from '../lib/gameDb.js';
import { mergeGameData } from '../lib/gameDataMerge.js';
import { localD1 } from './helpers/localD1.js';

const USER = '11111111-1111-1111-1111-111111111111';
const SECRET = 'isolated-game-merge-fixture-secret';
let database, token, env;
const ctx = { waitUntil: task => task.catch(() => {}) };
const save = data => worker.fetch(new Request('https://worker.fixture.invalid/game/me', {
  method: 'PUT', headers: { Origin: 'http://localhost:5173', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ gameData: data }),
}), env, ctx);

beforeEach(async () => {
  database = localD1();
  database.sqlite.prepare('INSERT INTO game_users (id,provider,social_id,game_data) VALUES (?,?,?,?)').run(USER, 'google', 'fixture', '{}');
  env = { GAME_DB: database.db, JWT_SECRET: SECRET };
  token = await signTypedToken(SECRET, 'game', USER, 600);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));
});
afterEach(() => { database.close(); vi.unstubAllGlobals(); });

describe('member progress is retained across device saves', () => {
  it('keeps A progress after an older B snapshot and returns the merged result', async () => {
    const a = { xp: 1000, rk: 1, bp: 1, stg: { 'easy-2': 1100 }, ach: ['rank-1'], best: { 'tone-easy': { bestScore: 900, playCount: 4 } }, words: { 好: [3, 3, 2000, 3, 1, 0] } };
    expect((await save(a)).status).toBe(200);
    const response = await save({ xp: 200, rk: 0, stg: { 'easy-1': 300 }, ach: ['first-run'], words: { 妈: [2, 2, 1000, 2, 1, 0] } });
    expect(response.status).toBe(200);
    const { gameData } = await response.json();
    expect(gameData).toMatchObject({ xp: 1000, rk: 1, bp: 1, stg: { 'easy-1': 300, 'easy-2': 1100 }, words: a.words, best: a.best });
    expect(gameData.words.妈).toEqual([2, 2, 1000, 2, 1, 0]);
    expect(gameData.ach).toEqual(['rank-1', 'first-run']);
    expect((await getGameUserById(database.db, USER)).gameData).toEqual(gameData);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('re-reads and merges when another save wins between SELECT and UPDATE', async () => {
    let injected = false;
    const racingDb = { prepare(sql) { return { bind(...args) {
      const statement = database.db.prepare(sql).bind(...args);
      if (!sql.startsWith('UPDATE')) return statement;
      return { async run() {
        if (!injected) {
          injected = true;
          await updateGameData(database.db, USER, { xp: 1000, stg: { 'easy-2': 1100 } });
        }
        return statement.run();
      } };
    } }; } };
    const result = await updateGameData(racingDb, USER, { xp: 200, ach: ['first-run'] });
    expect(result.meta.changes).toBe(1);
    expect((await getGameUserById(database.db, USER)).gameData).toMatchObject({ xp: 1000, stg: { 'easy-2': 1100 }, ach: ['first-run'] });
  });

  it('bounds contention retries and preserves the existing row', async () => {
    const racingDb = { prepare(sql) { return { bind(...args) {
      return sql.startsWith('UPDATE') ? { run: async () => ({ meta: { changes: 0 } }) } : database.db.prepare(sql).bind(...args);
    } }; } };
    await expect(updateGameData(racingDb, USER, { xp: 200 })).rejects.toMatchObject({ status: 409 });
    expect((await getGameUserById(database.db, USER)).gameData).toEqual({});
  });

  it('returns 404 for an absent account and does not recreate it', async () => {
    database.sqlite.prepare('DELETE FROM game_users WHERE id=?').run(USER);
    expect((await save({ xp: 1 })).status).toBe(404);
    expect(await getGameUserById(database.db, USER)).toBeNull();
  });

  it('retains per-word state from more attempts, including legitimate mastery loss', () => {
    const stored = { xp: 100, words: { 好: [3, 3, 3000, 3, 1, 0], 妈: [5, 5, 4000, 5, 1, 0] }, tone: { 1: [5, 5, 1] } };
    const incoming = { xp: 200, words: { 好: [6, 3, 6000, 6, 0, 3], 妈: [2, 2, 1000, 2, 1, 0] }, tone: { 1: [1, 2, 0.5] } };
    const merged = mergeGameData(stored, incoming);
    expect(merged.words.好).toEqual(incoming.words.好);
    expect(merged.words.妈).toEqual(stored.words.妈);
    expect(merged.tone).toEqual(stored.tone);
  });

  it('joins adjacent-day streaks without inflating repeated saves', () => {
    const a = { streak: { lastDate: '2026-09-09', current: 10, longest: 10 } };
    const b = { streak: { lastDate: '2026-09-10', current: 1, longest: 1 } };
    const merged = mergeGameData(a, b);
    expect(merged.streak).toEqual({ lastDate: '2026-09-10', current: 11, longest: 11 });
    expect(mergeGameData(merged, b)).toEqual(merged);
  });
});

it('preserves malformed stored data for recovery instead of overwriting it', async () => {
  database.sqlite.prepare('UPDATE game_users SET game_data=? WHERE id=?').run('{broken', USER);
  expect((await save({ xp: 1 })).status).toBe(409);
  expect(database.sqlite.prepare('SELECT game_data FROM game_users WHERE id=?').get(USER).game_data).toBe('{broken');
});
