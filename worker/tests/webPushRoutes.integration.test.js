import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import worker from '../src/index.js';
import { publishWebPushNotification } from '../lib/webPush.js';
import { localD1 } from './helpers/localD1.js';

let local;
let env;
const origin = 'http://localhost:5173';
const ctx = { waitUntil: (promise) => promise.catch(() => {}) };

beforeEach(() => {
  local = localD1();
  const vapid = webpush.generateVAPIDKeys();
  env = {
    GAME_DB: local.db,
    JWT_SECRET: 'test-jwt-secret-that-is-long-enough',
    AUTH_PASSWORD: 'teacher-password',
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: 'mailto:test@example.com',
    PUSH_PUBLISH_TOKEN: 'push-publish-secret',
  };
  vi.stubGlobal('caches', { default: { match: async () => undefined, put: async () => {} } });
});
afterEach(() => { local.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function teacherToken() {
  const response = await worker.fetch(new Request('https://worker.test/auth/login', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'teacher-password' }),
  }), env, ctx);
  return (await response.json()).token;
}

describe('Web Push routes', () => {
  it('requires a teacher session to read configuration and register a device', async () => {
    const unauthorized = await worker.fetch(new Request('https://worker.test/push/config', {
      headers: { Origin: origin },
    }), env, ctx);
    expect(unauthorized.status).toBe(401);

    const token = await teacherToken();
    const config = await worker.fetch(new Request('https://worker.test/push/config', {
      headers: { Origin: origin, Authorization: `Bearer ${token}` },
    }), env, ctx);
    expect(await config.json()).toEqual({ configured: true, publicKey: env.VAPID_PUBLIC_KEY });

    const subscription = {
      endpoint: 'https://push.example.test/send/device-one',
      expirationTime: null,
      keys: { p256dh: 'A'.repeat(64), auth: 'B'.repeat(24) },
    };
    const saved = await worker.fetch(new Request('https://worker.test/push/subscription', {
      method: 'POST',
      headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription),
    }), env, ctx);
    expect(saved.status).toBe(200);
    expect(local.sqlite.prepare('SELECT COUNT(*) count FROM push_subscriptions').get().count).toBe(1);
  });

  it('rejects unauthenticated publishers and returns authenticated D1 history', async () => {
    const denied = await worker.fetch(new Request('https://worker.test/push/publish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '비공개', message: '상세 내용' }),
    }), env, ctx);
    expect(denied.status).toBe(401);

    await publishWebPushNotification(env, { title: '📋 아침 브리핑', message: '오늘 수업 2건' }, {
      sendNotification: vi.fn(async () => undefined),
    });
    const token = await teacherToken();
    const history = await worker.fetch(new Request('https://worker.test/notifications', {
      headers: { Origin: origin, Authorization: `Bearer ${token}` },
    }), env, ctx);
    expect(history.status).toBe(200);
    expect(await history.text()).toContain('오늘 수업 2건');
    expect(history.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
