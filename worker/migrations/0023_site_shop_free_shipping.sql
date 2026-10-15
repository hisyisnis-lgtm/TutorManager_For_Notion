-- NULL means no free-shipping condition. Zero explicitly waives the base fee.
ALTER TABLE site_shop_products ADD COLUMN free_shipping_threshold INTEGER
  CHECK(free_shipping_threshold IS NULL OR (typeof(free_shipping_threshold)='integer' AND free_shipping_threshold>=0 AND free_shipping_threshold<=1000000000));
