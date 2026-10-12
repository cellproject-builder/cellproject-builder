import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CloudRuntime, configureCloud } from '@/cloud/runtime';
import { IndexedDbWorkspaceRepository } from '@/data/workspaceRepository';
import { flushWorkspacePersistence, useWorkspaceStore as workspace } from '@/workspace/store';
import { createAssistantTools, type AssistantActionEvent } from './workspaceTools';

beforeEach(async () => {
  configureCloud(null);
  await flushWorkspacePersistence();
  await workspace.persist.rehydrate();
  workspace.setState({ projects: {}, tasks: {}, sprints: {}, notes: {}, folders: {}, comments: {}, boards: {}, legacyImported: true, activeProjectId: null, surface: 'projects' });
  await flushWorkspacePersistence();
});

afterEach(async () => {
  vi.restoreAllMocks();
  configureCloud(null);
  await flushWorkspacePersistence();
});

it.each(['planner_read', 'planner_action'] as const)('keeps %s usable while cloud reconciliation is pending', async name => {
  const { projectId, runtime } = await conflictedWorkspace();
  const before = runtime.checkpoint();
  const tools = createAssistantTools(new AbortController().signal, () => {}, 'Consulte o plano');
  const options = { toolCallId: name, messages: [] };
  const response = name === 'planner_read'
    ? await tools.planner_read.execute!({ projectId, mode: 'overview' }, options)
    : await tools.planner_action.execute!({ projectId, action: 'read_plan' }, options);
  expect(response).toMatchObject({ ok: true, result: { workspaceProjectId: projectId,
    persistence: { kind: 'conflict', localSaved: true, cloudSynced: false } } });
  expect(runtime.checkpoint()).toEqual(before);
});

it('does not return a previous session read when the new session can flush successfully', async () => {
  await conflictedWorkspace();
  const replacement = new CloudRuntime({ documents: [], media: [] });
  const tools = createAssistantTools(new AbortController().signal, event => {
    if (event.status === 'running') queueMicrotask(() => configureCloud(replacement));
  }, 'Consulte as tarefas');
  const response = await tools.workspace_read.execute!({ collection: 'tasks' }, { toolCallId: 'owner-change', messages: [] });
  expect(response).toMatchObject({ ok: false });
  expect(response).not.toHaveProperty('result');
  expect(replacement.documents()).toEqual([]);
});

async function conflictedWorkspace() {
  const projectId = workspace.getState().createProject('DUO AXION');
  workspace.getState().createTask(projectId, { title: 'Conferir montagem' });
  workspace.getState().createSprint(projectId, { name: 'Verificação', goal: 'Testar montagem', startDate: '2026-10-11', endDate: '2026-10-18' });
  await flushWorkspacePersistence();
  const raw = (await new IndexedDbWorkspaceRepository().load('cellproject-workspace'))!;
  const checkpoints = new Map<string, unknown>();
  const runtime = new CloudRuntime({ documents: [{ key: 'cellproject-workspace', value: raw, revision: 1 }], media: [] },
    async () => Response.json({ error: 'revision_conflict' }, { status: 409 }), undefined, undefined,
    { persistence: { read: async <T,>(slot: string) => (checkpoints.get(slot) as T | undefined) ?? null,
      write: async (slot, value) => { checkpoints.set(slot, structuredClone(value)); }, remove: async slot => { checkpoints.delete(slot); } } });
  configureCloud(runtime);
  // An unrelated document conflict must not turn a successful workspace read into a failed mutation.
  await runtime.write('dynamic_diary-theme', 'dark');
  expect(runtime.getSnapshot()).toMatchObject({ localSaved: true, localSaving: false, issue: { kind: 'conflict' } });
  return { projectId, runtime };
}

it.each(['tasks', 'sprints'] as const)('reads %s during a cloud conflict without claiming local saving failed', async collection => {
  const { projectId, runtime } = await conflictedWorkspace();
  const before = runtime.checkpoint(), state = workspace.getState(), events: AssistantActionEvent[] = [];
  const tools = createAssistantTools(new AbortController().signal, event => events.push(event), 'Consulte meu projeto');
  const response = await tools.workspace_read.execute!({ collection, projectId }, { toolCallId: collection, messages: [] });
  expect(response).toMatchObject({ ok: true, result: { total: 1, items: [{ projectId }],
    persistence: { kind: 'conflict', localSaved: true, cloudSynced: false } } });
  expect(JSON.stringify(response)).not.toMatch(/local saving failed/i);
  expect(events.at(-1)).toMatchObject({ name: 'workspace_read', status: 'done' });
  expect(workspace.getState()).toBe(state);
  expect(runtime.checkpoint()).toEqual(before);
});

it('reports a mutation awaiting cloud reconciliation without mislabeling its durable local checkpoint', async () => {
  const { projectId, runtime } = await conflictedWorkspace();
  const tools = createAssistantTools(new AbortController().signal, () => {}, 'Crie uma tarefa');
  const response = await tools.workspace_action.execute!({ action: 'create_task', projectId, title: 'Medir servo' }, { toolCallId: 'create-task', messages: [] });
  expect(response).toMatchObject({ ok: false, result: { applied: true, saved: false,
    persistence: { kind: 'conflict', localSaved: true, cloudSynced: false } } });
  expect(JSON.stringify(response)).not.toMatch(/local saving failed/i);
  expect(Object.values(workspace.getState().tasks).filter(task => task.title === 'Medir servo')).toHaveLength(1);
  expect(JSON.parse(runtime.get('cellproject-workspace')!).state.tasks).toEqual(workspace.getState().tasks);
  expect(runtime.getSnapshot()).toMatchObject({ localSaved: true, issue: { kind: 'conflict' } });
});

it('does not claim a previous checkpoint preserves an edit whose serialization failed', async () => {
  const { runtime } = await conflictedWorkspace();
  const stringify = JSON.stringify;
  const serialization = vi.spyOn(JSON, 'stringify').mockImplementation((value, ...rest) => {
    if (value?.state?.folders) throw new Error('Workspace serialization failed');
    return stringify(value, ...rest);
  });
  const tools = createAssistantTools(new AbortController().signal, () => {}, 'Crie uma pasta');
  try {
    const response = await tools.workspace_action.execute!({ action: 'create_folder', name: 'Rascunho recente' }, { toolCallId: 'local-failure', messages: [] });
    expect(runtime.getSnapshot().localSaved).toBe(true);
    expect(response).toMatchObject({ ok: false, result: { applied: true, saved: false,
      persistence: { kind: 'local', localSaved: false, cloudSynced: false } } });
    const read = await tools.workspace_read.execute!({ collection: 'folders' }, { toolCallId: 'read-local-draft', messages: [] });
    expect(read).toMatchObject({ ok: true, result: { items: [{ name: 'Rascunho recente' }],
      persistence: { kind: 'local', localSaved: false } } });
  } finally {
    serialization.mockRestore();
    await expect(flushWorkspacePersistence()).rejects.toThrow('conflito remoto');
  }
});
