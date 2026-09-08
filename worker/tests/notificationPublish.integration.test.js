import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNtfyClient, sendAlert } from '../../01_automation/notion_utils.mjs';
import worker from '../src/index.js';
import { localD1 } from './helpers/localD1.js';

let local;
const fakeKey = 'fake-notification-key';
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'test-notification' })));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('NTFY_TOKEN', fakeKey);
  vi.stubEnv('NTFY_TOPIC', 'private-general');
  vi.stubEnv('NTFY_TOPIC_CRITICAL', 'private-critical');
  vi.stubEnv('NTFY_TOPIC_WARN', 'private-warn');
  vi.stubEnv('NTFY_TOPIC_DIGEST', 'private-digest');
  vi.stubGlobal('caches', { default: { match: async () => undefined, put: async () => {} } });
});
afterEach(() => { local?.close(); local = null; vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('all ntfy publishing requires credentials', () => {
  it('legacy automation client and every alert level attach authentication', async () => {
    await createNtfyClient('private-general', fakeKey)('test', 'isolated message');
    for (const level of ['info', 'warn', 'critical', 'digest']) await sendAlert({ level, title: 'test', message: 'isolated message' });
    expect(fetch).toHaveBeenCalledTimes(5);
    for (const [url, options] of fetch.mock.calls) {
      expect(url).toBe('https://ntfy.sh');
      expect(options.headers.Authorization).toBe(`Bearer ${fakeKey}`);
      expect(options.redirect).toBe('error');
    }
  });
  it('missing token never falls back to anonymous publishing or logs message contents', async () => {
    vi.stubEnv('NTFY_TOKEN', '');
    await createNtfyClient('private-general', '')('private-title', 'private-message');
    for (const level of ['info', 'warn', 'critical', 'digest']) {
      expect(await sendAlert({ level, title: 'private-title', message: 'private-message' })).toEqual({ ok: false, reason: 'ntfy_not_configured' });
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(console.error.mock.calls)).not.toMatch(/private-title|private-message|private-general/);
  });
  it('Worker warn alerts authenticate the new topic; missing token suppresses publishing', async () => {
    local = localD1();
    const env = { GAME_DB: local.db, JWT_SECRET: 'test-store-key', NTFY_TOPIC: 'private-general', NTFY_TOPIC_WARN: 'private-warn', NTFY_TOKEN: fakeKey };
    const invoke = () => worker.fetch(new Request('https://worker.test/error-log', {
      method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'isolated error', url: 'https://app.test/game' }),
    }), env, { waitUntil: promise => promise.catch(() => {}) });
    expect((await invoke()).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body).topic).toBe('private-warn');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${fakeKey}`);
    fetch.mockClear();
    delete env.NTFY_TOKEN;
    expect((await invoke()).status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });
});
