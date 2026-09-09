self.notificationPreview = function notificationPreview(message) {
  const full = typeof message === 'string' ? message.trim() : '';
  if (!full) return '';
  const firstSection = full.split(/\n\s*\n/, 1)[0]
    .split('\n')
    .map((line, index) => index === 0 ? line.trim() : line.trim().replace(/^[·•-]\s*/, ''))
    .filter(Boolean)
    .join(' · ');
  const clipped = firstSection.length > 120 ? `${firstSection.slice(0, 119).trimEnd()}…` : firstSection;
  return full.length > firstSection.length || firstSection.length > 120
    ? `${clipped}\n눌러서 전체 내용 보기`
    : clipped;
};

self.addEventListener('push', (event) => {
  if (!event.data) return;
  event.waitUntil((async () => {
    let data;
    try { data = event.data.json(); } catch { return; }
    const title = typeof data.title === 'string' ? data.title.slice(0, 200) : '하늘하늘중국어';
    const fullBody = typeof data.body === 'string' ? data.body.slice(0, 4000) : '';
    const body = self.notificationPreview(fullBody);
    const url = typeof data.url === 'string' && data.url.startsWith('/#/') ? data.url : '/#/notifications';
    const notification = {
      event: 'message', id: String(data.id || ''), time: Number(data.time) || Math.floor(Date.now() / 1000),
      title, message: fullBody, priority: Number(data.priority) || 4,
      tags: Array.isArray(data.tags) ? data.tags.slice(0, 10) : [], url,
    };
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach((client) => client.postMessage({ type: 'teacher-push', notification }));
    const nativeTarget = notificationTarget({ url, id: String(data.id || '') });
    if (nativeTarget.hash.startsWith('#/notifications?')) {
      const notificationId = new URLSearchParams(nativeTarget.hash.slice('#/notifications?'.length)).get('id');
      if (notificationId) {
        // 열린 iOS PWA에서도 문서 이동으로 인식하도록 hash가 아닌 query로 운반한다.
        // 앱이 시작·복귀 시 검증해 기존 알림 상세 hash로 한 번만 변환한다.
        nativeTarget.searchParams.set('push_notification', notificationId);
        nativeTarget.hash = '';
      }
    }
    await self.registration.showNotification(title, {
      body, icon: '/pwa-192x192.png', badge: '/pwa-64x64.png',
      tag: typeof data.tag === 'string' ? data.tag : undefined,
      // 지원하는 WebKit은 클릭 이벤트를 거치지 않고 OS가 해당 알림으로 직접 이동한다.
      // 미지원 브라우저는 이 옵션을 무시하고 아래 notificationclick 복구 경로를 사용한다.
      navigate: nativeTarget.href,
      data: { url, id: String(data.id || '') },
    });
    await recordPushDiagnostic('push-shown', {
      targetKind: nativeTarget.searchParams.has('push_notification') ? 'query' : 'hash',
      hasId: !!data.id,
    });
  })());
});

// iOS 홈 화면 앱은 알림 클릭 시 앱을 먼저 켜지만 navigate/openWindow의 URL이나
// 초기 postMessage를 놓칠 수 있다. 본문 없이 클릭 목적지만 보관하고 앱의 수신 확인 후 지운다.
const CLICK_CACHE = 'teacher-push-click-v1';
const CLICK_KEY = new URL('/__teacher-push-click__', self.location.origin).href;
const CLICK_TTL = 10 * 60 * 1000;
let clickStorageOperation = Promise.resolve();
const DIAGNOSTIC_VERSION = '2.47.9';
const DIAGNOSTIC_CACHE = 'teacher-push-diagnostics-v1';
const DIAGNOSTIC_KEY = new URL('/__teacher-push-diagnostics__', self.location.origin).href;
let diagnosticOperation = Promise.resolve();

function cleanDiagnosticEvents(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && ['push-shown', 'notificationclick', 'navigation-error'].includes(item.event)
    && Number.isFinite(item.at) && item.at <= Date.now() && Date.now() - item.at < 86400000)
    .slice(-16).map((item) => ({
      event: item.event, at: item.at,
      targetKind: ['query', 'hash', 'other'].includes(item.targetKind) ? item.targetKind : 'other',
      hasId: item.hasId === true,
    }));
}

// 본문·제목·URL·알림 ID·토큰 없이 고정 종류와 시각만 남기는 기기 로컬 진단.
function recordPushDiagnostic(event, details = {}) {
  diagnosticOperation = diagnosticOperation.catch(() => {}).then(async () => {
    const cache = await caches.open(DIAGNOSTIC_CACHE);
    const response = await cache.match(DIAGNOSTIC_KEY);
    const events = cleanDiagnosticEvents(response ? await response.json().catch(() => []) : []);
    events.push({ event, at: Date.now(), targetKind: details.targetKind, hasId: details.hasId });
    await cache.put(DIAGNOSTIC_KEY, new Response(JSON.stringify(cleanDiagnosticEvents(events))));
  }).catch(() => {});
  return diagnosticOperation;
}

