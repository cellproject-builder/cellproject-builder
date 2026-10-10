import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LiveInkChannel, type LiveInkFrame } from './live';
import { sessionFromDeviceKey, type VaultHeader, type VaultSession } from '@/cloud/vault/crypto';

const scope = { surface: 'board', documentId: 'board-1' } as const;
const stroke = { id: 'trace-1', x: -20, y: 10, color: '#abcdef', width: 3, tool: 'fountain', points: [{ x: 0, y: 0, pressure: .2 }, { x: 20, y: 30, pressure: .8 }] } as const;
const drawing = () => ({ ...stroke, points: stroke.points.map(point => ({ ...point })) });
let session: VaultSession;
const channels: LiveInkChannel[] = [];
const channel = (options: ConstructorParameters<typeof LiveInkChannel>[0]) => { const value = new LiveInkChannel(options); channels.push(value); return value; };
beforeEach(async () => {
  vi.useFakeTimers();
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  // A valid synthetic header reuses the same device key in two browser sessions without password derivation in every test.
  const cipher = { v: 1, iv: btoa('\0'.repeat(12)), data: btoa('\0'.repeat(48)) };
  const header = { format: 'dynamic-diary-vault', version: 1, id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: btoa('\0'.repeat(16)) }, password: cipher, recovery: cipher } as VaultHeader;
  session = sessionFromDeviceKey('owner-a', header, key);
});
afterEach(() => { channels.splice(0).forEach(value => value.dispose()); session.dispose(); vi.useRealTimers(); vi.restoreAllMocks(); });
const deferred = <T = void,>() => { let resolve!: (value: T | PromiseLike<T>) => void; const promise = new Promise<T>(ready => { resolve = ready; }); return { promise, resolve }; };
async function receive(receiver: LiveInkChannel, frame: LiveInkFrame) { await receiver.receive(await session.seal(JSON.stringify(frame), 'live-ink:v1')); }

it('coalesces previews, sends only a vault envelope and orders the final frame after active encryption', async () => {
  const firstPost = deferred(), finalPost = deferred();
  const bodies: string[] = [], fetcher = vi.fn<typeof fetch>(async (_path, init) => { bodies.push(init!.body as string); (bodies.length === 1 ? firstPost : finalPost).resolve(); return Response.json({ received: true }, { status: 202 }); });
  const sender = channel({ session, fetcher });
  sender.preview(scope, 'trace-1', drawing()); sender.preview(scope, 'trace-1', { ...drawing(), width: 5 });
  expect(fetcher).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(100); await firstPost.promise;
  expect(bodies).toHaveLength(1); expect(bodies[0]).not.toMatch(/board-1|fountain|points|trace-1|owner-a|width/);
  const preview = JSON.parse(await session.openText(JSON.parse(bodies[0]), 'live-ink:v1'));
  expect(preview.stroke.width).toBe(5); expect(preview.phase).toBe('preview');
  sender.preview(scope, 'trace-1', { ...drawing(), width: 7 }); sender.finish(scope, 'trace-1'); await finalPost.promise;
  expect(bodies).toHaveLength(2);
  const commit = JSON.parse(await session.openText(JSON.parse(bodies[1]), 'live-ink:v1'));
  expect(commit.phase).toBe('commit'); expect(commit.seq).toBeGreaterThan(preview.seq); expect(commit.stroke.width).toBe(7);
});

it('keeps remote previews scoped, drops replays/local echoes and expires cancellations and committed previews', async () => {
  const committed = vi.fn(), receiver = channel({ session, onCommit: committed });
  const frame: LiveInkFrame = { version: 1, sender: 'other-device', scope, gestureId: 'trace-1', seq: 1, phase: 'preview', stroke: drawing() };
  await receive(receiver, frame); expect(receiver.getRemote(scope)).toHaveLength(1);
  expect(receiver.getRemote({ ...scope, documentId: 'another-board' })).toHaveLength(0);
  await receive(receiver, { ...frame, seq: 0, stroke: { ...drawing(), width: 20 } }); expect(receiver.getRemote(scope)[0].stroke.width).toBe(3);
  await receive(receiver, { ...frame, sender: receiver.sender, seq: 2 }); expect(receiver.getRemote(scope)).toHaveLength(1);
  await receive(receiver, { ...frame, seq: 2, phase: 'commit' }); expect(committed).toHaveBeenCalledOnce(); expect(receiver.getRemote(scope)[0].committed).toBe(true);
  await vi.advanceTimersByTimeAsync(2000); expect(receiver.getRemote(scope)).toHaveLength(0);
  await receive(receiver, { ...frame, seq: 3 }); await receive(receiver, { ...frame, seq: 4, phase: 'cancel', stroke: undefined }); expect(receiver.getRemote(scope)).toHaveLength(0);
  await receive(receiver, { ...frame, seq: 5 }); await vi.advanceTimersByTimeAsync(8500); expect(receiver.getRemote(scope)).toHaveLength(0);
});

