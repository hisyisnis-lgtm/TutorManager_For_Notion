-- Student identity is the verified Notion page ID, never the client-provided account key.
CREATE TABLE IF NOT EXISTS student_panda_profiles (
  student_id TEXT PRIMARY KEY,
  profile TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  earned_total INTEGER NOT NULL DEFAULT 0 CHECK (earned_total >= 0),
  legacy_migrated INTEGER NOT NULL DEFAULT 0 CHECK (legacy_migrated IN (0, 1)),
  last_request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The state change and its receipt are committed in the same D1 batch transaction.
CREATE TABLE IF NOT EXISTS student_panda_actions (
  student_id TEXT NOT NULL REFERENCES student_panda_profiles(student_id),
  request_id TEXT NOT NULL,
  action_json TEXT NOT NULL,
  profile TEXT NOT NULL,
  revision INTEGER NOT NULL,
  earned_total INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (student_id, request_id)
);
