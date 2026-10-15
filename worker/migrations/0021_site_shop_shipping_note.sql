-- Product guidance only; this field never changes the charged shipping fee.
ALTER TABLE site_shop_products ADD COLUMN remote_shipping_note TEXT NOT NULL DEFAULT '';
