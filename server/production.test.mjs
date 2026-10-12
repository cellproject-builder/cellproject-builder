import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createProductionHandler } from './production.mjs';
import { CloudError } from './cloudAuth.mjs';

async function setup(fn, options = {}) {
  const dist = await mkdtemp(path.join(tmpdir(), 'cellproject-server-'));
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><div>APP SHELL</div>');
  await mkdir(path.join(dist, 'assets')); await writeFile(path.join(dist, 'assets', 'app-abcd.js'), 'console.log("app")');
  await writeFile(path.join(dist, 'assets', 'pdf.worker-abcd.mjs'), 'export const worker = true;');
  await writeFile(path.join(dist, 'service-worker.js'), 'self.addEventListener("fetch", () => {});');
  await writeFile(path.join(dist, '.env'), 'SENTINEL_SECRET'); await writeFile(path.join(dist, 'app.js.map'), 'SENTINEL_SECRET');
  let handler; const server = createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const auth = { sameOrigin: req => (!req.headers.origin || req.headers.origin === origin) && (!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) && (['GET', 'HEAD'].includes(req.method) || req.headers.origin === origin && req.headers['x-cellproject-request'] === '1'), authorize: async req => req.headers.cookie === 'test=valid' ? { id: 'session-1', user: { id: 'user-1', email: 'wylgnerbossman@gmail.com' }, accessToken: 'SERVER_SECRET' } : null, requestCode: async () => {}, verifyCode: async (_email, _token, _req, res) => { res.setHeader('set-cookie', 'opaque=handle'); return { id: 'user-1', email: 'wylgnerbossman@gmail.com' }; }, logout: async () => {}, close: () => {} };
  handler = createProductionHandler({ config: { enabled: true, origin, supabaseUrl: 'https://wxfootrnfiqpzhmjwgck.supabase.co', publishableKey: 'sb_publishable_test', providers: { openrouter: 'PROVIDER_SECRET' } }, dist, auth, ...options });
  const mutationHeaders = { cookie: 'test=valid', origin, 'content-type': 'application/json', 'x-cellproject-request': '1' };
  const raw = urlPath => new Promise((resolve, reject) => { const req = request(`${origin}${urlPath}`, res => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') })); }); req.on('error', reject); req.end(); });
  try { await fn({ origin, mutationHeaders, auth, raw }); }
  finally { await new Promise(resolve => server.close(resolve)); await rm(dist, { recursive: true, force: true }); }
}
test('vault activation quiesces legacy requests and rejects a legacy request already waiting in its preflight', async () => {
  let releaseMedia, releaseActivation, releasePreflight, mediaEntered, activationEntered, preflightEntered;
  const mediaWait = new Promise(resolve => { releaseMedia = resolve; });
  const activationWait = new Promise(resolve => { releaseActivation = resolve; });
  const preflightWait = new Promise(resolve => { releasePreflight = resolve; });
  const inMedia = new Promise(resolve => { mediaEntered = resolve; });
  const inActivation = new Promise(resolve => { activationEntered = resolve; });
  const inPreflight = new Promise(resolve => { preflightEntered = resolve; });
  let preflightBlocked = false, mediaWrites = 0, activations = 0;
  const repository = { writeMedia: async () => { mediaWrites++; mediaEntered(); await mediaWait; return {}; } };
  const vaultRepository = { assertLegacy: async () => { if (preflightBlocked) { preflightEntered(); await preflightWait; } }, activate: async () => { activations++; activationEntered(); await activationWait; return { revision: 1 }; } };
  await setup(async ({ origin, mutationHeaders }) => {
    const post = route => fetch(`${origin}${route}`, { method: 'POST', headers: mutationHeaders, body: '{}', signal: AbortSignal.timeout(2000) });
    try {
      const media = post('/api/cloud/media'); await inMedia;
      assert.equal((await post('/api/cloud/vault/activate')).status, 429); assert.equal(activations, 0);
      releaseMedia(); assert.equal((await media).status, 200);
      preflightBlocked = true; const waitingLegacy = post('/api/cloud/media'); await inPreflight;
      assert.equal((await post('/api/cloud/vault/activate')).status, 429); assert.equal(activations, 0);
      releasePreflight(); assert.equal((await waitingLegacy).status, 200); assert.equal(mediaWrites, 2);
      const activation = post('/api/cloud/vault/activate'); await inActivation;
      assert.equal((await post('/api/cloud/media')).status, 409);
      releaseActivation(); assert.equal((await activation).status, 200);
    } finally { releaseMedia(); releaseActivation(); releasePreflight(); }
  }, { config: { enabled: true, vaultEnabled: true, origin: 'https://test.invalid' }, repository, vaultRepository });
});

test('production revalidates the registered service worker instead of caching a release for an hour', async () => {
  await setup(async ({ origin }) => {
    const response = await fetch(`${origin}/service-worker.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
  });
});

test('public demo loads without a session and blocks connections independently of the application account', async () => {
  await setup(async ({ origin, auth }) => {
    let accountReads = 0;
    auth.authorize = async () => { accountReads++; throw new Error('The demo must not read an account'); };
    for (const route of ['/demo', '/demo/']) {
      assert.equal((await fetch(`${origin}${route}`)).status, 200);
      const response = await fetch(`${origin}${route}`, { headers: { accept: 'text/html', cookie: 'test=valid' } });
      assert.equal(response.status, 200);
      assert.match(await response.text(), /APP SHELL/);
      const policy = response.headers.get('content-security-policy');
      assert.match(policy, /connect-src 'none'/);
      assert.match(policy, /form-action 'none'/);
      assert.match(policy, /script-src 'self'/);
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    }
    assert.equal(accountReads, 0);
    const normal = await fetch(`${origin}/`, { headers: { accept: 'text/html' } });
    assert.match(normal.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.equal(normal.headers.get('x-robots-tag'), null);
  });
});

test('production serves shell/assets and health, never source/private paths or an SPA response for API failures', async () => {
  await setup(async ({ origin, raw }) => {
    const health = await fetch(`${origin}/healthz`); assert.equal(health.status, 200); assert.deepEqual(await health.json(), { status: 'ok' });
    const shell = await fetch(`${origin}/projects`, { headers: { accept: 'text/html' } }); assert.equal(shell.status, 200); assert.match(await shell.text(), /APP SHELL/); assert.match(shell.headers.get('cache-control'), /no-cache/); assert.equal(shell.headers.get('x-content-type-options'), 'nosniff');
    const js = await fetch(`${origin}/assets/app-abcd.js`); assert.equal(js.status, 200); assert.match(js.headers.get('cache-control'), /immutable/);
    const worker = await fetch(`${origin}/assets/pdf.worker-abcd.mjs`); assert.equal(worker.status, 200); assert.match(worker.headers.get('content-type'), /javascript/);
    for (const route of ['/.env', '/.git/config', '/app.js.map', '/src/store.ts', '/api/unknown', '/api/cloud/unknown', '/missing.js', '/assets/%2e%2e/%2eenv', '/assets/%2e%2e%5c.env']) { const result = await raw(route); assert.notEqual(result.status, 200, route); assert.doesNotMatch(result.text, /SENTINEL_SECRET|APP SHELL/); }
  });
});

test('only an explicitly allowed alternate host redirects public GET/HEAD, while API and health never redirect', async () => {
  const canonical = 'https://builder.cellprojectdiary.com'; const alternate = 'cellproject-builder-production.up.railway.app';
  await setup(async ({ origin }) => {
    const get = (urlPath, host, method = 'GET') => new Promise((resolve, reject) => {
      const req = request(`${origin}${urlPath}`, { method, headers: { host } }, res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location })); }); req.on('error', reject); req.end();
    });
    assert.deepEqual(await get('/projects?view=all', alternate), { status: 308, location: `${canonical}/projects?view=all` });
    assert.equal((await get('/projects', alternate, 'HEAD')).status, 308);
    assert.equal((await get('/api/cloud/config', alternate)).location, undefined);
    assert.equal((await get('/api/cloud/snapshot', alternate)).location, undefined);
    assert.equal((await get('/projects', 'untrusted.example')).status, 421);
    assert.equal((await get('/healthz', 'healthcheck.railway.app')).status, 200);
  }, { config: { enabled: true, origin: canonical, alternateOrigins: [`https://${alternate}`] }, auth: { sameOrigin: () => false, authorize: async () => null } });
});

test('public config never contains provider keys or tokens and private cloud/gateway/AI routes require a session', async () => {
  await setup(async ({ origin }) => {
    const response = await fetch(`${origin}/api/cloud/config`); const config = await response.json();
    assert.deepEqual(config, { enabled: true, authenticated: false, authMethod: 'email_link', passwordAuth: true, passwordProvider: { url: 'https://wxfootrnfiqpzhmjwgck.supabase.co', publishableKey: 'sb_publishable_test' }, providers: { openrouter: true, openai: false, anthropic: false } });
    for (const route of ['/api/cloud/snapshot', '/api/cloud/media/m1', '/api/visuals/capabilities', '/api/ai/openrouter/chat/completions']) {
      const result = await fetch(`${origin}${route}`, route.includes('/ai/') ? { method: 'POST', headers: { origin, 'x-cellproject-request': '1', 'content-type': 'application/json' }, body: '{}' } : {});
      assert.equal(result.status, 401, route); assert.doesNotMatch(await result.text(), /SECRET|APP SHELL/);
    }
    const authed = await fetch(`${origin}/api/cloud/config`, { headers: { cookie: 'test=valid' } }); assert.equal((await authed.json()).authenticated, true);
  });
});

test('direct provider password routes preserve CSRF, expose setup only to a verified session and disable raw passwords for vault clients', async () => {
  let exchanges = 0, setups = 0, rawCalls = 0;
  await setup(async ({ origin, mutationHeaders, auth }) => {
    auth.acceptPasswordSession = async (body, _req, res) => { exchanges++; assert.deepEqual(body, { accessToken: 'ACCESS_SECRET', refreshToken: 'REFRESH_SECRET' }); res.setHeader('set-cookie', 'opaque=handle'); return { id: 'user-1', email: 'wylgnerbossman@gmail.com' }; };
    auth.passwordSetupSession = async req => { setups++; if (req.headers.cookie !== 'test=valid') throw new CloudError(401, 'authentication_required', 'Sign in to continue.'); return { accessToken: 'SETUP_SECRET' }; };
    auth.signInPassword = auth.setPassword = async () => { rawCalls++; };
    const rejected = await fetch(`${origin}/api/auth/password/session`, { method: 'POST', headers: { ...mutationHeaders, origin: 'https://evil.test' }, body: '{}' });
    assert.equal(rejected.status, 403); assert.equal(exchanges, 0);
    const exchange = await fetch(`${origin}/api/auth/password/session`, { method: 'POST', headers: { ...mutationHeaders, cookie: '' }, body: JSON.stringify({ accessToken: 'ACCESS_SECRET', refreshToken: 'REFRESH_SECRET' }) });
    assert.equal(exchange.status, 200); assert.deepEqual(await exchange.json(), { authenticated: true, user: { id: 'user-1', email: 'wylgnerbossman@gmail.com' } });
    assert.equal((await fetch(`${origin}/api/auth/password/setup-session`)).status, 401);
    const setupSession = await fetch(`${origin}/api/auth/password/setup-session`, { headers: { cookie: 'test=valid' } });
    assert.equal(setupSession.status, 200); assert.deepEqual(await setupSession.json(), { accessToken: 'SETUP_SECRET' }); assert.equal(setupSession.headers.get('cache-control'), 'no-store');
    for (const route of ['/api/auth/password/sign-in', '/api/auth/password']) assert.equal((await fetch(`${origin}${route}`, { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ password: 'PRIVATE_PASSWORD' }) })).status, 426);
    assert.equal(rawCalls, 0); assert.equal(setups, 2);
  }, { config: { enabled: true, vaultEnabled: true, origin: 'https://test.invalid', supabaseUrl: 'https://wxfootrnfiqpzhmjwgck.supabase.co', publishableKey: 'sb_publishable_test' } });
});

test('CSP allows only the configured fixed Supabase project for direct password requests', async () => {
  await setup(async ({ origin }) => {
    const shell = await fetch(origin); const policy = shell.headers.get('content-security-policy');
    assert.match(policy, /connect-src 'self' https:\/\/wxfootrnfiqpzhmjwgck\.supabase\.co;/);
    assert.doesNotMatch(policy, /connect-src[^;]*(\*|https:;)/);
  });
});

test('audio recording is same-origin only and previews allow blob media without external connections', async () => {
  await setup(async ({ origin }) => {
    const shell = await fetch(origin);
    assert.equal(shell.headers.get('permissions-policy'), 'camera=(), microphone=(self), geolocation=()');
    const policy = shell.headers.get('content-security-policy');
    assert.match(policy, /media-src 'self' blob:;/);
    assert.match(policy, /connect-src 'self' https:\/\/wxfootrnfiqpzhmjwgck\.supabase\.co;/);
    assert.doesNotMatch(policy, /connect-src[^;]*(openrouter|blob:|\*)/);
  });
});

test('transcription keeps the production authentication and CSRF guards', async () => {
  let calls = 0;
  await setup(async ({ origin, mutationHeaders }) => {
    const body = JSON.stringify({ model: 'openai/gpt-4o-mini-transcribe', input_audio: { data: Buffer.from('RIFF0000WAVE').toString('base64'), format: 'wav' } });
    const route = `${origin}/api/ai/openrouter/audio/transcriptions`;
    for (const [headers, status] of [
      [{ ...mutationHeaders, cookie: '' }, 401],
      [{ ...mutationHeaders, origin: 'https://evil.test' }, 403],
      [{ ...mutationHeaders, 'x-cellproject-request': '' }, 403],
      [{ ...mutationHeaders, 'sec-fetch-site': 'cross-site' }, 403],
    ]) assert.equal((await fetch(route, { method: 'POST', headers, body })).status, status);
    assert.equal(calls, 0);
    const response = await fetch(route, { method: 'POST', headers: mutationHeaders, body });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { text: 'Nota.' });
  }, { fetchImpl: async (url, init) => { calls++; assert.equal(url, 'https://openrouter.ai/api/v1/audio/transcriptions'); assert.equal(init.headers.authorization, 'Bearer PROVIDER_SECRET'); return Response.json({ text: 'Nota.' }); } });
  assert.equal(calls, 1);
});

test('public config never serializes a secret or malformed publishable credential', async () => {
  for (const publishableKey of ['sb_secret_PRIVATE', 'invalid', `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`]) {
    await setup(async ({ origin }) => {
      const body = await (await fetch(`${origin}/api/cloud/config`)).json();
      assert.equal(body.passwordProvider, undefined);
      assert.ok(!JSON.stringify(body).includes(publishableKey));
    }, { config: { enabled: true, origin: 'https://test.invalid', supabaseUrl: 'https://wxfootrnfiqpzhmjwgck.supabase.co', publishableKey } });
  }
});

test('password-access GET and PUT enforce authentication, CSRF, bounded JSON and safe upstream errors', async () => {
  let reads = 0, writes = 0, fail = false;
  const payload = { access: { format: 'dynamic-diary-password-access', cipher: { v: 1, iv: 'synthetic-iv', data: 'synthetic-ciphertext' } }, baseRevision: 0, operationId: 'synthetic-operation', expectedOwnerId: 'user-1' };
  const passwordAccessRepository = {
    async get(session) { reads++; assert.equal(session.user.id, 'user-1'); if (fail) throw new Error('PRIVATE_PROVIDER_TOKEN PRIVATE_VAULT_KEY'); return { access: null }; },
    async write(session, body) { writes++; assert.equal(session.user.id, 'user-1'); assert.deepEqual(body, payload); if (fail) throw new Error('PRIVATE_PROVIDER_TOKEN PRIVATE_VAULT_KEY'); return { revision: 1 }; },
  };
  await setup(async ({ origin, mutationHeaders }) => {
    const route = `${origin}/api/cloud/vault/password-access`;
    assert.equal((await fetch(route)).status, 401);
    assert.equal((await fetch(route, { method: 'PUT', headers: { ...mutationHeaders, cookie: '' }, body: JSON.stringify(payload) })).status, 401);
    assert.equal((await fetch(route, { headers: { cookie: 'test=valid', origin: 'https://evil.test' } })).status, 403);
    for (const headers of [{ origin: 'https://evil.test' }, { 'x-cellproject-request': '' }, { 'sec-fetch-site': 'cross-site' }]) assert.equal((await fetch(route, { method: 'PUT', headers: { ...mutationHeaders, ...headers }, body: JSON.stringify(payload) })).status, 403);
    assert.deepEqual([reads, writes], [0, 0]);
    const read = await fetch(route, { headers: { cookie: 'test=valid' } }); assert.equal(read.status, 200); assert.equal(read.headers.get('cache-control'), 'no-store'); assert.deepEqual(await read.json(), { access: null });
    const write = await fetch(route, { method: 'PUT', headers: mutationHeaders, body: JSON.stringify(payload) }); assert.equal(write.status, 200); assert.deepEqual(await write.json(), { revision: 1 });
    assert.equal((await fetch(route, { method: 'PUT', headers: mutationHeaders, body: JSON.stringify({ cipher: 'X'.repeat(4096) }) })).status, 413);
    assert.equal((await fetch(route, { method: 'PUT', headers: mutationHeaders, body: '{"invalid":' })).status, 400);
    assert.equal((await fetch(route, { method: 'PUT', headers: { ...mutationHeaders, 'content-type': 'text/plain' }, body: JSON.stringify(payload) })).status, 400);
    assert.deepEqual([reads, writes], [1, 1]);
    fail = true;
    for (const init of [{ headers: { cookie: 'test=valid' } }, { method: 'PUT', headers: mutationHeaders, body: JSON.stringify(payload) }]) {
      const failure = await fetch(route, init); assert.equal(failure.status, 502);
      const body = await failure.text(); assert.doesNotMatch(body, /PRIVATE_|synthetic-ciphertext|APP SHELL/); assert.equal(JSON.parse(body).error.code, 'upstream_unavailable');
    }
  }, { config: { enabled: true, vaultEnabled: true, origin: 'https://test.invalid' }, passwordAccessRepository });
});

test('password endpoints retain CSRF/session guards and serialize no credentials or provider tokens', async () => {
  let signIns = 0; let setupLinks = 0; let updates = 0;
  await setup(async ({ origin, mutationHeaders, auth }) => {
    auth.signInPassword = async (email, password, _req, res) => { signIns++; assert.equal(email, 'wylgnerbossman@gmail.com'); assert.equal(password, 'PRIVATE_PASSWORD'); res.setHeader('set-cookie', 'opaque=handle'); return { id: 'user-1', email }; };
    auth.requestPasswordSetup = async (email, _req, res) => { setupLinks++; assert.equal(email, 'wylgnerbossman@gmail.com'); assert.ok(res.setHeader); };
    auth.setPassword = async (password, session) => { updates++; assert.equal(password, 'PRIVATE_PASSWORD'); assert.equal(session.id, 'session-1'); };
    for (const route of ['/api/auth/password/sign-in', '/api/auth/password/setup-link', '/api/auth/password']) {
      for (const extra of [{ origin: 'https://evil.test' }, { 'x-cellproject-request': '' }]) {
        const rejected = await fetch(`${origin}${route}`, { method: 'POST', headers: { ...mutationHeaders, ...extra }, body: JSON.stringify({ email: 'wylgnerbossman@gmail.com', password: 'PRIVATE_PASSWORD' }) });
        assert.equal(rejected.status, 403, route);
      }
    }
    assert.deepEqual([signIns, setupLinks, updates], [0, 0, 0]);
    const denied = await fetch(`${origin}/api/auth/password`, { method: 'POST', headers: { ...mutationHeaders, cookie: '' }, body: JSON.stringify({ password: 'PRIVATE_PASSWORD' }) });
    assert.equal(denied.status, 401); assert.equal(updates, 0);
    const login = await fetch(`${origin}/api/auth/password/sign-in`, { method: 'POST', headers: { ...mutationHeaders, cookie: '' }, body: JSON.stringify({ email: 'wylgnerbossman@gmail.com', password: 'PRIVATE_PASSWORD' }) });
    assert.equal(login.status, 200); assert.deepEqual(await login.json(), { authenticated: true, user: { id: 'user-1', email: 'wylgnerbossman@gmail.com' } });
    const link = await fetch(`${origin}/api/auth/password/setup-link`, { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ email: 'wylgnerbossman@gmail.com' }) });
    assert.equal(link.status, 200); assert.deepEqual(await link.json(), { sent: true });
    const save = await fetch(`${origin}/api/auth/password`, { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ password: 'PRIVATE_PASSWORD' }) });
    assert.equal(save.status, 200); assert.deepEqual(await save.json(), { saved: true });
    assert.deepEqual([signIns, setupLinks, updates], [1, 1, 1]);
  });
});

