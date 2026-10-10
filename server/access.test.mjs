import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalAccess } from './access.mjs';

test('socket, exact Host/Origin, SameSite, method and local session are checked independently of forwarded headers', () => {
  const access = createLocalAccess(); let cookie;
  const res = { setHeader(_key, value) { cookie = value.split(';')[0]; } };
  const request = { method: 'GET', socket: { remoteAddress: '127.0.0.1', localPort: 5190 }, headers: { host: 'localhost:5190' } };
  assert.equal(typeof access(request, res, true), 'string');
  assert.equal(access({ ...request, headers: { ...request.headers, cookie } }, res), cookie.split('=')[1]);
  for (const change of [
    { socket: { remoteAddress: '192.168.1.2', localPort: 5190 } },
    { headers: { host: 'localhost:5191', cookie } },
    { headers: { host: 'evil.example:5190', cookie } },
    { headers: { host: 'localhost:5190', origin: 'http://evil.example', cookie } },
    { headers: { host: 'localhost:5190', 'sec-fetch-site': 'same-site', cookie } },
    { headers: { host: 'localhost:5190', 'sec-fetch-site': 'cross-site', cookie } },
    { method: 'POST', headers: { host: 'localhost:5190', cookie } },
  ]) assert.equal(access({ ...request, ...change }, res, true), null);
  assert.equal(access({ ...request, method: 'POST', headers: { host: 'localhost:5190', origin: 'http://localhost:5190', cookie } }, res), cookie.split('=')[1]);
});
