import { afterEach, expect, it, vi } from 'vitest';
import { CloudRuntime, configureCloud, type CloudSnapshot } from './runtime';
import { useWorkspaceStore, ensureWorkspaceHydrated, flushWorkspacePersistence } from '@/workspace/store';
import { flushGraphPersistence } from '@/store';
import { applyRemoteCanvasDocuments } from './CloudLiveSync';
import { createBoardDocument } from '@/boards/model';
import { createNoteInk } from '@/workspace/noteInkModel';

afterEach(async () => { await flushGraphPersistence(); await flushWorkspacePersistence(); configureCloud(null); });

it('applies real Zustand workspace ink without an echo, restores persistence, and writes the next edit against the remote revision', async () => {
  const initial = { projects: {}, tasks: {}, comments: {}, sprints: {}, notes: {}, folders: {}, boards: { b: { id: 'b', title: 'Board', archived: false, createdAt: 1, updatedAt: 1, document: createBoardDocument() } }, legacyImported: true };
  const incoming = structuredClone(initial), ink = createNoteInk();
  ink.strokes.push({ id: 'tablet', color: '#ffffff', width: 2, tool: 'pen', points: [{ x: 100, y: 200, pressure: .7 }] });
  (incoming.notes as Record<string, unknown>).n = { id: 'n', title: 'Remote note', blocks: [{ id: 'text', type: 'text', text: 'Preserved typed content' }], ink, projectId: null, taskId: null, folderId: null, pinned: false, deletedAt: null, createdAt: 1, updatedAt: 2 };
  incoming.boards.b.document.items.push({ id: 'tablet', kind: 'drawing', x: 50, y: 60, width: 80, height: 80, widthStroke: 2, color: '#ffffff', points: [{ x: 1, y: 2, pressure: .7 }] });
  const remote: CloudSnapshot = { documents: [{ key: 'cellproject-workspace', value: JSON.stringify({ version: 2, state: incoming }), revision: 5 }], media: [] };
  let revision = 1;
  const fetcher = vi.fn<typeof fetch>(async (_path, init) => Response.json(init?.method === 'PUT' ? { revision: ++revision } : remote));
  const runtime = new CloudRuntime({ documents: [{ key: 'cellproject-workspace', value: JSON.stringify({ version: 2, state: initial }), revision: 1 }], media: [] }, fetcher);
  configureCloud(runtime); await ensureWorkspaceHydrated();
  useWorkspaceStore.setState({ activeBoardId: 'b', surface: 'boards' }); await flushWorkspacePersistence();
  const calls = fetcher.mock.calls.length;
  await runtime.refreshRemote({ keys: ['cellproject-workspace'], apply: applyRemoteCanvasDocuments });
  expect(fetcher).toHaveBeenCalledTimes(calls + 1);
  expect(useWorkspaceStore.getState().notes.n.ink?.strokes).toHaveLength(1);
  expect(useWorkspaceStore.getState().notes.n.blocks[0].text).toBe('Preserved typed content');
  expect(useWorkspaceStore.getState()).toMatchObject({ activeBoardId: 'b', surface: 'boards' });
  expect(useWorkspaceStore.getState().boards.b.document.items).toHaveLength(1);
  revision = 5; useWorkspaceStore.getState().updateBoard('b', { title: 'Actual next edit' }); await flushWorkspacePersistence();
  expect(fetcher).toHaveBeenCalledTimes(calls + 2);
  expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body)).baseRevision).toBe(5);
  expect(runtime.getSnapshot().pending).toBe(0);
});

it('preserves tablet board edits through successive saves from a stale PC store and applies the merged canonical state while idle', async () => {
  const board = (id: string, title: string) => ({ id, title, archived: false, createdAt: 1, updatedAt: 1, document: createBoardDocument() });
  const initial = { projects: {}, tasks: {}, comments: {}, sprints: {}, notes: {}, folders: {}, boards: { a: board('a', 'A'), b: board('b', 'B') }, legacyImported: true };
  const incoming = structuredClone(initial); incoming.boards.b.title = 'Tablet'; incoming.boards.b.updatedAt = 2;
  let current: CloudSnapshot = { documents: [{ key: 'cellproject-workspace', value: JSON.stringify({ version: 2, state: incoming }), revision: 2 }], media: [] };
  let rejected = false;
  const fetcher = vi.fn<typeof fetch>(async (_path, init) => {
    if (!rejected) { rejected = true; return Response.json({ error: 'revision_conflict' }, { status: 409 }); }
    const body = JSON.parse(String(init?.body));
    expect(body.baseRevision).toBe(current.documents[0].revision);
    current = { documents: [{ key: 'cellproject-workspace', value: body.value, revision: body.baseRevision + 1 }], media: [] };
    return Response.json({ revision: current.documents[0].revision });
  });
  const runtime = new CloudRuntime({ documents: [{ key: 'cellproject-workspace', value: JSON.stringify({ version: 2, state: initial }), revision: 1 }], media: [] }, fetcher, undefined, async () => current);
  configureCloud(runtime); await useWorkspaceStore.persist.rehydrate();
  useWorkspaceStore.getState().updateBoard('a', { title: 'PC first' }); await flushWorkspacePersistence();
  // Canonical merge waits for idle application; the active editor still owns its snapshot.
  expect(useWorkspaceStore.getState().boards.b.title).toBe('B');
  useWorkspaceStore.getState().updateBoard('a', { title: 'PC next' }); await flushWorkspacePersistence();
  expect(JSON.parse(current.documents[0].value).state.boards).toMatchObject({ a: { title: 'PC next' }, b: { title: 'Tablet' } });
  const before = fetcher.mock.calls.length;
  const applied = await runtime.refreshRemote({ keys: ['cellproject-workspace'], apply: applyRemoteCanvasDocuments });
  expect(applied).toHaveLength(1); expect(fetcher).toHaveBeenCalledTimes(before);
  expect(useWorkspaceStore.getState().boards).toMatchObject({ a: { title: 'PC next' }, b: { title: 'Tablet' } });
  useWorkspaceStore.getState().updateBoard('a', { title: 'PC after idle' }); await flushWorkspacePersistence();
  expect(JSON.parse(current.documents[0].value).state.boards.b.title).toBe('Tablet');
});
