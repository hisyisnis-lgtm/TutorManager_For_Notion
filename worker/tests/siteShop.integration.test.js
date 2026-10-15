import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { siteD1 } from './helpers/siteD1.js';
import { handleSiteAuthRoutes } from '../lib/siteAuth.js';
import { handleSiteShopRoutes, reconcileSiteShopPayments } from '../lib/siteShop.js';

// The adapter has its own signature/HTTP tests. These fixtures exercise the shop's
// persistent state transitions without credentials or requests to a real PG.
const pg = vi.hoisted(() => ({ payments: new Map(), calls: [], loseApprove: false, loseCancel: false, unavailable: false, override: null,
  cancelGate: null, cancelStarted: null, cancelReject: false, postCancelQueryFailure: false, lookupGate: null, lookupStarted: null,
  NicepayError: class extends Error { constructor(code, { definitive = false } = {}) { super(code); this.definitive = definitive; } } }));
vi.mock('../lib/siteNicepay.js', () => ({
  NicepayError: pg.NicepayError,
  nicepayReady: env => ['test', 'live'].includes(env.SITE_NICEPAY_MODE) && !!env.SITE_NICEPAY_CLIENT_ID && !!env.SITE_NICEPAY_SECRET_KEY,
  nicepayCheckout: (env, fields) => ({ clientId: env.SITE_NICEPAY_CLIENT_ID, method: 'card', ...fields, sdkUrl: 'https://pay.nicepay.co.kr/v1/js/' }),
  verifyNicepayAuth: async (env, fields, expected) => {
    if (fields.signature !== 'synthetic-verified-signature' || fields.clientId !== env.SITE_NICEPAY_CLIENT_ID
      || fields.orderId !== expected.orderId || Number(fields.amount) !== expected.amount || fields.mallReserved !== expected.mallReserved) throw new Error('auth_mismatch');
    return { tid: fields.tid, orderId: fields.orderId, amount: Number(fields.amount), mallReserved: fields.mallReserved };
  },
  approveNicepay: async (env, tid, amount) => {
    pg.calls.push({ action: 'approve', tid, amount });
    const previous = pg.payments.get(tid);
    if (!previous || previous.status !== 'pending') throw new Error('already_handled');
    const proof = { ...previous, status: 'paid', approvedAt: '2026-10-11T01:00:00.000Z' };
    pg.payments.set(tid, proof);
    if (pg.loseApprove) throw new Error('approval_response_lost');
    return proof;
  },
  getNicepayPayment: async (env, tid) => {
    pg.calls.push({ action: 'get', tid });
    pg.lookupStarted?.();
    if (pg.lookupGate) await pg.lookupGate;
    if (pg.postCancelQueryFailure && pg.calls.some(call => call.action === 'cancel')) throw new pg.NicepayError('query_rejected_after_cancellation', { definitive: true });
    if (pg.unavailable) throw new Error('query_temporarily_unavailable');
    const value = pg.override || pg.payments.get(tid); if (!value) throw new Error('not_found'); return value;
  },
  cancelNicepay: async (env, tid, fields) => {
    pg.calls.push({ action: 'cancel', tid, ...fields });
    pg.cancelStarted?.();
    if (pg.cancelGate) await pg.cancelGate;
    if (pg.cancelReject) throw new pg.NicepayError('definitive_cancel_rejection', { definitive: true });
    const previous = pg.payments.get(tid), refundedAmount = previous.refundedAmount + fields.amount;
    if (refundedAmount > previous.amount) throw new Error('cancel_over_balance');
    pg.payments.set(tid, { ...previous, refundedAmount, status: refundedAmount === previous.amount ? 'refunded' : 'partially_refunded',
      cancellations: [...previous.cancellations, { tid: fields.orderId, amount: fields.amount, cancelledAt: '2026-10-11T02:00:00.000Z' }] });
    if (pg.loseCancel) throw new Error('cancel_response_lost'); return { ok: true };
  },
  verifyNicepayPayment: async (env, value, expected) => {
    if (value.orderId !== expected.orderId || value.amount !== expected.amount || value.mode !== expected.mode
      || value.currency !== 'KRW' || (expected.tid && value.tid !== expected.tid) || !Number.isInteger(value.refundedAmount)
      || value.refundedAmount < 0 || value.refundedAmount > value.amount) throw new Error('payment_evidence_mismatch');
    return value;
  },
}));

const ORIGIN = 'http://localhost:4325';
const cookie = response => response.headers.get('Set-Cookie')?.split(';')[0];
let local, env, mail, files;
const teacherAuthorization = async request => request.headers.get('Authorization') === 'Bearer synthetic-teacher'
  ? null : Response.json({ error: 'teacher_required' }, { status: 401 });
