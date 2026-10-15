import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { siteD1 } from './helpers/siteD1.js';
import { handleSiteAuthRoutes } from '../lib/siteAuth.js';
import { handleSiteShopRoutes, reconcileSiteShopPayments } from '../lib/siteShop.js';

const ORIGIN = 'http://localhost:4325', API = 'http://localhost:8799/partner', CALLBACK = 'http://localhost:8798';
let local, env, mail, bills, calls, loseCreate, loseCancel, failDestroy, destroyAckOnly, createUrl, readOverride, cancelGate, cancelStarted, readFailures, files, fileReads;
const teacherAuthorization = async request => request.headers.get('Authorization') === 'Bearer synthetic-teacher'
  ? null : Response.json({ error: 'teacher_required' }, { status: 401 });
const cookie = response => response.headers.get('Set-Cookie')?.split(';')[0];
async function send(path, { method = 'GET', body, session, admin = false, headers = {} } = {}) {
  const request = new Request(`${ORIGIN}/api/site${path}`, { method,
    headers: { Origin: ORIGIN, 'CF-Connecting-IP': '198.51.100.39', ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(session?.cookie ? { Cookie: session.cookie } : {}), ...(session?.csrfToken ? { 'X-CSRF-Token': session.csrfToken } : {}),
      ...(admin ? { Authorization: 'Bearer synthetic-teacher' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return await handleSiteShopRoutes(request, env, {}, { authorizeTeacher: teacherAuthorization }) || await handleSiteAuthRoutes(request, env);
}
async function member(email = 'payssam-member@fixture.invalid') {
  let response = await send('/session'), session = { cookie: cookie(response), ...(await response.json()) };
  response = await send('/auth/email/request', { method: 'POST', session, body: { email } }); expect(response.status).toBe(200);
  const requested = await response.json(), code = mail.at(-1).text.match(/\b\d{6}\b/)[0];
  response = await send('/auth/email/verify', { method: 'POST', session, body: { challengeId: requested.challengeId, code } });
  const verified = await response.json();
  response = await send('/auth/signup', { method: 'POST', session, body: { registrationToken: verified.registrationToken,
    password: 'Synthetic-payssam-42', passwordConfirm: 'Synthetic-payssam-42', name: '합성 구매자', nickname: '구매자', termsAccepted: true, privacyAccepted: true } });
  expect(response.status).toBe(201); return { cookie: cookie(response), ...(await response.json()) };
}
async function product(overrides = {}) {
  const input = { regionalShipping: { jejuExtraFee: 0, remoteExtraFee: 0, remotePostalRanges: [] }, slug: 'synthetic-pdf', name: '합성 PDF 상품', description: '격리 검수 전용', productType: 'digital', price: 30000,
    termsVersion: 'synthetic-v1', refundPolicy: '담당자가 구매 및 제공 내역을 확인하여 환불을 검토합니다.',
    deliveryPolicy: '결제 완료 확인 후 본인 구매내역에서 자료를 내려받습니다.',
    fileKey: 'shop/synthetic.pdf', fileName: '합성 자료.pdf', fileContentType: 'application/pdf', active: true, ...overrides };
  const response = await send('/admin/products', { method: 'POST', admin: true, body: input }); expect(response.status).toBe(201);
  return { input, ...(await response.json()).product };
}
function inputFor(selected, overrides = {}) {
  return { productId: selected.id, idempotencyKey: crypto.randomUUID(), customerName: '합성 구매자', customerPhone: '010-1234-5678',
    termsVersion: selected.termsVersion, termsAccepted: true, ...(selected.productType === 'physical' ? {
      shipping: { recipientName: '합성 수령인', phone: '010-1234-5678', postalCode: '12345', address: '합성시 검수로 1', addressDetail: '' },
    } : {}), ...overrides };
}
async function started(session, selected, overrides = {}) {
  const input = inputFor(selected, overrides), response = await send('/shop-orders', { method: 'POST', session, body: input });
  expect(response.status).toBe(201); return { input, ...(await response.json()) };
}
async function payment(session, order) { return send(`/shop-orders/${order.order.id}/payment`, { method: 'POST', session, body: {} }); }
const dbOrder = order => local.sqlite.prepare('SELECT * FROM site_shop_orders WHERE id=?').get(order.order.id);
const count = path => calls.filter(call => call.path === path).length;
async function uploadFile(productSlug, version, file, admin = true) {
  const body = new FormData(); body.set('version', String(version)); body.set('file', file);
  return handleSiteShopRoutes(new Request(`${ORIGIN}/api/site/admin/products/${productSlug}/file`, { method: 'POST', body,
    headers: { Origin: ORIGIN, 'CF-Connecting-IP': '198.51.100.39', ...(admin ? { Authorization: 'Bearer synthetic-teacher' } : {}) } }),
  env, {}, { authorizeTeacher: teacherAuthorization });
}
function reply(bill, overrides = {}) {
  return { code: '0000', data: { apiKey: env.SITE_PAYSSAM_API_KEY, member: env.SITE_PAYSSAM_MEMBER_CODE, merchant: env.SITE_PAYSSAM_MERCHANT_CODE,
    billId: bill.billId, apprState: bill.state, ...(bill.state === 'F' || bill.state === 'C' ? {
      apprPrice: bill.price, apprPayType: '0', apprOriginDt: '20261011090000', apprOriginNum: `orig_${bill.billId}`,
      apprDt: bill.state === 'C' ? '20261011100000' : '20261011090000', apprNum: bill.state === 'C' ? `cancel_${bill.billId}` : `orig_${bill.billId}`,
    } : {}), ...overrides } };
}
async function paid(session, order) {
  await payment(session, order); const row = dbOrder(order); bills.get(row.payssam_bill_id).state = 'F';
  const response = await send(`/shop-orders/${row.id}`, { session }); expect(response.status).toBe(200); return response.json();
}
async function callback(order, overrides = {}, tokenOverride) {
  const row = dbOrder(order), query = new URLSearchParams({ order: row.id, token: tokenOverride || row.callback_nonce });
  return handleSiteShopRoutes(new Request(`${CALLBACK}/api/site/webhooks/payssam?${query}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://sandbox.paymint.co.kr', 'CF-Connecting-IP': '198.51.100.39' },
    body: JSON.stringify({ apiKey: env.SITE_PAYSSAM_API_KEY, billId: row.payssam_bill_id, apprState: 'F', apprPrice: String(row.amount), ...overrides }) }), env, {});
}
beforeEach(() => {
  local = siteD1();
  for (const migration of ['0012_site_shop.sql', '0013_site_shop_payssam.sql', '0015_site_content.sql', '0016_site_shop_smartstore.sql', '0017_site_shop_thumbnails.sql', '0020_site_shop_coupons.sql','0021_site_shop_shipping_note.sql','0022_site_shop_regional_shipping.sql','0023_site_shop_free_shipping.sql','0024_site_shop_bundle_orders.sql','0029_site_shop_recovery.sql']) local.sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
  mail = []; bills = new Map(); calls = []; loseCreate = false; loseCancel = false; failDestroy = false; destroyAckOnly = false;
  createUrl = null; readOverride = null; cancelGate = null; cancelStarted = null;
  readFailures = new Set();
  files = new Map([['shop/synthetic.pdf', '%PDF-private-synthetic']]); fileReads = [];
  env = { GAME_DB: local.db, JWT_SECRET: 'synthetic-shop-security-secret', SITE_SESSION_SECRET: 'synthetic-shop-session-secret-32-characters',
    SITE_PASSWORD_SECRET: 'synthetic-shop-password-secret-32-characters', SITE_ENVIRONMENT: 'development', SITE_ORIGIN: ORIGIN,
    SITE_EMAIL_FROM: 'sender@fixture.invalid', SITE_EMAIL: { send: async message => { mail.push(message); return { messageId: 'fixture' }; } },
    SITE_SHOP_ENABLED: 'true', SITE_SHOP_SALES_MODE: 'direct', SITE_PAYSSAM_MODE: 'test', SITE_PAYSSAM_API_KEY: 'synthetic_key_12345678',
    SITE_PAYSSAM_MEMBER_CODE: 'fixture-member', SITE_PAYSSAM_MERCHANT_CODE: 'fixture-merchant', SITE_PAYSSAM_CONTRACT_VERIFIED: 'true',
    SITE_PAYSSAM_API_BASE_URL: API, SITE_PAYSSAM_CHECKOUT_ORIGIN: ORIGIN, SITE_PAYSSAM_CALLBACK_ORIGIN: CALLBACK,
    SITE_SHOP_FILES: { head: async key => files.has(key) ? { key } : null,
      get: async key => { fileReads.push(key); return files.has(key) ? { body: new Response(files.get(key)).body } : null; },
      put: async (key, value) => { files.set(key, new TextDecoder().decode(value)); return { key }; }, delete: async key => files.delete(key) } };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (raw, options = {}) => {
    const url = new URL(raw); if (url.origin !== new URL(API).origin || options.method !== 'POST') throw new Error('external_http_blocked');
    const data = JSON.parse(options.body), bill = data.bill, path = url.pathname;
    if (data.apiKey !== env.SITE_PAYSSAM_API_KEY || data.member !== env.SITE_PAYSSAM_MEMBER_CODE || data.merchant !== env.SITE_PAYSSAM_MERCHANT_CODE) throw new Error('unexpected_provider_owner');
    calls.push({ path, bill: { ...bill } });
    if (path === '/partner/bill') {
      if (bills.has(bill.billId)) return Response.json({ code: 'BILL_001' });
      bills.set(bill.billId, { ...bill, state: 'W' });
      if (loseCreate) throw new Error('synthetic_create_response_lost');
      return Response.json({ code: '0000', data: { apiKey: data.apiKey, member: data.member, merchant: data.merchant,
        billId: bill.billId, hash: bill.hash, shortUrl: createUrl || `${ORIGIN}/synthetic-payment/${bill.billId}` } });
    }
    const saved = bills.get(bill.billId); if (!saved) return Response.json({ code: 'BILL_004' });
    if (path === '/partner/bill/read') {
      if (readFailures.has(bill.billId)) throw new Error('synthetic_persistent_read_failure');
      return Response.json(readOverride || reply(saved));
    }
    if (path === '/partner/bill/destroy') {
      if (failDestroy) throw new Error('synthetic_destroy_unavailable');
      if (!destroyAckOnly) saved.state = 'D';
      return Response.json({ code: '0000', data: { apiKey: data.apiKey, billId: bill.billId } });
    }
    if (path === '/partner/bill/cancel') {
      cancelStarted?.(); if (cancelGate) await cancelGate;
      saved.state = 'C'; if (loseCancel) throw new Error('synthetic_cancel_response_lost');
      return Response.json({ code: '0000', data: { apiKey: data.apiKey, member: data.member, merchant: data.merchant, billId: bill.billId, hash: bill.hash } });
    }
    throw new Error('unexpected_synthetic_provider_path');
  }));
});
afterEach(() => { local.close(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// Clone only synthetic in-memory rows so backlog regressions do not require
// hundreds of HTTP requests, passwords, or any call to an external provider.
function clonePaidOrder(template, overrides = {}) {
  const id = crypto.randomUUID(), original = dbOrder(template), compact = id.replace(/-/g, '');
  const row = { ...original, id, idempotency_hash: crypto.randomUUID(), payload_hash: crypto.randomUUID(),
    pg_order_id: `shop_${compact}`, callback_nonce: `callback_${compact}`, approval_key: crypto.randomUUID(),
    payssam_bill_id: compact.slice(0, 20), payssam_approval_number: null, ...overrides };
  const names = Object.keys(row);
  local.sqlite.prepare(`INSERT INTO site_shop_orders(${names.join(',')}) VALUES(${names.map(() => '?').join(',')})`).run(...names.map(name => row[name]));
  bills.set(row.payssam_bill_id, { billId: row.payssam_bill_id, price: String(row.amount), state: 'F' });
  return row;
}

describe('bounded payment recovery and refund request closure', () => {
  it('reconciles a new unresolved payment before 200 historical paid orders and keeps the hourly paid sweep finite', async () => {
    const session = await member(), selected = await product(), template = await started(session, selected); await paid(session, template);
    const old = '2020-01-01T00:00:00.000Z';
    local.sqlite.prepare('UPDATE site_shop_orders SET approved_at=?,updated_at=? WHERE id=?').run(old, old, template.order.id);
    for (let index = 0; index < 200; index++) clonePaidOrder(template);
    const waiting = await started(session, selected); await payment(session, waiting);
    bills.get(dbOrder(waiting).payssam_bill_id).state = 'F';
    const before = count('/partner/bill/read');
    await reconcileSiteShopPayments(env, { includeRecentPaid: true });
    expect(dbOrder(waiting).status).toBe('paid');
    expect(count('/partner/bill/read') - before).toBe(1);
    const current = dbOrder(waiting);
    clonePaidOrder(waiting, { updated_at: '2021-01-01T00:00:00.000Z' });
    clonePaidOrder(waiting, { updated_at: '2022-01-01T00:00:00.000Z' });
    const recentBefore = count('/partner/bill/read');
    await reconcileSiteShopPayments(env, { includeRecentPaid: true });
    expect(count('/partner/bill/read') - recentBefore).toBe(2);
    expect(dbOrder(waiting).approved_at).toBe(current.approved_at);
    expect(count('/partner/bill')).toBe(2); expect(count('/partner/bill/cancel')).toBe(0);
  });

  it.each(['network', 'account'])('defers ten persistent %s webhook failures so the next valid event is processed', async failure => {
    const session = await member(), selected = await product(), template = await started(session, selected); await paid(session, template);
    const rows = Array.from({ length: 11 }, (_, index) => clonePaidOrder(template, { updated_at: `2020-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z` }));
    for (const [index, row] of rows.entries()) {
      if (index < 10) {
        if (failure === 'network') readFailures.add(row.payssam_bill_id);
        else local.sqlite.prepare("UPDATE site_shop_orders SET payssam_account_hash='previous-account' WHERE id=?").run(row.id);
      } else bills.get(row.payssam_bill_id).state = 'C';
      local.sqlite.prepare(`INSERT INTO site_shop_webhook_inbox(id,order_id,tid,payment_provider,created_at,updated_at)
        VALUES(?,?,?,'payssam',?,?)`).run(crypto.randomUUID(), row.id, row.payssam_bill_id, row.updated_at, row.updated_at);
    }
    await reconcileSiteShopPayments(env);
    const failures = local.sqlite.prepare('SELECT retry_attempts,retry_after,last_error_code FROM site_shop_webhook_inbox WHERE retry_attempts>0').all();
    expect(failures).toHaveLength(10);
    expect(failures.every(row => row.retry_attempts === 1 && row.retry_after > Date.now() / 1000 && typeof row.last_error_code === 'string')).toBe(true);
    expect(local.sqlite.prepare('SELECT status FROM site_shop_orders WHERE id=?').get(rows[10].id).status).toBe('paid');
    await reconcileSiteShopPayments(env);
    expect(local.sqlite.prepare('SELECT status,refunded_amount FROM site_shop_orders WHERE id=?').get(rows[10].id)).toMatchObject({ status: 'refunded', refunded_amount: 30000 });
    expect(local.sqlite.prepare("SELECT count(*) AS count FROM site_shop_webhook_inbox WHERE state='processed'").get().count).toBe(1);
    expect(local.sqlite.prepare('SELECT max(retry_attempts) AS count FROM site_shop_webhook_inbox').get().count).toBe(1);
    expect(count('/partner/bill/cancel')).toBe(0);
  });

  it('rejects and withdraws pending requests with version checks, ownership and durable audit, without cancelling money', async () => {
    const session = await member(), other = await member('other-owner@fixture.invalid'), order = await started(session, await product()); await paid(session, order);
    const requestRefund = async () => (await (await send(`/shop-orders/${order.order.id}/refund-request`, { method: 'POST', session, body: { reason: '구매자 환불 신청' } })).json()).refundRequest;
    const first = await requestRefund(), rejection = { refundId: first.id, version: first.version, reason: '구매자와 확인하여 요청을 종료했습니다.' };
    expect((await send(`/admin/shop-orders/${order.order.id}/refund-reject`, { method: 'POST', body: rejection, session })).status).toBe(401);
    expect((await send(`/admin/shop-orders/${order.order.id}/refund-reject`, { method: 'POST', body: { ...rejection, version: 999 }, admin: true })).status).toBe(409);
    expect((await send(`/admin/shop-orders/${order.order.id}/refund-reject`, { method: 'POST', body: { refundId: first.id, version: first.version }, admin: true })).status).toBe(400);
    const rejected = await send(`/admin/shop-orders/${order.order.id}/refund-reject`, { method: 'POST', body: rejection, admin: true });
    expect(rejected.status).toBe(200);
    expect((await rejected.json()).order.refunds[0]).toMatchObject({ status: 'rejected', version: 2, closedBy: 'admin', closureReason: rejection.reason, canReject: false });
    expect((await send(`/admin/shop-orders/${order.order.id}/refund-reject`, { method: 'POST', body: rejection, admin: true })).status).toBe(409);
    const second = await requestRefund(), withdrawal = { refundId: second.id, version: second.version };
    expect((await send(`/shop-orders/${order.order.id}/refund-withdraw`, { method: 'POST', session: other, body: withdrawal })).status).toBe(404);
    expect((await send(`/shop-orders/${order.order.id}/refund-withdraw`, { method: 'POST', session: { ...session, csrfToken: 'wrong' }, body: withdrawal })).status).toBe(403);
    const withdrawn = await send(`/shop-orders/${order.order.id}/refund-withdraw`, { method: 'POST', session, body: withdrawal });
    expect(withdrawn.status).toBe(200);
    expect((await withdrawn.json()).order).toMatchObject({ status: 'paid', canRefund: true, refundedAmount: 0 });
    const detail = await (await send(`/shop-orders/${order.order.id}`, { session })).json();
    expect(detail.order.refunds.find(refund => refund.id === second.id)).toMatchObject({ status: 'withdrawn', version: 2, closedBy: 'member', canWithdraw: false });
    expect(local.sqlite.prepare('SELECT actor,action,version FROM site_shop_refund_events ORDER BY created_at').all()).toMatchObject([
      { actor: 'admin', action: 'rejected', version: 2 }, { actor: 'member', action: 'withdrawn', version: 2 },
    ]);
    expect(local.sqlite.prepare("SELECT count(*) AS count FROM site_admin_audit WHERE action='order.refund.reject' AND outcome='success'").get().count).toBe(1);
    const rejectedList = await (await send('/admin/shop-orders?refundStatus=rejected', { admin: true })).json();
    const withdrawnList = await (await send('/admin/shop-orders?refundStatus=withdrawn', { admin: true })).json();
    expect(rejectedList.orders).toHaveLength(1); expect(withdrawnList.orders).toHaveLength(1);
    expect(count('/partner/bill/cancel')).toBe(0);
    expect((await send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', admin: true,
      body: { refundId: second.id, amount: 30000, reason: '철회된 요청에 대한 오래된 승인' } })).status).toBe(409);
  });

  it('does not let request closure race with an approval already claimed by the administrator', async () => {
    const session = await member(), order = await started(session, await product()); await paid(session, order);
    const requested = (await (await send(`/shop-orders/${order.order.id}/refund-request`, { method: 'POST', session, body: { reason: '환불 신청' } })).json()).refundRequest;
    let release;
    cancelGate = new Promise(resolve => { release = resolve; });
    const entered = new Promise(resolve => { cancelStarted = resolve; });
    const approving = send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', admin: true,
      body: { refundId: requested.id, amount: 30000, reason: '전체 환불 승인' } });
    await entered;
    for (const [path, admin] of [['refund-withdraw', false], ['refund-reject', true]]) {
      const response = await send(`${admin ? '/admin' : ''}/shop-orders/${order.order.id}/${path}`, { method: 'POST', session, admin,
        body: { refundId: requested.id, version: requested.version, ...(admin ? { reason: '늦게 도착한 거절' } : {}) } });
      expect(response.status).toBe(409); expect((await response.json()).code).toBe('refund_state_changed');
    }
    release(); expect((await approving).status).toBe(200);
    expect(local.sqlite.prepare('SELECT state,version FROM site_shop_refunds').get()).toMatchObject({ state: 'completed', version: 3 });
    expect(local.sqlite.prepare('SELECT count(*) AS count FROM site_shop_refund_events').get().count).toBe(0);
    expect(count('/partner/bill/cancel')).toBe(1);
  });

  it('returns separate, safe next actions for configuration, network and inconsistent payment evidence', async () => {
    const session = await member(), order = await started(session, await product()); await paid(session, order);
    env.SITE_PAYSSAM_MERCHANT_CODE = 'changed-account';
    const config = await (await send(`/admin/shop-orders/${order.order.id}`, { admin: true })).json();
    expect(config).toMatchObject({ reconciliationStatus: 'configuration_required', reconciliation: { code: 'payment_configuration_required', nextAction: 'check_configuration' } });
    expect(JSON.stringify(config)).not.toContain(env.SITE_PAYSSAM_API_KEY); expect(JSON.stringify(config)).not.toContain('changed-account');
    env.SITE_PAYSSAM_MERCHANT_CODE = 'fixture-merchant'; readFailures.add(dbOrder(order).payssam_bill_id);
    const network = await (await send(`/admin/shop-orders/${order.order.id}`, { admin: true })).json();
    expect(network).toMatchObject({ reconciliationStatus: 'temporarily_unavailable', reconciliation: { code: 'payment_lookup_temporarily_unavailable', nextAction: 'retry' } });
    readFailures.clear(); readOverride = reply(bills.get(dbOrder(order).payssam_bill_id), { apprPrice: 1 });
    const evidence = await (await send(`/admin/shop-orders/${order.order.id}`, { admin: true })).json();
    expect(evidence).toMatchObject({ reconciliationStatus: 'review_required', reconciliation: { code: 'payment_evidence_review_required', nextAction: 'contact_provider' } });
    expect(dbOrder(order)).toMatchObject({ status: 'paid', refunded_amount: 0 });
  });

  it('opens the exact pending payment, shipping and refund worklists from administrator attention filters', async () => {
    const session = await member(), selected = await product({ slug: 'worklist-book', productType: 'physical', shippingFee: 0, stock: 2 });
    const waiting = await started(session, selected); await payment(session, waiting);
    local.sqlite.prepare("UPDATE site_shop_orders SET payssam_bill_state='unknown' WHERE id=?").run(waiting.order.id);
    const completed = await started(session, selected); await paid(session, completed);
    await send(`/shop-orders/${completed.order.id}/refund-request`, { method: 'POST', session, body: { reason: '환불 검토 요청' } });
    for (const [filter, ids] of [['payment_attention', [waiting.order.id]], ['shipping_pending', []], ['refund_pending', [completed.order.id]]]) {
      const response = await send(`/admin/shop-orders?filter=${filter}`, { admin: true });
      expect(response.status).toBe(200); expect((await response.json()).orders.map(order => order.id)).toEqual(ids);
    }
    expect((await send('/admin/shop-orders?filter=not-a-worklist', { admin: true })).status).toBe(400);
    expect((await send('/admin/shop-orders?filter=refund_pending', { session })).status).toBe(401);
  });

  it.each(['pending', 'approving', 'unknown'])('keeps shipment history unchanged while a refund request is %s', async state => {
    const session = await member(), selected = await product({ productType: 'physical', shippingFee: 0, stock: 1 }), order = await started(session, selected);
    await paid(session, order);
    const detail = await (await send(`/admin/shop-orders/${order.order.id}`, { admin: true })).json();
    await send(`/admin/shop-orders/${order.order.id}/shipment`, { method: 'PUT', admin: true,
      body: { status: 'shipped', carrier: '합성 택배', trackingNumber: 'SYNTHETIC-ORIGINAL', version: detail.order.version } });
    const request = await (await send(`/shop-orders/${order.order.id}/refund-request`, { method: 'POST', session, body: { reason: '취소·반품 검토 요청' } })).json();
    local.sqlite.prepare('UPDATE site_shop_refunds SET state=? WHERE id=?').run(state, request.refundRequest.id);
    const before = dbOrder(order);
    const response = await send(`/admin/shop-orders/${order.order.id}/shipment`, { method: 'PUT', admin: true,
      body: { status: 'delivered', carrier: '변경 택배', trackingNumber: 'SYNTHETIC-CHANGED', version: before.admin_version } });
    expect(response.status).toBe(409); expect((await response.json()).code).toBe('refund_review_required');
    expect(dbOrder(order)).toMatchObject({ shipping_status: before.shipping_status, carrier: before.carrier, tracking_number: before.tracking_number, admin_version: before.admin_version });
    const visible = await (await send(`/shop-orders/${order.order.id}`, { session })).json();
    expect(visible.order.shipping).toMatchObject({ status: 'shipped', carrier: '합성 택배', trackingNumber: 'SYNTHETIC-ORIGINAL' });
  });
});

async function coupon(overrides = {}) {
  const input = { id: crypto.randomUUID(), code: `SAVE_${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    name: '상품 할인', discountType: 'fixed', discountValue: 5000, minItemAmount: 0, maxDiscountAmount: null,
    productId: null, startsAt: null, endsAt: null, perMemberOnce: true, status: 'active', ...overrides };
  const response = await send('/admin/coupons', { method: 'POST', admin: true, body: input });
  expect(response.status).toBe(201); return { input, ...(await response.json()).coupon };
}
const redemption = order => local.sqlite.prepare('SELECT * FROM site_shop_coupon_redemptions WHERE order_id=?').get(order.order.id);

describe('one payment for an immutable multi-product order', () => {
  const region = { jejuExtraFee: 4000, remoteExtraFee: 6000, remotePostalRanges: [{ start: '12345', end: '12349' }] };
  const general = { postalCode: '10000', address: '경기도 검수시 검수로 1' };
  const shipping = address => ({ recipientName: '합성 수령인', phone: '010-1234-5678', ...address, addressDetail: '' });
  const wanted = (selected, quantity = 1, couponId) => ({ productId: selected.id, quantity, ...(couponId ? { couponId } : {}) });
  async function selections() {
    const digital = await product({ slug: 'bundle-digital', price: 20000 });
    const first = await product({ slug: 'bundle-first', productType: 'physical', price: 30000, stock: 5, shippingFee: 3000, regionalShipping: region, freeShippingThreshold: 50000 });
    const second = await product({ slug: 'bundle-second', productType: 'physical', price: 25000, stock: 5, shippingFee: 5000,
      regionalShipping: { ...region, jejuExtraFee: 2000, remoteExtraFee: 8000 }, freeShippingThreshold: 100000 });
    return { digital, first, second };
  }
  async function quoted(session, items, address = general) {
    const response = await send('/cart-quote', { method: 'POST', session, body: { items, ...(address || {}) } }); expect(response.status).toBe(200); return response.json();
  }
  async function created(session, items, { address = general, overrides = {} } = {}) {
    const quote = await quoted(session, items, address);
    const input = { items, idempotencyKey: crypto.randomUUID(), customerName: '합성 구매자', customerPhone: '010-1234-5678', termsAccepted: true,
      cartQuoteVersions: quote.productVersions, ...(quote.requiresShipping ? { shipping: shipping(address) } : {}), ...overrides };
    const response = await send('/shop-orders', { method: 'POST', session, body: input }); expect(response.status).toBe(201);
    return { input, quote, ...(await response.json()) };
  }
  it('quotes selected lines without orders, stock reservations, PG calls or private file keys', async () => {
    const session = await member(), { digital, first } = await selections(), items = [wanted(digital), wanted(first, 2)];
    expect((await send('/cart-quote', { method: 'POST', body: { items } })).status).toBe(401);
    expect((await send('/cart-quote', { method: 'POST', session, headers: { 'X-CSRF-Token': '' }, body: { items } })).status).toBe(403);
    const result = await quoted(session, items, null);
    expect(result.quote).toEqual({ itemAmount: 80000, discountAmount: 0, shippingFee: 0, amount: 80000 });
    expect(result).toMatchObject({ requiresShipping: true, shippingPending: true, shipping: null });
    expect(result.items).toHaveLength(2); expect(result.items[0]).not.toHaveProperty('fileKey');
    expect(result.items[0]).toMatchObject({ termsVersion: digital.termsVersion, refundPolicy: digital.refundPolicy, deliveryPolicy: digital.deliveryPolicy });
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products WHERE slug=?').get(first.id).stock).toBe(5);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_orders').get().n).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects shipping data in quote URLs and invalid stored SKU names before any order write', async () => {
    const session = await member(), { first } = await selections(), body = { items: [wanted(first)] };
    expect((await send('/cart-quote?postalCode=10000', { method: 'POST', session, body })).status).toBe(400);
    expect((await send('/shipping-quote?postalCode=10000', { method: 'POST', session, body: { productId: first.id, ...general } })).status).toBe(400);
    local.sqlite.prepare('UPDATE site_shop_products SET name=? WHERE slug=?').run('', first.id);
    expect((await send('/cart-quote', { method: 'POST', session, body })).status).toBe(409);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_orders').get().n).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });
  it('charges shared maximum base and extra once using the whole selection gross for every free-shipping rule', async () => {
    const session = await member(), { digital, first, second } = await selections();
    const jeju = { postalCode: '63010', address: '제주특별자치도 제주시 검수로 1' };
    const initial = await quoted(session, [wanted(first), wanted(second)], jeju);
    expect(initial.quote).toEqual({ itemAmount: 55000, discountAmount: 0, shippingFee: 9000, amount: 64000 });
    expect(initial.shipping).toEqual({ zone: 'jeju', baseFee: 5000, extraFee: 4000, fee: 9000 });
    const all = await quoted(session, [wanted(first), wanted(second), wanted(digital)], jeju);
    expect(all.quote).toMatchObject({ itemAmount: 75000, shippingFee: 9000, amount: 84000 });
    const quantity = await quoted(session, [wanted(first, 2), wanted(second), wanted(digital)], jeju);
    expect(quantity.quote).toEqual({ itemAmount: 105000, discountAmount: 0, shippingFee: 4000, amount: 109000 });
    expect(quantity.shipping).toEqual({ zone: 'jeju', baseFee: 0, extraFee: 4000, fee: 4000 });
    const remote = await quoted(session, [wanted(first, 2), wanted(second), wanted(digital)], { postalCode: '12345', address: general.address });
    expect(remote.shipping).toEqual({ zone: 'remote', baseFee: 0, extraFee: 8000, fee: 8000 });
  });
  it('rejects duplicate products and repeated coupons while allowing distinct scoped coupons', async () => {
    const session = await member(), { first, second } = await selections(), one = await coupon({ productId: first.id, discountValue: 1000 }), two = await coupon({ productId: second.id, discountValue: 2000 });
    const duplicateProduct = await send('/cart-quote', { method: 'POST', session, body: { items: [wanted(first), wanted(first)] } });
    expect(duplicateProduct.status).toBe(400); expect((await duplicateProduct.json()).code).toBe('product_duplicate');
    const duplicateCoupon = await send('/cart-quote', { method: 'POST', session, body: { items: [wanted(first, 1, one.id), wanted(second, 1, one.id)] } });
    expect(duplicateCoupon.status).toBe(400); expect((await duplicateCoupon.json()).code).toBe('coupon_duplicate');
    const order = await created(session, [wanted(first, 1, one.id), wanted(second, 1, two.id)]);
    expect(order.order).toMatchObject({ purchaseType: 'bundle', itemAmount: 55000, discountAmount: 3000, shippingFee: 5000, amount: 57000 });
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_coupon_redemptions WHERE order_id=?').get(order.order.id).n).toBe(2);
    await paid(session, order);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_coupon_redemptions WHERE order_id=? AND state=?').get(order.order.id, 'used').n).toBe(2);
  });
  it.each([{ items: [] }, { amount: 1 }, { items: Array.from({ length: 31 }, (_, index) => ({ productId: 'book-' + index, quantity: 1 })) }])('rejects unbounded or client-priced cart quotes: %j', async mutation => {
    const session = await member(), { first } = await selections();
    expect((await send('/cart-quote', { method: 'POST', session, body: { items: [wanted(first)], ...mutation } })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('requires every product version and protects a price change in any selected line', async () => {
    const session = await member(), { digital, first } = await selections(), items = [wanted(digital), wanted(first)];
    const quote = await quoted(session, items), input = { items, idempotencyKey: crypto.randomUUID(), customerName: '합성 구매자', customerPhone: '010-1234-5678',
      termsAccepted: true, shipping: shipping(general), cartQuoteVersions: quote.productVersions };
    expect((await send('/shop-orders', { method: 'POST', session, body: { ...input, cartQuoteVersions: { [first.id]: first.version } } })).status).toBe(409);
    expect((await send('/admin/products/' + digital.id, { method: 'PUT', admin: true, body: { ...digital.input, version: digital.version, price: 21000 } })).status).toBe(200);
    const stale = await send('/shop-orders', { method: 'POST', session, body: input }); expect(stale.status).toBe(409); expect((await stale.json()).code).toBe('shipping_quote_changed');
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_orders').get().n).toBe(0);
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products WHERE slug=?').get(first.id).stock).toBe(5);
  });
  it('atomically rejects all lines if one product changes immediately before the transaction', async () => {
    const session = await member(), { first, second } = await selections(), items = [wanted(first), wanted(second)], quote = await quoted(session, items);
    const originalBatch = env.GAME_DB.batch;
    env.GAME_DB.batch = async statements => { if (statements.length === 4) local.sqlite.prepare('UPDATE site_shop_products SET version=version+1 WHERE slug=?').run(second.id); return originalBatch(statements); };
    const response = await send('/shop-orders', { method: 'POST', session, body: { items, cartQuoteVersions: quote.productVersions,
      idempotencyKey: crypto.randomUUID(), customerName: '합성 구매자', customerPhone: '010-1234-5678', termsAccepted: true, shipping: shipping(general) } });
    expect(response.status).toBe(409);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_orders').get().n).toBe(0);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_order_items').get().n).toBe(0);
    expect(local.sqlite.prepare('SELECT SUM(stock) AS n FROM site_shop_products WHERE product_type=?').get('physical').n).toBe(10);
  });
  it('lets one competing basket reserve both physical SKUs without partial reservations', async () => {
    const session = await member(), { first, second } = await selections(), items = [wanted(first, 5), wanted(second, 5)], quote = await quoted(session, items);
    const input = { items, cartQuoteVersions: quote.productVersions, customerName: '합성 구매자', customerPhone: '010-1234-5678', termsAccepted: true, shipping: shipping(general) };
    const responses = await Promise.all([send('/shop-orders', { method: 'POST', session, body: { ...input, idempotencyKey: crypto.randomUUID() } }),
      send('/shop-orders', { method: 'POST', session, body: { ...input, idempotencyKey: crypto.randomUUID() } })]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    expect(local.sqlite.prepare('SELECT SUM(stock) AS n FROM site_shop_products WHERE product_type=?').get('physical').n).toBe(0);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_orders').get().n).toBe(1);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_order_items').get().n).toBe(2);
  });
  it('retries the same selection as one header, one bill and stable line IDs, and rejects changed content', async () => {
    const session = await member(), { digital, first } = await selections(), order = await created(session, [wanted(digital), wanted(first, 2)]);
    const repeated = await send('/shop-orders', { method: 'POST', session, body: { ...order.input, items: [...order.input.items].reverse() } }); expect(repeated.status).toBe(200);
    expect((await repeated.json()).order.items.map(item => item.id)).toEqual(order.order.items.map(item => item.id));
    expect((await send('/shop-orders', { method: 'POST', session, body: { ...order.input, items: [wanted(digital), wanted(first, 1)] } })).status).toBe(409);
    await payment(session, order); await payment(session, order); expect(count('/partner/bill')).toBe(1);
    expect(bills.get(dbOrder(order).payssam_bill_id).price).toBe(String(order.order.amount));
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_orders').get().n).toBe(1);
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products WHERE slug=?').get(first.id).stock).toBe(3);
  });
  it('keeps mixed-order digital files individually owned and revokes them together after full refund', async () => {
    const session = await member(), other = await member('bundle-other@fixture.invalid'), { digital, first } = await selections();
    const another = await product({ slug: 'bundle-second-digital', name: '두 번째 중국어 자료', price: 22000, fileName: '다른 자료.pdf' });
    const order = await created(session, [wanted(digital), wanted(another), wanted(first, 2)]);
    expect(order.order).toMatchObject({ purchaseType: 'bundle', productType: 'physical', unitPrice: null, quantity: 4, itemAmount: 102000, amount: 102000, shippingFee: 0, canDownload: false });
    expect(order.order.items.every(item => !item.canDownload)).toBe(true); expect(order.order.items[0]).not.toHaveProperty('fileKey');
    expect((await send('/shop-orders/' + order.order.id + '/download?item=' + order.order.items[0].id, { session })).status).toBe(403);
    const approved = await paid(session, order); const files = approved.order.items.filter(item => item.productType === 'digital'); expect(files).toHaveLength(2);
    for (const item of files) { expect(item.canDownload).toBe(true); const download = await send('/shop-orders/' + order.order.id + '/download?item=' + item.id, { session }); expect(download.status).toBe(200); expect(await download.text()).toContain('%PDF'); }
    const searched = await (await send('/admin/shop-orders?q=' + encodeURIComponent(another.name) + '&productType=digital', { admin: true })).json();
    expect(searched.orders.map(value => value.id)).toContain(order.order.id);
    const adminView = await (await send('/admin/shop-orders/' + order.order.id, { admin: true })).json();
    expect(adminView.order.downloadCount).toBe(2);
    expect((await send('/shop-orders/' + order.order.id + '/download?item=' + files[0].id, { session: other })).status).toBe(404);
    expect((await send('/shop-orders/' + order.order.id + '/download?item=' + crypto.randomUUID(), { session })).status).toBe(404);
    expect((await send('/shop-orders/' + order.order.id + '/download', { session })).status).toBe(400);
    const physical = approved.order.items.find(item => item.productType === 'physical');
    expect((await send('/shop-orders/' + order.order.id + '/download?item=' + physical.id, { session })).status).toBe(403);
    const partial = await send('/admin/shop-orders/' + order.order.id + '/refund', { method: 'POST', admin: true,
      body: { amount: 20000, reason: '혼합 주문 일부 금액', idempotencyKey: crypto.randomUUID() } });
    expect(partial.status).toBe(400); expect((await partial.json()).code).toBe('partial_refund_unsupported'); expect(count('/partner/bill/cancel')).toBe(0);
    const refund = await send('/admin/shop-orders/' + order.order.id + '/refund', { method: 'POST', admin: true,
      body: { amount: order.order.amount, reason: '혼합 상품 전체 주문 환불', idempotencyKey: crypto.randomUUID() } }); expect(refund.status).toBe(200);
    for (const item of files) expect((await send('/shop-orders/' + order.order.id + '/download?item=' + item.id, { session })).status).toBe(403);
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products WHERE slug=?').get(first.id).stock).toBe(3);
    expect((await refund.json()).order.items.every(item => !item.canDownload)).toBe(true);
  });
  it('restores every reserved physical line once for an unpaid expired basket', async () => {
    const session = await member(), { first, second } = await selections(), order = await created(session, [wanted(first, 2), wanted(second, 3)]);
    local.sqlite.prepare('UPDATE site_shop_orders SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', order.order.id);
    await send('/shop-orders/' + order.order.id, { session }); await send('/shop-orders/' + order.order.id, { session });
    expect(dbOrder(order)).toMatchObject({ status: 'expired', stock_state: 'released' });
    expect(local.sqlite.prepare('SELECT SUM(stock) AS n FROM site_shop_products WHERE product_type=?').get('physical').n).toBe(10);
  });
  it('holds all basket stock until the provider proves destruction and then restores it once', async () => {
    const session = await member(), { first, second } = await selections(), order = await created(session, [wanted(first, 2), wanted(second, 3)]);
    await payment(session, order); local.sqlite.prepare('UPDATE site_shop_orders SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', order.order.id); destroyAckOnly = true;
    await send('/shop-orders/' + order.order.id, { session }); expect(dbOrder(order).stock_state).toBe('reserved');
    expect(local.sqlite.prepare('SELECT SUM(stock) AS n FROM site_shop_products WHERE product_type=?').get('physical').n).toBe(5);
    bills.get(dbOrder(order).payssam_bill_id).state = 'D'; await reconcileSiteShopPayments(env); await reconcileSiteShopPayments(env);
    expect(dbOrder(order).stock_state).toBe('released'); expect(local.sqlite.prepare('SELECT SUM(stock) AS n FROM site_shop_products WHERE product_type=?').get('physical').n).toBe(10);
  });
  it('rolls back header, lines, coupon rows and every stock reservation on a late coupon uniqueness failure', async () => {
    const session = await member(), { digital, first, second } = await selections(), baseline = await started(session, digital), discount = await coupon();
    const items = [wanted(first, 2, discount.id), wanted(second, 3)], quote = await quoted(session, items);
    const originalPrepare = env.GAME_DB.prepare;
    env.GAME_DB.prepare = sql => {
      const statement = originalPrepare(sql);
      if (!sql.includes('INSERT INTO site_shop_coupon_redemptions') || !sql.includes('json_each')) return statement;
      const wrap = bound => ({ ...bound, bind: (...args) => wrap(bound.bind(...args)), _execute: () => {
        local.sqlite.prepare('INSERT INTO site_shop_coupon_redemptions(order_id,coupon_id,member_id,per_member_once,state,created_at,updated_at) VALUES(?,?,?,1,?,?,?)')
          .run(baseline.order.id, discount.id, session.member.id, 'reserved', new Date().toISOString(), new Date().toISOString());
        return bound._execute();
      } }); return wrap(statement);
    };
    const response = await send('/shop-orders', { method: 'POST', session, body: { items, cartQuoteVersions: quote.productVersions,
      idempotencyKey: crypto.randomUUID(), customerName: '합성 구매자', customerPhone: '010-1234-5678', termsAccepted: true, shipping: shipping(general) } });
    expect(response.status).toBe(503);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_orders').get().n).toBe(1);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_order_items').get().n).toBe(0);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_coupon_redemptions').get().n).toBe(0);
    expect(local.sqlite.prepare('SELECT SUM(stock) AS n FROM site_shop_products WHERE product_type=?').get('physical').n).toBe(10); expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves old redemption rows and the member-once unique index during composite-key migration', async () => {
    const session = await member(), selected = await product(), discount = await coupon(), order = await started(session, selected, { couponId: discount.id });
    const second = await started(session, selected), previous = { ...redemption(order) };
    local.sqlite.exec('DROP TABLE site_shop_order_items; DROP TABLE site_shop_coupon_redemptions;');
    const originalSchema = readFileSync(new URL('../migrations/0020_site_shop_coupons.sql', import.meta.url), 'utf8');
    const originalStart = originalSchema.search(/CREATE TABLE (?:IF NOT EXISTS )?site_shop_coupon_redemptions/);
    expect(originalStart).toBeGreaterThanOrEqual(0); local.sqlite.exec(originalSchema.slice(originalStart));
    local.sqlite.prepare('INSERT INTO site_shop_coupon_redemptions(order_id,coupon_id,member_id,per_member_once,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(previous.order_id, previous.coupon_id, previous.member_id, previous.per_member_once, previous.state, previous.created_at, previous.updated_at);
    local.sqlite.exec(readFileSync(new URL('../migrations/0024_site_shop_bundle_orders.sql', import.meta.url), 'utf8'));
    expect({ ...redemption(order) }).toEqual(previous);
    expect(local.sqlite.prepare('PRAGMA table_info(site_shop_coupon_redemptions)').all().filter(column => column.pk).map(column => column.name)).toEqual(['order_id', 'coupon_id']);
    expect(() => local.sqlite.prepare('INSERT INTO site_shop_coupon_redemptions(order_id,coupon_id,member_id,per_member_once,state,created_at,updated_at) VALUES(?,?,?,1,?,?,?)')
      .run(second.order.id, discount.id, session.member.id, 'reserved', previous.created_at, previous.updated_at)).toThrow();
  });
  it('keeps per-line positive merchandise while applying the minimum payment only to the aggregate', async () => {
    const session = await member(), first = await product({ slug: 'minimum-bundle-one', price: 20000 }), second = await product({ slug: 'minimum-bundle-two', price: 20000 });
    const discount = await coupon({ productId: first.id, discountValue: 19999 });
    const result = await quoted(session, [wanted(first, 1, discount.id), wanted(second)], null);
    expect(result.items.find(item => item.productId === first.id).amount).toBe(1); expect(result.quote.amount).toBe(20001);
    const order = await created(session, [wanted(first, 1, discount.id), wanted(second)], { address: null }); expect(order.order.amount).toBe(20001);
  });
  it('blocks a pending policy or unavailable digital item for the entire basket', async () => {
    const session = await member(), { digital, first } = await selections();
    await send('/admin/products/' + first.id, { method: 'PUT', admin: true, body: { ...first.input, version: first.version, regionalShipping: null } });
    const pending = await send('/cart-quote', { method: 'POST', session, body: { items: [wanted(digital), wanted(first)] } });
    expect(pending.status).toBe(409); expect((await pending.json()).code).toBe('shipping_configuration_pending');
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_orders').get().n).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });
  it('treats all-digital baskets as zero shipping and guards type changes on every purchased product', async () => {
    const session = await member(), first = await product({ slug: 'bundle-digital-one' }), second = await product({ slug: 'bundle-digital-two' });
    const order = await created(session, [wanted(first), wanted(second)], { address: null });
    expect(order.order).toMatchObject({ purchaseType: 'bundle', productType: 'digital', shippingFee: 0, shippingBreakdown: { zone: 'not_applicable', baseFee: 0, extraFee: 0, fee: 0 } });
    const changing = await send('/admin/products/' + second.id, { method: 'PUT', admin: true,
      body: { ...second.input, version: second.version, productType: 'physical', shippingFee: 0, stock: 1 } }); expect(changing.status).toBe(409);
  });
});

describe('free base shipping on gross merchandise amounts', () => {
  const regional = { jejuExtraFee: 3000, remoteExtraFee: 5000, remotePostalRanges: [{ start: '12345', end: '12349' }] };
  const general = { postalCode: '10000', address: '경기도 검수시 검수로 1' };
  const quoteFor = (selected, quantity, extra = {}) => ({ productId: selected.id, quantity, ...general, ...extra });
  it('applies below, exact and above threshold quantities before coupon discounts or delivery', async () => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 9, shippingFee: 3000,
      regionalShipping: regional, freeShippingThreshold: 60000 }), discount = await coupon();
    expect(selected.freeShippingThreshold).toBe(60000);
    for (const [quantity, itemAmount, shippingFee] of [[1, 30000, 3000], [2, 60000, 0], [3, 90000, 0]]) {
      const response = await send('/shipping-quote', { method: 'POST', session, body: quoteFor(selected, quantity) }); expect(response.status).toBe(200);
      const result = await response.json(); expect(result.quote).toMatchObject({ quantity, itemAmount, shippingFee, amount: itemAmount + shippingFee, freeShippingThreshold: 60000 });
      expect(result.shipping).toEqual({ zone: 'general', baseFee: shippingFee, extraFee: 0, fee: shippingFee });
    }
    const discounted = await (await send('/shipping-quote', { method: 'POST', session, body: quoteFor(selected, 2, { couponId: discount.id }) })).json();
    expect(discounted.quote).toMatchObject({ itemAmount: 60000, shippingFee: 0, discountAmount: 5000, amount: 55000, freeShippingThreshold: 60000 });
    const offers = await (await send('/coupons?product=' + selected.slug + '&quantity=2', { session })).json();
    expect(offers.quote).toMatchObject({ itemAmount: 60000, shippingFee: 0, amount: 60000 });
    expect(offers.coupons.find(entry => entry.id === discount.id)).toMatchObject({ applicable: true, discountAmount: 5000, amount: 55000 });
    const created = await started(session, selected, { quantity: 2, couponId: discount.id,
      shipping: { recipientName: '합성 수령인', phone: '010-1234-5678', ...general, addressDetail: '' }, shippingQuoteVersion: discounted.productVersion });
    expect(created.order).toMatchObject({ itemAmount: 60000, shippingFee: 0, discountAmount: 5000, amount: 55000, freeShippingThreshold: 60000 });
    expect(JSON.parse(dbOrder(created).snapshot).freeShippingThreshold).toBe(60000);
    await paid(session, created); expect(bills.get(dbOrder(created).payssam_bill_id).price).toBe('55000');
  });
  it('keeps 제주 and remote extras payable when the base shipping becomes free', async () => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 9, shippingFee: 3000,
      regionalShipping: regional, freeShippingThreshold: 60000 });
    for (const [postalCode, address, zone, extraFee] of [['63010', '제주특별자치도 제주시 검수로 1', 'jeju', 3000],
      ['12345', '경기도 검수시 검수로 1', 'remote', 5000]]) {
      const result = await (await send('/shipping-quote', { method: 'POST', session, body: quoteFor(selected, 2, { postalCode, address }) })).json();
      expect(result.shipping).toEqual({ zone, baseFee: 0, extraFee, fee: extraFee }); expect(result.quote.amount).toBe(60000 + extraFee);
    }
  });
  it('preserves an omitted threshold, allows an explicit clear, and keeps zero distinct from null', async () => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 9, shippingFee: 3000,
      regionalShipping: regional, freeShippingThreshold: 60000 });
    const omitted = { ...selected.input, version: selected.version, description: '무료배송 조건 유지' }; delete omitted.freeShippingThreshold;
    const preserved = await send('/admin/products/' + selected.slug, { method: 'PUT', admin: true, body: omitted }); expect(preserved.status).toBe(200);
    const current = (await preserved.json()).product; expect(current.freeShippingThreshold).toBe(60000);
    const clearing = await send('/admin/products/' + selected.slug, { method: 'PUT', admin: true, body: { ...omitted, version: current.version, freeShippingThreshold: null } });
    expect(clearing.status).toBe(200); const cleared = (await clearing.json()).product; expect(cleared.freeShippingThreshold).toBeNull();
    expect((await (await send('/shipping-quote', { method: 'POST', session, body: quoteFor(selected, 3) })).json()).quote.shippingFee).toBe(3000);
    const zero = await send('/admin/products/' + selected.slug, { method: 'PUT', admin: true, body: { ...omitted, version: cleared.version, freeShippingThreshold: 0 } });
    expect(zero.status).toBe(200); expect((await zero.json()).product.freeShippingThreshold).toBe(0);
    expect((await (await send('/shipping-quote', { method: 'POST', session, body: quoteFor(selected, 1) })).json()).quote.shippingFee).toBe(0);
  });
  it.each([-1, 60000.1, '60000', 1000000001, false, {}])('rejects an invalid threshold without changing the product: %j', async freeShippingThreshold => {
    const selected = await product({ productType: 'physical', stock: 9, shippingFee: 3000, regionalShipping: regional, freeShippingThreshold: 60000 });
    expect((await send('/admin/products/' + selected.slug, { method: 'PUT', admin: true,
      body: { ...selected.input, version: selected.version, freeShippingThreshold } })).status).toBe(400);
    expect(local.sqlite.prepare('SELECT free_shipping_threshold,version FROM site_shop_products').get())
      .toMatchObject({ free_shipping_threshold: 60000, version: selected.version });
  });
  it('keeps shipping policy setup mandatory even when zero would make base shipping always free', async () => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 9, shippingFee: 3000, regionalShipping: null, freeShippingThreshold: 0 });
    const response = await send('/shipping-quote', { method: 'POST', session, body: quoteFor(selected, 2) });
    expect(response.status).toBe(409); expect((await response.json()).code).toBe('shipping_configuration_pending');
    expect((await send('/shop-orders', { method: 'POST', session, body: inputFor(selected) })).status).toBe(409); expect(fetch).not.toHaveBeenCalled();
  });
  it('guards a threshold edit after quoting and preserves charged shipping and threshold snapshots after an order exists', async () => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 9, shippingFee: 3000,
      regionalShipping: regional, freeShippingThreshold: 60000 });
    const oldQuote = await (await send('/shipping-quote', { method: 'POST', session, body: quoteFor(selected, 2) })).json();
    const editing = await send('/admin/products/' + selected.slug, { method: 'PUT', admin: true,
      body: { ...selected.input, version: selected.version, freeShippingThreshold: null } }); expect(editing.status).toBe(200);
    const oldInput = inputFor(selected, { quantity: 2, shippingQuoteVersion: oldQuote.productVersion,
      shipping: { recipientName: '합성 수령인', phone: '010-1234-5678', ...general, addressDetail: '' } });
    const stale = await send('/shop-orders', { method: 'POST', session, body: oldInput }); expect(stale.status).toBe(409); expect((await stale.json()).code).toBe('shipping_quote_changed');
    const fresh = await (await send('/shipping-quote', { method: 'POST', session, body: quoteFor(selected, 2) })).json();
    const order = await started(session, selected, { ...oldInput, shippingQuoteVersion: fresh.productVersion });
    expect(order.order).toMatchObject({ amount: 63000, shippingFee: 3000, freeShippingThreshold: null });
    const current = (await (await send('/admin/products/' + selected.slug, { admin: true })).json()).product;
    expect((await send('/admin/products/' + selected.slug, { method: 'PUT', admin: true,
      body: { ...selected.input, stock: 7, version: current.version, freeShippingThreshold: 0 } })).status).toBe(200);
    const result = await paid(session, order); expect(result.order).toMatchObject({ amount: 63000, shippingFee: 3000, freeShippingThreshold: null });
    const snap = JSON.parse(dbOrder(order).snapshot); delete snap.freeShippingThreshold;
    local.sqlite.prepare('UPDATE site_shop_orders SET snapshot=? WHERE id=?').run(JSON.stringify(snap), order.order.id);
    const legacy = await (await send('/shop-orders/' + order.order.id, { session })).json();
    expect(legacy.order).toMatchObject({ amount: 63000, shippingFee: 3000, freeShippingThreshold: null });
  });
  it('keeps the charged free-shipping amount and threshold unchanged through later edits and full refunds', async () => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 9, shippingFee: 3000,
      regionalShipping: regional, freeShippingThreshold: 60000 }), discount = await coupon();
    const quoted = await (await send('/shipping-quote', { method: 'POST', session,
      body: quoteFor(selected, 2, { postalCode: '63010', address: '제주특별자치도 제주시 검수로 1', couponId: discount.id }) })).json();
    const order = await started(session, selected, { quantity: 2, couponId: discount.id, shippingQuoteVersion: quoted.productVersion,
      shipping: { recipientName: '합성 수령인', phone: '010-1234-5678', postalCode: '63010', address: '제주특별자치도 제주시 검수로 1', addressDetail: '' } });
    expect(order.order).toMatchObject({ amount: 58000, shippingFee: 3000, discountAmount: 5000, freeShippingThreshold: 60000,
      shippingBreakdown: { zone: 'jeju', baseFee: 0, extraFee: 3000, fee: 3000 } });
    await paid(session, order); expect(bills.get(dbOrder(order).payssam_bill_id).price).toBe('58000');
    const current = (await (await send('/admin/products/' + selected.slug, { admin: true })).json()).product;
    await send('/admin/products/' + selected.slug, { method: 'PUT', admin: true, body: { ...selected.input, stock: 7, version: current.version, freeShippingThreshold: 100000 } });
    const refunded = await send('/admin/shop-orders/' + order.order.id + '/refund', { method: 'POST', admin: true,
      body: { amount: 58000, reason: '무료배송 조건 포함 전체 주문 환불', idempotencyKey: crypto.randomUUID() } }); expect(refunded.status).toBe(200);
    expect((await refunded.json()).order).toMatchObject({ amount: 58000, shippingFee: 3000, refundedAmount: 58000, freeShippingThreshold: 60000, status: 'refunded' });
  });
  it('uses the waived base charge when enforcing the maximum amount and rejects subminimum always-free prices', async () => {
    const session = await member(), selected = await product({ productType: 'physical', price: 500000000, stock: 3, shippingFee: 3000,
      freeShippingThreshold: 1000000000 });
    expect(selected.maxQuantity).toBe(2);
    const response = await send('/shipping-quote', { method: 'POST', session, body: quoteFor(selected, 2) }); expect(response.status).toBe(200);
    const quoted = await response.json(); expect(quoted.quote).toMatchObject({ itemAmount: 1000000000, shippingFee: 0, amount: 1000000000 });
    const order = await started(session, selected, { quantity: 2, shippingQuoteVersion: quoted.productVersion,
      shipping: { recipientName: '합성 수령인', phone: '010-1234-5678', ...general, addressDetail: '' } }); expect(order.order.amount).toBe(1000000000);
    const tiny = { ...selected.input, slug: 'free-subminimum', price: 99, freeShippingThreshold: 0 };
    expect((await send('/admin/products', { method: 'POST', admin: true, body: tiny })).status).toBe(400);
    const digital = await product({ slug: 'digital-no-shipping-condition', freeShippingThreshold: 0 }); expect(digital.freeShippingThreshold).toBeNull();
  });
});

