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
    await self.registration.showNotification(title, {
      body, icon: '/pwa-192x192.png', badge: '/pwa-64x64.png',
      tag: typeof data.tag === 'string' ? data.tag : undefined,
      data: { url, id: String(data.id || '') },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || '/#/notifications', self.location.origin);
    if (target.origin !== self.location.origin) target.href = `${self.location.origin}/#/notifications`;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      try {
        const navigated = 'navigate' in client ? await client.navigate(target.href) : null;
        const destination = navigated || client;
        if ('focus' in destination) return await destination.focus();
      } catch {
        // 기존 창 이동이 제한된 브라우저에서는 아래 openWindow 경로를 사용한다.
      }
    }
    return self.clients.openWindow(target.href);
  })());
});
