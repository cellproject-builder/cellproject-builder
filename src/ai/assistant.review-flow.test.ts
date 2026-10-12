import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { useWorkspaceStore as workspace, flushWorkspacePersistence } from '@/workspace/store';
import { useGraphStore, EMPTY_OBJECTIVE_DRAFT } from '@/store';
import { capturePlanner, initializeWorkspace, openPlanner, readPlanner } from '@/workspace/planner';
import { captureChatTurnContext } from '@/chat/turnContext';
import { buildDemoProject } from '@/data/demoProject';
import type { ConceptNodeData } from '@/types';
import type { AssistantActionEvent } from './workspaceTools';
import type { readAssistantPlan } from './planContext';
import { runAssistant } from './assistant';

// This suite drives the installed SDK and actual local tools. The scripted model
// derives its answer from returned fields; it does not measure LLM judgement.
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } };
type PublicPlan = ReturnType<typeof readAssistantPlan>;
type Prompt = { role: string; content: unknown }[];

function toolResult<T>(prompt: unknown, callId: string): T {
  for (const message of prompt as Prompt) {
    if (message.role !== 'tool' || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type !== 'tool-result' || part.toolCallId !== callId) continue;
      expect(part.output.type).toBe('json');
      expect(part.output.value.ok).toBe(true);
      return part.output.value.result as T;
    }
  }
  throw new Error(`Missing real SDK tool output: ${callId}`);
}

function call(callId: string, toolName: string, input: unknown): LanguageModelV3StreamPart[] {
  return [{ type: 'stream-start', warnings: [] },
    { type: 'tool-call', toolCallId: callId, toolName, input: JSON.stringify(input) },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage }];
}
function answer(text: string): LanguageModelV3StreamPart[] {
  return [{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'review-answer' },
    { type: 'text-delta', id: 'review-answer', delta: text }, { type: 'text-end', id: 'review-answer' },
    { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage }];
}
function installSeventeenNodePlan() {
  const projectId = workspace.getState().createProject('DUO AXION', 'Investigar dois braços sem tratar diagramas como prova física.');
  openPlanner(projectId);
  const base = buildDemoProject(), root = base.nodes[base.rootId];
  const names = ['DUO AXION', 'Recursos', 'ESP32', 'PCA9685', 'MG90S', 'Fonte 5V', 'Capacitor', 'USB serial',
    'Estrutura', 'Impressão', 'Montagem', 'Cabeamento', 'Firmware', 'Calibração', 'Ensaio sem carga', 'Ensaio com carga', 'Verificar torque'];
  const nodes: Record<string, ConceptNodeData> = Object.fromEntries(names.map((name, index) => [`review-${index}`, {
    ...root, id: `review-${index}`, parentId: index ? 'review-0' : null,
    kind: index === 0 ? 'root' : index === 1 ? 'categoria' : index < 8 ? 'recurso' : 'passo', name, order: index,
    state: index === 16 ? 'problem' : 'concept', confirmado: false, takenAsKnown: false, confirmedWithoutSignal: false,
    fx: name, problem: '', confidenceReason: 'Premissa do ensaio, sem medição física.',
    comoConfirmarUsuarioAt: undefined, aiCriterionSeenAt: undefined, comoConfirmarUsuario: '', comoConfirmarAtendido: undefined,
    comoConfirmar: `PRIVATE_CRITERION_${index}`,
    oQue: `${name}: premissa de montagem a investigar. ` + 'Descrição extensa de engenharia sem evidência física. '.repeat(90),
    porQue: 'Investigar antes de executar. '.repeat(80), notes: 'Notas longas preservadas. '.repeat(100),
    history: [], groundTruthRefs: [], confidence: 30, pros: [], cons: [],
    failureContext: index === 16 ? 'A carga de 20 g ainda não foi medida na garra; o torque real precisa de ensaio.' : '',
    webResearch: undefined, critica: undefined,
  } satisfies ConceptNodeData]));
  const edges = Object.fromEntries(names.slice(1).map((_, index) => [`review-edge-${index + 1}`, {
    id: `review-edge-${index + 1}`, source: 'review-0', target: `review-${index + 1}`, kind: 'direct' as const,
  }]));
  useGraphStore.setState({ project: { ...base, id: `plan-${projectId}`, name: 'DUO AXION', rootId: 'review-0',
    objective: 'Investigar dois braços sem tratar diagramas como prova física.', rules: [], nodes, edges, visuals: undefined } });
  useGraphStore.getState().selectNode('review-16');
  workspace.getState().savePlanner(projectId, capturePlanner());
  workspace.getState().updateProject(projectId, { attachments: [{ id: 'manual-source', name: 'Manual dos servos.pdf', kind: 'pdf',
    text: 'PRIVATE_PDF_BODY_NOT_REQUESTED', fingerprint: 'manual-v1', truncated: false }] } as never);
  workspace.getState().selectProject(projectId); workspace.getState().navigate('planner');
  return projectId;
}

