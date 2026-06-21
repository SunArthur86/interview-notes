// AI Interview — Service Worker
const CACHE_NAME = 'interview-notes-v1';
const STATIC_ASSETS = [
    './',
    './index.html',
    './config.js',
    './manifest.json',
    './css/style.css',
    './css/study.css',
    './css/forgetting.css',
    './js/app.js',
    './js/study.js',
    './js/forgetting.js',
    './data/java.json',
    './data/ai.json',
    './data/algorithm.json',
    './data/system-design.json',
    './data/database.json',
    './data/frontend.json',
    './data/other.json'
  ];

// Install — cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate — clean old cache
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — cache-first for static, stale-while-revalidate for data
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only handle same-origin
  if (url.origin !== self.location.origin) return;
  // Data files — stale-while-revalidate
  if (url.pathname.includes('/data/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(event.request);
        const fetchPromise = fetch(event.request).then(response => {
          cache.put(event.request, response.clone());
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }
  // Static — cache-first
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).catch(() => caches.match('./index.html'))
    )
  );
});
