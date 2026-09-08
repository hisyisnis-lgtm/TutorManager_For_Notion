import { describe, it, expect, vi, afterEach } from 'vitest';
import { teacherNotifications } from './notifications.js';
afterEach(() => vi.unstubAllGlobals());
describe('private notification proxy', () => {
  it('requires server topic and credential, never an anonymous fallback', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const response = await teacherNotifications(new Request('https://audit.invalid/notifications'), { NTFY_TOPIC: 'fixture' }, {});
    expect(response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('ignores client-selected topics and keeps the credential upstream', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"event":"message","message":"fixture","topic":"private-fixture","attachment":{"url":"https://private.invalid/file"}}\n')); vi.stubGlobal('fetch', fetch);
    const response = await teacherNotifications(new Request('https://audit.invalid/notifications?topic=attacker'), { NTFY_TOPIC: 'private-fixture', NTFY_TOKEN: 'synthetic-credential' }, {});
    const text = await response.text();
    expect(JSON.parse(text).message).toBe('fixture');
    expect(text).not.toContain('private');
    expect(fetch.mock.calls[0][0]).toBe('https://ntfy.sh/private-fixture/json?poll=1&since=24h');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer synthetic-credential');
    expect(fetch.mock.calls[0][1].redirect).toBe('error');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('filters split SSE chunks while preserving Korean notification text', async () => {
    const bytes = new TextEncoder().encode('event: message\ndata: {"event":"message","message":"학생 숙제 제출","topic":"private-fixture","actions":[{"url":"https://private.invalid"}]}\n\n');
    const body = new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 60)); c.enqueue(bytes.slice(60)); c.close(); } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    const response = await teacherNotifications(new Request('https://audit.invalid/notifications?stream=1'), { NTFY_TOPIC: 'fixture', NTFY_TOKEN: 'synthetic' }, {});
    const text = await response.text();
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(text).toContain('학생 숙제 제출');
    expect(text).toMatch(/^data: .*\n\n$/);
    expect(text).not.toContain('private');
  });
});
