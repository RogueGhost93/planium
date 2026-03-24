/**
 * Modul: Service Worker
 * Zweck: Offline-Fähigkeit (App-Shell-Caching), Hintergrund-Sync
 * Abhängigkeiten: keine
 */

const CACHE_NAME = 'oikos-v1';

// App-Shell-Ressourcen, die offline verfügbar sein sollen
const APP_SHELL = [
  '/',
  '/index.html',
  '/api.js',
  '/router.js',
  '/styles/tokens.css',
  '/styles/reset.css',
  '/styles/layout.css',
  '/styles/login.css',
  '/manifest.json',
];

// --------------------------------------------------------
// Install: App-Shell cachen
// --------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// --------------------------------------------------------
// Activate: Alte Caches löschen
// --------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// --------------------------------------------------------
// Fetch: Netzwerk-First für API, Cache-First für App-Shell
// --------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API-Requests: immer Netzwerk (kein Caching von Nutzerdaten)
  if (url.pathname.startsWith('/api/')) {
    return; // Browser übernimmt
  }

  // App-Shell: Cache-First, Fallback Netzwerk
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => {
        // Offline-Fallback für Seiten-Navigation
        if (request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
