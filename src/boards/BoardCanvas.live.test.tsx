import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { CloudInkConnection } from '@/cloud/CloudInkConnection';
import { hasActiveDataIngestions } from '@/cloud/activity';
import { CloudRuntime, configureCloud } from '@/cloud/runtime';
import { sessionFromDeviceKey, type VaultHeader, type VaultSession } from '@/cloud/vault/crypto';
import { configureVault } from '@/cloud/vault/privacy';
import { configureLiveInk, getLiveInk, LiveInkChannel, type LiveInkFrame } from '@/ink/live';
import { ensureWorkspaceHydrated, flushWorkspacePersistence, useWorkspaceStore } from '@/workspace/store';
import { BoardCanvas } from './BoardCanvas';

// JSDOM has no canvas layout. Only React Flow's screen/viewport boundary is
// replaced; BoardCanvas, pointer handlers, hook, connection, encryption and SSE
// parser all remain real, with the same zero-offset viewport on both devices.
vi.mock('@xyflow/react', async original => ({
  ...await original<typeof import('@xyflow/react')>(),
  ReactFlow: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Background: () => null,
  useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  useReactFlow: () => ({
    screenToFlowPosition: (point: { x: number; y: number }) => point,
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
  }),
}));

let host: HTMLDivElement | undefined, root: Root | undefined, connection: CloudInkConnection | undefined;
const sessions: VaultSession[] = [], channels: LiveInkChannel[] = [];
afterEach(async () => {
  if (root) act(() => root!.unmount()); root = undefined;
  connection?.dispose(); connection = undefined;
  configureLiveInk(null); channels.splice(0).forEach(channel => channel.dispose());
  configureCloud(null); configureVault(null, false);
  sessions.splice(0).forEach(session => session.dispose()); host?.remove();
  vi.restoreAllMocks();
});

it('publishes and receives pressure-aware board previews during a held gesture, before pointerup or durable saving', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await ensureWorkspaceHydrated();
  useWorkspaceStore.setState({ boards: {}, activeBoardId: null, projects: {}, notes: {}, surface: 'boards' });
  const boardId = useWorkspaceStore.getState().createBoard('Synthetic live preview');
  await flushWorkspacePersistence();
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const cipher = { v: 1 as const, iv: btoa('\0'.repeat(12)), data: btoa('\0'.repeat(48)) };
  const header: VaultHeader = { format: 'dynamic-diary-vault', version: 1, id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: btoa('\0'.repeat(16)) }, password: cipher, recovery: cipher };
  const senderSession = sessionFromDeviceKey('synthetic-owner', header, key), receiverSession = sessionFromDeviceKey('synthetic-owner', header, key);
  sessions.push(senderSession, receiverSession);

  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>(), envelopes: string[] = [];
  let durableWrites = 0;
  const fetcher: typeof fetch = async function (this: unknown, input, init) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    if (String(input) !== '/api/live/ink') { durableWrites++; throw new Error('No durable request is expected before pointerup.'); }
    if (init?.method === 'POST') {
      const body = String(init.body); envelopes.push(body);
      for (const stream of streams) stream.enqueue(new TextEncoder().encode(`event: ink\ndata: ${body}\n\n`));
      return new Response(null, { status: 202 });
    }
    let controller: ReadableStreamDefaultController<Uint8Array>;
    return new Response(new ReadableStream<Uint8Array>({
      start(value) { controller = value; streams.add(value); },
      cancel() { streams.delete(controller); },
    }), { headers: { 'content-type': 'text/event-stream' } });
  };
  // One window owns only one application channel. The second device's real
  // channel receives bytes independently until its UI is mounted below.
  const receiver = new LiveInkChannel({ session: receiverSession, fetcher }); channels.push(receiver); receiver.start();
  const runtime = new CloudRuntime({ documents: [], media: [] }, fetcher);
  configureCloud(runtime); configureVault(senderSession);
  connection = new CloudInkConnection({ runtime, session: senderSession, fetcher }); connection.start();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root!.render(<BoardCanvas boardId={boardId} onBack={() => {}}/>));
  act(() => Simulate.click(host!.querySelector('[aria-label="Desenhar"]')!));
  const pointer = (type: 'pointerDown' | 'pointerMove', x: number, y: number, pressure: number) => act(() => Simulate[type](host!.querySelector('.db-drawing-layer')!, { pointerId: 7, button: 0, isPrimary: true, pointerType: 'pen', clientX: x, clientY: y, pressure } as never));
  const scope = { surface: 'board' as const, documentId: boardId };
  pointer('pointerDown', 10, 20, .2); pointer('pointerMove', 40, 50, .6);
  await act(async () => { await vi.waitFor(() => expect(receiver.getRemote(scope)).toHaveLength(1)); });
  pointer('pointerMove', 70, 90, .8);
  await act(async () => { await vi.waitFor(() => expect(receiver.getRemote(scope)[0]?.stroke.points).toHaveLength(3)); });

  expect(getLiveInk()?.hasLocalGesture()).toBe(true); expect(hasActiveDataIngestions()).toBe(true);
  expect(useWorkspaceStore.getState().boards[boardId].document.items).toHaveLength(0);
  expect(durableWrites).toBe(0); expect(envelopes.length).toBeGreaterThanOrEqual(2);
  for (const envelope of envelopes) expect(envelope).not.toMatch(/points|pressure|Synthetic live preview|synthetic-owner/);
  const frame: LiveInkFrame = JSON.parse(await receiverSession.openText(JSON.parse(envelopes.at(-1)!), 'live-ink:v1'));
  expect(frame).toMatchObject({ phase: 'preview', scope, stroke: { x: 10, y: 20, points: [{ x: 0, y: 0, pressure: .2 }, { x: 30, y: 30, pressure: .6 }, { x: 60, y: 70, pressure: .8 }] } });
  expect(receiver.getRemote({ ...scope, documentId: 'another-board' })).toHaveLength(0);

  // Isolate the receiving UI instead of pretending that two simultaneous
  // browser globals coexist. No pointerup or document commit has occurred.
  act(() => root!.unmount()); root = undefined; connection.dispose(); connection = undefined;
  act(() => configureLiveInk(receiver));
  root = createRoot(host);
  act(() => root!.render(<BoardCanvas boardId={boardId} onBack={() => {}}/>));
  const path = host.querySelector(`[data-board-remote-stroke="${frame.gestureId}"]`);
  expect(path?.getAttribute('d')).toMatch(/^M/);
  expect(path?.parentElement?.getAttribute('transform')).toBe('translate(10 20)');
  expect(host.querySelector('.db-object-count')?.textContent).toContain('0 objetos');
  expect(host.querySelector('.db-drawing-layer')).toBeNull();
  expect(durableWrites).toBe(0);
});
