import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { clear } from 'idb-keyval';
import { afterEach, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
let flush = async () => {};

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove(); host = undefined;
  await flush(); flush = async () => {};
  await clear();
  localStorage.clear();
  history.replaceState({}, '', '/');
  vi.restoreAllMocks(); vi.resetModules();
});

async function fixture(path = '/demo') {
  history.replaceState({}, '', path); vi.resetModules();
  const [{ useGraphStore }, { useWorkspaceStore, flushWorkspacePersistence }, planner, { buildDemoProject }, { torqueDiagram }, { normalizeVisualWorkspace }, ui, { useLocaleStore }] = await Promise.all([
    import('@/store'), import('@/workspace/store'), import('@/workspace/planner'), import('@/data/demoProject'),
    import('@/visuals/diagram/fixture'), import('@/visuals/normalize'), import('./DemoDiagrams'), import('@/i18n'),
  ]);
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  flush = flushWorkspacePersistence;
  useWorkspaceStore.setState({ projects: {}, tasks: {}, notes: {}, activeProjectId: null, legacyImported: true });
  useGraphStore.setState({ project: null, archivedProject: null, drafts: {}, pendingSuggestions: null });
  planner.initializeWorkspace();
  useLocaleStore.setState({ locale: 'pt-BR' });
  const project = { ...buildDemoProject(), id: 'example-plan' };
  const diagram = torqueDiagram(project.rootId, project.rootId);
  const artifact = (id: string) => ({ id, label: 'Torque do exemplo', kind: 'diagram' as const, x: 0, y: 0, width: 520, height: 360,
    diagram, diagramValues: {}, scene: null, mediaId: null, source: null,
    revisions: [{ scene: null, mediaId: null, createdAt: 1, diagram, diagramValues: {} }], revisionIndex: 0,
  });
  project.visuals = normalizeVisualWorkspace({ version: 1, mode: 'approval', artifacts: [artifact('chosen'), artifact('other')], proposals: [],
    drafts: { search: { text: '', mentions: [], attachments: [] }, model: { text: '', mentions: [], attachments: [] } },
  });
  const projectId = useWorkspaceStore.getState().createProject('Projeto fictício');
  useWorkspaceStore.getState().savePlanner(projectId, { ...planner.capturePlanner(), project, selectedNodeId: project.rootId });
  return { useGraphStore, workspace: useWorkspaceStore, planner, ui, project, id: { projectId, planId: project.id, artifactId: 'chosen' } };
}

it('updates the latest inactive snapshot while retaining another artifact and newer authored content', async () => {
  const f = await fixture();
  const latest = f.workspace.getState().projects[f.id.projectId].planner!;
  f.workspace.getState().savePlanner(f.id.projectId, { ...latest, project: { ...latest.project!, objective: 'Newer objective', visuals: {
    ...latest.project!.visuals!, artifacts: latest.project!.visuals!.artifacts.map(item => item.id === 'other' ? { ...item, width: 777 } : item),
  } } });

  f.ui.setDemoDiagramParameter(f.id, 'mass', .4);
  const saved = f.workspace.getState().projects[f.id.projectId].planner!.project!;
  expect(saved.objective).toBe('Newer objective');
  expect(saved.visuals!.artifacts[0].diagramValues).toEqual({ mass: .4 });
  expect(saved.visuals!.artifacts[1]).toMatchObject({ width: 777, diagramValues: {} });
  expect(f.useGraphStore.getState().project).toBeNull();
});

it('updates the active owner graph and saves its latest snapshot without restoring stale workspace content', async () => {
  const f = await fixture();
  f.planner.openPlanner(f.id.projectId); f.workspace.getState().selectProject(f.id.projectId);
  f.useGraphStore.setState(state => ({ project: { ...state.project!, objective: 'Live editor objective', visuals: {
    ...state.project!.visuals!, artifacts: state.project!.visuals!.artifacts.map(item => item.id === 'other' ? { ...item, width: 777 } : item),
  } } }));

  f.ui.setDemoDiagramParameter(f.id, 'mass', .65);
  const live = f.useGraphStore.getState().project!;
  expect(live.objective).toBe('Live editor objective');
  expect(live.visuals!.artifacts[0].diagramValues).toEqual({ mass: .65 });
  expect(live.visuals!.artifacts[1].width).toBe(777);
  expect(f.workspace.getState().projects[f.id.projectId].planner!.project).toEqual(live);
});

it('rejects use outside the public demo before changing planner data', async () => {
  const f = await fixture('/');
  const before = f.workspace.getState().projects[f.id.projectId].planner;
  const save = vi.spyOn(f.workspace.getState(), 'savePlanner');
  expect(() => f.ui.setDemoDiagramParameter(f.id, 'mass', .4)).toThrow(/demonstração/);
  expect(save).not.toHaveBeenCalled();
  expect(f.workspace.getState().projects[f.id.projectId].planner).toBe(before);
});

it('keeps the current workspace selection when previewing the editor owner from another project overview', async () => {
  const f = await fixture();
  f.planner.openPlanner(f.id.projectId);
  const otherProjectId = f.workspace.getState().createProject('Other project overview');
  f.workspace.getState().navigate('projects');
  const { selectedNodeId, lens } = f.useGraphStore.getState();
  f.ui.setDemoDiagramParameter(f.id, 'mass', .4);
  expect(f.workspace.getState().activeProjectId).toBe(otherProjectId);
  expect(f.useGraphStore.getState()).toMatchObject({ selectedNodeId, lens });
  expect(f.useGraphStore.getState().project!.visuals!.artifacts[0].diagramValues).toEqual({ mass: .4 });
  expect(f.workspace.getState().projects[f.id.projectId].planner!.project!.visuals!.artifacts[0].diagramValues).toEqual({ mass: .4 });
  expect(f.workspace.getState().projects[otherProjectId].planner).toBeUndefined();
  f.planner.openPlanner(f.id.projectId); f.workspace.getState().selectProject(f.id.projectId);
  expect(f.useGraphStore.getState().project!.visuals!.artifacts[0].diagramValues).toEqual({ mass: .4 });
});

it('opens the native modal, updates the SVG with a slider and opens its linked plan node', async () => {
  const f = await fixture();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<f.ui.DemoDiagrams />));
  act(() => Simulate.click(host!.querySelector<HTMLButtonElement>('[aria-label="Explorar diagrama: Torque do exemplo"]')!));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain('Projeto fictício');
  expect(dialog.textContent).toContain('Premissas e limites');
  const slider = dialog.querySelector<HTMLInputElement>('input[aria-label="Carga"]')!;
  act(() => { slider.value = '.4'; Simulate.change(slider); });
  expect(dialog.querySelector('[data-element-id="result"]')?.textContent).toBe('0.392 N·m');
  expect(f.workspace.getState().projects[f.id.projectId].planner!.project!.visuals!.artifacts[0].diagramValues).toEqual({ mass: .4 });
  act(() => Simulate.click(dialog.querySelector('[data-element-id="joint"]')!));
  expect(f.workspace.getState().surface).toBe('planner');
  expect(f.useGraphStore.getState().selectedNodeId).toBe(f.project.rootId);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
