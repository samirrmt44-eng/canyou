// Service Worker for School Management School PWA
// Makes the app installable + offline-capable

const CACHE_NAME = 'school-management-v4-CLEAR-OLD-DATA';
const urlsToCache = [
  '/school-portal.html',
  '/school-demo.html',
  '/school-message.html',
  '/manifest.json'
];

// Install: cache essential files + FORCE update
self.addEventListener('install', (event) => {
  console.log('[SW v4] Installing — clearing stale school data');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache).catch(() => {}))
  );
  self.skipWaiting();
});

// Activate: clean up ALL old caches (including v3 with stale data)
self.addEventListener('activate', (event) => {
  console.log('[SW v4] Activating — purging old caches');
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => {
        console.log('[SW v4] Deleting old cache:', k);
        return caches.delete(k);
      })
    )).then(() => {
      // Notify all clients to clear their localStorage of stale school data
      return self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'CLEAR_STALE_DATA', reason: 'SW v4 update' });
        });
      });
    })
  );
  self.clients.claim();
});

// Fetch: network-first, fallback to cache
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/')) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((r) => r || new Response('Offline', { status: 503 })))
  );
});
