import { afterEach, beforeEach, expect, it } from 'vitest';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { buildDemoProject } from '@/data/demoProject';
import { configureCloud } from '@/cloud/runtime';
import { EMPTY_OBJECTIVE_DRAFT, flushGraphPersistence, useGraphStore, type GraphState, type ObjectiveDraft } from '@/store';
import type { AIPlan } from '@/types';
import { capturePlanner, connectPlanner, getPlannerOwnerId, initializeWorkspace, openPlanner } from './planner';
import { flushWorkspacePersistence, useWorkspaceStore } from './store';

let disconnect: (() => void) | undefined;
const flush = () => Promise.all([flushGraphPersistence(), flushWorkspacePersistence()]);
beforeEach(async () => {
  configureCloud(null);
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, tasks: {}, comments: {}, sprints: {}, notes: {}, folders: {}, boards: {}, legacyImported: true, activeProjectId: null, surface: 'projects' });
  useGraphStore.setState({ project: null, plannerOwnerId: null, archivedProject: null, archivedPending: null, archivedSession: null, pendingSuggestions: null, parkedSuggestions: {}, drafts: {}, aiJobs: {}, objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT } } as Partial<GraphState>);
  initializeWorkspace();
});
afterEach(async () => { disconnect?.(); disconnect = undefined; await flush(); });

function importCopy(owner: string, objective: string) {
  openPlanner(owner);
  expect(useGraphStore.getState().importProject({ ...buildDemoProject(), id: 'shared-import', objective })).toEqual({ ok: true });
  useWorkspaceStore.getState().savePlanner(owner, capturePlanner());
}

it('keeps edits and project switches attached to B when A imports the same inner plan id', () => {
  const a = useWorkspaceStore.getState().createProject('A'), b = useWorkspaceStore.getState().createProject('B');
  importCopy(a, 'Only A'); importCopy(b, 'Only B');
  initializeWorkspace();
  expect(getPlannerOwnerId()).toBe(b);
  disconnect = connectPlanner();
  const root = useGraphStore.getState().project!.rootId;
  useGraphStore.getState().updateNode(root, { name: 'Edit for B' });
  openPlanner(a); openPlanner(b);
  expect(useWorkspaceStore.getState().projects[a].planner?.project?.objective).toBe('Only A');
  expect(useWorkspaceStore.getState().projects[a].planner?.project?.nodes[root].name).not.toBe('Edit for B');
  expect(useGraphStore.getState().project?.nodes[root].name).toBe('Edit for B');
});

it('persists the managed owner with the editor and restores B after both stores rehydrate', async () => {
  const a = useWorkspaceStore.getState().createProject('A'), b = useWorkspaceStore.getState().createProject('B');
  importCopy(a, 'Only A'); importCopy(b, 'Only B');
  await flush();
  const graphRaw = (await idbGet<string>('cellproject-graph'))!, workspaceRaw = (await idbGet<string>('cellproject-workspace'))!;
  expect(JSON.parse(graphRaw).state.plannerOwnerId).toBe(b);
  openPlanner(a); await flush();
  await Promise.all([idbSet('cellproject-graph', graphRaw), idbSet('cellproject-workspace', workspaceRaw)]);
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  initializeWorkspace();
  expect(getPlannerOwnerId()).toBe(b);
  disconnect = connectPlanner();
  useGraphStore.getState().setObjectiveDraft({ ruleDraft: 'Saved for B after reload' });
  expect(useWorkspaceStore.getState().projects[b].planner?.objectiveDraft.ruleDraft).toBe('Saved for B after reload');
  expect(useWorkspaceStore.getState().projects[a].planner?.objectiveDraft.ruleDraft).toBe('');
});

it('recovers ambiguous legacy singleton work before opening either imported copy', () => {
  const a = useWorkspaceStore.getState().createProject('A'), b = useWorkspaceStore.getState().createProject('B');
  importCopy(a, 'Same import'); importCopy(b, 'Same import');
  const root = useGraphStore.getState().project!.rootId;
  useGraphStore.getState().updateNode(root, { name: 'Unsaved legacy work' });
  useGraphStore.setState({ plannerOwnerId: null } as Partial<GraphState>);
  initializeWorkspace();
  const recovered = getPlannerOwnerId();
  expect(recovered).toBeTruthy();
  expect(recovered).not.toBe(a); expect(recovered).not.toBe(b);
  openPlanner(b);
  expect(useWorkspaceStore.getState().projects[recovered!].planner?.project?.nodes[root].name).toBe('Unsaved legacy work');
  expect(useWorkspaceStore.getState().projects[a].planner?.project?.nodes[root].name).not.toBe('Unsaved legacy work');
  expect(useGraphStore.getState().project?.nodes[root].name).not.toBe('Unsaved legacy work');
});

