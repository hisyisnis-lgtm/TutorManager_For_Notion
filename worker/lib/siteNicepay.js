import { siteOrigin } from './siteAuth.js';

// NICEPAY Server approval / Basic API. Provider calls are never retried here.
// https://github.com/nicepayments/nicepay-manual (Server, query, cancel, hook)
const encoder = new TextEncoder();
const MAX_JSON = 128 * 1024;
const MAX_AMOUNT = 999_999_999_999;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const TID = /^[A-Za-z0-9]{1,30}$/;
const NONCE = /^[A-Za-z0-9_-]{43}$/;
const HEX = /^[a-fA-F0-9]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})$/;
const ENVIRONMENTS = {
  test: { prefix: 'S2_', api: 'https://sandbox-api.nicepay.co.kr', sdk: 'https://sandbox-pay.nicepay.co.kr/v1/js/' },
  live: { prefix: 'R2_', api: 'https://api.nicepay.co.kr', sdk: 'https://pay.nicepay.co.kr/v1/js/' },
};

export class NicepayError extends Error {
  constructor(code, { status = 503, definitive = false } = {}) {
    super(definitive ? '결제 요청을 처리할 수 없습니다.' : '결제 상태를 확인하지 못했습니다. 잠시 후 다시 확인해주세요.');
    this.name = 'NicepayError';
    this.code = code;
    this.status = status;
    this.definitive = definitive;
    this.unknown = !definitive;
  }
}
const invalid = () => new NicepayError('nicepay_invalid_input', { status: 400, definitive: true });
const mismatch = (code = 'nicepay_evidence_mismatch') => new NicepayError(code);
const amountValid = value => Number.isSafeInteger(value) && value > 0 && value <= MAX_AMOUNT;
const timestampValid = value => typeof value === 'string' && ISO_DATE.test(value) && Number.isFinite(Date.parse(value));
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
const sha256 = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));

