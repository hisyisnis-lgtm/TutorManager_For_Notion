import { describe, it, expect } from 'vitest';
import {
  parseGameUserRow,
  findOrCreateGameUser,
  getGameUserById,
  updateGameData, deleteGameUser } from './gameDb.js';

// 최소 D1 mock — prepare().bind().first()/run() 체인. 호출 SQL·바인딩을 기록.
function mockDb({ firstRow = null, runResult = { success: true, meta: { changes: 1 } } } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => { calls.push({ op: 'first', sql, args }); return firstRow; },
            run: async () => { calls.push({ op: 'run', sql, args }); return runResult; },
          };
        },
      };
    },
  };
}

describe('parseGameUserRow', () => {
  it('행 → 유저 객체 + game_data JSON 파싱', () => {
    const row = { id: 'u1', provider: 'kakao', social_id: '555', nickname: '홍길동', game_data: '{"best":{"tone-hard":{"bestScore":1450}}}' };
    expect(parseGameUserRow(row)).toEqual({
      id: 'u1', provider: 'kakao', socialId: '555', nickname: '홍길동',
      gameData: { best: { 'tone-hard': { bestScore: 1450 } } },
    });
  });
  it('game_data 없거나 깨지면 {}', () => {
    expect(parseGameUserRow({ id: 'u', provider: 'google', social_id: '1', nickname: null, game_data: null }).gameData).toEqual({});
    expect(parseGameUserRow({ id: 'u', provider: 'google', social_id: '1', nickname: null, game_data: '{broken' }).gameData).toEqual({});
  });
  it('nickname 없으면 null, row 없으면 null', () => {
    expect(parseGameUserRow({ id: 'u', provider: 'google', social_id: '1', nickname: '', game_data: '{}' }).nickname).toBe(null);
    expect(parseGameUserRow(null)).toBe(null);
    expect(parseGameUserRow(undefined)).toBe(null);
  });
});

describe('findOrCreateGameUser', () => {
  it('upsert(INSERT..ON CONFLICT..RETURNING) 실행하고 결과 행을 파싱해 반환', async () => {
    const db = mockDb({ firstRow: { id: 'u9', provider: 'google', social_id: '42', nickname: 'Kim', game_data: '{}' } });
    const user = await findOrCreateGameUser(db, 'google', '42', 'Kim');
    expect(user).toEqual({ id: 'u9', provider: 'google', socialId: '42', nickname: 'Kim', gameData: {} });
    const call = db.calls[0];
    expect(call.op).toBe('first');
    expect(call.sql).toMatch(/INSERT INTO game_users/);
    expect(call.sql).toMatch(/ON CONFLICT\(provider, social_id\)/);
    expect(call.sql).toMatch(/RETURNING/);
    // 바인딩에 provider·socialId·nickname 포함 (id·시각은 앞쪽)
    expect(call.args).toContain('google');
    expect(call.args).toContain('42');
    expect(call.args).toContain('Kim');
  });
  it('nickname 없으면 null 바인딩', async () => {
    const db = mockDb({ firstRow: { id: 'u', provider: 'kakao', social_id: '1', nickname: null, game_data: '{}' } });
    await findOrCreateGameUser(db, 'kakao', '1', null);
    expect(db.calls[0].args).toContain(null);
  });
});

describe('getGameUserById', () => {
  it('SELECT by id → 파싱', async () => {
    const db = mockDb({ firstRow: { id: 'u1', provider: 'kakao', social_id: '5', nickname: 'N', game_data: '{}' } });
    const user = await getGameUserById(db, 'u1');
    expect(user.id).toBe('u1');
    expect(db.calls[0].sql).toMatch(/SELECT \* FROM game_users WHERE id = \?/);
    expect(db.calls[0].args).toEqual(['u1']);
  });
  it('없으면 null', async () => {
    const db = mockDb({ firstRow: null });
    expect(await getGameUserById(db, 'nope')).toBe(null);
  });
});

describe('updateGameData', () => {
  it('UPDATE game_data + last_seen_at, gameData를 JSON 문자열로 바인딩', async () => {
    const db = mockDb();
    await updateGameData(db, 'u1', { best: { 'tone-easy': { bestScore: 100 } } }, 'Nick');
    const call = db.calls[0];
    expect(call.op).toBe('run');
    expect(call.sql).toMatch(/UPDATE game_users SET game_data = \?/);
    expect(call.args[0]).toBe('{"best":{"tone-easy":{"bestScore":100}}}');
    expect(call.args).toContain('u1');
    expect(call.args).toContain('Nick');
  });
  it('nickname 없으면 null 바인딩(기존 유지 COALESCE)', async () => {
    const db = mockDb();
    await updateGameData(db, 'u1', {}, null);
    expect(db.calls[0].args).toContain(null);
    expect(db.calls[0].sql).toMatch(/COALESCE\(\?, nickname\)/);
  });
});

describe('deleteGameUser', () => {
  it('id로 행을 DELETE 한다', async () => {
    const db = mockDb();
    await deleteGameUser(db, 'u1');
    const call = db.calls[0];
    expect(call.op).toBe('run');
    expect(call.sql).toMatch(/DELETE FROM game_users WHERE id = \?/);
    expect(call.args).toEqual(['u1']);
  });
  it('다른 사용자 행을 건드리지 않도록 WHERE에 id가 반드시 있다', async () => {
    const db = mockDb();
    await deleteGameUser(db, 'u2');
    expect(db.calls[0].sql).toMatch(/WHERE id = \?/);
    expect(db.calls[0].sql).not.toMatch(/DELETE FROM game_users\s*$/);
  });
});
