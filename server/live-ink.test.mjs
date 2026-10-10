import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createServer } from 'node:http';
import { createLiveInkRelay } from './live-ink.mjs';
import { createProductionHandler } from './production.mjs';

const envelope = (n = 1) => ({ v: 1, iv: Buffer.alloc(12, n).toString('base64'), data: Buffer.alloc(32, n).toString('base64') });
const session = owner => ({ id: `session-${owner}`, user: { id: owner } });
class Response extends EventEmitter {
  headers = {}; chunks = []; writableEnded = false; destroyed = false; headersSent = false; blocked = false;
  setHeader(name, value) { this.headers[name] = value; }
  writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); this.headersSent = true; }
  flushHeaders() { this.headersSent = true; }
  write(value) { this.chunks.push(value); return !this.blocked; }
  end(value) { if (value) this.chunks.push(value); this.writableEnded = true; this.emit('close'); }
}
const request = (method, value) => Object.assign(Readable.from(value ? [Buffer.from(JSON.stringify(value))] : []), { method, headers: { 'content-type': 'application/json' } });

test('relay forwards only ciphertext to peers of the authenticated owner and disposes open streams', async () => {
  const relay = createLiveInkRelay({ authorize: async () => session('a') });
  const first = new Response(), second = new Response(), outsider = new Response();
  await relay.handle(request('GET'), first, session('a'));
  await relay.handle(request('GET'), second, session('a'));
  await relay.handle(request('GET'), outsider, session('b'));
  const posted = new Response(); await relay.handle(request('POST', envelope()), posted, session('a'));
  assert.equal(posted.status, 202); assert.match(second.chunks.join(''), /event: ink/);
  assert.match(first.chunks.join(''), /event: ink/); assert.doesNotMatch(outsider.chunks.join(''), /event: ink/);
  assert.doesNotMatch(second.chunks.join(''), /owner|session|coordinate/);
  relay.close(); assert.equal(first.writableEnded, true); assert.equal(second.writableEnded, true); assert.equal(outsider.writableEnded, true);
});

test('relay rejects plaintext, extra owner fields, invalid base64, replay and bounded owner flooding', async () => {
  const relay = createLiveInkRelay({ authorize: async () => session('a'), rate: 2, burst: 2 });
  try {
    for (const value of [{ points: [{ x: 1, y: 2 }] }, { ...envelope(), owner: 'b' }, { ...envelope(), iv: 'fake' }, { ...envelope(), data: 'A===' }]) {
      await assert.rejects(relay.handle(request('POST', value), new Response(), session('a')), error => error.status === 400);
    }
    await relay.handle(request('POST', envelope()), new Response(), session('a'));
    await assert.rejects(relay.handle(request('POST', envelope()), new Response(), session('a')), error => error.status === 409);
    await relay.handle(request('POST', envelope(2)), new Response(), session('a'));
    await assert.rejects(relay.handle(request('POST', envelope(3)), new Response(), session('a')), error => error.status === 429);
    await relay.handle(request('POST', envelope(3)), new Response(), session('b'));
  } finally { relay.close(); }
});

test('relay keeps transient backpressure open, resumes on drain and bounds a stalled peer', async () => {
  const relay = createLiveInkRelay({ authorize: async () => session('a'), drainTimeoutMs: 20 });
  try {
    const peer = new Response();
    await relay.handle(request('GET'), peer, session('a'));
    peer.blocked = true;
    await relay.handle(request('POST', envelope(7)), new Response(), session('a'));
    assert.equal(peer.writableEnded, false, 'a buffered write is not a disconnection');
    const count = peer.chunks.length;
    await relay.handle(request('POST', envelope(8)), new Response(), session('a'));
    assert.equal(peer.chunks.length, count, 'do not queue more ephemeral frames while blocked');
    peer.blocked = false; peer.emit('drain');
    await relay.handle(request('POST', envelope(9)), new Response(), session('a'));
    assert.equal(peer.chunks.length, count + 1);
    peer.blocked = true;
    await relay.handle(request('POST', envelope(10)), new Response(), session('a'));
    await new Promise(resolve => setTimeout(resolve, 35));
    assert.equal(peer.writableEnded, true);
    assert.equal(peer.listenerCount('drain'), 0);
  } finally { relay.close(); }
});

