import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeNotion, NotionResponseError } from './notion.js';

const strict = () => makeNotion('synthetic-only', { strict: true, backoffMs: [0, 0] });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('strict Notion responses for notice and booking', () => {
  it.each([400, 401, 403, 404, 409, 422])('rejects HTTP %s once without exposing upstream content', async status => {
    const fetch = vi.fn(async () => Response.json({ object: 'error', status, message: 'private synthetic upstream detail' }, { status }));
    vi.stubGlobal('fetch', fetch);
    const request = strict()('POST', '/pages', {});
    await expect(request).rejects.toBeInstanceOf(NotionResponseError);
    await expect(request).rejects.toMatchObject({ status, message: '요청을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed successful response instead of returning empty data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>private synthetic detail</html>', { status: 200 })));
    await expect(strict()('GET', '/pages/fixture')).rejects.toBeInstanceOf(NotionResponseError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a Notion error object even if the HTTP response is successful', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ object: 'error', code: 'validation_error', message: 'private synthetic detail' })));
    await expect(strict()('POST', '/databases/fixture/query', {})).rejects.toBeInstanceOf(NotionResponseError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves a valid empty query result', async () => {
    const empty = { object: 'list', results: [], has_more: false, next_cursor: null };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(empty)));
    await expect(strict()('POST', '/databases/fixture/query', {})).resolves.toEqual(empty);
  });

  it('keeps the existing transient retry schedule and accepts recovery', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('temporary', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ object: 'error' }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ id: 'accepted-page' }));
    vi.stubGlobal('fetch', fetch);
    await expect(strict()('POST', '/pages', {})).resolves.toEqual({ id: 'accepted-page' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('reports an exhausted transient failure without returning upstream data', async () => {
    const fetch = vi.fn(async () => new Response('private synthetic detail', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    await expect(strict()('GET', '/pages/fixture')).rejects.toMatchObject({ status: 503, message: '요청을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
