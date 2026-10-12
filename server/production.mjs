import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createVisualHandler } from './handler.mjs';
import { createCloudAuth, readCloudConfig, isPublishablePasswordKey } from './cloudAuth.mjs';
import { createCloudRepository } from './cloudRepository.mjs';
import { createVaultRepository, VAULT_LIMIT } from './vaultRepository.mjs';
import { createPasswordAccessRepository } from './passwordAccessRepository.mjs';
import { createAIProxy } from './cloudAI.mjs';
import { CloudError, sendJson, sendError, readJson } from './cloudUtils.mjs';
import { DOCUMENT_LIMIT, IMPORT_LIMIT } from './cloudValidation.mjs';
import { createLiveInkRelay } from './live-ink.mjs';
import { createExternalApi } from './externalApi.mjs';

const PUBLIC_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm' };
const notFound = () => new CloudError(404, 'not_found', 'The requested resource was not found.');
function pathname(req) {
  if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//')) throw notFound();
  let decoded; try { decoded = decodeURIComponent(req.url.split('?')[0]); } catch { throw notFound(); }
  if (/[\\\0]/.test(decoded) || decoded.split('/').some(part => part === '.' || part === '..')) throw notFound();
  if (!decoded.startsWith('/api/') && decoded.split('/').some(part => part.startsWith('.') || part.includes(':'))) throw notFound();
  return decoded;
}
function publicHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('referrer-policy', 'same-origin'); res.setHeader('x-frame-options', 'DENY');
  res.setHeader('permissions-policy', 'camera=(), microphone=(self), geolocation=()');
}

export function productionConfig(env = process.env) {
  return { ...readCloudConfig(env), vaultEnabled: env.CLOUD_VAULT_ENABLED === '1', externalApiEnabled: env.EXTERNAL_API_ENABLED === '1', externalApiKey: env.SUPABASE_SECRET_KEY || '', externalEncryptionKey: env.EXTERNAL_API_ENCRYPTION_KEY || '', providers: { openrouter: env.OPENROUTER_API_KEY || env.OPENROUTER || '', openai: env.OPENAI_API_KEY || '', anthropic: env.ANTHROPIC_API_KEY || '' }, typesafeKey: env.TYPESAFE_API_KEY || env.TYPESAFE || '' };
}

