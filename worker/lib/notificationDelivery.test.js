import { describe, expect, it, vi } from 'vitest';
import { parseSolapiResult, readDeliveryJson } from './notificationDelivery.js';

describe('single-message Solapi acceptance result', () => {
  it.each(['2000', '3000', '4000', 2000])('recognizes %s as accepted, not handset receipt', code => {
    expect(parseSolapiResult(200, { statusCode: code })).toEqual({ ok: true, state: 'accepted', reason: 'solapi_accepted', statusCode: String(code) });
  });
  it.each(['1014', '2010', '3040', '3101', '4001'])('does not accept status %s merely because HTTP is 2xx', statusCode => {
    expect(parseSolapiResult(200, { statusCode })).toMatchObject({ ok: false, state: 'failed', reason: 'solapi_rejected', statusCode });
  });
  it.each([null, {}, [], { statusCode: 'private-value' }, { statusCode: '999' }])('unknown response is never success: %j', body => {
    expect(parseSolapiResult(200, body)).toEqual({ ok: false, state: 'unknown', reason: 'solapi_response_unknown' });
  });
  it.each([302, 307, 400, 401, 403, 429])('HTTP %s rejects even a misleading accepted body', status => {
    expect(parseSolapiResult(status, { statusCode: '2000' })).toEqual({ ok: false, state: 'failed', reason: 'solapi_http_error' });
  });
  it.each([408, 500, 502, 503, undefined])('HTTP %s is not proof of non-acceptance; no automatic retry', status => {
    expect(parseSolapiResult(status, { statusCode: '2000' })).toEqual({ ok: false, state: 'unknown', reason: 'solapi_response_unknown' });
  });
  it('rejects explicit body errors without retaining sensitive upstream fields', () => {
    for (const detail of [{ errorCode: 'private-error', errorMessage: 'private-body' }, { failedMessageList: [{ to: '01012345678', text: 'private-body' }] }]) {
      const result = parseSolapiResult(200, { statusCode: '2000', token: 'private-token', ...detail });
      expect(result).toMatchObject({ ok: false, state: 'failed', reason: 'solapi_rejected' });
      expect(JSON.stringify(result)).not.toMatch(/private-|01012345678/);
    }
  });
  it('bounds streamed replies and cancels a body that exceeds the limit', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65537)); }, cancel });
    expect(await readDeliveryJson(new Response(body))).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('accepts small JSON but returns null for missing or malformed bodies', async () => {
    expect(await readDeliveryJson(Response.json({ statusCode: '2000' }))).toEqual({ statusCode: '2000' });
    expect(await readDeliveryJson(new Response('invalid-private-text'))).toBeNull();
    expect(await readDeliveryJson(new Response(null, { status: 204 }))).toBeNull();
  });
});