describe('server-authoritative destination shipping charges', () => {
  const configured = { jejuExtraFee: 3000, remoteExtraFee: 5000, remotePostalRanges: [{ start: '12345', end: '12349' }, { start: '63000', end: '63001' }] };
  const destination = (postalCode = '63010', address = '제주특별자치도 제주시 검수로 1') => ({ postalCode, address });
  const quoteFor = (selected, overrides = {}) => ({ productId: selected.id, quantity: 2, ...destination(), ...overrides });
  const jejuShipping = () => ({ recipientName: '합성 수령인', phone: '010-1234-5678', ...destination(), addressDetail: '' });
  it('rejects unconfigured physical quotes and new orders while preserving explicit zero fees', async () => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 3, shippingFee: 3000, regionalShipping: null });
    const publicProduct = (await (await send('/products/' + selected.slug)).json()).product;
    expect(publicProduct).toMatchObject({ regionalShipping: null, shippingPolicyReady: false, available: true });
    const quoted = await send('/shipping-quote', { method: 'POST', session, body: quoteFor(selected) });
    expect(quoted.status).toBe(409); expect((await quoted.json()).code).toBe('shipping_configuration_pending');
    const creating = await send('/shop-orders', { method: 'POST', session, body: inputFor(selected, { shipping: jejuShipping() }) });
    expect(creating.status).toBe(409); expect((await creating.json()).code).toBe('shipping_configuration_pending');
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(3);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_orders').get().n).toBe(0); expect(fetch).not.toHaveBeenCalled();
    const saved = await send('/admin/products/' + selected.slug, { method: 'PUT', admin: true, body: { ...selected.input, version: selected.version,
      regionalShipping: { jejuExtraFee: 0, remoteExtraFee: 0, remotePostalRanges: [] } } }); expect(saved.status).toBe(200);
    const zero = await send('/shipping-quote', { method: 'POST', session, body: quoteFor(selected) }); expect(zero.status).toBe(200);
    expect((await zero.json()).shipping).toEqual({ zone: 'jeju', baseFee: 3000, extraFee: 0, fee: 3000 });
  });
  it('preserves omitted policy edits, sorts ranges and clears an explicit null with version protection', async () => {
    const selected = await product({ productType: 'physical', stock: 3, shippingFee: 3000,
      regionalShipping: { ...configured, remotePostalRanges: [...configured.remotePostalRanges].reverse() } });
    expect(selected.regionalShipping).toEqual(configured); expect(selected.shippingPolicyReady).toBe(true);
    const omitted = { ...selected.input, version: selected.version, name: '지역 배송 상품' }; delete omitted.regionalShipping;
    const response = await send('/admin/products/' + selected.slug, { method: 'PUT', admin: true, body: omitted }); expect(response.status).toBe(200);
    const changed = (await response.json()).product; expect(changed.regionalShipping).toEqual(configured);
    const cleared = await send('/admin/products/' + selected.slug, { method: 'PUT', admin: true, body: { ...omitted, version: changed.version, regionalShipping: null } });
    expect(cleared.status).toBe(200); expect((await cleared.json()).product).toMatchObject({ regionalShipping: null, shippingPolicyReady: false });
  });
  it('requires an authenticated member and CSRF and never writes an order or calls a PG for a quote', async () => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 5, shippingFee: 3000, regionalShipping: configured });
    expect((await send('/shipping-quote', { method: 'POST', body: quoteFor(selected) })).status).toBe(401);
    expect((await send('/shipping-quote', { method: 'POST', session, headers: { 'X-CSRF-Token': '' }, body: quoteFor(selected) })).status).toBe(403);
    const response = await send('/shipping-quote', { method: 'POST', session, body: quoteFor(selected, { quantity: 3 }) }); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ quote: { quantity: 3, unitPrice: 30000, itemAmount: 90000, shippingFee: 6000, discountAmount: 0, amount: 96000, coupon: null, freeShippingThreshold: null },
      shipping: { zone: 'jeju', baseFee: 3000, extraFee: 3000, fee: 6000 }, productVersion: selected.version });
    expect(local.sqlite.prepare('SELECT stock,version FROM site_shop_products').get()).toMatchObject({ stock: 5, version: selected.version });
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_orders').get().n).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });
  it('selects the registered remote range before Jeju and never adds both surcharges', async () => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 5, shippingFee: 3000, regionalShipping: configured });
    for (const [postalCode, address, zone, extraFee] of [ ['10000', '경기도 검수시 검수로 1', 'general', 0],
      ['12345', '경기도 검수시 검수로 1', 'remote', 5000], ['63001', '제주특별자치도 제주시 검수로 1', 'remote', 5000] ]) {
      const result = await send('/shipping-quote', { method: 'POST', session, body: quoteFor(selected, { postalCode, address }) }); expect(result.status).toBe(200);
      expect((await result.json()).shipping).toEqual({ zone, baseFee: 3000, extraFee, fee: 3000 + extraFee });
    }
  });
  it.each([destination('63010', '서울특별시 검수로 1'), destination('10000')])('rejects an address mismatch before payment or stock reservations', async shipping => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 3, shippingFee: 3000, regionalShipping: configured });
    const response = await send('/shipping-quote', { method: 'POST', session, body: quoteFor(selected, shipping) }); expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('shipping_address_mismatch');
    expect((await send('/shop-orders', { method: 'POST', session, body: inputFor(selected, { shipping: { ...jejuShipping(), ...shipping } }) })).status).toBe(400);
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(3); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{ amount: 1 }, { shippingFee: 0 }, { zone: 'general' }, { postalCode: '6301' }, { quantity: 100 }])('rejects a forged or invalid shipping quote body: %j', async mutation => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 3, shippingFee: 3000, regionalShipping: configured });
    expect((await send('/shipping-quote', { method: 'POST', session, body: quoteFor(selected, mutation) })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('guards policy edits between quote and order and binds a supplied quote version to idempotency', async () => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 4, shippingFee: 3000, regionalShipping: configured });
    const quoted = await (await send('/shipping-quote', { method: 'POST', session, body: quoteFor(selected) })).json();
    const updated = await send('/admin/products/' + selected.slug, { method: 'PUT', admin: true,
      body: { ...selected.input, version: selected.version, regionalShipping: { ...configured, jejuExtraFee: 4000 } } }); expect(updated.status).toBe(200);
    const oldInput = inputFor(selected, { quantity: 2, shipping: jejuShipping(), shippingQuoteVersion: quoted.productVersion });
    const old = await send('/shop-orders', { method: 'POST', session, body: oldInput }); expect(old.status).toBe(409); expect((await old.json()).code).toBe('shipping_quote_changed');
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_orders').get().n).toBe(0);
    const fresh = await (await send('/shipping-quote', { method: 'POST', session, body: quoteFor(selected) })).json();
    const input = { ...oldInput, shippingQuoteVersion: fresh.productVersion };
    const created = await send('/shop-orders', { method: 'POST', session, body: input }); expect(created.status).toBe(201);
    expect((await created.json()).order).toMatchObject({ amount: 67000, shippingFee: 7000, shippingBreakdown: { zone: 'jeju', baseFee: 3000, extraFee: 4000, fee: 7000 } });
    expect((await send('/shop-orders', { method: 'POST', session, body: input })).status).toBe(200);
    expect((await send('/shop-orders', { method: 'POST', session, body: { ...input, shippingQuoteVersion: fresh.productVersion + 1 } })).status).toBe(409);
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(2); expect(fetch).not.toHaveBeenCalled();
  });
  it('protects a shipping policy version change immediately before the order transaction', async () => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 4, shippingFee: 3000, regionalShipping: configured }), discount = await coupon();
    const quoted = await (await send('/shipping-quote', { method: 'POST', session, body: quoteFor(selected, { couponId: discount.id }) })).json();
    const originalBatch = env.GAME_DB.batch;
    env.GAME_DB.batch = async statements => {
      if (statements.length === 3) local.sqlite.prepare('UPDATE site_shop_products SET regional_shipping_json=?,version=version+1 WHERE slug=?')
        .run(JSON.stringify({ ...configured, jejuExtraFee: 4000 }), selected.slug);
      return originalBatch(statements);
    };
    const response = await send('/shop-orders', { method: 'POST', session, body: inputFor(selected,
      { quantity: 2, shipping: jejuShipping(), couponId: discount.id, shippingQuoteVersion: quoted.productVersion }) });
    expect(response.status).toBe(409); expect((await response.json()).code).toBe('shipping_quote_changed');
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(4);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_orders').get().n).toBe(0);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_coupon_redemptions').get().n).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects a price edit that would exceed the charge cap with an omitted but retained regional policy', async () => {
    const selected = await product({ productType: 'physical', stock: 4, shippingFee: 3000, regionalShipping: { ...configured, jejuExtraFee: 100000 } });
    const edited = { ...selected.input, version: selected.version, price: 999950000 }; delete edited.regionalShipping;
    const response = await send('/admin/products/' + selected.slug, { method: 'PUT', admin: true, body: edited }); expect(response.status).toBe(400);
    const current = (await (await send('/admin/products/' + selected.slug, { admin: true })).json()).product;
    expect(current).toMatchObject({ price: selected.price, version: selected.version, regionalShipping: { jejuExtraFee: 100000 } });
  });
  it('charges and refunds the frozen regional delivery total with a merchandise-only coupon', async () => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 4, shippingFee: 3000, regionalShipping: configured }), discount = await coupon();
    const quote = await (await send('/shipping-quote', { method: 'POST', session, body: quoteFor(selected, { couponId: discount.id }) })).json();
    expect(quote.quote).toMatchObject({ itemAmount: 60000, shippingFee: 6000, discountAmount: 5000, amount: 61000, coupon: { id: discount.id } });
    const order = await started(session, selected, { quantity: 2, shipping: jejuShipping(), couponId: discount.id, shippingQuoteVersion: quote.productVersion });
    expect(order.order).toMatchObject({ amount: 61000, shippingFee: 6000, discountAmount: 5000, shippingBreakdown: quote.shipping });
    expect(JSON.parse(dbOrder(order).snapshot).regionalShipping).toEqual(configured);
    await paid(session, order); expect(bills.get(dbOrder(order).payssam_bill_id).price).toBe('61000');
    const current = (await (await send('/admin/products/' + selected.slug, { admin: true })).json()).product;
    expect((await send('/admin/products/' + selected.slug, { method: 'PUT', admin: true, body: { ...selected.input, stock: 2, version: current.version, regionalShipping: null } })).status).toBe(200);
    const detail = await (await send('/shop-orders/' + order.order.id, { session })).json(); expect(detail.order.shippingBreakdown).toEqual(quote.shipping);
    const refunded = await send('/admin/shop-orders/' + order.order.id + '/refund', { method: 'POST', admin: true,
      body: { amount: 61000, reason: '지역 배송비 포함 전체 주문 환불', idempotencyKey: crypto.randomUUID() } }); expect(refunded.status).toBe(200);
    expect((await refunded.json()).order).toMatchObject({ amount: 61000, shippingFee: 6000, refundedAmount: 61000, status: 'refunded', shippingBreakdown: quote.shipping });
    expect(redemption(order).state).toBe('used');
  });
  it('preserves legacy charged shipping on existing order snapshots after policies are cleared', async () => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 3, shippingFee: 3000 }), order = await started(session, selected);
    const stored = dbOrder(order), snapshot = JSON.parse(stored.snapshot); delete snapshot.regionalShipping; delete snapshot.shippingBreakdown;
    local.sqlite.prepare('UPDATE site_shop_orders SET snapshot=? WHERE id=?').run(JSON.stringify(snapshot), stored.id);
    const current = (await (await send('/admin/products/' + selected.slug, { admin: true })).json()).product;
    await send('/admin/products/' + selected.slug, { method: 'PUT', admin: true, body: { ...selected.input, stock: 2, version: current.version, regionalShipping: null } });
    const detail = await paid(session, order);
    expect(detail.order).toMatchObject({ amount: 33000, shippingFee: 3000, shippingBreakdown: { zone: 'general', baseFee: 3000, extraFee: 0, fee: 3000 } });
  });
  it('keeps digital orders at zero delivery without a shipping quote or regional policy', async () => {
    const session = await member(), selected = await product({ regionalShipping: configured }), order = await started(session, selected);
    expect(selected).toMatchObject({ regionalShipping: null, shippingPolicyReady: true });
    expect(order.order).toMatchObject({ amount: 30000, shippingFee: 0, shippingBreakdown: { zone: 'not_applicable', baseFee: 0, extraFee: 0, fee: 0 } });
  });
});

