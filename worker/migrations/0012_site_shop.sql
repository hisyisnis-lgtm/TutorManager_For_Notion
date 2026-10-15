-- Product purchases are independent of instructor invoices and Notion class ledgers.
-- No product is seeded; publication and the global selling switch are explicit.
CREATE TABLE IF NOT EXISTS site_shop_products (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  product_type TEXT NOT NULL CHECK(product_type IN ('digital','physical')),
  price INTEGER NOT NULL CHECK(price>0 AND price<=1000000000),
  shipping_fee INTEGER CHECK(shipping_fee IS NULL OR (shipping_fee>=0 AND shipping_fee<=1000000000)),
  stock INTEGER CHECK(stock IS NULL OR stock>=0),
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  terms_version TEXT NOT NULL DEFAULT '', refund_policy TEXT NOT NULL DEFAULT '', delivery_policy TEXT NOT NULL DEFAULT '',
  file_key TEXT, file_name TEXT, file_content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK(active=0 OR (length(terms_version)>0 AND length(refund_policy)>0 AND length(delivery_policy)>0
    AND ((product_type='physical' AND stock IS NOT NULL AND shipping_fee IS NOT NULL)
      OR (product_type='digital' AND length(file_key)>0 AND length(file_name)>0))))
);
CREATE TABLE IF NOT EXISTS site_shop_orders (
  id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES site_members(id),
  product_slug TEXT NOT NULL REFERENCES site_shop_products(slug), product_type TEXT NOT NULL CHECK(product_type IN ('digital','physical')),
  idempotency_hash TEXT NOT NULL UNIQUE, payload_hash TEXT NOT NULL, snapshot TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount>0 AND amount<=1000000000), shipping_fee INTEGER NOT NULL CHECK(shipping_fee>=0 AND shipping_fee<amount),
  pg_order_id TEXT NOT NULL UNIQUE, pg_environment TEXT NOT NULL CHECK(pg_environment IN ('test','live')),
  pg_client_id TEXT NOT NULL, callback_nonce TEXT NOT NULL UNIQUE, auth_tid TEXT, tid TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirming','paid','partially_refunded','refunded','failed','expired')),
  payment_method TEXT, approved_at TEXT, refunded_amount INTEGER NOT NULL DEFAULT 0 CHECK(refunded_amount>=0 AND refunded_amount<=amount),
  last_evidence_hash TEXT, approval_key TEXT NOT NULL UNIQUE, lease_token TEXT, lease_until INTEGER,
  stock_state TEXT NOT NULL CHECK(stock_state IN ('none','reserved','committed','released')),
  shipping_status TEXT NOT NULL CHECK(shipping_status IN ('not_applicable','pending','processing','shipped','delivered','cancelled')),
  carrier TEXT, tracking_number TEXT, shipped_at TEXT,
  download_count INTEGER NOT NULL DEFAULT 0 CHECK(download_count>=0),
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_site_shop_orders_member ON site_shop_orders(member_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_shop_orders_reconcile ON site_shop_orders(status,updated_at);
CREATE TABLE IF NOT EXISTS site_shop_refunds (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES site_shop_orders(id),
  reason TEXT NOT NULL, requested_amount INTEGER NOT NULL CHECK(requested_amount>0),
  approved_amount INTEGER CHECK(approved_amount IS NULL OR approved_amount>0), approved_reason TEXT,
  expected_refunded_amount INTEGER, cancel_order_id TEXT NOT NULL UNIQUE, admin_idempotency_hash TEXT UNIQUE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approving','unknown','completed','failed','rejected')),
  lease_token TEXT, lease_until INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, approved_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_shop_refund_inflight ON site_shop_refunds(order_id) WHERE state IN ('pending','approving','unknown');
CREATE TABLE IF NOT EXISTS site_shop_webhook_inbox (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES site_shop_orders(id), tid TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processed')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
