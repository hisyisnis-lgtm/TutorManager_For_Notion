-- 성조우체국은 성조다락방과 소셜 계정·닉네임·기록을 공유하지 않는다.
-- revision CAS는 오래된 기기 저장 및 초기화 이전 기록의 부활을 차단한다.
CREATE TABLE IF NOT EXISTS finder_users (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  social_id TEXT NOT NULL,
  profile TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_finder_users_social ON finder_users(provider, social_id);