describe('physical remote-area shipping guidance', () => {
  it('defaults legacy products to empty guidance and trims published physical guidance', async () => {
    const blank = await product({ productType: 'physical', stock: 2, shippingFee: 3000 });
    expect(blank.remoteShippingNote).toBe('');
    const selected = await product({ slug: 'remote-guidance', productType: 'physical', stock: 2, shippingFee: 3000,
      remoteShippingNote: '  제주·도서산간 추가 배송비는 구매 전 문의해주세요.\n지역별 금액 안내 후 진행합니다.  ' });
    const note = '제주·도서산간 추가 배송비는 구매 전 문의해주세요.\n지역별 금액 안내 후 진행합니다.';
    expect(selected.remoteShippingNote).toBe(note);
    expect((await (await send('/products/' + selected.slug)).json()).product).toMatchObject({ remoteShippingNote: note, shippingFee: 3000 });
    expect((await (await send('/admin/products/' + selected.slug, { admin: true })).json()).product.remoteShippingNote).toBe(note);
    expect(local.sqlite.prepare('SELECT remote_shipping_note FROM site_shop_products WHERE slug=?').get(selected.slug).remote_shipping_note).toBe(note);
  });
  it('preserves omitted guidance, accepts an explicit clear and keeps version conflicts atomic', async () => {
    const selected = await product({ productType: 'physical', stock: 2, shippingFee: 3000, remoteShippingNote: '제주·도서산간 배송비 문의' });
    const legacyInput = { ...selected.input, description: '상품 설명 수정', version: selected.version }; delete legacyInput.remoteShippingNote;
    const first = await send('/admin/products/' + selected.slug, { method: 'PUT', admin: true, body: legacyInput });
    expect(first.status).toBe(200); const saved = (await first.json()).product;
    expect(saved.remoteShippingNote).toBe(selected.remoteShippingNote);
    const stale = await send('/admin/products/' + selected.slug, { method: 'PUT', admin: true,
      body: { ...selected.input, version: selected.version, remoteShippingNote: '이전 버전 쓰기' } });
    expect(stale.status).toBe(409);
    expect((await (await send('/products/' + selected.slug)).json()).product.remoteShippingNote).toBe(selected.remoteShippingNote);
    const cleared = await send('/admin/products/' + selected.slug, { method: 'PUT', admin: true,
      body: { ...selected.input, version: saved.version, remoteShippingNote: '  ' } });
    expect(cleared.status).toBe(200); expect((await cleared.json()).product.remoteShippingNote).toBe('');
  });
  it.each([null, 3000, {}, '가'.repeat(501), '잘못된\u0000안내'])('rejects an invalid note without changing product state: %j', async remoteShippingNote => {
    const selected = await product({ productType: 'physical', stock: 2, shippingFee: 3000, remoteShippingNote: '기존 안내' });
    const response = await send('/admin/products/' + selected.slug, { method: 'PUT', admin: true,
      body: { ...selected.input, version: selected.version, remoteShippingNote } });
    expect(response.status).toBe(400);
    expect(local.sqlite.prepare('SELECT remote_shipping_note,version FROM site_shop_products WHERE slug=?').get(selected.slug))
      .toMatchObject({ remote_shipping_note: '기존 안내', version: selected.version });
  });
  it('keeps digital products free of shipping guidance and accepts the physical maximum length', async () => {
    const digital = await product({ remoteShippingNote: '배송 상품에만 사용하는 안내' });
    expect(digital.remoteShippingNote).toBe('');
    expect(local.sqlite.prepare('SELECT remote_shipping_note FROM site_shop_products WHERE slug=?').get(digital.slug).remote_shipping_note).toBe('');
    const physical = await product({ slug: 'maximum-note', productType: 'physical', stock: 2, shippingFee: 0, remoteShippingNote: '가'.repeat(500) });
    expect(physical.remoteShippingNote).toHaveLength(500);
  });
  it('freezes guidance on the order while coupon, quantity and charged shipping amounts remain unchanged', async () => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 3, shippingFee: 3000,
      remoteShippingNote: '제주·도서산간 구매 전 배송비 문의' }), discount = await coupon();
    const order = await started(session, selected, { quantity: 2, couponId: discount.id });
    expect(order.order).toMatchObject({ quantity: 2, itemAmount: 60000, shippingFee: 3000, discountAmount: 5000, amount: 58000,
      remoteShippingNote: selected.remoteShippingNote });
    expect(JSON.parse(dbOrder(order).snapshot).remoteShippingNote).toBe(selected.remoteShippingNote);
    const current = (await (await send('/admin/products/' + selected.slug, { admin: true })).json()).product;
    const changed = await send('/admin/products/' + selected.slug, { method: 'PUT', admin: true,
      body: { ...selected.input, stock: 1, version: current.version, remoteShippingNote: '새 지역 배송 안내' } });
    expect(changed.status).toBe(200);
    const result = await paid(session, order);
    expect(result.order).toMatchObject({ status: 'paid', amount: 58000, shippingFee: 3000, remoteShippingNote: selected.remoteShippingNote });
    expect(bills.get(dbOrder(order).payssam_bill_id).price).toBe('58000');
    expect((await (await send('/shop-orders', { session })).json()).orders[0].remoteShippingNote).toBe(selected.remoteShippingNote);
    expect((await (await send('/admin/shop-orders/' + order.order.id, { admin: true })).json()).order.remoteShippingNote).toBe(selected.remoteShippingNote);
  });
  it('returns empty guidance for older order snapshots instead of borrowing the latest product note', async () => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 2, shippingFee: 3000,
      remoteShippingNote: '현재 상품 안내' }), order = await started(session, selected);
    const stored = dbOrder(order), snapshot = JSON.parse(stored.snapshot); delete snapshot.remoteShippingNote;
    local.sqlite.prepare('UPDATE site_shop_orders SET snapshot=? WHERE id=?').run(JSON.stringify(snapshot), stored.id);
    const detail = await (await send('/shop-orders/' + stored.id, { session })).json();
    expect(detail.order).toMatchObject({ remoteShippingNote: '', amount: 33000, shippingFee: 3000 });
    expect((await (await send('/products/' + selected.slug)).json()).product.remoteShippingNote).toBe('현재 상품 안내');
  });
});

