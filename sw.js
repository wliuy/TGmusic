const CACHE_NAME = 'tgmusic-v5';
const PRECACHE = [
  '/',
  '/manifest.json',
  '/assets/css/tailwind.css',
  '/assets/css/APlayer.min.css',
  '/assets/js/APlayer.min.js',
  '/assets/js/jsmediatags.min.js',
  '/assets/icon.svg',
  '/assets/icon-192.png'
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

  // 页面与静态资源：网络优先，离线才用缓存。缓存优先会导致改了代码刷新还是旧版。
  // 弱网下纯等网络会白屏很久，所以超过 3 秒就先用缓存顶上，网络结果回来再写缓存。
  const network = fetch(request)
    .then((res) => {
      if (res.ok && url.origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(request, copy));
      }
      return res;
    });

  e.respondWith(
    new Promise((resolve) => {
      let settled = false;
      const fallback = () => {
        if (settled) return;
        caches.match(request).then((cached) => {
          const hit = cached || null;
          if (hit && !settled) { settled = true; resolve(hit); }
        });
      };
      const timer = setTimeout(fallback, 3000);
      network
        .then((res) => {
          clearTimeout(timer);
          if (!settled) { settled = true; resolve(res); }
        })
        .catch(() => {
          clearTimeout(timer);
          fallback();
          // 缓存也没有（首次访问 + 断网）就回首页兜底
          caches.match(request).then((cached) => {
            if (!cached && !settled) {
              settled = true;
              resolve(caches.match('/').then((r) => r || Response.error()));
            }
          });
        });
    })
  );
});