export function createProductionHandler({ config = productionConfig(), dist = path.resolve('dist'), auth, repository, vaultRepository, passwordAccessRepository, externalApi, fetchImpl = fetch, publicFetch, referenceRegistry } = {}) {
  auth ??= createCloudAuth({ config, fetchImpl }); repository ??= createCloudRepository({ config, fetchImpl });
  vaultRepository ??= createVaultRepository({ config, fetchImpl });
  passwordAccessRepository ??= createPasswordAccessRepository({ config, fetchImpl });
  externalApi ??= createExternalApi({ config, vaultRepository, fetchImpl });
  const authorized = new WeakMap();
  const visuals = createVisualHandler({ local: false, typesafeKey: config.typesafeKey, authorize: req => authorized.get(req)?.user.id ?? null, fetchImpl, publicFetch, referenceRegistry });
  const ai = createAIProxy({ keys: config.providers, fetchImpl });
  const liveInk = createLiveInkRelay({ authorize: req => auth.authorize(req) });
  const providers = () => ({ openrouter: config.enabled && Boolean(config.providers?.openrouter), openai: config.enabled && Boolean(config.providers?.openai), anthropic: config.enabled && Boolean(config.providers?.anthropic) });
  const passwordProvider = config.enabled && config.supabaseUrl === 'https://wxfootrnfiqpzhmjwgck.supabase.co' && isPublishablePasswordKey(config.publishableKey) ? { url: config.supabaseUrl, publishableKey: config.publishableKey } : null;
  const pending = new Map(); let globalPending = 0;
  const activatingVaults = new Set();
  let canonicalDist;
  const staticFile = async (req, res, route) => {
    if (!['GET', 'HEAD'].includes(req.method)) throw notFound();
    canonicalDist ??= await realpath(dist);
    const demo = route === '/demo' || route === '/demo/';
    let filename = route === '/' || demo ? path.join(dist, 'index.html') : path.join(dist, route.slice(1));
    let ext = path.extname(filename).toLowerCase();
    if (!ext && req.headers.accept?.includes('text/html')) { filename = path.join(dist, 'index.html'); ext = '.html'; }
    if (!PUBLIC_TYPES[ext]) throw notFound();
    let resolved, info;
    try { resolved = await realpath(filename); info = await stat(resolved); } catch { throw notFound(); }
    const relative = path.relative(canonicalDist, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !info.isFile()) throw notFound();
    res.setHeader('cache-control', ext === '.html' || route === '/service-worker.js' || route === '/sw.js' || ext === '.webmanifest' ? 'no-cache' : route.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
    res.setHeader('content-type', PUBLIC_TYPES[ext]); res.setHeader('content-length', info.size);
    if (ext === '.html') {
      // A demo tab may share this host with an authenticated application tab.
      // Keep the browser's network boundary independent of all client guards.
      res.setHeader('content-security-policy', demo
        ? `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'none'; worker-src 'self' blob:; frame-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
        : `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; font-src 'self'; connect-src 'self'${passwordProvider ? ` ${passwordProvider.url}` : ''}; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`);
      if (demo) res.setHeader('x-robots-tag', 'noindex, nofollow');
    }
    if (req.method === 'HEAD') { res.end(); return; }
    await pipeline(createReadStream(resolved), res);
  };
  const handler = async (req, res) => {
    let release, activationOwner;
    try {
      publicHeaders(res); if (config.enabled) res.setHeader('strict-transport-security', 'max-age=31536000');
      const route = pathname(req);
      if (route === '/healthz' && req.method === 'GET') { sendJson(res, 200, { status: 'ok' }); return; }
      if (!route.startsWith('/api/') && route !== '/api') {
        if (config.enabled && req.headers.host !== new URL(config.origin).host) {
          const alternate = (config.alternateOrigins ?? []).some(value => new URL(value).host === req.headers.host);
          if (alternate && ['GET', 'HEAD'].includes(req.method)) { res.writeHead(308, { location: new URL(req.url, config.origin).href, 'cache-control': 'no-store' }); res.end(); return; }
          throw new CloudError(421, 'host_forbidden', 'This host is not configured for the application.');
        }
        await staticFile(req, res, route); return;
      }
      res.setHeader('cache-control', 'no-store');
      if (route === '/api/cloud/config' && req.method === 'GET') {
        if (config.enabled && !auth.sameOrigin(req)) throw new CloudError(403, 'origin_forbidden', 'This request origin is not permitted.');
        const session = config.enabled ? await auth.authorize(req) : null;
        sendJson(res, 200, { enabled: config.enabled, authenticated: Boolean(session), ...(config.enabled ? { authMethod: 'email_link', passwordAuth: true, ...(passwordProvider ? { passwordProvider } : {}), ...(config.vaultEnabled ? { vaultAvailable: true, liveInkAvailable: true } : {}) } : {}), ...(session ? { user: session.user, passwordSetup: session.passwordSetup === true } : {}), providers: providers() }); return;
      }
      if (!config.enabled) throw new CloudError(503, 'cloud_not_configured', 'Cloud access is not configured.');
      if (route.startsWith('/api/v1/')) { await externalApi.handle(req, res, route); return; }
      if (route === '/api/auth/callback' && req.method === 'GET') {
        res.setHeader('referrer-policy', 'no-referrer');
        let location = '/';
        try { await auth.callback(req, res); } catch { location = '/?auth_error=link_invalid'; }
        // Keep auth codes/provider errors out of response bodies and final URLs.
        res.writeHead(303, { location }); res.end(); return;
      }
      if (!auth.sameOrigin(req)) throw new CloudError(403, 'origin_forbidden', 'This request origin is not permitted.');
      if (route === '/api/auth/request-code' && req.method === 'POST') { const body = await readJson(req); await auth.requestCode(body.email, req, res); sendJson(res, 200, { sent: true }); return; }
      if (route === '/api/auth/verify-code' && req.method === 'POST') { const body = await readJson(req); const user = await auth.verifyCode(body.email, body.token, req, res); sendJson(res, 200, { authenticated: true, user }); return; }
      if (route === '/api/auth/password/session' && req.method === 'POST') { const user = await auth.acceptPasswordSession(await readJson(req, 65536), req, res); sendJson(res, 200, { authenticated: true, user }); return; }
      if (route === '/api/auth/password/setup-session' && req.method === 'GET') { sendJson(res, 200, await auth.passwordSetupSession(req)); return; }
      if (route === '/api/auth/password/sign-in' && req.method === 'POST') { if (config.vaultEnabled) throw new CloudError(426, 'password_client_upgrade_required', 'Atualize a página para entrar com segurança.'); const body = await readJson(req, 4096); const user = await auth.signInPassword(body.email, body.password, req, res); sendJson(res, 200, { authenticated: true, user }); return; }
      if (route === '/api/auth/password/setup-link' && req.method === 'POST') { const body = await readJson(req, 4096); await auth.requestPasswordSetup(body.email, req, res); sendJson(res, 200, { sent: true }); return; }
      if (route === '/api/auth/logout' && req.method === 'POST') { await auth.logout(req, res); sendJson(res, 200, { authenticated: false }); return; }
      const session = await auth.authorize(req); if (!session) throw new CloudError(401, 'authentication_required', 'Sign in to continue.');
      if (req.aborted || res.destroyed) return;
      if (route.startsWith('/api/integrations/')) { await externalApi.manage(req, res, session, route); return; }
      if (route === '/api/live/ink') { if (!config.vaultEnabled) throw new CloudError(503, 'vault_required', 'Unlock encrypted storage to share drawing updates.'); await liveInk.handle(req, res, session); return; }
      if (route === '/api/auth/password' && req.method === 'POST') { if (config.vaultEnabled) throw new CloudError(426, 'password_client_upgrade_required', 'Atualize a página para redefinir sua senha com segurança.'); const body = await readJson(req, 4096); await auth.setPassword(body.password, session); sendJson(res, 200, { saved: true }); return; }
      if (route.startsWith('/api/visuals/')) { authorized.set(req, session); await visuals(req, res); return; }
      if (route.startsWith('/api/ai/')) { await ai(req, res, session); return; }
      if (config.vaultEnabled && route === '/api/cloud/vault' && req.method === 'GET') { sendJson(res, 200, await vaultRepository.get(session)); return; }
      if (config.vaultEnabled && route === '/api/cloud/vault/password-access' && req.method === 'GET') { sendJson(res, 200, await passwordAccessRepository.get(session)); return; }
      if (config.vaultEnabled && route === '/api/cloud/vault/activate') {
        if ((pending.get(session.user.id) ?? 0) > 0 || activatingVaults.has(session.user.id)) throw new CloudError(429, 'vault_busy', 'Finish active cloud operations before activating the vault.');
        activationOwner = session.user.id; activatingVaults.add(activationOwner);
      }
      if (config.vaultEnabled && route.startsWith('/api/cloud/') && !route.startsWith('/api/cloud/vault')) {
        if (activatingVaults.has(session.user.id)) throw new CloudError(409, 'vault_activating', 'Vault activation is in progress.');
        // Reserve before the asynchronous vault check. Activation cannot overtake
        // a legacy request whose check observed the previous unencrypted state.
        const count = pending.get(session.user.id) ?? 0;
        if (count >= 2 || globalPending >= 4) throw new CloudError(429, 'cloud_rate_limited', 'Too many concurrent cloud operations.');
        pending.set(session.user.id, count + 1); globalPending++;
        release = () => { pending.set(session.user.id, pending.get(session.user.id) - 1); globalPending--; };
        await vaultRepository.assertLegacy(session);
        // A request waiting on Supabase must not slip through an activation barrier.
        if (activatingVaults.has(session.user.id)) throw new CloudError(409, 'vault_activating', 'Vault activation is in progress.');
      }
      if (route === '/api/cloud/snapshot' && req.method === 'GET') { sendJson(res, 200, await repository.snapshot(session)); return; }
      if (route.startsWith('/api/cloud/') && !release) {
        const count = pending.get(session.user.id) ?? 0;
        if (count >= 2 || globalPending >= 4) throw new CloudError(429, 'cloud_rate_limited', 'Too many concurrent cloud operations. Please try again later.');
        pending.set(session.user.id, count + 1); globalPending++;
        release = () => { pending.set(session.user.id, pending.get(session.user.id) - 1); globalPending--; };
      }
      if (config.vaultEnabled && route === '/api/cloud/vault/activate' && req.method === 'POST') { sendJson(res, 200, await vaultRepository.activate(session, await readJson(req, VAULT_LIMIT))); return; }
      if (config.vaultEnabled && route === '/api/cloud/vault' && req.method === 'PUT') { sendJson(res, 200, await vaultRepository.write(session, await readJson(req, VAULT_LIMIT))); return; }
      if (config.vaultEnabled && route === '/api/cloud/vault/password-access' && req.method === 'PUT') { sendJson(res, 200, await passwordAccessRepository.write(session, await readJson(req, 4096))); return; }
      if (config.vaultEnabled && route === '/api/cloud/vault/blobs' && req.method === 'POST') { sendJson(res, 200, await vaultRepository.writeBlob(session, await readJson(req, 21 * 1024 * 1024))); return; }
      if (config.vaultEnabled && route.startsWith('/api/cloud/vault/blobs/') && req.method === 'GET') {
        const bytes = await vaultRepository.readBlob(session, route.slice('/api/cloud/vault/blobs/'.length));
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length, 'cache-control': 'private, no-store', 'content-disposition': 'attachment', 'cross-origin-resource-policy': 'same-origin' }); res.end(bytes); return;
      }
      if (route === '/api/cloud/import' && req.method === 'POST') { sendJson(res, 200, await repository.importDocuments(session, await readJson(req, IMPORT_LIMIT * 2 + 32_768))); return; }
      if (route.startsWith('/api/cloud/documents/') && req.method === 'PUT') {
        const key = route.slice('/api/cloud/documents/'.length);
        sendJson(res, 200, await repository.writeDocument(session, key, await readJson(req, DOCUMENT_LIMIT * 2 + 32_768))); return;
      }
      if (route === '/api/cloud/media' && req.method === 'POST') { sendJson(res, 200, await repository.writeMedia(session, await readJson(req, 14 * 1024 * 1024))); return; }
      if (route.startsWith('/api/cloud/media/')) {
        const id = route.slice('/api/cloud/media/'.length);
        if (req.method === 'GET') {
          const media = await repository.readMedia(session, id);
          res.writeHead(200, { 'content-type': media.mime, 'content-length': media.bytes.length, 'cache-control': 'private, no-store', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(media.name.toWellFormed()).replaceAll("'", '%27')}`, 'x-content-sha256': media.sha256, 'cross-origin-resource-policy': 'same-origin' }); res.end(media.bytes); return;
        }
        if (req.method === 'DELETE') { sendJson(res, 200, await repository.deleteMedia(session, id, await readJson(req))); return; }
      }
      throw notFound();
    } catch (error) { sendError(res, error); }
    finally { release?.(); if (activationOwner) activatingVaults.delete(activationOwner); }
  };
  handler.close = () => { liveInk.close(); auth.close?.(); ai.close(); externalApi.close(); };
  return handler;
}

export async function startProductionServer({ env = process.env, ...options } = {}) {
  const config = options.config ?? productionConfig(env);
  const port = Number(env.PORT || 3000); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid server port.');
  const handler = createProductionHandler({ ...options, config });
  const server = createServer({ maxHeaderSize: 16_384, headersTimeout: 15_000, requestTimeout: 120_000, keepAliveTimeout: 5_000 }, handler);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', resolve); });
  let closing = false;
  const close = () => {
    if (closing) return; closing = true; handler.close();
    const deadline = setTimeout(() => server.closeAllConnections(), 10_000); deadline.unref();
    server.close(() => clearTimeout(deadline)); server.closeIdleConnections();
  };
  return { server, close };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startProductionServer().then(({ server, close }) => {
    console.log(`Cellproject server listening on port ${server.address().port}.`);
    process.once('SIGTERM', close); process.once('SIGINT', close);
  }).catch(() => { console.error('Cellproject server could not start. Check production configuration.'); process.exitCode = 1; });
}
