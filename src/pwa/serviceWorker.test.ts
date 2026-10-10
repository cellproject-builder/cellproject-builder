import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

function worker(stamped = false) {
  const handlers: Record<string, (event: any) => void> = {};
  const context = { URL, Response, Request, fetch: vi.fn(), caches: { open: vi.fn(), keys: vi.fn(async (): Promise<string[]> => []), delete: vi.fn() }, self: { location: { origin: 'https://plans.test' }, addEventListener: (type: string, fn: (event: any) => void) => { handlers[type] = fn; }, clients: { claim: vi.fn() }, skipWaiting: vi.fn() } };
  let source = readFileSync('public/service-worker.js', 'utf8').replace('/*__PWA_ASSETS__*/ []', '["/assets/index-abc123.js"]');
  if (stamped) source = source.replace('__PWA_BUILD__', 'abc123abc123abcd');
  runInNewContext(source, context);
  return { context: context as typeof context & { isPublicAsset: (request: any) => boolean; canStoreResponse: (response: Response) => boolean }, handlers };
}
const request = (path: string, options = {}) => ({ url: 'https://plans.test' + path, method: 'GET', destination: 'script', headers: new Headers(), ...options });
it('rejects a development worker and installs a stamped public release without credentials', async () => {
  const dev = worker(); let task: Promise<void> | undefined;
  dev.handlers.install({ waitUntil: (promise: Promise<void>) => { task = promise; } });
  await expect(task).rejects.toThrow('Production build required'); expect(dev.context.caches.open).not.toHaveBeenCalled();
  const prod = worker(true), put = vi.fn(); prod.context.caches.open.mockResolvedValue({ put }); prod.context.fetch.mockImplementation(async () => new Response('public'));
  prod.handlers.install({ waitUntil: (promise: Promise<void>) => { task = promise; } }); await task;
  expect(put).toHaveBeenCalledTimes(7);
  expect(prod.context.fetch).toHaveBeenCalledWith('/', { credentials: 'omit', cache: 'no-store', redirect: 'error' });
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
  context.caches.keys.mockResolvedValue(['dynamic-diary-shell-previous', 'dynamic-diary-shell-abc123abc123abcd', 'unrelated-private-cache']);
  context.caches.open.mockImplementation(async (name: string) => name === 'dynamic-diary-shell-previous' ? previous : current);
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
