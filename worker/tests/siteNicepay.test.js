import { createHash, timingSafeEqual } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NicepayError, nicepayReady, nicepayCheckout, verifyNicepayAuth, approveNicepay,
  getNicepayPayment, getNicepayPaymentByOrder, cancelNicepay, netCancelNicepay, verifyNicepayPayment } from '../lib/siteNicepay.js';

// Synthetic keys and PG responses only. Every fetch is stubbed; no payment/Notion calls.
const env = { SITE_NICEPAY_MODE: 'test', SITE_NICEPAY_CLIENT_ID: `S2_${'a'.repeat(32)}`,
  SITE_NICEPAY_SECRET_KEY: 'b'.repeat(32), SITE_NICEPAY_MERCHANT_ID: 'fixturemid',
  SITE_ORIGIN: 'http://localhost:4325', SITE_ENVIRONMENT: 'development' };
const live = { ...env, SITE_NICEPAY_MODE: 'live', SITE_NICEPAY_CLIENT_ID: `R2_${'c'.repeat(32)}` };
const orderId = `shop_${'d'.repeat(32)}`, tid = 'fixturemid01012610110000000001', amount = 12000;
const mallReserved = 'x'.repeat(43), returnUrl = `${env.SITE_ORIGIN}/api/site/shop/nicepay/return`;
const expected = { tid, orderId, amount };
const digest = value => createHash('sha256').update(value).digest('hex');
function auth(overrides = {}) {
  const form = { authResultCode: '0000', tid, clientId: env.SITE_NICEPAY_CLIENT_ID,
    orderId, amount: String(amount), mallReserved, authToken: 'FIXTUREAUTH0123456789', ...overrides };
  form.signature = digest(`${form.authToken}${form.clientId}${form.amount}${env.SITE_NICEPAY_SECRET_KEY}`);
  return form;
}
function payment(overrides = {}, selectedEnv = env) {
  const data = { resultCode: '0000', tid, orderId, amount, currency: 'KRW', status: 'paid', payMethod: 'card',
    balanceAmt: amount, paidAt: '2026-10-11T10:00:00.000+0900', ediDate: '2026-10-11T10:00:01.000+0900', cancels: null,
    buyerName: '보존하지 않을 가상 구매자', buyerEmail: 'fixture@example.invalid', ...overrides };
  data.signature = digest(`${data.tid}${data.amount}${data.ediDate}${selectedEnv.SITE_NICEPAY_SECRET_KEY}`);
  return data;
}
const cancel = (value, suffix = '01') => ({ tid: `fixturecancel${suffix}`, amount: value, cancelledAt: '2026-10-11T11:00:00.000+0900', reason: '가상 취소' });
let mockFetch;
beforeEach(() => {
  mockFetch = vi.fn(() => { throw new Error('Unmocked external calls denied'); });
  vi.stubGlobal('fetch', mockFetch);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('NICEPAY configuration and checkout boundary', () => {
  it('uses separate Server approval Basic keys and fixed environment SDKs without exposing secrets', () => {
    expect(nicepayReady(env)).toBe(true); expect(nicepayReady(live)).toBe(true);
    const input = { orderId, amount, goodsName: '중국어 "학습" 교재 '.repeat(9), returnUrl, mallReserved };
    const checkout = nicepayCheckout(env, input);
    expect(checkout).toMatchObject({ clientId: env.SITE_NICEPAY_CLIENT_ID, method: 'card', orderId, amount,
      mallReserved, sdkUrl: 'https://sandbox-pay.nicepay.co.kr/v1/js/' });
    expect(new TextEncoder().encode(checkout.goodsName).length).toBeLessThanOrEqual(40);
    expect(checkout.goodsName).not.toContain('"');
    expect(Object.keys(checkout)).not.toEqual(expect.arrayContaining(['secretKey','merchantId']));
    expect(JSON.stringify(checkout)).not.toContain(env.SITE_NICEPAY_SECRET_KEY);
    expect(nicepayCheckout(live, input).sdkUrl).toBe('https://pay.nicepay.co.kr/v1/js/');
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([
    { SITE_NICEPAY_MODE: 'sandbox' }, { SITE_NICEPAY_MODE: 'live' },
    { SITE_NICEPAY_MODE: '__proto__', SITE_NICEPAY_CLIENT_ID: `undefined${'a'.repeat(32)}` },
    { SITE_NICEPAY_CLIENT_ID: `S1_${'a'.repeat(32)}` }, { SITE_NICEPAY_CLIENT_ID: 'a'.repeat(32) },
    { SITE_NICEPAY_SECRET_KEY: '' }, { SITE_NICEPAY_SECRET_KEY: 'unsafe:header\nvalue' },
    { SITE_NICEPAY_MERCHANT_ID: '' },
  ])('fails closed on incomplete, wrong-model, or mismatched environment settings %j', async changes => {
    const badEnv = { ...env, ...changes };
    expect(nicepayReady(badEnv)).toBe(false);
    await expect(approveNicepay(badEnv, tid, amount)).rejects.toMatchObject({ code: 'nicepay_not_configured', unknown: true });
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each(['https://elsewhere.invalid/return', `${env.SITE_ORIGIN}/return?authToken=private`,
    `${env.SITE_ORIGIN}/return#private`, 'javascript:alert(1)', 'http://user:pass@localhost:4325/return'])('rejects unsafe return URL %s', url => {
    expect(() => nicepayCheckout(env, { orderId, amount, goodsName: '교재', returnUrl: url, mallReserved })).toThrow(NicepayError);
  });
  it.each([0, -1, 1.5, NaN, '12000', 1_000_000_000_000])('rejects non-authoritative amounts %s before network', async value => {
    await expect(approveNicepay(env, tid, value)).rejects.toMatchObject({ code: 'nicepay_invalid_input', definitive: true });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('NICEPAY return authentication is bound to stored order inputs', () => {
  it('verifies native SHA-256 auth signature for object and urlencoded form, keeps token private', async () => {
    for (const form of [auth(), new URLSearchParams(auth())]) {
      const verified = await verifyNicepayAuth(env, form, { orderId, amount, mallReserved });
      expect(verified).toEqual({ tid, orderId, amount, mallReserved });
      expect(verified).not.toHaveProperty('authToken');
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('uses Workers native constant-time buffer comparison when available', async () => {
    const compare = vi.fn(timingSafeEqual);
    const subtle = { digest: crypto.subtle.digest.bind(crypto.subtle), timingSafeEqual: compare };
    vi.stubGlobal('crypto', { subtle });
    await expect(verifyNicepayAuth(env, auth(), { orderId, amount, mallReserved })).resolves.toMatchObject({ tid });
    await expect(verifyNicepayAuth(env, { ...auth(), signature: '0'.repeat(64) }, { orderId, amount, mallReserved }))
      .rejects.toMatchObject({ code: 'nicepay_auth_signature_invalid' });
    expect(compare).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['orderId', `shop_${'e'.repeat(32)}`], ['amount', '12001'], ['amount', '012000'],
    ['mallReserved', 'y'.repeat(43)], ['clientId', `S2_${'e'.repeat(32)}`],
  ])('rejects signed authentication with mismatched %s', async (field, value) => {
    await expect(verifyNicepayAuth(env, auth({ [field]: value }), { orderId, amount, mallReserved }))
      .rejects.toMatchObject({ code: 'nicepay_auth_mismatch', status: 403, definitive: true });
  });
  it('rejects invalid/missing signature, duplicate form fields, and cancelled authentication', async () => {
    await expect(verifyNicepayAuth(env, { ...auth(), signature: '0'.repeat(64) }, { orderId, amount, mallReserved }))
      .rejects.toMatchObject({ code: 'nicepay_auth_signature_invalid' });
    const duplicate = new URLSearchParams(auth()); duplicate.append('tid', 'differenttid');
    await expect(verifyNicepayAuth(env, duplicate, { orderId, amount, mallReserved })).rejects.toMatchObject({ code: 'nicepay_invalid_input' });
    await expect(verifyNicepayAuth(env, { authResultCode: 'I002' }, { orderId, amount, mallReserved }))
      .rejects.toMatchObject({ code: 'nicepay_auth_failed', definitive: true });
  });
  it('does not mistake auth signature for a signed order/tid relation: authoritative mismatched query is rejected', async () => {
    // Official auth signature omits tid/orderId/nonce. The caller must obtain a signed GET
    // proof before approval: copying a same-price auth to a different order is insufficient.
    const swappedTid = 'otherfixturetid';
    const verified = await verifyNicepayAuth(env, auth({ tid: swappedTid }), { orderId, amount, mallReserved });
    expect(verified.tid).toBe(swappedTid);
    await expect(verifyNicepayPayment(env, payment({ tid: swappedTid, orderId: 'otherorder', status: 'ready', paidAt: '0' }),
      { ...expected, tid: swappedTid })).rejects.toMatchObject({ code: 'nicepay_evidence_mismatch' });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('NICEPAY fixed-host Basic API and uncertain results', () => {
  it('approves once with amount signature, never places authToken in approval or Basic credentials in URL', async () => {
    mockFetch.mockResolvedValue(Response.json(payment()));
    expect(await approveNicepay(env, tid, amount)).toMatchObject({ tid, orderId, amount });
    const [url, options] = mockFetch.mock.calls[0], body = JSON.parse(options.body);
    expect(url).toBe(`https://sandbox-api.nicepay.co.kr/v1/payments/${tid}`);
    expect(options).toMatchObject({ method: 'POST', redirect: 'manual' });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.headers.Authorization).toBe(`Basic ${btoa(`${env.SITE_NICEPAY_CLIENT_ID}:${env.SITE_NICEPAY_SECRET_KEY}`)}`);
    expect(body).toEqual({ amount, ediDate: body.ediDate, signData: digest(`${tid}${amount}${body.ediDate}${env.SITE_NICEPAY_SECRET_KEY}`), returnCharSet: 'utf-8' });
    expect(body).not.toHaveProperty('authToken'); expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it('queries original tid and orderId/date without approval POST, sends only live keys to live host', async () => {
    mockFetch.mockImplementation(() => Response.json(payment()));
    await getNicepayPayment(live, tid);
    await getNicepayPaymentByOrder(env, orderId, '20261011');
    const first = new URL(mockFetch.mock.calls[0][0]), second = new URL(mockFetch.mock.calls[1][0]);
    expect(first.origin).toBe('https://api.nicepay.co.kr');
    expect(first.searchParams.get('signData')).toBe(digest(`${tid}${first.searchParams.get('ediDate')}${live.SITE_NICEPAY_SECRET_KEY}`));
    expect(second.pathname).toBe(`/v1/payments/find/${orderId}`); expect(second.searchParams.get('orderDate')).toBe('20261011');
    expect(mockFetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
  });
  it('uses explicit refund amount/operation reference and documented netcancel URI; no automatic retries', async () => {
    mockFetch.mockImplementation(() => Response.json(payment()));
    const refundId = `refund_${'f'.repeat(32)}`;
    await cancelNicepay(env, tid, { amount: 3000, orderId: refundId, reason: '부분 환불' });
    await netCancelNicepay(env, tid, { orderId });
    const [refundUrl, refundOptions] = mockFetch.mock.calls[0], refundBody = JSON.parse(refundOptions.body);
    const [netUrl, netOptions] = mockFetch.mock.calls[1], netBody = JSON.parse(netOptions.body);
    expect(refundUrl).toBe(`https://sandbox-api.nicepay.co.kr/v1/payments/${tid}/cancel`);
    expect(refundBody).toMatchObject({ cancelAmt: 3000, orderId: refundId, reason: '부분 환불' });
    expect(refundBody.signData).toBe(digest(`${tid}${refundBody.ediDate}${env.SITE_NICEPAY_SECRET_KEY}`));
    expect(netUrl).toBe('https://sandbox-api.nicepay.co.kr/v1/payments/netcancel');
    expect(netBody.orderId).toBe(orderId); expect(netBody).not.toHaveProperty('tid');
    expect(netBody.signData).toBe(digest(`${orderId}${netBody.ediDate}${env.SITE_NICEPAY_SECRET_KEY}`));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
  it.each(['../escape', 'tid?secret=leak', 'x'.repeat(31)])('rejects path injection or overlong tid %s', async invalidTid => {
    await expect(getNicepayPayment(env, invalidTid)).rejects.toMatchObject({ code: 'nicepay_invalid_input' });
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each(['20260230','20261301','20260010','2026-10-11'])('rejects invalid merchant query date %s', async date => {
    await expect(getNicepayPaymentByOrder(env, orderId, date)).rejects.toMatchObject({ code: 'nicepay_invalid_input' });
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([302,307,308])('blocks redirect %s without forwarding merchant credentials', async status => {
    mockFetch.mockResolvedValue(new Response('', { status, headers: { Location: 'https://attacker.invalid/payment' } }));
    await expect(approveNicepay(env, tid, amount)).rejects.toMatchObject({ code: 'nicepay_redirect_blocked', definitive: false });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it('keeps timeout/network failure unknown and redacts provider details', async () => {
    mockFetch.mockRejectedValue(new DOMException(`private ${env.SITE_NICEPAY_SECRET_KEY}`, 'TimeoutError'));
    const error = await approveNicepay(env, tid, amount).catch(value => value);
    expect(error).toMatchObject({ code: 'nicepay_result_unknown', definitive: false, unknown: true });
    expect(String(error)).not.toContain(env.SITE_NICEPAY_SECRET_KEY); expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it.each([['U112',200,false],['U114',200,false],['U303',200,false],['3095',200,true],['U127',400,true],['U127',500,false],['U127',429,false]])
    ('classifies code %s HTTP %s without assuming a duplicate is unpaid', async (resultCode, status, definitive) => {
      mockFetch.mockResolvedValue(Response.json({ resultCode, resultMsg: `private ${env.SITE_NICEPAY_SECRET_KEY}` }, { status }));
      const error = await approveNicepay(env, tid, amount).catch(value => value);
      expect(error).toMatchObject({ code: 'nicepay_request_failed', definitive, unknown: !definitive });
      expect(String(error)).not.toContain('private'); expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  it('bounds JSON by streamed bytes and Content-Length, handles invalid JSON as unknown', async () => {
    for (const response of [new Response('x'.repeat(128*1024+1)), new Response('{}', { headers: { 'Content-Length': '131073' } }),
      new Response('<html>private upstream</html>'), Response.json([])]) {
      mockFetch.mockResolvedValueOnce(response);
      await expect(getNicepayPayment(env, tid)).rejects.toMatchObject({ definitive: false, unknown: true });
    }
  });
});

describe('NICEPAY signed payment, refund and webhook evidence normalization', () => {
  it('normalizes paid proof without retaining buyer, token, card, or nonce fields', async () => {
    const proof = await verifyNicepayPayment(env, payment(), expected);
    expect(proof).toMatchObject({ ...expected, status: 'paid', refundedAmount: 0, method: 'card',
      currency: 'KRW', approvedAt: '2026-10-11T01:00:00.000Z', cancellations: [] });
    expect(proof.evidenceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(proof)).not.toEqual(expect.arrayContaining(['buyerName','buyerEmail','authToken','mallReserved','card']));
    expect(await verifyNicepayPayment(env, payment(), expected)).toEqual(proof);
  });
  it('validates cumulative partial/full refunds and stable evidence regardless of cancel array order', async () => {
    const first = cancel(3000), second = cancel(2000,'02');
    const partial = payment({ status: 'partialCancelled', balanceAmt: 7000, cancels: [second,first] });
    const proof = await verifyNicepayPayment(env, partial, expected);
    expect(proof).toMatchObject({ status: 'partially_refunded', refundedAmount: 5000 });
    expect(await verifyNicepayPayment(env, { ...partial, cancels: [first,second] }, expected)).toEqual(proof);
    expect(await verifyNicepayPayment(env, payment({ status: 'cancelled', balanceAmt: 0, cancels: [cancel(amount)] }), expected))
      .toMatchObject({ status: 'refunded', refundedAmount: amount });
  });
  it.each([['ready','pending'],['failed','failed'],['expired','failed']])('returns signed %s as %s without paid fulfillment', async (status, normalized) => {
    for (const balanceAmt of [0, amount]) {
      const proof = await verifyNicepayPayment(env, payment({ status, paidAt: '0', balanceAmt }), expected);
      expect(proof).toMatchObject({ status: normalized, approvedAt: null, refundedAmount: 0 });
    }
  });
  it.each([
    { amount: amount+1 }, { amount: String(amount) }, { orderId: 'otherorder' }, { tid: 'othertid' },
    { currency: 'USD' }, { status: 'arbitrary' }, { payMethod: 'bank' }, { paidAt: '0' },
    { ediDate: '0' }, { mid: 'othermid' }, { mId: 'othermid' }, { merchantId: 'othermid' }, { clientId: `S2_${'e'.repeat(32)}` },
  ])('rejects otherwise signed invalid financial/merchant evidence %j', async fields => {
    await expect(verifyNicepayPayment(env, payment(fields), expected)).rejects.toBeInstanceOf(NicepayError);
  });
  it('rejects forged, absent, wrong-key signatures and stored environment mismatch', async () => {
    for (const data of [{ ...payment(), signature: '0'.repeat(64) }, { ...payment(), signature: undefined },
      payment({}, { ...env, SITE_NICEPAY_SECRET_KEY: 'c'.repeat(32) })]) {
      await expect(verifyNicepayPayment(env, data, expected)).rejects.toMatchObject({ code: 'nicepay_signature_invalid', unknown: true });
    }
    await expect(verifyNicepayPayment(env, payment(), { ...expected, mode: 'live' })).rejects.toMatchObject({ code: 'nicepay_evidence_mismatch' });
  });
  it.each([
    { status: 'partialCancelled', balanceAmt: 9000, cancels: [cancel(3000),cancel(3000)] },
    { status: 'partialCancelled', balanceAmt: 9000, cancels: [cancel(-3000)] },
    { status: 'partialCancelled', balanceAmt: 9000, cancels: [cancel(3000.5)] },
    { status: 'partialCancelled', balanceAmt: 9000, cancels: [{ ...cancel(3000), cancelledAt: '0' }] },
    { status: 'partialCancelled', balanceAmt: 10000, cancels: [cancel(3000)] },
    { status: 'cancelled', balanceAmt: 9000, cancels: [cancel(3000)] },
    { status: 'partialCancelled', balanceAmt: 0, cancels: [cancel(amount)] },
    { status: 'paid', balanceAmt: 9000, cancels: [cancel(3000)] },
    { status: 'ready', paidAt: '0', balanceAmt: 9000, cancels: [cancel(3000)] },
    { status: 'cancelled', balanceAmt: -1, cancels: [cancel(amount+1)] },
  ])('rejects inconsistent cumulative refund evidence %j', async fields => {
    await expect(verifyNicepayPayment(env, payment(fields), expected)).rejects.toBeInstanceOf(NicepayError);
  });
});
