import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { siteD1 } from './helpers/siteD1.js';
import { handleSiteAdminContentRoutes } from '../lib/siteAdminContent.js';

let local, env;
const origin = 'http://localhost:4325';
const authorizeTeacher = async request => request.headers.get('Authorization') === 'Bearer synthetic-teacher'
  ? null : Response.json({ error: 'teacher_required' }, { status: 401 });
function send(items, placement = 'learn', authenticated = true) {
  return handleSiteAdminContentRoutes(new Request(`${origin}/api/site/admin/content/reorder`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json',
      ...(authenticated ? { Authorization: 'Bearer synthetic-teacher' } : {}) }, body: JSON.stringify({ placement, items }),
  }), env, {}, { authorizeTeacher });
}
const snapshot = () => local.sqlite.prepare('SELECT * FROM site_content ORDER BY slug').all();
const items = (...slugs) => slugs.map(slug => ({ slug, version: 1 }));
beforeEach(() => {
  local = siteD1();
  for (const migration of ['0012_site_shop.sql', '0013_site_shop_payssam.sql', '0015_site_content.sql', '0018_site_existing_content.sql']) {
    local.sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
  }
  local.sqlite.exec('DELETE FROM site_content');
  const insert = local.sqlite.prepare(`INSERT INTO site_content(slug,title,summary,body,category,status,sort_order,home_sort_order,show_on_home,created_at,updated_at)
    VALUES(?,?,'summary','preserved body',?,?,5,9,?,'2026-10-01','2026-10-01')`);
  for (const [slug, category, status, home] of [['alpha','learn','published',1], ['beta','learn','draft',1], ['gamma','learn','published',0], ['archived','learn','archived',1], ['notice','notice','published',1]]) {
    insert.run(slug, slug, category, status, home);
  }
  env = { GAME_DB: local.db, JWT_SECRET: 'synthetic-content-secret', SITE_SESSION_SECRET: 'synthetic-content-session-secret-long' };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { local.close(); vi.restoreAllMocks(); });

describe('atomic administrator content ordering', () => {
  it('normalizes the whole learn order while preserving home positions and all other content', async () => {
    const before = snapshot(), response = await send(items('gamma', 'beta', 'alpha'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.placement).toBe('learn');
    expect(body.contents.map(row => [row.slug, row.sortOrder, row.homeSortOrder, row.version]))
      .toEqual([['gamma',0,9,2], ['beta',1,9,2], ['alpha',2,9,2]]);
    for (const old of before) {
      const row = snapshot().find(value => value.slug === old.slug);
      if (['notice','archived'].includes(old.slug)) expect(row).toEqual(old);
      else expect({ ...row, sort_order: old.sort_order, version: old.version, updated_at: old.updated_at }).toEqual(old);
    }
    expect(local.sqlite.prepare("SELECT COUNT(*) AS n FROM site_admin_audit WHERE action='content.reorder' AND outcome='success'").get().n).toBe(1);
  });
  it('orders only home-selected learn content, including hidden drafts, without changing learn order', async () => {
    const response = await send(items('beta','alpha'), 'home'); expect(response.status).toBe(200);
    expect((await response.json()).contents.map(row => [row.slug,row.homeSortOrder,row.sortOrder,row.version]))
      .toEqual([['beta',0,5,2],['alpha',1,5,2]]);
    expect(snapshot().find(row => row.slug === 'gamma').version).toBe(1);
  });
  it('rejects a stale version on any row without updating earlier rows or recording success', async () => {
    local.sqlite.exec("UPDATE site_content SET version=2,title='changed elsewhere' WHERE slug='gamma'");
    const before = snapshot();
    expect((await send(items('alpha','beta','gamma'))).status).toBe(409);
    expect(snapshot()).toEqual(before);
    expect(local.sqlite.prepare('SELECT outcome FROM site_admin_audit').all()).toEqual([{ outcome:'conflict' }]);
  });
  it.each([
    ['missing', items('alpha','beta'), 'learn'],
    ['extra', items('alpha','beta','gamma','notice'), 'learn'],
    ['archived', items('alpha','beta','archived'), 'learn'],
    ['wrong home membership', items('alpha','gamma'), 'home'],
  ])('rejects %s membership atomically', async (_name, order, placement) => {
    const before = snapshot(); expect((await send(order, placement)).status).toBe(409); expect(snapshot()).toEqual(before);
  });
  it('rejects malformed/duplicate/unbounded order and unauthorized writes', async () => {
    const before = snapshot();
    for (const order of [[], items('alpha','alpha','gamma'), [{slug:'alpha',version:0}], Array(1001).fill({slug:'alpha',version:1})]) {
      expect((await send(order)).status).toBe(400);
    }
    expect((await send(items('alpha','beta','gamma'), 'learn', false)).status).toBe(401);
    expect(snapshot()).toEqual(before);
  });
  it('accepts only one writer using the same full snapshot and rolls back if the audit transaction fails', async () => {
    const first = await send(items('gamma','alpha','beta')); expect(first.status).toBe(200);
    expect((await send(items('beta','alpha','gamma'))).status).toBe(409);
    const before = snapshot();
    local.sqlite.exec("CREATE TRIGGER deny_reorder_audit BEFORE INSERT ON site_admin_audit WHEN NEW.outcome='success' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;");
    expect((await send(items('beta','gamma','alpha').map(row => ({...row,version:2})))).status).toBe(503);
    expect(snapshot()).toEqual(before);
  });
});
