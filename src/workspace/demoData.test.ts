import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get as idbGet } from 'idb-keyval';
import { IndexedDbWorkspaceRepository } from '@/data/workspaceRepository';
import { createWorkspaceBackup, restoreWorkspaceBackup, workspaceToDatabaseRows } from '@/data/workspaceTransfer';
import { DEMO_PLAN_PREFIX, loadWorkspaceDemo } from './demoData';
import { flushWorkspacePersistence, useWorkspaceStore as store } from './store';
import type { PlannerSnapshot } from './types';

function expectSeparatedCards(planner: PlannerSnapshot) {
  const nodes = Object.values(planner.project!.nodes);
  nodes.forEach((node, index) => nodes.slice(index + 1).forEach((other) => {
    // Graph cards are 300px wide. Adjacent rows have enough vertical room for
    // their content; cards within the same row must not occupy the same slot.
    expect(Math.abs(node.position.x - other.position.x) >= 300 || Math.abs(node.position.y - other.position.y) >= 300).toBe(true);
  }));
}

beforeEach(async () => {
  await flushWorkspacePersistence();
  await store.persist.rehydrate();
  store.setState({ projects: {}, tasks: {}, comments: {}, sprints: {}, notes: {}, folders: {}, activeProjectId: null, surface: 'projects', legacyImported: true });
});

