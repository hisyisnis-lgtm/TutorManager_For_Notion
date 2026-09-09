import webpush from 'web-push';

const HTTPS_ENDPOINT = /^https:\/\/[^\s]{1,2039}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const NOTIFICATIONS_URL = '/#/notifications';
const PWA_ORIGIN = 'https://tiantian-chinese.pages.dev';
const SAFE_NOTIFICATION_URL = /^\/#\/[A-Za-z0-9_?&=/%.-]*$/;
// aes128gcm 단일 레코드의 salt/rs/id/key(86) + delimiter(1) + GCM tag(16).
const MAX_WIRE_JSON_BYTES = 4096 - 103;

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function normalizePushSubscription(raw) {
  const endpoint = cleanText(raw?.endpoint, 2048);
  const p256dh = cleanText(raw?.keys?.p256dh, 512);
  const auth = cleanText(raw?.keys?.auth, 256);
  if (!HTTPS_ENDPOINT.test(endpoint) || !BASE64URL.test(p256dh) || !BASE64URL.test(auth)
    || p256dh.length < 32 || auth.length < 8) return null;
  return { endpoint, expirationTime: Number.isFinite(raw?.expirationTime) ? raw.expirationTime : null, keys: { p256dh, auth } };
}

export function normalizePushPayload(raw) {
  const title = cleanText(raw?.title, 200);
  const message = cleanText(raw?.message ?? raw?.body, 4000);
  if (!title || !message) return null;
  const priority = [1, 2, 3, 4, 5].includes(raw?.priority) ? raw.priority : 4;
  const tags = Array.isArray(raw?.tags)
    ? raw.tags.filter((tag) => typeof tag === 'string').slice(0, 10).map((tag) => tag.slice(0, 64))
    : [];
  const url = typeof raw?.url === 'string' && SAFE_NOTIFICATION_URL.test(raw.url)
    ? raw.url.slice(0, 512)
    : NOTIFICATIONS_URL;
  return { title, message, priority, tags, url };
}

function wireText(value, maxLength) {
  return typeof value === 'string' ? Array.from(value.trim()).slice(0, maxLength)
    // 기존 저장 정규화의 UTF-16 제한에서 끊긴 surrogate도 wire에서는 유효한 문자로 보낸다.
    .map((point) => /[\uD800-\uDFFF]/u.test(point) ? '\uFFFD' : point).join('') : '';
}

function notificationPreview(message) {
  if (!message) return '';
  const firstSection = message.split(/\n\s*\n/, 1)[0].split('\n')
    .map((line, index) => index === 0 ? line.trim() : line.trim().replace(/^[·•-]\s*/, ''))
    .filter(Boolean).join(' · ');
  const points = Array.from(firstSection);
  const clipped = points.length > 120 ? `${points.slice(0, 119).join('').trimEnd()}…` : firstSection;
  return message.length > firstSection.length || points.length > 120
    ? `${clipped}\n눌러서 전체 내용 보기` : clipped;
}

/** 저장된 원문은 변경하지 않고, legacy와 선언형 브라우저에 공통으로 보낼 JSON만 만든다. */
export function serializeWebPushPayload({ id, time, title, body, priority, tags, tag }) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('invalid_push_id');
  // 원본 내부 링크는 D1에 보존하되, 모든 푸시 클릭은 이 알림 자체의 상세 화면으로 통일한다.
  const targetUrl = `${NOTIFICATIONS_URL}?id=${encodeURIComponent(id)}`;
  const nativeUrl = `${PWA_ORIGIN}/?push_notification=${encodeURIComponent(id)}`;
  const fullBody = wireText(body, 4000);
  const wireTitle = wireText(title, 200) || '하늘하늘중국어';
  const wireTag = wireText(tag, 64);
  const payload = {
    id, time: Number.isFinite(time) ? time : 0, title: wireTitle, body: fullBody,
    priority: [1, 2, 3, 4, 5].includes(priority) ? priority : 4,
    tags: Array.isArray(tags) ? tags.filter((value) => typeof value === 'string').slice(0, 10).map((value) => wireText(value, 64)) : [],
    url: targetUrl, tag: wireTag,
    web_push: 8030,
    // mutable를 생략해 지원 브라우저가 SW 실행 없이 표시·클릭 이동을 처리한다.
    notification: {
      title: wireTitle, body: notificationPreview(fullBody), navigate: nativeUrl,
      icon: `${PWA_ORIGIN}/pwa-192x192.png`, badge: `${PWA_ORIGIN}/pwa-64x64.png`,
      tag: wireTag, data: { id, url: targetUrl },
    },
  };
  const encode = () => JSON.stringify(payload);
  const encoder = new TextEncoder();
  const fits = () => encoder.encode(encode()).byteLength <= MAX_WIRE_JSON_BYTES;
  // JSON escaping과 UTF-8 실제 바이트를 기준으로 코드포인트 경계에서 가장 긴 미리보기를 남긴다.
  const fitText = (value, assign) => {
    assign(value);
    if (fits()) return;
    const points = Array.from(value);
    let low = 0;
    let high = points.length - 1;
    let best = '…';
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = `${points.slice(0, middle).join('')}…`;
      assign(candidate);
      if (fits()) { best = candidate; low = middle + 1; } else high = middle - 1;
    }
    assign(best);
  };
  if (!fits()) payload.tags = [];
  if (!fits()) {
    payload.body = '…';
    if (!fits()) {
      // escape가 많은 제목·태그는 본문 없이도 한도를 넘을 수 있다. D1 원문은 그대로 둔다.
      payload.tag = payload.notification.tag = '';
      payload.notification.body = '…';
      fitText(wireTitle, (value) => { payload.title = payload.notification.title = value; });
    }
    fitText(fullBody, (value) => { payload.body = value; });
  }
  if (!fits()) throw new Error('push_payload_too_large');
  return encode();
}

