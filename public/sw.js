// Service worker: shows push notifications and opens the right page when clicked.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Inkmule Proofs', body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Inkmule Proofs', {
    body: data.body || '',
    icon: '/img/icon-192.png',
    badge: '/img/icon-192.png',
    tag: data.tag,
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url === url && 'focus' in w) return w.focus();
    }
    const same = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (same && 'navigate' in same) { await same.navigate(url); return same.focus(); }
    return self.clients.openWindow(url);
  })());
});