test('public config exposes password-setup state only for an authenticated session', async () => {
  await setup(async ({ origin, auth }) => {
    const baseAuthorize = auth.authorize;
    auth.authorize = async req => { const session = await baseAuthorize(req); return session ? { ...session, passwordSetup: true } : null; };
    const anonymous = await (await fetch(`${origin}/api/cloud/config`)).json();
    assert.equal(anonymous.passwordAuth, true); assert.equal(anonymous.passwordSetup, undefined);
    const authenticated = await (await fetch(`${origin}/api/cloud/config`, { headers: { cookie: 'test=valid' } })).json();
    assert.equal(authenticated.passwordSetup, true);
    assert.doesNotMatch(JSON.stringify(authenticated), /SERVER_SECRET|PROVIDER_SECRET/);
  });
});

test('password updates return a safe reauthentication error from the auth policy', async () => {
  await setup(async ({ origin, mutationHeaders, auth }) => {
    auth.setPassword = async () => { throw new CloudError(403, 'reauthentication_required', 'Confirme sua identidade por um novo link antes de salvar a senha.'); };
    const result = await fetch(`${origin}/api/auth/password`, { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ password: 'PRIVATE_PASSWORD' }) });
    assert.equal(result.status, 403); assert.equal((await result.json()).error.code, 'reauthentication_required');
  });
});

