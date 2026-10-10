/* Public application shell only. Never cache API responses, user media or navigation payloads. */
const CACHE_PREFIX = 'dynamic-diary-shell-';
const CACHE = CACHE_PREFIX + '__PWA_BUILD__';
const PRECACHE = /*__PWA_ASSETS__*/ [];
const STATIC = ['/manifest.webmanifest', '/pwa/icon-192.png', '/pwa/icon-512.png', '/pwa/maskable-512.png', '/pwa/apple-touch-icon.png'];
function isStaticAssetRequest(request) {
  const url = new URL(request.url);
  return request.method === 'GET' && url.origin === self.location.origin && !url.search && !request.headers.has('authorization')
    && /^\/assets\/[A-Za-z0-9_.-]+\.(?:js|css|woff2?|ttf|png|jpg|jpeg|svg|webp)$/.test(url.pathname)
    && ['script', 'style', 'font', 'image', 'worker'].includes(request.destination);
}
function isPublicAsset(request) { return isStaticAssetRequest(request) && PRECACHE.includes(new URL(request.url).pathname); }
function canStoreResponse(response) {
  return response.ok && !response.redirected && !['opaque', 'opaqueredirect'].includes(response.type) && !/\b(?:no-store|private)\b/i.test(response.headers.get('cache-control') || '');
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    if (!/^[a-f0-9]{16}$/.test(CACHE.slice(CACHE_PREFIX.length))) throw new Error('Production build required');
    // Credentials are omitted even for the shell. Cached HTML never comes from a user's navigation response.
    const cache = await caches.open(CACHE);
    for (const path of ['/', ...STATIC, ...PRECACHE]) {
      const response = await fetch(path, { credentials: 'omit', cache: 'no-store', redirect: 'error' });
      if (!canStoreResponse(response)) throw new Error('Public shell unavailable');
      await cache.put(path, response);
    }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // A second tab may still be using the previous build. Keep one previous public release.
    const previous = (await caches.keys()).filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE);
    for (const name of previous.slice(0, -1)) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => { if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search || request.headers.has('authorization')) return;
  if (request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith(fetch(request).catch(async () => {
      const cached = await (await caches.open(CACHE)).match('/');
      return cached || Response.error();
    }));
    return;
  }
  if (!isStaticAssetRequest(request)) return;
  event.respondWith((async () => {
    const listed = isPublicAsset(request);
    const cache = await caches.open(CACHE), cached = listed ? await cache.match(request) : undefined;
    if (cached) return cached;
    for (const name of (await caches.keys()).filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE)) {
      const previous = await (await caches.open(name)).match(request);
      if (previous && canStoreResponse(previous)) return previous;
    }
    // An old tab can request a hash no longer listed by the new build. Only
    // an already cached public release may supply it. Unknown paths pass
    // through unchanged and are never fetched with special options or stored.
    if (!listed) return fetch(request);
    const response = await fetch(request, { credentials: 'omit', redirect: 'error' });
    if (canStoreResponse(response)) {
      await cache.put(request, response.clone());
      const keys = await cache.keys();
      // Keep the initial shell and current release, bound incidental static chunks.
      const extra = keys.filter(key => { const path = new URL(key.url).pathname; return path.startsWith('/assets/') && !PRECACHE.includes(path); });
      for (const key of extra.slice(0, Math.max(0, extra.length - 40))) await cache.delete(key);
    }
    return response;
  })());
});
