-- Preview assets are independent of the paid download and representative cover.
ALTER TABLE site_shop_products ADD COLUMN preview_images_json TEXT NOT NULL DEFAULT '[]'
  CHECK(length(preview_images_json)<=4096 AND CASE WHEN json_valid(preview_images_json)
    THEN json_type(preview_images_json)='array' AND json_array_length(preview_images_json)<=9 ELSE 0 END);
