import { siteOrigin } from './siteAuth.js';

// V2 contracts: /api/api-v2/{send,bill,acceptance,call-back} at developers.payssam.kr.
// The production API base and checkout URL format are supplied after partner inspection.
// A configured URL is an operator-approved exact pin, never a value supplied by a customer.
const encoder = new TextEncoder();
const SANDBOX_BASE = 'https://sandbox.paymint.co.kr/partner';
const ROOTS = ['paymint.co.kr', 'payssam.kr', 'linq.kr'];
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];
const ID = /^[A-Za-z0-9_-]{1,20}$/;
const CODE = /^[A-Za-z0-9_-]{1,60}$/;
const KEY = /^[A-Za-z0-9_-]{16,32}$/; // Local conservative key policy; no provider prefix is assumed.
const MAX_JSON = 128 * 1024;
const MAX_AMOUNT = 9_999_999_999;
const hex = value => Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');
const digest = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));

export class PayssamError extends Error {
  constructor(code, { definitive = false, status = 503, duplicate = false } = {}) {
    super(definitive ? '결제 요청 정보를 확인해주세요.' : '결제 상태를 확인하지 못했습니다. 잠시 후 다시 확인해주세요.');
    this.name = 'PayssamError'; this.code = code; this.status = status;
    this.definitive = definitive; this.unknown = !definitive; this.duplicate = duplicate;
  }
}
const invalid = () => new PayssamError('payssam_invalid_input', { definitive: true, status: 400 });
const mismatch = () => new PayssamError('payssam_evidence_mismatch');
const localTest = env => env.SITE_PAYSSAM_MODE === 'test' && env.SITE_ENVIRONMENT === 'development';
const providerHost = hostname => ROOTS.some(root => hostname === root || hostname.endsWith(`.${root}`));
function configuredUrl(env, value, { api = false } = {}) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value)) throw invalid();
  const url = new URL(value), local = LOOPBACK.includes(url.hostname);
  if (url.username || url.password || url.search || url.hash
    || (local ? !localTest(env) || url.protocol !== 'http:' : url.protocol !== 'https:' || !!url.port || !providerHost(url.hostname))
    || (api ? url.pathname.replace(/\/$/, '') !== '/partner' : url.pathname !== '/')) throw invalid();
  if (api && !local && env.SITE_PAYSSAM_MODE === 'test' && url.href.replace(/\/$/, '') !== SANDBOX_BASE) throw invalid();
  if (api && env.SITE_PAYSSAM_MODE === 'live' && ['sandbox.paymint.co.kr','stg.paymint.co.kr'].includes(url.hostname)) throw invalid();
  return api ? url.href.replace(/\/$/, '') : url.origin;
}
function configuration(env) {
  if (!env || !['test','live'].includes(env.SITE_PAYSSAM_MODE) || env.SITE_PAYSSAM_CONTRACT_VERIFIED !== 'true'
    || !['SITE_PAYSSAM_API_KEY','SITE_PAYSSAM_MEMBER_CODE','SITE_PAYSSAM_MERCHANT_CODE'].every(key => typeof env[key] === 'string')
    || !KEY.test(env.SITE_PAYSSAM_API_KEY || '') || !CODE.test(env.SITE_PAYSSAM_MEMBER_CODE || '')
    || !CODE.test(env.SITE_PAYSSAM_MERCHANT_CODE || '')) throw new PayssamError('payssam_not_configured');
  try {
    const paymentOrigin = configuredUrl(env, env.SITE_PAYSSAM_CHECKOUT_ORIGIN);
    if (new URL(paymentOrigin).protocol === 'http:' && paymentOrigin !== siteOrigin(env)) throw invalid();
    return { base: configuredUrl(env, env.SITE_PAYSSAM_API_BASE_URL || (env.SITE_PAYSSAM_MODE === 'test' ? SANDBOX_BASE : ''), { api: true }),
      paymentOrigin, callbackOrigin: callbackOrigin(env) };
  } catch { throw new PayssamError('payssam_not_configured'); }
}
function callbackOrigin(env) {
  const value = env.SITE_PAYSSAM_CALLBACK_ORIGIN;
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value)) throw invalid();
  const url = new URL(value), local = LOOPBACK.includes(url.hostname);
  // This is our Worker origin, not the provider's payment/API host.
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || (local ? !localTest(env) || url.protocol !== 'http:' : url.protocol !== 'https:' || !!url.port)) throw invalid();
  return url.origin;
}
export function payssamReady(env) { try { configuration(env); return true; } catch { return false; } }
function billId(value) { if (typeof value !== 'string' || !ID.test(value)) throw invalid(); return value; }
function amount(value) {
  if (!Number.isSafeInteger(value) || value < 100 || value > MAX_AMOUNT) throw invalid();
  return value;
}
function string(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw invalid();
  return value;
}
async function secretEquals(left, right) {
  if (typeof left !== 'string' || left.length > 128) return false;
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(left)));
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(right)));
  if (typeof crypto.subtle.timingSafeEqual === 'function') return crypto.subtle.timingSafeEqual(a, b);
  const key = await crypto.subtle.importKey('raw', b, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign','verify']);
  return crypto.subtle.verify('HMAC', key, await crypto.subtle.sign('HMAC', key, b), a);
}

