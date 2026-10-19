/* Service worker de l'APPLICATION ADMIN (installable). Il est enregistré avec la portée « /admin/ » uniquement :
   il ne touche jamais à l'application principale (qui a son propre service-worker.js). Les données admin (API) ne sont
   jamais mises en cache : seule la coque de la page l'est, pour un démarrage rapide et un secours hors-ligne. */
const CACHE_NAME = 'ficheprobot-admin-cache-v4';
const FILES_TO_CACHE = [
  '/admin/',
  '/admin-manifest.json',
  '/icon-admin-192.png',
  '/icon-admin-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Réseau d'abord (données fraîches), secours sur le cache si hors-ligne.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && FILES_TO_CACHE.includes(url.pathname)) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === 'navigate') {
          const shell = await caches.match('/admin/', { ignoreSearch: true });
          if (shell) return shell;
        }
        return new Response('Hors-ligne', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      })
  );
});
