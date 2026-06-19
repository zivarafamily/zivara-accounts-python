// Zivara PWA Service Worker
// Cache-first for static assets, network-first for API calls

const CACHE = 'zivara-v1';
const PRECACHE = [
  '/',
  '/index.html',
  '/logo.png',
  '/manifest.json',
];

// Install — pre-cache shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy:
// - Skip backend API calls → always network
// - JS/CSS/image assets → cache-first
// - HTML navigation → network-first with offline fallback
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Skip non-GET and external origins
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // JS/CSS/images: cache-first
  if (/\.(js|css|png|svg|ico|woff2?)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }))
    );
    return;
  }

  // HTML navigation: network-first, fall back to cached /index.html
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    );
  }
});
