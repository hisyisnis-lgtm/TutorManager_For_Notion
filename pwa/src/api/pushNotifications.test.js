import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureSession } from './authFixtures.js';
import { setAuth } from './authUtils.js';
import { disablePushNotifications, enablePushNotifications, getPushStatus } from './pushNotifications.js';

const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
const originalPushManager = window.PushManager;
const originalNotification = window.Notification;

let subscription;
let registration;

beforeEach(() => {
  localStorage.clear();
  setAuth(fixtureSession());
  subscription = {
    endpoint: 'https://push.example.test/device',
    toJSON: () => ({ endpoint: 'https://push.example.test/device', keys: { p256dh: 'A'.repeat(64), auth: 'B'.repeat(24) } }),
    unsubscribe: vi.fn(async () => true),
  };
  registration = {
    pushManager: {
      getSubscription: vi.fn(async () => null),
      subscribe: vi.fn(async () => subscription),
    },
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve(registration) },
  });
  window.PushManager = function PushManager() {};
  window.Notification = {
    permission: 'default',
    requestPermission: vi.fn(async () => 'granted'),
  };
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalServiceWorker) Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
  else delete navigator.serviceWorker;
  window.PushManager = originalPushManager;
  window.Notification = originalNotification;
});

describe('teacher Web Push client', () => {
  it('gets server VAPID configuration, subscribes, and registers the device with teacher auth', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ configured: true, publicKey: 'AQIDBA' }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    expect(await enablePushNotifications()).toEqual({ state: 'enabled' });
    expect(window.Notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(registration.pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(fetch.mock.calls[1][0]).toContain('/push/subscription');
    expect(fetch.mock.calls[1][1].headers.Authorization).toMatch(/^Bearer /);
    expect(fetch.mock.calls[1][1].body).not.toContain('auth_token');
  });

  it('unsubscribes locally even if the server deletion request fails', async () => {
    registration.pushManager.getSubscription.mockResolvedValue(subscription);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(disablePushNotifications()).rejects.toThrow();
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('restores an existing browser subscription to the server when settings opens', async () => {
    registration.pushManager.getSubscription.mockResolvedValue(subscription);
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ configured: true, publicKey: 'AQIDBA' }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    expect(await getPushStatus()).toEqual({ state: 'enabled' });
    expect(fetch.mock.calls[1][0]).toContain('/push/subscription');
  });
});
