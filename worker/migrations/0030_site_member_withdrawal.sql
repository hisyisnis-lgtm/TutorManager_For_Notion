-- Withdrawal keeps only an opaque FK owner for separately retained transactions.
-- No member is withdrawn or backfilled by this migration.
CREATE TABLE site_member_withdrawals (
  member_id TEXT PRIMARY KEY REFERENCES site_members(id),
  operation_id TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL DEFAULT 'requested' CHECK(reason IN ('requested','incomplete_expired')),
  completed_at TEXT NOT NULL,
  counts_json TEXT NOT NULL CHECK(json_valid(counts_json)),
  student_id TEXT,
  sync_state TEXT NOT NULL CHECK(sync_state IN ('not_required','pending','synced','needs_attention')),
  record_state TEXT NOT NULL DEFAULT 'pending' CHECK(record_state IN ('pending','stored','needs_attention')),
  sync_error_code TEXT,
  CHECK(student_id IS NULL OR (length(student_id)=32 AND student_id=lower(student_id) AND student_id NOT GLOB '*[^a-f0-9]*'))
);
-- A stale callback or teacher approval must never reactivate a deleted identity.
CREATE TRIGGER site_withdrawn_member_immutable BEFORE UPDATE ON site_members
WHEN OLD.status='withdrawn' BEGIN SELECT RAISE(ABORT,'member_withdrawn'); END;
CREATE TRIGGER site_withdrawn_identity_guard BEFORE INSERT ON site_member_identities
WHEN EXISTS(SELECT 1 FROM site_members WHERE id=NEW.member_id AND status='withdrawn')
BEGIN SELECT RAISE(ABORT,'member_withdrawn'); END;
CREATE TRIGGER site_withdrawn_link_guard BEFORE INSERT ON site_student_links
WHEN EXISTS(SELECT 1 FROM site_members WHERE id=NEW.member_id AND status='withdrawn')
BEGIN SELECT RAISE(ABORT,'member_withdrawn'); END;
CREATE TRIGGER site_withdrawn_claim_guard BEFORE INSERT ON site_student_identity_claims
WHEN EXISTS(SELECT 1 FROM site_members WHERE id=NEW.member_id AND status='withdrawn')
BEGIN SELECT RAISE(ABORT,'member_withdrawn'); END;
CREATE TRIGGER site_withdrawn_enrollment_guard BEFORE INSERT ON site_student_enrollments
WHEN EXISTS(SELECT 1 FROM site_members WHERE id=NEW.member_id AND status='withdrawn')
BEGIN SELECT RAISE(ABORT,'member_withdrawn'); END;
CREATE TRIGGER site_withdrawn_session_insert_guard BEFORE INSERT ON site_sessions
WHEN NEW.member_id IS NOT NULL AND EXISTS(SELECT 1 FROM site_members WHERE id=NEW.member_id AND status='withdrawn')
BEGIN SELECT RAISE(ABORT,'member_withdrawn'); END;
CREATE TRIGGER site_withdrawn_session_update_guard BEFORE UPDATE ON site_sessions
WHEN NEW.member_id IS NOT NULL AND EXISTS(SELECT 1 FROM site_members WHERE id=NEW.member_id AND status='withdrawn')
BEGIN SELECT RAISE(ABORT,'member_withdrawn'); END;
CREATE TRIGGER site_withdrawn_shop_order_guard BEFORE INSERT ON site_shop_orders
WHEN EXISTS(SELECT 1 FROM site_members WHERE id=NEW.member_id AND status='withdrawn')
BEGIN SELECT RAISE(ABORT,'member_withdrawn'); END;
CREATE TRIGGER site_withdrawn_lesson_order_guard BEFORE INSERT ON site_orders
WHEN EXISTS(SELECT 1 FROM site_members WHERE id=NEW.member_id AND status='withdrawn')
BEGIN SELECT RAISE(ABORT,'member_withdrawn'); END;
CREATE TRIGGER site_withdrawn_request_guard BEFORE INSERT ON site_payment_requests
WHEN EXISTS(SELECT 1 FROM site_members WHERE id=NEW.member_id AND status='withdrawn')
BEGIN SELECT RAISE(ABORT,'member_withdrawn'); END;
CREATE TRIGGER site_withdrawn_review_guard BEFORE INSERT ON reviews
WHEN NEW.member_id IS NOT NULL AND EXISTS(SELECT 1 FROM site_members WHERE id=NEW.member_id AND status='withdrawn')
BEGIN SELECT RAISE(ABORT,'member_withdrawn'); END;
CREATE TRIGGER site_withdrawn_reset_guard BEFORE INSERT ON site_password_resets
WHEN EXISTS(SELECT 1 FROM site_members WHERE id=NEW.member_id AND status='withdrawn')
BEGIN SELECT RAISE(ABORT,'member_withdrawn'); END;
-- A detached student remains OFF until the explicit withdrawal sync is resolved.
CREATE TRIGGER site_withdrawal_pending_grant_insert BEFORE INSERT ON student_app_access
WHEN NEW.allowed=1 AND EXISTS(SELECT 1 FROM site_member_withdrawals WHERE student_id=NEW.student_id AND sync_state IN ('pending','needs_attention'))
BEGIN SELECT RAISE(ABORT,'member_withdrawal_sync_pending'); END;
CREATE TRIGGER site_withdrawal_pending_grant_update BEFORE UPDATE ON student_app_access
WHEN NEW.allowed=1 AND EXISTS(SELECT 1 FROM site_member_withdrawals WHERE student_id=NEW.student_id AND sync_state IN ('pending','needs_attention'))
BEGIN SELECT RAISE(ABORT,'member_withdrawal_sync_pending'); END;
CREATE TRIGGER site_withdrawal_pending_sync_insert BEFORE INSERT ON student_app_homework_sync
WHEN NEW.requested_allowed=1 AND EXISTS(SELECT 1 FROM site_member_withdrawals WHERE student_id=NEW.student_id AND sync_state IN ('pending','needs_attention'))
BEGIN SELECT RAISE(ABORT,'member_withdrawal_sync_pending'); END;
CREATE TRIGGER site_withdrawal_pending_sync_update BEFORE UPDATE ON student_app_homework_sync
WHEN NEW.requested_allowed=1 AND EXISTS(SELECT 1 FROM site_member_withdrawals WHERE student_id=NEW.student_id AND sync_state IN ('pending','needs_attention'))
BEGIN SELECT RAISE(ABORT,'member_withdrawal_sync_pending'); END;
