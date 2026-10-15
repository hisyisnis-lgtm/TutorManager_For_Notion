-- Public product illustrations are independent of private purchase files.
ALTER TABLE site_shop_products ADD COLUMN thumbnail_key TEXT
  CHECK(thumbnail_key IS NULL OR thumbnail_key LIKE 'shop-thumbnails/%');
ALTER TABLE site_shop_products ADD COLUMN thumbnail_content_type TEXT
  CHECK(thumbnail_content_type IS NULL OR thumbnail_content_type IN ('image/png','image/jpeg','image/webp'));
