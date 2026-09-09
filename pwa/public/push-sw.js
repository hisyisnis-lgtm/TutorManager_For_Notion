self.addEventListener('push', (event) => {
  if (!event.data) return;
  event.waitUntil((async () => {
    let data;
    try { data = event.data.json(); } catch { return; }
    const title = typeof data.title === 'string' ? data.title.slice(0, 200) : '하늘하늘중국어';
    const body = typeof data.body === 'string' ? data.body.slice(0, 4000) : '';
    const url = typeof data.url === 'string' && data.url.startsWith('/#/') ? data.url : '/#/notifications';
    const notification = {
      event: 'message', id: String(data.id || ''), time: Number(data.time) || Math.floor(Date.now() / 1000),
      title, message: body, priority: Number(data.priority) || 4,
      tags: Array.isArray(data.tags) ? data.tags.slice(0, 10) : [], url,
    };
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach((client) => client.postMessage({ type: 'teacher-push', notification }));
    await self.registration.showNotification(title, {
      body, icon: '/pwa-192x192.png', badge: '/pwa-64x64.png',
      tag: typeof data.tag === 'string' ? data.tag : undefined,
      data: { url },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || '/#/notifications', self.location.origin);
    if (target.origin !== self.location.origin) target.href = `${self.location.origin}/#/notifications`;
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if ('navigate' in client) await client.navigate(target.href);
      if ('focus' in client) return client.focus();
    }
    return self.clients.openWindow(target.href);
  })());
});
