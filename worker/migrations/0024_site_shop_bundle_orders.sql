-- One payment header owns immutable product lines. Existing orders remain readable.
CREATE TABLE site_shop_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES site_shop_orders(id),
  product_slug TEXT NOT NULL REFERENCES site_shop_products(slug),
  product_type TEXT NOT NULL CHECK(product_type IN ('digital','physical')),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 99),
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
  download_count INTEGER NOT NULL DEFAULT 0 CHECK(download_count>=0),
  UNIQUE(order_id,product_slug)
);
CREATE INDEX idx_site_shop_items_product ON site_shop_order_items(product_slug,order_id);
ALTER TABLE site_shop_coupon_redemptions RENAME TO site_shop_coupon_redemptions_previous;
DROP INDEX idx_site_shop_coupon_once;
DROP INDEX idx_site_shop_coupon_member;
CREATE TABLE site_shop_coupon_redemptions (
  order_id TEXT NOT NULL REFERENCES site_shop_orders(id),
  coupon_id TEXT NOT NULL REFERENCES site_shop_coupons(id),
  member_id TEXT NOT NULL REFERENCES site_members(id),
  per_member_once INTEGER NOT NULL CHECK(per_member_once IN (0,1)),
  state TEXT NOT NULL CHECK(state IN ('reserved','used','released')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(order_id,coupon_id)
);
INSERT INTO site_shop_coupon_redemptions SELECT * FROM site_shop_coupon_redemptions_previous;
DROP TABLE site_shop_coupon_redemptions_previous;
CREATE UNIQUE INDEX idx_site_shop_coupon_once ON site_shop_coupon_redemptions(coupon_id,member_id)
  WHERE per_member_once=1 AND state IN ('reserved','used');
CREATE INDEX idx_site_shop_coupon_member ON site_shop_coupon_redemptions(coupon_id,member_id,state);
