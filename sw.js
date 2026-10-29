// Service worker: fa funzionare l'app anche offline.
// Quando modifichi i file dell'app, aumenta VERSION così i telefoni scaricano la nuova versione.
const VERSION = 'v4';
const APP_CACHE = `app-${VERSION}`;
const RUNTIME_CACHE = 'runtime'; // font e file dell'OCR, scaricati al primo uso

const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/model.js',
  './js/ui.js',
  './js/charts.js',
  './js/xlsx.js',
  './js/scan.js',
  './js/views/dashboard.js',
  './js/views/movements.js',
  './js/views/editor.js',
  './js/views/accounts.js',
  './js/views/summary.js',
  './js/views/settings.js',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== APP_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // File dell'app: prima la rete (così vedi subito gli aggiornamenti), se offline usa la cache.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(APP_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // Font e OCR: prima la cache (sono file grossi che non cambiano).
  const cacheable = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'tessdata.projectnaptha.com'];
  if (cacheable.some((h) => url.hostname.endsWith(h))) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') c.put(req, res.clone());
        return res;
      })
    );
  }
});
