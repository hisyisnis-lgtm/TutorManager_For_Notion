-- Apply before deploying the authentication hardening. Existing game data is untouched.
CREATE TABLE IF NOT EXISTS security_rate_limits (
  key_hash TEXT PRIMARY KEY,
  count INTEGER NOT NULL CHECK (count > 0),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_security_rate_expiry ON security_rate_limits (expires_at);

CREATE TABLE IF NOT EXISTS security_challenges (
  key_hash TEXT PRIMARY KEY,
  proof_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_security_challenge_expiry ON security_challenges (expires_at);
