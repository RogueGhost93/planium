/**
 * Module: Service Worker
 * Purpose: Offline capability, differentiated caching strategies, update notification
 * Dependencies: none
 *
 * Caching strategies:
 *   APP_SHELL (HTML + critical JS/CSS): Stale-While-Revalidate
 *     → Instant render from cache, update in background
 *   PAGE_MODULES (page JS): Stale-While-Revalidate
 *     → Navigation stays fast, new modules are loaded in background
 *   ASSETS (images, icons): Cache-First, 30-day TTL
 *   API: Always network (no caching of user data)
 */

const SHELL_CACHE   = 'planium-shell-v113';
const PAGES_CACHE   = 'planium-pages-v113';
const ASSETS_CACHE  = 'planium-assets-v113';
const ALL_CACHES    = [SHELL_CACHE, PAGES_CACHE, ASSETS_CACHE];

// App shell: needed immediately for first render
const APP_SHELL = [
  '/',
  '/index.html',
  '/api.js',
  '/router.js',
  '/i18n.js',
  '/rrule-ui.js',
  '/locales/en.json',
  '/sw-register.js',
  '/lucide.min.js',
  '/styles/tokens.css',
  '/styles/reset.css',
  '/styles/pwa.css',
  '/styles/layout.css',
  '/styles/login.css',
  '/styles/dashboard.css',
  '/styles/tasks.css',
  '/styles/lists.css',
  '/styles/meals.css',
  '/styles/calendar.css',
  '/styles/news.css',
  '/styles/notes.css',
  '/styles/contacts.css',
  '/styles/budget.css',
  '/styles/settings.css',
  '/styles/notifications.css',
  '/components/planium-install-prompt.js',
  '/components/task-notifications.js',
  '/offline.html',
  '/manifest.json',
  '/favicon.ico',
  '/icons/favicon-32.png',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
];

// Page modules: lazily loaded, but pre-cached for offline use
const PAGE_MODULES = [
  '/pages/dashboard.js',
  '/pages/tasks.js',
  '/pages/lists.js',
  '/pages/meals.js',
  '/pages/calendar.js',
  '/pages/news.js',
  '/pages/notes.js',
  '/pages/contacts.js',
  '/pages/budget.js',
  '/pages/settings.js',
  '/pages/login.js',
];

// --------------------------------------------------------
// Install: pre-cache app shell + page modules
// --------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then((c)  => c.addAll(APP_SHELL)),
      caches.open(PAGES_CACHE).then((c)  => c.addAll(PAGE_MODULES)),
    ])
  );
  // Activate immediately without waiting for existing clients
  self.skipWaiting();
});

// --------------------------------------------------------
// Activate: delete old cache versions + notify clients
// --------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !ALL_CACHES.includes(key))
          .map((key) => caches.delete(key))
      )
    ).then(() => {
      self.clients.claim();
      // Notify all open tabs about the update
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'SW_UPDATED' }));
      });
    })
  );
});

// --------------------------------------------------------
// Fetch: strategy based on request type
// --------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API: always network - never cache user data
  if (url.pathname.startsWith('/api/')) return;

  // Only cache GET requests
  if (request.method !== 'GET') return;

  // Navigation requests: Network-first, fallback to cached shell
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  // Images + fonts: Cache-First, long TTL - same-origin only
  // Do not intercept cross-origin assets (e.g. weather icons from openweathermap.org):
  // opaque responses cause rendering errors in PWA mode.
  if (isAsset(url.pathname) && url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, ASSETS_CACHE));
    return;
  }

  // Page modules (/pages/*.js): Stale-While-Revalidate
  if (url.pathname.startsWith('/pages/')) {
    event.respondWith(staleWhileRevalidate(request, PAGES_CACHE));
    return;
  }

  // App shell (JS, CSS): Stale-While-Revalidate
  event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
});

// --------------------------------------------------------
// Strategy: Network-First (for navigation requests)
// Tries network, falls back to cached shell (offline).
// --------------------------------------------------------
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline: serve cached shell
    const cached = await cache.match(request);
    if (cached) return cached;

    // Fallback to index.html (SPA routing)
    const shell = await cache.match('/index.html');
    if (shell) return shell;

    // Last resort: offline page
    const offline = await caches.match('/offline.html');
    if (offline) return offline;

    return new Response('Keine Verbindung', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

// --------------------------------------------------------
// Strategy: Stale-While-Revalidate
// Serves immediately from cache, updates in background.
// Falls back to network when not cached; falls back to
// index.html for navigation requests (offline SPA).
// --------------------------------------------------------
async function staleWhileRevalidate(request, cacheName) {
  const cache    = await caches.open(cacheName);
  const cached   = await cache.match(request);

  // Start network request in the background
  const networkPromise = fetch(request).then((response) => {
    if (response.ok && response.type === 'basic') {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  if (cached) {
    // Background update running, return cached version immediately
    networkPromise; // fire-and-forget
    return cached;
  }

  // Not in cache → wait for network
  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;

  // Offline fallback for navigation
  if (request.mode === 'navigate') {
    const shell = await caches.match('/index.html');
    if (shell) return shell;
    const offline = await caches.match('/offline.html');
    if (offline) return offline;
  }

  // Last resort: empty 503 response instead of Promise rejection
  return new Response('Service unavailable', { status: 503 });
}

// --------------------------------------------------------
// Strategy: Cache-First with TTL (for images/fonts)
// --------------------------------------------------------
async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('', { status: 408 });
  }
}

// --------------------------------------------------------
// Helper functions
// --------------------------------------------------------
function isAsset(pathname) {
  return /\.(png|jpg|jpeg|ico|svg|webp|woff2?|gif)$/i.test(pathname);
}