export function validPayssamPaymentUrl(env, value) {
  const { paymentOrigin } = configuration(env);
  try {
    if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value) || value.includes(env.SITE_PAYSSAM_API_KEY)) throw mismatch();
    const url = new URL(value);
    // No public query-string contract exists. Keep an opaque path, but deny query/fragment
    // until a merchant's actual URL format has been inspected. Never construct a short URL.
    if (url.origin !== paymentOrigin || url.username || url.password || url.search || url.hash || url.pathname === '/') throw mismatch();
    return url.href;
  } catch { throw new PayssamError('payssam_payment_url_invalid'); }
}
function ownSiteUrl(env, value, { redirect = false } = {}) {
  try {
    if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value) || value.includes(env.SITE_PAYSSAM_API_KEY)) throw invalid();
    const url = new URL(value);
    if (url.origin !== (redirect ? siteOrigin(env) : callbackOrigin(env)) || url.username || url.password || url.hash) throw invalid();
    if (redirect && (url.pathname !== '/checkout/' || [...url.searchParams.keys()].some(key => key !== 'order')
      || url.searchParams.getAll('order').length !== 1 || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(url.searchParams.get('order') || ''))) throw invalid();
    if (!redirect && (url.pathname !== '/api/site/webhooks/payssam' || [...url.searchParams.keys()].some(key => !['order','token'].includes(key))
      || url.searchParams.getAll('order').length !== 1 || url.searchParams.getAll('token').length !== 1
      || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(url.searchParams.get('order') || '')
      || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('token') || ''))) throw invalid();
    return url.href;
  } catch { throw invalid(); }
}
function expiry(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid();
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) throw invalid();
  return value;
}
async function json(response) {
  const advertised = response.headers.get('Content-Length');
  if (advertised && /^\d+$/.test(advertised) && Number(advertised) > MAX_JSON) {
    await response.body?.cancel(); throw new PayssamError('payssam_response_too_large');
  }
  const reader = response.body?.getReader(); if (!reader) throw new PayssamError('payssam_invalid_response');
  let size = 0; const parts = [];
  try { for (;;) { const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength; if (size > MAX_JSON) { await reader.cancel(); throw new PayssamError('payssam_response_too_large'); } parts.push(part.value);
  } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new PayssamError('payssam_invalid_response'); }
}
const REJECTED = new Set(['VALIDATION_001','VALIDATION_002','VALIDATION_004','PARTNER_001','PARTNER_002','PARTNER_003',
  'PARTNER_004','PARTNER_005','PARTNER_006','PARTNER_007','PAYMENT_003','PAYMENT_004','PAYMENT_005','BILL_007','BILL_008','BILL_009','BILL_010','POINT_001']);
