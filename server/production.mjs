import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createVisualHandler } from './handler.mjs';
import { createCloudAuth, readCloudConfig } from './cloudAuth.mjs';
import { createCloudRepository } from './cloudRepository.mjs';
import { createAIProxy } from './cloudAI.mjs';
import { CloudError, sendJson, sendError, readJson } from './cloudUtils.mjs';
import { DOCUMENT_LIMIT, IMPORT_LIMIT } from './cloudValidation.mjs';

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
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
}

export function productionConfig(env = process.env) {
  return { ...readCloudConfig(env), providers: { openrouter: env.OPENROUTER_API_KEY || env.OPENROUTER || '', openai: env.OPENAI_API_KEY || '', anthropic: env.ANTHROPIC_API_KEY || '' }, typesafeKey: env.TYPESAFE_API_KEY || env.TYPESAFE || '' };
}

export function createProductionHandler({ config = productionConfig(), dist = path.resolve('dist'), auth, repository, fetchImpl = fetch, publicFetch, referenceRegistry } = {}) {
  auth ??= createCloudAuth({ config, fetchImpl }); repository ??= createCloudRepository({ config, fetchImpl });
  const authorized = new WeakMap();
  const visuals = createVisualHandler({ local: false, typesafeKey: config.typesafeKey, authorize: req => authorized.get(req)?.user.id ?? null, fetchImpl, publicFetch, referenceRegistry });
  const ai = createAIProxy({ keys: config.providers, fetchImpl });
  const providers = () => ({ openrouter: config.enabled && Boolean(config.providers?.openrouter), openai: config.enabled && Boolean(config.providers?.openai), anthropic: config.enabled && Boolean(config.providers?.anthropic) });
  const pending = new Map(); let globalPending = 0;
  let canonicalDist;
  const staticFile = async (req, res, route) => {
    if (!['GET', 'HEAD'].includes(req.method)) throw notFound();
    canonicalDist ??= await realpath(dist);
    let filename = route === '/' ? path.join(dist, 'index.html') : path.join(dist, route.slice(1));
    let ext = path.extname(filename).toLowerCase();
    if (!ext && req.headers.accept?.includes('text/html')) { filename = path.join(dist, 'index.html'); ext = '.html'; }
    if (!PUBLIC_TYPES[ext]) throw notFound();
    let resolved, info;
    try { resolved = await realpath(filename); info = await stat(resolved); } catch { throw notFound(); }
    const relative = path.relative(canonicalDist, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !info.isFile()) throw notFound();
    res.setHeader('cache-control', ext === '.html' || route === '/sw.js' || ext === '.webmanifest' ? 'no-cache' : route.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
    res.setHeader('content-type', PUBLIC_TYPES[ext]); res.setHeader('content-length', info.size);
    if (ext === '.html') res.setHeader('content-security-policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (req.method === 'HEAD') { res.end(); return; }
    await pipeline(createReadStream(resolved), res);
  };
  const handler = async (req, res) => {
    let release;
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
        sendJson(res, 200, { enabled: config.enabled, authenticated: Boolean(session), ...(config.enabled ? { authMethod: 'email_link', passwordAuth: true } : {}), ...(session ? { user: session.user, passwordSetup: session.passwordSetup === true } : {}), providers: providers() }); return;
      }
      if (!config.enabled) throw new CloudError(503, 'cloud_not_configured', 'Cloud access is not configured.');
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
      if (route === '/api/auth/password/sign-in' && req.method === 'POST') { const body = await readJson(req, 4096); const user = await auth.signInPassword(body.email, body.password, req, res); sendJson(res, 200, { authenticated: true, user }); return; }
      if (route === '/api/auth/password/setup-link' && req.method === 'POST') { const body = await readJson(req, 4096); await auth.requestPasswordSetup(body.email, req, res); sendJson(res, 200, { sent: true }); return; }
      if (route === '/api/auth/logout' && req.method === 'POST') { await auth.logout(req, res); sendJson(res, 200, { authenticated: false }); return; }
      const session = await auth.authorize(req); if (!session) throw new CloudError(401, 'authentication_required', 'Sign in to continue.');
      if (req.aborted || res.destroyed) return;
      if (route === '/api/auth/password' && req.method === 'POST') { const body = await readJson(req, 4096); await auth.setPassword(body.password, session); sendJson(res, 200, { saved: true }); return; }
      if (route.startsWith('/api/visuals/')) { authorized.set(req, session); await visuals(req, res); return; }
      if (route.startsWith('/api/ai/')) { await ai(req, res, session); return; }
      if (route === '/api/cloud/snapshot' && req.method === 'GET') { sendJson(res, 200, await repository.snapshot(session)); return; }
      if (route.startsWith('/api/cloud/')) {
        const count = pending.get(session.user.id) ?? 0;
        if (count >= 2 || globalPending >= 4) throw new CloudError(429, 'cloud_rate_limited', 'Too many concurrent cloud operations. Please try again later.');
        pending.set(session.user.id, count + 1); globalPending++;
        release = () => { pending.set(session.user.id, pending.get(session.user.id) - 1); globalPending--; };
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
    finally { release?.(); }
  };
  handler.close = () => { auth.close?.(); ai.close(); };
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
