-- Website commerce is independent from game/student/teacher authentication.
CREATE TABLE IF NOT EXISTS site_student_links (
  member_id TEXT PRIMARY KEY REFERENCES site_members(id), student_id TEXT NOT NULL,
  verified_at TEXT NOT NULL, verified_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS site_targets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, experience_type TEXT NOT NULL,
  class_type_id TEXT NOT NULL, student_required INTEGER NOT NULL, time_ledger_mode TEXT NOT NULL,
  unit_price INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK(experience_type IN ('class','special','external','other')),
  CHECK(time_ledger_mode IN ('hours','none')),
  CHECK(student_required IN (0,1) AND active IN (0,1) AND unit_price>=0)
);
CREATE TABLE IF NOT EXISTS site_payment_requests (
  id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES site_members(id), target_id TEXT NOT NULL REFERENCES site_targets(id),
  billing_key TEXT NOT NULL UNIQUE, billing_period TEXT NOT NULL, snapshot TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount>0), currency TEXT NOT NULL DEFAULT 'KRW' CHECK(currency='KRW'),
  terms_version TEXT NOT NULL, expires_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK(status IN ('open','ordered','paid','cancelled','expired'))
);
CREATE INDEX IF NOT EXISTS idx_site_requests_owner ON site_payment_requests(member_id,created_at DESC);
CREATE TABLE IF NOT EXISTS site_orders (
  id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES site_members(id), request_id TEXT NOT NULL UNIQUE REFERENCES site_payment_requests(id),
  idempotency_hash TEXT NOT NULL UNIQUE, payload_hash TEXT NOT NULL, snapshot TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount>0), currency TEXT NOT NULL DEFAULT 'KRW' CHECK(currency='KRW'),
  status TEXT NOT NULL DEFAULT 'pending', active_attempt_id TEXT, payment_method TEXT,
  refunded_amount INTEGER NOT NULL DEFAULT 0 CHECK(refunded_amount>=0 AND refunded_amount<=amount),
  last_evidence_hash TEXT, version INTEGER NOT NULL DEFAULT 1, approved_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK(status IN ('pending','confirming','paid','partially_refunded','refunded','failed','expired'))
);
CREATE INDEX IF NOT EXISTS idx_site_orders_owner ON site_orders(member_id,created_at DESC);
CREATE TABLE IF NOT EXISTS site_order_items (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES site_orders(id), target_id TEXT NOT NULL REFERENCES site_targets(id), snapshot TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS site_payment_attempts (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES site_orders(id), pg_order_id TEXT NOT NULL UNIQUE,
  pg_environment TEXT NOT NULL CHECK(pg_environment IN ('test','live')), payment_key TEXT UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE, state TEXT NOT NULL DEFAULT 'ready', lease_token TEXT, lease_until INTEGER,
  error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK(state IN ('ready','confirming','paid','failed','expired'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_one_active_attempt ON site_payment_attempts(order_id) WHERE state IN ('ready','confirming','paid');
CREATE TRIGGER IF NOT EXISTS site_attempt_confirming_order
AFTER UPDATE ON site_payment_attempts WHEN NEW.state='confirming' AND OLD.state!='confirming'
BEGIN
  UPDATE site_orders SET status='confirming',updated_at=NEW.updated_at WHERE id=NEW.order_id AND approved_at IS NULL;
END;
CREATE TABLE IF NOT EXISTS site_payments (
  payment_key TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES site_orders(id), attempt_id TEXT NOT NULL REFERENCES site_payment_attempts(id),
  pg_order_id TEXT NOT NULL UNIQUE, pg_environment TEXT NOT NULL, merchant_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount>0), currency TEXT NOT NULL CHECK(currency='KRW'), method TEXT NOT NULL,
  approved_at TEXT NOT NULL, refunded_amount INTEGER NOT NULL DEFAULT 0,
  refund_at TEXT, refund_reason TEXT, evidence_hash TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK(refunded_amount>=0 AND refunded_amount<=amount)
);
CREATE TABLE IF NOT EXISTS site_refund_transactions (
  transaction_key TEXT PRIMARY KEY, payment_key TEXT NOT NULL REFERENCES site_payments(payment_key),
  amount INTEGER NOT NULL CHECK(amount>0), cancelled_at TEXT NOT NULL, reason TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS site_refund_requests (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES site_orders(id), member_id TEXT NOT NULL REFERENCES site_members(id),
  amount INTEGER NOT NULL CHECK(amount>0), reason TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
  idempotency_key TEXT NOT NULL UNIQUE, pg_reason TEXT NOT NULL, lease_token TEXT, lease_until INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, approved_at TEXT,
  CHECK(state IN ('pending','approving','completed','unknown','failed','rejected'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_refund_inflight ON site_refund_requests(order_id) WHERE state IN ('pending','approving','unknown');
CREATE TABLE IF NOT EXISTS site_pg_webhook_inbox (
  id TEXT PRIMARY KEY, event_type TEXT NOT NULL, pg_order_id TEXT NOT NULL, payment_key TEXT,
  payload_hash TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS site_notion_outbox (
  order_item_id TEXT PRIMARY KEY REFERENCES site_order_items(id), desired_version INTEGER NOT NULL,
  applied_version INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'pending', reason_code TEXT,
  notion_page_id TEXT UNIQUE, lease_token TEXT, lease_until INTEGER, next_attempt_at INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0, create_started_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK(state IN ('pending','processing','synced','needs_setup','unknown','failed'))
);
CREATE INDEX IF NOT EXISTS idx_site_notion_pending ON site_notion_outbox(state,next_attempt_at);

-- Queryable approved review facts are separate from private order ownership.
ALTER TABLE reviews ADD COLUMN member_id TEXT REFERENCES site_members(id);
ALTER TABLE reviews ADD COLUMN latest_target_id TEXT REFERENCES site_targets(id);
ALTER TABLE reviews ADD COLUMN published_target_id TEXT REFERENCES site_targets(id);
ALTER TABLE reviews ADD COLUMN latest_rating INTEGER CHECK(latest_rating IS NULL OR latest_rating BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN published_rating INTEGER CHECK(published_rating IS NULL OR published_rating BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN latest_purchase_item_id TEXT REFERENCES site_order_items(id);
ALTER TABLE reviews ADD COLUMN published_purchase_item_id TEXT REFERENCES site_order_items(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_member_review_target ON reviews(member_id,latest_target_id)
  WHERE member_id IS NOT NULL AND latest_target_id IS NOT NULL AND status!='deleted';
-- Both the pending target and the approved target reserve this member's slot.
CREATE TRIGGER IF NOT EXISTS site_review_target_insert_guard
BEFORE INSERT ON reviews WHEN NEW.member_id IS NOT NULL AND NEW.status!='deleted'
BEGIN
  SELECT RAISE(ABORT,'site_review_target_conflict') WHERE EXISTS(
    SELECT 1 FROM reviews r WHERE r.member_id=NEW.member_id AND r.status!='deleted'
    AND (r.latest_target_id IN (NEW.latest_target_id,NEW.published_target_id)
      OR r.published_target_id IN (NEW.latest_target_id,NEW.published_target_id))
  );
END;
CREATE TRIGGER IF NOT EXISTS site_review_target_update_guard
BEFORE UPDATE ON reviews WHEN NEW.member_id IS NOT NULL AND NEW.status!='deleted'
BEGIN
  SELECT RAISE(ABORT,'site_review_target_conflict') WHERE EXISTS(
    SELECT 1 FROM reviews r WHERE r.id!=NEW.id AND r.member_id=NEW.member_id AND r.status!='deleted'
    AND (r.latest_target_id IN (NEW.latest_target_id,NEW.published_target_id)
      OR r.published_target_id IN (NEW.latest_target_id,NEW.published_target_id))
  );
END;

CREATE TRIGGER IF NOT EXISTS site_review_approved_facts
AFTER UPDATE ON reviews WHEN NEW.version>OLD.version AND NEW.last_action='approve'
BEGIN
  UPDATE reviews SET published_target_id=NEW.latest_target_id,published_rating=NEW.latest_rating,
    published_purchase_item_id=NEW.latest_purchase_item_id WHERE id=NEW.id;
END;
-- Do not resurrect deleted text. Cleanup of the new derived facts occurs with deletion.
CREATE TRIGGER IF NOT EXISTS site_review_deleted_facts
AFTER UPDATE ON reviews WHEN NEW.status='deleted' AND OLD.status!='deleted'
BEGIN
  DELETE FROM site_review_purchase_facts WHERE review_id=NEW.id;
END;
CREATE TABLE IF NOT EXISTS site_review_purchase_facts (
  review_id TEXT PRIMARY KEY REFERENCES reviews(id), order_item_id TEXT NOT NULL REFERENCES site_order_items(id), checked_at TEXT NOT NULL
);
