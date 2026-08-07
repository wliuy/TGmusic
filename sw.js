const CACHE_NAME = 'sarah-music-v2';
const PRECACHE = [
  '/',
  '/manifest.json',
  '/assets/css/tailwind.css',
  '/assets/css/APlayer.min.css',
  '/assets/js/APlayer.min.js',
  '/assets/js/jsmediatags.min.js'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) =>
      Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {})))
    )
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) =>
      Promise.all(ks.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // 歌曲元数据：网络优先，失败时离线兜底
  if (url.pathname === '/api/songs') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put('/api/songs', copy));
          }
          return res;
        })
        .catch(() => caches.match('/api/songs').then((r) => r || Response.error()))
    );
    return;
  }

  // 其余 API（stream/manage/upload/check_auth）不缓存，直接放行
  if (url.pathname.startsWith('/api/')) return;

  // 静态资源：缓存优先，未命中则网络并后台缓存
  e.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy));
        }
        return res;
      });
    })
  );
});
