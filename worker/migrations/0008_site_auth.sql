-- Website members are independent of game users, Notion students, and teacher tokens.
CREATE TABLE IF NOT EXISTS site_members (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','withdrawn')),
  email TEXT,
  name TEXT NOT NULL DEFAULT '',
  nickname TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  member_code TEXT NOT NULL UNIQUE,
  customer_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL CHECK (provider IN ('email','google','kakao')),
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
  CHECK (provider != 'email' OR (email IS NOT NULL AND password_hash IS NOT NULL))
);
-- The same verified address can belong to independent provider identities.
-- Email-password login looks up only provider='email'; never merge by address.
CREATE UNIQUE INDEX IF NOT EXISTS site_members_password_email ON site_members(email) WHERE provider='email';

CREATE TABLE IF NOT EXISTS site_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_hash TEXT NOT NULL,
  member_id TEXT REFERENCES site_members(id),
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS site_sessions_member ON site_sessions(member_id);
CREATE INDEX IF NOT EXISTS site_sessions_expiry ON site_sessions(expires_at);

CREATE TABLE IF NOT EXISTS site_email_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  proof_hash TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES site_sessions(id),
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  consumption_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS site_registration_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES site_sessions(id),
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS site_password_resets (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES site_members(id),
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  consumption_id TEXT UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS site_password_resets_member ON site_password_resets(member_id);
CREATE TABLE IF NOT EXISTS site_oauth_states (
  state_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('google','kakao')),
  nonce_hash TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES site_sessions(id),
  callback_uri TEXT NOT NULL,
  return_to TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS site_auth_rate_limits (
  key_hash TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Suspension/withdrawal and password resets immediately revoke every member session.
CREATE TRIGGER IF NOT EXISTS site_members_revoke_sessions
AFTER UPDATE OF status ON site_members
WHEN NEW.status IN ('suspended','withdrawn')
BEGIN
  UPDATE site_sessions SET revoked_at=unixepoch() WHERE member_id=NEW.id AND revoked_at IS NULL;
END;
