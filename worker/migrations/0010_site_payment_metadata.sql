-- Preserve PG channel information separately from the actual method.
ALTER TABLE site_payments ADD COLUMN easy_pay_provider TEXT;
-- An instructor approves an immutable amount/reason snapshot, not necessarily
-- the member's initially requested full remaining balance.
ALTER TABLE site_refund_requests ADD COLUMN approved_amount INTEGER CHECK(approved_amount IS NULL OR approved_amount>0);
ALTER TABLE site_refund_requests ADD COLUMN approved_reason TEXT;
ALTER TABLE site_refund_requests ADD COLUMN approved_pg_reason TEXT;

-- These CREATEs also cover a local pre-release database that already applied
-- an earlier draft of 0009; they do not alter existing member or payment values.
CREATE TRIGGER IF NOT EXISTS site_attempt_confirming_order
AFTER UPDATE ON site_payment_attempts WHEN NEW.state='confirming' AND OLD.state!='confirming'
BEGIN
  UPDATE site_orders SET status='confirming',updated_at=NEW.updated_at WHERE id=NEW.order_id AND approved_at IS NULL;
END;
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