describe('server-authoritative product coupons', () => {
  it('lists merchandise-only fixed/percentage offers with a floor, cap, minimum and public privacy', async () => {
    const selected = await product({ productType: 'physical', stock: 9, shippingFee: 3000, price: 30001 });
    const fixed = await coupon({ discountValue: 5000 }), percent = await coupon({ discountType: 'percent', discountValue: 17, maxDiscountAmount: 7000 });
    const minimum = await coupon({ minItemAmount: 100000 }), future = await coupon({ startsAt: '2099-01-01T00:00:00+09:00' });
    const expired = await coupon({ endsAt: '2000-01-01T00:00:00.000Z' });
    const result = await (await send(`/coupons?product=${selected.slug}&quantity=3`)).json();
    expect(result.quote).toEqual({ quantity: 3, unitPrice: 30001, itemAmount: 90003, shippingFee: 3000, discountAmount: 0, amount: 93003 });
    expect(result.coupons.find(value => value.id === fixed.id)).toMatchObject({ applicable: true, reason: '', discountAmount: 5000, amount: 88003 });
    expect(result.coupons.find(value => value.id === percent.id)).toMatchObject({ applicable: true, discountAmount: 7000, amount: 86003 });
    for (const rule of [minimum, future, expired]) expect(result.coupons.find(value => value.id === rule.id)).toMatchObject({ applicable: false, discountAmount: 0, amount: 93003 });
    const single = await (await send(`/coupons?product=${selected.slug}`)).json();
    expect(single.coupons.find(value => value.id === percent.id).discountAmount).toBe(5100);
    expect(JSON.stringify(result)).not.toMatch(/memberId|create_hash|reservedCount|SITE_PAYSSAM/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects client monetary overrides, invalid coupon identity/quantity and a coupon for another product without any reservation', async () => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 2, shippingFee: 3000 });
    const other = await product({ slug: 'coupon-other' }), restricted = await coupon({ productId: other.slug });
    for (const path of [`/coupons?product=${selected.slug}&quantity=0`, `/coupons?product=${selected.slug}&quantity=1&quantity=2`,
      `/coupons?product=${selected.slug}&amount=1`, '/coupons?product=missing', `/coupons?product=${other.slug}&quantity=2`]) {
      expect([400,404,409]).toContain((await send(path)).status);
    }
    for (const field of ['amount','discountAmount','coupon','couponCode']) expect((await send('/shop-orders', {
      method: 'POST', session, body: inputFor(selected, { couponId: restricted.id, [field]: 1 }) })).status).toBe(400);
    for (const couponId of ['not-a-uuid', null, restricted.id.toUpperCase()]) expect((await send('/shop-orders', {
      method: 'POST', session, body: inputFor(selected, { couponId }) })).status).toBe(400);
    expect((await send('/shop-orders', { method: 'POST', session, body: inputFor(selected, { couponId: restricted.id }) })).status).toBe(409);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_orders').get().n).toBe(0);
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products WHERE slug=?').get(selected.slug).stock).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects full-item discounts and amounts below the payment minimum while leaving shipping unchanged', async () => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 2, shippingFee: 3000 });
    const free = await coupon({ discountValue: 30000 }), low = await product({ slug: 'coupon-small', price: 101 });
    const reduced = await coupon({ discountValue: 2, productId: low.slug });
    for (const [item, offer] of [[selected, free], [low, reduced]]) {
      const response = await send('/shop-orders', { method: 'POST', session, body: inputFor(item, { couponId: offer.id }) });
      expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'coupon_unavailable' });
    }
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_coupon_redemptions').get().n).toBe(0);
  });
  it('creates an immutable quantity/coupon quote, charges the net amount and refunds only that net amount without reissuing the coupon', async () => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 6, shippingFee: 3000 });
    const discount = await coupon({ discountValue: 10000 }), order = await started(session, selected, { quantity: 3, couponId: discount.id });
    expect(order.order).toMatchObject({ quantity: 3, unitPrice: 30000, itemAmount: 90000, discountAmount: 10000, amount: 83000,
      shippingFee: 3000, coupon: { id: discount.id, code: discount.code, name: discount.name, version: 1 } });
    expect(redemption(order).state).toBe('reserved');
    expect((await send(`/admin/coupons/${discount.id}`, { method: 'PUT', admin: true,
      body: { ...discount.input, id: undefined, name: '변경된 할인', discountValue: 500, status: 'inactive', version: 1 } })).status).toBe(200);
    const retry = await send('/shop-orders', { method: 'POST', session, body: order.input }); expect(retry.status).toBe(200);
    expect((await retry.json()).order).toMatchObject({ amount: 83000, discountAmount: 10000, coupon: { name: '상품 할인', version: 1 } });
    const receipt = await paid(session, order); expect(receipt.order.amount).toBe(83000); expect(redemption(order).state).toBe('used');
    expect(calls.find(call => call.path === '/partner/bill').bill.price).toBe('83000');
    const refund = { amount: 83000, reason: '구매자 전체 환불 요청 검토', idempotencyKey: crypto.randomUUID() };
    expect((await send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', admin: true, body: { ...refund, amount: 93000 } })).status).toBe(400);
    const response = await send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', admin: true, body: refund });
    expect(response.status).toBe(200); expect((await response.json()).order).toMatchObject({ amount: 83000, refundedAmount: 83000, itemAmount: 90000, discountAmount: 10000 });
    expect(redemption(order).state).toBe('used'); expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(3);
    const current = (await (await send(`/admin/coupons/${discount.id}`, { admin: true })).json()).coupon;
    expect(current).toMatchObject({ usedCount: 1, reservedCount: 0 });
  });
  it('binds coupon identity into idempotency and lets only one simultaneous once-only order reserve across different products', async () => {
    const session = await member(), one = await product({ productType: 'physical', stock: 3, shippingFee: 0 });
    const two = await product({ slug: 'coupon-second-physical', productType: 'physical', stock: 3, shippingFee: 0 }), discount = await coupon();
    const responses = await Promise.all([one, two].map(item => send('/shop-orders', {
      method: 'POST', session, body: inputFor(item, { couponId: discount.id }) })));
    expect(responses.map(value => value.status).sort()).toEqual([201,409]);
    const order = await responses.find(value => value.status === 201).json();
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_coupon_redemptions').get().n).toBe(1);
    expect(local.sqlite.prepare('SELECT SUM(stock) AS n FROM site_shop_products').get().n).toBe(5);
    const different = await coupon({ perMemberOnce: false });
    const exact = inputFor(one, { idempotencyKey: crypto.randomUUID(), couponId: different.id });
    const startedResponse = await send('/shop-orders', { method: 'POST', session, body: exact }); expect(startedResponse.status).toBe(201);
    expect((await send('/shop-orders', { method: 'POST', session, body: { ...exact, couponId: discount.id } })).status).toBe(409);
    const offers = await (await send(`/coupons?product=${one.slug}`, { session })).json();
    expect(offers.coupons.find(value => value.id === discount.id)).toMatchObject({ applicable: false, discountAmount: 0 });
    expect(order.order.coupon.id).toBe(discount.id);
  });
  it('lets different members use the same coupon and unlimited coupons be reserved more than once', async () => {
    const a = await member(), b = await member('coupon-second-member@fixture.invalid'), selected = await product(), once = await coupon();
    const first = await started(a, selected, { couponId: once.id }), second = await started(b, selected, { couponId: once.id });
    expect(first.order.memberId).toBeUndefined(); expect(redemption(second).member_id).toBe(b.member.id);
    const multiple = await coupon({ perMemberOnce: false });
    await started(a, selected, { couponId: multiple.id }); await started(a, selected, { couponId: multiple.id });
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_coupon_redemptions').get().n).toBe(4);
  });
  it('releases only definitely unpaid expired reservations and permits reusing the coupon exactly once afterward', async () => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 6, shippingFee: 3000 }), discount = await coupon();
    const first = await started(session, selected, { quantity: 3, couponId: discount.id });
    local.sqlite.prepare("UPDATE site_shop_orders SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(first.order.id);
    const result = await (await send(`/coupons?product=${selected.slug}`, { session })).json();
    expect(result.coupons.find(value => value.id === discount.id).applicable).toBe(true);
    expect(redemption(first).state).toBe('released'); expect(dbOrder(first).stock_state).toBe('released');
    const second = await started(session, selected, { quantity: 3, couponId: discount.id });
    await send(`/shop-orders/${first.order.id}`, { session });
    expect(redemption(second).state).toBe('reserved'); expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(3);
  });
  it('holds coupon reservation through an unknown/payable invoice until separate provider evidence confirms destruction', async () => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 2, shippingFee: 0 }), discount = await coupon();
    const order = await started(session, selected, { couponId: discount.id }); loseCreate = true; await payment(session, order); loseCreate = false;
    local.sqlite.prepare("UPDATE site_shop_orders SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(order.order.id); destroyAckOnly = true;
    await send(`/shop-orders/${order.order.id}`, { session });
    expect(redemption(order).state).toBe('reserved');
    expect((await send('/shop-orders', { method: 'POST', session, body: inputFor(selected, { couponId: discount.id }) })).status).toBe(409);
    bills.get(dbOrder(order).payssam_bill_id).state = 'D'; await reconcileSiteShopPayments(env); await reconcileSiteShopPayments(env);
    expect(redemption(order).state).toBe('released'); expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(2);
    await started(session, selected, { couponId: discount.id }); expect(count('/partner/bill')).toBe(1);
  });
  it('still fulfills a discounted digital file only from matching net provider evidence and revokes it after full refund', async () => {
    const session = await member(), selected = await product(), discount = await coupon({ discountValue: 1000 });
    const order = await started(session, selected, { couponId: discount.id }); await payment(session, order);
    const bill = bills.get(dbOrder(order).payssam_bill_id); bill.state = 'F'; readOverride = reply(bill, { apprPrice: '30000' });
    await send(`/shop-orders/${order.order.id}`, { session }); expect(dbOrder(order).approved_at).toBeNull(); expect(redemption(order).state).toBe('reserved');
    readOverride = null; const verified = await (await send(`/shop-orders/${order.order.id}`, { session })).json();
    expect(verified.order).toMatchObject({ amount: 29000, status: 'paid', canDownload: true });
    expect((await send(`/shop-orders/${order.order.id}/download`, { session })).status).toBe(200);
    expect(redemption(order).state).toBe('used');
    expect((await send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', admin: true,
      body: { amount: 29000, reason: '자료 미사용 전체 환불 검토', idempotencyKey: crypto.randomUUID() } })).status).toBe(200);
    expect((await send(`/shop-orders/${order.order.id}/download`, { session })).status).toBe(403); expect(redemption(order).state).toBe('used');
  });
  it('supports safe administrator create retries, rule validation, filtered pagination and version conflicts', async () => {
    const id = crypto.randomUUID(), input = { id, code: 'STABLE_COUPON', name: '재구매 할인', discountType: 'percent', discountValue: 10,
      minItemAmount: 0, maxDiscountAmount: null, productId: null, startsAt: null, endsAt: null, perMemberOnce: true, status: 'active' };
    const responses = await Promise.all([1,2].map(() => send('/admin/coupons', { method: 'POST', admin: true, body: input })));
    expect(responses.map(value => value.status).sort()).toEqual([200,201]);
    expect((await send('/admin/coupons', { method: 'POST', admin: true, body: { ...input, startsAt: undefined, endsAt: undefined } })).status).toBe(200);
    expect((await send('/admin/coupons', { method: 'POST', admin: true, body: { ...input, name: '다른 이름' } })).status).toBe(409);
    expect((await send('/admin/coupons', { method: 'POST', admin: true, body: { ...input, id: crypto.randomUUID() } })).status).toBe(409);
    for (const invalid of [{ discountValue: 100 }, { code: '_BAD' }, { startsAt: '2026-01-02T00:00:00Z', endsAt: '2026-01-01T00:00:00Z' },
      { productId: 'missing-product' }, { amount: 1 }, { minItemAmount: -1 }, { maxDiscountAmount: 0 }]) {
      expect((await send('/admin/coupons', { method: 'POST', admin: true, body: { ...input, id: crypto.randomUUID(), code: 'ANOTHER_CODE', ...invalid } })).status).toBe(400);
    }
    const edited = await send(`/admin/coupons/${id}`, { method: 'PUT', admin: true, body: { ...input, id: undefined, version: 1, name: '변경된 이름' } });
    expect(edited.status).toBe(200);
    expect((await send(`/admin/coupons/${id}`, { method: 'DELETE', admin: true, body: { version: 1 } })).status).toBe(409);
    expect((await send(`/admin/coupons/${id}`, { method: 'DELETE', admin: true, body: { version: 2 } })).status).toBe(200);
    await coupon({ code: 'SECOND_CODE' });
    const page = await (await send('/admin/coupons?limit=1', { admin: true })).json(); expect(page.coupons).toHaveLength(1); expect(page.nextCursor).toBeTypeOf('string');
    const next = await (await send(`/admin/coupons?limit=1&cursor=${page.nextCursor}`, { admin: true })).json();
    expect(next.coupons).toHaveLength(1); expect(next.coupons[0].id).not.toBe(page.coupons[0].id);
    const filtered = await (await send('/admin/coupons?status=archived&q=STABLE', { admin: true })).json(); expect(filtered.coupons).toHaveLength(1);
    expect(local.sqlite.prepare("SELECT COUNT(*) AS n FROM site_admin_audit WHERE action='coupon.create' AND outcome='success' AND target=?").get(`coupon:${id}`).n).toBe(1);
  });
  it('fails closed when a coupon changes after its quote is calculated but before the order/stock transaction', async () => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 4, shippingFee: 3000 }), discount = await coupon();
    const originalBatch = env.GAME_DB.batch;
    env.GAME_DB.batch = async statements => {
      if (statements.length === 3) local.sqlite.prepare("UPDATE site_shop_coupons SET status='inactive',version=version+1 WHERE id=?").run(discount.id);
      return originalBatch(statements);
    };
    const response = await send('/shop-orders', { method: 'POST', session, body: inputFor(selected, { quantity: 3, couponId: discount.id }) });
    expect(response.status).toBe(409);
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(4);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_orders').get().n).toBe(0);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_coupon_redemptions').get().n).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('Payssam product purchase lifecycle', () => {
  it('charges server unit price times physical quantity plus shipping once and preserves the monetary snapshot', async () => {
    const session = await member(), selected = await product({ productType:'physical',stock:6,shippingFee:3000 });
    const order = await started(session,selected,{quantity:3});
    expect(order.order).toMatchObject({quantity:3,unitPrice:30000,itemAmount:90000,shippingFee:3000,amount:93000});
    const row = dbOrder(order); expect(JSON.parse(row.snapshot)).toMatchObject({quantity:3,price:30000,unitPrice:30000,itemAmount:90000});
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(3);
    await payment(session,order); expect(calls.find(call=>call.path==='/partner/bill').bill.price).toBe('93000');
    bills.get(row.payssam_bill_id).state = 'F';
    expect((await callback(order,{apprPrice:'30000'})).status).toBe(200);
    expect(dbOrder(order)).toMatchObject({status:'paid',amount:93000,stock_state:'committed'});
    const current = (await (await send(`/admin/products/${selected.slug}`,{admin:true})).json()).product;
    expect((await send(`/admin/products/${selected.slug}`,{method:'PUT',admin:true,body:{...selected.input,price:45000,shippingFee:5000,stock:3,version:current.version}})).status).toBe(200);
    const detail = (await (await send(`/shop-orders/${row.id}`,{session})).json()).order;
    expect(detail).toMatchObject({quantity:3,unitPrice:30000,itemAmount:90000,shippingFee:3000,amount:93000,status:'paid'});
    expect((await (await send('/shop-orders',{session})).json()).orders[0]).toMatchObject({quantity:3,unitPrice:30000,itemAmount:90000,amount:93000});
  });
  it('rejects invalid quantities, repeated digital units, excess stock and client money before reservation or billing', async () => {
    const session = await member(), physical = await product({productType:'physical',stock:2,shippingFee:3000}), digital = await product({slug:'quantity-digital'});
    for (const quantity of [0,-1,100,1.5,'2',null]) expect((await send('/shop-orders',{method:'POST',session,body:inputFor(physical,{quantity})})).status).toBe(400);
    expect((await send('/shop-orders',{method:'POST',session,body:inputFor(physical,{quantity:3})})).status).toBe(409);
    expect((await send('/shop-orders',{method:'POST',session,body:inputFor(digital,{quantity:2})})).status).toBe(400);
    for (const field of ['price','unitPrice','itemAmount','amount']) expect((await send('/shop-orders',{method:'POST',session,body:inputFor(physical,{quantity:2,[field]:1})})).status).toBe(400);
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products WHERE slug=?').get(physical.slug).stock).toBe(2);
    expect(local.sqlite.prepare('SELECT count(*) AS total FROM site_shop_orders').get().total).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });
  it('publishes bounded maximum quantity independently of PG configuration and rejects monetary overflow', async () => {
    const session = await member(), selected = await product({productType:'physical',price:300000000,shippingFee:100000000,stock:100});
    let view = (await (await send(`/products/${selected.slug}`)).json()).product; expect(view.maxQuantity).toBe(3);
    const key = env.SITE_PAYSSAM_API_KEY; delete env.SITE_PAYSSAM_API_KEY;
    const preparing = await (await send(`/products/${selected.slug}`)).json(); expect(preparing.purchaseReady).toBe(false); expect(preparing.product.maxQuantity).toBe(3);
    env.SITE_PAYSSAM_API_KEY = key;
    expect((await send('/shop-orders',{method:'POST',session,body:inputFor(selected,{quantity:4})})).status).toBe(400);
    const order = await started(session,selected,{quantity:3}); expect(order.order.amount).toBe(1000000000);
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products WHERE slug=?').get(selected.slug).stock).toBe(97);
    const capped = await product({slug:'quantity-cap',productType:'physical',price:100,shippingFee:0,stock:100});
    expect((await (await send(`/products/${capped.slug}`)).json()).product.maxQuantity).toBe(99);
    const sold = await product({slug:'quantity-empty',productType:'physical',stock:0,shippingFee:0});
    expect((await (await send(`/products/${sold.slug}`)).json()).product.maxQuantity).toBe(0);
    const digital = await product({slug:'quantity-single-digital'}); expect((await (await send(`/products/${digital.slug}`)).json()).product.maxQuantity).toBe(1);
    env.SITE_SHOP_SALES_MODE='smartstore';
    const intro = await product({slug:'quantity-unprepared',productType:'physical',stock:99,shippingFee:0,termsVersion:'',refundPolicy:'',deliveryPolicy:''});
    env.SITE_SHOP_SALES_MODE='direct'; view=(await (await send(`/products/${intro.slug}`)).json()).product; expect(view.maxQuantity).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reserves quantity atomically and reuses the same attempt without accepting a changed quantity', async () => {
    const session = await member(), selected = await product({productType:'physical',stock:2,shippingFee:3000});
    const first = inputFor(selected,{quantity:2}), second = inputFor(selected,{quantity:2});
    const responses = await Promise.all([send('/shop-orders',{method:'POST',session,body:first}),send('/shop-orders',{method:'POST',session,body:second})]);
    expect(responses.map(response=>response.status).sort()).toEqual([201,409]);
    const winningInput = responses[0].status===201 ? first : second;
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(0);
    const repeated = await send('/shop-orders',{method:'POST',session,body:winningInput}); expect(repeated.status).toBe(200);
    expect((await repeated.json()).order).toMatchObject({quantity:2,itemAmount:60000,shippingFee:3000,amount:63000});
    expect((await send('/shop-orders',{method:'POST',session,body:{...winningInput,quantity:1}})).status).toBe(409);
    expect(local.sqlite.prepare('SELECT count(*) AS total FROM site_shop_orders').get().total).toBe(1);
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps omitted and explicit quantity one idempotent and reads legacy snapshots as one unit', async () => {
    const session = await member(), selected = await product({productType:'physical',stock:2,shippingFee:3000}), order = await started(session,selected);
    const row = dbOrder(order), oldSnapshot = JSON.parse(row.snapshot); delete oldSnapshot.quantity; delete oldSnapshot.unitPrice; delete oldSnapshot.itemAmount;
    local.sqlite.prepare('UPDATE site_shop_orders SET snapshot=? WHERE id=?').run(JSON.stringify(oldSnapshot),row.id);
    const repeated = await send('/shop-orders',{method:'POST',session,body:{...order.input,quantity:1}}); expect(repeated.status).toBe(200);
    expect((await repeated.json()).order).toMatchObject({id:row.id,quantity:1,unitPrice:30000,itemAmount:30000,shippingFee:3000,amount:33000});
    expect(dbOrder(order).payload_hash).toBe(row.payload_hash); expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(1);
    expect(local.sqlite.prepare('SELECT count(*) AS total FROM site_shop_orders').get().total).toBe(1);
  });
  it('restores the sum of expired reserved quantities exactly once including a legacy quantity-one snapshot', async () => {
    const session=await member(), selected=await product({productType:'physical',stock:5,shippingFee:3000});
    const multiple=await started(session,selected,{quantity:2}), legacy=await started(session,selected);
    const snapshot=JSON.parse(dbOrder(legacy).snapshot); delete snapshot.quantity; delete snapshot.unitPrice; delete snapshot.itemAmount;
    local.sqlite.prepare('UPDATE site_shop_orders SET snapshot=? WHERE id=?').run(JSON.stringify(snapshot),legacy.order.id);
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(2);
    local.sqlite.prepare("UPDATE site_shop_orders SET expires_at='2000-01-01T00:00:00.000Z'").run();
    for(let index=0;index<2;index++) expect((await send('/shop-orders',{session})).status).toBe(200);
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(5);
    for(const order of [multiple,legacy]) expect(dbOrder(order)).toMatchObject({status:'expired',stock_state:'released'});
    expect(fetch).not.toHaveBeenCalled();
  });
  it('holds every reserved unit of an expired bill until authenticated destruction proof restores them', async () => {
    const session=await member(), selected=await product({productType:'physical',stock:4,shippingFee:3000}), order=await started(session,selected,{quantity:3});
    await payment(session,order); expect(calls.find(call=>call.path==='/partner/bill').bill.price).toBe('93000');
    local.sqlite.prepare("UPDATE site_shop_orders SET expires_at='2000-01-01T00:00:00.000Z'").run(); destroyAckOnly=true;
    await send(`/shop-orders/${order.order.id}`,{session}); expect(dbOrder(order).stock_state).toBe('reserved');
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(1);
    bills.get(dbOrder(order).payssam_bill_id).state='D'; await reconcileSiteShopPayments(env); await reconcileSiteShopPayments(env);
    expect(dbOrder(order)).toMatchObject({status:'expired',stock_state:'released'}); expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(4);
  });
  it('keeps physical quantity snapshots and committed stock after whole-bill refunds and rejects per-unit refunds', async () => {
    const session=await member(), selected=await product({productType:'physical',stock:4,shippingFee:3000}), order=await started(session,selected,{quantity:2});
    await paid(session,order);
    const body={amount:63000,reason:'수량 포함 합성 주문 전체 환불',idempotencyKey:crypto.randomUUID()};
    expect((await send(`/admin/shop-orders/${order.order.id}/refund`,{method:'POST',admin:true,body:{...body,amount:30000}})).status).toBe(400);
    expect(count('/partner/bill/cancel')).toBe(0);
    const refunded=await send(`/admin/shop-orders/${order.order.id}/refund`,{method:'POST',admin:true,body}); expect(refunded.status).toBe(200);
    expect((await refunded.json()).order).toMatchObject({quantity:2,unitPrice:30000,itemAmount:60000,shippingFee:3000,amount:63000,refundedAmount:63000,status:'refunded'});
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(2); expect(dbOrder(order).stock_state).toBe('committed'); expect(count('/partner/bill/cancel')).toBe(1);
  });
  it('keeps sales preparing unless contract, merchant, private files and callback pins are ready', async () => {
    const session = await member(); env.SITE_PAYSSAM_CONTRACT_VERIFIED = 'false';
    expect(await (await send('/products')).json()).toMatchObject({ products: [], purchaseChannel: 'direct', purchaseReady: false });
    expect((await send('/shop-orders', { method: 'POST', session, body: inputFor({ id: 'missing', termsVersion: 'v1' }) })).status).toBe(503);
    env.SITE_PAYSSAM_CONTRACT_VERIFIED = 'true'; expect(await (await send('/products')).json()).toMatchObject({ products: [], purchaseReady: true });
    env.SITE_PAYSSAM_MODE = 'live'; expect(await (await send('/products')).json()).toMatchObject({ purchaseReady: false }); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects too-small sales and provider-invalid names before any reservation or invoice submission', async () => {
    const session = await member(), selected = await product({ productType: 'physical', shippingFee: 0, stock: 1 });
    expect((await send('/admin/products', { method: 'POST', admin: true, body: { ...selected.input, slug: 'too-small', price: 99 } })).status).toBe(400);
    expect((await send('/shop-orders', { method: 'POST', session, body: inputFor(selected, { customerName: '이름\u0000변조' }) })).status).toBe(400);
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(1); expect(fetch).not.toHaveBeenCalled();
    const low = await product({ slug: 'sandbox-small', price: 12000 }); const order = await started(session, low);
    expect((await payment(session, order)).status).toBe(400); expect(dbOrder(order).payssam_create_started_at).toBeNull();
  });
  it('creates no bill on GET and issues a single stable URL bill for owner-CSRF protected repeated payment POSTs', async () => {
    const session = await member(), other = await member('other-payssam@fixture.invalid'), order = await started(session, await product());
    expect(order.checkout).toMatchObject({ provider: 'payssam', paymentUrl: null, paymentOrigin: null, status: 'not_created' });
    expect(order.checkout).not.toHaveProperty('clientId'); expect(order.checkout).not.toHaveProperty('mallReserved');
    await send(`/shop-orders/${order.order.id}`, { session }); expect(fetch).not.toHaveBeenCalled();
    expect((await payment(other, order)).status).toBe(404); expect((await payment({ cookie: session.cookie }, order)).status).toBe(403);
    const results = await Promise.all([payment(session, order), payment(session, order)]); expect(results.every(response => response.status === 200)).toBe(true);
    expect(count('/partner/bill')).toBe(1); const ready = await (await payment(session, order)).json();
    expect(ready.checkout).toMatchObject({ provider: 'payssam', paymentOrigin: ORIGIN, status: 'ready' });
    expect(ready.checkout.paymentUrl).toBe(`${ORIGIN}/synthetic-payment/${dbOrder(order).payssam_bill_id}`);
    const issued = calls.find(call => call.path === '/partner/bill').bill;
    expect(issued.billId).toHaveLength(20); expect(issued.price).toBe('30000'); expect(issued.phone).toBe(`web_${session.member.id.replace(/-/g, '')}`);
    expect(issued.phone).not.toBe('01012345678'); expect(new URL(issued.callbackUrl).origin).toBe(CALLBACK);
    expect(new URL(issued.pageRedirectUrl).origin).toBe(ORIGIN); expect(JSON.stringify(ready)).not.toContain(env.SITE_PAYSSAM_API_KEY);
  });
  it('never re-creates a response-lost bill or invents a missing short URL from a W lookup', async () => {
    const session = await member(), order = await started(session, await product({ productType: 'physical', shippingFee: 0, stock: 1 }));
    loseCreate = true; await payment(session, order); loseCreate = false;
    for (let index = 0; index < 2; index++) { const result = await (await payment(session, order)).json(); expect(result.checkout).toMatchObject({ status: 'confirming', paymentUrl: null }); }
    await reconcileSiteShopPayments(env); expect(count('/partner/bill')).toBe(1); expect(dbOrder(order)).toMatchObject({ status: 'pending', stock_state: 'reserved', payssam_payment_url: null });
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(0);
  });
  it('rejects a creation URL from another host and safely hides a stale stored checkout URL', async () => {
    const session = await member(), order = await started(session, await product()); createUrl = 'https://untrusted.invalid/payment';
    const failed = await (await payment(session, order)).json(); expect(failed.checkout).toMatchObject({ status: 'confirming', paymentUrl: null });
    expect(count('/partner/bill')).toBe(1);
    local.sqlite.prepare("UPDATE site_shop_orders SET payssam_bill_state='ready',payssam_payment_url='https://untrusted.invalid/payment'").run();
    const response = await send(`/shop-orders/${order.order.id}`, { session }); expect(response.status).toBe(200);
    expect((await response.json()).checkout).toMatchObject({ status: 'confirming', paymentUrl: null });
  });
  it('treats valid callback F fields as a signal and accepts only authenticated read evidence', async () => {
    const session = await member(), order = await started(session, await product()); await payment(session, order);
    const response = await callback(order, { apprPrice: '1', apprNum: 'forged' }); expect(response.status).toBe(200); expect(await response.json()).toEqual({ code: '0000' });
    expect(dbOrder(order).approved_at).toBeNull(); expect((await send(`/shop-orders/${order.order.id}/download`, { session })).status).toBe(403);
    bills.get(dbOrder(order).payssam_bill_id).state = 'F'; expect((await callback(order)).status).toBe(200);
    expect(dbOrder(order).status).toBe('paid'); expect((await send(`/shop-orders/${order.order.id}/download`, { session })).status).toBe(200);
    for (const table of ['site_payment_requests', 'site_orders', 'site_order_items', 'site_notion_outbox']) expect(local.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n).toBe(0);
  });
  it('rejects forged callback secrets or foreign bill IDs before querying the provider', async () => {
    const session = await member(), order = await started(session, await product()); await payment(session, order); const before = calls.length;
    expect((await callback(order, {}, 'x'.repeat(43))).status).toBe(403);
    expect((await callback(order, { apiKey: 'foreign-key' })).status).toBe(403);
    expect((await callback(order, { billId: 'foreign-bill' })).status).toBe(403); expect(calls).toHaveLength(before);
  });
  it('holds an expired payable W reservation until a separate read proves destruction D', async () => {
    const session = await member(), order = await started(session, await product({ productType: 'physical', shippingFee: 0, stock: 1 })); await payment(session, order);
    local.sqlite.prepare("UPDATE site_shop_orders SET expires_at='2000-01-01T00:00:00.000Z'").run(); destroyAckOnly = true;
    const before = await (await send(`/shop-orders/${order.order.id}`, { session })).json(); expect(before.checkout.paymentUrl).toBeNull();
    expect(dbOrder(order)).toMatchObject({ stock_state: 'reserved', status: 'pending' }); expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(0);
    bills.get(dbOrder(order).payssam_bill_id).state = 'D'; await reconcileSiteShopPayments(env); await reconcileSiteShopPayments(env);
    expect(dbOrder(order)).toMatchObject({ status: 'expired', stock_state: 'released' }); expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(1);
  });
  it('retries destruction only after a fresh W read and backoff, using the same bill without releasing stock early', async () => {
    const session = await member(), order = await started(session, await product({ productType: 'physical', shippingFee: 0, stock: 1 })); await payment(session, order);
    local.sqlite.prepare("UPDATE site_shop_orders SET expires_at='2000-01-01T00:00:00.000Z'").run(); failDestroy = true;
    await send(`/shop-orders/${order.order.id}`, { session }); failDestroy = false; await send(`/shop-orders/${order.order.id}`, { session });
    expect(count('/partner/bill/destroy')).toBe(1); expect(dbOrder(order).stock_state).toBe('reserved');
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(Date.now() + 61_000)); await send(`/shop-orders/${order.order.id}`, { session });
    expect(count('/partner/bill/destroy')).toBe(2); expect(count('/partner/bill')).toBe(1); expect(dbOrder(order)).toMatchObject({ status: 'expired', stock_state: 'released' });
  });
  it('recovers payment after a lost creation response even after the local deadline without overselling', async () => {
    const session = await member(), order = await started(session, await product({ productType: 'physical', shippingFee: 0, stock: 1 })); loseCreate = true;
    await payment(session, order); bills.get(dbOrder(order).payssam_bill_id).state = 'F';
    local.sqlite.prepare("UPDATE site_shop_orders SET expires_at='2000-01-01T00:00:00.000Z'").run(); await reconcileSiteShopPayments(env);
    expect(dbOrder(order)).toMatchObject({ status: 'paid', stock_state: 'committed' }); expect(count('/partner/bill/destroy')).toBe(0);
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(0);
  });
  it('allows only whole-bill refunds, reconciles a lost cancellation and keeps history while revoking files', async () => {
    const session = await member(), order = await started(session, await product()); await paid(session, order);
    const body = { amount: 30000, reason: '합성 전체 환불', idempotencyKey: crypto.randomUUID() };
    expect((await send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', admin: true, body: { ...body, amount: 10000 } })).status).toBe(400);
    expect(count('/partner/bill/cancel')).toBe(0); loseCancel = true;
    await send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', admin: true, body }); expect(local.sqlite.prepare('SELECT state FROM site_shop_refunds').get().state).toBe('unknown');
    await send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', admin: true, body });
    expect(count('/partner/bill/cancel')).toBe(1); expect(dbOrder(order)).toMatchObject({ status: 'refunded', refunded_amount: 30000 });
    expect((await send(`/shop-orders/${order.order.id}/download`, { session })).status).toBe(403);
    expect((await (await send('/shop-orders', { session })).json()).orders).toHaveLength(1);
  });
  it('lets an administrator approve a member pending refund while blocking duplicate member requests', async () => {
    const session = await member(), order = await started(session, await product()); await paid(session, order);
    const requested = await send(`/shop-orders/${order.order.id}/refund-request`, { method: 'POST', session, body: { reason: '합성 회원 환불 검토 요청' } });
    expect(requested.status).toBe(201); const refundId = (await requested.json()).refundRequest.id;
    expect((await send(`/shop-orders/${order.order.id}/refund-request`, { method: 'POST', session, body: { reason: '합성 중복 요청' } })).status).toBe(409);
    const memberView = await (await send(`/shop-orders/${order.order.id}`, { session })).json();
    expect(memberView.order.canRefund).toBe(false); expect(memberView.order).not.toHaveProperty('adminRefundAttempt');
    const adminView = await (await send(`/admin/shop-orders/${order.order.id}`, { admin: true })).json();
    expect(adminView.order).toMatchObject({ status: 'paid', canRefund: true, refundedAmount: 0 }); expect(adminView.order).not.toHaveProperty('adminRefundAttempt');
    expect(adminView.order.refunds[0]).toMatchObject({ id: refundId, status: 'pending' });
    const body = { amount: 30000, reason: '합성 담당자 환불 승인', refundId };
    const approved = await send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', admin: true, body }); expect(approved.status).toBe(200);
    expect((await approved.json()).order).toMatchObject({ status: 'refunded', canRefund: false });
    await send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', admin: true, body }); expect(count('/partner/bill/cancel')).toBe(1);
  });
  it('withholds admin refund attempts for uncertain refunds and orders outside verified paid states', async () => {
    const session = await member(), order = await started(session, await product()); await paid(session, order);
    const requested = await (await send(`/shop-orders/${order.order.id}/refund-request`, { method: 'POST', session, body: { reason: '합성 환불 검토 요청' } })).json();
    loseCancel = true; await send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', admin: true,
      body: { amount: 30000, reason: '합성 전체 환불 승인', refundId: requested.refundRequest.id } });
    readFailures.add(dbOrder(order).payssam_bill_id);
    const unknown = await (await send(`/admin/shop-orders/${order.order.id}`, { admin: true })).json();
    expect(unknown.order).toMatchObject({ status: 'paid', canRefund: false }); expect(unknown.order.refunds[0].status).toBe('unknown');
    for (const state of ['approving','unknown']) {
      local.sqlite.prepare('UPDATE site_shop_refunds SET state=?').run(state);
      const listed = await (await send('/admin/shop-orders', { admin: true })).json(); expect(listed.orders[0]).toMatchObject({ canRefund: false });
    }
    local.sqlite.prepare("UPDATE site_shop_refunds SET state='failed'").run();
    local.sqlite.prepare("UPDATE site_shop_orders SET status='pending'").run();
    const ineligible = await (await send('/admin/shop-orders', { admin: true })).json(); expect(ineligible.orders[0]).toMatchObject({ canRefund: false });
    expect(count('/partner/bill/cancel')).toBe(1);
  });
  it('closes the final file permission when a Payssam cancellation starts during R2 retrieval', async () => {
    const session = await member(), order = await started(session, await product()); await paid(session, order);
    let releaseFile, fileStarted, releaseCancel;
    const fileGate = new Promise(resolve => { releaseFile = resolve; }), fileEntered = new Promise(resolve => { fileStarted = resolve; });
    const cancelEntered = new Promise(resolve => { cancelStarted = resolve; }); cancelGate = new Promise(resolve => { releaseCancel = resolve; });
    const cancelledStream = vi.fn(); env.SITE_SHOP_FILES.get = async () => { fileStarted(); await fileGate; return { body: new ReadableStream({ cancel: cancelledStream }) }; };
    const downloading = send(`/shop-orders/${order.order.id}/download`, { session }); await fileEntered;
    const refunding = send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', admin: true,
      body: { amount: 30000, reason: '합성 전체 환불', idempotencyKey: crypto.randomUUID() } }); await cancelEntered;
    releaseFile(); const response = await downloading; releaseCancel(); await refunding;
    expect(response.status).toBe(403); expect(cancelledStream).toHaveBeenCalledOnce(); expect(dbOrder(order).download_count).toBe(0);
  });
  it('never grants fulfillment for wrong amounts, payment codes or account pins', async () => {
    const session = await member(), order = await started(session, await product()); await payment(session, order); const row = dbOrder(order), bill = bills.get(row.payssam_bill_id); bill.state = 'F';
    readOverride = reply(bill, { apprPrice: '1' }); await send(`/shop-orders/${row.id}`, { session }); expect(dbOrder(order).approved_at).toBeNull();
    readOverride = reply(bill, { apprPayType: '9' }); await send(`/shop-orders/${row.id}`, { session }); expect(dbOrder(order).approved_at).toBeNull();
    readOverride = null; env.SITE_PAYSSAM_MERCHANT_CODE = 'different-merchant';
    const result = await (await send(`/shop-orders/${row.id}`, { session })).json(); expect(result.checkout.paymentUrl).toBeNull(); expect(dbOrder(order).approved_at).toBeNull();
  });
  it('preserves provider ownership after a session-secret rotation and normal re-login but blocks a changed PG account', async () => {
    const session = await member(), order = await started(session, await product()); await paid(session, order);
    const accountHash = dbOrder(order).payssam_account_hash;
    env.SITE_SESSION_SECRET = 'rotated-synthetic-site-session-secret-32-characters';
    expect((await send(`/shop-orders/${order.order.id}/download`, { session })).status).toBe(401);
    let response = await send('/session'), guest = { cookie: cookie(response), ...(await response.json()) };
    response = await send('/auth/login', { method: 'POST', session: guest,
      body: { email: session.member.email, password: 'Synthetic-payssam-42' } });
    expect(response.status).toBe(200); const loggedIn = { cookie: cookie(response), ...(await response.json()) };
    expect(loggedIn.member.id).toBe(session.member.id);
    const detail = await send(`/shop-orders/${order.order.id}`, { session: loggedIn }); expect(detail.status).toBe(200);
    expect((await detail.json()).order.status).toBe('paid');
    const file = await send(`/shop-orders/${order.order.id}/download`, { session: loggedIn }); expect(file.status).toBe(200);
    expect(await file.text()).toBe('%PDF-private-synthetic'); expect(dbOrder(order).payssam_account_hash).toBe(accountHash);
    const queries = count('/partner/bill/read'); env.SITE_PAYSSAM_MERCHANT_CODE = 'changed-merchant';
    expect((await send(`/shop-orders/${order.order.id}/download`, { session: loggedIn })).status).toBe(503);
    expect(count('/partner/bill/read')).toBe(queries); expect(dbOrder(order).payssam_account_hash).toBe(accountHash);
  });
  it('observes an external manager cancellation on download or callback without granting from callback fields', async () => {
    const session = await member(), order = await started(session, await product()); await paid(session, order);
    bills.get(dbOrder(order).payssam_bill_id).state = 'C';
    expect((await send(`/shop-orders/${order.order.id}/download`, { session })).status).toBe(403);
    expect(dbOrder(order)).toMatchObject({ status: 'refunded', refunded_amount: 30000 });
    const other = await started(session, await product({ slug: 'second-pdf' })); await paid(session, other);
    bills.get(dbOrder(other).payssam_bill_id).state = 'C';
    expect((await callback(other, { apprState: 'C', apprPrice: '1' })).status).toBe(200);
    expect(dbOrder(other)).toMatchObject({ status: 'refunded', refunded_amount: 30000 });
  });
  it('blocks legacy invalid snapshot input before dispatch without leaving reserved stock in creation uncertainty', async () => {
    const session = await member(), order = await started(session, await product({ productType: 'physical', shippingFee: 0, stock: 1 }));
    const snapshot = JSON.parse(dbOrder(order).snapshot); snapshot.customerName = '이름\u0000변조';
    local.sqlite.prepare('UPDATE site_shop_orders SET snapshot=? WHERE id=?').run(JSON.stringify(snapshot), order.order.id);
    const response = await (await payment(session, order)).json(); expect(response.order.status).toBe('failed');
    expect(dbOrder(order)).toMatchObject({ payssam_bill_state: 'failed', stock_state: 'released' });
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(1); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['read_failure', 'account_mismatch'])('rotates ten persistent %s attempts so the eleventh unresolved order is reconciled next', async failure => {
    const session = await member(), selected = await product(), orders = [];
    for (let index = 0; index < 11; index++) {
      const order = await started(session, selected); await payment(session, order); orders.push(order);
    }
    const financial = id => local.sqlite.prepare('SELECT amount,approved_at,refunded_amount,status,last_evidence_hash FROM site_shop_orders WHERE id=?').get(id);
    const before = orders.slice(0, 10).map(order => financial(order.order.id));
    for (const order of orders.slice(0, 10)) {
      local.sqlite.prepare("UPDATE site_shop_orders SET updated_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(order.order.id);
      if (failure === 'read_failure') readFailures.add(dbOrder(order).payssam_bill_id);
      else local.sqlite.prepare("UPDATE site_shop_orders SET payssam_account_hash='old-account' WHERE id=?").run(order.order.id);
    }
    const last = orders[10];
    local.sqlite.prepare("UPDATE site_shop_orders SET updated_at='2001-01-01T00:00:00.000Z' WHERE id=?").run(last.order.id);
    bills.get(dbOrder(last).payssam_bill_id).state = 'F';
    await reconcileSiteShopPayments(env);
    expect(dbOrder(last).status).toBe('pending');
    for (const [index, order] of orders.slice(0, 10).entries()) {
      expect(dbOrder(order).updated_at > '2001-01-01T00:00:00.000Z').toBe(true);
      expect(financial(order.order.id)).toEqual(before[index]);
    }
    await reconcileSiteShopPayments(env);
    expect(dbOrder(last)).toMatchObject({ status: 'paid', refunded_amount: 0 });
    expect(count('/partner/bill')).toBe(11); expect(count('/partner/bill/cancel')).toBe(0);
  });
  it('archives a product without deleting its paid order or original private download', async () => {
    const session = await member(), selected = await product(), order = await started(session, selected); await paid(session, order);
    expect((await send(`/admin/products/${selected.slug}`, { method: 'DELETE', session, body: { version: selected.version } })).status).toBe(401);
    const archived = await send(`/admin/products/${selected.slug}`, { method: 'DELETE', admin: true, body: { version: selected.version } }); expect(archived.status).toBe(200);
    expect((await archived.json()).product).toMatchObject({ status: 'archived', active: false });
    expect((await send(`/products/${selected.slug}`)).status).toBe(404);
    expect((await send('/shop-orders', { method: 'POST', session, body: inputFor(selected) })).status).toBe(404);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS total FROM site_shop_orders').get().total).toBe(1);
    expect((await send(`/shop-orders/${order.order.id}/download`, { session })).status).toBe(200);
    expect(files.has('shop/synthetic.pdf')).toBe(true);
  });
  it('version-checks stock edits against reservations and accepts bounded Unicode product policies', async () => {
    const session = await member(), selected = await product({ productType: 'physical', shippingFee: 0, stock: 2 }); await started(session, selected);
    expect((await send(`/admin/products/${selected.slug}`, { method: 'PUT', admin: true, body: { ...selected.input, version: selected.version, stock: 2 } })).status).toBe(409);
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(1);
    const current = await (await send(`/admin/products/${selected.slug}`, { admin: true })).json();
    const body = { ...selected.input, stock: 1, version: current.product.version, description: '설명'.repeat(2000), refundPolicy: '환불'.repeat(1000), deliveryPolicy: '배송'.repeat(1000) };
    expect(JSON.stringify(body).length).toBeGreaterThan(8000);
    expect((await send(`/admin/products/${selected.slug}`, { method: 'PUT', admin: true, body })).status).toBe(200);
  });
  it('uploads versioned private PDF/ZIP files only to a draft and preserves old purchase snapshots', async () => {
    const session = await member(), selected = await product(), order = await started(session, selected); await paid(session, order);
    const file = new File(['%PDF-1.7 replacement'], '새 자료.pdf', { type: 'application/pdf' });
    expect((await uploadFile(selected.slug, selected.version, file)).status).toBe(409);
    expect((await uploadFile(selected.slug, selected.version, file, false)).status).toBe(401);
    const draft = await (await send(`/admin/products/${selected.slug}`, { method: 'PUT', admin: true, body: { ...selected.input, active: false, version: selected.version } })).json();
    const uploaded = await uploadFile(selected.slug, draft.product.version, file); expect(uploaded.status).toBe(200);
    const updated = (await uploaded.json()).product; expect(updated.fileKey).toMatch(/^shop\/synthetic-pdf\/v3-[a-f0-9-]+\.pdf$/); expect(updated.fileContentType).toBe('application/pdf');
    expect(updated.fileKey).not.toBe('shop/synthetic.pdf'); expect(files.has('shop/synthetic.pdf')).toBe(true);
    const response = await send(`/shop-orders/${order.order.id}/download`, { session }); expect(await response.text()).toBe('%PDF-private-synthetic'); expect(fileReads.at(-1)).toBe('shop/synthetic.pdf');
    const zip = new File([new Uint8Array([0x50,0x4b,5,6,0,0])], '자료.zip', { type: 'application/zip' });
    const zipResult = await uploadFile(selected.slug, updated.version, zip); expect(zipResult.status).toBe(200); expect((await zipResult.json()).product.fileContentType).toBe('application/zip');
    expect(files.has(updated.fileKey)).toBe(true);
  });
  it('rejects disguised or oversized files and loses a concurrent upload CAS without deleting any old asset', async () => {
    const selected = await product({ active: false });
    expect((await uploadFile(selected.slug, selected.version, new File(['<html>fake</html>'], 'fake.pdf', { type: 'application/pdf' }))).status).toBe(400);
    const oversized = new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'large.pdf', { type: 'application/pdf' });
    expect((await uploadFile(selected.slug, selected.version, oversized)).status).toBe(400);
    let uploadEntered, releaseUpload; const entered = new Promise(resolve => { uploadEntered = resolve; }), hold = new Promise(resolve => { releaseUpload = resolve; });
    const originalPut = env.SITE_SHOP_FILES.put; env.SITE_SHOP_FILES.put = async (key, value, options) => { await originalPut(key, value, options); uploadEntered(); await hold; };
    const uploading = uploadFile(selected.slug, selected.version, new File(['%PDF-1.7 new'], 'replacement.pdf', { type: 'application/pdf' })); await entered;
    await send(`/admin/products/${selected.slug}`, { method: 'PUT', admin: true, body: { ...selected.input, version: selected.version, description: '다른 편집' } });
    releaseUpload(); expect((await uploading).status).toBe(409); expect(files.size).toBe(1); expect(files.has('shop/synthetic.pdf')).toBe(true);
    expect(local.sqlite.prepare('SELECT file_key FROM site_shop_products').get().file_key).toBe('shop/synthetic.pdf');
    expect(local.sqlite.prepare("SELECT COUNT(*) AS total FROM site_admin_audit WHERE action='product.file' AND outcome='conflict'").get().total).toBe(1);
  });
  it('paginates more than 100 products and orders with global refund, search and member ownership filters', async () => {
    const session = await member(), other = await member('admin-pagination-other@fixture.invalid'), selected = await product(), template = await started(session, selected);
    const row = dbOrder(template), at = '2026-01-01T00:00:00.000Z';
    for (let index = 0; index < 105; index++) {
      const id = crypto.randomUUID(), memberId = index === 104 ? other.member.id : session.member.id;
      local.sqlite.prepare(`INSERT INTO site_shop_orders(id,member_id,product_slug,product_type,idempotency_hash,payload_hash,snapshot,amount,shipping_fee,
        pg_order_id,pg_environment,pg_client_id,callback_nonce,approval_key,stock_state,shipping_status,expires_at,created_at,updated_at)
        VALUES(?,?,?,'digital',?,?,?,30000,0,?,'test','',?,?,'none','not_applicable',?,?,?)`).run(id, memberId, selected.slug,
          crypto.randomUUID(), crypto.randomUUID(), row.snapshot, `shop_${id.replace(/-/g,'')}`, crypto.randomUUID(), crypto.randomUUID(), row.expires_at, at, at);
      if (index === 103) local.sqlite.prepare(`INSERT INTO site_shop_refunds(id,order_id,reason,requested_amount,cancel_order_id,created_at,updated_at)
        VALUES(?,?,?,30000,?,?,?)`).run(crypto.randomUUID(), id, '합성 검토 요청', `refund_${crypto.randomUUID().replace(/-/g,'')}`, at, at);
      local.sqlite.prepare(`INSERT INTO site_shop_products(slug,name,product_type,price,created_at,updated_at) VALUES(?,?,'physical',30000,?,?)`)
        .run(`stock-${String(index).padStart(3,'0')}`, '합성 추가 상품', at, at);
    }
    const products = await (await send('/admin/products?limit=100', { admin: true })).json(); expect(products.products).toHaveLength(100); expect(products.nextCursor).toBeTruthy();
    expect((await (await send(`/admin/products?limit=100&cursor=${products.nextCursor}`, { admin: true })).json()).products).toHaveLength(6);
    const first = await (await send('/admin/shop-orders?limit=100', { admin: true })).json(); expect(first.orders).toHaveLength(100); expect(first.nextCursor).toBeTruthy();
    const second = await (await send(`/admin/shop-orders?limit=100&cursor=${first.nextCursor}`, { admin: true })).json(); expect(second.orders).toHaveLength(6);
    const refunds = await (await send('/admin/shop-orders?refundStatus=pending&hasRefund=true', { admin: true })).json(); expect(refunds.orders).toHaveLength(1);
    const searched = await (await send(`/admin/shop-orders?q=${encodeURIComponent(other.member.email)}`, { admin: true })).json(); expect(searched.orders).toHaveLength(1);
    const mine = await (await send('/shop-orders?limit=100', { session })).json(); expect(mine.orders).toHaveLength(100);
    expect((await send(`/shop-orders/${searched.orders[0].id}`, { session })).status).toBe(404);
    expect((await send(`/admin/shop-orders?status=paid&limit=100&cursor=${first.nextCursor}`, { admin: true })).status).toBe(400);
  });
  it('refreshes admin order evidence and records safe shipment/refund audit with conflict prevention', async () => {
    const session = await member(), selected = await product({ productType: 'physical', shippingFee: 0, stock: 1 }), order = await started(session, selected);
    await payment(session, order); bills.get(dbOrder(order).payssam_bill_id).state = 'F';
    const response = await (await send(`/admin/shop-orders/${order.order.id}`, { admin: true })).json(); expect(response.order.status).toBe('paid'); expect(response.reconciliationStatus).toBe('confirmed');
    const shipment = { status: 'shipped', carrier: '합성 택배', trackingNumber: 'SYNTHETIC-TRACK', version: response.order.version };
    expect((await send(`/admin/shop-orders/${order.order.id}/shipment`, { method: 'PUT', admin: true, body: shipment })).status).toBe(200);
    expect((await send(`/admin/shop-orders/${order.order.id}/shipment`, { method: 'PUT', admin: true, body: { ...shipment, trackingNumber: 'OTHER' } })).status).toBe(409);
    await send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', admin: true, body: { amount: 30000, reason: '합성 환불 승인', idempotencyKey: crypto.randomUUID() } });
    const events = local.sqlite.prepare('SELECT actor,action,target,outcome,created_at FROM site_admin_audit').all();
    expect(events.some(event => event.action === 'order.shipment' && event.outcome === 'success')).toBe(true); expect(events.some(event => event.action === 'order.refund')).toBe(true);
    const text = JSON.stringify(events); expect(text).not.toContain('010-'); expect(text).not.toContain('검수로'); expect(text).not.toContain('SYNTHETIC-TRACK'); expect(text).not.toContain(env.SITE_PAYSSAM_API_KEY);
    expect(events.every(event => event.actor === 'teacher')).toBe(true);
    expect((await send(`/admin/shop-orders/${order.order.id}`, { method: 'DELETE', admin: true })).status).toBe(405); expect(dbOrder(order)).toBeTruthy();
  });
  it('returns only readiness booleans and mode to authenticated administrators', async () => {
    expect((await send('/admin/shop-settings')).status).toBe(401);
    const settings = await (await send('/admin/shop-settings', { admin: true })).json();
    expect(Object.keys(settings).sort()).toEqual(['commerceReady','filesReady','legacyNicepayReady','mode','payssamReady','salesMode','status']); expect(settings.filesReady).toBe(true); expect(settings.salesMode).toBe('direct');
    const text = JSON.stringify(settings); expect(text).not.toContain(env.SITE_PAYSSAM_API_KEY); expect(text).not.toContain(env.SITE_PAYSSAM_MERCHANT_CODE); expect(text).not.toContain(API);
  });
  it('publishes a Smartstore introduction with only D1 and no payment policies, inventory, files or secrets', async () => {
    delete env.SITE_SHOP_SALES_MODE; delete env.SITE_SHOP_FILES; delete env.SITE_PAYSSAM_API_KEY;
    const body = { slug: 'store-book', name: '스마트스토어 소개 교재', productType: 'physical', price: 39000, status: 'active',
      smartstoreUrl: 'https://smartstore.naver.com/hanul-books/products/12345?NaPm=tracking#details' };
    const saved = await send('/admin/products', { method: 'POST', admin: true, body }); expect(saved.status).toBe(201);
    expect((await saved.json()).product).toMatchObject({ active: true, status: 'active', purchaseChannel: 'smartstore', stock: null, shippingFee: null });
    const onlyD1 = { GAME_DB: local.db };
    const response = await handleSiteShopRoutes(new Request(`${ORIGIN}/api/site/products`), onlyD1, {}); expect(response.status).toBe(200);
    const listed = await response.json(); expect(listed).toMatchObject({ purchaseChannel: 'smartstore', purchaseReady: false });
    expect(listed.products[0]).toMatchObject({ available: true, smartstoreUrl: 'https://smartstore.naver.com/hanul-books/products/12345', purchaseChannel: 'smartstore' });
    expect(listed.products[0]).not.toHaveProperty('fileKey'); expect(listed.products[0]).not.toHaveProperty('stock');
    const detail = await handleSiteShopRoutes(new Request(`${ORIGIN}/api/site/products/store-book`), onlyD1, {}); expect(detail.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled(); expect(local.sqlite.prepare('SELECT active,smartstore_active FROM site_shop_products').get()).toMatchObject({ active: 0, smartstore_active: 1 });
  });
  it('allows a digital introduction without R2 but rejects digital Smartstore purchase links', async () => {
    env.SITE_SHOP_SALES_MODE = 'smartstore'; delete env.SITE_SHOP_FILES;
    const body = { slug: 'preparing-pdf', name: '준비 중인 PDF', productType: 'digital', price: 9900, status: 'active', smartstoreUrl: null };
    const response = await send('/admin/products', { method: 'POST', admin: true, body }); expect(response.status).toBe(201);
    expect((await (await send('/products/preparing-pdf')).json()).product).toMatchObject({ available: false, smartstoreUrl: null, purchaseChannel: 'smartstore' });
    expect((await send('/admin/products', { method: 'POST', admin: true,
      body: { ...body, slug: 'unsafe-digital', smartstoreUrl: 'https://smartstore.naver.com/store/products/123' } })).status).toBe(400);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS total FROM site_shop_products').get().total).toBe(1); expect(fetch).not.toHaveBeenCalled();
  });
  it('uses consistent active filters, preserves version conflicts and clears an inherited link on digital type change', async () => {
    env.SITE_SHOP_SALES_MODE = 'smartstore';
    const input = { slug: 'intro-version', name: '소개 상품', productType: 'physical', price: 1000, status: 'active',
      smartstoreUrl: 'https://m.smartstore.naver.com/store/products/99?track=1' };
    const created = await (await send('/admin/products', { method: 'POST', admin: true, body: input })).json();
    expect((await (await send('/admin/products?status=active', { admin: true })).json()).products).toHaveLength(1);
    expect((await (await send('/admin/products?status=draft', { admin: true })).json()).products).toHaveLength(0);
    const updates = await Promise.all([send('/admin/products/intro-version', { method: 'PUT', admin: true, body: { ...input, version: created.product.version, name: '첫 수정' } }),
      send('/admin/products/intro-version', { method: 'PUT', admin: true, body: { ...input, version: created.product.version, name: '다른 수정' } })]);
    expect(updates.map(response => response.status).sort()).toEqual([200,409]);
    const current = await (await send('/admin/products/intro-version', { admin: true })).json();
    const changed = await send('/admin/products/intro-version', { method: 'PUT', admin: true,
      body: { slug: input.slug, name: input.name, productType: 'digital', price: 1000, status: 'active', version: current.product.version } });
    expect(changed.status).toBe(200); expect((await changed.json()).product.smartstoreUrl).toBeNull();
    expect(local.sqlite.prepare('SELECT smartstore_url FROM site_shop_products').get().smartstore_url).toBeNull();
  });
  it('blocks new internal orders and invoice creation before any PG call even with only a catalog database', async () => {
    const onlyD1 = { GAME_DB: local.db }, id = crypto.randomUUID();
    for (const path of ['/shop-orders', `/shop-orders/${id}/payment`]) {
      const response = await handleSiteShopRoutes(new Request(`${ORIGIN}/api/site${path}`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: '{}' }), onlyD1, {});
      expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'external_shop_checkout' });
    }
    expect(local.sqlite.prepare('SELECT COUNT(*) AS total FROM site_shop_orders').get().total).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps past paid orders, private downloads and refund approval after switching sales to Smartstore', async () => {
    const session = await member(), selected = await product(), order = await started(session, selected); await paid(session, order);
    env.SITE_SHOP_SALES_MODE = 'smartstore';
    const view = await (await send(`/shop-orders/${order.order.id}`, { session })).json();
    expect(view.order).toMatchObject({ status: 'paid', canResume: false, canDownload: true });
    expect(view.checkout).toEqual({ provider: 'payssam', status: 'unavailable', paymentUrl: null, paymentOrigin: null });
    const before = calls.length;
    expect((await send('/shop-orders', { method: 'POST', session, body: order.input })).status).toBe(409);
    expect((await payment(session, order)).status).toBe(409); expect(calls).toHaveLength(before);
    expect((await send(`/shop-orders/${order.order.id}/download`, { session })).status).toBe(200);
    const requested = await (await send(`/shop-orders/${order.order.id}/refund-request`, { method: 'POST', session, body: { reason: '합성 기존 구매 환불 요청' } })).json();
    const result = await send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', admin: true,
      body: { amount: 30000, reason: '합성 기존 구매 환불 승인', refundId: requested.refundRequest.id } });
    expect(result.status).toBe(200); expect((await result.json()).order.status).toBe('refunded');
    expect((await send(`/shop-orders/${order.order.id}/download`, { session })).status).toBe(403); expect(count('/partner/bill')).toBe(1);
  });
  it('inherits legacy active introductions and never releases an unknown payable bill merely on sales-mode change', async () => {
    const session = await member(), selected = await product({ productType: 'physical', stock: 1, shippingFee: 0 }), order = await started(session, selected);
    loseCreate = true; await payment(session, order); env.SITE_SHOP_SALES_MODE = 'smartstore';
    const products = await (await send('/products')).json(); expect(products.products).toHaveLength(1); expect(products.products[0]).toMatchObject({ purchaseChannel: 'smartstore', available: false });
    expect(local.sqlite.prepare('SELECT smartstore_active FROM site_shop_products').get().smartstore_active).toBeNull();
    await reconcileSiteShopPayments(env); expect(dbOrder(order)).toMatchObject({ status: 'pending', stock_state: 'reserved' }); expect(count('/partner/bill/destroy')).toBe(0);
    const settings = await (await send('/admin/shop-settings', { admin: true })).json(); expect(settings.salesMode).toBe('smartstore');
  });
  it('reads direct-mode product introductions with only D1 while checkout readiness stays false', async () => {
    const selected = await product();
    const onlyD1 = { GAME_DB: local.db, SITE_SHOP_SALES_MODE: 'direct' };
    const listed = await handleSiteShopRoutes(new Request(`${ORIGIN}/api/site/products`), onlyD1, {}); expect(listed.status).toBe(200);
    const data = await listed.json(); expect(data).toMatchObject({ purchaseChannel: 'direct', purchaseReady: false });
    expect(data.products[0]).toMatchObject({ id: selected.id, available: false, purchaseChannel: 'direct' });
    const detail = await handleSiteShopRoutes(new Request(`${ORIGIN}/api/site/products/${selected.id}`), onlyD1, {}); expect(detail.status).toBe(200);
    expect((await detail.json()).purchaseReady).toBe(false); expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps a previous introduction readable but requires an explicit validated direct activation', async () => {
    env.SITE_SHOP_SALES_MODE = 'smartstore';
    const intro = { slug: 'migrated-intro', name: '기존 상품 소개', price: 30000, productType: 'physical', status: 'active', smartstoreUrl: null };
    const saved = await (await send('/admin/products', { method: 'POST', admin: true, body: intro })).json();
    env.SITE_SHOP_SALES_MODE = 'direct'; const session = await member();
    const read = await (await send(`/products/${intro.slug}`)).json(); expect(read.product).toMatchObject({ available: false, purchaseChannel: 'direct', purchaseStatus: 'preparing', shippingFee: null });
    expect((await (await send('/admin/products?status=active', { admin: true })).json()).products).toHaveLength(0);
    const adminDrafts = await (await send('/admin/products?status=draft', { admin: true })).json(); expect(adminDrafts.products).toHaveLength(1);
    expect(adminDrafts.products[0]).toMatchObject({ active: false, status: 'draft' });
    expect((await send('/shop-orders', { method: 'POST', session, body: inputFor({ id: intro.slug, productType: 'physical', termsVersion: 'v1' }) })).status).toBe(404);
    expect((await send(`/admin/products/${intro.slug}`, { method: 'PUT', admin: true, body: { ...intro, version: saved.product.version } })).status).toBe(400);
    const publish = { ...intro, version: saved.product.version, shippingFee: 0, stock: 2, termsVersion: 'v1',
      refundPolicy: '합성 환불 검토 정책', deliveryPolicy: '합성 배송 안내 정책' };
    const activated = await send(`/admin/products/${intro.slug}`, { method: 'PUT', admin: true, body: publish }); expect(activated.status).toBe(200);
    const active = (await activated.json()).product; expect(active).toMatchObject({ active: true, available: true });
    expect(local.sqlite.prepare('SELECT active,smartstore_active FROM site_shop_products').get()).toMatchObject({ active: 1, smartstore_active: null });
    const draft = await send(`/admin/products/${intro.slug}`, { method: 'PUT', admin: true, body: { ...publish, status: 'draft', version: active.version } }); expect(draft.status).toBe(200);
    expect((await send(`/products/${intro.slug}`)).status).toBe(404);
    expect((await (await send('/admin/products?status=draft', { admin: true })).json()).products).toHaveLength(1);
  });
  it('returns the same new order after session-secret rotation and normal re-login with the same submission key', async () => {
    const session = await member(), selected = await product({ productType: 'physical', shippingFee: 0, stock: 2 }), order = await started(session, selected);
    env.SITE_SESSION_SECRET = 'rotated-synthetic-order-session-secret-32-characters';
    let response = await send('/session'), guest = { cookie: cookie(response), ...(await response.json()) };
    response = await send('/auth/login', { method: 'POST', session: guest, body: { email: session.member.email, password: 'Synthetic-payssam-42' } });
    expect(response.status).toBe(200); const loggedIn = { cookie: cookie(response), ...(await response.json()) };
    const repeated = await send('/shop-orders', { method: 'POST', session: loggedIn, body: order.input }); expect(repeated.status).toBe(200);
    expect((await repeated.json()).order.id).toBe(order.order.id); expect(local.sqlite.prepare('SELECT COUNT(*) AS total FROM site_shop_orders').get().total).toBe(1);
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(1); expect(fetch).not.toHaveBeenCalled();
    expect((await send('/shop-orders', { method: 'POST', session: loggedIn, body: { ...order.input, customerName: '다른 입력' } })).status).toBe(409);
  });
  it('recognizes local legacy HMAC submissions while their original session secret is unchanged', async () => {
    const session = await member(), selected = await product(), order = await started(session, selected);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SITE_SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const oldHash = async (label, value) => Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key,
      new TextEncoder().encode(`site-shop/v1/${label}/${value}`))), byte => byte.toString(16).padStart(2,'0')).join('');
    const normalized = { ...order.input, customerPhone: order.input.customerPhone.replace(/[\s()-]/g,'') };
    local.sqlite.prepare('UPDATE site_shop_orders SET idempotency_hash=?,payload_hash=? WHERE id=?')
      .run(await oldHash('order-key', `${session.member.id}:${order.input.idempotencyKey}`), await oldHash('order-payload', JSON.stringify(normalized)), order.order.id);
    const response = await send('/shop-orders', { method: 'POST', session, body: { ...order.input, quantity: 1 } }); expect(response.status).toBe(200); expect((await response.json()).order.id).toBe(order.order.id);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS total FROM site_shop_orders').get().total).toBe(1); expect(fetch).not.toHaveBeenCalled();
  });
  it('distinguishes prepared inventory from a missing PG configuration without exposing its stock count', async () => {
    const selected = await product({ productType: 'physical', stock: 2, shippingFee: 3000 }); delete env.SITE_PAYSSAM_API_KEY;
    const response = await send(`/products/${selected.slug}`); expect(response.status).toBe(200);
    const data = await response.json(); expect(data.purchaseReady).toBe(false);
    expect(data.product).toMatchObject({ available: false, purchaseStatus: 'ready', shippingFee: 3000 }); expect(data.product).not.toHaveProperty('stock'); expect(fetch).not.toHaveBeenCalled();
  });
  it('reports sold_out only for an otherwise eligible physical item with zero inventory', async () => {
    const sold = await product({ slug: 'empty-stock', productType: 'physical', stock: 0, shippingFee: 0 });
    const soldView = await (await send(`/products/${sold.slug}`)).json(); expect(soldView.product).toMatchObject({ available: false, purchaseStatus: 'sold_out' });
    env.SITE_SHOP_SALES_MODE = 'smartstore';
    const intro = { slug: 'unfinished-empty', name: '준비 중인 소개', productType: 'physical', price: 30000, status: 'active', stock: 0 };
    expect((await send('/admin/products', { method: 'POST', admin: true, body: intro })).status).toBe(201); env.SITE_SHOP_SALES_MODE = 'direct';
    const preparingView = await (await send(`/products/${intro.slug}`)).json(); expect(preparingView.product).toMatchObject({ available: false, purchaseStatus: 'preparing', shippingFee: null });
    expect(preparingView.product).not.toHaveProperty('stock');
  });
  it('marks digital storage as preparing independently of the global PG readiness', async () => {
    const selected = await product(); delete env.SITE_SHOP_FILES;
    const response = await (await send(`/products/${selected.slug}`)).json(); expect(response.purchaseReady).toBe(true);
    expect(response.product).toMatchObject({ available: false, purchaseStatus: 'preparing' }); expect(response.product).not.toHaveProperty('fileKey');
  });
  it.each(['direct','smartstore'])('hides an archived legacy workbook announcement without exposing private product IDs in %s mode', async mode => {
    env.SITE_SHOP_SALES_MODE = mode;
    const curatedId = 'pronunciation-workbook', privateId = 'private-hidden-product';
    const absent = await send(`/products/${curatedId}`); expect(absent.status).toBe(404); expect(await absent.json()).not.toHaveProperty('code');
    expect((await (await send('/products')).json()).suppressedCuratedProducts).toEqual([]);
    const draft = await product({ slug:curatedId,name:'공개 출간 준비 교재의 합성 초안',active:false,status:'draft' });
    const draftDetail = await send(`/products/${curatedId}`); expect(draftDetail.status).toBe(404); expect(await draftDetail.json()).not.toHaveProperty('code');
    expect((await (await send('/products')).json()).suppressedCuratedProducts).toEqual([]);
    const published = await send(`/admin/products/${curatedId}`,{method:'PUT',admin:true,body:{...draft.input,active:true,status:'active',version:draft.version}});
    expect(published.status).toBe(200); const current = (await published.json()).product;
    const publicDetail = await send(`/products/${curatedId}`); expect(publicDetail.status).toBe(200);
    expect((await publicDetail.json()).product.name).toBe(draft.name);
    const privateDraft = await product({ slug:privateId,name:'비공개 교재 내부 이름',active:false,status:'draft' });
    expect((await send(`/admin/products/${privateId}`,{method:'DELETE',admin:true,body:{version:privateDraft.version}})).status).toBe(200);
    expect((await send(`/admin/products/${curatedId}`,{method:'DELETE',admin:true,body:{version:current.version}})).status).toBe(200);
    const hidden = await send(`/products/${curatedId}`); expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual({error:'공개된 상품을 찾을 수 없습니다.',code:'curated_product_hidden'});
    const privateDetail = await send(`/products/${privateId}`); expect(privateDetail.status).toBe(404);
    expect(await privateDetail.json()).toEqual({error:'공개된 상품을 찾을 수 없습니다.'});
    for (const path of ['/products','/products?limit=1&productType=physical&q=unrelated']) {
      const listed = await (await send(path)).json(); expect(listed.suppressedCuratedProducts).toEqual([curatedId]);
      expect(listed.products).toEqual([]); expect(JSON.stringify(listed)).not.toContain(privateId); expect(JSON.stringify(listed)).not.toContain(privateDraft.name);
    }
    const thumbnail = await send(`/products/${curatedId}/thumbnail`); expect(thumbnail.status).toBe(404); expect(await thumbnail.json()).not.toHaveProperty('code');
    const adminList = await (await send('/admin/products?status=archived',{admin:true})).json();
    expect(adminList.products.map(item=>item.id).sort()).toEqual([curatedId,privateId].sort()); expect(adminList).not.toHaveProperty('suppressedCuratedProducts');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('supplements a publicly visible old digital introduction as a private direct draft before explicit publication', async () => {
    env.SITE_SHOP_SALES_MODE = 'smartstore';
    const intro = { slug: 'old-digital-intro', name: '소개 중인 PDF', price: 30000, productType: 'digital', status: 'active', smartstoreUrl: null };
    const registered = await (await send('/admin/products', { method: 'POST', admin: true, body: intro })).json(); env.SITE_SHOP_SALES_MODE = 'direct';
    const draft = await (await send(`/admin/products/${intro.slug}`, { admin: true })).json(); expect(draft.product).toMatchObject({ active: false, status: 'draft' });
    const uploaded = await uploadFile(intro.slug, registered.product.version, new File(['%PDF-1.7 private supplement'], '보강 자료.pdf', { type: 'application/pdf' }));
    expect(uploaded.status).toBe(200); const updated = (await uploaded.json()).product; expect(updated).toMatchObject({ active: false, status: 'draft' });
    const publicView = await (await send(`/products/${intro.slug}`)).json(); expect(publicView.product).toMatchObject({ available: false, purchaseStatus: 'preparing' }); expect(publicView.product).not.toHaveProperty('fileKey');
    expect(files.has(updated.fileKey)).toBe(true);
    const published = await send(`/admin/products/${intro.slug}`, { method: 'PUT', admin: true, body: { ...intro, version: updated.version,
      fileKey: updated.fileKey, fileName: updated.fileName, fileContentType: updated.fileContentType,
      termsVersion: 'v1', refundPolicy: '합성 환불 검토 정책', deliveryPolicy: '합성 파일 제공 안내' } });
    expect(published.status).toBe(200); expect((await published.json()).product).toMatchObject({ active: true, status: 'active' });
    expect((await (await send(`/products/${intro.slug}`)).json()).product).toMatchObject({ available: true, purchaseStatus: 'ready' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