test('CSRF and cross-origin requests fail before authentication or repository writes', async () => {
  let writes = 0;
  await setup(async ({ origin, mutationHeaders }) => {
    const payload = JSON.stringify({ value: '{"state":{},"version":2}', baseRevision: 0, operationId: 'write-1' });
    for (const change of [{ origin: 'https://evil.test' }, { 'sec-fetch-site': 'cross-site' }, { 'x-cellproject-request': '' }, { origin: '' }]) {
      const response = await fetch(`${origin}/api/cloud/documents/cellproject-workspace`, { method: 'PUT', headers: { ...mutationHeaders, ...change }, body: payload }); assert.equal(response.status, 403);
    }
    const response = await fetch(`${origin}/api/cloud/documents/cellproject-workspace`, { method: 'PUT', headers: mutationHeaders, body: payload }); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { revision: 1 });
  }, { repository: { async writeDocument() { writes++; return { revision: 1 }; } } });
  assert.equal(writes, 1);
});

test('raw preference keys with a colon are valid API paths and preserve the original localStorage value', async () => {
  await setup(async ({ origin, mutationHeaders }) => {
    const response = await fetch(`${origin}/api/cloud/documents/dynamic_diary%3Atask-view`, { method: 'PUT', headers: mutationHeaders, body: JSON.stringify({ value: 'board', baseRevision: 0, operationId: 'pref-1' }) });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { revision: 1 });
  }, { repository: { async writeDocument(_session, key, input) { assert.equal(key, 'dynamic_diary:task-view'); assert.equal(input.value, 'board'); return { revision: 1 }; } } });
});

