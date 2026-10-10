import { beforeEach, expect, it } from 'vitest';
import { useGraphStore, EMPTY_OBJECTIVE_DRAFT } from '@/store';
import { useWorkspaceStore as workspace } from '@/workspace/store';
import { initializeWorkspace, openPlanner, capturePlanner } from '@/workspace/planner';
import { applyPlanStructure, planRevision, undoPlanStructure } from './planStructure';

beforeEach(async () => {
  await Promise.all([workspace.persist.rehydrate(), useGraphStore.persist.rehydrate()]);
  workspace.setState({ projects: {}, activeProjectId: null, legacyImported: true });
  useGraphStore.setState({ project: null, aiJobs: {}, pendingSuggestions: null, parkedSuggestions: {}, objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT } });
  initializeWorkspace();
});
function setup() {
  const projectId = workspace.getState().createProject('Robô'); openPlanner(projectId);
  useGraphStore.getState().loadDemoProject(); workspace.getState().savePlanner(projectId, capturePlanner());
  return { projectId, project: useGraphStore.getState().project! };
}
it('adds and reparents parts atomically while retaining identity, evidence and supporting undo', () => {
  const { projectId, project } = setup();
  const existing = Object.values(project.nodes).find(n => n.parentId && n.parentId !== project.rootId)!;
  const result = applyPlanStructure({ projectId, revision: planRevision(project), reason: 'Incluir controle e agrupar o estudo', operations: [
    { kind: 'add', key: 'control', parentId: project.rootId, name: 'Controle', nodeKind: 'categoria', oQue: 'Firmware', porQue: 'Coordenar movimentos' },
    { kind: 'move', nodeId: existing.id, parentId: 'control', order: 0 },
  ] });
  const after = useGraphStore.getState().project!;
  expect(after.id).toBe(project.id); expect(after.nodes[existing.id].parentId).toBe(result.added.control);
  expect(after.nodes[existing.id].comoConfirmarUsuario).toBe(existing.comoConfirmarUsuario);
  expect(after.nodes[project.rootId]).toBe(project.nodes[project.rootId]);
  expect(Object.keys(after.nodes)).toHaveLength(Object.keys(project.nodes).length + 1);
  undoPlanStructure(projectId, result.undoId);
  expect(useGraphStore.getState().project).toBe(project);
});
it('rejects cycles, stale plans and missing attachment provenance without partial changes', () => {
  const { projectId, project } = setup();
  const child = Object.values(project.nodes).find(n => n.parentId === project.rootId)!;
  expect(() => applyPlanStructure({ projectId, revision: planRevision(project), reason: 'Cycle', operations: [{ kind: 'move', nodeId: project.rootId, parentId: child.id, order: 0 }] })).toThrow();
  expect(() => applyPlanStructure({ projectId, revision: 'old', reason: 'Stale', operations: [{ kind: 'move', nodeId: child.id, parentId: project.rootId, order: 2 }] })).toThrow('planChanged');
  expect(() => applyPlanStructure({ projectId, revision: planRevision(project), reason: 'Missing source', operations: [{ kind: 'add', key: 'part', parentId: project.rootId, name: 'Motor', nodeKind: 'recurso', oQue: 'Motor', porQue: 'Mover', sourceIds: ['absent'] }] })).toThrow('attachmentMissing');
  expect(useGraphStore.getState().project).toBe(project);
});
it('does not undo over a later human edit', () => {
  const { projectId, project } = setup();
  const result = applyPlanStructure({ projectId, revision: planRevision(project), reason: 'Controle', operations: [{ kind: 'add', key: 'part', parentId: project.rootId, name: 'Controle', nodeKind: 'passo', oQue: 'Programar', porQue: 'Mover' }] });
  useGraphStore.getState().updateNode(project.rootId, { name: 'Edição posterior' }, { commit: true });
  expect(() => undoPlanStructure(projectId, result.undoId)).toThrow('planChanged');
});

it('protects an unfinished criterion draft from being removed by undo', () => {
  const { projectId, project } = setup();
  const result = applyPlanStructure({ projectId, revision: planRevision(project), reason: 'Controle', operations: [{ kind: 'add', key: 'part', parentId: project.rootId, name: 'Controle', nodeKind: 'passo', oQue: 'Programar', porQue: 'Mover' }] });
  useGraphStore.getState().setDraft(result.added.part, 'criterion', 'Minha previsão ainda em escrita');
  expect(() => undoPlanStructure(projectId, result.undoId)).toThrow('planChanged');
  expect(useGraphStore.getState().project!.nodes[result.added.part]).toBeDefined();
});

it('keeps a new parent while decomposition suggestions are staged or parked for it', () => {
  const { projectId, project } = setup();
  const result = applyPlanStructure({ projectId, revision: planRevision(project), reason: 'Controle', operations: [{ kind: 'add', key: 'part', parentId: project.rootId, name: 'Controle', nodeKind: 'passo', oQue: 'Programar', porQue: 'Mover' }] });
  useGraphStore.getState().stageSuggestions(result.added.part, [{ ...project.nodes[project.rootId], tempId: 'pending-child' }], []);
  const batch = useGraphStore.getState().pendingSuggestions!;
  expect(() => undoPlanStructure(projectId, result.undoId)).toThrow('planChanged');
  useGraphStore.setState({ pendingSuggestions: null, parkedSuggestions: { [result.added.part]: batch } });
  expect(() => undoPlanStructure(projectId, result.undoId)).toThrow('planChanged');
  expect(useGraphStore.getState().project!.nodes[result.added.part]).toBeDefined();
});

it('reorders siblings without ties and records the actual supporting attachment', async () => {
  const { projectId, project } = setup();
  const siblings = Object.values(project.nodes).filter(node => node.parentId === project.rootId).sort((a, b) => a.order - b.order);
  const last = siblings.at(-1)!;
  const { extractPlanFile } = await import('@/attachments/files'); const { addProjectFiles } = await import('@/attachments/projectFiles');
  const file = await extractPlanFile(new File(['Ordem de estudo'], 'ordem.md')); addProjectFiles(projectId, [file]);
  applyPlanStructure({ projectId, revision: planRevision(project), reason: 'Começar por esta parte', operations: [{ kind: 'move', nodeId: last.id, parentId: project.rootId, order: 0, sourceIds: [file.id] }] });
  const ordered = Object.values(useGraphStore.getState().project!.nodes).filter(node => node.parentId === project.rootId).sort((a, b) => a.order - b.order);
  expect(ordered[0].id).toBe(last.id); expect(ordered.map(node => node.order)).toEqual(siblings.map((_, i) => i));
  expect(ordered[0].sourceAttachmentIds).toEqual([file.id]);
});
