import { describe, it, expect, vi, afterEach } from 'vitest';
import { teacherNotifications } from './notifications.js';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('authenticated notification proxy', () => {
  it('requires server topic and credential, never an anonymous fallback', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const response = await teacherNotifications(new Request('https://audit.invalid/notifications'), { NTFY_TOPIC: 'fixture' }, {});
    expect(response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('ignores client-selected topics and keeps the credential upstream', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{"event":"message","message":"fixture","topic":"private-fixture","attachment":{"url":"https://private.invalid/file"}}\n')); vi.stubGlobal('fetch', fetch);
    const response = await teacherNotifications(new Request('https://audit.invalid/notifications?topic=attacker'), { NTFY_TOPIC: 'private-fixture', NTFY_TOKEN: 'synthetic-credential' }, {});
    const text = await response.text();
    expect(JSON.parse(text).message).toBe('fixture');
    expect(text).not.toContain('private');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://ntfy.sh/private-fixture/json?poll=1&since=24h');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer synthetic-credential');
    expect(fetch.mock.calls[0][1].redirect).toBe('error');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('filters split SSE chunks while preserving Korean notification text', async () => {
    const bytes = new TextEncoder().encode('event: message\ndata: {"event":"message","message":"학생 숙제 제출","topic":"private-fixture","actions":[{"url":"https://private.invalid"}]}\n\n');
    const body = new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 60)); c.enqueue(bytes.slice(60)); c.close(); } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(body)));
    const response = await teacherNotifications(new Request('https://audit.invalid/notifications?stream=1'), { NTFY_TOPIC: 'fixture', NTFY_TOKEN: 'synthetic' }, {});
    const text = await response.text();
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(text).toContain('학생 숙제 제출');
    expect(text).toMatch(/^data: .*\n\n$/);
    expect(text).not.toContain('private');
  });
  it('reads configured public topics without an account reservation while preserving full text and hiding credentials', async () => {
    const raw = { event: 'message', id: 'report-1', time: 123, title: '일일 리포트',
      message: '[오늘 수업]\n김학생 10:00\n\n[확인 필요]\n숙제 피드백', priority: 2, tags: ['calendar', 'memo'],
      topic: 'public-fixture', token: 'synthetic-credential', key: 'synthetic-key', actions: [{ url: 'https://private.invalid/' }] };
    const fetch = vi.fn(async () => new Response(`${JSON.stringify(raw)}\n`));
    vi.stubGlobal('fetch', fetch);
    const response = await teacherNotifications(new Request('https://audit.invalid/notifications'), { NTFY_TOPIC: 'public-fixture', NTFY_TOKEN: 'synthetic-credential' }, {});
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://ntfy.sh/public-fixture/json?poll=1&since=24h');
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ event: raw.event, id: raw.id, time: raw.time, title: raw.title,
      message: raw.message, priority: raw.priority, tags: raw.tags });
    expect(text).not.toMatch(/public-fixture|synthetic-|private.invalid/);
  });
  it('rejects malformed server topic configuration without sending a request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const response = await teacherNotifications(new Request('https://audit.invalid/notifications'), { NTFY_TOPIC: '../other', NTFY_TOKEN: 'synthetic' }, {});
    expect(response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('still bounds history requests to 15 seconds and hides upstream errors', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('synthetic-secret-topic')), { once: true });
    }));
    vi.stubGlobal('fetch', fetch);
    const pending = teacherNotifications(new Request('https://audit.invalid/notifications'), { NTFY_TOPIC: 'fixture', NTFY_TOKEN: 'synthetic' }, {});
    await vi.advanceTimersByTimeAsync(15000);
    const response = await pending;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('synthetic');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('still rejects upstream responses above the two MiB byte limit', async () => {
    const body = new ReadableStream({ start(output) { output.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); output.close(); } });
    const fetch = vi.fn(async () => new Response(body)); vi.stubGlobal('fetch', fetch);
    const response = await teacherNotifications(new Request('https://audit.invalid/notifications'), { NTFY_TOPIC: 'fixture', NTFY_TOKEN: 'synthetic' }, {});
    await expect(response.text()).rejects.toThrow('알림 응답이 너무 큽니다.');
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
});