beforeEach(async () => {
  await Promise.all([workspace.persist.rehydrate(), useGraphStore.persist.rehydrate()]);
  await flushWorkspacePersistence();
  workspace.setState({ projects: {}, tasks: {}, notes: {}, sprints: {}, folders: {}, comments: {}, boards: {}, legacyImported: true });
  useGraphStore.setState({ project: null, archivedProject: null, pendingSuggestions: null, parkedSuggestions: {}, drafts: {}, aiJobs: {}, objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT } });
  initializeWorkspace();
});
afterEach(async () => { await flushWorkspacePersistence(); vi.restoreAllMocks(); });

it('finishes a dense 17-node review from two advancing pages and one relevant detail without changing either plan', async () => {
  const projectId = installSeventeenNodePlan();
  const otherId = workspace.getState().createProject('Outro projeto', 'Não é alvo desta revisão.');
  workspace.getState().selectProject(projectId); workspace.getState().navigate('planner');
  const frozen = captureChatTurnContext(), before = structuredClone(readPlanner(projectId)), otherBefore = structuredClone(readPlanner(otherId));
  const events: AssistantActionEvent[] = [], chunks: string[] = [];
  let index = 0, firstPage!: PublicPlan, secondPage!: PublicPlan;
  const model = new MockLanguageModelV3({ doStream: async options => {
    let parts: LanguageModelV3StreamPart[];
    if (index === 0) parts = call('review-page-0', 'planner_read', { projectId });
    else if (index === 1) {
      firstPage = toolResult<PublicPlan>(options.prompt, 'review-page-0');
      expect(firstPage.nodePage).toMatchObject({ total: 17, returned: 10, nextOffset: 10 });
      expect(firstPage.edgePage.nextOffset).toBe(10);
      parts = call('review-page-1', 'planner_read', { projectId, offset: firstPage.nodePage.nextOffset, edgeOffset: firstPage.edgePage.nextOffset });
    } else if (index === 2) {
      secondPage = toolResult<PublicPlan>(options.prompt, 'review-page-1');
      expect(secondPage.nodePage).toMatchObject({ total: 17, returned: 7, nextOffset: null });
      expect(secondPage.edgePage).toMatchObject({ total: 16, returned: 6, nextOffset: null });
      const risk = Object.values(secondPage.project!.nodes).find(node => node.state === 'problem');
      expect(risk?.name).toBe('Verificar torque');
      parts = call('review-risk-detail', 'planner_read', { projectId, nodeId: risk!.id });
    } else {
      expect(index).toBe(3);
      const detail = toolResult<PublicPlan>(options.prompt, 'review-risk-detail');
      const node = detail.project!.nodes['review-16'];
      const allNodes = [...Object.values(firstPage.project!.nodes), ...Object.values(secondPage.project!.nodes)];
      expect(new Set(allNodes.map(item => item.id)).size).toBe(17);
      expect(Object.keys(firstPage.project!.nodes).some(id => id in secondPage.project!.nodes)).toBe(false);
      const allEdges = [...Object.keys(firstPage.project!.edges), ...Object.keys(secondPage.project!.edges)];
      expect(new Set(allEdges).size).toBe(16);
      expect(allNodes.find(item => item.name === 'ESP32')).toBeDefined();
      expect(allNodes.find(item => item.name === 'PCA9685')).toBeDefined();
      expect(allNodes.find(item => item.name === 'MG90S')).toBeDefined();
      const source = firstPage.attachments[0];
      parts = answer(`Revisei a estrutura dos ${allNodes.length} nós de ${detail.project!.name}. ` +
        `O plano inclui ESP32, PCA9685 e MG90S. Risco em ${node.name}: ${'failureContext' in node ? node.failureContext : ''} ` +
        `Fonte cadastrada: ${source.name} (${source.id}); o conteúdo do PDF não foi lido. ` +
        'Os textos extensos foram consultados parcialmente. A revisão não comprova compatibilidade nem execução física. Nenhuma alteração foi aplicada.');
    }
    index++;
    return { stream: convertArrayToReadableStream(parts) };
  } });
  const result = await runAssistant({ messages: [{ role: 'user', content: 'revise o plano' }], userText: 'revise o plano',
    contextProjectId: projectId, turnContext: frozen, model, signal: new AbortController().signal,
    onText: text => chunks.push(text), onAction: event => {
      events.push(event);
      if (event.status === 'done' && events.filter(item => item.status === 'done').length === 1) {
        workspace.getState().selectProject(otherId); workspace.getState().navigate('overview');
      }
    } });
  expect(model.doStreamCalls).toHaveLength(4);
  expect(result.text).toContain('17 nós de DUO AXION');
  expect(result.text).toContain('A carga de 20 g ainda não foi medida');
  expect(result.text).toContain('manual-source');
  expect(result.text).toContain('o conteúdo do PDF não foi lido');
  expect(chunks.at(-1)).toBe(result.text);
  expect(events.filter(event => event.status === 'done').map(event => event.action)).toEqual(['planner_read', 'planner_read', 'planner_read']);
  expect(events.every(event => event.name === 'planner_read')).toBe(true);
  expect(readPlanner(projectId)).toEqual(before);
  expect(readPlanner(otherId)).toEqual(otherBefore);
  const prompt = JSON.stringify(model.doStreamCalls[3].prompt);
  const system = model.doStreamCalls[3].prompt.find(message => message.role === 'system');
  expect(system?.content).toContain('"surface":"planner"');
  expect(system?.content).toContain('"selectedNodeId":"review-16"');
  expect(prompt).not.toMatch(/PRIVATE_PDF_BODY_NOT_REQUESTED|PRIVATE_CRITERION_/);
  expect(result.messages.filter(message => message.role === 'tool')).toHaveLength(3);
}, 12_000);

