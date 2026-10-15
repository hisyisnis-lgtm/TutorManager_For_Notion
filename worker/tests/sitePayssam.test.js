import { createHash, timingSafeEqual } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PayssamError, payssamReady, validPayssamPaymentUrl, createPayssamBill, getPayssamBill,
  destroyPayssamBill, cancelPayssamBill, verifyPayssamPayment, verifyPayssamCallback } from '../lib/sitePayssam.js';

// Only synthetic server configuration and mocked fetches. These addresses are fixture pins,
// not claimed as the provider's actual production/checkout addresses.
const env = { SITE_PAYSSAM_MODE: 'test', SITE_PAYSSAM_CONTRACT_VERIFIED: 'true', SITE_PAYSSAM_API_KEY: 'a'.repeat(32),
  SITE_PAYSSAM_MEMBER_CODE: 'fixture-partner-member', SITE_PAYSSAM_MERCHANT_CODE: 'fixture-merchant',
  SITE_PAYSSAM_CHECKOUT_ORIGIN: 'https://checkout.payssam.kr', SITE_ORIGIN: 'https://site.example.invalid',
  SITE_PAYSSAM_CALLBACK_ORIGIN: 'https://fixture-api.example.workers.dev' };
const live = { ...env, SITE_PAYSSAM_MODE: 'live', SITE_PAYSSAM_API_BASE_URL: 'https://verified.paymint.co.kr/partner' };
const local = { ...env, SITE_ENVIRONMENT: 'development', SITE_PAYSSAM_API_BASE_URL: 'http://localhost:8803/partner',
  SITE_ORIGIN: 'http://localhost:4327', SITE_PAYSSAM_CHECKOUT_ORIGIN: 'http://localhost:4327', SITE_PAYSSAM_CALLBACK_ORIGIN: 'http://localhost:8803' };
const id = 'shop_0123456789abcde', total = 25000, order = '50000000-0000-4000-8000-000000000001';
const input = { billId: id, amount: total, goodsName: '가상 중국어 교재', customerName: '가상 회원', phone: 'member_opaque_customer_1',
  callbackUrl: `${env.SITE_PAYSSAM_CALLBACK_ORIGIN}/api/site/webhooks/payssam?order=${order}&token=${'x'.repeat(43)}`, returnUrl: `${env.SITE_ORIGIN}/checkout/?order=${order}` };
const digest = value => createHash('sha256').update(value).digest('hex');
const wrapper = data => ({ code: '0000', message: '성공하였습니다.', data });
const owned = overrides => ({ apiKey: env.SITE_PAYSSAM_API_KEY, member: env.SITE_PAYSSAM_MEMBER_CODE,
  merchant: env.SITE_PAYSSAM_MERCHANT_CODE, billId: id, ...overrides });
const generated = overrides => wrapper(owned({ hash: digest(`${id},${input.phone},${total}`),
  shortUrl: `${env.SITE_PAYSSAM_CHECKOUT_ORIGIN}/opaque-token`, ...overrides }));
const financial = overrides => wrapper({ apiKey: env.SITE_PAYSSAM_API_KEY, billId: id,
  apprState: 'F', apprPrice: String(total), apprPayType: '0', apprDt: '20261011153045', apprOriginDt: '20261011153045',
  apprNum: 'APPROVAL0123', apprOriginNum: 'APPROVAL0123', apprIssuerNum: 'private-card-number', apprSign: 'private-handwritten-signature', ...overrides });
