import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://app.example.test';

function loadWorker(overrides = {}, storage = new Map()) {
  const source = readFileSync(resolve(process.cwd(), 'public/push-sw.js'), 'utf8');
  const listeners = {};
  const context = {
    self: {
      addEventListener(type, listener) { listeners[type] = listener; },
      location: { origin: ORIGIN },
      ...overrides,
    },
    URL,
    Response,
    crypto,
    caches: { open: async () => ({
      match: async (key) => storage.get(key)?.clone(),
      put: async (key, value) => storage.set(key, value.clone()),
      delete: async (key) => storage.delete(key),
    }) },
  };
  runInNewContext(source, context);
  return { self: context.self, listeners, storage };
}

async function click(listeners, data = { url: '/#/notifications?id=notice-1' }) {
  let completion;
  listeners.notificationclick({
    notification: { close: vi.fn(), data },
    waitUntil(promise) { completion = promise; },
  });
  await completion;
}

async function message(listeners, data = { type: 'teacher-push-navigation-request' }, url = `${ORIGIN}/#/home`) {
  let completion;
  const reply = vi.fn();
  listeners.message({
    source: { url }, data, ports: [{ postMessage: reply }],
    waitUntil(promise) { completion = promise; },
  });
  await completion;
  return reply.mock.calls[0]?.[0];
}

