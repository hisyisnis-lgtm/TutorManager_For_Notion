-- Keep direct-sale eligibility and old purchase snapshots unchanged.
-- NULL inherits the existing active flag; an introduction need not satisfy the
-- original active CHECK for direct stock, fulfillment files and payment policies.
ALTER TABLE site_shop_products ADD COLUMN smartstore_url TEXT;
ALTER TABLE site_shop_products ADD COLUMN smartstore_active INTEGER
  CHECK(smartstore_active IS NULL OR smartstore_active IN (0,1));