it('restores the complete archived session after persistence, rehydration and an owner switch', async () => {
  const owner = useWorkspaceStore.getState().createProject('Owner'), other = useWorkspaceStore.getState().createProject('Other');
  importCopy(owner, 'Archived objective'); disconnect = connectPlanner();
  const project = useGraphStore.getState().project!, child = Object.values(project.nodes).find(node => node.id !== project.rootId)!;
  useGraphStore.getState().stageSuggestions(child.id, [{ ...child, tempId: 'parked', name: 'Parked paid work' }], []);
  useGraphStore.getState().stageSuggestions(project.rootId, [{ ...child, tempId: 'active', name: 'Active paid work' }], []);
  useGraphStore.getState().setDraft(child.id, 'criterion', 'Archived user criterion');
  useGraphStore.getState().setObjectiveDraft({ name: 'Archived draft title' });
  useGraphStore.getState().resetProject(); await flush();
  disconnect(); disconnect = undefined;
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  initializeWorkspace(); openPlanner(other); openPlanner(owner);
  expect(useGraphStore.getState().undoReset()).toBe(true);
  expect(useGraphStore.getState().project?.objective).toBe('Archived objective');
  expect(useGraphStore.getState().drafts[child.id]?.criterion).toBe('Archived user criterion');
  expect(useGraphStore.getState().pendingSuggestions?.nodes[0].data.name).toBe('Active paid work');
  expect(useGraphStore.getState().parkedSuggestions[child.id]?.nodes[0].data.name).toBe('Parked paid work');
  expect(useGraphStore.getState().objectiveDraft.name).toBe('Archived draft title');
});

it('migrates archived legacy sessions with their parked suggestions and user drafts', () => {
  const project = { ...buildDemoProject(), id: 'legacy-archive' }, child = Object.values(project.nodes).find(node => node.id !== project.rootId)!;
  const batch = { parentId: child.id, nodes: [{ tempId: 'paid', data: { ...child, tempId: 'paid', name: 'Archived paid proposal' } }], edges: [] };
  useWorkspaceStore.setState({ legacyImported: false });
  useGraphStore.setState({ archivedProject: project, archivedSession: { projectId: project.id, parkedSuggestions: { [child.id]: batch }, drafts: { [child.id]: { criterion: 'Legacy criterion' } }, objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT, name: 'Legacy archived draft' } } });
  initializeWorkspace(); openPlanner(project.id);
  expect(useGraphStore.getState().drafts[child.id]?.criterion).toBe('Legacy criterion');
  expect(useGraphStore.getState().parkedSuggestions[child.id]?.nodes[0].data.name).toBe('Archived paid proposal');
  expect(useGraphStore.getState().objectiveDraft.name).toBe('Legacy archived draft');
});

const paidCache: AIPlan = { id: 'paid-cache', title: 'Paid cache', pitch: '', approach: '', strategy: 'reaproveitar', archetype: 'construir', rank: 1, rankReason: '', tree: { categorias: [] } };
const orphanDrafts: { label: string; patch: Partial<ObjectiveDraft> }[] = [
  { label: 'expanded paid cache', patch: { expanded: { 'paid-cache': paidCache } } },
  { label: 'unsubmitted rule', patch: { ruleDraft: 'Unsubmitted rule' } },
  { label: 'saved rules', patch: { rules: ['Use measured components'] } },
  { label: 'planning intent', patch: { planApproach: 'reverse_engineering', referenceTarget: 'Measured assembly' } },
];
it.each([false, true].flatMap(legacyImported => orphanDrafts.map(fixture => ({ legacyImported, ...fixture }))))('recovers $label before switching with legacyImported=$legacyImported', ({ legacyImported, patch }) => {
  useWorkspaceStore.setState({ legacyImported });
  useGraphStore.setState({ objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT, ...patch } });
  initializeWorkspace();
  const recovered = getPlannerOwnerId();
  expect(recovered).toBeTruthy();
  expect(Object.keys(useWorkspaceStore.getState().projects)).toHaveLength(1);
  const other = useWorkspaceStore.getState().createProject('Other');
  openPlanner(other); openPlanner(recovered!);
  expect(useGraphStore.getState().objectiveDraft).toMatchObject(patch);
});

it('keeps a blank editor unowned when only view, loading and timestamp state changed', () => {
  useGraphStore.setState({ selectedNodeId: 'stale-selection', lens: 'risk', objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT, updatedAt: 123, selectedId: 'stale-outline', generatingSince: 123, expansion: { outlineId: 'stale-outline', startedAt: 123 } } });
  initializeWorkspace();
  expect(getPlannerOwnerId()).toBeNull();
  expect(useWorkspaceStore.getState().projects).toEqual({});
});
