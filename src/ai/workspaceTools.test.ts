import { beforeEach, expect, it, vi } from 'vitest';
import { flushWorkspacePersistence, useWorkspaceStore as store } from '@/workspace/store';
import { IndexedDbWorkspaceRepository } from '@/data/workspaceRepository';
import { requestWorkspaceUI } from '@/workspace/uiRequests';
import { useConfigStore } from '@/config/store';
import { useSidebarStore } from '@/workspace/sidebarPreference';
import { createAssistantTools, executeWorkspaceAction, readWorkspace } from './workspaceTools';
import type { NoteCanvasDocument } from '@/workspace/noteCanvasModel';

beforeEach(async () => {
  await store.persist.rehydrate();
  store.setState({ projects: {}, tasks: {}, sprints: {}, notes: {}, folders: {}, comments: {}, legacyImported: true, surface: 'projects', activeProjectId: null });
});

it('lets the assistant control the same persisted sidebar preference as the interface', async () => {
  await executeWorkspaceAction({ action: 'set_sidebar_collapsed', collapsed: true });
  expect(useSidebarStore.getState().collapsed).toBe(true);
  expect(localStorage.getItem('dynamic_diary-sidebar-collapsed')).toBe('true');
  await executeWorkspaceAction({ action: 'set_sidebar_collapsed', collapsed: false });
  expect(useSidebarStore.getState().collapsed).toBe(false);
});

it('executes connected project, task, note and comment actions through the shared store', async () => {
  const project = await executeWorkspaceAction({ action: 'create_project', name: 'Entrega' }) as { id: string };
  const task = await executeWorkspaceAction({ action: 'create_task', projectId: project.id, title: 'Implementar' }) as { id: string };
  const note = await executeWorkspaceAction({ action: 'create_note', title: 'Diário', text: 'Primeiro registro', projectId: project.id, taskId: task.id }) as { id: string };
  await executeWorkspaceAction({ action: 'add_comment', taskId: task.id, body: 'Em execução' });
  expect(store.getState().notes[note.id].blocks[0].text).toBe('Primeiro registro');
  expect(Object.values(store.getState().comments)[0]).toMatchObject({ taskId: task.id, author: 'assistant', body: 'Em execução' });
  await executeWorkspaceAction({ action: 'update_task', id: task.id, patch: { status: 'doing' } });
  expect(store.getState().tasks[task.id].status).toBe('doing');
});

it('cannot assign a task to a sprint from another project', async () => {
  const a = store.getState().createProject('A'), b = store.getState().createProject('B');
  const task = store.getState().createTask(a, { title: 'Tarefa' });
  const sprint = store.getState().createSprint(b, { name: 'Sprint', goal: '', startDate: '2026-10-08', endDate: '2026-10-22' });
  await expect(executeWorkspaceAction({ action: 'update_task', id: task, patch: { sprintId: sprint } })).rejects.toThrow('invalidSprint');
  expect(store.getState().tasks[task].sprintId).toBeNull();
});

it('rejects unknown action fields before mutating state', async () => {
  await expect(executeWorkspaceAction({ action: 'create_project', name: 'Projeto', providers: { apiKey: 'forbidden' } })).rejects.toThrow();
  expect(Object.values(store.getState().projects)).toHaveLength(0);
});

it('lets the assistant create and update project icons through the same validated store actions', async () => {
  const project = await executeWorkspaceAction({ action: 'create_project', name: 'Robô', appearance: { icon: 'GearIcon', color: '#60a5fa' } }) as { id: string };
  expect(store.getState().projects[project.id].appearance).toEqual({ icon: 'GearIcon', color: '#60a5fa' });
  await executeWorkspaceAction({ action: 'update_project', id: project.id, patch: { appearance: { icon: 'FutureRobotIcon', color: '#10b981' } } });
  expect(readWorkspace({ collection: 'projects', id: project.id }).items[0]).toMatchObject({ appearance: { icon: 'FutureRobotIcon', color: '#10b981' } });
  const before = store.getState();
  await expect(executeWorkspaceAction({ action: 'create_project', name: 'Inválido', appearance: { icon: '🚀', color: '#60a5fa' } })).rejects.toThrow();
  await expect(executeWorkspaceAction({ action: 'update_project', id: project.id, patch: { name: 'Não aplicar', appearance: { icon: 'GearIcon', color: 'red' } } })).rejects.toThrow();
  expect(store.getState()).toBe(before);
});

