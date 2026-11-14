const CACHE_NAME = 'ficheprobot-cache-v127';
const FILES_TO_CACHE = [
  './index.html',
  './exercices-structuraux-data.js',
  './maths-concretisation-data.js',
  './epreuves.js',
  './integration.js',
  './execution.js',
  './expression-ecrite.js',
  './liste-classe.js',
  './stats-classe.js',
  './calcul-mental-data.js',
  './ready-docx.js',
  './planif-data.js',
  './planif-data-cm1.js',
  './planif-data-cm2.js',
  './planif-data-ce1.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => Promise.all(FILES_TO_CACHE.map((f) => cache.add(f).catch(() => {}))))
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
  // Ne jamais intercepter les requêtes non-GET (POST/PUT/DELETE) ni les appels /api/* :
  // le cache HTTP ne gère que GET, et repasser une requête POST (upload d'image, paiement, etc.)
  // par le service worker peut faire échouer la requête même quand la connexion existe bel et bien.
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  // Réseau d'abord (sans jamais relire une vieille réponse du cache HTTP du navigateur),
  // secours sur le cache uniquement hors-ligne. Seules les réponses 200 sont mises en cache
  // (jamais une page d'erreur 404, qui resterait affichée sinon).
  const isPage = event.request.mode === 'navigate';
  const req = isPage ? new Request(event.request, { cache: 'no-store' }) : event.request;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if(res && res.ok){
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

/* ---------- Notifications push (novembre 2026) ---------- */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { try { d = { body: event.data.text() }; } catch (e2) {} }
  const title = d.title || 'FicheProBot';
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { url: d.url || './' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || './', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin) && 'focus' in c) {
          return c.focus().then(() => ('navigate' in c && c.url !== target ? c.navigate(target) : undefined));
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