async function request(env, path, bill, operation) {
  const { base } = configuration(env);
  try {
    const response = await fetch(`${base}${path}`, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(25_000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json;charset=utf-8' },
      body: JSON.stringify({ apiKey: env.SITE_PAYSSAM_API_KEY, member: env.SITE_PAYSSAM_MEMBER_CODE,
        merchant: env.SITE_PAYSSAM_MERCHANT_CODE, bill }) });
    if (response.redirected || response.status >= 300 && response.status < 400) {
      await response.body?.cancel(); throw new PayssamError('payssam_redirect_blocked');
    }
    const result = await json(response);
    if (!response.ok || result.code !== '0000') {
      const duplicate = ['BILL_001','BILL_002','9800','9970'].includes(result.code);
      // A rejected creation/retry cannot prove that an earlier attempt did not create a bill.
      const definitive = operation !== 'create' && response.status < 500 && ![408,409,429].includes(response.status)
        && REJECTED.has(result.code);
      throw new PayssamError('payssam_request_failed', { definitive, duplicate, status: definitive ? 400 : 503 });
    }
    if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw mismatch();
    return result;
  } catch (error) {
    if (error instanceof PayssamError) throw error;
    throw new PayssamError('payssam_result_unknown');
  }
}
async function identity(env, data, expectedBillId, { echoOwner = false } = {}) {
  if (!data || data.billId !== expectedBillId || !await secretEquals(data.apiKey, env.SITE_PAYSSAM_API_KEY)) throw mismatch();
  // /bill/read does not document owner fields. Its authenticated server request is scoped to
  // the configured member/merchant; the caller must also bind this billId to its stored order.
  for (const [field, expected] of [['member',env.SITE_PAYSSAM_MEMBER_CODE],['merchant',env.SITE_PAYSSAM_MERCHANT_CODE]]) {
    if ((echoOwner || Object.hasOwn(data, field)) && data[field] !== expected) throw mismatch();
  }
}

export async function createPayssamBill(env, input) {
  const { paymentOrigin } = configuration(env), id = billId(input.billId), total = amount(input.amount);
  if (env.SITE_PAYSSAM_MODE === 'test' && total < 20_000) throw new PayssamError('payssam_test_amount_too_small', { definitive: true, status: 400 });
  // URL/RP may use an opaque customer identifier. Do not silently bind shared phone numbers
  // to recurring cards. Hash delimiters must never be part of this identifier.
  const phone = string(input.phone, 60); if (phone.includes(',')) throw invalid();
  const hash = await digest(`${id},${phone},${total}`);
  const bill = { billId: id, sendType: 'URL', productName: string(input.goodsName, 200), price: String(total),
    memberName: string(input.customerName, 60), phone, hash, callbackUrl: ownSiteUrl(env, input.callbackUrl),
    pageRedirectUrl: ownSiteUrl(env, input.returnUrl, { redirect: true }),
    ...(input.expireDate === undefined ? {} : { expireDt: expiry(input.expireDate) }) };
  const result = await request(env, '/bill', bill, 'create');
  await identity(env, result.data, id, { echoOwner: true });
  if (!await secretEquals(result.data.hash, hash)) throw mismatch();
  return { billId: id, paymentUrl: validPayssamPaymentUrl(env, result.data.shortUrl), paymentOrigin };
}
export async function getPayssamBill(env, id) { return request(env, '/bill/read', { billId: billId(id) }, 'read'); }
export async function destroyPayssamBill(env, id, total) {
  billId(id); amount(total);
  const result = await request(env, '/bill/destroy', { billId: id, price: String(total), hash: await digest(`${id},${total}`) }, 'destroy');
  await identity(env, result.data, id);
  // Acknowledge only. A subsequent /bill/read state D is required before stock release.
  return { billId: id };
}
export async function cancelPayssamBill(env, id, { amount: refund, originalAmount, reason }) {
  billId(id); amount(refund); amount(originalAmount);
  if (refund !== originalAmount) throw new PayssamError('payssam_partial_refund_unsupported', { definitive: true, status: 400 });
  const hash = await digest(`${id},${refund}`);
  const result = await request(env, '/bill/cancel', { billId: id, price: String(refund),
    cancelReason: string(reason, 20), hash }, 'cancel');
  await identity(env, result.data, id, { echoOwner: true });
  if (!await secretEquals(result.data.hash, hash)) throw mismatch();
  // Cancellation acknowledgement is not a final financial proof. Re-query state C.
  return { billId: id };
}

