import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { buildDemoProject } from '@/data/demoProject';
import { workspaceRepository } from '@/data/workspaceRepository';
import { configureCloud } from '@/cloud/runtime';
import { EMPTY_OBJECTIVE_DRAFT, flushGraphPersistence, useGraphStore } from '@/store';
import { capturePlanner, connectPlanner, initializeWorkspace, openPlanner } from './planner';
import { flushWorkspacePersistence, useWorkspaceStore } from './store';

let disconnect: (() => void) | undefined;
beforeEach(async () => {
  configureCloud(null);
  await Promise.all([useWorkspaceStore.persist.rehydrate(), useGraphStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, tasks: {}, comments: {}, sprints: {}, notes: {}, folders: {}, boards: {}, legacyImported: true, activeProjectId: null, surface: 'projects' });
  useGraphStore.setState({ project: null, archivedProject: null, drafts: {}, pendingSuggestions: null, parkedSuggestions: {}, archivedPending: null, objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT } });
  initializeWorkspace();
  await Promise.all([flushGraphPersistence(), flushWorkspacePersistence()]);
});
afterEach(async () => {
  disconnect?.(); disconnect = undefined;
  vi.restoreAllMocks();
  await Promise.all([flushGraphPersistence(), flushWorkspacePersistence()]);
});

async function largePlanner() {
  const owner = useWorkspaceStore.getState().createProject('Plano sintético volumoso');
  openPlanner(owner);
  const project = { ...buildDemoProject(), id: 'large-synthetic-plan', objective: 'Contexto sintético de teste. '.repeat(60_000) };
  useGraphStore.setState({ project, selectedNodeId: project.rootId, focusedParentId: project.rootId, lens: 'structure', viewMode: 'graph' });
  useWorkspaceStore.getState().savePlanner(owner, capturePlanner());
  await Promise.all([flushGraphPersistence(), flushWorkspacePersistence()]);
  disconnect = connectPlanner();
  return { owner, project, child: Object.keys(project.nodes).find(id => id !== project.rootId)! };
}

describe('planner interaction persistence budget', () => {
  it('does not serialize or save full documents for selection, lenses and workspace navigation', async () => {
    const { owner, project, child } = await largePlanner();
    const managed = useWorkspaceStore.getState().projects[owner];
    const serialize = vi.spyOn(JSON, 'stringify');
    const save = vi.spyOn(workspaceRepository, 'setItem');
    const started = performance.now();
    for (let index = 0; index < 40; index++) {
      useGraphStore.getState().selectNode(index % 2 ? project.rootId : child);
      useGraphStore.getState().setLens(index % 2 ? 'structure' : 'risk');
      useWorkspaceStore.getState().navigate(index % 2 ? 'planner' : 'overview');
    }
    const elapsedMs = performance.now() - started;
    const serializations = serialize.mock.calls.filter(([value]) => value && typeof value === 'object' && 'state' in value).length;
    await Promise.all([flushGraphPersistence(), flushWorkspacePersistence()]);
    console.info('Synthetic planner interaction benchmark', { interactions: 120, contextCharacters: project.objective.length, serializations, saves: save.mock.calls.length, elapsedMs: Math.round(elapsedMs * 100) / 100 });
    expect(serializations).toBe(0);
    expect(save).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().projects[owner]).toBe(managed);
    expect(useGraphStore.getState().selectedNodeId).toBe(project.rootId);
  });

  it('still persists and restores a real draft and its current planner snapshot after UI interactions', async () => {
    const { owner, project, child } = await largePlanner();
    useGraphStore.getState().selectNode(child);
    useGraphStore.getState().setLens('connections');
    useGraphStore.getState().setDraft(child, 'failure', 'Salvar este rascunho');
    await Promise.all([flushGraphPersistence(), flushWorkspacePersistence()]);
    const graphRaw = (await idbGet<string>('cellproject-graph'))!;
    const workspaceRaw = (await idbGet<string>('cellproject-workspace'))!;
    expect(JSON.parse(graphRaw).state.drafts[child].failure).toBe('Salvar este rascunho');
    expect(JSON.parse(workspaceRaw).state.projects[owner].planner.drafts[child].failure).toBe('Salvar este rascunho');
    expect(useWorkspaceStore.getState().projects[owner].planner?.project).toBe(project);
    disconnect?.(); disconnect = undefined;
    useGraphStore.setState({ project: null, drafts: {} });
    useWorkspaceStore.setState({ projects: {} });
    await Promise.all([flushGraphPersistence(), flushWorkspacePersistence()]);
    await Promise.all([idbSet('cellproject-graph', graphRaw), idbSet('cellproject-workspace', workspaceRaw)]);
    await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
    expect(useGraphStore.getState().drafts[child].failure).toBe('Salvar este rascunho');
    expect(useWorkspaceStore.getState().projects[owner].planner?.drafts[child].failure).toBe('Salvar este rascunho');
  });

  it('captures the latest in-memory selection when moving to another project and back', async () => {
    const { owner, child } = await largePlanner();
    useGraphStore.getState().selectNode(child);
    useGraphStore.getState().setLens('risk');
    const other = useWorkspaceStore.getState().createProject('Outro plano');
    openPlanner(other);
    openPlanner(owner);
    expect(useGraphStore.getState().selectedNodeId).toBe(child);
    expect(useGraphStore.getState().lens).toBe('risk');
  });
});
