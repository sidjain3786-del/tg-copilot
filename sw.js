const CACHE = 'trader-copilot-v9';
const APP_SHELL = ['/', '/index.html', '/style.css', '/theme.css', '/app.js', '/vendor/jspdf.umd.min.js', '/vendor/jspdf.plugin.autotable.min.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];
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

// ---- Quote of the Day notifications ----
// The server sends an empty push; we fetch the newest quote and show it.
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let body = 'Aaj ka naya quote aaya hai — padhne ke liye tap karo.';
    try {
      const res = await fetch('/api/quotes?limit=1', { credentials: 'same-origin', cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.today) body = `“${data.today.text}”${data.today.author ? ' — ' + data.today.author : ''}`;
      }
    } catch (_) {}
    await self.registration.showNotification('💬 Quote of the Day', {
      body, icon: '/icon-192.png', badge: '/icon-192.png', tag: 'quote-of-the-day', renotify: true,
      data: { url: '/#copilot' }
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