it('stops a cancelled action before it writes', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(executeWorkspaceAction({ action: 'create_project', name: 'Projeto' }, controller.signal)).rejects.toThrow();
  expect(Object.keys(store.getState().projects)).toHaveLength(0);
});

it('returns paginated workspace records without configuration credentials', () => {
  useConfigStore.setState({ providers: { openai: { apiKey: 'secret-sentinel', mainModel: 'model', kbModel: 'model' } } });
  store.getState().createProject('Um'); store.getState().createProject('Dois');
  const result = readWorkspace({ collection: 'projects', offset: 0, limit: 1 });
  expect(result.items).toHaveLength(1);
  expect(result.total).toBe(2);
  expect(JSON.stringify(result)).not.toContain('secret-sentinel');
});

it('summarizes visual notes without exposing pixels or diagram internals to workspace reads', () => {
  const id = store.getState().createNote({ title: 'Caderno visual' });
  const visualNote = { ...store.getState().notes[id], canvas: {
    version: 1, width: 1000, height: 800, strokes: [{ id: 'stroke', points: [{ x: 1, y: 2 }], color: '#fff', width: 2 }],
    items: [
      { id: 'image', kind: 'image', src: 'data:image/png;base64,private-pixels-sentinel', label: 'Placa do protótipo', x: 0, y: 0, width: 200, height: 100 },
      { id: 'text', kind: 'text', text: 'Comparar hipóteses de carga', color: '#fff', fontSize: 18, x: 10, y: 10, width: 200, height: 100 },
      { id: 'diagram', kind: 'diagram', diagram: { title: 'Torque por distância', elements: [{ private: 'diagram-internals-sentinel' }] }, values: {}, x: 20, y: 20, width: 200, height: 100 },
    ],
  } as unknown as NoteCanvasDocument };
  store.setState({ notes: { [id]: visualNote } });

  const listing = readWorkspace({ collection: 'notes' });
  expect(listing.items[0]).not.toHaveProperty('canvas');
  expect(listing.items[0]).toHaveProperty('canvasSummary', { strokeCount: 1, itemCount: 3, imageCount: 1, textCount: 1, diagramCount: 1 });
  expect(JSON.stringify(listing)).not.toContain('Placa do protótipo');
  const detail = readWorkspace({ collection: 'notes', id });
  expect(detail.items[0]).not.toHaveProperty('canvas');
  expect(detail.items[0]).toHaveProperty('canvasSummary.items', [
    { id: 'image', kind: 'image', label: 'Placa do protótipo' },
    { id: 'text', kind: 'text', text: 'Comparar hipóteses de carga' },
    { id: 'diagram', kind: 'diagram', title: 'Torque por distância' },
  ]);
  expect(JSON.stringify(detail)).not.toMatch(/private-pixels-sentinel|data:image|diagram-internals-sentinel/);
  expect(readWorkspace({ collection: 'notes', query: 'private-pixels-sentinel' }).total).toBe(0);
  expect(readWorkspace({ collection: 'notes', query: 'hipóteses de carga' }).total).toBe(1);
});