const expected = { billId: id, amount: total, mode: 'test', memberCode: env.SITE_PAYSSAM_MEMBER_CODE, merchantCode: env.SITE_PAYSSAM_MERCHANT_CODE };
let mockFetch;
beforeEach(() => { mockFetch = vi.fn(() => { throw new Error('Unmocked external network denied'); }); vi.stubGlobal('fetch', mockFetch); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('verified configuration and exact checkout URL pins', () => {
  it('gates contract verification and never assumes a public production API address', () => {
    expect(payssamReady(env)).toBe(true); expect(payssamReady(live)).toBe(true); expect(payssamReady(local)).toBe(true);
    expect(payssamReady({ ...live, SITE_PAYSSAM_API_BASE_URL: undefined })).toBe(false);
    expect(payssamReady({ ...env, SITE_PAYSSAM_CONTRACT_VERIFIED: undefined })).toBe(false);
  });
  it.each([
    { SITE_PAYSSAM_MODE: 'sandbox' }, { SITE_PAYSSAM_MODE: '__proto__' }, { SITE_PAYSSAM_CONTRACT_VERIFIED: true },
    { SITE_PAYSSAM_API_KEY: '' }, { SITE_PAYSSAM_API_KEY: 'x'.repeat(33) }, { SITE_PAYSSAM_API_KEY: 1234567890123456 },
    { SITE_PAYSSAM_MEMBER_CODE: '' }, { SITE_PAYSSAM_MERCHANT_CODE: '' }, { SITE_PAYSSAM_CHECKOUT_ORIGIN: undefined },
    { SITE_PAYSSAM_CALLBACK_ORIGIN: undefined }, { SITE_PAYSSAM_CALLBACK_ORIGIN: 'http://fixture-api.example.workers.dev' },
    { SITE_PAYSSAM_API_BASE_URL: 'https://attacker.invalid/partner' }, { SITE_PAYSSAM_API_BASE_URL: 'https://paymint.co.kr.attacker.invalid/partner' },
    { SITE_PAYSSAM_API_BASE_URL: 'https://sandbox.paymint.co.kr/partner?key=private' },
    { SITE_PAYSSAM_API_BASE_URL: 'https://stg.paymint.co.kr/partner' },
    { SITE_PAYSSAM_CHECKOUT_ORIGIN: 'http://checkout.payssam.kr' },
    { SITE_PAYSSAM_CHECKOUT_ORIGIN: 'https://user:pass@checkout.payssam.kr' },
    { SITE_PAYSSAM_CHECKOUT_ORIGIN: 'https://checkout.payssam.kr:444' },
    { SITE_PAYSSAM_CHECKOUT_ORIGIN: 'https://checkout.payssam.kr/path' },
  ])('rejects invalid/incomplete server configuration %j before any fetch', async changes => {
    expect(payssamReady({ ...env, ...changes })).toBe(false);
    await expect(getPayssamBill({ ...env, ...changes }, id)).rejects.toMatchObject({ code: 'payssam_not_configured' });
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([
    { SITE_ENVIRONMENT: 'production' }, { SITE_ENVIRONMENT: undefined }, { SITE_PAYSSAM_MODE: 'live' },
    { SITE_PAYSSAM_API_BASE_URL: 'http://localhost.attacker.invalid/partner' },
    { SITE_PAYSSAM_CHECKOUT_ORIGIN: 'http://127.0.0.1:4327' },
  ])('permits loopback HTTP only in test/development and same-site checkout %j', changes => {
    expect(payssamReady({ ...local, ...changes })).toBe(false);
  });
  it('allows opaque nonempty paths on the exact approved origin without inventing token grammar', () => {
    expect(validPayssamPaymentUrl(env, `${env.SITE_PAYSSAM_CHECKOUT_ORIGIN}/opaque-path/token%2Fpart`)).toContain('/opaque-path/token%2Fpart');
    expect(validPayssamPaymentUrl(local, 'http://localhost:4327/qa-payssam/opaque')).toBe('http://localhost:4327/qa-payssam/opaque');
  });
  it.each(['https://attacker.invalid/bill','https://checkout.payssam.kr.attacker.invalid/bill',
    'https://different.payssam.kr/bill','https://checkout.payssam.kr/', 'https://user:pass@checkout.payssam.kr/bill',
    'https://checkout.payssam.kr/bill?price=1', 'https://checkout.payssam.kr/bill#secret', 'javascript:alert(1)',
    'https://checkout.payssam.kr/white space', `https://checkout.payssam.kr/${env.SITE_PAYSSAM_API_KEY}`])('rejects unverified checkout URL %s', value => {
    expect(() => validPayssamPaymentUrl(env, value)).toThrow(PayssamError);
  });
});

describe('URL-only creation with owned response and no duplicate resubmission', () => {
  it('posts only URL delivery with camelCase, string price and correct hash; returns no key/owner/PII', async () => {
    mockFetch.mockResolvedValue(Response.json(generated()));
    const result = await createPayssamBill(env, input), [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://sandbox.paymint.co.kr/partner/bill');
    expect(options).toMatchObject({ method: 'POST', redirect: 'manual' }); expect(options.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({ apiKey: env.SITE_PAYSSAM_API_KEY, member: env.SITE_PAYSSAM_MEMBER_CODE,
      merchant: env.SITE_PAYSSAM_MERCHANT_CODE, bill: { billId: id, sendType: 'URL', price: String(total),
        hash: digest(`${id},${input.phone},${total}`), callbackUrl: input.callbackUrl, pageRedirectUrl: input.returnUrl } });
    expect(body.bill).not.toHaveProperty('expireDt');
    expect(result).toEqual({ billId: id, paymentUrl: `${env.SITE_PAYSSAM_CHECKOUT_ORIGIN}/opaque-token`, paymentOrigin: env.SITE_PAYSSAM_CHECKOUT_ORIGIN });
    expect(JSON.stringify(result)).not.toContain(env.SITE_PAYSSAM_API_KEY); expect(result).not.toHaveProperty('customerName');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it('keeps the homepage return and a separate HTTPS Worker callback origin distinct', async () => {
    mockFetch.mockResolvedValue(Response.json(generated()));
    await createPayssamBill(env, input);
    const bill = JSON.parse(mockFetch.mock.calls[0][1].body).bill;
    expect(new URL(bill.callbackUrl).origin).toBe(env.SITE_PAYSSAM_CALLBACK_ORIGIN);
    expect(new URL(bill.pageRedirectUrl).origin).toBe(env.SITE_ORIGIN);
    expect(new URL(bill.callbackUrl).origin).not.toBe(new URL(bill.pageRedirectUrl).origin);
  });
  it.each([
    `${env.SITE_ORIGIN}/api/site/webhooks/payssam?order=${order}&token=${'x'.repeat(43)}`,
    `${env.SITE_PAYSSAM_CALLBACK_ORIGIN}/api/site/webhooks/other?order=${order}&token=${'x'.repeat(43)}`,
    `${input.callbackUrl}&amount=1`, `${input.callbackUrl}&order=${order}`, `${input.callbackUrl}&token=${'x'.repeat(43)}`,
    `${env.SITE_PAYSSAM_CALLBACK_ORIGIN}/api/site/webhooks/payssam?order=${order}`, `${input.callbackUrl}#secret`,
  ])('rejects a callback outside the pinned route and exact order/token query contract %s', async callbackUrl => {
    await expect(createPayssamBill(env, { ...input, callbackUrl })).rejects.toMatchObject({ definitive: true });
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('uses optional real calendar expiry only when provided', async () => {
    mockFetch.mockResolvedValue(Response.json(generated()));
    await createPayssamBill(env, { ...input, expireDate: '2026-10-31' });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).bill.expireDt).toBe('2026-10-31');
  });
  it.each([
    { billId: crypto.randomUUID() }, { billId: 'x'.repeat(21) }, { amount: 19999 }, { amount: '25000' }, { amount: 1.5 },
    { phone: 'customer,ambiguous' }, { customerName: '' }, { expireDate: '2026-02-30' },
    { callbackUrl: 'https://attacker.invalid/api/site/callback' },
    { returnUrl: `${env.SITE_ORIGIN}/checkout/?order=${order}&paymentKey=secret` },
  ])('rejects incomplete/unsafe creation inputs %j without sending a bill', async changes => {
    await expect(createPayssamBill(env, { ...input, ...changes })).rejects.toMatchObject({ definitive: true });
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([
    { billId: 'otherbill' }, { apiKey: 'b'.repeat(32) }, { member: 'othermember' }, { merchant: 'othermerchant' },
    { hash: '0'.repeat(64) }, { shortUrl: 'https://attacker.invalid/bill' },
  ])('rejects a code0000 generation response with mismatched association %j', async fields => {
    mockFetch.mockResolvedValue(Response.json(generated(fields)));
    await expect(createPayssamBill(env, input)).rejects.toMatchObject({ unknown: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it.each(['BILL_001','9800','VALIDATION_001','POINT_001','ERROR'])('keeps create %s unknown: absence of an earlier bill is not proven', async code => {
    mockFetch.mockResolvedValue(Response.json({ code, message: 'private upstream data' }));
    const error = await createPayssamBill(env, input).catch(value => value);
    expect(error).toMatchObject({ code: 'payssam_request_failed', unknown: true, definitive: false,
      duplicate: ['BILL_001','9800'].includes(code) });
    expect(String(error)).not.toContain('private'); expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('query/destroy/full cancellation are distinct operations', () => {
  it('reads by billId and cannot fabricate checkout URL from state W', async () => {
    const response = wrapper({ apiKey: env.SITE_PAYSSAM_API_KEY, billId: id, apprState: 'W' });
    mockFetch.mockResolvedValue(Response.json(response));
    const read = await getPayssamBill(env, id);
    expect(mockFetch.mock.calls[0][0]).toBe('https://sandbox.paymint.co.kr/partner/bill/read');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).bill).toEqual({ billId: id });
    const proof = await verifyPayssamPayment(env, read, expected);
    expect(proof).toMatchObject({ status: 'pending', approvedAt: null, refundedAmount: 0 });
    expect(proof).not.toHaveProperty('paymentUrl'); expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it('destroys a bill with no-phone hash but returns only an acknowledgement', async () => {
    mockFetch.mockResolvedValue(Response.json(wrapper({ apiKey: env.SITE_PAYSSAM_API_KEY, billId: id })));
    expect(await destroyPayssamBill(env, id, total)).toEqual({ billId: id });
    expect(mockFetch.mock.calls[0][0]).toContain('/bill/destroy');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).bill).toEqual({ billId: id, price: String(total), hash: digest(`${id},${total}`) });
  });
  it('cancels the original full bill and returns no unverified financial status', async () => {
    mockFetch.mockResolvedValue(Response.json(wrapper(owned({ hash: digest(`${id},${total}`), apprNum: 'CANCEL0123', apprOriginNum: 'APPROVAL0123', apprCancelDt: '20261011160000' }))));
    expect(await cancelPayssamBill(env, id, { amount: total, originalAmount: total, reason: '가상 전체 환불' })).toEqual({ billId: id });
    expect(mockFetch.mock.calls[0][0]).toContain('/bill/cancel');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).bill).toEqual({ billId: id, price: String(total), cancelReason: '가상 전체 환불', hash: digest(`${id},${total}`) });
  });
  it.each([{ amount: 10000, originalAmount: total, reason: '부분환불' },
    { amount: total, reason: '원금없음' }, { amount: total, originalAmount: total, reason: 'x'.repeat(21) }])('rejects partial/ambiguous or overlong cancellations %j', async options => {
    await expect(cancelPayssamBill(env, id, options)).rejects.toMatchObject({ definitive: true });
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([['BILL_002',false,true],['PAYMENT_002',false,false],['VALIDATION_002',true,false],['ERROR',false,false]])
    ('classifies cancel error %s without replaying financial operations', async (code, definitive, duplicate) => {
      mockFetch.mockResolvedValue(Response.json({ code, message: 'private upstream' }));
      await expect(cancelPayssamBill(env, id, { amount: total, originalAmount: total, reason: '가상전체환불' }))
        .rejects.toMatchObject({ definitive, unknown: !definitive, duplicate });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
});

describe('bounded HTTP responses and safe error contracts', () => {
  it.each([302,307,308])('blocks redirect HTTP%s without forwarding apiKey', async status => {
    mockFetch.mockResolvedValue(new Response('', { status, headers: { Location: 'https://attacker.invalid/bill' } }));
    await expect(getPayssamBill(env, id)).rejects.toMatchObject({ code: 'payssam_redirect_blocked', unknown: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it('keeps transport/timeouts unknown without exposing key, phone or provider messages', async () => {
    mockFetch.mockRejectedValue(new Error(`private ${env.SITE_PAYSSAM_API_KEY} ${input.phone}`));
    const error = await createPayssamBill(env, input).catch(value => value);
    expect(error).toMatchObject({ code: 'payssam_result_unknown', unknown: true });
    expect(String(error)).not.toContain(env.SITE_PAYSSAM_API_KEY); expect(String(error)).not.toContain(input.phone);
  });
  it('bounds both advertised and streamed response sizes and rejects non-object malformed JSON', async () => {
    for (const response of [new Response('x'.repeat(128*1024+1)), new Response('{}', { headers: { 'Content-Length': '131073' } }),
      new Response('not json'), Response.json([]), Response.json(wrapper(null))]) {
      mockFetch.mockResolvedValueOnce(response);
      await expect(getPayssamBill(env, id)).rejects.toMatchObject({ unknown: true });
    }
  });
  it.each([408,429,500])('does not label a HTTP%s upstream failure as definitive', async status => {
    mockFetch.mockResolvedValue(Response.json({ code: 'VALIDATION_002' }, { status }));
    await expect(destroyPayssamBill(env, id, total)).rejects.toMatchObject({ definitive: false });
  });
});

describe('only authenticated server-query evidence changes payment state', () => {
  it('normalizes exact-price approved proof without copying shared key/card/signature PII', async () => {
    const proof = await verifyPayssamPayment(env, financial(), expected);
    expect(proof).toMatchObject({ billId: id, amount: total, status: 'paid', refundedAmount: 0,
      approvedAt: '2026-10-11T06:30:45.000Z', approvalNumber: 'APPROVAL0123', method: '간편결제' });
    expect(proof.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(proof)).not.toContain('private'); expect(proof).not.toHaveProperty('apiKey');
  });
  it('accepts only full cancellation proof, preserving original approval identity and time', async () => {
    const proof = await verifyPayssamPayment(env, financial({ apprState: 'C', apprNum: 'CANCEL0123', apprDt: '20261011160000' }), expected);
    expect(proof).toMatchObject({ status: 'refunded', refundedAmount: total, refundAt: '2026-10-11T07:00:00.000Z', cancelNumber: 'CANCEL0123' });
    await expect(verifyPayssamPayment(env, financial({ apprState: 'C', apprNum: 'CANCEL0123', apprDt: '20261011160000', apprPrice: '10000' }), expected))
      .rejects.toMatchObject({ code: 'payssam_evidence_mismatch' });
  });
  it.each([['W','pending'],['D','destroyed']])('reads %s with no price as %s without payment/fulfillment claim', async (state, status) => {
    const proof = await verifyPayssamPayment(env, wrapper({ apiKey: env.SITE_PAYSSAM_API_KEY, billId: id, apprState: state }), expected);
    expect(proof).toMatchObject({ status, approvedAt: null, approvalNumber: null, method: null, refundedAmount: 0 });
  });
  it.each([
    { apiKey: 'b'.repeat(32) }, { billId: 'otherbill' }, { member: 'othermember' }, { merchant: 'othermerchant' },
    { apprState: 'P' }, { apprPrice: '24999' }, { apprPrice: 25000 }, { apprPrice: '025000' },
    { apprDt: '20260230153045' }, { apprOriginDt: '20261301153045' }, { apprNum: '' },
    { apprOriginNum: 'OTHERAPPROVAL' }, { apprPayType: 'OFFLINE_CASH' }, { apprPayType: '1' },
  ])('rejects wrong ownership/amount/state/time or undocumented payment method %j', async fields => {
    await expect(verifyPayssamPayment(env, financial(fields), expected)).rejects.toBeInstanceOf(PayssamError);
  });
  it.each([{ mode: 'live' }, { memberCode: 'foreign' }, { merchantCode: 'foreign' },
    { approvedAt: '2026-10-10T06:30:45.000Z' }, { approvalNumber: 'OTHERAPPROVAL' }])('rejects a stored order/provider binding mismatch %j', async fields => {
    await expect(verifyPayssamPayment(env, financial(), { ...expected, ...fields })).rejects.toMatchObject({ code: 'payssam_evidence_mismatch' });
  });
  it('authenticates callback in constant time but returns only a bill hint even for forged paid fields', async () => {
    const payload = { ...financial({ apprPrice: '1', apprNum: 'forged' }).data, buyerName: 'private' };
    expect(await verifyPayssamCallback(env, payload)).toEqual({ billId: id });
    expect(mockFetch).not.toHaveBeenCalled();
    const compare = vi.fn(timingSafeEqual);
    const subtle = { digest: crypto.subtle.digest.bind(crypto.subtle), timingSafeEqual: compare };
    vi.stubGlobal('crypto', { subtle });
    expect(await verifyPayssamCallback(env, payload)).toEqual({ billId: id }); expect(compare).toHaveBeenCalled();
  });
  it('accepts a cancellation callback only as an opaque re-query hint despite forged refund fields', async () => {
    expect(await verifyPayssamCallback(env, { ...financial().data, apprState: 'C', apprPrice: '1', apprOriginNum: 'forged' })).toEqual({ billId: id });
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([{ apiKey: 'b'.repeat(32) }, { apprState: 'D' }, { apprState: 'W' }, { merchant: 'foreign' }])('rejects invalid/unsupported callback %j', async fields => {
    await expect(verifyPayssamCallback(env, { ...financial().data, ...fields })).rejects.toBeInstanceOf(PayssamError);
  });
});
