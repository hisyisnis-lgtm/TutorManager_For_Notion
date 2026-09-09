-- Authenticated browser push subscriptions and 30-day teacher notification history.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint_hash TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  expiration_time INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_notifications (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 5),
  tags_json TEXT NOT NULL DEFAULT '[]',
  target_url TEXT NOT NULL DEFAULT '/#/notifications'
);
CREATE INDEX IF NOT EXISTS idx_push_notifications_created_at ON push_notifications (created_at DESC);
