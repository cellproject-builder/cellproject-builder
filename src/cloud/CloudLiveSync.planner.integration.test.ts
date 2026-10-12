import { afterEach, beforeEach, expect, it } from 'vitest';
import { buildDemoProject } from '@/data/demoProject';
import { EMPTY_OBJECTIVE_DRAFT, flushGraphPersistence, useGraphStore, type GraphState } from '@/store';
import { capturePlanner, connectPlanner, initializeWorkspace, openPlanner } from '@/workspace/planner';
import { flushWorkspacePersistence, useWorkspaceStore } from '@/workspace/store';
import type { AIPlan } from '@/types';
import { EMPTY_VISUAL_WORKSPACE } from '@/visuals/normalize';
import { applyRemoteCanvasDocuments, cloudCanvasIdle } from './CloudLiveSync';
import { CloudRuntime, configureCloud, type CloudSnapshot } from './runtime';

let disconnect: (() => void) | undefined, runtime: CloudRuntime | undefined;
const flush = () => Promise.all([flushGraphPersistence(), flushWorkspacePersistence()]);
beforeEach(async () => {
  configureCloud(null);
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, tasks: {}, comments: {}, sprints: {}, notes: {}, folders: {}, boards: {}, legacyImported: true, activeProjectId: null, surface: 'projects' });
  useGraphStore.setState({ project: null, plannerOwnerId: null, archivedProject: null, archivedPending: null, pendingSuggestions: null, parkedSuggestions: {}, drafts: {}, aiJobs: {}, objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT } } as Partial<GraphState>);
  initializeWorkspace();
});
afterEach(async () => { disconnect?.(); disconnect = undefined; await flush(); configureCloud(null); runtime?.dispose(); runtime = undefined; });

const paid: AIPlan = { id: 'paid-remote', title: 'Remote plan', pitch: '', approach: '', strategy: 'reaproveitar', archetype: 'construir', rank: 1, rankReason: '', tree: { categorias: [] } };

it('adopts remote planner drafts and staging before acknowledging the revision used by the next unrelated edit', async () => {
  const owner = useWorkspaceStore.getState().createProject('Owner'); openPlanner(owner);
  useGraphStore.getState().importProject({ ...buildDemoProject(), id: 'synced-plan' });
  useGraphStore.getState().setObjectiveDraft({ name: 'Old local', objective: 'Objective' });
  useWorkspaceStore.getState().savePlanner(owner, capturePlanner()); await flush();
  const local = useWorkspaceStore.getState();
  const initial = { projects: local.projects, tasks: {}, comments: {}, sprints: {}, notes: {}, folders: {}, boards: {}, legacyImported: true };
  const incoming = structuredClone(initial), planner = incoming.projects[owner].planner!, project = planner.project!;
  const child = Object.values(project.nodes).find(node => node.id !== project.rootId)!;
  const batch = { parentId: project.rootId, nodes: [{ tempId: 'remote-step', data: { ...child, tempId: 'remote-step', name: 'Paid remote proposal' } }], edges: [] };
  planner.objectiveDraft = { ...planner.objectiveDraft, name: 'Remote paid draft', plans: [paid], selectedId: paid.id };
  planner.drafts = { [child.id]: { criterion: 'Remote criterion draft' } };
  planner.pendingSuggestions = batch; planner.parkedSuggestions = { [child.id]: { ...batch, parentId: child.id } };
  planner.archivedProject = { ...project, id: 'remote-archive', objective: 'Remote archive' }; planner.archivedPending = batch;
  project.visuals = structuredClone(EMPTY_VISUAL_WORKSPACE);
  project.visuals.drafts.model.text = 'Remote model prompt';
  const envelope = (state: typeof initial) => JSON.stringify({ version: 2, state });
  let server: CloudSnapshot = { documents: [{ key: 'cellproject-workspace', value: envelope(incoming), revision: 2 }], media: [] };
  let savedBase: number | undefined;
  runtime = new CloudRuntime({ documents: [{ key: 'cellproject-workspace', value: envelope(initial), revision: 1 }], media: [] }, async (url, init) => {
    if (init?.method !== 'PUT') return Response.json(server);
    const body = JSON.parse(String(init.body));
    if (String(url).includes('cellproject-workspace')) {
      savedBase = body.baseRevision;
      server = { documents: [{ key: 'cellproject-workspace', value: body.value, revision: 3 }], media: [] };
    }
    return Response.json({ revision: 3 });
  });
  configureCloud(runtime); disconnect = connectPlanner();
  expect(cloudCanvasIdle()).toBe(true);
  await runtime.refreshRemote({ keys: ['cellproject-workspace'], isIdle: cloudCanvasIdle, apply: applyRemoteCanvasDocuments });
  expect(useGraphStore.getState().objectiveDraft.name).toBe('Remote paid draft');
  expect(useGraphStore.getState().objectiveDraft.plans?.[0].id).toBe('paid-remote');
  expect(useGraphStore.getState().drafts[child.id]?.criterion).toBe('Remote criterion draft');
  expect(useGraphStore.getState().pendingSuggestions?.nodes[0].data.name).toBe('Paid remote proposal');
  expect(useGraphStore.getState().parkedSuggestions[child.id]?.nodes[0].data.name).toBe('Paid remote proposal');
  expect(useGraphStore.getState().archivedProject?.objective).toBe('Remote archive');
  expect(useGraphStore.getState().project?.visuals?.drafts.model.text).toBe('Remote model prompt');
  useGraphStore.getState().setObjectiveDraft({ ruleDraft: 'Unrelated local edit' }); await flush();
  const saved = JSON.parse(server.documents[0].value).state.projects[owner].planner;
  expect(savedBase).toBe(2);
  expect(saved.objectiveDraft).toMatchObject({ name: 'Remote paid draft', plans: [{ id: 'paid-remote' }], ruleDraft: 'Unrelated local edit' });
  expect(saved.drafts[child.id].criterion).toBe('Remote criterion draft');
  expect(saved.pendingSuggestions.nodes[0].data.name).toBe('Paid remote proposal');
  expect(saved.project.visuals.drafts.model.text).toBe('Remote model prompt');
  expect(runtime.getSnapshot().issue).toBeNull();
});

