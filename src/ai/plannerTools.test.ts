import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGraphStore, EMPTY_OBJECTIVE_DRAFT } from '@/store';
import { useWorkspaceStore as workspace, flushWorkspacePersistence } from '@/workspace/store';
import { capturePlanner, initializeWorkspace, openPlanner } from '@/workspace/planner';
import { executePlannerAction } from './plannerTools';
import { createAssistantTools } from './workspaceTools';
import { workspaceRepository } from '@/data/workspaceRepository';
import * as plannerAI from './service';
import { useKBStore } from '@/kb/store';
import type { ConceptNodeData } from '@/types';

afterEach(() => vi.restoreAllMocks());

beforeEach(async () => {
  await Promise.all([workspace.persist.rehydrate(), useGraphStore.persist.rehydrate()]);
  workspace.setState({ projects: {}, tasks: {}, notes: {}, sprints: {}, folders: {}, comments: {}, legacyImported: true });
  useGraphStore.setState({ project: null, archivedProject: null, pendingSuggestions: null, parkedSuggestions: {}, drafts: {}, aiJobs: {}, objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT } });
  initializeWorkspace();
});
function withPlan(name: string) {
  const id = workspace.getState().createProject(name);
  openPlanner(id);
  useGraphStore.getState().loadDemoProject();
  workspace.getState().savePlanner(id, capturePlanner());
  return id;
}
it('reads another scoped plan without changing the visible editor or exposing hidden criteria', () => {
  const a = withPlan('A'), b = withPlan('B');
  openPlanner(a); workspace.getState().selectProject(a); workspace.getState().navigate('planner');
  const original = useGraphStore.getState().project;
  const hidden = Object.values(workspace.getState().projects[b].planner!.project!.nodes).find((n) => !n.confirmado && !n.takenAsKnown && !n.comoConfirmarUsuarioAt && n.comoConfirmar);
  expect(hidden).toBeDefined();
  const read = executePlannerAction({ action: 'read_plan', projectId: b }, '') as ReturnType<typeof capturePlanner>;
  expect(useGraphStore.getState().project).toBe(original);
  expect(workspace.getState().activeProjectId).toBe(a);
  expect(read.project!.nodes[hidden!.id].comoConfirmar).toBe('');
});
it('reports blocked confirmation honestly and rejects draft edits on an existing plan', () => {
  const id = withPlan('A'), nodeId = useGraphStore.getState().project!.rootId;
  useGraphStore.getState().reportFailure(nodeId, 'Falhou');
  const result = executePlannerAction({ action: 'confirm_node', projectId: id, nodeId }, 'Confirme');
  expect(result).toMatchObject({ changed: false, node: { failure: 'Falhou' } });
  expect(() => executePlannerAction({ action: 'edit_plan_draft', projectId: id, objective: 'Novo' }, '')).toThrow('plan already exists');
});
it('cannot invent the user criterion or bypass the confirmation rules', () => {
  const id = withPlan('A'), nodeId = useGraphStore.getState().project!.rootId;
  expect(() => executePlannerAction({ action: 'set_criterion', projectId: id, nodeId, text: 'Invented proof' }, 'Organize meu plano')).toThrow('criterion written by the user');
  expect(() => executePlannerAction({ action: 'confirm_node', projectId: id, nodeId, force: true }, 'Confirme')).toThrow();
});
it('reports persistence failures from planner tools instead of claiming success', async () => {
  const id = withPlan('A'), nodeId = useGraphStore.getState().project!.rootId;
  await flushWorkspacePersistence();
  const write = vi.spyOn(workspaceRepository, 'setItem').mockRejectedValue(new Error('quota'));
  const tools = createAssistantTools(new AbortController().signal, () => {}, 'Renomeie');
  const result = await tools.planner_action.execute!({ action: 'update_node', projectId: id, nodeId, patch: { name: 'Renomeado' } }, { toolCallId: 'planner', messages: [] });
  expect(result).toMatchObject({ ok: false, result: { applied: true, saved: false } });
  write.mockRestore();
  workspace.setState({}); await flushWorkspacePersistence();
});