describe('local workspace demonstration', () => {
  it('creates a complete, portable dataset with valid ownership, sprint history and plan links', async () => {
    const result = await loadWorkspaceDemo();
    const state = store.getState();
    expect(result.createdProjects).toBe(3);
    expect(Object.keys(state.projects)).toHaveLength(3);
    expect(Object.keys(state.tasks)).toHaveLength(36);
    expect(Object.keys(state.sprints)).toHaveLength(9);
    expect(Object.keys(state.notes)).toHaveLength(15);
    expect(Object.keys(state.comments)).toHaveLength(30);
    expect(Object.keys(state.folders)).toHaveLength(4);
    expect(new Set(Object.values(state.tasks).map((task) => task.status))).toEqual(new Set(['todo', 'doing', 'review', 'done']));
    expect(new Set(Object.values(state.tasks).map((task) => task.priority))).toEqual(new Set(['low', 'medium', 'high']));
    expect(new Set(Object.values(state.comments).map((comment) => comment.author))).toEqual(new Set(['user', 'assistant']));
    for (const project of Object.values(state.projects)) {
      expect(project.name).toContain('(Demo)');
      const plan = project.planner!.project!;
      expect(plan.id).toMatch(new RegExp(`^${DEMO_PLAN_PREFIX}`));
      expect(Object.keys(plan.nodes)).toHaveLength(10);
      expectSeparatedCards(project.planner!);
      expect(Object.values(plan.nodes).every((node) => !node.confirmado && node.state === 'concept')).toBe(true);
      expect(Object.values(state.sprints).filter((sprint) => sprint.projectId === project.id && sprint.status === 'active')).toHaveLength(1);
    }
    for (const task of Object.values(state.tasks)) {
      expect(state.projects[task.projectId]).toBeDefined();
      if (task.sourceNodeId) expect(state.projects[task.projectId].planner!.project!.nodes[task.sourceNodeId]).toBeDefined();
      if (task.sprintId) {
        const sprint = state.sprints[task.sprintId];
        expect(sprint.projectId).toBe(task.projectId);
        if (sprint.status === 'completed') expect(task.status).toBe('done');
      }
    }
    const blockIds = Object.values(state.notes).flatMap((note) => note.blocks.map((block) => block.id));
    expect(new Set(blockIds).size).toBe(blockIds.length);
    for (const note of Object.values(state.notes)) {
      expect(state.folders[note.folderId!]).toBeDefined();
      if (note.taskId) expect(state.tasks[note.taskId].projectId).toBe(note.projectId);
    }
    for (const comment of Object.values(state.comments)) expect(state.tasks[comment.taskId].projectId).toBe(comment.projectId);
    const backup = createWorkspaceBackup(state, Date.now());
    expect(restoreWorkspaceBackup(JSON.parse(JSON.stringify(backup)))).toEqual(backup.data);
    const rows = workspaceToDatabaseRows(state, 'da552827-202d-4adb-b035-ae25e71a0e6a', Date.now()).rows;
    expect(rows.tasks).toHaveLength(36);
    expect(rows.notes).toHaveLength(15);
    const persisted = JSON.parse((await idbGet<string>('cellproject-workspace'))!);
    expect(persisted.state.projects).toEqual(state.projects);
    expect(persisted.state.tasks).toEqual(state.tasks);
  });

  it('is idempotent and preserves existing data, edited examples and navigation', async () => {
    const ownProject = store.getState().createProject('Meu projeto', 'Objetivo real');
    const ownTask = store.getState().createTask(ownProject, { title: 'Meu trabalho' });
    const ownNote = store.getState().createNote({ title: 'Meu diário' });
    store.getState().navigate('kanban');
    const before = { project: store.getState().projects[ownProject], task: store.getState().tasks[ownTask], note: store.getState().notes[ownNote] };
    const first = await loadWorkspaceDemo();
    store.getState().updateProject(first.projectIds[0], { name: 'Demonstração editada por mim' });
    const demoNote = Object.values(store.getState().notes).find((note) => note.projectId === first.projectIds[0])!;
    store.getState().updateNote(demoNote.id, { title: 'Minha edição', blocks: [{ id: 'edited', type: 'text', text: 'Preservar este texto' }] });
    const snapshot = createWorkspaceBackup(store.getState(), 1).data;
    const second = await loadWorkspaceDemo();
    expect(second).toEqual({ projectIds: first.projectIds, createdProjects: 0 });
    expect(createWorkspaceBackup(store.getState(), 1).data).toEqual(snapshot);
    expect(store.getState()).toMatchObject({ activeProjectId: ownProject, surface: 'kanban' });
    expect(store.getState().projects[ownProject]).toEqual(before.project);
    expect(store.getState().tasks[ownTask]).toEqual(before.task);
    expect(store.getState().notes[ownNote]).toEqual(before.note);
  });

  it('reports persistence failure instead of claiming the examples were saved', async () => {
    await flushWorkspacePersistence();
    const failure = new Error('storage unavailable');
    const write = vi.spyOn(IndexedDbWorkspaceRepository.prototype, 'save').mockRejectedValue(failure);
    try {
      await expect(loadWorkspaceDemo()).rejects.toBe(failure);
      expect(write).toHaveBeenCalledWith('cellproject-workspace', expect.any(String));
      expect(Object.keys(store.getState().projects)).toHaveLength(3);
    }
    finally {
      write.mockRestore();
      // Retry the identical content after the backend recovers.
      store.setState({});
      await flushWorkspacePersistence();
    }
    const persisted = JSON.parse((await idbGet<string>('cellproject-workspace'))!);
    expect(persisted.state.projects).toEqual(store.getState().projects);
  });

  it('repairs only the original overlapping demo coordinates and keeps content, custom layouts and real plans intact', async () => {
    const { projectIds } = await loadWorkspaceDemo();
    const legacy = (index: number): PlannerSnapshot => {
      const planner = structuredClone(store.getState().projects[projectIds[index]].planner!);
      Object.values(planner.project!.nodes).forEach((node) => {
        node.position = { x: node.order * 260, y: node.kind === 'root' ? 0 : node.kind === 'categoria' ? 180 : 360 };
      });
      return planner;
    };
    const original = legacy(0);
    original.project!.nodes[original.project!.rootId].notes = 'My note must survive the repair';
    original.drafts = { draft: { criterion: 'My criterion' } };
    store.getState().savePlanner(projectIds[0], original);
    const custom = legacy(1);
    custom.project!.nodes[`${custom.project!.id}:step:0`].position.x = 900;
    store.getState().savePlanner(projectIds[1], custom);
    const manual = legacy(2);
    manual.project!.manualLayout = true;
    store.getState().savePlanner(projectIds[2], manual);
    const realProject = store.getState().createProject('Real project');
    const realPlan = structuredClone(original);
    realPlan.project!.id = 'real-plan';
    store.getState().savePlanner(realProject, realPlan);
    const result = await loadWorkspaceDemo();
    expect(result.createdProjects).toBe(0);
    const repaired = store.getState().projects[projectIds[0]].planner!;
    expectSeparatedCards(repaired);
    expect(repaired).toEqual({ ...original, project: { ...original.project!, nodes: expect.any(Object) } });
    Object.values(repaired.project!.nodes).forEach((node) => {
      expect(node).toEqual({ ...original.project!.nodes[node.id], position: expect.any(Object) });
    });
    expect(store.getState().projects[projectIds[1]].planner).toEqual(custom);
    expect(store.getState().projects[projectIds[2]].planner).toEqual(manual);
    expect(store.getState().projects[realProject].planner).toEqual(realPlan);
    const before = createWorkspaceBackup(store.getState(), 1).data;
    await loadWorkspaceDemo();
    expect(createWorkspaceBackup(store.getState(), 1).data).toEqual(before);
  });
});