async function endpointHash(endpoint) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function configured(env) {
  return !!(env.GAME_DB && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

export async function savePushSubscription(env, raw) {
  if (!configured(env)) return { ok: false, reason: 'push_not_configured' };
  const subscription = normalizePushSubscription(raw);
  if (!subscription) return { ok: false, reason: 'invalid_subscription' };
  const hash = await endpointHash(subscription.endpoint);
  const now = Math.floor(Date.now() / 1000);
  await env.GAME_DB.prepare(`
    INSERT INTO push_subscriptions (endpoint_hash, endpoint, p256dh, auth, expiration_time, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
    ON CONFLICT(endpoint_hash) DO UPDATE SET
      endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth,
      expiration_time = excluded.expiration_time, updated_at = excluded.updated_at
  `).bind(hash, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth,
    subscription.expirationTime, now).run();
  return { ok: true };
}

export async function removePushSubscription(env, endpoint) {
  if (!env.GAME_DB || !HTTPS_ENDPOINT.test(endpoint || '')) return { ok: false, reason: 'invalid_subscription' };
  await env.GAME_DB.prepare('DELETE FROM push_subscriptions WHERE endpoint_hash = ?1')
    .bind(await endpointHash(endpoint)).run();
  return { ok: true };
}

export async function listPushNotifications(env, limit = 100) {
  if (!env.GAME_DB) return [];
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 100));
  const result = await env.GAME_DB.prepare(`
    SELECT id, created_at AS time, title, message, priority, tags_json, target_url AS url
    FROM push_notifications ORDER BY created_at DESC LIMIT ?1
  `).bind(safeLimit).all();
  return (result.results || []).map((row) => ({
    event: 'message', id: row.id, time: row.time, title: row.title, message: row.message,
    priority: row.priority, tags: JSON.parse(row.tags_json || '[]'), url: row.url,
  }));
}

export async function publishWebPushNotification(env, raw, { sendNotification = webpush.sendNotification.bind(webpush) } = {}) {
  if (!configured(env)) return { ok: false, reason: 'push_not_configured' };
  const payload = normalizePushPayload(raw);
  if (!payload) return { ok: false, reason: 'invalid_notification' };

  const id = crypto.randomUUID();
  const time = Math.floor(Date.now() / 1000);
  const targetUrl = payload.url === NOTIFICATIONS_URL
    ? `${NOTIFICATIONS_URL}?id=${encodeURIComponent(id)}`
    : payload.url;
  await env.GAME_DB.prepare(`
    INSERT INTO push_notifications (id, created_at, title, message, priority, tags_json, target_url)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
  `).bind(id, time, payload.title, payload.message, payload.priority, JSON.stringify(payload.tags), targetUrl).run();
  await env.GAME_DB.prepare('DELETE FROM push_notifications WHERE created_at < ?1')
    .bind(time - 30 * 86400).run();

  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const rows = await env.GAME_DB.prepare('SELECT endpoint_hash, endpoint, p256dh, auth FROM push_subscriptions').all();
  if ((rows.results || []).length === 0) return { ok: false, reason: 'no_subscriptions', delivered: 0, removed: 0, id };
  const dead = [];
  let delivered = 0;
  const message = serializeWebPushPayload({ id, time, title: payload.title, body: payload.message,
    priority: payload.priority, tags: payload.tags, url: targetUrl, tag: `tutor-${id}` });
  await Promise.all((rows.results || []).map(async (row) => {
    try {
      await sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, message, { TTL: 86400, urgency: payload.priority >= 5 ? 'high' : 'normal' });
      delivered += 1;
    } catch (error) {
      const status = Number(error?.statusCode || 0);
      if (status === 404 || status === 410) dead.push(row.endpoint_hash);
      else console.error(JSON.stringify({ event: 'web_push_failed', status: status || 'unknown' }));
    }
  }));
  if (dead.length > 0) {
    await env.GAME_DB.batch(dead.map((hash) => env.GAME_DB.prepare('DELETE FROM push_subscriptions WHERE endpoint_hash = ?1').bind(hash)));
  }
  return delivered > 0
    ? { ok: true, delivered, removed: dead.length, id }
    : { ok: false, reason: 'push_delivery_failed', delivered: 0, removed: dead.length, id };
}

export function webPushConfigured(env) {
  return configured(env);
}
