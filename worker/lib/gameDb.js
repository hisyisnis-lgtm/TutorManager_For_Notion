// worker/lib/gameDb.js — 게임 회원 계정 D1 저장소 (Notion GAME_USERS 대체, 2026-07-06).
//
// 회원 데이터(게임데이터 JSON 블롭)를 game_users 테이블 game_data TEXT(무캡)에 저장 → 노션
// rich_text 2000자 트림 한계 제거. 조회 키=(provider, social_id) UNIQUE, id=UUID(게임 JWT sub).
//
// parseGameUserRow는 순수(테스트 용이). DB 함수는 D1Database(env.GAME_DB)를 받는다.

// D1 행 → 앱 유저 객체. game_data JSON 파싱(깨지면 {}).
export function parseGameUserRow(row) {
  if (!row) return null;
  let gameData = {};
  try { gameData = row.game_data ? JSON.parse(row.game_data) : {}; } catch { /* noop */ }
  return {
    id: row.id,
    provider: row.provider,
    socialId: row.social_id,
    nickname: row.nickname || null,
    gameData,
  };
}

// 소셜 신원으로 find-or-create (upsert, 레이스 안전). 있으면 최종접속·닉네임 갱신, 없으면 새 UUID 생성.
// ON CONFLICT(provider, social_id)로 동시 로그인 중복 INSERT 방지. RETURNING으로 최종 행 반환.
export async function findOrCreateGameUser(db, provider, socialId, nickname) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = await db.prepare(
    `INSERT INTO game_users (id, provider, social_id, nickname, game_data, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, '{}', ?, ?)
     ON CONFLICT(provider, social_id) DO UPDATE SET
       last_seen_at = excluded.last_seen_at,
       nickname = COALESCE(excluded.nickname, game_users.nickname)
     RETURNING *`,
  ).bind(id, provider, socialId, nickname || null, now, now).first();
  return parseGameUserRow(row);
}

// id(=JWT sub)로 조회. 없으면 null.
export async function getGameUserById(db, id) {
  const row = await db.prepare('SELECT * FROM game_users WHERE id = ?').bind(id).first();
  return parseGameUserRow(row);
}

// 게임데이터(JSON 객체) + 최종접속 갱신. 닉네임 주면 함께(없으면 기존 유지). 대상 없으면 changes=0.
export async function updateGameData(db, id, gameDataObj, nickname) {
  const json = JSON.stringify(gameDataObj);
  const now = new Date().toISOString();
  const res = await db.prepare(
    'UPDATE game_users SET game_data = ?, last_seen_at = ?, nickname = COALESCE(?, nickname) WHERE id = ?',
  ).bind(json, now, nickname || null, id).run();
  return res;
}

// 계정 삭제(회원 탈퇴) — 행 자체를 지운다. 다시 로그인하면 findOrCreateGameUser가 새 행을 만든다.
//  ⚠️ 되돌릴 수 없다. 호출부(DELETE /game/me)에서 JWT로 본인 확인 후에만 부른다.
export async function deleteGameUser(db, id) {
  return db.prepare('DELETE FROM game_users WHERE id = ?').bind(id).run();
}
