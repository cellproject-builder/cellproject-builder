// @vitest-environment node
import { createServer, type ServerResponse } from 'node:http';
import { afterEach, expect, it } from 'vitest';
// @ts-expect-error The production gateway is a Node ESM entry point without client declarations.
import { createProductionHandler } from '../../server/production.mjs';
import { sessionFromDeviceKey, type VaultHeader, type VaultSession } from '@/cloud/vault/crypto';
import { LiveInkChannel, type LiveInkFrame, type LiveInkScope } from './live';

const scope: LiveInkScope = { surface: 'board', documentId: 'board-http' };
const stroke = (id: string) => ({ id, color: '#abcdef', width: 3, tool: 'fountain' as const, points: [{ x: 10, y: 20, pressure: .2 }, { x: 35, y: 50, pressure: .8 }] });
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function until(check: () => boolean, reason: string, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  expect(check(), reason).toBe(true);
}

async function harness() {
  const cipher = { v: 1 as const, iv: btoa('\0'.repeat(12)), data: btoa('\0'.repeat(48)) };
  const header: VaultHeader = { format: 'dynamic-diary-vault', version: 1, id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: btoa('\0'.repeat(16)) }, password: cipher, recovery: cipher };
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const outsiderKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const sessions: VaultSession[] = [sessionFromDeviceKey('owner-a', header, key), sessionFromDeviceKey('owner-a', header, structuredClone(key)), sessionFromDeviceKey('owner-b', { ...header, id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }, outsiderKey)];
  const identities = new Map([['tablet', 'owner-a'], ['desktop', 'owner-a'], ['outsider', 'owner-b']]);
  const streams = new Map<string, Set<ServerResponse>>();
  const getCounts = new Map<string, number>(), statuses = new Map<string, number[]>(), receivedEvents = new Map<string, number>();
  const posted: string[] = [], channels: LiveInkChannel[] = [], commits: LiveInkFrame[] = [];
  let handler!: ReturnType<typeof createProductionHandler>;
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/live/ink') {
      const device = String(req.headers.cookie ?? '').replace('device=', '');
      getCounts.set(device, (getCounts.get(device) ?? 0) + 1);
      const active = streams.get(device) ?? new Set<ServerResponse>(); streams.set(device, active); active.add(res);
      res.once('close', () => active.delete(res));
    }
    void handler(req, res);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test server address.');
  const origin = `http://127.0.0.1:${address.port}`;
  handler = createProductionHandler({ config: { enabled: true, vaultEnabled: true, origin }, auth: {
    sameOrigin: (req: { method: string; headers: Record<string, string | undefined> }) => req.headers.host === new URL(origin).host && (!req.headers.origin || req.headers.origin === origin) && (req.method === 'GET' || req.headers.origin === origin && req.headers['x-cellproject-request'] === '1'),
    authorize: async (req: { headers: Record<string, string | undefined> }) => {
      const device = (req.headers.cookie ?? '').replace('device=', ''), owner = identities.get(device);
      return owner ? { id: `session-${device}`, user: { id: owner } } : null;
    }, close() {},
  }, repository: {}, vaultRepository: {} });
  const fetcher = (device: string): typeof fetch => async (input, init) => {
    const headers = new Headers(init?.headers); headers.set('cookie', `device=${device}`); headers.set('origin', origin);
    if (init?.method === 'POST') posted.push(String(init.body));
    // Only browser cookies/origin are supplied by the fixture; encryption, HTTP,
    // production routing, stream parsing and receiving are the real implementations.
    const response = await fetch(new URL(String(input), origin), { ...init, headers });
    const list = statuses.get(device) ?? []; statuses.set(device, list); list.push(response.status);
    if (response.body && response.headers.get('content-type')?.startsWith('text/event-stream')) {
      const decoder = new TextDecoder(); let buffered = '';
      const observed = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
        buffered += decoder.decode(chunk, { stream: true });
        let end: number;
        while ((end = buffered.indexOf('\n\n')) !== -1) {
          const message = buffered.slice(0, end); buffered = buffered.slice(end + 2);
          if (message.startsWith('event: ink\n')) receivedEvents.set(device, (receivedEvents.get(device) ?? 0) + 1);
        }
        controller.enqueue(chunk);
      } }));
      return new Response(observed, { status: response.status, headers: response.headers });
    }
    return response;
  };
  for (const [index, device] of ['tablet', 'desktop', 'outsider'].entries()) {
    const channel = new LiveInkChannel({ session: sessions[index], fetcher: fetcher(device), ...(device === 'desktop' ? { onCommit: (frame: LiveInkFrame) => commits.push(frame) } : {}) });
    channels.push(channel); channel.start();
  }
  let closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    channels.forEach(channel => channel.dispose()); sessions.forEach(session => session.dispose()); handler.close();
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  };
  cleanups.push(close);
  await until(() => ['tablet', 'desktop', 'outsider'].every(device => statuses.get(device)?.includes(200)), 'all three independent HTTP streams connect');
  return { channels, sessions, identities, streams, getCounts, statuses, receivedEvents, posted, commits, close };
}

