-- Public articles and administrator metadata never contain executable HTML.
CREATE TABLE IF NOT EXISTS site_content (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK(category IN ('notice','learn','books')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  external_url TEXT, sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN -100000 AND 100000),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), published_at TEXT, archived_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_site_content_public ON site_content(status,category,sort_order,slug);
CREATE INDEX IF NOT EXISTS idx_site_content_admin ON site_content(created_at,slug);
ALTER TABLE site_shop_products ADD COLUMN archived_at TEXT;
ALTER TABLE site_shop_orders ADD COLUMN admin_version INTEGER NOT NULL DEFAULT 1 CHECK(admin_version>0);
CREATE TABLE IF NOT EXISTS site_admin_audit (
  id TEXT PRIMARY KEY, actor TEXT NOT NULL CHECK(actor='teacher'),
  action TEXT NOT NULL, target TEXT NOT NULL, outcome TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_site_admin_audit_recent ON site_admin_audit(created_at,id);
