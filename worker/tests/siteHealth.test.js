import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { siteD1 } from './helpers/siteD1.js';
import { handleSiteHealthRoutes } from '../lib/siteHealth.js';

let local, env;
beforeEach(() => {
  local = siteD1();
  for (const name of ['0011_student_app_access.sql', '0012_site_shop.sql', '0013_site_shop_payssam.sql',
    '0014_site_admin_sessions.sql', '0015_site_content.sql', '0016_site_shop_smartstore.sql', '0017_site_shop_thumbnails.sql',
    '0018_site_existing_content.sql', '0019_site_shop_preview_images.sql', '0020_site_shop_coupons.sql',
    '0021_site_shop_shipping_note.sql', '0022_site_shop_regional_shipping.sql', '0023_site_shop_free_shipping.sql',
    '0024_site_shop_bundle_orders.sql', '0028_site_phone_auth.sql', '0029_site_shop_recovery.sql']) {
    local.sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  env = { GAME_DB: local.db };
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('unexpected_external_call'); }));
});
afterEach(() => { local.close(); vi.unstubAllGlobals(); });
const request = (method = 'GET', path = '/api/site/health') => new Request(`https://fixture.invalid${path}`, { method });

it('checks current schema through read-only zero-row probes without a session, credentials or external requests', async () => {
  const sql = [], prepare = local.db.prepare;
  env.GAME_DB = { prepare(statement) { sql.push(statement); return prepare(statement); } };
  const before = local.sqlite.prepare('SELECT COUNT(*) AS count FROM site_sessions').get().count;
  const result = await handleSiteHealthRoutes(request(), env);
  expect(result.status).toBe(200); expect(await result.json()).toEqual({ ok: true, schema: 'ready' });
  expect(result.headers.get('Set-Cookie')).toBeNull(); expect(result.headers.get('Cache-Control')).toBe('no-store');
  expect(local.sqlite.prepare('SELECT COUNT(*) AS count FROM site_sessions').get().count).toBe(before);
  expect(sql).toHaveLength(6); expect(sql.every(query => /^SELECT\s/i.test(query) && /LIMIT 0$/.test(query))).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});
it('fails closed for missing recovery schema without exposing SQL, table names or private errors', async () => {
  local.sqlite.exec('DROP TABLE site_shop_refund_events');
  const missing = await handleSiteHealthRoutes(request(), env);
  expect(missing.status).toBe(503); expect(await missing.json()).toEqual({ ok: false, schema: 'unavailable' });
  env.GAME_DB = { prepare() { throw new Error('private-secret / database file / raw query'); } };
  const failed = await handleSiteHealthRoutes(request(), env);
  expect(failed.status).toBe(503); expect(await failed.text()).not.toContain('private');
  expect((await handleSiteHealthRoutes(request(), {})).status).toBe(503);
});
it('requires the staff OTP schema when the private feature is configured', async () => {
  env.SITE_ADMIN_PHONE_ALLOWLIST = 'synthetic-private-config';
  expect((await handleSiteHealthRoutes(request(), env)).status).toBe(503);
  local.sqlite.exec(readFileSync(new URL('../migrations/0031_site_admin_phone_auth.sql', import.meta.url), 'utf8'));
  const ready = await handleSiteHealthRoutes(request(), env); expect(ready.status).toBe(200);
  expect(await ready.text()).not.toContain('synthetic-private-config'); expect(fetch).not.toHaveBeenCalled();
});
it('does not query the database for another route or a mutation method', async () => {
  const prepare = vi.fn(() => { throw new Error('must_not_query'); });
  expect(await handleSiteHealthRoutes(request('GET', '/api/site/not-health'), { GAME_DB: { prepare } })).toBeNull();
  const denied = await handleSiteHealthRoutes(request('POST'), { GAME_DB: { prepare } });
  expect(denied.status).toBe(405); expect(denied.headers.get('Allow')).toBe('GET'); expect(prepare).not.toHaveBeenCalled();
});
