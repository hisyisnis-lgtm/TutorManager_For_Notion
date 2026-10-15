import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { siteD1 } from './helpers/siteD1.js';
import { handleSiteAdminOverviewRoutes } from '../lib/siteAdminOverview.js';
import { handleSiteAdminAuthRoutes } from '../lib/siteAdminAuth.js';

const ORIGIN = 'https://site.example.invalid', AT = '2026-10-15T09:00:00.000Z', OLD = '2026-10-14T09:00:00.000Z';
let local, env;
const request = (path = '/overview', options = {}) => new Request(`${ORIGIN}/api/site/admin${path}`, {
  method: options.method || 'GET', headers: { Origin: ORIGIN, 'CF-Connecting-IP': '198.51.100.71',
    ...(options.cookie ? { Cookie: options.cookie } : {}), ...(options.csrfToken ? { 'X-CSRF-Token': options.csrfToken } : {}),
    ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, ...(options.body ? { body: JSON.stringify(options.body) } : {}),
});
const teacher = async () => null;
const send = () => handleSiteAdminOverviewRoutes(request(), env, {}, { authorizeTeacher: teacher });
function order(id, fields = {}) {
  const values = { status: 'paid', productType: 'physical', approvedAt: OLD, shippingStatus: 'pending', billState: 'ready', createdAt: OLD, ...fields };
  local.sqlite.prepare(`INSERT INTO site_shop_orders(id,member_id,product_slug,product_type,idempotency_hash,payload_hash,snapshot,amount,shipping_fee,
    pg_order_id,pg_environment,pg_client_id,callback_nonce,approval_key,status,approved_at,stock_state,shipping_status,expires_at,created_at,updated_at,payssam_bill_state)
    VALUES(?,'member','physical',?,?,?,'{}',10000,0,?,'test','fixture',?,?,?,?,'committed',?,?,?,?,?)`)
    .run(id, values.productType, `key-${id}`, `hash-${id}`, `pg-${id}`, `nonce-${id}`, `approval-${id}`, values.status,
      values.approvedAt, values.shippingStatus, AT, values.createdAt, AT, values.billState);
}
function refund(id, orderId, state) {
  local.sqlite.prepare('INSERT INTO site_shop_refunds(id,order_id,reason,requested_amount,cancel_order_id,state,created_at,updated_at) VALUES(?,?,?,10000,?,?,?,?)')
    .run(id, orderId, 'private refund text', `cancel-${id}`, state, OLD, AT);
}
beforeEach(() => {
  local = siteD1();
  for (const name of ['0012_site_shop.sql','0013_site_shop_payssam.sql','0014_site_admin_sessions.sql','0015_site_content.sql','0020_site_shop_coupons.sql','0024_site_shop_bundle_orders.sql']) {
    local.sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  local.sqlite.prepare("INSERT INTO site_members(id,member_code,customer_key,provider,created_at,updated_at) VALUES('member','MEMBER','CUSTOMER','google',?,?)").run(OLD, AT);
  local.sqlite.prepare("INSERT INTO site_shop_products(slug,name,product_type,price,created_at,updated_at) VALUES('physical','private product name','physical',10000,?,?)").run(OLD, AT);
  env = { GAME_DB: local.db, SITE_ORIGIN: ORIGIN, SITE_ADMIN_ENABLED: 'true', AUTH_PASSWORD: 'fixture-admin-password',
    JWT_SECRET: 'fixture-overview-security-secret', SITE_SESSION_SECRET: 'fixture-overview-session-secret-32-characters' };
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External network denied'); }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { local.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('website administrator work overview', () => {
  it('requires the actual existing admin cookie, and accepts a rotated administrator session', async () => {
    expect((await handleSiteAdminOverviewRoutes(request(), env, {})).status).toBe(401);
    const anonymous = await handleSiteAdminAuthRoutes(request('/session'), env), session = await anonymous.json();
    const loggedIn = await handleSiteAdminAuthRoutes(request('/auth/login', { method: 'POST', body: { password: env.AUTH_PASSWORD }, csrfToken: session.csrfToken,
      cookie: anonymous.headers.get('Set-Cookie').split(';')[0] }), env);
    expect(loggedIn.status).toBe(200);
    const response = await handleSiteAdminOverviewRoutes(request('/overview', { cookie: loggedIn.headers.get('Set-Cookie').split(';')[0] }), env, {});
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect((await response.json()).tasks.reviewsPending).toEqual({ count: 0, oldestAt: null });
  });
  it('counts only actionable payment, shipping, pending refunds and pending review revisions, including mixed bundles', async () => {
    order('ordinary-unpaid', { status: 'pending', approvedAt: null, billState: 'ready' });
    order('uncertain', { status: 'pending', approvedAt: null, billState: 'unknown' });
    order('preparing'); order('shipped', { shippingStatus: 'shipped' });
    order('refunded', { status: 'refunded', shippingStatus: 'cancelled' });
    order('refund-review', { productType: 'digital', shippingStatus: 'not_applicable' }); refund('pending-refund', 'refund-review', 'pending');
    order('refund-completed', { productType: 'digital', shippingStatus: 'not_applicable' }); refund('completed-refund', 'refund-completed', 'completed');
    order('refund-unknown', { productType: 'digital', shippingStatus: 'not_applicable' }); refund('unknown-refund', 'refund-unknown', 'unknown');
    order('mixed-bundle', { productType: 'digital', shippingStatus: 'processing' });
    local.sqlite.prepare("INSERT INTO site_shop_order_items(id,order_id,product_slug,product_type,quantity,snapshot) VALUES('mixed-line','mixed-bundle','physical','physical',1,'{}')").run();
    local.sqlite.prepare("INSERT INTO reviews(id,status,pending_version,published_content,idempotency_key_hash,request_hash,request_expires_at,created_at,updated_at) VALUES('review-revision','published',2,'private old text','review-key','hash',1,?,?)").run(OLD, AT);
    const result = await (await send()).json();
    expect(result.tasks).toEqual({ paymentAttention: { count: 2, oldestAt: OLD }, refundPending: { count: 1, oldestAt: OLD },
      shippingPending: { count: 2, oldestAt: OLD }, reviewsPending: { count: 1, oldestAt: AT } });
    expect(JSON.stringify(result)).not.toMatch(/private|member|cancel-|hash|physical|review-revision/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('exposes delayed webhook and failed Notion sync counts without triggering external repair', async () => {
    order('webhook');
    const old = new Date(Date.now() - 3600_000).toISOString(), recent = new Date().toISOString();
    for (const [id, createdAt, state] of [['old', old, 'pending'], ['new', recent, 'pending'], ['processed', old, 'processed']]) {
      local.sqlite.prepare('INSERT INTO site_shop_webhook_inbox(id,order_id,tid,state,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, 'webhook', id, state, createdAt, createdAt);
    }
    // Retain full FK chains for the existing lesson-order outbox.
    local.sqlite.exec(`INSERT INTO site_targets(id,name,experience_type,class_type_id,student_required,time_ledger_mode,created_at,updated_at) VALUES('target','Private class','class','class',0,'none','${OLD}','${AT}');
      INSERT INTO site_payment_requests(id,member_id,target_id,billing_key,billing_period,snapshot,amount,terms_version,expires_at,created_at,updated_at) VALUES('request','member','target','billing','month','{}',10000,'v1','${AT}','${OLD}','${AT}');
      INSERT INTO site_orders(id,member_id,request_id,idempotency_hash,payload_hash,snapshot,amount,created_at,updated_at) VALUES('legacy','member','request','legacy-key','hash','{}',10000,'${OLD}','${AT}');
      INSERT INTO site_order_items(id,order_id,target_id,snapshot) VALUES('item','legacy','target','{}');
      INSERT INTO site_notion_outbox(order_item_id,desired_version,state,created_at,updated_at) VALUES('item',1,'needs_setup','${OLD}','${AT}');`);
    const data = await (await send()).json();
    expect(data.operations).toEqual({ webhookBacklog: { count: 1, oldestAt: old }, notionSync: { count: 1, oldestAt: OLD } });
    expect(fetch).not.toHaveBeenCalled();
    expect(local.sqlite.prepare('SELECT state FROM site_notion_outbox').get().state).toBe('needs_setup');
  });
  it('fails closed when one queue cannot be read, rather than showing an invented zero', async () => {
    local.sqlite.exec('DROP TABLE site_shop_webhook_inbox');
    const response = await send(); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: '업무 현황을 불러오지 못했어요. 다시 불러와 주세요.', code: 'admin_overview_unavailable' });
  });
  it('ignores other routes and denies mutation methods without changing any records', async () => {
    expect(await handleSiteAdminOverviewRoutes(request('/something-else'), env, {})).toBeNull();
    const response = await handleSiteAdminOverviewRoutes(request('/overview', { method: 'POST' }), env, {}, { authorizeTeacher: teacher });
    expect(response.status).toBe(405); expect(fetch).not.toHaveBeenCalled();
  });
});
