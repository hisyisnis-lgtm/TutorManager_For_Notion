import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import { createECDH, randomBytes } from 'node:crypto';
import { localD1 } from '../tests/helpers/localD1.js';
import {
  listPushNotifications, normalizePushPayload, normalizePushSubscription,
  publishWebPushNotification, removePushSubscription, savePushSubscription, serializeWebPushPayload,
} from './webPush.js';

let local;
let env;
const subscription = {
  endpoint: 'https://push.example.test/send/device-one',
  expirationTime: null,
  keys: { p256dh: 'A'.repeat(64), auth: 'B'.repeat(24) },
};
const PWA_ORIGIN = 'https://tiantian-chinese.pages.dev';
const wireInput = {
  id: 'qa-notification-id', time: 1700000000, title: '📅 일일 리포트', body: '수업 2건을 확인해 주세요.',
  priority: 4, tags: ['calendar'], url: '/#/notifications?id=qa-notification-id', tag: 'tutor-qa-notification-id',
};

function encryptedRequest(message) {
  const receiver = createECDH('prime256v1');
  const key = receiver.generateKeys().toString('base64url');
  return webpush.generateRequestDetails({ endpoint: subscription.endpoint,
    keys: { p256dh: key, auth: randomBytes(16).toString('base64url') } }, message, {
    contentEncoding: 'aes128gcm',
    vapidDetails: { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
  });
}

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
    expect(delivered.web_push).toBe(8030);
    expect(delivered.notification.navigate).toBe(`${PWA_ORIGIN}/?push_notification=${result.id}`);
    expect((await listPushNotifications(env))[0]).toMatchObject({
      title: '📅 내일 수업 안내', message: '김학생 14:00 수업', url: `/#/notifications?id=${result.id}`,
    });

    const expired = Object.assign(new Error('gone'), { statusCode: 410 });
    await publishWebPushNotification(env, { title: '다음 알림', message: '내용' }, { sendNotification: vi.fn(async () => { throw expired; }) });
    expect(local.sqlite.prepare('SELECT COUNT(*) count FROM push_subscriptions').get().count).toBe(0);
  });

  it('keeps the full normalized D1 history while only shortening the encrypted wire body and tags', async () => {
    await savePushSubscription(env, subscription);
    const raw = { title: '일일 리포트', message: `오늘 수업 요약\n\n${'가나다라마바사 😀 '.repeat(500)}`,
      priority: 5, tags: Array.from({ length: 10 }, () => '한글태그'.repeat(16)) };
    const original = normalizePushPayload(raw);
    const sendNotification = vi.fn(async () => undefined);
    const result = await publishWebPushNotification(env, raw, { sendNotification });
    const message = sendNotification.mock.calls[0][1];
    const wire = JSON.parse(message);
    expect(result.ok).toBe(true);
    expect(wire.body.length).toBeLessThan(original.message.length);
    expect(wire.body.endsWith('…')).toBe(true);
    expect(wire.notification.body).toBe('오늘 수업 요약\n눌러서 전체 내용 보기');
    expect((await listPushNotifications(env))[0]).toMatchObject({ id: result.id,
      title: original.title, message: original.message, priority: original.priority, tags: original.tags });
    expect(new TextEncoder().encode(message).byteLength).toBeLessThanOrEqual(3993);
    expect(encryptedRequest(message).body.byteLength).toBeLessThanOrEqual(4096);
  });

  it.each(['/#/students/student-1', '/#/notifications?id=previous-id'])('preserves the original internal link only in D1 (%s)', async (url) => {
    await savePushSubscription(env, subscription);
    const sendNotification = vi.fn(async () => undefined);
    const result = await publishWebPushNotification(env, { title: '내 알림', body: '전체 내용', url }, { sendNotification });
    const wire = JSON.parse(sendNotification.mock.calls[0][1]);
    expect(wire.url).toBe(`/#/notifications?id=${result.id}`);
    expect(wire.notification.navigate).toBe(`${PWA_ORIGIN}/?push_notification=${result.id}`);
    expect(wire.notification.data).toEqual({ id: result.id, url: wire.url });
    expect((await listPushNotifications(env))[0]).toMatchObject({ id: result.id, message: '전체 내용', url });
  });
});