test('conflicts remain explicit and upstream errors do not expose sensitive text', async () => {
  await setup(async ({ origin, mutationHeaders }) => {
    const write = await fetch(`${origin}/api/cloud/documents/cellproject-graph`, { method: 'PUT', headers: mutationHeaders, body: '{}' }); assert.equal(write.status, 409); assert.equal((await write.json()).error.code, 'revision_conflict');
    const snapshot = await fetch(`${origin}/api/cloud/snapshot`, { headers: { cookie: 'test=valid' } }); assert.equal(snapshot.status, 502); assert.doesNotMatch(await snapshot.text(), /SENTINEL_SECRET/);
  }, { repository: { async writeDocument() { throw new CloudError(409, 'revision_conflict', 'Remote data changed.'); }, async snapshot() { throw new Error('SENTINEL_SECRET'); } } });
});

test('production composes the existing visual gateway with the authorized cloud owner', async () => {
  await setup(async ({ origin }) => {
    const response = await fetch(`${origin}/api/visuals/capabilities`, { headers: { cookie: 'test=valid' } }); assert.equal(response.status, 200); assert.equal((await response.json()).references, true);
  });
});

test('a client disconnected while authorization was pending never starts a paid AI request', async () => {
  let authorizeDone; let started; let upstreamCalls = 0;
  const waiting = new Promise(resolve => { started = resolve; });
  const auth = { sameOrigin: () => true, authorize: async () => { started(); return new Promise(resolve => { authorizeDone = resolve; }); } };
  await setup(async ({ origin, mutationHeaders }) => {
    const controller = new AbortController();
    const result = fetch(`${origin}/api/ai/openrouter/chat/completions`, { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'test' }] }), signal: controller.signal }).catch(error => error);
    await waiting; controller.abort(); assert.ok(await result instanceof Error); await delay(20);
    authorizeDone({ user: { id: 'owner-1' }, accessToken: 'test' }); await delay(20);
    assert.equal(upstreamCalls, 0);
  }, { auth, fetchImpl: async () => { upstreamCalls++; return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }); } });
});

