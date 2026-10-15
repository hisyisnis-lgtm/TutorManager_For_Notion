-- Opaque website administrator sessions are independent of member and teacher Bearer tokens.
-- Raw cookies, CSRF tokens, passwords and signing secrets are never persisted.
CREATE TABLE IF NOT EXISTS site_admin_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_hash TEXT NOT NULL,
  credential_fingerprint TEXT NOT NULL,
  role TEXT CHECK(role IS NULL OR role='teacher'),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  CHECK(expires_at>created_at AND expires_at<=created_at+28800),
  CHECK(revoked_at IS NULL OR revoked_at>=created_at)
);
CREATE INDEX IF NOT EXISTS idx_site_admin_sessions_expiry ON site_admin_sessions(expires_at);
