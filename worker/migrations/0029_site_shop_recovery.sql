-- Close a request without cancelling a payment, with optimistic concurrency.
-- Keep the existing state constraint; closed_by distinguishes withdrawal from rejection.
ALTER TABLE site_shop_refunds ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE site_shop_refunds ADD COLUMN closure_reason TEXT;
ALTER TABLE site_shop_refunds ADD COLUMN closed_by TEXT CHECK(closed_by IS NULL OR closed_by IN ('member','admin'));
ALTER TABLE site_shop_refunds ADD COLUMN closed_at TEXT;
CREATE TABLE IF NOT EXISTS site_shop_refund_events (
  id TEXT PRIMARY KEY, refund_id TEXT NOT NULL REFERENCES site_shop_refunds(id),
  actor TEXT NOT NULL CHECK(actor IN ('member','admin')), actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('withdrawn','rejected')), version INTEGER NOT NULL CHECK(version>1),
  reason TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(refund_id,version)
);

-- A broken notification must not occupy the first reconciliation batch forever.
ALTER TABLE site_shop_webhook_inbox ADD COLUMN retry_attempts INTEGER NOT NULL DEFAULT 0 CHECK(retry_attempts>=0);
ALTER TABLE site_shop_webhook_inbox ADD COLUMN retry_after INTEGER NOT NULL DEFAULT 0;
ALTER TABLE site_shop_webhook_inbox ADD COLUMN last_error_code TEXT;
CREATE INDEX IF NOT EXISTS idx_site_shop_webhook_retry ON site_shop_webhook_inbox(state,retry_after,updated_at);