describe('Web Push system notification preview', () => {
  it('gives the browser a native click destination while preserving the legacy event data', async () => {
    const showNotification = vi.fn(async () => {});
    const { listeners } = loadWorker({
      registration: { showNotification },
      clients: { matchAll: async () => [] },
    });
    let completion;
    listeners.push({
      data: { json: () => ({ id: 'notice-native', title: '일일리포트', body: '첫 줄\n\n둘째 줄', url: '/#/notifications' }) },
      waitUntil(promise) { completion = promise; },
    });
    await completion;

    expect(showNotification).toHaveBeenCalledWith('일일리포트', expect.objectContaining({
      navigate: `${ORIGIN}/#/notifications?id=notice-native&via=push`,
      data: { url: '/#/notifications', id: 'notice-native' },
      body: '첫 줄\n눌러서 전체 내용 보기',
    }));
  });

  it('does not allow native navigation to a URL outside the app origin', async () => {
    const showNotification = vi.fn(async () => {});
    const { listeners } = loadWorker({
      registration: { showNotification }, clients: { matchAll: async () => [] },
    });
    let completion;
    listeners.push({
      data: { json: () => ({ id: 'notice-safe', title: '알림', body: '본문', url: 'https://outside.test/' }) },
      waitUntil(promise) { completion = promise; },
    });
    await completion;
    expect(showNotification.mock.calls[0][1].navigate).toBe(`${ORIGIN}/#/notifications?id=notice-safe&via=push`);
  });

  it('shows one compact section and directs long alerts to the full in-app history', () => {
    const { notificationPreview: preview } = loadWorker().self;
    const message = '[오늘 수업 2건]\n  · 10:00 김학생\n  · 14:00 이학생\n\n[피드백 대기 1건]\n  · 숙제';

    expect(preview(message)).toBe('[오늘 수업 2건] · 10:00 김학생 · 14:00 이학생\n눌러서 전체 내용 보기');
  });

  it('does not add a full-content hint to an already short alert', () => {
    expect(loadWorker().self.notificationPreview('수업이 곧 시작됩니다.')).toBe('수업이 곧 시작됩니다.');
  });

  it('navigates an already open app to the exact notification history item', async () => {
    const client = {
      url: `${ORIGIN}/#/home`,
      navigate: vi.fn(async () => client),
      focus: vi.fn(async () => client),
      postMessage: vi.fn(),
    };
    const openWindow = vi.fn();
    const { listeners } = loadWorker({
      location: { origin: 'https://app.example.test' },
      clients: { matchAll: vi.fn(async () => [client]), openWindow },
    });
    let completion;

    listeners.notificationclick({
      notification: { close: vi.fn(), data: { url: '/#/notifications?id=notice-1' } },
      waitUntil(promise) { completion = promise; },
    });
    await completion;

    expect(client.navigate).toHaveBeenCalledWith('https://app.example.test/#/notifications?id=notice-1');
    expect(client.focus).toHaveBeenCalledTimes(1);
    expect(client.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'teacher-push-navigation',
      pending: expect.objectContaining({ url: `${ORIGIN}/#/notifications?id=notice-1` }),
    }));
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('delivers a pending click even when navigate returns null', async () => {
    const client = {
      url: `${ORIGIN}/#/home`,
      navigate: vi.fn(async () => null),
      postMessage: vi.fn(),
      focus: vi.fn(async () => client),
    };
    const openWindow = vi.fn();
    const { listeners } = loadWorker({
      location: { origin: 'https://app.example.test' },
      clients: { matchAll: vi.fn(async () => [client]), openWindow },
    });
    let completion;

    listeners.notificationclick({
      notification: { close: vi.fn(), data: { url: '/#/notifications?id=notice-2' } },
      waitUntil(promise) { completion = promise; },
    });
    await completion;

    expect(client.postMessage).toHaveBeenCalledWith({
      type: 'teacher-push-navigation',
      pending: expect.objectContaining({ url: `${ORIGIN}/#/notifications?id=notice-2` }),
    });
    expect(client.focus).toHaveBeenCalledTimes(1);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('recovers a cold-start click after the app and service worker restart without receiving the initial message', async () => {
    const openWindow = vi.fn(async () => null); // iOS may only open the root app.
    const worker = loadWorker({ clients: { matchAll: async () => [], openWindow } });
    await click(worker.listeners, { id: 'notice-3' });
    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/#/notifications?id=notice-3`);
    const restarted = loadWorker({}, worker.storage);
    const { pending } = await message(restarted.listeners);
    expect(pending.url).toBe(`${ORIGIN}/#/notifications?id=notice-3`);
    expect(Object.keys(pending).sort()).toEqual(['clickId', 'createdAt', 'url']);
    // 조회나 첫 전달만으로 지우지 않아, 시작 시 잃은 메시지를 다시 받을 수 있다.
    expect((await message(restarted.listeners)).pending).toEqual(pending);
    await message(restarted.listeners, { type: 'teacher-push-navigation-ack', clickId: pending.clickId });
    expect((await message(restarted.listeners)).pending).toBeNull();
  });

  it('keeps the destination when a booting client rejects focus or navigation', async () => {
    const client = {
      url: `${ORIGIN}/#/home`,
      focus: vi.fn(async () => { throw new Error('inert'); }),
      navigate: vi.fn(), postMessage: vi.fn(),
    };
    const openWindow = vi.fn(async () => { throw new Error('not ready'); });
    const { listeners } = loadWorker({ clients: { matchAll: async () => [client], openWindow } });
    await click(listeners);
    expect(openWindow).toHaveBeenCalledTimes(1);
    expect((await message(listeners)).pending.url).toContain('id=notice-1');

    client.focus.mockImplementation(async () => client);
    client.navigate.mockImplementation(async () => { throw new Error('navigate failed'); });
    await click(listeners);
    expect(client.postMessage).toHaveBeenCalledTimes(2);
    expect((await message(listeners)).pending.url).toContain('id=notice-1');
  });

  it('does not remove a newer click when an older acknowledgment arrives', async () => {
    const { listeners } = loadWorker({ clients: { matchAll: async () => [], openWindow: async () => null } });
    await click(listeners);
    const first = (await message(listeners)).pending;
    await Promise.all([
      click(listeners, { id: 'notice-2' }),
      message(listeners, { type: 'teacher-push-navigation-ack', clickId: first.clickId }),
    ]);
    const second = (await message(listeners)).pending;
    expect(second.url).toContain('id=notice-2');
    expect(second.clickId).not.toBe(first.clickId);
  });

  it('does not navigate student windows or expose/consume pending clicks from their requests', async () => {
    const student = { url: `${ORIGIN}/personal/student-1`, focus: vi.fn() };
    const openWindow = vi.fn(async () => null);
    const { listeners } = loadWorker({ clients: { matchAll: async () => [student], openWindow } });
    await click(listeners, { url: 'https://outside.test/', id: 'notice-1' });
    expect(student.focus).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/#/notifications?id=notice-1`);
    for (const url of [student.url, `${ORIGIN}/#/personal/student-1`, 'https://outside.test/']) {
      expect(await message(listeners, undefined, url)).toBeUndefined();
    }
    expect((await message(listeners)).pending).toBeTruthy();
  });

  it('expires pending click metadata instead of reopening old notifications later', async () => {
    const { listeners, storage } = loadWorker({ clients: { matchAll: async () => [], openWindow: async () => null } });
    await click(listeners);
    const key = [...storage.keys()][0];
    const pending = await storage.get(key).json();
    storage.set(key, new Response(JSON.stringify({ ...pending, createdAt: Date.now() - 11 * 60 * 1000 })));
    expect((await message(listeners)).pending).toBeNull();
    expect(storage.size).toBe(0);
  });

  it('ignores a hidden teacher tab so it cannot consume the clicked foreground app destination', async () => {
    const { listeners } = loadWorker({ clients: { matchAll: async () => [], openWindow: async () => null } });
    await click(listeners);
    const reply = vi.fn();
    const waitUntil = vi.fn();
    listeners.message({
      source: { url: `${ORIGIN}/#/home`, visibilityState: 'hidden' },
      data: { type: 'teacher-push-navigation-request' },
      ports: [{ postMessage: reply }], waitUntil,
    });
    expect(reply).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
    expect((await message(listeners)).pending).toBeTruthy();
  });
});
