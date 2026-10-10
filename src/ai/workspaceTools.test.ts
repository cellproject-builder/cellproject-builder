import { beforeEach, expect, it, vi } from 'vitest';
import { flushWorkspacePersistence, useWorkspaceStore as store } from '@/workspace/store';
import { workspaceRepository } from '@/data/workspaceRepository';
import { requestWorkspaceUI } from '@/workspace/uiRequests';
import { useConfigStore } from '@/config/store';
import { useSidebarStore } from '@/workspace/sidebarPreference';
import { createAssistantTools, executeWorkspaceAction, readWorkspace } from './workspaceTools';

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
  let release!: () => void;
  const write = vi.spyOn(workspaceRepository, 'setItem').mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
  const events: string[] = [];
  const tools = createAssistantTools(new AbortController().signal, (event) => events.push(`${event.action}:${event.status}`), 'Crie um projeto');
  const options = { toolCallId: 'parallel', messages: [] };
  const first = tools.workspace_action.execute!({ action: 'create_project', name: 'Em ordem' }, options);
  const second = tools.workspace_read.execute!({ collection: 'projects' }, options);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(events).toEqual(['create_project:running']);
  release();
  await Promise.all([first, second]);
  expect(events).toEqual(['create_project:running', 'create_project:done', 'workspace_read:running', 'workspace_read:done']);
  write.mockRestore();
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
