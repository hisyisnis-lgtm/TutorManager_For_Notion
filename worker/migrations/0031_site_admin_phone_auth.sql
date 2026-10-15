-- Staff OTP uses its own anonymous administrator session, never a member identity.
-- Phone numbers and OTP codes are not stored. The allowlist stays in a secret.
CREATE TABLE site_admin_phone_challenges (
  id TEXT PRIMARY KEY,
  principal_hash TEXT NOT NULL,
  phone_hash TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES site_admin_sessions(id) ON DELETE CASCADE,
  csrf_hash TEXT NOT NULL,
  credential_fingerprint TEXT NOT NULL,
  proof_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK(delivery_state IN ('pending','accepted','failed','unknown','superseded')),
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  consumption_id TEXT UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_site_admin_phone_challenge_expiry ON site_admin_phone_challenges(expires_at);
CREATE TABLE site_admin_phone_sessions (
  session_id TEXT PRIMARY KEY REFERENCES site_admin_sessions(id) ON DELETE CASCADE,
  principal_hash TEXT NOT NULL,
  auth_method TEXT NOT NULL CHECK(auth_method='phone')
);
