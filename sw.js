/* Offline support, network-first: always fetch fresh code when online, fall back to the cache offline. */
const CACHE = 'winterarc-v6';
const ASSETS = [
  './', 'index.html', 'css/styles.css', 'manifest.webmanifest', 'icons/icon.svg',
  'js/store.js', 'js/icons.js', 'js/charts.js', 'js/strength.js', 'js/focus.js', 'js/health-import.js', 'js/insights.js', 'js/reminders.js', 'js/demo.js', 'js/app.js',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});
self.addEventListener('message', (e) => e.data === 'skipWaiting' && self.skipWaiting());
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((cs) => (cs.length ? cs[0].focus() : self.clients.openWindow('./#/today')))
  );
});