it('explains that no applied plan exists instead of presenting an empty read as a completed review', async () => {
  const projectId = workspace.getState().createProject('Ainda sem plano');
  openPlanner(projectId);
  let index = 0;
  const model = new MockLanguageModelV3({ doStream: async options => {
    if (index++ === 0) return { stream: convertArrayToReadableStream(call('empty-plan', 'planner_read', { projectId })) };
    const read = toolResult<PublicPlan>(options.prompt, 'empty-plan');
    expect(read.project).toBeNull();
    expect(read.nodePage).toMatchObject({ total: 0, returned: 0, nextOffset: null });
    return { stream: convertArrayToReadableStream(answer('Este projeto ainda não tem um plano aplicado. Preciso do objetivo e das partes propostas para revisar a estrutura; não há nós para avaliar.')) };
  } });
  const events: AssistantActionEvent[] = [];
  const result = await runAssistant({ messages: [{ role: 'user', content: 'Revise o plano.' }], userText: 'Revise o plano.',
    contextProjectId: projectId, model, signal: new AbortController().signal, onText() {}, onAction: event => events.push(event) });
  expect(result.text).toContain('não tem um plano aplicado');
  expect(result.text).not.toContain('Ações processadas');
  expect(model.doStreamCalls).toHaveLength(2);
  expect(events.filter(event => event.status === 'done')).toHaveLength(1);
  expect(readPlanner(projectId).project).toBeNull();
}, 8_000);

it('retains the audit and applied change if the provider fails before the final explanation, without replaying the mutation', async () => {
  const projectId = installSeventeenNodePlan(), original = structuredClone(readPlanner(projectId).project!);
  const failure = new Error('SYNTHETIC_PROVIDER_FINAL_FAILURE');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let index = 0;
  const model = new MockLanguageModelV3({ doStream: async () => {
    if (index++ === 0) return { stream: convertArrayToReadableStream(call('enable-plan-edit', 'enable_capabilities', { capabilities: ['plan'] })) };
    if (index === 2) return { stream: convertArrayToReadableStream(call('apply-title-once', 'planner_action', {
      action: 'update_node', projectId, nodeId: 'review-16', patch: { name: 'Ensaio de torque pendente' },
    })) };
    throw failure;
  } });
  const events: AssistantActionEvent[] = [];
  await expect(runAssistant({ messages: [{ role: 'user', content: 'Renomeie Verificar torque para Ensaio de torque pendente.' }],
    userText: 'Renomeie Verificar torque para Ensaio de torque pendente.', contextProjectId: projectId,
    model, signal: new AbortController().signal, onText() {}, onAction: event => events.push(event) })).rejects.toBe(failure);
  const applied = events.filter(event => event.action === 'update_node' && event.status === 'done');
  expect(applied).toHaveLength(1);
  expect(applied[0].result).toBeDefined();
  const current = readPlanner(projectId).project!;
  expect(current.nodes['review-16'].name).toBe('Ensaio de torque pendente');
  expect(current.nodes['review-16'].oQue).toBe(original.nodes['review-16'].oQue);
  expect(Object.keys(current.nodes)).toEqual(Object.keys(original.nodes));
  expect(current.edges).toEqual(original.edges);
  expect(model.doStreamCalls).toHaveLength(3);
  expect(current.nodes['review-16'].history.length).toBe(original.nodes['review-16'].history.length + 1);
}, 10_000);
