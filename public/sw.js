const CACHE = 'harcrun-shell-v1';
// Replaced with every emitted chunk and font during the production build.
const PRECACHE = [];
self.addEventListener('install', (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const response = await fetch('/index.html', { cache: 'reload' });
      if (!response.ok) throw new Error('Nie można przygotować aplikacji offline.');
      const html = await response.text();
      const assets = PRECACHE;
      await cache.addAll(['/icon.svg', '/manifest.webmanifest', ...assets]);
      await cache.put(
        '/index.html',
        new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
      );
    })(),
  ),
);
// Updates wait until all old tabs close, so a race cannot switch code during measurement.
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith('harcrun-shell-') && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => (await caches.open(CACHE)).match('/index.html')),
    );
    return;
  }
  if (
    url.pathname.startsWith('/assets/') ||
    ['/icon.svg', '/manifest.webmanifest'].includes(url.pathname)
  )
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const result = await fetch(event.request);
        if (result.ok) await cache.put(event.request, result.clone());
        return result;
      })(),
    );
});
