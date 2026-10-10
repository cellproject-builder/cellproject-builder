import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fetchPublicHttps, isPublicAddress } from './publicHttps.mjs';

test('rejects private, mapped, reserved and mixed DNS before connecting', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '::1', '::ffff:192.168.1.1', 'fc00::1', '2001:db8::1']) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  let connections = 0;
  const requestImpl = () => { connections++; throw new Error('must not connect'); };
  const lookup = async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }];
  await assert.rejects(fetchPublicHttps('https://example.com/', { lookup, requestImpl }), /public/i);
  for (const url of ['http://example.com/', 'https://user:pass@example.com/', 'https://example.com:444/', 'https://127.0.0.1/']) await assert.rejects(fetchPublicHttps(url, { lookup, requestImpl }));
  assert.equal(connections, 0);
});

function upstream(responses, onOptions) {
  return (url, options, receive) => {
    onOptions?.(url, options);
    const req = new EventEmitter();
    req.destroy = error => { queueMicrotask(() => req.emit('error', error)); };
    req.end = () => queueMicrotask(() => {
      const next = responses.shift();
      const res = new PassThrough(); res.statusCode = next.status ?? 200; res.headers = next.headers ?? { 'content-type': 'text/html' };
      receive(res); res.end(next.body ?? 'hello');
    });
    return req;
  };
}
test('pins DNS lookup and revalidates redirects, rejecting encoding and oversized bodies', async () => {
  const lookup = async host => [{ address: host === 'private.test' ? '10.0.0.1' : '8.8.8.8', family: 4 }];
  let pinned;
  const result = await fetchPublicHttps('https://example.com/', { lookup, requestImpl: upstream([{ body: 'ok' }], (_u, opts) => opts.lookup('example.com', {}, (_err, address) => { pinned = address; })) });
  assert.equal(pinned, '8.8.8.8'); assert.equal(result.bytes.toString(), 'ok');
  await assert.rejects(fetchPublicHttps('https://example.com/', { lookup, requestImpl: upstream([{ status: 302, headers: { location: 'https://private.test/' } }]) }), /public/i);
  await assert.rejects(fetchPublicHttps('https://example.com/', { lookup, requestImpl: upstream([{ status: 302, headers: { location: 'http://example.com/' } }]) }), /HTTPS/i);
  await assert.rejects(fetchPublicHttps('https://example.com/', { lookup, maxBytes: 2, requestImpl: upstream([{ body: 'long' }]) }), /large/i);
  await assert.rejects(fetchPublicHttps('https://example.com/', { lookup, requestImpl: upstream([{ headers: { 'content-encoding': 'gzip' } }]) }), /encoding/i);
});
test('aborted requests stop before network and a hung DNS lookup is bounded by the total timeout', async () => {
  const controller = new AbortController(); controller.abort();
  let connected = false;
  await assert.rejects(fetchPublicHttps('https://example.com/', { signal: controller.signal, requestImpl() { connected = true; } }));
  assert.equal(connected, false);
  await assert.rejects(fetchPublicHttps('https://example.com/', { lookup: () => new Promise(() => {}), timeoutMs: 20 }), /time/i);
});
test('rejecting a remote response closes its body rather than draining unbounded bytes', async () => {
  let response;
  const requestImpl = (_url, _options, receive) => {
    const req = new EventEmitter(); req.destroy = () => {};
    req.end = () => queueMicrotask(() => {
      response = new PassThrough(); response.statusCode = 404; response.headers = {};
      receive(response);
    });
    return req;
  };
  await assert.rejects(fetchPublicHttps('https://example.com/', { lookup: async () => [{ address: '8.8.8.8', family: 4 }], requestImpl }));
  assert.equal(response.destroyed, true);
});
