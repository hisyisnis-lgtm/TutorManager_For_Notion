import { afterEach, beforeEach, expect, it, vi } from 'vitest';
let sent, storage;
beforeEach(() => {
  vi.resetModules(); sent = []; storage = new Map();
  vi.stubGlobal('location', { hostname: 'tiantianchinese.com', href: 'https://tiantianchinese.com/?utm_source=youtube' });
  vi.stubGlobal('document', { referrer: '' });
  vi.stubGlobal('history', { state: null, replaceState: vi.fn() });
  vi.stubGlobal('sessionStorage', { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) });
  vi.stubGlobal('navigator', { sendBeacon: vi.fn((url, body) => { sent.push(body); return true; }) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('shares an ephemeral session, records only an allowlisted channel and never sends the page URL', async () => {
  const { createTracker } = await import('./tracker.js');
  const tracker = createTracker('site', 'https://worker.test/analytics/event');
  tracker.track('visit'); tracker.track('lesson_view');
  const a = JSON.parse(await sent[0].text()), b = JSON.parse(await sent[1].text());
  expect(a.sid).toBe(b.sid); expect(a.id).not.toBe(b.id); expect(a.source).toBe('youtube');
  expect(Object.keys(a).sort()).toEqual(['at', 'event', 'id', 'service', 'sid', 'source']);
  expect(new URL(tracker.decorate('https://tiantian-chinese.pages.dev/game/tone')).searchParams.get('ha_sid')).toBe(a.sid);
  expect(tracker.decorate('https://evil.test/game/tone')).toBe('https://evil.test/game/tone');
});
it('respects browser privacy preferences and disables local development traffic', async () => {
  const { createTracker } = await import('./tracker.js');
  navigator.globalPrivacyControl = true;
  createTracker('site', '/analytics/event').track('visit');
  expect(sent).toHaveLength(0);
  navigator.globalPrivacyControl = false;
  location.hostname = 'localhost';
  createTracker('site', '/analytics/event').track('visit');
  expect(sent).toHaveLength(0);
});
it('accepts only fresh cross-service sessions and removes transfer parameters from the URL', async () => {
  const id = crypto.randomUUID();
  location.href = `https://tiantian-chinese.pages.dev/game/tone?ha_sid=${id}&ha_at=${Date.now()}&ha_source=instagram`;
  const { createTracker } = await import('./tracker.js');
  createTracker('tone', '/analytics/event').track('game_enter');
  expect(JSON.parse(await sent[0].text()).sid).toBe(id);
  expect(history.replaceState).toHaveBeenCalled();
  expect(String(history.replaceState.mock.calls[0][2])).not.toContain('ha_sid');
});
