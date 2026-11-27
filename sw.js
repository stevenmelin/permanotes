// Offline support for the iPhone / browser version. Built file list is injected at build time.
const VERSION = '1.0.14-1795798745466';
const FILES = ["apple-touch-icon.png","assets/index-BUCDhBi4.js","assets/index-CoiRLg0b.css","icon-192.png","icon-512.png","index.html","manifest.webmanifest"];
const CACHE = `pn-${VERSION}`;
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', ...FILES])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('pn-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Supabase traffic goes straight to the network
  if (e.request.mode === 'navigate') {
    // Fresh app when online, cached app when offline
    e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('./', copy)); return r; }).catch(() => caches.match('./')));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
