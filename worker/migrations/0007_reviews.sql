-- Apply to GAME_DB before deploying the review board. No existing tables change.
-- Keep only the current submission and approved snapshot; replaced bodies are not archived.
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  password_salt TEXT,
  password_hash TEXT,
  password_iterations INTEGER,
  latest_content TEXT,
  published_content TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'rejected', 'hidden', 'deleted')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  pending_version INTEGER,
  published_version INTEGER,
  moderation_reason TEXT,
  hidden_reason TEXT,
  restore_allowed INTEGER NOT NULL DEFAULT 0 CHECK (restore_allowed IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  approved_at TEXT,
  deleted_at TEXT,
  idempotency_key_hash TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  request_expires_at INTEGER NOT NULL,
  last_action TEXT,
  last_actor TEXT,
  last_reason TEXT,
  CHECK (status != 'deleted' OR (latest_content IS NULL AND published_content IS NULL AND password_salt IS NULL
    AND password_hash IS NULL AND password_iterations IS NULL AND pending_version IS NULL AND published_version IS NULL
    AND moderation_reason IS NULL AND hidden_reason IS NULL AND last_reason IS NULL AND restore_allowed=0))
);
CREATE INDEX IF NOT EXISTS idx_reviews_public ON reviews (status, published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_pending ON reviews (pending_version, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_admin ON reviews (status, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS review_moderation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id TEXT NOT NULL REFERENCES reviews(id),
  version INTEGER NOT NULL,
  content_version INTEGER,
  action TEXT NOT NULL,
  reason TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Mutation and its audit record commit together, including competing requests.
CREATE TRIGGER IF NOT EXISTS review_moderation_audit
AFTER UPDATE ON reviews
WHEN NEW.version > OLD.version AND NEW.last_action IN ('approve', 'reject', 'hide', 'restore')
BEGIN
  INSERT INTO review_moderation_log (review_id, version, content_version, action, reason, actor, created_at)
  VALUES (NEW.id, NEW.version, CASE WHEN NEW.last_action IN ('approve', 'reject') THEN OLD.pending_version ELSE OLD.published_version END,
    NEW.last_action, NEW.last_reason, NEW.last_actor, NEW.updated_at);
END;

-- A tombstone cannot retain any body, credential, or free-text moderation reason.
CREATE TRIGGER IF NOT EXISTS review_delete_scrub
AFTER UPDATE ON reviews
WHEN NEW.status = 'deleted' AND OLD.status != 'deleted'
BEGIN
  UPDATE review_moderation_log SET reason=NULL WHERE review_id=NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS review_tombstone_immutable
BEFORE UPDATE ON reviews
WHEN OLD.status = 'deleted'
BEGIN
  SELECT RAISE(ABORT, 'review_deleted');
END;
