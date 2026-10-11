import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CloudDocument } from './runtime';

const mocks = vi.hoisted(() => ({ workspace: {} as Record<string, any>, graph: {} as Record<string, any>, owner: 'owner' as string | null, pending: false, busy: false, chat: false }));
function persistedStore(read: () => Record<string, any>, key: string) {
  let storage = { getItem: async () => null, setItem: vi.fn(), removeItem: vi.fn() };
  return { getState: read, setState: (patch: object) => { Object.assign(read(), patch); storage.setItem(key, {}); }, persist: { getOptions: () => ({ storage }), setOptions: (options: { storage: typeof storage }) => { storage = options.storage; } } };
}
vi.mock('@/workspace/store', () => ({ useWorkspaceStore: persistedStore(() => mocks.workspace, 'cellproject-workspace') }));
vi.mock('@/store', () => ({ useGraphStore: persistedStore(() => mocks.graph, 'cellproject-graph'), hasPendingGraphPersistence: () => mocks.pending }));
vi.mock('@/workspace/planner', () => ({ getPlannerOwnerId: () => mocks.owner, plannerBusy: () => mocks.busy }));
vi.mock('@/chat/store', () => ({ useChatStore: { getState: () => ({ running: mocks.chat }) } }));
import { CloudLiveSync, applyRemoteCanvasDocuments, cloudCanvasIdle } from './CloudLiveSync';
import { CloudRuntime } from './runtime';
import { registerDataIngestion } from './activity';
import { createBoardDocument } from '@/boards/model';
import { createNoteCanvas } from '@/workspace/noteCanvasModel';
import { useWorkspaceStore } from '@/workspace/store';
import { LiveInkChannel, configureLiveInk } from '@/ink/live';
import { sessionFromDeviceKey, type VaultHeader } from './vault/crypto';
import { createSelectiveJSONStorage, isDeferredJSONStorage } from '@/data/selectiveJSONStorage';

const board = () => ({ id: 'board', title: 'Board', archived: false, createdAt: 1, updatedAt: 1, document: createBoardDocument() });
const project = () => ({ id: 'plan', name: 'Plan', objective: '', rootId: 'root', nodes: { root: { id: 'root', name: 'Root', parentId: null } }, edges: {}, createdAt: 1, updatedAt: 1 });
const workspace = () => ({ projects: { owner: { id: 'owner', name: 'Owner', objective: '', archived: false, createdAt: 1, updatedAt: 1, planner: { project: project() } } }, tasks: {}, sprints: {}, notes: {}, folders: {}, boards: { board: board() }, comments: {}, legacyImported: true });
function documentOf(data: object, revision = 2): CloudDocument { return { key: 'cellproject-workspace', revision, value: JSON.stringify({ version: 2, state: data }) }; }
beforeEach(() => {
  mocks.workspace = { ...workspace(), surface: 'boards', activeProjectId: 'owner', activeBoardId: 'board' };
  mocks.graph = { project: project(), drafts: {}, objectiveDraft: {}, selectedNodeId: 'root', focusedParentId: 'root', lens: 'risk', viewMode: 'graph', detailPanelOpen: false, lastAction: {} };
  mocks.pending = false; mocks.busy = false; mocks.chat = false; mocks.owner = 'owner';
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => { configureLiveInk(null); vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

it('blocks remote refresh while a local envelope awaits serialization or acknowledgement', async () => {
  let finish!: () => void;
  const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const storage = createSelectiveJSONStorage(() => ({ getItem: () => null, setItem: save, removeItem: () => {} }), { deferMs: 200 })!;
  if (!isDeferredJSONStorage(storage)) throw new Error('deferred adapter missing');
  const write = storage.setItem('cellproject-workspace', { state: { content: 'local draft' }, version: 2 });
  try {
    expect(cloudCanvasIdle()).toBe(false);
    const flushing = storage.flush(); await Promise.resolve();
    expect(cloudCanvasIdle()).toBe(false);
    finish(); await Promise.all([write, flushing]);
    expect(cloudCanvasIdle()).toBe(true);
  } finally { save.mockImplementation(() => Promise.resolve()); finish?.(); await storage.flush(); }
});

it('applies remote board strokes and notebook strokes while preserving the local view and selection', () => {
  const remote = workspace();
  remote.boards.board.document.items.push({ id: 'stroke', kind: 'drawing', x: 2, y: 3, width: 10, height: 10, color: '#111111', widthStroke: 2, points: [{ x: 1, y: 1 }] });
  remote.boards.board.document.viewport = { x: 800, y: 600, zoom: 3 };
  const canvas = createNoteCanvas(); canvas.strokes.push({ id: 'stroke', color: '#111111', width: 2, points: [{ x: 1, y: 1 }] });
  (remote.notes as Record<string, unknown>).n = { id: 'n', title: 'Ink', blocks: [], canvas, createdAt: 1, updatedAt: 1 };
  applyRemoteCanvasDocuments([documentOf(remote)]);
  expect(mocks.workspace.boards.board.document.items).toHaveLength(1); expect(mocks.workspace.notes.n.canvas.strokes).toHaveLength(1);
  expect(mocks.workspace).toMatchObject({ surface: 'boards', activeProjectId: 'owner', activeBoardId: 'board' });
  expect(mocks.workspace.boards.board.document.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  expect(mocks.graph).toMatchObject({ selectedNodeId: 'root', focusedParentId: 'root', lens: 'risk', viewMode: 'graph', detailPanelOpen: false });
});

it('validates all remote documents before applying any and never changes the planner owner to another device project', () => {
  const remote = workspace(); (remote.notes as Record<string, unknown>).bad = { ink: { version: 55, strokes: [] } };
  expect(() => applyRemoteCanvasDocuments([documentOf(remote)])).toThrow(); expect(mocks.workspace.notes).toEqual({});
  applyRemoteCanvasDocuments([{ key: 'cellproject-graph', revision: 2, value: JSON.stringify({ version: 6, state: { project: { ...project(), id: 'other-device-project' }, selectedNodeId: 'other' } }) }]);
  expect(mocks.graph.project.id).toBe('plan'); expect(mocks.graph.selectedNodeId).toBe('root');
});

it('defers the canonical refresh during drawing, focused typing, unsent persistence or AI work', () => {
  const release = registerDataIngestion(); expect(cloudCanvasIdle()).toBe(false); release(); expect(cloudCanvasIdle()).toBe(true);
  mocks.pending = true; expect(cloudCanvasIdle()).toBe(false); mocks.pending = false;
  mocks.chat = true; expect(cloudCanvasIdle()).toBe(false); mocks.chat = false;
  mocks.graph.drafts = { root: { criterion: 'unapplied text' } }; expect(cloudCanvasIdle()).toBe(false); mocks.graph.drafts = {};
  const input = document.createElement('textarea'); document.body.append(input); input.focus(); expect(cloudCanvasIdle()).toBe(false); input.blur();
  expect(cloudCanvasIdle()).toBe(true);
});

it('refreshes on remote commit, uses bounded polling, suppresses persist echoes and cleans up listeners and timers', async () => {
  vi.useFakeTimers();
  const remote = workspace(); remote.boards.board.title = 'From tablet';
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ documents: [documentOf(remote)], media: [] }));
  const runtime = new CloudRuntime({ documents: [documentOf(workspace(), 1)], media: [] }, fetcher);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const storage = useWorkspaceStore.persist.getOptions().storage!;
  vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('remote echo'); });
  await act(async () => root.render(<CloudLiveSync runtime={runtime}/>));
  await act(async () => { window.dispatchEvent(new CustomEvent('dynamic-diary:cloud-commit')); await Promise.resolve(); });
  expect(mocks.workspace.boards.board.title).toBe('From tablet'); expect(fetcher).toHaveBeenCalledOnce();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); expect(fetcher).toHaveBeenCalledTimes(5);
  await act(async () => root.unmount());
  await act(async () => { window.dispatchEvent(new CustomEvent('dynamic-diary:cloud-commit')); await vi.advanceTimersByTimeAsync(4000); });
  expect(fetcher).toHaveBeenCalledTimes(5); runtime.dispose();
});