function withContextualPlan() {
  const projectId = withPlan('Robô com recursos definidos');
  const project = useGraphStore.getState().project!;
  const root = project.nodes[project.rootId];
  const seed = Object.values(project.nodes).find(n => n.kind === 'passo')!;
  const node = (id: string, parentId: string, name: string, patch: Partial<ConceptNodeData> = {}): ConceptNodeData => ({
    ...seed, id, parentId, name, kind: 'passo', state: 'concept', order: 0, history: [],
    confirmado: false, takenAsKnown: false, comoConfirmarUsuario: undefined, comoConfirmarUsuarioAt: undefined,
    comoConfirmar: `AI-CRITERION-HIDDEN-${id}`, ...patch,
  });
  const nodes = {
    [root.id]: root,
    resources: node('resources', root.id, 'Recursos', { kind: 'categoria', takenAsKnown: true }),
    execution: node('execution', root.id, 'Execução', { kind: 'categoria', oQue: 'Montagem de bancada' }),
    supply: node('supply', 'resources', 'Fonte já escolhida', { kind: 'recurso', oQue: 'Fonte regulada 5 V / 5 A' }),
    solder: node('solder', 'resources', 'Soldar fios', { state: 'done', order: 1 }),
    target: node('target', 'execution', 'Instalar servo', { oQue: 'Conectar o servo à alimentação definida' }),
    test: node('test', 'execution', 'Ensaiar movimento', { oQue: 'Registrar corrente e ângulo', order: 1 }),
    child: node('child', 'target', 'Conferir polaridade', { oQue: 'Identificar positivo e negativo' }),
  };
  useGraphStore.setState({ project: { ...project, planApproach: 'reverse_engineering', referenceTarget: 'Servo identificado pelo usuário; variante pendente', nodes, edges: {} } });
  workspace.getState().savePlanner(projectId, capturePlanner());
  return { projectId, nodes };
}

it('decomposes through chat with existing project resources and known skills, keeping the criterion hidden and suggestions staged', async () => {
  const { projectId, nodes } = withContextualPlan();
  const original = useGraphStore.getState().project;
  vi.spyOn(useKBStore.getState(), 'getContextFor').mockResolvedValue([]);
  const decompose = vi.spyOn(plannerAI, 'decomposeNode').mockResolvedValue({
    nodes: [{ tempId: 'wire', kind: 'passo', name: 'Conectar alimentação definida', fx: 'Servo alimentado',
      problem: '', confidence: 50, confidenceReason: 'Hipótese', pros: [], cons: [],
      oQue: 'Usar a fonte já escolhida', porQue: 'Evitar uma compra duplicada', comoConfirmar: 'Critério sugerido' }],
    edges: [],
  });
  const tools = createAssistantTools(new AbortController().signal, () => {}, 'Decomponha a instalação do servo');
  const result = await tools.planner_ai.execute!({ action: 'decompose_node', projectId, nodeId: 'target' }, { toolCallId: 'decompose-context', messages: [] });
  expect(result).toMatchObject({ ok: true, result: { staged: 1 } });
  const context = decompose.mock.calls[0][0];
  expect(context).toMatchObject({ planApproach: 'reverse_engineering', referenceTarget: 'Servo identificado pelo usuário; variante pendente' });
  expect(context.planOverview).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: nodes.supply.name, oQue: 'Fonte regulada 5 V / 5 A' }),
    expect.objectContaining({ name: nodes.test.name }),
  ]));
  expect(context.planOverview?.map(n => n.name)).not.toContain(nodes.target.name);
  expect(context.planOverview?.map(n => n.name)).not.toContain(nodes.child.name);
  expect(context.knownElsewhere).toEqual(['Soldar fios']);
  expect(context.comoConfirmar).toBe('');
  expect(JSON.stringify(context)).not.toContain('AI-CRITERION-HIDDEN');
  expect(useGraphStore.getState().project).toBe(original);
  expect(useGraphStore.getState().pendingSuggestions).toMatchObject({ parentId: 'target', nodes: [expect.objectContaining({ tempId: 'wire' })] });
});

it.each(['explain_node', 'critique_node'] as const)('provides related parts to %s through chat without exposing the hidden criterion', async action => {
  const { projectId, nodes } = withContextualPlan();
  const explanation = vi.spyOn(plannerAI, 'explainNode').mockResolvedValue('Usar a alimentação definida no plano.');
  const critique = vi.spyOn(plannerAI, 'critiqueNode').mockResolvedValue({ fraquezas: [], premissasOcultas: [], criterioAlternativo: '', generatedAt: 1 });
  const tools = createAssistantTools(new AbortController().signal, () => {}, 'Analise a instalação do servo');
  const result = await tools.planner_ai.execute!({ action, projectId, nodeId: 'target' }, { toolCallId: action, messages: [] });
  expect(result).toMatchObject({ ok: true });
  const context = action === 'explain_node' ? explanation.mock.calls[0][0] : critique.mock.calls[0][0];
  expect(context).toMatchObject({ planApproach: 'reverse_engineering', referenceTarget: 'Servo identificado pelo usuário; variante pendente' });
  expect(context.relatedParts).toEqual(expect.arrayContaining([
    { relation: 'parent', name: nodes.execution.name, oQue: 'Montagem de bancada' },
    { relation: 'child', name: nodes.child.name, oQue: 'Identificar positivo e negativo' },
    { relation: 'sibling', name: nodes.test.name, oQue: 'Registrar corrente e ângulo' },
  ]));
  expect(context.comoConfirmar).toBe('');
  expect(JSON.stringify(context)).not.toContain('AI-CRITERION-HIDDEN');
  if (action === 'critique_node') expect(critique.mock.calls[0][0].planOverview).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: nodes.supply.name, oQue: 'Fonte regulada 5 V / 5 A' }),
  ]));
});