it('defers remote refresh when a local visual popup has an unsubmitted prompt after blur', async () => {
  const owner = useWorkspaceStore.getState().createProject('Owner'); openPlanner(owner);
  const project = { ...buildDemoProject(), id: 'local-visual-prompt', visuals: structuredClone(EMPTY_VISUAL_WORKSPACE) };
  project.visuals.drafts.model.text = 'Local unsubmitted prompt';
  useGraphStore.setState({ project }); await flush();
  expect(cloudCanvasIdle()).toBe(false);
});

it('keeps remote loading markers from blocking later paid results or opening an inactive owner', async () => {
  const owner = useWorkspaceStore.getState().createProject('Active'), other = useWorkspaceStore.getState().createProject('Inactive');
  openPlanner(other); useWorkspaceStore.getState().savePlanner(other, capturePlanner());
  openPlanner(owner); useWorkspaceStore.getState().savePlanner(owner, capturePlanner()); await flush();
  const initial = { projects: useWorkspaceStore.getState().projects, tasks: {}, comments: {}, sprints: {}, notes: {}, folders: {}, boards: {}, legacyImported: true };
  const incoming = structuredClone(initial);
  for (const id of [owner, other]) incoming.projects[id].planner!.objectiveDraft = { ...incoming.projects[id].planner!.objectiveDraft, name: 'Remote generation', plans: [paid], expanded: { [paid.id]: paid }, generatingSince: 123, expansion: { outlineId: paid.id, startedAt: 123 } };
  const snapshot = (state: typeof initial, revision: number): CloudSnapshot => ({ documents: [{ key: 'cellproject-workspace', value: JSON.stringify({ version: 2, state }), revision }], media: [] });
  let server = snapshot(incoming, 2);
  let revision = 3;
  runtime = new CloudRuntime(snapshot(initial, 1), async (_url, init) => Response.json(init?.method === 'PUT' ? { revision: ++revision } : server));
  configureCloud(runtime); disconnect = connectPlanner();
  await runtime.refreshRemote({ keys: ['cellproject-workspace'], isIdle: cloudCanvasIdle, apply: applyRemoteCanvasDocuments });
  expect(cloudCanvasIdle()).toBe(true);
  expect(useGraphStore.getState().objectiveDraft.plans?.[0].id).toBe('paid-remote');
  expect(useGraphStore.getState().objectiveDraft.expanded['paid-remote'].id).toBe('paid-remote');
  incoming.projects[owner].planner!.objectiveDraft = { ...incoming.projects[owner].planner!.objectiveDraft, name: 'Remote generation complete', generatingSince: null, expansion: null };
  server = snapshot(incoming, 3);
  await runtime.refreshRemote({ keys: ['cellproject-workspace'], isIdle: cloudCanvasIdle, apply: applyRemoteCanvasDocuments });
  expect(useGraphStore.getState().objectiveDraft.name).toBe('Remote generation complete');
  // The inactive snapshot must also be safe to open after the remote refresh.
  openPlanner(other);
  expect(useGraphStore.getState().objectiveDraft).toMatchObject({ generatingSince: null, expansion: null, plans: [{ id: 'paid-remote' }] });
});