it('keeps tablet ink visible while a text editor is focused, then hands it to the saved document on blur', async () => {
  vi.useFakeTimers();
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const cipher = { v: 1, iv: btoa('\0'.repeat(12)), data: btoa('\0'.repeat(48)) };
  const header = { format: 'dynamic-diary-vault', version: 1, id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: btoa('\0'.repeat(16)) }, password: cipher, recovery: cipher } as VaultHeader;
  const session = sessionFromDeviceKey('owner-a', header, key), ink = new LiveInkChannel({ session });
  configureLiveInk(ink);
  const remote = workspace();
  remote.boards.board.document.items.push({ id: 'tablet', kind: 'drawing', x: 2, y: 3, width: 10, height: 10, color: '#111111', widthStroke: 2, points: [{ x: 1, y: 1 }] });
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ documents: [documentOf(remote)], media: [] }));
  const runtime = new CloudRuntime({ documents: [documentOf(workspace(), 1)], media: [] }, fetcher);
  const host = document.createElement('div'), input = document.createElement('textarea'); document.body.append(host, input);
  const root = createRoot(host), scope = { surface: 'board', documentId: 'board' } as const;
  try {
    await act(async () => root.render(<CloudLiveSync runtime={runtime}/>));
    input.value = 'My unfinished text'; input.focus();
    await act(async () => {
      await ink.receive(await session.seal(JSON.stringify({ version: 1, sender: 'tablet-device', scope, gestureId: 'tablet', seq: 1, phase: 'commit', stroke: { id: 'tablet', color: '#111111', width: 2, points: [{ x: 1, y: 1 }] } }), 'live-ink:v1'));
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(ink.getRemote(scope)).toHaveLength(1);
    expect(mocks.workspace.boards.board.document.items).toHaveLength(0);
    expect(input.value).toBe('My unfinished text'); expect(document.activeElement).toBe(input);
    await act(async () => { input.blur(); await vi.advanceTimersByTimeAsync(0); });
    expect(mocks.workspace.boards.board.document.items).toHaveLength(1);
    expect(ink.getRemote(scope)).toHaveLength(0);
    expect(input.value).toBe('My unfinished text');
    // A delayed commit arriving after its saved snapshot must not linger and
    // reappear as a ghost if the user subsequently erases the canonical stroke.
    await act(async () => {
      await ink.receive(await session.seal(JSON.stringify({ version: 1, sender: 'tablet-device', scope, gestureId: 'tablet', seq: 2, phase: 'commit', stroke: { id: 'tablet', color: '#111111', width: 2, points: [{ x: 1, y: 1 }] } }), 'live-ink:v1'));
    });
    expect(ink.getRemote(scope)).toHaveLength(0);
  } finally { await act(async () => root.unmount()); runtime.dispose(); configureLiveInk(null); session.dispose(); }
});