it('passes attached source text and the explicit approach when generating a plan through chat', async () => {
  const projectId = workspace.getState().createProject('Patinete', 'Compreender um patinete');
  openPlanner(projectId);
  executePlannerAction({ action: 'edit_plan_draft', projectId, planApproach: 'reverse_engineering', referenceTarget: 'Variante indicada no manual' }, 'Quero engenharia reversa do modelo indicado no manual');
  const { extractPlanFile } = await import('@/attachments/files');
  const { addProjectFiles } = await import('@/attachments/projectFiles');
  const file = await extractPlanFile(new File(['A variante deste documento ainda precisa ser conferida no produto.'], 'manual.md'));
  addProjectFiles(projectId, [file]);
  vi.spyOn(useKBStore.getState(), 'getContextFor').mockResolvedValue([]);
  const generate = vi.spyOn(plannerAI, 'outlinePlans').mockResolvedValue([]);
  const tools = createAssistantTools(new AbortController().signal, () => {}, 'Construa o plano usando o manual');
  const result = await tools.planner_ai.execute!({ action: 'generate_plans', projectId }, { toolCallId: 'generate-intent', messages: [] });
  expect(result).toMatchObject({ ok: true });
  expect(generate.mock.calls[0][5]).toMatchObject({ planApproach: 'reverse_engineering', referenceTarget: 'Variante indicada no manual' });
  expect(JSON.stringify(generate.mock.calls[0][2])).toContain('A variante deste documento ainda precisa ser conferida');
  expect(useGraphStore.getState().objectiveDraft.plansFor).toMatchObject({ planApproach: 'reverse_engineering', referenceTarget: 'Variante indicada no manual' });
});

it('rejects a cached outline after the human changes the planning approach instead of silently using its old context', async () => {
  const projectId = workspace.getState().createProject('Patinete', 'Construir patinete'); openPlanner(projectId);
  useGraphStore.getState().setObjectiveDraft({ planApproach: 'reverse_engineering', referenceTarget: 'Modelo A' });
  useGraphStore.getState().setOutlines([{ id: 'old', title: 'Antigo', pitch: '', approach: '', strategy: 'hibrido', archetype: 'construir', rank: 1, rankReason: '', planApproach: 'reverse_engineering', referenceTarget: 'Modelo A', outline: { categorias: [] } }], { objective: 'Construir patinete', rules: [], planApproach: 'reverse_engineering', referenceTarget: 'Modelo A' });
  useGraphStore.getState().setObjectiveDraft({ planApproach: 'new_creation' });
  const expand = vi.spyOn(plannerAI, 'expandPlan');
  const tools = createAssistantTools(new AbortController().signal, () => {}, 'Use o plano');
  const result = await tools.planner_ai.execute!({ action: 'select_plan', projectId, planId: 'old' }, { toolCallId: 'stale-intent', messages: [] });
  expect(result).toMatchObject({ ok: false });
  expect(expand).not.toHaveBeenCalled(); expect(useGraphStore.getState().project).toBeNull();
});

it('discards a completed chat expansion if its reference changed while the model was responding', async () => {
  const projectId = workspace.getState().createProject('Patinete', 'Construir patinete'); openPlanner(projectId);
  const intent = { planApproach: 'reverse_engineering' as const, referenceTarget: 'Modelo A' };
  const outline = { id: 'pending', title: 'Plano A', pitch: '', approach: '', strategy: 'hibrido' as const, archetype: 'construir' as const, rank: 1, rankReason: '', ...intent, outline: { categorias: [] } };
  useGraphStore.getState().setObjectiveDraft(intent);
  useGraphStore.getState().setOutlines([outline], { objective: 'Construir patinete', rules: [], ...intent });
  let resolveExpansion!: (plan: Awaited<ReturnType<typeof plannerAI.expandPlan>>) => void;
  const pending = new Promise<Awaited<ReturnType<typeof plannerAI.expandPlan>>>(resolve => { resolveExpansion = resolve; });
  const expand = vi.spyOn(plannerAI, 'expandPlan').mockReturnValue(pending);
  const tools = createAssistantTools(new AbortController().signal, () => {}, 'Use o plano');
  const result = tools.planner_ai.execute!({ action: 'select_plan', projectId, planId: 'pending' }, { toolCallId: 'changed-reference', messages: [] });
  await vi.waitFor(() => expect(expand).toHaveBeenCalledOnce());
  useGraphStore.getState().setObjectiveDraft({ referenceTarget: 'Modelo B' });
  resolveExpansion({ ...outline, tree: { categorias: [] } });
  expect(await result).toMatchObject({ ok: false });
  expect(useGraphStore.getState().objectiveDraft.expanded.pending).toBeUndefined();
  expect(useGraphStore.getState().project).toBeNull();
});