test('cloud disabled supports public shell but refuses private endpoints and never initializes sessions', async () => {
  await setup(async ({ origin }) => {
    assert.deepEqual(await (await fetch(`${origin}/api/cloud/config`)).json(), { enabled: false, authenticated: false, providers: { openrouter: false, openai: false, anthropic: false } });
    assert.equal((await fetch(`${origin}/api/cloud/snapshot`)).status, 503);
  }, { config: { enabled: false } });
});

test('email callback is a no-store navigation exception, uses the backend response cookie and removes code from success and failure URLs', async () => {
  let completions = 0; let sentResponse = false;
  const auth = { sameOrigin: () => false, authorize: async () => null, async callback(req, res) {
    completions++; assert.equal(new URL(req.url, 'https://example.test').searchParams.get('code'), 'PRIVATE_EMAIL_CODE');
    res.setHeader('set-cookie', ['__Host-cellproject_auth_flow=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0', '__Host-cellproject_session=opaque; Path=/; Secure; HttpOnly; SameSite=Strict']);
    if (completions === 2) throw new Error('PRIVATE_EMAIL_CODE PRIVATE_PROVIDER_TOKEN');
  }, async requestCode(_email, _req, res) { sentResponse = Boolean(res?.setHeader); } };
  await setup(async ({ origin }) => {
    for (const [attempt, location] of [[1, '/'], [2, '/?auth_error=link_invalid']]) {
      const response = await fetch(`${origin}/api/auth/callback?code=PRIVATE_EMAIL_CODE`, { redirect: 'manual', headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } });
      assert.equal(response.status, 303, String(attempt)); assert.equal(response.headers.get('location'), location);
      assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.doesNotMatch(await response.text(), /PRIVATE_EMAIL_CODE|PRIVATE_PROVIDER_TOKEN/);
      assert.ok(response.headers.getSetCookie().some(value => value.includes('__Host-cellproject_auth_flow=')));
    }
    assert.equal((await fetch(`${origin}/api/auth/callback?code=PRIVATE_EMAIL_CODE`, { method: 'POST', redirect: 'manual' })).status, 403);
    auth.sameOrigin = () => true;
    const send = await fetch(`${origin}/api/auth/request-code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'wylgnerbossman@gmail.com' }) });
    assert.equal(send.status, 200); assert.equal(sentResponse, true);
    assert.deepEqual(await send.json(), { sent: true });
  }, { auth });
  assert.equal(completions, 2);
});
