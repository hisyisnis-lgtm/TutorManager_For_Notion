-- Keep existing NICEPAY orders, invoices and class ledgers intact.
-- New product orders use one stable Payssam bill ID; an uncertain creation is not retried.
ALTER TABLE site_shop_orders ADD COLUMN payment_provider TEXT NOT NULL DEFAULT 'nicepay'
  CHECK(payment_provider IN ('nicepay','payssam'));
ALTER TABLE site_shop_orders ADD COLUMN payssam_bill_id TEXT;
ALTER TABLE site_shop_orders ADD COLUMN payssam_account_hash TEXT;
ALTER TABLE site_shop_orders ADD COLUMN payssam_bill_state TEXT NOT NULL DEFAULT 'not_created'
  CHECK(payssam_bill_state IN ('not_created','creating','ready','unknown','failed','destroying','destroyed'));
ALTER TABLE site_shop_orders ADD COLUMN payssam_payment_url TEXT;
ALTER TABLE site_shop_orders ADD COLUMN payssam_create_started_at TEXT;
ALTER TABLE site_shop_orders ADD COLUMN payssam_destroy_started_at TEXT;
ALTER TABLE site_shop_orders ADD COLUMN payssam_approval_number TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_shop_payssam_bill ON site_shop_orders(payssam_bill_id)
  WHERE payssam_bill_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_site_shop_payssam_pending ON site_shop_orders(payment_provider,payssam_bill_state,updated_at);
ALTER TABLE site_shop_webhook_inbox ADD COLUMN payment_provider TEXT NOT NULL DEFAULT 'nicepay'
  CHECK(payment_provider IN ('nicepay','payssam'));