it('rejects wrong-vault ciphertext, malformed or oversized drawing payloads without exposing them', async () => {
  const receiver = channel({ session });
  const valid: LiveInkFrame = { version: 1, sender: 'other-device', scope, gestureId: 'trace-1', seq: 1, phase: 'preview', stroke: drawing() };
  for (const frame of [{ ...valid, owner: 'someone' }, { ...valid, stroke: { ...drawing(), width: 100 } }, { ...valid, stroke: { ...drawing(), points: Array.from({ length: 4097 }, () => ({ x: 0, y: 0 })) } }]) await receiver.receive(await session.seal(JSON.stringify(frame), 'live-ink:v1'));
  await receiver.receive(await session.seal(JSON.stringify(valid), 'another-purpose'));
  expect(receiver.getRemote(scope)).toHaveLength(0);
});

it('drops offline previews and stops all activity when the vault is no longer active', async () => {
  const attempted = deferred();
  let active = true; const fetcher = vi.fn<typeof fetch>(async () => { attempted.resolve(); throw new TypeError('Offline'); });
  const sender = channel({ session, fetcher, isActive: () => active });
  sender.preview(scope, 'trace-1', drawing()); await vi.advanceTimersByTimeAsync(100); await attempted.promise; expect(fetcher).toHaveBeenCalledOnce();
  active = false; sender.preview(scope, 'trace-1', drawing()); sender.finish(scope, 'trace-1'); await vi.advanceTimersByTimeAsync(2000);
  expect(fetcher).toHaveBeenCalledOnce(); expect(sender.getRemote(scope)).toHaveLength(0);
});

it('reads split SSE frames from a second authenticated connection and aborts the stream on disposal', async () => {
  const frame = { version: 1, sender: 'tablet', scope, gestureId: 'trace-1', seq: 1, phase: 'preview', stroke: drawing() };
  const encrypted = await session.seal(JSON.stringify(frame), 'live-ink:v1'); const encoded = new TextEncoder().encode(`: heartbeat\n\nevent: ink\ndata: ${JSON.stringify(encrypted)}\n\n`);
  let signal: AbortSignal | undefined;
  const receiver = channel({ session, fetcher: vi.fn<typeof fetch>(async (_path, init) => { signal = init?.signal as AbortSignal; return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoded.slice(0, 80)); controller.enqueue(encoded.slice(80)); } }), { headers: { 'content-type': 'text/event-stream' } }); }) });
  const published = deferred();
  const unsubscribe = receiver.subscribe(() => { if (receiver.getRemote(scope).length) published.resolve(); });
  receiver.start(); await published.promise; unsubscribe(); expect(receiver.getRemote(scope)).toHaveLength(1);
  receiver.dispose(); expect(signal?.aborted).toBe(true); expect(receiver.getRemote(scope)).toHaveLength(0);
});

it('finishes behind an in-flight preview and never publishes coordinates after vault disposal during encryption', async () => {
  const pendingEncryption = deferred<Awaited<ReturnType<VaultSession['seal']>>>();
  const encrypted = await session.seal('{}', 'live-ink:v1'), original = session.seal.bind(session);
  const seal = vi.spyOn(session, 'seal').mockImplementationOnce(() => pendingEncryption.promise).mockImplementation(original);
  const finalPost = deferred();
  const bodies: string[] = [], fetcher = vi.fn<typeof fetch>(async (_path, init) => { bodies.push(init!.body as string); if (bodies.length === 2) finalPost.resolve(); return Response.json({ received: true }, { status: 202 }); });
  const sender = channel({ session, fetcher });
  sender.preview(scope, 'trace-1', drawing()); await vi.advanceTimersByTimeAsync(100); expect(seal).toHaveBeenCalledOnce();
  // Fake time cannot complete WebCrypto. The final frame must wait for the actual encryption result.
  sender.finish(scope, 'trace-1'); await vi.advanceTimersByTimeAsync(500); expect(fetcher).not.toHaveBeenCalled();
  pendingEncryption.resolve(encrypted); await finalPost.promise;
  expect(bodies).toHaveLength(2); expect(JSON.parse(await session.openText(JSON.parse(bodies[1]), 'live-ink:v1')).phase).toBe('commit');
  const lateEncryption = deferred<Awaited<ReturnType<VaultSession['seal']>>>();
  seal.mockImplementationOnce(() => lateEncryption.promise);
  sender.preview(scope, 'trace-2', drawing()); await vi.advanceTimersByTimeAsync(100); sender.dispose(); lateEncryption.resolve(encrypted); await lateEncryption.promise;
  await vi.advanceTimersByTimeAsync(0);
  expect(bodies).toHaveLength(2);
});
