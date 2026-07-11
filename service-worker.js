// canyou PWA Service Worker
const CACHE_NAME = 'canyou-v1.0';
const urlsToCache = [
  '/',
  '/images/logo.png',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => 
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request).then(fetchRes => {
        if (!fetchRes || fetchRes.status !== 200 || fetchRes.type !== 'basic') return fetchRes;
        const responseClone = fetchRes.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        return fetchRes;
      }).catch(() => caches.match('/')))
  );
});
