const CACHE = 'trader-copilot-v12';
const APP_SHELL = ['/', '/index.html', '/style.css', '/theme.css', '/app.js', '/vendor/jspdf.umd.min.js', '/vendor/jspdf.plugin.autotable.min.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-192.png', '/icon-maskable-512.png', '/apple-touch-icon.png', '/favicon-32.png', '/badge-96.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then(r => r || caches.match('/index.html'))));
});

// ---- Notifications (Quote of the Day, announcements) ----
// The server sends an empty push; we ask the server what it was about and show that.
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let n = { title: 'Trader Co-Pilot', body: 'Naya update aaya hai — dekhne ke liye tap karo.', url: '/', tag: 'tc-update' };
    try {
      const res = await fetch('/api/notify/latest', { credentials: 'same-origin', cache: 'no-store' });
      if (res.ok) n = { ...n, ...(await res.json()) };
    } catch (_) {}
    await self.registration.showNotification(n.title, {
      body: n.body, icon: '/icon-192.png', badge: '/badge-96.png', tag: n.tag || 'tc-update', renotify: true, data: { url: n.url || '/' }
    });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) { if (c.navigate) c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
