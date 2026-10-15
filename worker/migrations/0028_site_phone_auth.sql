-- Apply as ONE D1 migration transaction. Never disable foreign_keys or rename
-- the old parent: child references must continue to target site_members.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE site_members_phone_next (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','withdrawn')),
  email TEXT,
  name TEXT NOT NULL DEFAULT '',
  nickname TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  member_code TEXT NOT NULL UNIQUE,
  customer_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL CHECK (provider IN ('email','google','kakao','phone')),
  provider_subject TEXT,
  password_hash TEXT,
  password_salt TEXT,
  password_iterations INTEGER,
  registration_token_hash TEXT UNIQUE,
  terms_accepted_at TEXT,
  privacy_accepted_at TEXT,
  marketing_accepted INTEGER NOT NULL DEFAULT 0 CHECK (marketing_accepted IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider, provider_subject),
  CHECK (provider != 'email' OR (email IS NOT NULL AND password_hash IS NOT NULL)),
  CHECK (provider != 'phone' OR (provider_subject IS NOT NULL AND provider_subject GLOB '+8210[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'))
);
INSERT INTO site_members_phone_next SELECT * FROM site_members;
DROP TABLE site_members;
ALTER TABLE site_members_phone_next RENAME TO site_members;
CREATE UNIQUE INDEX site_members_password_email ON site_members(email) WHERE provider='email';
CREATE INDEX idx_site_members_student_queue ON site_members(status,created_at DESC,id DESC);
CREATE TRIGGER site_members_revoke_sessions
AFTER UPDATE OF status ON site_members
WHEN NEW.status IN ('suspended','withdrawn')
BEGIN
  UPDATE site_sessions SET revoked_at=unixepoch() WHERE member_id=NEW.id AND revoked_at IS NULL;
END;

CREATE TABLE site_member_identities_phone_next (
  provider TEXT NOT NULL CHECK(provider IN ('email','google','kakao','phone')),
  provider_subject TEXT NOT NULL,
  member_id TEXT NOT NULL REFERENCES site_members(id),
  email TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(provider,provider_subject),
  UNIQUE(member_id,provider)
);
INSERT INTO site_member_identities_phone_next SELECT * FROM site_member_identities;
DROP TABLE site_member_identities;
ALTER TABLE site_member_identities_phone_next RENAME TO site_member_identities;

CREATE TABLE site_phone_challenges (
  id TEXT PRIMARY KEY,
  phone_e164 TEXT NOT NULL,
  phone_hash TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('signin','link')),
  member_id TEXT REFERENCES site_members(id),
  session_id TEXT NOT NULL REFERENCES site_sessions(id),
  csrf_hash TEXT NOT NULL,
  proof_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK(delivery_state IN ('pending','accepted','failed','unknown','superseded')),
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  consumption_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  CHECK((purpose='signin' AND member_id IS NULL) OR (purpose='link' AND member_id IS NOT NULL))
);
CREATE INDEX idx_site_phone_challenge_expiry ON site_phone_challenges(expires_at);
CREATE TABLE site_phone_proofs (
  token_hash TEXT PRIMARY KEY,
  phone_e164 TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('signin','link')),
  member_id TEXT REFERENCES site_members(id),
  session_id TEXT NOT NULL REFERENCES site_sessions(id),
  csrf_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  consumption_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  CHECK((purpose='signin' AND member_id IS NULL) OR (purpose='link' AND member_id IS NOT NULL))
);
CREATE INDEX idx_site_phone_proof_expiry ON site_phone_proofs(expires_at);
CREATE TABLE site_phone_send_cooldowns (
  phone_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE TABLE site_phone_daily_usage (
  day TEXT PRIMARY KEY,
  sends INTEGER NOT NULL CHECK(sends>0)
);
-- A parent DROP can leave SQLite's deferred violation counter set even after
-- all original IDs are restored under the original table name. Check the actual
-- foreign keys before returning to immediate validation; never foreign_keys=OFF.
CREATE TABLE site_phone_migration_fk_guard (violations INTEGER NOT NULL CHECK(violations=0));
INSERT INTO site_phone_migration_fk_guard SELECT COUNT(*) FROM pragma_foreign_key_check;
DROP TABLE site_phone_migration_fk_guard;
PRAGMA defer_foreign_keys = OFF;
