import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getLiveInk, configureLiveInk } from '@/ink/live';
import { sessionFromDeviceKey, type VaultHeader, type VaultSession } from './vault/crypto';
import { configureVault } from './vault/privacy';
import { CloudRuntime, configureCloud } from './runtime';
import { CloudInkConnection } from './CloudInkConnection';

const scope = { surface: 'board', documentId: 'synthetic-board' } as const;
const stroke = (id: string) => ({ id, x: 10, y: 20, color: '#abcdef', width: 3, tool: 'fountain' as const, points: [{ x: 0, y: 0, pressure: .2 }, { x: 20, y: 30, pressure: .8 }] });
const connections: CloudInkConnection[] = [];
let session: VaultSession;
beforeEach(async () => {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const cipher = { v: 1, iv: btoa('\0'.repeat(12)), data: btoa('\0'.repeat(48)) };
  const header = { format: 'dynamic-diary-vault', version: 1, id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: btoa('\0'.repeat(16)) }, password: cipher, recovery: cipher } as VaultHeader;
  session = sessionFromDeviceKey('synthetic-owner', header, key);
});
afterEach(() => { connections.splice(0).forEach(connection => connection.dispose()); configureLiveInk(null); configureCloud(null); configureVault(null, false); session.dispose(); vi.restoreAllMocks(); });
const stream = () => new Response(new ReadableStream<Uint8Array>(), { headers: { 'content-type': 'text/event-stream' } });
function activate(fetcher: typeof fetch) {
  const runtime = new CloudRuntime({ documents: [], media: [] }, fetcher);
  configureCloud(runtime); configureVault(session);
  const connection = new CloudInkConnection({ runtime, session, fetcher }); connections.push(connection); connection.start();
  return { runtime, connection };
}
const account = (id = session.ownerId) => Response.json({ enabled: true, authenticated: true, user: { id, email: 'synthetic@example.test' } });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(ready => { resolve = ready; }); return { promise, resolve }; };

it('reports an expired SSE session and opens a fresh working channel after the same owner resumes authentication', async () => {
  let authenticated = false, subscriptions = 0;
  const bodies: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (path, init) => {
    if (String(path).endsWith('/config')) return account();
    if (init?.method === 'POST') { bodies.push(String(init.body)); return Response.json({ received: true }, { status: 202 }); }
    subscriptions++; return authenticated ? stream() : new Response(null, { status: 401 });
  });
  const { runtime } = activate(fetcher);
  const expired = getLiveInk();
  await vi.waitFor(() => expect(runtime.getSnapshot().issue).toMatchObject({ kind: 'session', key: '/api/live/ink' }));
  expect(getLiveInk()).toBeNull(); expect(subscriptions).toBe(1);
  authenticated = true;
  await runtime.resumeAfterAuthentication(session.ownerId);
  const restored = getLiveInk(); expect(restored).not.toBeNull(); expect(restored).not.toBe(expired); expect(subscriptions).toBe(2);
  restored!.preview(scope, 'new-trace', stroke('new-trace')); restored!.finish(scope, 'new-trace');
  await vi.waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).not.toMatch(/synthetic-board|fountain|pressure|new-trace/);
  const frame = JSON.parse(await session.openText(JSON.parse(bodies[0]), 'live-ink:v1'));
  expect(frame).toMatchObject({ phase: 'commit', gestureId: 'new-trace', stroke: { points: [{ pressure: .2 }, { pressure: .8 }] } });
});

it('restarts after POST access refusal without replaying a stale gesture or its unsent preview', async () => {
  let refuse = true, subscriptions = 0; const frames: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (path, init) => {
    if (String(path).endsWith('/config')) return account();
    if (init?.method === 'POST') { frames.push(String(init.body)); return new Response(null, { status: refuse ? 403 : 202 }); }
    subscriptions++; return stream();
  });
  const { runtime } = activate(fetcher), expired = getLiveInk()!;
  expired.preview(scope, 'old-trace', stroke('old-trace')); expired.finish(scope, 'old-trace');
  expired.preview(scope, 'unsent-trace', stroke('unsent-trace'));
  await vi.waitFor(() => expect(runtime.getSnapshot().issue?.kind).toBe('session'));
  refuse = false; await runtime.resumeAfterAuthentication(session.ownerId);
  const restored = getLiveInk()!; expect(restored.sender).not.toBe(expired.sender);
  restored.preview(scope, 'fresh-trace', stroke('fresh-trace')); restored.finish(scope, 'fresh-trace');
  await vi.waitFor(() => expect(frames).toHaveLength(2)); expect(subscriptions).toBe(2);
  expect(JSON.parse(await session.openText(JSON.parse(frames[1]), 'live-ink:v1')).gestureId).toBe('fresh-trace');
});

it('does not restart when authentication belongs to a different account', async () => {
  let subscriptions = 0;
  const fetcher = vi.fn<typeof fetch>(async path => { if (String(path).endsWith('/config')) return account('another-owner'); subscriptions++; return new Response(null, { status: 401 }); });
  const { runtime } = activate(fetcher);
  await vi.waitFor(() => expect(runtime.getSnapshot().issue?.kind).toBe('session'));
  await expect(runtime.resumeAfterAuthentication(session.ownerId)).rejects.toThrow('mesma conta');
  expect(subscriptions).toBe(1); expect(getLiveInk()).toBeNull();
});

it('ignores a late 401 from the disposed connection after another runtime takes ownership', async () => {
  const pending = deferred<Response>();
  const oldFetcher = vi.fn<typeof fetch>(() => pending.promise);
  const { runtime: old, connection } = activate(oldFetcher);
  const freshFetcher = vi.fn<typeof fetch>(async () => stream());
  const { runtime: fresh } = activate(freshFetcher), current = getLiveInk();
  pending.resolve(new Response(null, { status: 401 }));
  await vi.waitFor(() => expect(oldFetcher).toHaveBeenCalledOnce()); await new Promise(resolve => setTimeout(resolve, 0));
  expect(fresh.getSnapshot().issue).toBeNull(); expect(getLiveInk()).toBe(current); expect(old.getSnapshot().issue).toBeNull();
  connection.dispose(); expect(getLiveInk()).toBe(current);
});

it('unsubscribes on disposal so authentication recovery cannot resurrect a channel', async () => {
  let subscriptions = 0;
  const fetcher = vi.fn<typeof fetch>(async path => { if (String(path).endsWith('/config')) return account(); subscriptions++; return new Response(null, { status: 401 }); });
  const { runtime, connection } = activate(fetcher);
  await vi.waitFor(() => expect(runtime.getSnapshot().issue?.kind).toBe('session'));
  connection.dispose(); await runtime.resumeAfterAuthentication(session.ownerId);
  expect(getLiveInk()).toBeNull(); expect(subscriptions).toBe(1);
});

it('does not reopen a channel when the original vault was locked while the account recovered', async () => {
  let subscriptions = 0;
  const fetcher = vi.fn<typeof fetch>(async path => { if (String(path).endsWith('/config')) return account(); subscriptions++; return new Response(null, { status: 401 }); });
  const { runtime } = activate(fetcher);
  await vi.waitFor(() => expect(runtime.getSnapshot().issue?.kind).toBe('session'));
  configureVault(null, true); await runtime.resumeAfterAuthentication(session.ownerId);
  expect(getLiveInk()).toBeNull(); expect(subscriptions).toBe(1);
});
