const CACHE_NAME = 'sarah-music-v929';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(['/']))); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => { if (e.request.url.includes('/api/')) return; e.respondWith(caches.match(e.request).then((res) => res || fetch(e.request))); });