test('relay rechecks the original authentication before stream TTL', async () => {
  let valid = true;
  const relay = createLiveInkRelay({ authorize: async () => valid ? session('a') : null, heartbeatMs: 5, reauthorizeMs: 10, streamTtlMs: 1000 });
  try {
    const expired = new Response(); await relay.handle(request('GET'), expired, session('a')); valid = false;
    await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(expired.writableEnded, true);
  } finally { relay.close(); }
});

test('production live routes preserve same-origin and account guards without entering cloud vault barriers', async () => {
  let handler, legacyChecks = 0;
  const server = createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  handler = createProductionHandler({ config: { enabled: true, vaultEnabled: true, origin }, auth: {
    sameOrigin: req => !req.headers.origin || req.headers.origin === origin,
    authorize: async req => req.headers.cookie === 'valid=1' ? session('a') : null, close() {},
  }, repository: {}, vaultRepository: { assertLegacy() { legacyChecks++; throw new Error('must not enter persistence'); } } });
  try {
    const post = headers => fetch(`${origin}/api/live/ink`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(envelope()) });
    assert.equal((await post({ origin })).status, 401);
    assert.equal((await post({ origin: 'https://other.invalid', cookie: 'valid=1' })).status, 403);
    assert.equal((await post({ origin, cookie: 'valid=1' })).status, 202);
    assert.equal(legacyChecks, 0);
  } finally { handler.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('two real authenticated browser streams survive large consecutive frames while another account receives none', async () => {
  let handler;
  const server = createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, controllers = [];
  handler = createProductionHandler({ config: { enabled: true, vaultEnabled: true, origin }, auth: {
    sameOrigin: req => !req.headers.origin || req.headers.origin === origin,
    authorize: async req => req.headers.cookie === 'owner=a' ? session('a') : req.headers.cookie === 'owner=b' ? session('b') : null, close() {},
  }, repository: {}, vaultRepository: {} });
  try {
    async function connect(owner) {
      const controller = new AbortController(); controllers.push(controller);
      const response = await fetch(`${origin}/api/live/ink`, { headers: { cookie: `owner=${owner}`, origin }, signal: controller.signal });
      assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/event-stream/);
      const chunks = [], reader = response.body.getReader();
      const first = await reader.read(); chunks.push(Buffer.from(first.value).toString());
      void (async () => { try { while (true) { const next = await reader.read(); if (next.done) break; chunks.push(Buffer.from(next.value).toString()); } } catch { /* Test abort. */ } finally { reader.releaseLock(); } })();
      return chunks;
    }
    const first = await connect('a'), second = await connect('a'), outsider = await connect('b');
    const post = value => fetch(`${origin}/api/live/ink`, { method: 'POST', headers: { cookie: 'owner=a', origin, 'content-type': 'application/json' }, body: JSON.stringify(value) });
    async function received(count) {
      const deadline = Date.now() + 2000;
      const frames = chunks => (chunks.join('').match(/event: ink/g) ?? []).length;
      while ((frames(first) < count || frames(second) < count) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
      assert.equal(frames(first), count); assert.equal(frames(second), count);
    }
    assert.equal((await post({ ...envelope(4), data: Buffer.alloc(80 * 1024, 4).toString('base64') })).status, 202);
    await received(1);
    assert.equal((await post(envelope(5))).status, 202);
    await received(2);
    assert.doesNotMatch(outsider.join(''), /event: ink/);
  } finally { controllers.forEach(controller => controller.abort()); handler.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('relay enforces frame and connection limits and expires abandoned streams', async () => {
  let now = 0;
  const relay = createLiveInkRelay({ authorize: async () => session('a'), now: () => now, heartbeatMs: 5, streamTtlMs: 20 });
  try {
    const connections = [];
    for (let n = 0; n < 8; n++) { const response = new Response(); connections.push(response); await relay.handle(request('GET'), response, session('a')); }
    await assert.rejects(relay.handle(request('GET'), new Response(), session('a')), error => error.status === 429);
    const huge = { ...envelope(), data: Buffer.alloc(512 * 1024).toString('base64') };
    await assert.rejects(relay.handle(request('POST', huge), new Response(), session('a')), error => error.status === 413);
    now = 25; await new Promise(resolve => setTimeout(resolve, 12)); assert.ok(connections.every(response => response.writableEnded));
  } finally { relay.close(); }
});
