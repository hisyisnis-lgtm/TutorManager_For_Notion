import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import { localD1 } from '../tests/helpers/localD1.js';
import {
  listPushNotifications, normalizePushPayload, normalizePushSubscription,
  publishWebPushNotification, removePushSubscription, savePushSubscription,
} from './webPush.js';

let local;
let env;
const subscription = {
  endpoint: 'https://push.example.test/send/device-one',
  expirationTime: null,
  keys: { p256dh: 'A'.repeat(64), auth: 'B'.repeat(24) },
};

beforeEach(() => {
  local = localD1();
  const keys = webpush.generateVAPIDKeys();
  env = { GAME_DB: local.db, VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:test@example.com' };
});
afterEach(() => { local.close(); vi.restoreAllMocks(); });

describe('authenticated Web Push storage and delivery', () => {
  it('rejects non-HTTPS or malformed subscriptions and unsafe target URLs', () => {
    expect(normalizePushSubscription({ ...subscription, endpoint: 'http://push.example.test' })).toBeNull();
    expect(normalizePushPayload({ title: '알림', message: '내용', url: 'https://attacker.invalid' }).url).toBe('/#/notifications');
  });

  it('stores and removes a browser subscription without exposing it in history', async () => {
    expect(await savePushSubscription(env, subscription)).toEqual({ ok: true });
    expect(local.sqlite.prepare('SELECT COUNT(*) count FROM push_subscriptions').get().count).toBe(1);
    expect(await removePushSubscription(env, subscription.endpoint)).toEqual({ ok: true });
    expect(local.sqlite.prepare('SELECT COUNT(*) count FROM push_subscriptions').get().count).toBe(0);
  });

  it('encrypts delivery through web-push, stores 30-day history, and removes expired endpoints', async () => {
    await savePushSubscription(env, subscription);
    const sendNotification = vi.fn(async () => undefined);
    const result = await publishWebPushNotification(env, {
      title: '📅 내일 수업 안내', message: '김학생 14:00 수업', priority: 4, tags: ['calendar'],
    }, { sendNotification });
    expect(result.ok).toBe(true);
    expect(result.delivered).toBe(1);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0][0]).toMatchObject({ endpoint: subscription.endpoint, keys: subscription.keys });
    const delivered = JSON.parse(sendNotification.mock.calls[0][1]);
    expect(delivered.body).toBe('김학생 14:00 수업');
    expect(delivered.url).toBe(`/#/notifications?id=${result.id}`);
    expect((await listPushNotifications(env))[0]).toMatchObject({
      title: '📅 내일 수업 안내', message: '김학생 14:00 수업', url: `/#/notifications?id=${result.id}`,
    });

    const expired = Object.assign(new Error('gone'), { statusCode: 410 });
    await publishWebPushNotification(env, { title: '다음 알림', message: '내용' }, { sendNotification: vi.fn(async () => { throw expired; }) });
    expect(local.sqlite.prepare('SELECT COUNT(*) count FROM push_subscriptions').get().count).toBe(0);
  });
});