function providerTime(value) {
  if (typeof value !== 'string' || !/^\d{14}$/.test(value)) throw mismatch();
  const iso = `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(8,10)}:${value.slice(10,12)}:${value.slice(12,14)}+09:00`;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime()) || new Date(date.getTime() + 9*60*60_000).toISOString().slice(0,19).replace(/[-:T]/g, '') !== value) throw mismatch();
  return date.toISOString(); // Korean merchant-local datetime; confirm this in partner inspection.
}
function providerAmount(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) throw mismatch();
  return Number(value);
}
function transaction(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw mismatch();
  return value;
}
export async function verifyPayssamPayment(env, response, expected) {
  configuration(env); billId(expected.billId); amount(expected.amount);
  if ((expected.mode !== undefined && expected.mode !== env.SITE_PAYSSAM_MODE)
    || (expected.memberCode !== undefined && expected.memberCode !== env.SITE_PAYSSAM_MEMBER_CODE)
    || (expected.merchantCode !== undefined && expected.merchantCode !== env.SITE_PAYSSAM_MERCHANT_CODE)
    || !response || response.code !== '0000') throw mismatch();
  const data = response.data; await identity(env, data, expected.billId);
  if (!['W','F','C','D'].includes(data.apprState)) throw mismatch();
  const financial = ['F','C'].includes(data.apprState), cancelled = data.apprState === 'C';
  if (financial || data.apprPrice != null && data.apprPrice !== '') {
    if (providerAmount(data.apprPrice) !== expected.amount) throw mismatch();
  }
  let approvedAt = null, refundAt = null, approvalNumber = null, cancelNumber = null, method = null;
  if (financial) {
    // The V2 public spec documents 0 as the easy-payment code. Other VAN/cash/key-in
    // mappings must be confirmed before accepting them as fulfillment evidence.
    if (data.apprPayType !== '0') throw new PayssamError('payssam_payment_method_unverified');
    approvedAt = providerTime(data.apprOriginDt); approvalNumber = transaction(data.apprOriginNum);
    const at = providerTime(data.apprDt), number = transaction(data.apprNum);
    if (cancelled) { refundAt = at; cancelNumber = number; if (refundAt < approvedAt) throw mismatch(); }
    else if (at !== approvedAt || number !== approvalNumber) throw mismatch();
    if ((expected.approvedAt && expected.approvedAt !== approvedAt)
      || (expected.approvalNumber && expected.approvalNumber !== approvalNumber)) throw mismatch();
    method = '간편결제';
  }
  const proof = { billId: expected.billId, amount: expected.amount, currency: 'KRW',
    status: ({ W: 'pending', F: 'paid', C: 'refunded', D: 'destroyed' })[data.apprState],
    refundedAmount: cancelled ? expected.amount : 0, approvedAt, refundAt, method, approvalNumber, cancelNumber };
  return { ...proof, evidenceHash: await digest(JSON.stringify(proof)) };
}
export async function verifyPayssamCallback(env, payload) {
  configuration(env);
  // V2 callback schema says F-only; the official FAQ also mentions cancellations.
  // C is safe as a re-query hint, never as financial/fulfillment evidence.
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !['F','C'].includes(payload.apprState)
    || !await secretEquals(payload.apiKey, env.SITE_PAYSSAM_API_KEY)) {
    throw new PayssamError('payssam_callback_invalid', { definitive: true, status: 403 });
  }
  await identity(env, payload, billId(payload.billId));
  // SHA256 bill/price hashes are not merchant signatures. No callback data grants access.
  // Use this hint to find a stored member-owned order, then authenticate /bill/read.
  return { billId: billId(payload.billId) };
}
