-- Notification outcomes and operator follow-up are separate from business data.
-- No recipient phone, OTP, message body, credentials, or student code is stored.
CREATE TABLE IF NOT EXISTS notification_followups (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  reference_id TEXT,
  delivery_state TEXT NOT NULL CHECK (delivery_state IN ('queued', 'accepted', 'failed', 'unknown')),
  reason_code TEXT NOT NULL,
  counts_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolution_kind TEXT CHECK (resolution_kind IN ('provider_checked', 'contacted', 'no_action_needed')),
  resolved_by TEXT CHECK (resolved_by = 'teacher'),
  CHECK ((resolved_at IS NULL AND resolution_kind IS NULL AND resolved_by IS NULL)
    OR (resolved_at IS NOT NULL AND resolution_kind IS NOT NULL AND resolved_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_notification_followups_open
  ON notification_followups (resolved_at, created_at DESC, id DESC);