it('bounds visual note context even when many large items are present', () => {
  const id = store.getState().createNote({ title: 'Rascunhos' });
  const visualNote = { ...store.getState().notes[id], canvas: {
    version: 1, width: 1000, height: 800, strokes: [],
    items: Array.from({ length: 120 }, (_, index) => ({ id: `text-${index}`, kind: 'text', text: 'a'.repeat(50_000), color: '#fff', fontSize: 18, x: 0, y: 0, width: 200, height: 100 })),
  } as unknown as NoteCanvasDocument };
  store.setState({ notes: { [id]: visualNote } });
  const detail = readWorkspace({ collection: 'notes', id });
  const summary = detail.items[0].canvasSummary as { itemCount: number; items: { text?: string }[]; omittedItems: number };
  expect(summary.itemCount).toBe(120);
  expect(summary.items.length).toBeLessThanOrEqual(30);
  expect(summary.items.reduce((count, item) => count + (item.text?.length ?? 0), 0)).toBeLessThanOrEqual(4000);
  expect(summary.items.every(item => !item.text || item.text.length <= 500)).toBe(true);
  expect(summary.omittedItems).toBeGreaterThan(0);
});

it('reports the explicit chat context separately from the visible workspace project', async () => {
  const context = store.getState().createProject('Contexto do chat');
  const visible = store.getState().createProject('Editor visível');
  const tools = createAssistantTools(new AbortController().signal, () => {}, 'Analise a referência', { beforeRequest: async () => {}, onRateLimit: () => {}, contextProjectId: context });
  const response = await tools.workspace_read.execute!({ collection: 'projects', id: context }, { toolCallId: 'context', messages: [] });
  expect(response).toMatchObject({ ok: true, result: { currentProjectId: context, visibleProjectId: visible } });
  expect(store.getState().activeProjectId).toBe(visible);
});

it('serializes parallel tool calls until the prior mutation is persisted', async () => {
  await flushWorkspacePersistence();
  let release: (() => void) | undefined;
  const repository = new IndexedDbWorkspaceRepository(), save = repository.save.bind(repository);
  const write = vi.spyOn(IndexedDbWorkspaceRepository.prototype, 'save').mockImplementationOnce((key, value) =>
    new Promise<void>((resolve) => { release = resolve; }).then(() => save(key, value)));
  const events: string[] = [];
  const tools = createAssistantTools(new AbortController().signal, (event) => events.push(`${event.action}:${event.status}`), 'Crie um projeto');
  const options = { toolCallId: 'parallel', messages: [] };
  const first = tools.workspace_action.execute!({ action: 'create_project', name: 'Em ordem' }, options);
  const second = tools.workspace_read.execute!({ collection: 'projects' }, options);
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(write).toHaveBeenCalledOnce();
    expect(events).toEqual(['create_project:running']);
    release!();
    await Promise.all([first, second]);
    expect(events).toEqual(['create_project:running', 'create_project:done', 'workspace_read:running', 'workspace_read:done']);
    const persisted = JSON.parse((await repository.load('cellproject-workspace'))!);
    expect(persisted.state.projects).toEqual(store.getState().projects);
  } finally {
    release?.();
    await Promise.all([first, second]);
    write.mockRestore();
  }
});

it('rejects duplicate block IDs before creating a note', async () => {
  await expect(executeWorkspaceAction({ action: 'create_note', blocks: [{ id: 'same', type: 'text', text: 'A' }, { id: 'same', type: 'text', text: 'B' }] })).rejects.toThrow('unique IDs');
  expect(Object.keys(store.getState().notes)).toHaveLength(0);
});

it('infers navigation ownership and rejects a mismatched destination before changing screens', () => {
  const a = store.getState().createProject('A'), b = store.getState().createProject('B');
  const taskId = store.getState().createTask(a, { title: 'De A' });
  expect(() => requestWorkspaceUI({ surface: 'kanban', taskId, projectId: b })).toThrow('different project');
  expect(store.getState().activeProjectId).toBe(b);
  const target = requestWorkspaceUI({ surface: 'kanban', taskId });
  expect(target.projectId).toBe(a);
  expect(store.getState().activeProjectId).toBe(a);
});
