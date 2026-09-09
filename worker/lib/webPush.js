import webpush from 'web-push';

const HTTPS_ENDPOINT = /^https:\/\/[^\s]{1,2039}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const NOTIFICATIONS_URL = '/#/notifications';

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
  const url = typeof raw?.url === 'string' && /^\/#\/[A-Za-z0-9_?&=/%.-]*$/.test(raw.url)
    ? raw.url.slice(0, 512)
    : NOTIFICATIONS_URL;
  return { title, message, priority, tags, url };
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
  const message = JSON.stringify({ id, time, title: payload.title, body: payload.message,
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
