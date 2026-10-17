// Offline support: keeps a copy of the app's own files so it opens without internet.
// Bump VERSION whenever any file changes, so people get the update the next time they open the app online.
const VERSION = 'r6flipbook-v3.4.1';
const FILES = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'vendor/three.module.js', 'vendor/OrbitControls.js',
               'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Try the network first (so updates arrive), fall back to the saved copy when offline.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