async function send(path, { method = 'GET', body, session, admin = false, headers = {} } = {}) {
  const request = new Request(`${ORIGIN}/api/site${path}`, { method,
    headers: { Origin: ORIGIN, 'CF-Connecting-IP': '198.51.100.29', ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(session?.cookie ? { Cookie: session.cookie } : {}), ...(session?.csrfToken ? { 'X-CSRF-Token': session.csrfToken } : {}),
      ...(admin ? { Authorization: 'Bearer synthetic-teacher' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return await handleSiteShopRoutes(request, env, {}, { authorizeTeacher: teacherAuthorization })
    || await handleSiteAuthRoutes(request, env);
}
async function member(email = 'shop-member@fixture.invalid') {
  let response = await send('/session'), session = { cookie: cookie(response), ...(await response.json()) };
  response = await send('/auth/email/request', { method: 'POST', session, body: { email } }); expect(response.status).toBe(200);
  const requested = await response.json(), code = mail.at(-1).text.match(/\b\d{6}\b/)[0];
  response = await send('/auth/email/verify', { method: 'POST', session, body: { challengeId: requested.challengeId, code } });
  const verified = await response.json();
  response = await send('/auth/signup', { method: 'POST', session, body: { registrationToken: verified.registrationToken,
    password: 'Synthetic-shop-42', passwordConfirm: 'Synthetic-shop-42', name: '합성 구매자', nickname: '구매자', termsAccepted: true, privacyAccepted: true } });
  expect(response.status).toBe(201); return { cookie: cookie(response), ...(await response.json()) };
}
async function product(overrides = {}) {
  const input = { regionalShipping: { jejuExtraFee: 0, remoteExtraFee: 0, remotePostalRanges: [] }, slug: 'synthetic-pdf', name: '합성 PDF 상품', description: '격리 검수 전용', productType: 'digital', price: 12000,
    termsVersion: 'synthetic-v1', refundPolicy: '합성 상품의 환불 요청은 담당자가 구매 및 제공 내역을 확인하고 검토합니다.',
    deliveryPolicy: '결제 완료가 검증된 후 본인 구매내역에서 합성 파일을 내려받을 수 있습니다.',
    fileKey: 'shop/synthetic.pdf', fileName: '합성 자료.pdf', fileContentType: 'application/pdf', active: true, ...overrides };
  const response = await send('/admin/products', { method: 'POST', admin: true, body: input });
  expect(response.status).toBe(201); return { input, ...(await response.json()).product };
}
function orderInput(selected, overrides = {}) {
  return { productId: selected.id, idempotencyKey: crypto.randomUUID(), customerName: '합성 구매자', customerPhone: '010-1234-5678',
    termsVersion: selected.termsVersion, termsAccepted: true, ...(selected.productType === 'physical' ? {
      shipping: { recipientName: '합성 수령인', phone: '010-1234-5678', postalCode: '12345', address: '합성시 검수로 1', addressDetail: '검수 주소' },
    } : {}), ...overrides };
}
async function started(session, selected, overrides = {}) {
  // Historical NICEPAY rows are seeded. New product orders must never issue a NICE checkout.
  const input = orderInput(selected, overrides), id = crypto.randomUUID(), at = new Date().toISOString();
  const pgOrderId = `shop_${id.replace(/-/g, '')}`, nonce = 'n'.repeat(43), physical = selected.productType === 'physical';
  const snapshot = { name: selected.name, price: selected.price, customerName: input.customerName, customerPhone: input.customerPhone,
    shipping: input.shipping || null, termsVersion: selected.termsVersion, refundPolicy: selected.refundPolicy, deliveryPolicy: selected.deliveryPolicy,
    fileKey: selected.input.fileKey, fileName: selected.input.fileName, fileContentType: selected.input.fileContentType };
  await local.db.batch([
    local.db.prepare(`INSERT INTO site_shop_orders(id,member_id,product_slug,product_type,idempotency_hash,payload_hash,snapshot,amount,shipping_fee,
      pg_order_id,pg_environment,pg_client_id,callback_nonce,approval_key,stock_state,shipping_status,expires_at,created_at,updated_at)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'test',?11,?12,?13,?14,?15,?16,?17,?17)`)
      .bind(id, session.member.id, selected.id, selected.productType, crypto.randomUUID(), crypto.randomUUID(), JSON.stringify(snapshot),
        selected.price + (physical ? selected.shippingFee : 0), physical ? selected.shippingFee : 0, pgOrderId, env.SITE_NICEPAY_CLIENT_ID,
        `${id.replace(/-/g, '')}${nonce.slice(0, 11)}`, crypto.randomUUID(), physical ? 'reserved' : 'none', physical ? 'pending' : 'not_applicable',
        new Date(Date.now() + 30 * 60_000).toISOString(), at),
    ...(physical ? [local.db.prepare('UPDATE site_shop_products SET stock=stock-1 WHERE slug=?1').bind(selected.id)] : []),
  ]);
  const detail = await (await send(`/shop-orders/${id}`, { session })).json();
  const row = local.sqlite.prepare('SELECT * FROM site_shop_orders WHERE id=?').get(id);
  const checkout = { provider: 'nicepay', clientId: row.pg_client_id, method: 'card', orderId: row.pg_order_id, amount: row.amount,
    goodsName: selected.name, returnUrl: `${ORIGIN}/api/site/payments/nicepay/return`, mallReserved: row.callback_nonce };
  expect(detail.checkout).toBeNull(); return { input, order: detail.order, checkout };
}
function authFields(order, overrides = {}) {
  const tid = `synthetic_tid_${order.order.id.replace(/-/g, '')}`;
  if (!pg.payments.has(tid)) pg.payments.set(tid, { tid, orderId: order.checkout.orderId, amount: order.order.amount, refundedAmount: 0,
    currency: 'KRW', mode: env.SITE_NICEPAY_MODE, status: 'pending', method: 'card', approvedAt: null, cancellations: [] });
  return { authResultCode: '0000', clientId: env.SITE_NICEPAY_CLIENT_ID, tid, orderId: order.checkout.orderId,
    amount: String(order.order.amount), authToken: 'synthetic-auth-only', signature: 'synthetic-verified-signature',
    mallReserved: order.checkout.mallReserved, ...overrides };
}
async function callback(fields) {
  return handleSiteShopRoutes(new Request(`${ORIGIN}/api/site/payments/nicepay/return`, { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://pay.nicepay.co.kr', 'CF-Connecting-IP': '198.51.100.29' },
    body: new URLSearchParams(fields) }), env, {}, { authorizeTeacher: teacherAuthorization });
}
async function paid(session, order) {
  const fields = authFields(order), response = await callback(fields); expect(response.status).toBe(303);
  expect(response.headers.get('Location')).toBe(`${ORIGIN}/checkout/?order=${order.order.id}`);
  const detail = await send(`/shop-orders/${order.order.id}`, { session }); return { fields, ...(await detail.json()) };
}
beforeEach(() => {
  local = siteD1();
  if (!local.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='site_shop_products'").get()) {
    local.sqlite.exec(readFileSync(new URL('../migrations/0012_site_shop.sql', import.meta.url), 'utf8'));
  }
  local.sqlite.exec(readFileSync(new URL('../migrations/0013_site_shop_payssam.sql', import.meta.url), 'utf8'));
  local.sqlite.exec(readFileSync(new URL('../migrations/0015_site_content.sql', import.meta.url), 'utf8'));
  local.sqlite.exec(readFileSync(new URL('../migrations/0016_site_shop_smartstore.sql', import.meta.url), 'utf8'));
  local.sqlite.exec(readFileSync(new URL('../migrations/0017_site_shop_thumbnails.sql', import.meta.url), 'utf8'));
  local.sqlite.exec(readFileSync(new URL('../migrations/0020_site_shop_coupons.sql', import.meta.url), 'utf8'));
  local.sqlite.exec(readFileSync(new URL('../migrations/0021_site_shop_shipping_note.sql', import.meta.url), 'utf8'));
  local.sqlite.exec(readFileSync(new URL('../migrations/0022_site_shop_regional_shipping.sql', import.meta.url), 'utf8'));
  local.sqlite.exec(readFileSync(new URL('../migrations/0023_site_shop_free_shipping.sql', import.meta.url), 'utf8'));
  local.sqlite.exec(readFileSync(new URL('../migrations/0024_site_shop_bundle_orders.sql', import.meta.url), 'utf8'));
  local.sqlite.exec(readFileSync(new URL('../migrations/0029_site_shop_recovery.sql', import.meta.url), 'utf8'));
  mail = []; files = new Map([['shop/synthetic.pdf', '%PDF-synthetic-private']]);
  pg.payments.clear(); pg.calls = []; pg.loseApprove = false; pg.loseCancel = false; pg.unavailable = false; pg.override = null;
  pg.cancelGate = null; pg.cancelStarted = null;
  pg.cancelReject = false; pg.postCancelQueryFailure = false;
  pg.lookupGate = null; pg.lookupStarted = null;
  env = { GAME_DB: local.db, JWT_SECRET: 'synthetic-shop-security-secret', SITE_SESSION_SECRET: 'synthetic-shop-session-secret-32-characters',
    SITE_PASSWORD_SECRET: 'synthetic-shop-password-secret-32-characters', SITE_ENVIRONMENT: 'development', SITE_ORIGIN: ORIGIN,
    SITE_EMAIL_FROM: 'sender@fixture.invalid', SITE_EMAIL: { send: async message => { mail.push(message); return { messageId: 'fixture' }; } },
    SITE_SHOP_ENABLED: 'true', SITE_SHOP_SALES_MODE: 'direct', SITE_NICEPAY_MODE: 'test', SITE_NICEPAY_CLIENT_ID: 'synthetic-client', SITE_NICEPAY_SECRET_KEY: 'synthetic-secret',
    SITE_PAYSSAM_MODE: 'test', SITE_PAYSSAM_API_KEY: 'synthetic_key_12345678', SITE_PAYSSAM_MEMBER_CODE: 'fixture-member', SITE_PAYSSAM_MERCHANT_CODE: 'fixture-merchant',
    SITE_PAYSSAM_CONTRACT_VERIFIED: 'true', SITE_PAYSSAM_API_BASE_URL: 'http://localhost:8799/partner', SITE_PAYSSAM_CHECKOUT_ORIGIN: ORIGIN,
    SITE_PAYSSAM_CALLBACK_ORIGIN: 'http://localhost:8798',
    SITE_SHOP_FILES: { head: async key => files.has(key) ? { key } : null, get: async key => files.has(key) ? { body: new Response(files.get(key)).body } : null } };
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('external_http_blocked'); }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { local.close(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('independent product shop', () => {
  it('starts empty and fails closed without the selling switch, PG setup, policies or private files', async () => {
    const session = await member(); env.SITE_SHOP_ENABLED = 'false';
    expect(await (await send('/products')).json()).toEqual({ products: [], nextCursor: null, status: 'ready', purchaseChannel: 'direct', purchaseReady: false, suppressedCuratedProducts: [] });
    expect((await send('/shop-orders', { method: 'POST', session, body: orderInput({ id: 'unpublished', termsVersion: 'v1' }) })).status).toBe(503);
    env.SITE_SHOP_ENABLED = 'true';
    expect(await (await send('/products')).json()).toMatchObject({ products: [], purchaseReady: true });
    expect((await send('/admin/products', { method: 'POST', admin: true, body: { slug: 'unsafe', name: '미준비', productType: 'digital', price: 1, active: true } })).status).toBe(400);
    delete env.SITE_SHOP_FILES;
    expect((await send('/admin/products', { method: 'POST', admin: true, body: { slug: 'no-file', name: '파일 없음', productType: 'digital', price: 100,
      active: true, termsVersion: 'v1', refundPolicy: '검토', deliveryPolicy: '전달', fileKey: 'shop/no.pdf', fileName: 'no.pdf' } })).status).toBe(503);
    delete env.SITE_PAYSSAM_API_KEY; expect(await (await send('/products')).json()).toMatchObject({ purchaseReady: false });
  });
  it('uses server prices, member ownership and CSRF and never creates a tuition ledger', async () => {
    const owner = await member(), other = await member('other-shop@fixture.invalid'), selected = await product();
    expect((await send('/shop-orders', { method: 'POST', session: owner, body: orderInput(selected, { amount: 1 }) })).status).toBe(400);
    expect((await send('/shop-orders', { method: 'POST', session: { cookie: owner.cookie }, body: orderInput(selected) })).status).toBe(403);
    const order = await started(owner, selected); expect(order.order).toMatchObject({ kind: 'shop', amount: 12000, shippingFee: 0, status: 'pending' });
    expect(order.checkout.orderId).toMatch(/^shop_[a-f0-9]{32}$/); expect(order.checkout.orderId).not.toBe(order.order.id);
    expect(order.checkout).toMatchObject({ provider: 'nicepay', method: 'card', amount: 12000 });
    expect((await send(`/shop-orders/${order.order.id}`, { session: other })).status).toBe(404);
    expect((await send(`/shop-orders/${order.order.id}`)).status).toBe(401);
    const list = await (await send('/shop-orders', { session: owner })).json();
    expect(list.orders[0]).not.toHaveProperty('shippingAddress'); expect(list.orders[0]).not.toHaveProperty('callback_nonce');
    await paid(owner, order);
    for (const table of ['site_payment_requests', 'site_orders', 'site_order_items', 'site_notion_outbox']) expect(local.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('deduplicates response-loss retries and reserves the last physical item once under concurrent orders', async () => {
    const session = await member(), selected = await product({ slug: 'physical-book', productType: 'physical', price: 25000, shippingFee: 3000, stock: 1 });
    const input = orderInput(selected);
    const responses = await Promise.all([send('/shop-orders', { method: 'POST', session, body: input }), send('/shop-orders', { method: 'POST', session, body: input })]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 201]);
    const [first, duplicate] = await Promise.all(responses.map(response => response.json())); expect(first.order.id).toBe(duplicate.order.id);
    expect(first.order.amount).toBe(28000); expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(0);
    expect((await send('/shop-orders', { method: 'POST', session, body: orderInput(selected) })).status).toBe(409);
    expect((await send('/shop-orders', { method: 'POST', session, body: { ...input, customerName: '변경 이름' } })).status).toBe(409);
    expect(local.sqlite.prepare('SELECT COUNT(*) AS n FROM site_shop_orders').get().n).toBe(1);
    const current = await (await send('/admin/products/physical-book', { admin: true })).json();
    const inactive = await send('/admin/products/physical-book', { method: 'PUT', admin: true, body: { ...selected.input, active: false, version: current.product.version } }); expect(inactive.status).toBe(200);
    const same = await send('/shop-orders', { method: 'POST', session, body: input }); expect((await same.json()).order.id).toBe(first.order.id);
  });
  it('does not oversell when two distinct concurrent submissions compete for one item', async () => {
    const session = await member(), selected = await product({ slug: 'one-item', productType: 'physical', shippingFee: 0, stock: 1 });
    const responses = await Promise.all([send('/shop-orders', { method: 'POST', session, body: orderInput(selected) }), send('/shop-orders', { method: 'POST', session, body: orderInput(selected) })]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(0);
  });
  it('blocks a forged nonce, client, amount, duplicate form field and expired ready callback before capture', async () => {
    const session = await member(), order = await started(session, await product()), fields = authFields(order);
    for (const change of [{ mallReserved: 'forged' }, { clientId: 'foreign' }, { amount: '1' }, { signature: 'forged' }]) expect((await callback({ ...fields, ...change })).status).toBe(400);
    const duplicate = new URLSearchParams(fields); duplicate.append('mallReserved', fields.mallReserved);
    expect((await handleSiteShopRoutes(new Request(`${ORIGIN}/api/site/payments/nicepay/return`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: duplicate }), env, {})).status).toBe(400);
    local.sqlite.prepare("UPDATE site_shop_orders SET expires_at='2000-01-01T00:00:00.000Z'").run();
    expect((await callback(fields)).status).toBe(303); expect(local.sqlite.prepare('SELECT status FROM site_shop_orders').get().status).toBe('expired');
    expect(pg.calls.filter(call => call.action === 'approve')).toHaveLength(0);
  });
  it('captures once for simultaneous callbacks and recovers a lost approval through a fresh lookup', async () => {
    const session = await member(), order = await started(session, await product()), fields = authFields(order); pg.loseApprove = true;
    const results = await Promise.all([callback(fields), callback(fields)]); expect(results.every(response => response.status === 303)).toBe(true);
    expect(pg.calls.filter(call => call.action === 'approve')).toHaveLength(1);
    await reconcileSiteShopPayments(env);
    const detail = await (await send(`/shop-orders/${order.order.id}`, { session })).json(); expect(detail.order.status).toBe('paid');
    await callback(fields); expect(pg.calls.filter(call => call.action === 'approve')).toHaveLength(1);
  });
  it('rejects an unsigned cross-order tid before capture without locking the other order transaction', async () => {
    const session = await member(), selected = await product(), first = await started(session, selected), other = await started(session, selected);
    const firstFields = authFields(first), otherFields = authFields(other);
    expect((await callback({ ...firstFields, tid: otherFields.tid })).status).toBe(303);
    expect(pg.calls.filter(call => call.action === 'approve')).toHaveLength(0);
    expect(local.sqlite.prepare('SELECT tid,status FROM site_shop_orders WHERE id=?').get(first.order.id)).toMatchObject({ tid: null, status: 'confirming' });
    await paid(session, other); expect(pg.calls.filter(call => call.action === 'approve')).toHaveLength(1);
    expect(local.sqlite.prepare('SELECT status FROM site_shop_orders WHERE id=?').get(other.order.id).status).toBe('paid');
  });
  it('fails closed when the preapproval transaction cannot be read and never captures during recovery', async () => {
    const session = await member(), order = await started(session, await product()), fields = authFields(order);
    pg.unavailable = true; expect((await callback(fields)).status).toBe(303);
    expect(pg.calls.filter(call => call.action === 'approve')).toHaveLength(0);
    pg.unavailable = false; await reconcileSiteShopPayments(env);
    expect(local.sqlite.prepare('SELECT status FROM site_shop_orders').get().status).toBe('confirming');
    expect(pg.calls.filter(call => call.action === 'approve')).toHaveLength(0);
  });
  it('resumes an auth-only callback after a transient preflight failure and captures exactly once', async () => {
    const session = await member(), order = await started(session, await product()), fields = authFields(order);
    pg.unavailable = true; await callback(fields);
    expect(local.sqlite.prepare('SELECT tid,status FROM site_shop_orders').get()).toMatchObject({ tid: null, status: 'confirming' });
    pg.unavailable = false; await callback(fields); await callback(fields);
    expect(local.sqlite.prepare('SELECT status FROM site_shop_orders').get().status).toBe('paid');
    expect(pg.calls.filter(call => call.action === 'approve')).toHaveLength(1);
  });
  it('expires and releases an auth-only preflight failure without capturing or releasing a sent approval', async () => {
    const session = await member(), selected = await product({ slug: 'auth-only-hold', productType: 'physical', shippingFee: 0, stock: 2 });
    const authOnly = await started(session, selected), sent = await started(session, selected);
    pg.unavailable = true; const firstFields = authFields(authOnly); await callback(firstFields);
    pg.unavailable = false; pg.loseApprove = true; await callback(authFields(sent)); pg.unavailable = true;
    local.sqlite.prepare("UPDATE site_shop_orders SET expires_at='2000-01-01T00:00:00.000Z'").run();
    await reconcileSiteShopPayments(env); await reconcileSiteShopPayments(env);
    expect(local.sqlite.prepare('SELECT status,stock_state,tid FROM site_shop_orders WHERE id=?').get(authOnly.order.id))
      .toMatchObject({ status: 'expired', stock_state: 'released', tid: null });
    expect(local.sqlite.prepare('SELECT status,stock_state FROM site_shop_orders WHERE id=?').get(sent.order.id))
      .toMatchObject({ status: 'confirming', stock_state: 'reserved' });
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(1);
    pg.unavailable = false; await callback(firstFields); expect(pg.calls.filter(call => call.action === 'approve')).toHaveLength(1);
  });
  it('does not capture when the clock reaches order expiration while the preflight GET is pending', async () => {
    const session = await member(), order = await started(session, await product({ slug: 'clock-boundary', productType: 'physical', shippingFee: 0, stock: 1 }));
    const fields = authFields(order), expires = local.sqlite.prepare('SELECT expires_at FROM site_shop_orders').get().expires_at;
    let lookupStarted, releaseLookup;
    const lookupEntered = new Promise(resolve => { lookupStarted = resolve; });
    pg.lookupStarted = lookupStarted; pg.lookupGate = new Promise(resolve => { releaseLookup = resolve; });
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(Date.parse(expires) - 10));
    const returning = callback(fields); await lookupEntered;
    // No cleanup job ran: the approval CAS itself must observe the new clock.
    vi.setSystemTime(new Date(expires)); releaseLookup();
    expect((await returning).status).toBe(303);
    expect(pg.calls.filter(call => call.action === 'approve')).toHaveLength(0);
    expect(local.sqlite.prepare('SELECT status,tid,stock_state FROM site_shop_orders').get())
      .toMatchObject({ status: 'expired', tid: null, stock_state: 'released' });
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(1);
  });
  it('retains reserved stock while approval is uncertain and releases expired unused stock once', async () => {
    const session = await member(), selected = await product({ slug: 'stock-hold', productType: 'physical', shippingFee: 0, stock: 2 });
    const unknown = await started(session, selected), unused = await started(session, selected); pg.loseApprove = true;
    await callback(authFields(unknown)); pg.unavailable = true;
    local.sqlite.prepare("UPDATE site_shop_orders SET expires_at='2000-01-01T00:00:00.000Z'").run();
    await reconcileSiteShopPayments(env); await reconcileSiteShopPayments(env);
    const first = local.sqlite.prepare('SELECT status,stock_state FROM site_shop_orders WHERE id=?').get(unknown.order.id);
    expect(first).toMatchObject({ status: 'confirming', stock_state: 'reserved' });
    expect(local.sqlite.prepare('SELECT status,stock_state FROM site_shop_orders WHERE id=?').get(unused.order.id)).toMatchObject({ status: 'expired', stock_state: 'released' });
    expect(local.sqlite.prepare('SELECT stock FROM site_shop_products').get().stock).toBe(1);
    pg.unavailable = false; await reconcileSiteShopPayments(env); expect(local.sqlite.prepare('SELECT stock_state FROM site_shop_orders WHERE id=?').get(unknown.order.id).stock_state).toBe('committed');
  });
  it('requeries webhook evidence and rejects foreign currency or environment without trusting its status', async () => {
    const session = await member(), order = await started(session, await product()); const approved = await paid(session, order);
    pg.override = { ...pg.payments.get(approved.fields.tid), currency: 'USD', refundedAmount: order.order.amount, status: 'refunded' };
    const input = { orderId: order.checkout.orderId, tid: approved.fields.tid, status: 'refunded', amount: 1 };
    expect((await send('/webhooks/nicepay', { method: 'POST', body: input })).status).toBe(503);
    expect(local.sqlite.prepare('SELECT status FROM site_shop_orders').get().status).toBe('paid');
    pg.override = null; const acknowledged = await send('/webhooks/nicepay', { method: 'POST', body: input });
    expect(acknowledged.status).toBe(200); expect(acknowledged.headers.get('Content-Type')).toContain('text/html'); expect(await acknowledged.text()).toBe('OK');
    expect(local.sqlite.prepare('SELECT status FROM site_shop_orders').get().status).toBe('paid');
    env.SITE_NICEPAY_MODE = 'live'; expect((await send('/webhooks/nicepay', { method: 'POST', body: input })).status).toBe(400);
  });
  it('restricts private files to the owner and removes access after a verified full refund', async () => {
    const owner = await member(), other = await member('file-other@fixture.invalid'), order = await started(owner, await product());
    expect((await send(`/shop-orders/${order.order.id}/download`, { session: owner })).status).toBe(403);
    await paid(owner, order);
    expect((await send(`/shop-orders/${order.order.id}/download`, { session: other })).status).toBe(404);
    const download = await send(`/shop-orders/${order.order.id}/download`, { session: owner }); expect(download.status).toBe(200);
    expect(download.headers.get('Content-Disposition')).toContain('attachment'); expect(download.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await download.text()).toBe('%PDF-synthetic-private');
    expect((await send(`/shop-orders/${order.order.id}/refund-request`, { method: 'POST', session: owner, body: { reason: '합성 환불 검토 요청' } })).status).toBe(201);
    const refundBody = { amount: 12000, reason: '합성 승인', idempotencyKey: crypto.randomUUID() };
    expect((await send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', session: owner, body: refundBody })).status).toBe(401);
    expect((await send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', admin: true, body: refundBody })).status).toBe(200);
    const detail = await (await send(`/shop-orders/${order.order.id}`, { session: owner })).json(); expect(detail.order).toMatchObject({ status: 'refunded', refundedAmount: 12000, canDownload: false });
    expect((await send(`/shop-orders/${order.order.id}/download`, { session: owner })).status).toBe(403);
  });
  it('reconciles an uncertain partial refund without a second cancellation and refuses cumulative regressions', async () => {
    const session = await member(), order = await started(session, await product()); const approved = await paid(session, order);
    pg.loseCancel = true;
    const body = { amount: 4000, reason: '합성 일부 환불 승인', idempotencyKey: crypto.randomUUID() };
    expect((await send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', admin: true, body })).status).toBe(200);
    expect(local.sqlite.prepare('SELECT state FROM site_shop_refunds').get().state).toBe('unknown');
    await send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', admin: true, body });
    expect(pg.calls.filter(call => call.action === 'cancel')).toHaveLength(1);
    expect(local.sqlite.prepare('SELECT state FROM site_shop_refunds').get().state).toBe('completed');
    expect(local.sqlite.prepare('SELECT refunded_amount FROM site_shop_orders').get().refunded_amount).toBe(4000);
    await send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', admin: true, body });
    expect(pg.calls.filter(call => call.action === 'cancel')).toHaveLength(1);
    pg.override = { ...pg.payments.get(approved.fields.tid), refundedAmount: 0, status: 'paid' };
    expect((await send('/webhooks/nicepay', { method: 'POST', body: { orderId: order.checkout.orderId, tid: approved.fields.tid } })).status).toBe(503);
    expect(local.sqlite.prepare('SELECT refunded_amount FROM site_shop_orders').get().refunded_amount).toBe(4000);
  });
  it('withholds a digital file while a full refund result is unknown and recovers it before serving bytes', async () => {
    const session = await member(), order = await started(session, await product()); await paid(session, order); pg.loseCancel = true;
    const body = { amount: 12000, reason: '합성 전체 환불 검토 완료', idempotencyKey: crypto.randomUUID() };
    await send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', admin: true, body });
    pg.unavailable = true; expect((await send(`/shop-orders/${order.order.id}/download`, { session })).status).toBe(503);
    const listed = await (await send('/shop-orders', { session })).json(); expect(listed.orders[0].canDownload).toBe(false);
    pg.unavailable = false; expect((await send(`/shop-orders/${order.order.id}/download`, { session })).status).toBe(403);
    expect(local.sqlite.prepare('SELECT status FROM site_shop_orders').get().status).toBe('refunded');
    expect(pg.calls.filter(call => call.action === 'cancel')).toHaveLength(1);
  });
  it('records only a definitive cancellation rejection as failed and keeps the paid file usable', async () => {
    const session = await member(), order = await started(session, await product()); await paid(session, order); pg.cancelReject = true;
    const body = { amount: 4000, reason: '합성 부분취소 거절 검수', idempotencyKey: crypto.randomUUID() };
    await send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', admin: true, body });
    expect(local.sqlite.prepare('SELECT state FROM site_shop_refunds').get().state).toBe('failed');
    expect(local.sqlite.prepare('SELECT status,refunded_amount FROM site_shop_orders').get()).toMatchObject({ status: 'paid', refunded_amount: 0 });
    expect((await send(`/shop-orders/${order.order.id}/download`, { session })).status).toBe(200);
    expect((await send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', admin: true, body })).status).toBe(409);
    expect(pg.calls.filter(call => call.action === 'cancel')).toHaveLength(1);
  });
  it('keeps a post-cancellation lookup rejection unknown until authoritative refund reconciliation', async () => {
    const session = await member(), order = await started(session, await product()); await paid(session, order); pg.postCancelQueryFailure = true;
    const body = { amount: 4000, reason: '합성 취소 후 조회 거절 검수', idempotencyKey: crypto.randomUUID() };
    await send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', admin: true, body });
    expect(local.sqlite.prepare('SELECT state FROM site_shop_refunds').get().state).toBe('unknown');
    pg.postCancelQueryFailure = false; await reconcileSiteShopPayments(env);
    expect(local.sqlite.prepare('SELECT state FROM site_shop_refunds').get().state).toBe('completed');
    expect(local.sqlite.prepare('SELECT refunded_amount FROM site_shop_orders').get().refunded_amount).toBe(4000);
    expect(pg.calls.filter(call => call.action === 'cancel')).toHaveLength(1);
  });
  it.each(['approving', 'unknown'])('closes the final download decision when a refund becomes %s during R2.get', async state => {
    const session = await member(), order = await started(session, await product()); await paid(session, order);
    let releaseFile, fileStarted, releaseCancel, cancelStarted;
    const fileGate = new Promise(resolve => { releaseFile = resolve; });
    const fileEntered = new Promise(resolve => { fileStarted = resolve; });
    const cancelEntered = new Promise(resolve => { cancelStarted = resolve; });
    const cancelledStream = vi.fn();
    env.SITE_SHOP_FILES.get = async () => {
      fileStarted(); await fileGate;
      return { body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('private bytes')); }, cancel: cancelledStream }) };
    };
    pg.cancelStarted = cancelStarted;
    if (state === 'approving') pg.cancelGate = new Promise(resolve => { releaseCancel = resolve; });
    else pg.loseCancel = true;
    const downloading = send(`/shop-orders/${order.order.id}/download`, { session });
    await fileEntered;
    const refunding = send(`/admin/shop-orders/${order.order.id}/refund`, { method: 'POST', admin: true,
      body: { amount: 12000, reason: 'R2 조회 중 합성 환불 승인', idempotencyKey: crypto.randomUUID() } });
    await cancelEntered;
    if (state === 'unknown') await refunding;
    const during = local.sqlite.prepare('SELECT status,download_count FROM site_shop_orders').get();
    const refundState = local.sqlite.prepare('SELECT state FROM site_shop_refunds').get().state;
    releaseFile();
    const response = await downloading;
    releaseCancel?.(); await refunding;
    expect(during).toMatchObject({ status: 'paid', download_count: 0 }); expect(refundState).toBe(state);
    expect(response.status).toBe(403); expect(cancelledStream).toHaveBeenCalledOnce();
    expect(local.sqlite.prepare('SELECT download_count FROM site_shop_orders').get().download_count).toBe(0);
  });
  it('permits shipment updates only for an authorized instructor and retains immutable order delivery data', async () => {
    const session = await member(), order = await started(session, await product({ slug: 'shipped-book', productType: 'physical', shippingFee: 3000, stock: 1 }));
    await paid(session, order); const shipment = { status: 'shipped', carrier: '합성 택배', trackingNumber: 'SYNTHETIC-123', version: 1 };
    expect((await send(`/admin/shop-orders/${order.order.id}/shipment`, { method: 'PUT', session, body: shipment })).status).toBe(401);
    const response = await send(`/admin/shop-orders/${order.order.id}/shipment`, { method: 'PUT', admin: true, body: shipment }); expect(response.status).toBe(200);
    expect((await response.json()).order.shipping).toEqual({ status: shipment.status, carrier: shipment.carrier, trackingNumber: shipment.trackingNumber });
    expect((await send(`/admin/shop-orders/${order.order.id}/shipment`, { method: 'PUT', admin: true, body: { status: 'pending', version: 2 } })).status).toBe(409);
    const detail = await (await send(`/shop-orders/${order.order.id}`, { session })).json(); expect(detail.order.shippingAddress.recipientName).toBe('합성 수령인');
    expect((await (await send('/shop-orders', { session })).json()).orders[0]).not.toHaveProperty('shippingAddress');
  });
  it('keeps paid purchase history available after sales are disabled and leaves unrelated routes alone', async () => {
    const session = await member(), order = await started(session, await product()); await paid(session, order);
    env.SITE_SHOP_ENABLED = 'false'; delete env.SITE_NICEPAY_SECRET_KEY;
    expect((await send('/shop-orders', { session })).status).toBe(200);
    const detail = await (await send(`/shop-orders/${order.order.id}`, { session })).json(); expect(detail.order.status).toBe('paid'); expect(detail.checkout).toBeNull();
    expect((await send(`/shop-orders/${order.order.id}/download`, { session })).status).toBe(200);
    expect(await handleSiteShopRoutes(new Request(`${ORIGIN}/api/site/orders`), env, {})).toBeNull();
  });
});
