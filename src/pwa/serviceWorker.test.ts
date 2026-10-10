import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

function worker(stamped = false, release = 'abc123abc123abcd', assets = ['/assets/index-abc123.js']) {
  const handlers: Record<string, (event: any) => void> = {};
  const context = { URL, Response, Request, fetch: vi.fn(), caches: { open: vi.fn(), keys: vi.fn(async (): Promise<string[]> => []), delete: vi.fn() }, self: { location: { origin: 'https://plans.test' }, addEventListener: (type: string, fn: (event: any) => void) => { handlers[type] = fn; }, clients: { claim: vi.fn() }, skipWaiting: vi.fn() } };
  let source = readFileSync('public/service-worker.js', 'utf8').replace('/*__PWA_ASSETS__*/ []', JSON.stringify(assets));
  if (stamped) source = source.replace('__PWA_BUILD__', release);
  runInNewContext(source, context);
  return { context: context as typeof context & { isPublicAsset: (request: any) => boolean; canStoreResponse: (response: Response) => boolean }, handlers };
}
const request = (path: string, options = {}) => ({ url: 'https://plans.test' + path, method: 'GET', destination: 'script', headers: new Headers(), ...options });
function memoryCaches() {
  const data = new Map<string, Map<string, Response>>();
  const url = (key: string | { url: string }) => new URL(typeof key === 'string' ? key : key.url, 'https://plans.test').href;
  return {
    data,
    async open(name: string) {
      if (!data.has(name)) data.set(name, new Map());
      const entries = data.get(name)!;
      return {
        async put(key: string | { url: string }, value: Response) { entries.set(url(key), value.clone()); },
        async match(key: string | { url: string }) { return entries.get(url(key))?.clone(); },
        async keys() { return [...entries.keys()].map(url => ({ url })); },
        async delete(key: string | { url: string }) { return entries.delete(url(key)); },
      };
    },
    async keys() { return [...data.keys()]; },
    async delete(name: string) { return data.delete(name); },
  };
}
function releaseWorker(caches: ReturnType<typeof memoryCaches>, release: string, asset: string) {
  const fixture = worker(true, release, [asset]);
  fixture.context.caches.open.mockImplementation(caches.open);
  fixture.context.caches.keys.mockImplementation(caches.keys);
  fixture.context.caches.delete.mockImplementation(caches.delete);
  fixture.context.fetch.mockImplementation(async (path: string) => new Response('public ' + path));
  return fixture;
}
async function lifecycle(fixture: ReturnType<typeof worker>, type: 'install' | 'activate') {
  let task: Promise<void> | undefined;
  fixture.handlers[type]({ waitUntil: (promise: Promise<void>) => { task = promise; } });
  await task;
}
function responseFor(fixture: ReturnType<typeof worker>, path: string, options = {}) {
  let response: Promise<Response> | undefined;
  fixture.handlers.fetch({ request: request(path, options), respondWith: (value: Promise<Response>) => { response = value; } });
  return response;
}
it('rejects a development worker and installs a stamped public release without credentials', async () => {
  const dev = worker(); let task: Promise<void> | undefined;
  dev.handlers.install({ waitUntil: (promise: Promise<void>) => { task = promise; } });
  await expect(task).rejects.toThrow('Production build required'); expect(dev.context.caches.open).not.toHaveBeenCalled();
  const prod = worker(true), put = vi.fn(); prod.context.caches.open.mockResolvedValue({ put, match: vi.fn(async () => undefined) }); prod.context.fetch.mockImplementation(async () => new Response('public'));
  prod.handlers.install({ waitUntil: (promise: Promise<void>) => { task = promise; } }); await task;
  expect(put.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining(['/', '/manifest.webmanifest', '/pwa/icon-192.png', '/pwa/icon-512.png', '/pwa/maskable-512.png', '/pwa/apple-touch-icon.png', '/assets/index-abc123.js']));
  expect(prod.context.fetch).toHaveBeenCalledWith('/', { credentials: 'omit', cache: 'no-store', redirect: 'error' });
});
it('serves an enumerated PDF module worker offline without fetching or storing unknown modules', async () => {
  const caches = memoryCaches(), fixture = releaseWorker(caches, 'aaaaaaaaaaaaaaaa', '/assets/pdf.worker-release.mjs');
  await lifecycle(fixture, 'install');
  fixture.context.fetch.mockClear().mockRejectedValue(new Error('offline'));
  const response = responseFor(fixture, '/assets/pdf.worker-release.mjs', { destination: 'worker' });
  expect(response).toBeDefined();
  expect(await (await response!).text()).toBe('public /assets/pdf.worker-release.mjs');
  expect(fixture.context.fetch).not.toHaveBeenCalled();
  const unknown = '/assets/private-worker.mjs';
  await expect(responseFor(fixture, unknown, { destination: 'worker' })).rejects.toThrow('offline');
  expect([...caches.data.values()].some(entries => entries.has('https://plans.test' + unknown))).toBe(false);
});
it('serves only the exact precached manifest and icons offline', async () => {
  const caches = memoryCaches(), fixture = releaseWorker(caches, 'aaaaaaaaaaaaaaaa', '/assets/app-A.js');
  await lifecycle(fixture, 'install');
  fixture.context.fetch.mockClear().mockRejectedValue(new Error('offline'));
  for (const [path, destination] of [['/manifest.webmanifest', 'manifest'], ['/pwa/icon-192.png', 'image'], ['/pwa/icon-512.png', 'image'], ['/pwa/maskable-512.png', 'image'], ['/pwa/apple-touch-icon.png', 'image']]) {
    const response = responseFor(fixture, path, { destination });
    expect(response).toBeDefined();
    expect(await (await response!).text()).toBe('public ' + path);
  }
  expect(fixture.context.fetch).not.toHaveBeenCalled();
  for (const path of ['/__pwa__/complete', '/__pwa__/activated', '/pwa/private.png', '/pwa/icon-192.png?token=secret', '/manifest.webmanifest?account=private']) expect(responseFor(fixture, path, { destination: 'image' })).toBeUndefined();
  expect(responseFor(fixture, '/pwa/icon-192.png', { destination: 'image', headers: new Headers({ authorization: 'Bearer token' }) })).toBeUndefined();
});
it('removes a failed installation before retaining the previous successful release', async () => {
  const caches = memoryCaches();
  const a = releaseWorker(caches, 'aaaaaaaaaaaaaaaa', '/assets/lazy-A.js');
  await lifecycle(a, 'install'); await lifecycle(a, 'activate');
  const b = releaseWorker(caches, 'bbbbbbbbbbbbbbbb', '/assets/lazy-B.js');
  b.context.fetch.mockImplementation(async (path: string) => { if (path === '/pwa/icon-192.png') throw new Error('download interrupted'); return new Response('public ' + path); });
  await expect(lifecycle(b, 'install')).rejects.toThrow('download interrupted');
  expect(await caches.keys()).toHaveLength(1);
  const c = releaseWorker(caches, 'cccccccccccccccc', '/assets/lazy-C.js');
  await lifecycle(c, 'install'); await lifecycle(c, 'activate');
  c.context.fetch.mockRejectedValue(new Error('offline'));
  expect(await (await responseFor(c, '/assets/lazy-A.js')!).text()).toBe('public /assets/lazy-A.js');
  expect(await caches.keys()).toHaveLength(2);
});
it('ignores an interrupted unmarked installation when preserving the previous successful release', async () => {
  const caches = memoryCaches();
  const a = releaseWorker(caches, 'aaaaaaaaaaaaaaaa', '/assets/lazy-A.js');
  await lifecycle(a, 'install'); await lifecycle(a, 'activate');
  const b = releaseWorker(caches, 'bbbbbbbbbbbbbbbb', '/assets/lazy-B.js');
  let reachedAsset!: () => void;
  const interrupted = new Promise<void>(resolve => { reachedAsset = resolve; });
  b.context.fetch.mockImplementation(async (path: string) => { if (path === '/assets/lazy-B.js') { reachedAsset(); return await new Promise<Response>(() => {}); } return new Response('incomplete ' + path); });
  // Abandon this install after a partial cache is written, as when its worker is terminated.
  void lifecycle(b, 'install'); await interrupted;
  const c = releaseWorker(caches, 'cccccccccccccccc', '/assets/lazy-C.js');
  await lifecycle(c, 'install'); await lifecycle(c, 'activate');
  c.context.fetch.mockRejectedValue(new Error('offline'));
  const keys = await caches.keys();
  expect(keys).toHaveLength(2); expect(keys.some(name => name.endsWith('bbbbbbbbbbbbbbbb'))).toBe(false);
  expect(await (await responseFor(c, '/assets/lazy-A.js')!).text()).toBe('public /assets/lazy-A.js');
});
it('retains the previous active release when a completed waiting update is superseded', async () => {
  const caches = memoryCaches();
  const a = releaseWorker(caches, 'aaaaaaaaaaaaaaaa', '/assets/lazy-A.js');
  await lifecycle(a, 'install'); await lifecycle(a, 'activate');
  const b = releaseWorker(caches, 'bbbbbbbbbbbbbbbb', '/assets/lazy-B.js');
  await lifecycle(b, 'install');
  const c = releaseWorker(caches, 'cccccccccccccccc', '/assets/lazy-C.js');
  await lifecycle(c, 'install'); await lifecycle(c, 'activate');
  c.context.fetch.mockRejectedValue(new Error('offline'));
  expect(await (await responseFor(c, '/assets/lazy-A.js')!).text()).toBe('public /assets/lazy-A.js');
  await expect(responseFor(c, '/assets/lazy-B.js')).rejects.toThrow('offline');
  expect(await caches.keys()).toEqual(['dynamic-diary-shell-v2-aaaaaaaaaaaaaaaa', 'dynamic-diary-shell-v2-cccccccccccccccc']);
});
it('preserves existing releases and clients when activation metadata cannot be saved', async () => {
  const caches = memoryCaches();
  const a = releaseWorker(caches, 'aaaaaaaaaaaaaaaa', '/assets/lazy-A.js');
  await lifecycle(a, 'install'); await lifecycle(a, 'activate');
  const b = releaseWorker(caches, 'bbbbbbbbbbbbbbbb', '/assets/lazy-B.js');
  await lifecycle(b, 'install'); await lifecycle(b, 'activate');
  const c = releaseWorker(caches, 'cccccccccccccccc', '/assets/lazy-C.js');
  await lifecycle(c, 'install');
  c.context.caches.open.mockImplementation(async name => {
    const cache = await caches.open(name);
    return { ...cache, put: async (key: string | { url: string }, response: Response) => {
      if (name.endsWith('cccccccccccccccc') && key === '/__pwa__/activated') throw new Error('quota exhausted');
      await cache.put(key, response);
    } };
  });
  await expect(lifecycle(c, 'activate')).rejects.toThrow('quota exhausted');
  expect(await caches.keys()).toEqual(['dynamic-diary-shell-v2-aaaaaaaaaaaaaaaa', 'dynamic-diary-shell-v2-bbbbbbbbbbbbbbbb', 'dynamic-diary-shell-v2-cccccccccccccccc']);
  expect(c.context.self.clients.claim).not.toHaveBeenCalled();
  b.context.fetch.mockRejectedValue(new Error('offline'));
  expect(await (await responseFor(b, '/assets/lazy-A.js')!).text()).toBe('public /assets/lazy-A.js');
});
it('reuses a completed same-hash release during an offline rollback without deleting its cached chunks', async () => {
  const caches = memoryCaches();
  const a = releaseWorker(caches, 'aaaaaaaaaaaaaaaa', '/assets/lazy-A.js');
  await lifecycle(a, 'install'); await lifecycle(a, 'activate');
  const b = releaseWorker(caches, 'bbbbbbbbbbbbbbbb', '/assets/lazy-B.js');
  await lifecycle(b, 'install'); await lifecycle(b, 'activate');
  const rollback = releaseWorker(caches, 'aaaaaaaaaaaaaaaa', '/assets/lazy-A.js');
  rollback.context.fetch.mockRejectedValue(new Error('offline'));
  await expect(lifecycle(rollback, 'install')).resolves.toBeUndefined();
  b.context.fetch.mockRejectedValue(new Error('offline'));
  expect(await (await responseFor(b, '/assets/lazy-A.js')!).text()).toBe('public /assets/lazy-A.js');
  expect(await caches.keys()).toHaveLength(2);
});
it('retains the most recently activated rollback even when its cache was created before the older release', async () => {
  const caches = memoryCaches();
  const a = releaseWorker(caches, 'aaaaaaaaaaaaaaaa', '/assets/lazy-A.js');
  await lifecycle(a, 'install'); await lifecycle(a, 'activate');
  const b = releaseWorker(caches, 'bbbbbbbbbbbbbbbb', '/assets/lazy-B.js');
  await lifecycle(b, 'install'); await lifecycle(b, 'activate');
  const rollback = releaseWorker(caches, 'aaaaaaaaaaaaaaaa', '/assets/lazy-A.js');
  await lifecycle(rollback, 'install'); await lifecycle(rollback, 'activate');
  const c = releaseWorker(caches, 'cccccccccccccccc', '/assets/lazy-C.js');
  await lifecycle(c, 'install'); await lifecycle(c, 'activate');
  c.context.fetch.mockRejectedValue(new Error('offline'));
  expect(await (await responseFor(c, '/assets/lazy-A.js')!).text()).toBe('public /assets/lazy-A.js');
  await expect(responseFor(c, '/assets/lazy-B.js')).rejects.toThrow('offline');
  expect(await caches.keys()).toEqual(['dynamic-diary-shell-v2-aaaaaaaaaaaaaaaa', 'dynamic-diary-shell-v2-cccccccccccccccc']);
});
it('bounds the first marker migration to one legacy cache and leaves unrelated caches untouched', async () => {
  const caches = memoryCaches();
  for (const release of ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb']) await (await caches.open('dynamic-diary-shell-' + release)).put('/assets/legacy-' + release + '.js', new Response('legacy ' + release));
  await (await caches.open('unrelated-private-cache')).put('/private', new Response('private'));
  const current = releaseWorker(caches, 'cccccccccccccccc', '/assets/current.js');
  await lifecycle(current, 'install'); await lifecycle(current, 'activate');
  const keys = await caches.keys();
  expect(keys).toHaveLength(3); expect(keys).not.toContain('dynamic-diary-shell-aaaaaaaaaaaaaaaa'); expect(keys).toContain('dynamic-diary-shell-bbbbbbbbbbbbbbbb'); expect(keys).toContain('unrelated-private-cache');
  current.context.fetch.mockRejectedValue(new Error('offline'));
  expect(await (await responseFor(current, '/assets/legacy-bbbbbbbbbbbbbbbb.js')!).text()).toBe('legacy bbbbbbbbbbbbbbbb');
});
it('never intercepts API, uploads, credentials, user files, query strings or external requests', () => {
  const { context, handlers } = worker();
  for (const r of [request('/api/visuals/media'), request('/private/project.json'), request('/assets/file.js?token=secret'), request('/assets/index-abc123.js', { method: 'POST' }), request('/assets/index-abc123.js', { headers: new Headers({ authorization: 'Bearer token' }) }), request('/assets/data.json'), request('/assets/file.js', { url: 'https://other.test/assets/file.js' })]) {
    expect(context.isPublicAsset(r)).toBe(false); const respondWith = vi.fn(); handlers.fetch({ request: r, respondWith }); expect(respondWith).not.toHaveBeenCalled();
  }
  expect(context.isPublicAsset(request('/assets/index-abc123.js'))).toBe(true);
});
it('serves an old tab lazy chunk from the previous public release and never caches unlisted network paths', async () => {
  const { context, handlers } = worker(true);
  const previous = { match: vi.fn(async (r: { url: string }) => r.url.endsWith('/assets/old-lazy-OLD123.js') ? new Response('previous public chunk') : undefined), put: vi.fn() };
  const current = { match: vi.fn(async () => undefined), put: vi.fn() };
  context.caches.keys.mockResolvedValue(['dynamic-diary-shell-aaaaaaaaaaaaaaaa', 'dynamic-diary-shell-v2-abc123abc123abcd', 'unrelated-private-cache']);
  context.caches.open.mockImplementation(async (name: string) => name === 'dynamic-diary-shell-aaaaaaaaaaaaaaaa' ? previous : current);
  context.fetch.mockRejectedValue(new Error('offline'));
  let response: Promise<Response> | undefined;
  handlers.fetch({ request: request('/assets/old-lazy-OLD123.js'), respondWith: (value: Promise<Response>) => { response = value; } });
  expect(response).toBeDefined(); expect(await (await response!).text()).toBe('previous public chunk'); expect(context.fetch).not.toHaveBeenCalled();
  const unlisted = request('/assets/user-private.js');
  context.fetch.mockResolvedValue(new Response('network only', { headers: { 'cache-control': 'private' } }));
  handlers.fetch({ request: unlisted, respondWith: (value: Promise<Response>) => { response = value; } });
  expect(await (await response!).text()).toBe('network only'); expect(context.fetch).toHaveBeenCalledWith(unlisted);
  expect(context.caches.open).not.toHaveBeenCalledWith('unrelated-private-cache'); expect(current.put).not.toHaveBeenCalled(); expect(previous.put).not.toHaveBeenCalled();
});
it('refuses failed, opaque, private and no-store responses rather than caching them', () => {
  const { context } = worker();
  for (const response of [new Response('', { status: 500 }), new Response('', { headers: { 'cache-control': 'private, max-age=60' } }), new Response('', { headers: { 'cache-control': 'no-store' } })]) expect(context.canStoreResponse(response)).toBe(false);
  expect(context.canStoreResponse({ ok: true, redirected: false, type: 'opaque', headers: new Headers() } as Response)).toBe(false);
  expect(context.canStoreResponse({ ok: true, redirected: true, type: 'basic', headers: new Headers() } as Response)).toBe(false);
  expect(context.canStoreResponse(new Response('public'))).toBe(true);
});
it('does not intercept token-bearing navigation and only activates updates on an explicit message', () => {
  const { handlers, context } = worker(); const respondWith = vi.fn();
  handlers.fetch({ request: request('/?token=sensitive', { mode: 'navigate' }), respondWith }); expect(respondWith).not.toHaveBeenCalled();
  handlers.message({ data: { type: 'random' } }); expect(context.self.skipWaiting).not.toHaveBeenCalled();
  handlers.message({ data: { type: 'ACTIVATE_UPDATE' } }); expect(context.self.skipWaiting).toHaveBeenCalledOnce();
});
it('uses only the public shell when navigation fails and never writes navigation responses', async () => {
  const { handlers, context } = worker();
  const shell = new Response('<html>public shell</html>');
  const cache = { match: vi.fn(async () => shell), put: vi.fn() }; context.caches.open.mockResolvedValue(cache);
  context.fetch.mockRejectedValue(new Error('offline'));
  let response: Promise<Response> | undefined;
  handlers.fetch({ request: request('/', { mode: 'navigate' }), respondWith: (result: Promise<Response>) => { response = result; } });
  expect(await (await response!).text()).toContain('public shell'); expect(cache.put).not.toHaveBeenCalled();
  cache.match.mockResolvedValueOnce(undefined as never);
  handlers.fetch({ request: request('/', { mode: 'navigate' }), respondWith: (result: Promise<Response>) => { response = result; } });
  expect((await response!).type).toBe('error');
});
it('declares standalone scope and separate any/maskable icons with actual PNG dimensions', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  expect(manifest.start_url).toBe('/'); expect(manifest.scope).toBe('/'); expect(manifest.display).toBe('standalone');
  for (const purpose of ['any', 'maskable']) {
    const icon = manifest.icons.find((item: any) => item.purpose === purpose && item.sizes === '512x512'); expect(icon).toBeDefined();
    const png = readFileSync('public' + icon.src); expect(png.readUInt32BE(16)).toBe(512); expect(png.readUInt32BE(20)).toBe(512);
  }
});
