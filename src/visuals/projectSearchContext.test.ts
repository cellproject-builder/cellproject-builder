import { beforeEach, expect, it } from 'vitest';
import { useWorkspaceStore } from '@/workspace/store';
import { useGraphStore } from '@/store';
import { initializeWorkspace, openPlanner } from '@/workspace/planner';
import { collectProjectSearchContext } from './projectSearchContext';

beforeEach(async () => {
  await Promise.all([useWorkspaceStore.persist.rehydrate(), useGraphStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, notes: {}, tasks: {}, activeProjectId: null, legacyImported: true });
  useGraphStore.setState({ project: null, aiJobs: {} }); initializeWorkspace();
});
it('includes the project plan and sources while excluding personal notes and hidden criteria', () => {
  const ws = useWorkspaceStore.getState(); const id = ws.createProject('Robô', 'Controle de bancada'); openPlanner(id);
  useGraphStore.getState().loadDemoProject();
  const root = useGraphStore.getState().project!.rootId;
  useGraphStore.getState().updateNode(root, { notes: 'Alimentação 5 V', comoConfirmar: 'SECRET CRITERION' }, { commit: true });
  const note = ws.createNote({ projectId: id, title: 'Limites' }); ws.updateNote(note, { blocks: [{ id: 'b', type: 'text', text: 'Corrente máxima 2 A' }] });
  const personal = ws.createNote({ title: 'Pessoal' }); ws.updateNote(personal, { blocks: [{ id: 'p', type: 'text', text: 'PRIVATE PERSONAL NOTE' }] });
  const other = ws.createProject('Outro'), foreign = ws.createNote({ projectId: other, title: 'Privado' }); ws.updateNote(foreign, { blocks: [{ id: 'o', type: 'text', text: 'OTHER PROJECT' }] });
  const context = collectProjectSearchContext(id);
  expect(JSON.stringify(context.sources)).toContain('Alimentação 5 V');
  expect(JSON.stringify(context.sources)).toContain('Corrente máxima 2 A');
  expect(JSON.stringify(context)).not.toMatch(/SECRET CRITERION|PRIVATE PERSONAL NOTE|OTHER PROJECT/);
  const before = context.revision;
  useGraphStore.getState().updateNode(root, { notes: 'Alimentação 12 V' }, { commit: true });
  expect(collectProjectSearchContext(id).revision).not.toBe(before);
});

it('bounds long project context and marks partial coverage instead of claiming complete validation', () => {
  const ws = useWorkspaceStore.getState(), id = ws.createProject('Longo');
  for (let i = 0; i < 40; i++) { const note = ws.createNote({ projectId: id, title: `Fonte ${i}` }); ws.updateNote(note, { blocks: [{ id: `${i}`, type: 'text', text: '🚀\"'.repeat(10000) }] }); }
  const context = collectProjectSearchContext(id);
  expect(context.partial).toBe(true);
  expect(context.sources.length).toBe(41);
  expect(new TextEncoder().encode(JSON.stringify(context)).length).toBeLessThanOrEqual(36000);
});

it('preserves subsystem relationships and invalidates analysis after a structural change', () => {
  const ws = useWorkspaceStore.getState(), id = ws.createProject('Estrutura'); openPlanner(id); useGraphStore.getState().loadDemoProject();
  const plan = useGraphStore.getState().project!, node = Object.values(plan.nodes).find(item => item.parentId && item.parentId !== plan.rootId)!;
  const before = collectProjectSearchContext(id);
  expect(before.sources.find(source => source.id === `node:${node.id}`)?.text).toContain(`node:${node.parentId}`);
  useGraphStore.getState().updateNode(node.id, { parentId: plan.rootId }, { commit: true });
  const moved = collectProjectSearchContext(id);
  expect(moved.revision).not.toBe(before.revision);
  expect(moved.sources.find(source => source.id === `node:${node.id}`)?.text).toContain(`node:${plan.rootId}`);
  const changed = useGraphStore.getState().project!;
  useGraphStore.setState({ project: { ...changed, edges: { ...changed.edges, test: { id: 'test', source: plan.rootId, target: node.id, kind: 'direct', note: 'Fonte de bancada' } } } });
  expect(collectProjectSearchContext(id).revision).not.toBe(moved.revision);
});
