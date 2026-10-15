-- NULL preserves unconfigured fees; a missing policy must never imply free shipping.
ALTER TABLE site_shop_products ADD COLUMN regional_shipping_json TEXT
  CHECK(regional_shipping_json IS NULL OR (json_valid(regional_shipping_json) AND length(regional_shipping_json)<=65536));
