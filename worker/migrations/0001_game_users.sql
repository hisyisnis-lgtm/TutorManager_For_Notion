-- 게임 회원 계정 (소셜 로그인) — Notion GAME_USERS에서 D1로 이전.
-- game_data는 회원 게임데이터 JSON 블롭(캡 없음 → 노션 2000자 트림 한계 제거).
-- 조회 키 = (provider, social_id) UNIQUE. id = 랜덤 UUID(게임 JWT sub, 소셜ID 비노출).
CREATE TABLE IF NOT EXISTS game_users (
  id           TEXT PRIMARY KEY,
  provider     TEXT NOT NULL,
  social_id    TEXT NOT NULL,
  nickname     TEXT,
  game_data    TEXT,
  created_at   TEXT,
  last_seen_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_users_social
  ON game_users (provider, social_id);
