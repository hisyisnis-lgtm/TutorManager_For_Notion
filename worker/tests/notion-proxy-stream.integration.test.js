import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { signTypedToken } from '../lib/auth.js';

const DB = '314838fa-f2a6-8154-935b-edd3d2fbea83';
const SECRET = 'isolated-proxy-stream-jwt-secret';
let token;
const env = { JWT_SECRET: SECRET, NOTION_TOKEN: 'synthetic-only' };
const ctx = { waitUntil: promise => promise.catch(() => {}) };
const send = (path = `/v1/databases/${DB}/query`, bearer = token) => worker.fetch(new Request(`https://fixture.invalid${path}`, {
  method: 'POST', headers: { Origin: 'http://localhost:5173', Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ page_size: 100 }),
}), env, ctx);

beforeEach(async () => { token = await signTypedToken(SECRET, 'teacher', 'teacher', 600, { role: 'teacher' }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('authenticated Notion proxy streaming', () => {
  it('returns and forwards the first chunk before the upstream body finishes', async () => {
    let controller;
    const upstream = new Response(new ReadableStream({ start(value) { controller = value; } }));
    const readWholeBody = vi.spyOn(upstream, 'text');
    const encoder = new TextEncoder();
    controller.enqueue(encoder.encode('{"results":['));
    vi.stubGlobal('fetch', vi.fn(async () => upstream));
    let response;
    const pending = send().then(value => { response = value; });
    try {
      await vi.waitFor(() => expect(response).toBeDefined());
      expect(readWholeBody).not.toHaveBeenCalled();
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
      const reader = response.body.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('{"results":[');
      controller.enqueue(encoder.encode('{"id":"synthetic"}]}'));
      controller.close();
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('{"id":"synthetic"}]}');
      expect((await reader.read()).done).toBe(true);
      reader.releaseLock();
    } finally {
      try { controller.close(); } catch { /* Already closed after successful forwarding. */ }
      await pending;
    }
  });

  it.each([200, 400, 403, 503])('preserves HTTP %s and the exact upstream body', async status => {
    const body = status === 200 ? '{"results":[],"has_more":false}' : '{"object":"error","message":"synthetic failure"}';
    const upstream = new Response(body, { status });
    const wholeBody = vi.spyOn(upstream, 'text');
    vi.stubGlobal('fetch', vi.fn(async () => upstream));
    const response = await send();
    expect(response.status).toBe(status);
    expect(await response.text()).toBe(body);
    expect(wholeBody).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves projection query parameters without forwarding upstream secrets', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"results":[]}', {
      headers: { 'Set-Cookie': 'upstream-only=synthetic', 'X-Upstream-Debug': 'private-synthetic' },
    })));
    const response = await send(`/v1/databases/${DB}/query?filter_properties=a&filter_properties=b`);
    expect(new URL(fetch.mock.calls[0][0]).searchParams.getAll('filter_properties')).toEqual(['a', 'b']);
    expect(response.headers.has('Set-Cookie')).toBe(false);
    expect(response.headers.has('X-Upstream-Debug')).toBe(false);
    expect(await response.json()).toEqual({ results: [] });
  });

  it('cancels each discarded 429 body and keeps final retry metadata', async () => {
    vi.useFakeTimers();
    const cancelled = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"object":"error"}')); },
      cancel: cancelled,
    }), { status: 429, headers: { 'Retry-After': '1' } })));
    const pending = send();
    for (let attempt = 1; attempt <= 3; attempt++) {
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(attempt));
      await vi.waitFor(() => expect(cancelled).toHaveBeenCalledTimes(attempt));
      await vi.advanceTimersByTimeAsync(1000);
    }
    const response = await pending;
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(cancelled).toHaveBeenCalledTimes(3);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('1');
    expect(response.headers.get('Access-Control-Expose-Headers')).toBe('Retry-After');
    await response.body.cancel();
  });

  it('rejects unauthenticated and foreign database reads without upstream calls', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected network'); }));
    expect((await send(undefined, 'invalid')).status).toBe(401);
    expect((await send('/v1/databases/11111111-1111-1111-1111-111111111111/query')).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});
