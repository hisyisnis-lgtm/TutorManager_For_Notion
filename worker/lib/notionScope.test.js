import { describe, it, expect, vi } from 'vitest';
import { authorizeNotionRequest } from './notionScope.js';
const allowedId = '11111111-1111-1111-1111-111111111111';
const otherId = '22222222-2222-2222-2222-222222222222';
const allowed = new Set([allowedId.replaceAll('-', '')]);
const run = (path, method = 'GET', body, notion = vi.fn()) => {
  const url = new URL(`https://audit.invalid${path}`);
  return authorizeNotionRequest(new Request(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), url, notion, allowed);
};
describe('Notion database boundary', () => {
  it.each(['GET', 'PATCH'])('rejects an unrelated page before %s forwarding', async method => {
    const notion = vi.fn().mockResolvedValue({ parent: { database_id: otherId } });
    expect(await run(`/v1/pages/${otherId}`, method, method === 'PATCH' ? { archived: true } : undefined, notion)).toMatchObject({ ok: false, status: 403 });
    expect(notion).toHaveBeenCalledTimes(1);
    expect(notion.mock.calls[0][0]).toBe('GET');
  });
  it.each([{ page_id: allowedId }, { workspace: true }, { database_id: otherId }, { database_id: allowedId, page_id: otherId }])('denies unapproved creation parent %j', async parent => {
    expect(await run('/v1/pages', 'POST', { parent })).toMatchObject({ ok: false, status: 403 });
  });
  it('permits application database queries and owned pages', async () => {
    expect(await run(`/v1/databases/${allowedId}/query`, 'POST', {})).toMatchObject({ ok: true });
    const page = { id: otherId, parent: { database_id: allowedId } };
    expect(await run(`/v1/pages/${otherId}`, 'GET', undefined, vi.fn().mockResolvedValue(page))).toMatchObject({ ok: true, page });
    expect(await run('/v1/pages', 'POST', { parent: { database_id: allowedId } })).toMatchObject({ ok: true });
  });
  it.each(['/v1/pages/anything', `/v1/pages/${allowedId}/properties/secret`, `/v1/databases/${allowedId}/unexpected`, '/v1/blocks'])('rejects unused routes %s', async path => {
    expect(await run(path)).toMatchObject({ ok: false, status: 403 });
  });
});
