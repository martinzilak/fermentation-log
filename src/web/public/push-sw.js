// Web Push in the service worker (SPEC §9), loaded by the generated worker.
// iOS revokes permission for a push that shows nothing, so every push shows a
// notification. A tap opens the batch, in the app if it is already open.
self.addEventListener('push', (event) => {
  let notice = {};
  try {
    notice = event.data ? event.data.json() : {};
  } catch {
    notice = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(notice.title || 'Fermentation Log', {
      body: notice.body || '',
      tag: notice.tag,
      icon: '/icon-192.png',
      data: { url: notice.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => 'focus' in w);
      if (!open) return self.clients.openWindow(url);
      return open.focus().then((w) => (w.url === url ? w : w.navigate(url)));
    }),
  );
});