export function nicepayReady(env) {
  const config = Object.hasOwn(ENVIRONMENTS, env?.SITE_NICEPAY_MODE) ? ENVIRONMENTS[env.SITE_NICEPAY_MODE] : null;
  // Legacy unprefixed and Client approval keys cannot prove the chosen approval model.
  return !!config && typeof env.SITE_NICEPAY_CLIENT_ID === 'string'
    && new RegExp(`^${config.prefix}[a-fA-F0-9]{32}$`).test(env.SITE_NICEPAY_CLIENT_ID)
    && typeof env.SITE_NICEPAY_SECRET_KEY === 'string' && /^[a-fA-F0-9]{32}$/.test(env.SITE_NICEPAY_SECRET_KEY)
    && typeof env.SITE_NICEPAY_MERCHANT_ID === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(env.SITE_NICEPAY_MERCHANT_ID);
}
function configured(env) {
  if (!nicepayReady(env)) throw new NicepayError('nicepay_not_configured');
  return ENVIRONMENTS[env.SITE_NICEPAY_MODE];
}
function checkedId(value, pattern = ID) {
  if (typeof value !== 'string' || !pattern.test(value)) throw invalid();
  return value;
}
function checkedAmount(value) {
  if (!amountValid(value)) throw invalid();
  return value;
}
function limitedText(value, maxBytes) {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw invalid();
  let result = '';
  for (const char of value.trim().replace(/["¦]/g, '-')) {
    if (encoder.encode(result + char).byteLength > maxBytes) break;
    result += char;
  }
  return result;
}

export function nicepayCheckout(env, { orderId, amount, goodsName, returnUrl, mallReserved }) {
  const config = configured(env);
  checkedId(orderId); checkedAmount(amount); checkedId(mallReserved, NONCE);
  let url;
  try {
    url = new URL(returnUrl);
    if (url.origin !== siteOrigin(env) || url.username || url.password || url.hash || url.search
      || encoder.encode(url.href).byteLength > 500) throw invalid();
  } catch { throw invalid(); }
  return { clientId: env.SITE_NICEPAY_CLIENT_ID, method: 'card', orderId, amount,
    goodsName: limitedText(goodsName, 40), returnUrl: url.href, mallReserved, sdkUrl: config.sdk };
}

async function signatureMatches(supplied, expected) {
  if (typeof supplied !== 'string' || !HEX.test(supplied)) return false;
  const decode = value => Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16));
  const left = decode(supplied), right = decode(expected);
  if (typeof crypto.subtle.timingSafeEqual === 'function') return crypto.subtle.timingSafeEqual(left, right);
  // Node/WebCrypto fallback: compare native HMACs with verify, without JS secret-string equality.
  const key = await crypto.subtle.importKey('raw', right, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const tag = await crypto.subtle.sign('HMAC', key, right);
  return crypto.subtle.verify('HMAC', key, tag, left);
}
function formField(form, name) {
  if (!form || typeof form !== 'object') throw invalid();
  if (typeof form.getAll === 'function') {
    const values = form.getAll(name);
    if (values.length !== 1 || typeof values[0] !== 'string') throw invalid();
    return values[0];
  }
  if (!Object.hasOwn(form, name) || typeof form[name] !== 'string') throw invalid();
  return form[name];
}

export async function verifyNicepayAuth(env, form, { orderId, amount, mallReserved }) {
  configured(env);
  checkedId(orderId); checkedAmount(amount); checkedId(mallReserved, NONCE);
  const code = formField(form, 'authResultCode');
  if (code !== '0000') throw new NicepayError('nicepay_auth_failed', { status: 400, definitive: true });
  const tid = checkedId(formField(form, 'tid'), TID), clientId = formField(form, 'clientId');
  const actualOrderId = formField(form, 'orderId'), amountText = formField(form, 'amount');
  const nonce = formField(form, 'mallReserved'), authToken = formField(form, 'authToken');
  if (!/^[1-9]\d{0,11}$/.test(amountText) || Number(amountText) !== amount || actualOrderId !== orderId
    || clientId !== env.SITE_NICEPAY_CLIENT_ID || nonce !== mallReserved
    || !/^[A-Za-z0-9_-]{1,40}$/.test(authToken)) {
    throw new NicepayError('nicepay_auth_mismatch', { status: 403, definitive: true });
  }
  const expected = await sha256(`${authToken}${clientId}${amountText}${env.SITE_NICEPAY_SECRET_KEY}`);
  if (!await signatureMatches(formField(form, 'signature'), expected)) {
    throw new NicepayError('nicepay_auth_signature_invalid', { status: 403, definitive: true });
  }
  // Authentication is not proof of payment. Persist tid, then approve and verify the result.
  return { tid, orderId, amount, mallReserved };
}

async function boundedJson(response) {
  const length = response.headers.get('Content-Length');
  if (length && /^\d+$/.test(length) && Number(length) > MAX_JSON) {
    await response.body?.cancel(); throw new NicepayError('nicepay_response_too_large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new NicepayError('nicepay_invalid_response');
  let size = 0; const chunks = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_JSON) { await reader.cancel(); throw new NicepayError('nicepay_response_too_large'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch { throw new NicepayError('nicepay_invalid_response'); }
}
// Only documented request rejection/decline codes are definitive; duplicates and transport
// failures may follow a successful financial operation, so must be reconciled with GET.
const REJECTED = new Set(['A101','A113','A114','A115','A116','A117','A122','A123','A147',
  'U100','U104','U105','U108','U109','U110','U119','U120','U123','U124','U125','U127','U128',
  'U129','U130','U131','U132','U304','U308','U311','U312','U313','U315','U316','U318',
  '3011','3021','3022','3023','3024','3041','3091','3095','1534']);
async function requestNicepay(env, method, path, body) {
  const config = configured(env);
  try {
    const response = await fetch(`${config.api}${path}`, { method, redirect: 'manual',
      signal: AbortSignal.timeout(30_000), headers: { Accept: 'application/json',
        'Content-Type': 'application/json;charset=utf-8',
        Authorization: `Basic ${btoa(`${env.SITE_NICEPAY_CLIENT_ID}:${env.SITE_NICEPAY_SECRET_KEY}`)}` },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (response.status >= 300 && response.status < 400 || response.redirected) {
      await response.body?.cancel(); throw new NicepayError('nicepay_redirect_blocked');
    }
    const data = await boundedJson(response);
    if (!response.ok || data.resultCode !== '0000') {
      const definitive = response.status < 500 && ![408,409,429].includes(response.status)
        && typeof data.resultCode === 'string' && REJECTED.has(data.resultCode);
      throw new NicepayError('nicepay_request_failed', { definitive, status: definitive ? 400 : 503 });
    }
    return data;
  } catch (error) {
    if (error instanceof NicepayError) throw error;
    throw new NicepayError('nicepay_result_unknown');
  }
}
export async function approveNicepay(env, tid, amount) {
  configured(env); checkedId(tid, TID); checkedAmount(amount);
  const ediDate = new Date().toISOString();
  return requestNicepay(env, 'POST', `/v1/payments/${tid}`, { amount, ediDate,
    signData: await sha256(`${tid}${amount}${ediDate}${env.SITE_NICEPAY_SECRET_KEY}`), returnCharSet: 'utf-8' });
}
export async function getNicepayPayment(env, tid) {
  configured(env); checkedId(tid, TID);
  const ediDate = new Date().toISOString();
  const query = new URLSearchParams({ ediDate, signData: await sha256(`${tid}${ediDate}${env.SITE_NICEPAY_SECRET_KEY}`) });
  return requestNicepay(env, 'GET', `/v1/payments/${tid}?${query}`);
}
export async function getNicepayPaymentByOrder(env, orderId, orderDate) {
  configured(env); checkedId(orderId);
  if (typeof orderDate !== 'string' || !/^\d{8}$/.test(orderDate)
    || !timestampValid(`${orderDate.slice(0,4)}-${orderDate.slice(4,6)}-${orderDate.slice(6)}T00:00:00Z`)
    || new Date(`${orderDate.slice(0,4)}-${orderDate.slice(4,6)}-${orderDate.slice(6)}T00:00:00Z`)
      .toISOString().slice(0,10).replace(/-/g, '') !== orderDate) throw invalid();
  return requestNicepay(env, 'GET', `/v1/payments/find/${orderId}?${new URLSearchParams({ orderDate })}`);
}
export async function cancelNicepay(env, tid, { amount, orderId, reason }) {
  configured(env); checkedId(tid, TID); checkedId(orderId); checkedAmount(amount);
  const ediDate = new Date().toISOString();
  return requestNicepay(env, 'POST', `/v1/payments/${tid}/cancel`, { cancelAmt: amount,
    orderId, reason: limitedText(reason, 100), ediDate,
    signData: await sha256(`${tid}${ediDate}${env.SITE_NICEPAY_SECRET_KEY}`), returnCharSet: 'utf-8' });
}
export async function netCancelNicepay(env, tid, { orderId }) {
  configured(env); checkedId(tid, TID); checkedId(orderId);
  const ediDate = new Date().toISOString();
  return requestNicepay(env, 'POST', '/v1/payments/netcancel', { orderId, ediDate,
    signData: await sha256(`${orderId}${ediDate}${env.SITE_NICEPAY_SECRET_KEY}`), returnCharSet: 'utf-8' });
}

export async function verifyNicepayPayment(env, data, { tid, orderId, amount, mode = env.SITE_NICEPAY_MODE }) {
  configured(env); checkedId(tid, TID); checkedId(orderId); checkedAmount(amount);
  if (!data || typeof data !== 'object' || data.resultCode !== '0000' || data.tid !== tid
    || data.orderId !== orderId || data.amount !== amount || data.currency !== 'KRW'
    || mode !== env.SITE_NICEPAY_MODE || !timestampValid(data.ediDate) || data.payMethod !== 'card'
    || !['paid','ready','failed','cancelled','partialCancelled','expired'].includes(data.status)) throw mismatch();
  // MID/clientId are not required NICEPAY response fields. A valid signature binds the
  // configured merchant's secret; check any extra identity fields instead of inventing one.
  for (const field of ['mid','mId','merchantId']) {
    if (Object.hasOwn(data, field) && data[field] !== env.SITE_NICEPAY_MERCHANT_ID) throw mismatch('nicepay_merchant_mismatch');
  }
  if (Object.hasOwn(data, 'clientId') && data.clientId !== env.SITE_NICEPAY_CLIENT_ID) throw mismatch('nicepay_merchant_mismatch');
  const expected = await sha256(`${tid}${amount}${data.ediDate}${env.SITE_NICEPAY_SECRET_KEY}`);
  if (!await signatureMatches(data.signature, expected)) throw mismatch('nicepay_signature_invalid');
  const cancels = data.cancels == null ? [] : data.cancels;
  if (!Array.isArray(cancels) || cancels.length > 1000 || cancels.some(cancel => !cancel
    || typeof cancel.tid !== 'string' || !TID.test(cancel.tid) || !amountValid(cancel.amount)
    || !timestampValid(cancel.cancelledAt)) || new Set(cancels.map(cancel => cancel.tid)).size !== cancels.length) {
    throw mismatch('nicepay_cancel_evidence_mismatch');
  }
  const refundedAmount = cancels.reduce((sum, cancel) => sum + cancel.amount, 0);
  const wasPaid = ['paid','partialCancelled','cancelled'].includes(data.status);
  if (refundedAmount > amount || !Number.isSafeInteger(data.balanceAmt)
    || (wasPaid ? data.balanceAmt !== amount - refundedAmount : ![0,amount].includes(data.balanceAmt))
    || (data.status === 'paid' && refundedAmount !== 0)
    || (data.status === 'partialCancelled' && !(refundedAmount > 0 && refundedAmount < amount))
    || (data.status === 'cancelled' && refundedAmount !== amount)
    || (['ready','failed','expired'].includes(data.status) && refundedAmount !== 0)) throw mismatch('nicepay_balance_mismatch');
  if (wasPaid ? !timestampValid(data.paidAt) : data.paidAt !== '0') throw mismatch('nicepay_payment_time_mismatch');
  const proof = { tid, orderId, amount, currency: 'KRW', refundedAmount,
    status: ({ paid: 'paid', partialCancelled: 'partially_refunded', cancelled: 'refunded',
      failed: 'failed', expired: 'failed', ready: 'pending' })[data.status],
    method: data.payMethod, approvedAt: wasPaid ? new Date(data.paidAt).toISOString() : null,
    cancellations: cancels.map(cancel => ({ tid: cancel.tid, amount: cancel.amount,
      cancelledAt: new Date(cancel.cancelledAt).toISOString() })).sort((a,b) => a.cancelledAt.localeCompare(b.cancelledAt) || a.tid.localeCompare(b.tid)) };
  return { ...proof, evidenceHash: await sha256(JSON.stringify(proof)) };
}