async function pushDiagnosticSnapshot() {
  await diagnosticOperation;
  let events = [];
  let storageReadable = true;
  try {
    const response = await (await caches.open(DIAGNOSTIC_CACHE)).match(DIAGNOSTIC_KEY);
    events = cleanDiagnosticEvents(response ? await response.json() : []);
  } catch { storageReadable = false; }
  let pending = null;
  try {
    const response = await (await caches.open(CLICK_CACHE)).match(CLICK_KEY);
    const value = response ? await response.json() : null;
    if (isValidPendingClick(value)) pending = value;
  } catch { storageReadable = false; }
  return {
    type: 'teacher-push-diagnostics', version: DIAGNOSTIC_VERSION,
    executionState: ['activating', 'activated', 'redundant'].includes(self.serviceWorker?.state) ? self.serviceWorker.state : null,
    storageReadable,
    nativeNavigateSupported: 'navigate' in (self.Notification?.prototype || {}),
    events,
    pending: { present: !!pending, ageMs: pending ? Math.max(0, Date.now() - pending.createdAt) : null },
  };
}

function withClickStorage(operation) {
  const result = clickStorageOperation.then(async () => operation(await caches.open(CLICK_CACHE)));
  // 빠른 연속 클릭과 이전 클릭의 ACK가 새 목적지를 지우지 않도록 저장소 작업을 직렬화한다.
  clickStorageOperation = result.catch(() => {});
  return result;
}

function notificationTarget(data = {}) {
  let target;
  try { target = new URL(data.url || '/#/notifications', self.location.origin); } catch {}
  if (!target || target.origin !== self.location.origin || target.pathname !== '/' || !target.hash.startsWith('#/')) {
    target = new URL('/#/notifications', self.location.origin);
  }
  if (target.hash === '#/notifications' && typeof data.id === 'string' && data.id) {
    target.hash += `?id=${encodeURIComponent(data.id)}`;
  }
  return target;
}

function isTeacherWindow(client) {
  try {
    const url = new URL(client.url);
    return url.origin === self.location.origin && url.pathname === '/'
      && !/^#\/(personal|student|game|intro|pricing|consent|privacy|group-class|bootcamp|book)(?:[/?]|$)/.test(url.hash);
  } catch { return false; }
}

function isValidPendingClick(pending) {
  return !!pending && typeof pending.clickId === 'string' && Number.isFinite(pending.createdAt)
    && Date.now() - pending.createdAt <= CLICK_TTL && pending.createdAt <= Date.now()
    && notificationTarget({ url: pending.url }).href === pending.url;
}

async function readPendingClick(cache) {
  const response = await cache.match(CLICK_KEY);
  if (!response) return null;
  const pending = await response.json().catch(() => null);
  if (!isValidPendingClick(pending)) {
    await cache.delete(CLICK_KEY);
    return null;
  }
  return pending;
}

self.addEventListener('message', (event) => {
  if (!isTeacherWindow(event.source) || event.source.visibilityState === 'hidden') return;
  if (event.data?.type === 'teacher-push-diagnostics-request' && event.ports?.[0]) {
    event.waitUntil(pushDiagnosticSnapshot().then((snapshot) => event.ports[0].postMessage(snapshot)).catch(() => {}));
  } else if (event.data?.type === 'teacher-push-navigation-request' && event.ports?.[0]) {
    event.waitUntil(withClickStorage(readPendingClick).catch(() => null).then((pending) => {
      event.ports[0].postMessage({ type: 'teacher-push-navigation', pending });
    }));
  } else if (event.data?.type === 'teacher-push-navigation-ack') {
    event.waitUntil(withClickStorage(async (cache) => {
      const pending = await readPendingClick(cache);
      if (pending?.clickId === event.data.clickId) await cache.delete(CLICK_KEY);
    }).catch(() => {}));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.waitUntil(recordPushDiagnostic('notificationclick', { targetKind: 'hash', hasId: !!event.notification.data?.id }));
  event.notification.close();
  event.waitUntil((async () => {
    const target = notificationTarget(event.notification.data);
    const pending = { url: target.href, clickId: crypto.randomUUID(), createdAt: Date.now() };
    await withClickStorage((cache) => cache.put(CLICK_KEY, new Response(JSON.stringify(pending)))).catch(() => {});
    const notify = (client) => client?.postMessage({ type: 'teacher-push-navigation', pending });
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const candidates = windows.filter(isTeacherWindow).sort((a, b) =>
      Number(b.focused) - Number(a.focused)
      || Number(b.visibilityState === 'visible') - Number(a.visibilityState === 'visible'));
    for (const client of candidates) {
      let destination;
      try { destination = await client.focus(); } catch {
        event.waitUntil(recordPushDiagnostic('navigation-error', { targetKind: 'hash', hasId: !!event.notification.data?.id }));
        // iOS의 막 생성된 창은 focus가 거부돼도 곧 메시지를 받을 수 있다.
        try { notify(client); } catch {}
        continue;
      }
      // 포커스 성공과 주소 이동 실패를 분리한다. 시작 중인 iOS 창은 navigate가 거부될 수 있다.
      try { destination = await client.navigate(target.href) || destination; } catch {
        event.waitUntil(recordPushDiagnostic('navigation-error', { targetKind: 'hash', hasId: !!event.notification.data?.id }));
      }
      try { notify(destination || client); } catch {}
      return;
    }
    // 새 창이 root로 열리거나 postMessage 수신 준비 전이어도 앱의 요청으로 목적지를 복원한다.
    try { notify(await self.clients.openWindow(target.href)); } catch {
      event.waitUntil(recordPushDiagnostic('navigation-error', { targetKind: 'hash', hasId: !!event.notification.data?.id }));
    }
  })());
});