it('transfers an encrypted preview before finish, commits and cancels through real HTTP while isolating another account', async () => {
  const fixture = await harness(), [tablet, desktop, outsider] = fixture.channels;
  tablet.preview(scope, 'trace-http', stroke('trace-http'));
  await until(() => desktop.getRemote(scope).length === 1, 'desktop receives the unfinished gesture');
  expect(tablet.hasLocalGesture()).toBe(true);
  expect(desktop.getRemote(scope)[0]).toMatchObject({ gestureId: 'trace-http', committed: false, stroke: { color: '#abcdef', width: 3, tool: 'fountain', points: [{ x: 10, y: 20, pressure: .2 }, { x: 35, y: 50, pressure: .8 }] } });
  expect(tablet.getRemote(scope)).toHaveLength(0);
  expect(outsider.getRemote(scope)).toHaveLength(0);
  expect(desktop.getRemote({ ...scope, documentId: 'different-board' })).toHaveLength(0);
  tablet.finish(scope, 'trace-http');
  await until(() => fixture.commits.some(frame => frame.gestureId === 'trace-http'), 'commit passes through the stream');
  expect(desktop.getRemote(scope)[0].committed).toBe(true);

  tablet.preview(scope, 'cancel-http', stroke('cancel-http'));
  await until(() => desktop.getRemote(scope).some(value => value.gestureId === 'cancel-http'), 'second gesture is visible before cancellation');
  tablet.finish(scope, 'cancel-http', true);
  await until(() => !desktop.getRemote(scope).some(value => value.gestureId === 'cancel-http'), 'cancel removes only its remote preview');
  expect(fixture.commits.map(frame => frame.gestureId)).toEqual(['trace-http']);
  expect(outsider.getRemote(scope)).toHaveLength(0);
  // The unrelated key would hide an accidental relay leak at the renderer. A
  // subsequent own-account echo provides a stream-order barrier: none of the
  // preceding owner-a frames may have arrived on the outsider's HTTP stream.
  outsider.preview(scope, 'outsider-only', stroke('outsider-only'));
  await until(() => (fixture.receivedEvents.get('outsider') ?? 0) >= 1, 'outsider stream receives its own account echo');
  expect(fixture.receivedEvents.get('outsider')).toBe(1);
  expect(outsider.getRemote(scope)).toHaveLength(0);
  for (const body of fixture.posted) {
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(['data', 'iv', 'v']);
    expect(body).not.toMatch(/board-http|trace-http|cancel-http|outsider-only|owner-a|pressure|fountain|points/);
  }
  // Opening one captured HTTP envelope independently proves the payload is
  // authenticated by the shared vault; the unrelated vault cannot open it.
  expect(JSON.parse(await fixture.sessions[1].openText(JSON.parse(fixture.posted[0]), 'live-ink:v1')).gestureId).toBe('trace-http');
  await expect(fixture.sessions[2].openText(JSON.parse(fixture.posted[0]), 'live-ink:v1')).rejects.toThrow();
});

it('reconnects after a real stream ends and clears previews when the renewed request is unauthorized', async () => {
  const fixture = await harness(), [tablet, desktop] = fixture.channels;
  for (const stream of fixture.streams.get('desktop') ?? []) stream.end();
  await until(() => (fixture.getCounts.get('desktop') ?? 0) >= 2 && fixture.statuses.get('desktop')?.filter(status => status === 200).length === 2, 'desktop reconnects to the production endpoint', 4000);
  tablet.preview(scope, 'after-reconnect', stroke('after-reconnect'));
  await until(() => desktop.getRemote(scope).length === 1, 'new stream receives subsequent real frames');
  fixture.identities.delete('desktop');
  for (const stream of fixture.streams.get('desktop') ?? []) stream.end();
  await until(() => fixture.statuses.get('desktop')?.includes(401) === true && desktop.getRemote(scope).length === 0, 'rejected reconnection disposes decrypted previews', 4000);
  expect(tablet.hasLocalGesture()).toBe(true);
}, 10000);

it('disposes all HTTP streams and decrypted previews when the sessions close', async () => {
  const fixture = await harness(), [tablet, desktop] = fixture.channels;
  tablet.preview(scope, 'before-close', stroke('before-close'));
  await until(() => desktop.getRemote(scope).length === 1, 'receive a preview before teardown');
  await fixture.close();
  expect([...fixture.streams.values()].every(streams => streams.size === 0)).toBe(true);
  expect(fixture.channels.every(channel => !channel.hasLocalGesture() && channel.getRemote(scope).length === 0)).toBe(true);
});
