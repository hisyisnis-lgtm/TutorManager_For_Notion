import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

const jobs = vi.hoisted(() => ({ shop: vi.fn(), legacy: vi.fn(), notion: vi.fn() }));
vi.mock('../lib/siteShop.js', () => ({ reconcileSiteShopPayments: jobs.shop }));
vi.mock('../lib/siteCommerce.js', () => ({ reconcileSitePayments: jobs.legacy }));
vi.mock('../lib/siteNotionSync.js', () => ({ runSiteNotionSync: jobs.notion }));
import { runSiteRecoveryJobs } from '../lib/siteRecoveryJobs.js';

let sqlite, env;
const old = '2000-01-01T00:00:00.000Z';
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE site_shop_orders(created_at TEXT,status TEXT,payssam_create_started_at TEXT,tid TEXT,auth_tid TEXT,payssam_bill_state TEXT DEFAULT 'unknown');
    CREATE TABLE site_shop_refunds(created_at TEXT,state TEXT);
    CREATE TABLE site_shop_webhook_inbox(created_at TEXT,state TEXT);
    CREATE TABLE site_orders(created_at TEXT,status TEXT);
    CREATE TABLE site_refund_requests(created_at TEXT,state TEXT);
    CREATE TABLE site_pg_webhook_inbox(created_at TEXT,state TEXT);
    CREATE TABLE site_notion_outbox(created_at TEXT,state TEXT);`);
  env = { GAME_DB: { prepare(sql) {
    const statement = sqlite.prepare(sql);
    return { bind: (...values) => ({ first: async () => statement.get(...values) }), first: async () => statement.get() };
  } } };
  jobs.shop.mockReset().mockResolvedValue({ processed: 0 });
  jobs.legacy.mockReset().mockResolvedValue({ processed: 0 });
  jobs.notion.mockReset().mockResolvedValue({ processed: 0, results: [] });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('unexpected_external_call'); }));
});
afterEach(() => { sqlite.close(); vi.unstubAllGlobals(); });

it('finishes independent jobs even when the first reconciliation rejects, and alerts only fixed operational facts', async () => {
  jobs.shop.mockRejectedValue(new Error('private-customer-phone / secret-api-key'));
  jobs.legacy.mockResolvedValue({ processed: 2 });
  jobs.notion.mockResolvedValue({ processed: 1, results: [{ state: 'synced', orderItemId: 'private-order-id' }] });
  const notify = vi.fn(async () => ({ ok: true }));
  const result = await runSiteRecoveryJobs(env, { notify });
  expect(jobs.legacy).toHaveBeenCalledTimes(1); expect(jobs.notion).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({ ok: false, jobs: { shopPayments: { ok: false }, legacyPayments: { ok: true, processed: 2 },
    notionSync: { ok: true, processed: 1, states: { synced: 1 } } }, notified: 1 });
  expect(notify.mock.calls[0][0]).toMatchObject({ dedupKey: 'site-recovery:job-failure', ttlSeconds: 3600 });
  expect(JSON.stringify(result) + JSON.stringify(notify.mock.calls)).not.toContain('private');
  expect(fetch).not.toHaveBeenCalled();
});

it('warns about old unresolved work and manual Notion states while excluding settled, new and unsent orders', async () => {
  const recent = new Date().toISOString();
  const insert = sqlite.prepare('INSERT INTO site_shop_orders VALUES(?,?,?,?,?,?)');
  insert.run(old, 'pending', old, null, null, 'unknown');
  insert.run(old, 'paid', old, null, null, 'unknown');
  insert.run(old, 'pending', null, null, null, 'not_created');
  insert.run(recent, 'pending', recent, null, null, 'unknown');
  insert.run(old, 'pending', old, null, null, 'ready');
  sqlite.prepare('INSERT INTO site_shop_refunds VALUES(?,?)').run(old, 'unknown');
  sqlite.prepare('INSERT INTO site_shop_refunds VALUES(?,?)').run(old, 'pending');
  sqlite.prepare('INSERT INTO site_shop_webhook_inbox VALUES(?,?)').run(old, 'pending');
  sqlite.prepare('INSERT INTO site_shop_webhook_inbox VALUES(?,?)').run(old, 'processed');
  sqlite.prepare('INSERT INTO site_orders VALUES(?,?)').run(old, 'confirming');
  sqlite.prepare('INSERT INTO site_orders VALUES(?,?)').run(old, 'paid');
  sqlite.prepare('INSERT INTO site_refund_requests VALUES(?,?)').run(old, 'approving');
  sqlite.prepare('INSERT INTO site_pg_webhook_inbox VALUES(?,?)').run(old, 'pending');
  for (const state of ['unknown', 'failed', 'needs_setup', 'pending', 'synced']) sqlite.prepare('INSERT INTO site_notion_outbox VALUES(?,?)').run(old, state);
  jobs.notion.mockResolvedValue({ processed: 3, results: [
    { state: 'unknown', reasonCode: 'private-provider-error' }, { state: 'failed' }, { state: 'needs_setup' },
  ] });
  const notify = vi.fn(async () => ({ ok: true }));
  const result = await runSiteRecoveryJobs(env, { notify });
  expect(result.ok).toBe(true); // durable manual states are not scheduler crashes
  expect(result.backlog).toEqual({ shopPayments: 1, shopRefunds: 1, shopWebhooks: 1, legacyPayments: 1,
    legacyRefunds: 1, legacyWebhooks: 1, notionDelayed: 1, notionUnknown: 1, notionFailed: 1, notionNeedsSetup: 1 });
  expect(result.jobs.notionSync.states).toMatchObject({ unknown: 1, failed: 1, needs_setup: 1 });
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify.mock.calls[0][0]).toMatchObject({ dedupKey: 'site-recovery:backlog', ttlSeconds: 3600 });
  expect(notify.mock.calls[0][0].message).toContain('상품 결제 1건');
  expect(JSON.stringify(result) + JSON.stringify(notify.mock.calls)).not.toContain('private');
});

it('passes the hourly recent-paid option only when requested and stays quiet without actionable work', async () => {
  const notify = vi.fn();
  const regular = await runSiteRecoveryJobs(env, { notify });
  expect(regular.ok).toBe(true); expect(notify).not.toHaveBeenCalled();
  expect(jobs.shop).toHaveBeenLastCalledWith(env, { includeRecentPaid: false });
  await runSiteRecoveryJobs(env, { includeRecentPaid: true });
  expect(jobs.shop).toHaveBeenLastCalledWith(env, { includeRecentPaid: true });
});

it.each(['rejected', 'throws'])('reports alert delivery failure (%s) without losing other job outcomes', async failure => {
  jobs.legacy.mockRejectedValue(new Error('private-server-failure'));
  const notify = vi.fn(async () => { if (failure === 'throws') throw new Error('private-token'); return { ok: false }; });
  const result = await runSiteRecoveryJobs(env, { notify });
  expect(result).toMatchObject({ ok: false, jobs: { notification: { ok: false }, shopPayments: { ok: true }, notionSync: { ok: true } }, notified: 0 });
  expect(JSON.stringify(result)).not.toContain('private');
});

it('does not treat a broken backlog query as a healthy monitor or stop the independent jobs', async () => {
  env.GAME_DB.prepare = () => { throw new Error('private-database-error'); };
  const notify = vi.fn(async () => ({ ok: true }));
  const result = await runSiteRecoveryJobs(env, { notify });
  expect(result.ok).toBe(false); expect(result.jobs.backlog.ok).toBe(false); expect(result.backlog).toBeNull();
  expect(jobs.notion).toHaveBeenCalledTimes(1); expect(notify.mock.calls[0][0].message).toContain('처리 대기 감시');
  expect(JSON.stringify(result) + JSON.stringify(notify.mock.calls)).not.toContain('private');
});
