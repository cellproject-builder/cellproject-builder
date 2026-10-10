import { afterEach, expect, it, vi } from 'vitest';
import { CloudRuntime, configureCloud, type CloudSnapshot } from './runtime';
import { useWorkspaceStore, ensureWorkspaceHydrated } from '@/workspace/store';
import { flushGraphPersistence } from '@/store';
import { applyRemoteCanvasDocuments } from './CloudLiveSync';
import { createBoardDocument } from '@/boards/model';
import { createNoteInk } from '@/workspace/noteInkModel';

afterEach(async () => { await flushGraphPersistence(); configureCloud(null); });

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
  useWorkspaceStore.setState({ activeBoardId: 'b', surface: 'boards' }); await runtime.flush();
  const calls = fetcher.mock.calls.length;
  await runtime.refreshRemote({ keys: ['cellproject-workspace'], apply: applyRemoteCanvasDocuments });
  expect(fetcher).toHaveBeenCalledTimes(calls + 1);
  expect(useWorkspaceStore.getState().notes.n.ink?.strokes).toHaveLength(1);
  expect(useWorkspaceStore.getState().notes.n.blocks[0].text).toBe('Preserved typed content');
  expect(useWorkspaceStore.getState()).toMatchObject({ activeBoardId: 'b', surface: 'boards' });
  expect(useWorkspaceStore.getState().boards.b.document.items).toHaveLength(1);
  revision = 5; useWorkspaceStore.getState().updateBoard('b', { title: 'Actual next edit' }); await runtime.flush();
  expect(fetcher).toHaveBeenCalledTimes(calls + 2);
  expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body)).baseRevision).toBe(5);
  expect(runtime.getSnapshot().pending).toBe(0);
});
