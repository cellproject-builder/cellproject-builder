import { expect, it, vi } from 'vitest';
import type { CloudSnapshot } from './runtime';

async function domainClient() {
  // Each device owns its singleton stores, planner bridge and runtime module.
  vi.resetModules();
  const cloud = await import('./runtime');
  const graph = await import('@/store');
  const workspace = await import('@/workspace/store');
  const planner = await import('@/workspace/planner');
  const { buildDemoProject } = await import('@/data/demoProject');
  return { ...cloud, ...graph, ...workspace, ...planner, buildDemoProject };
}

it('applies a new workflow status from a stale editor without losing remote prose or rolling back on later navigation', async () => {
  const pc = await domainClient(), tablet = await domainClient();
  const managed = (id: string, name: string) => {
    const project = { ...pc.buildDemoProject(), id: `plan-${id}`, name };
    return { id, name, objective: name, archived: false, createdAt: 1, updatedAt: 1, planner: {
      ...pc.capturePlanner(), project, archivedProject: null, archivedPending: null, archivedSession: null,
      drafts: {}, parkedSuggestions: {}, pendingSuggestions: null,
      objectiveDraft: { ...pc.EMPTY_OBJECTIVE_DRAFT, name, objective: name },
      selectedNodeId: project.rootId, focusedParentId: project.rootId,
    } };
  };
  const initial = {
    projects: { owner: managed('owner', 'Synthetic owner'), other: managed('other', 'Synthetic other') },
    tasks: { task: { id: 'task', projectId: 'owner', title: 'Synthetic task', description: 'Original description', status: 'todo', priority: 'medium', dueDate: '', sprintId: null, createdAt: 1, updatedAt: 1 } },
    comments: {}, sprints: {}, notes: {}, folders: {}, boards: {}, legacyImported: true,
  };
  const envelope = (state: unknown, version: number) => JSON.stringify({ state, version });
  let server: CloudSnapshot = { documents: [
    { key: 'cellproject-workspace', value: envelope(initial, 2), revision: 1 },
    { key: 'cellproject-graph', value: envelope({ ...initial.projects.owner.planner, plannerOwnerId: 'owner' }, 6), revision: 1 },
  ], media: [] };
  const requests: { device: string; key: string; rejected: boolean }[] = [];
  const fetcher = (device: string): typeof fetch => vi.fn<typeof fetch>(async (path, init) => {
    if (init?.method !== 'PUT') return Response.json(server);
    const body = JSON.parse(String(init.body)), key = decodeURIComponent(String(path).split('/').at(-1)!);
    const previous = server.documents.find(document => document.key === key);
    const rejected = body.baseRevision !== (previous?.revision ?? 0);
    requests.push({ device, key, rejected });
    if (rejected) return Response.json({ error: 'revision_conflict' }, { status: 409 });
    server = { ...server, documents: [...server.documents.filter(document => document.key !== key), { key, value: body.value, revision: body.baseRevision + 1 }] };
    return Response.json({ revision: body.baseRevision + 1 });
  });
  const pcRuntime = new pc.CloudRuntime(structuredClone(server), fetcher('pc'), undefined, async () => structuredClone(server));
  const tabletRuntime = new tablet.CloudRuntime(structuredClone(server), fetcher('tablet'), undefined, async () => structuredClone(server));
  pc.configureCloud(pcRuntime); tablet.configureCloud(tabletRuntime);
  const flush = async (client: typeof pc) => { await Promise.all([client.flushGraphPersistence(), client.flushWorkspacePersistence()]); };
  let disconnectPc: (() => void) | undefined, disconnectTablet: (() => void) | undefined;
  try {
    await Promise.all([pc.useGraphStore.persist.rehydrate(), pc.useWorkspaceStore.persist.rehydrate(), tablet.useGraphStore.persist.rehydrate(), tablet.useWorkspaceStore.persist.rehydrate()]);
    pc.initializeWorkspace(); tablet.initializeWorkspace();
    disconnectPc = pc.connectPlanner(); disconnectTablet = tablet.connectPlanner();
    await Promise.all([flush(pc), flush(tablet)]);

    pc.useWorkspaceStore.getState().updateTask('task', { status: 'doing', description: 'New remote description' });
    await flush(pc);
    const noteId = tablet.useWorkspaceStore.getState().createNote({ title: 'Independent tablet note' });
    await flush(tablet);
    // The rebase is confirmed while the editor still has its older domain snapshot.
    expect(tabletRuntime.getSnapshot()).toMatchObject({ pending: 0, issue: null });
    expect(tablet.useWorkspaceStore.getState().tasks.task).toMatchObject({ status: 'todo', description: 'Original description' });
    expect(JSON.parse(tabletRuntime.get('cellproject-workspace')!).state.tasks.task).toMatchObject({ status: 'doing', description: 'New remote description' });

    const beforeStatus = requests.length;
    tablet.useWorkspaceStore.getState().updateTask('task', { status: 'review' });
    const saveError = await flush(tablet).then(() => null, error => (error as Error).message);
    expect(saveError).toBeNull();
    expect(requests.slice(beforeStatus)).toEqual([{ device: 'tablet', key: 'cellproject-workspace', rejected: false }]);
    const savedWorkspace = () => JSON.parse(server.documents.find(document => document.key === 'cellproject-workspace')!.value).state;
    expect(savedWorkspace().tasks.task).toMatchObject({ status: 'review', description: 'New remote description' });
    expect(savedWorkspace().notes[noteId].title).toBe('Independent tablet note');
    expect(tabletRuntime.getSnapshot()).toMatchObject({ pending: 0, issue: null });

    // Neither device's subsequent full planner snapshot is a new status command.
    for (const client of [tablet, pc]) {
      client.openPlanner('other'); client.openPlanner('owner');
      client.useWorkspaceStore.getState().navigate('kanban');
      await flush(client);
      expect(savedWorkspace().tasks.task).toMatchObject({ status: 'review', description: 'New remote description' });
    }
    expect(pcRuntime.getSnapshot()).toMatchObject({ pending: 0, issue: null });
    expect(tabletRuntime.getSnapshot()).toMatchObject({ pending: 0, issue: null });
  } finally {
    disconnectPc?.(); disconnectTablet?.();
    await Promise.allSettled([flush(pc), flush(tablet)]);
    pc.configureCloud(null); tablet.configureCloud(null);
    pcRuntime.dispose(); tabletRuntime.dispose();
  }
});