describe('immutable declarative Web Push wire format', () => {
  it('keeps all short legacy fields and adds the required native title and exact-ID target without mutating input', () => {
    const input = Object.freeze({ ...wireInput, tags: Object.freeze([...wireInput.tags]) });
    const wire = JSON.parse(serializeWebPushPayload(input));
    expect(wire).toMatchObject(wireInput);
    expect(wire.web_push).toBe(8030);
    expect(wire).not.toHaveProperty('mutable');
    expect(wire.notification).not.toHaveProperty('mutable');
    expect(wire.notification).toEqual({
      title: wireInput.title, body: wireInput.body,
      navigate: `${PWA_ORIGIN}/?push_notification=${wireInput.id}`,
      icon: `${PWA_ORIGIN}/pwa-192x192.png`, badge: `${PWA_ORIGIN}/pwa-64x64.png`,
      tag: wireInput.tag, data: { id: wireInput.id, url: wireInput.url },
    });
    expect(input.tags).toEqual(['calendar']);
  });

  it('always opens this notification ID, even when raw input points to another notification or internal page', () => {
    const fallback = JSON.parse(serializeWebPushPayload({ ...wireInput, url: '/#/notifications' }));
    expect(fallback.url).toBe(wireInput.url);
    expect(fallback.notification.navigate).toBe(`${PWA_ORIGIN}/?push_notification=${wireInput.id}`);
    const explicit = JSON.parse(serializeWebPushPayload({ ...wireInput, url: '/#/notifications?id=selected-id' }));
    expect(explicit.url).toBe(wireInput.url);
    expect(explicit.notification.navigate).toBe(`${PWA_ORIGIN}/?push_notification=${wireInput.id}`);
    const internal = JSON.parse(serializeWebPushPayload({ ...wireInput, url: '/#/students/student-1' }));
    expect(internal.url).toBe(wireInput.url);
    expect(internal.notification.navigate).toBe(`${PWA_ORIGIN}/?push_notification=${wireInput.id}`);
    expect(internal.notification.data.url).toBe(wireInput.url);
  });

  it.each(['https://attacker.invalid/', '//attacker.invalid/', 'javascript:alert(1)', '/?redirect=https://attacker.invalid',
    '/#/settings\\attacker.invalid', '/#/notifications\n'])('rejects raw external or malformed destinations (%s)', (url) => {
    const wire = JSON.parse(serializeWebPushPayload({ ...wireInput, url, origin: 'https://attacker.invalid' }));
    expect(wire.url).toBe(wireInput.url);
    expect(wire.notification.navigate).toBe(`${PWA_ORIGIN}/?push_notification=${wireInput.id}`);
    expect(new URL(wire.notification.navigate).origin).toBe(PWA_ORIGIN);
    expect(JSON.stringify(wire)).not.toContain('attacker.invalid');
  });

  it('always provides a visible title, validates IDs, and compacts multi-line previews', () => {
    const wire = JSON.parse(serializeWebPushPayload({ ...wireInput, title: '   ', body: '📅 오늘 수업\n• 수업 2건\n- 상담 1건\n\n상세 본문' }));
    expect(wire.notification.title).toBe('하늘하늘중국어');
    expect(wire.notification.body).toBe('📅 오늘 수업 · 수업 2건 · 상담 1건\n눌러서 전체 내용 보기');
    expect(() => serializeWebPushPayload({ ...wireInput, id: '../other' })).toThrow('invalid_push_id');
    expect(() => serializeWebPushPayload({ ...wireInput, id: 'a'.repeat(129) })).toThrow('invalid_push_id');
  });

  it('does not put an upstream truncated surrogate on the wire or mutate stored normalization', () => {
    const normalized = normalizePushPayload({ title: `${'a'.repeat(199)}😀`, message: '본문\uD83D' });
    expect(normalized.title).toMatch(/[\uD800-\uDFFF]/u);
    const message = serializeWebPushPayload({ ...wireInput, title: normalized.title, body: normalized.message });
    const wire = JSON.parse(message);
    expect(wire.title.endsWith('\uFFFD')).toBe(true);
    expect(wire.body.endsWith('\uFFFD')).toBe(true);
    expect(wire.title).not.toMatch(/[\uD800-\uDFFF]/u);
    expect(wire.body).not.toMatch(/[\uD800-\uDFFF]/u);
    expect(normalized.title).toMatch(/[\uD800-\uDFFF]/u);
  });

  it.each([
    ['한글', { title: '제'.repeat(200), body: '가나다라마바사'.repeat(1000), tags: Array(10).fill('태'.repeat(64)) }],
    ['emoji', { title: '😀'.repeat(200), body: '🧑‍🏫📅😊'.repeat(1000), tags: Array(10).fill('📅'.repeat(64)) }],
    ['JSON escapes', { title: '\u0001'.repeat(200), body: '\u0002"\\\n'.repeat(1000), tags: Array(10).fill('\u0003'.repeat(64)),
      url: `/#/settings?detail=${'a'.repeat(600)}`, tag: '\u0004'.repeat(64) }],
    ['URL expansion', { id: 'a'.repeat(128), title: '\u0001'.repeat(200), body: '내역'.repeat(2000),
      url: `/#/notifications?id=${'%'.repeat(600)}`, tag: '\u0002'.repeat(64) }],
  ])('keeps real encrypted requests within 4096 bytes for maximal %s payloads', (_label, overrides) => {
    const message = serializeWebPushPayload({ ...wireInput, ...overrides });
    const wire = JSON.parse(message);
    const bytes = new TextEncoder().encode(message).byteLength;
    const request = encryptedRequest(message);
    expect(bytes).toBeLessThanOrEqual(3993);
    expect(request.body.byteLength).toBe(bytes + 103);
    expect(request.body.byteLength).toBeLessThanOrEqual(4096);
    expect(request.headers['Content-Encoding']).toBe('aes128gcm');
    expect(wire.notification.title.trim()).not.toBe('');
    expect(new URL(wire.notification.navigate).origin).toBe(PWA_ORIGIN);
    for (const text of [wire.body, wire.title, wire.notification.body, wire.notification.title]) {
      expect(text).not.toMatch(/[\uD800-\uDFFF]/u);
    }
  });

  it('uses the full 3993-byte JSON budget without crossing the encrypted 4096-byte boundary', () => {
    const message = serializeWebPushPayload({ ...wireInput, body: 'a'.repeat(4000) });
    expect(new TextEncoder().encode(message).byteLength).toBe(3993);
    expect(encryptedRequest(message).body.byteLength).toBe(4096);
  });
});
