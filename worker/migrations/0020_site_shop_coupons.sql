-- Coupons apply only to merchandise; shipping and existing PG evidence stay separate.
CREATE TABLE IF NOT EXISTS site_shop_coupons (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, create_hash TEXT NOT NULL,
  discount_type TEXT NOT NULL CHECK(discount_type IN ('fixed','percent')),
  discount_value INTEGER NOT NULL CHECK(discount_value>0 AND discount_value<=1000000000
    AND (discount_type!='percent' OR discount_value<=99)),
  min_item_amount INTEGER NOT NULL DEFAULT 0 CHECK(min_item_amount>=0 AND min_item_amount<=1000000000),
  max_discount_amount INTEGER CHECK(max_discount_amount IS NULL OR (max_discount_amount>0 AND max_discount_amount<=1000000000)),
  product_slug TEXT REFERENCES site_shop_products(slug), starts_at TEXT, ends_at TEXT,
  per_member_once INTEGER NOT NULL DEFAULT 1 CHECK(per_member_once IN (0,1)),
  status TEXT NOT NULL DEFAULT 'inactive' CHECK(status IN ('active','inactive','archived')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK(starts_at IS NULL OR ends_at IS NULL OR starts_at<ends_at)
);
CREATE INDEX IF NOT EXISTS idx_site_shop_coupons_public ON site_shop_coupons(status,product_slug,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS site_shop_coupon_redemptions (
  order_id TEXT PRIMARY KEY REFERENCES site_shop_orders(id),
  coupon_id TEXT NOT NULL REFERENCES site_shop_coupons(id), member_id TEXT NOT NULL REFERENCES site_members(id),
  per_member_once INTEGER NOT NULL CHECK(per_member_once IN (0,1)),
  state TEXT NOT NULL CHECK(state IN ('reserved','used','released')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_shop_coupon_once ON site_shop_coupon_redemptions(coupon_id,member_id)
  WHERE per_member_once=1 AND state IN ('reserved','used');
CREATE INDEX IF NOT EXISTS idx_site_shop_coupon_member ON site_shop_coupon_redemptions(coupon_id,member_id,state);
