/* Public application shell only. Never cache API responses, user media or navigation payloads. */
const CACHE_PREFIX = 'dynamic-diary-shell-v2-';
const CACHE = CACHE_PREFIX + '__PWA_BUILD__';
const COMPLETE = '/__pwa__/complete';
const ACTIVATED = '/__pwa__/activated';
const PRECACHE = /*__PWA_ASSETS__*/ [];
const STATIC = ['/manifest.webmanifest', '/pwa/icon-192.png', '/pwa/icon-512.png', '/pwa/maskable-512.png', '/pwa/apple-touch-icon.png'];
function isStaticAssetRequest(request) {
  const url = new URL(request.url);
  return request.method === 'GET' && url.origin === self.location.origin && !url.search && !request.headers.has('authorization')
    && /^\/assets\/[A-Za-z0-9_.-]+\.(?:m?js|css|woff2?|ttf|png|jpg|jpeg|svg|webp)$/.test(url.pathname)
    && ['script', 'style', 'font', 'image', 'worker'].includes(request.destination);
}
function isPublicAsset(request) { return isStaticAssetRequest(request) && PRECACHE.includes(new URL(request.url).pathname); }
function canStoreResponse(response) {
  return response.ok && !response.redirected && !['opaque', 'opaqueredirect'].includes(response.type) && !/\b(?:no-store|private)\b/i.test(response.headers.get('cache-control') || '');
}
const isReleaseCache = name => /^dynamic-diary-shell-(?:v2-)?[a-f0-9]{16}$/.test(name);
async function releaseHistory() {
  const activated = [], legacy = [];
  let sequence = 0;
  for (const name of (await caches.keys()).filter(isReleaseCache)) {
    if (name.startsWith(CACHE_PREFIX)) {
      const marker = await (await caches.open(name)).match(ACTIVATED);
      if (!marker) continue;
      try {
        const value = await marker.json();
        if (value.cache !== name || !Number.isSafeInteger(value.sequence) || value.sequence < 1) continue;
        sequence = Math.max(sequence, value.sequence);
        if (name !== CACHE) activated.push({ name, sequence: value.sequence });
      } catch { /* Ignore incomplete or invalid public release metadata. */ }
    } else if (name !== CACHE) legacy.push(name);
  }
  // Older workers wrote no marker: retain one legacy cache only during migration.
  const previous = activated.sort((a, b) => a.sequence - b.sequence).at(-1)?.name || legacy.at(-1);
  return { previous, sequence };
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    if (!/^[a-f0-9]{16}$/.test(CACHE.slice(CACHE_PREFIX.length))) throw new Error('Production build required');
    // Credentials are omitted even for the shell. Cached HTML never comes from a user's navigation response.
    const cache = await caches.open(CACHE);
    const completed = await cache.match(COMPLETE);
    // A rollback can reinstall an identical release that is still serving an old tab.
    // Its completed cache needs no rewrite and must survive a network failure.
    if (completed && await completed.text() === CACHE) return;
    try {
      for (const path of ['/', ...STATIC, ...PRECACHE]) {
        const response = await fetch(path, { credentials: 'omit', cache: 'no-store', redirect: 'error' });
        if (!canStoreResponse(response)) throw new Error('Public shell unavailable');
        await cache.put(path, response);
      }
      // Public release metadata only; absent if the worker is terminated mid-install.
      await cache.put(COMPLETE, new Response(CACHE));
    } catch (reason) {
      await caches.delete(CACHE).catch(() => {});
      throw reason;
    }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // A completed waiting update must not displace the release still used by tabs.
    const { previous, sequence } = await releaseHistory();
    // Confirm the activation order before removing any release or claiming tabs.
    // A storage failure must leave the previously activated workers intact.
    await (await caches.open(CACHE)).put(ACTIVATED, new Response(JSON.stringify({ cache: CACHE, sequence: sequence + 1 })));
    for (const name of (await caches.keys()).filter(name => isReleaseCache(name) && name !== CACHE && name !== previous)) await caches.delete(name);
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
  const fixed = STATIC.includes(url.pathname);
  if (!fixed && !isStaticAssetRequest(request)) return;
  event.respondWith((async () => {
    const listed = fixed || isPublicAsset(request);
    const cache = await caches.open(CACHE), cached = listed ? await cache.match(request) : undefined;
    if (cached) return cached;
    const { previous: name } = await releaseHistory();
    if (name) {
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
