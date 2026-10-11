import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from '@ai-sdk/provider';
import * as client from '@/ai/client';
import * as service from '@/ai/service';
import * as intake from '@/ai/planIntake';
import { useConfigStore } from '@/config/store';
import { EMPTY_OBJECTIVE_DRAFT, flushGraphPersistence, useGraphStore as graph } from '@/store';
import { flushWorkspacePersistence, useWorkspaceStore as workspace } from '@/workspace/store';
import { capturePlanner, connectPlanner, initializeWorkspace, openPlanner, readPlanner } from '@/workspace/planner';
import { captureChatTurnContext } from './turnContext';
import { flushChatPersistence, sendChatMessage, stopChat, useChatStore as chat } from './store';
import { useKBStore } from '@/kb/store';
import type { AIPlan, AIPlanOutline, ConceptNodeData, Project } from '@/types';
import type { AssistantActionEvent } from '@/ai/workspaceTools';
import type { SceneV1 } from '@/visuals/types';
import { registerPendingPlannerEdit } from './plannerEdits';

// Only the external model/intake/knowledge boundaries are replaced. Chat,
// SDK tool scheduling, planner ownership, mutations and persistence stay real.
const usage = { inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } };
const finish = (toolCalls = false): LanguageModelV3StreamPart => ({ type: 'finish', finishReason: { unified: toolCalls ? 'tool-calls' : 'stop', raw: undefined }, usage });
const call = (toolCallId: string, toolName: string, input: unknown): LanguageModelV3StreamPart => ({ type: 'tool-call', toolCallId, toolName, input: JSON.stringify(input) });
const reply = (text = 'Plano atualizado.'): LanguageModelV3StreamPart[] => [
  { type: 'text-start', id: 'answer' }, { type: 'text-delta', id: 'answer', delta: text }, { type: 'text-end', id: 'answer' }, finish(),
];
function result<T = Record<string, unknown>>(request: LanguageModelV3CallOptions, toolCallId: string): T {
  for (const message of request.prompt) if (message.role === 'tool') {
    for (const part of message.content) if (part.type === 'tool-result' && part.toolCallId === toolCallId) {
      return (part.output as { type: 'json'; value: T }).value;
    }
  }
  throw new Error(`Missing real SDK tool result: ${toolCallId}`);
}
function modelFor(script: (step: number, request: LanguageModelV3CallOptions) => LanguageModelV3StreamPart[] | Promise<LanguageModelV3StreamPart[]>) {
  let step = 0;
  const model = new MockLanguageModelV3({ doStream: async request => ({
    stream: convertArrayToReadableStream([{ type: 'stream-start', warnings: [] }, ...await script(step++, request)]),
  }) });
  vi.spyOn(client, 'aiModel', 'get').mockReturnValue(model);
  return model;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const node = (id: string, parentId: string | null, name: string, order = 0): ConceptNodeData => ({
  id, parentId, name, order, kind: parentId ? 'passo' : 'root', fx: name,
  oQue: `Investigar ${name}`, porQue: 'Conferir a premissa', comoConfirmar: 'PRIVATE_INDEPENDENT_CRITERION',
  problem: '', confidence: 50, pros: [], cons: [], confirmado: false, state: 'concept',
  notes: '', history: [], aiSuggested: false, position: { x: order * 400, y: parentId ? 300 : 0 },
});
const outline: AIPlanOutline = { id: 'alternative', title: 'Ensaio de alimentação', pitch: 'Investigar antes de montar', approach: 'Por etapas', strategy: 'reaproveitar', archetype: 'construir', rank: 1, rankReason: 'Usar os recursos disponíveis', outline: { categorias: [
  { name: 'Execução', kind: 'execucao', nodes: [{ name: 'Conferir servo', kind: 'passo' }] },
] } };
const expanded: AIPlan = { ...outline, tree: { categorias: [{ tempId: 'execution', name: 'Execução', kind: 'execucao', oQue: 'Ensaio', porQue: 'Investigar', children: [
  { tempId: 'servo-check', name: 'Conferir servo', kind: 'passo', fx: 'Servo identificado', oQue: 'Conferir a variante', porQue: 'Evitar premissa errada', comoConfirmar: 'PRIVATE_EXPANDED_CRITERION', problem: '', confidence: 50, confidenceReason: 'Ainda não ensaiado', pros: [], cons: [] },
] }] } };
function plan(name = 'Robô') {
  const projectId = workspace.getState().createProject(name, 'Investigar a alimentação do servo');
  openPlanner(projectId);
  const scene: SceneV1 = { version: 1, label: 'Servo', objects: [{ id: 'body', type: 'box', position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 1, 1], color: '#444444' }] };
  const project: Project = {
    id: `plan-${projectId}`, name, objective: 'Investigar a alimentação do servo', rootId: 'root', createdAt: 1, updatedAt: 1,
    manualLayout: true, nodes: { root: node('root', null, name), target: node('target', 'root', 'Servo'), sibling: node('sibling', 'root', 'Fonte', 1), child: node('child', 'target', 'Fios') },
    edges: {
      a: { id: 'a', source: 'root', target: 'target', kind: 'direct' },
      b: { id: 'b', source: 'root', target: 'sibling', kind: 'direct' },
      c: { id: 'c', source: 'target', target: 'child', kind: 'direct' },
    },
    visuals: { version: 1, mode: 'approval', drafts: { search: { text: '', mentions: [], attachments: [] }, model: { text: '', mentions: [], attachments: [] } }, proposals: [], artifacts: [{
      id: 'servo-model', label: 'Servo ilustrativo', kind: 'model', linkedNodeId: 'target', x: 45, y: 70, width: 300, height: 220,
      mediaId: null, source: null, scene,
      revisions: [{ scene, mediaId: null, createdAt: 1 }], revisionIndex: 0,
    }] },
  };
  graph.setState({ project, selectedNodeId: 'target', focusedParentId: 'root' });
  workspace.getState().savePlanner(projectId, capturePlanner());
  workspace.getState().selectProject(projectId); workspace.getState().navigate('planner');
  return { projectId, project };
}
const actions = (): AssistantActionEvent[] => chat.getState().messages.filter(message => message.role === 'assistant').flatMap(message => message.actions ?? []);
let disconnect: () => void;
let previousConfig: ReturnType<typeof useConfigStore.getState>;
beforeEach(async () => {
  await Promise.all([graph.persist.rehydrate(), workspace.persist.rehydrate(), chat.persist.rehydrate()]);
  previousConfig = useConfigStore.getState();
  useConfigStore.setState({ activeProvider: 'openai', providers: { openai: { apiKey: 'SYNTHETIC_LOCAL_ONLY', mainModel: 'gpt-4o', kbModel: 'gpt-4o-mini' } } });
  workspace.setState({ projects: {}, tasks: {}, notes: {}, activeProjectId: null, surface: 'projects', legacyImported: true });
  graph.setState({ project: null, archivedProject: null, archivedPending: null, pendingSuggestions: null, parkedSuggestions: {}, drafts: {}, aiJobs: {}, lastAction: null, objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT } });
  initializeWorkspace(); disconnect = connectPlanner();
  chat.setState({ sessionId: 'planner-conversation', id: 'planner-conversation', title: undefined, createdAt: 1, updatedAt: 1, archivedAt: null, deletedAt: null, compaction: null, contextUsage: null, contextObservation: null, messages: [], modelHistory: [], pendingHistory: null, archivedSessions: [], running: false, compacting: false, error: null, hydrated: true, loadFailed: false, saveFailed: false, rateLimits: {} });
  vi.spyOn(intake, 'classifyPlanRequest').mockResolvedValue({ status: 'not-configured' });
  vi.spyOn(useKBStore.getState(), 'getContextFor').mockResolvedValue([]);
  // Advance the clock between calls so this suite tests ordering without waiting
  // for the agent's production 1.5-second provider pacing after every step.
  let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now += 2000);
});
afterEach(async () => {
  stopChat(); disconnect();
  await Promise.all([flushWorkspacePersistence(), flushGraphPersistence(), flushChatPersistence()]);
  vi.restoreAllMocks(); useConfigStore.setState(previousConfig);
});

describe('conversational planner with the real SDK and stores', () => {
  it('creates and updates a part, moves an existing branch and persists the audited undo without losing a model', async () => {
    const { projectId, project } = plan();
    const model = modelFor((step, request) => {
      if (step === 0) return [call('read', 'planner_action', { action: 'read_plan', projectId }), finish(true)];
      if (step === 1) {
        const read = result<{ ok: boolean; result: { revision: string } }>(request, 'read');
        return [call('structure', 'planner_structure', { projectId, revision: read.result.revision, reason: 'Agrupar controle conforme pedido', operations: [
          { kind: 'add', key: 'control', parentId: 'root', name: 'Controle', nodeKind: 'categoria', oQue: 'Coordenar movimentos', porQue: 'Separar controle e fonte' },
          { kind: 'update', nodeId: 'control', patch: { notes: 'Montagem ainda não testada' } },
          { kind: 'move', nodeId: 'target', parentId: 'control', order: 0 },
        ] }), finish(true)];
      }
      return reply();
    });
    await sendChatMessage('Crie Controle, acrescente a nota e mova Servo para dentro dele.');
    const structure = actions().find(action => action.name === 'planner_structure')!;
    expect(structure.status).toBe('done');
    const { added, undoId } = structure.result as { added: Record<string, string>; undoId: string };
    const changed = readPlanner(projectId).project!;
    expect(changed.id).toBe(project.id);
    expect(changed.nodes[added.control]).toMatchObject({ name: 'Controle', notes: 'Montagem ainda não testada', parentId: 'root' });
    expect(changed.nodes.target).toMatchObject({ parentId: added.control, confirmado: false, comoConfirmar: 'PRIVATE_INDEPENDENT_CRITERION' });
    expect(changed.nodes.child.parentId).toBe('target');
    expect(changed.edges.c).toEqual({ id: 'c', source: 'target', target: 'child', kind: 'direct' });
    expect(Object.values(changed.edges)).toContainEqual(expect.objectContaining({ source: added.control, target: 'target', kind: 'direct' }));
    expect(changed.visuals).toBe(project.visuals);
    expect(JSON.stringify(model.doStreamCalls)).not.toMatch(/PRIVATE_INDEPENDENT_CRITERION|"scene"|"objects"/);
    modelFor(step => step === 0 ? [call('undo', 'planner_action', { action: 'undo_structure', projectId, undoId }), finish(true)] : reply('Alteração desfeita.'));
    await sendChatMessage('Desfaça a reorganização.');
    expect(readPlanner(projectId).project).toBe(project);
    expect(actions().find(action => action.name === 'planner_structure')?.result).toMatchObject({ undone: true });
    await flushChatPersistence(); await chat.persist.rehydrate();
    expect(actions().find(action => action.name === 'planner_structure')?.result).toMatchObject({ undone: true });
    expect(JSON.stringify(chat.getState().modelHistory)).toContain('was undone');
  });

  it('deletes the requested branch and detaches its model instead of deleting the visual artifact', async () => {
    const { projectId, project } = plan();
    modelFor(step => step === 0 ? [call('read', 'planner_action', { action: 'read_plan', projectId }), finish(true)] : step === 1
      ? [call('delete', 'planner_action', { action: 'delete_node', projectId, nodeId: 'target' }), finish(true)] : reply());
    await sendChatMessage('Apague Servo e seus subitens, mantendo o modelo.');
    const changed = readPlanner(projectId).project!;
    expect(Object.keys(changed.nodes).sort()).toEqual(['root', 'sibling']);
    expect(Object.values(changed.edges)).toEqual([{ id: 'b', source: 'root', target: 'sibling', kind: 'direct' }]);
    expect(changed.visuals!.artifacts).toHaveLength(1);
    expect(changed.visuals!.artifacts[0]).toEqual({ ...project.visuals!.artifacts[0], linkedNodeId: null });
    expect(actions().find(action => action.action === 'delete_node')).toMatchObject({ status: 'done', result: { changed: true } });
    await flushWorkspacePersistence(); await workspace.persist.rehydrate();
    expect(workspace.getState().projects[projectId].planner!.project!.visuals!.artifacts[0].scene).toEqual(project.visuals!.artifacts[0].scene);
  });

  it('lets manual review accept one proposal while conversation rejects another, without fabricating confirmation', async () => {
    const { projectId, project } = plan();
    graph.getState().stageSuggestions('target', [
      { ...node('unused-a', 'target', 'Conferir polaridade'), tempId: 'accept-me' },
      { ...node('unused-b', 'target', 'Comprar outra fonte'), tempId: 'reject-me' },
    ], []);
    modelFor((step, request) => {
      if (step === 0) return [call('read', 'planner_action', { action: 'read_plan', projectId }), finish(true)];
      if (step === 1) {
        expect(result<{ result: { pendingSuggestions: { nodes: { tempId: string }[] } } }>(request, 'read').result.pendingSuggestions.nodes.map(item => item.tempId)).toEqual(['accept-me', 'reject-me']);
        graph.getState().acceptSuggestion('accept-me');
        return [call('read-reviewed-parent', 'planner_action', { action: 'read_plan', projectId, nodeId: 'target' }), finish(true)];
      }
      if (step === 2) {
        return [call('reread', 'planner_action', { action: 'read_plan', projectId }), finish(true)];
      }
      if (step === 3) {
        expect(result<{ result: { pendingSuggestions: { nodes: { tempId: string }[] } } }>(request, 'reread').result.pendingSuggestions.nodes.map(item => item.tempId)).toEqual(['reject-me']);
        return [call('reject', 'planner_action', { action: 'reject_suggestion', projectId, tempId: 'reject-me' }), finish(true)];
      }
      return reply('Mantive a etapa aceita e descartei a compra.');
    });
    await sendChatMessage('Vou aceitar a polaridade manualmente; rejeite a compra de outra fonte.');
    const accepted = Object.values(readPlanner(projectId).project!.nodes).find(item => item.name === 'Conferir polaridade')!;
    expect(accepted).toMatchObject({ parentId: 'target', confirmado: false, state: 'concept', aiSuggested: false });
    expect(graph.getState().pendingSuggestions).toBeNull();
    expect(Object.values(graph.getState().project!.nodes).some(item => item.name === 'Comprar outra fonte')).toBe(false);
    expect(graph.getState().project!.visuals).toBe(project.visuals);
    expect(actions().find(action => action.action === 'reject_suggestion')).toMatchObject({ status: 'done' });
  });

  it('keeps the submitted node and project target when the person switches the visible plan during a provider request', async () => {
    const requested = plan('Plano A'), other = plan('Plano B'); openPlanner(requested.projectId);
    workspace.getState().selectProject(requested.projectId); workspace.getState().navigate('planner'); graph.getState().selectNode('target');
    const begun = deferred<void>(), release = deferred<void>();
    const model = modelFor(async step => {
      if (step === 0) { begun.resolve(); await release.promise; return [call('read', 'planner_action', { action: 'read_plan', projectId: requested.projectId }), finish(true)]; }
      if (step === 1) return [call('update', 'planner_action', { action: 'update_node', projectId: requested.projectId, nodeId: 'target', patch: { name: 'Servo identificado' } }), finish(true)];
      return reply();
    });
    const pending = sendChatMessage('Renomeie esse nó para Servo identificado.');
    await begun.promise;
    openPlanner(other.projectId); workspace.getState().selectProject(other.projectId); graph.getState().selectNode('sibling');
    release.resolve(); await pending;
    expect(chat.getState().messages[0].turnContext).toMatchObject({ projectId: requested.projectId, selectedNodeId: 'target', planId: requested.project.id });
    expect(readPlanner(requested.projectId).project!.nodes.target.name).toBe('Servo identificado');
    expect(readPlanner(other.projectId).project).toBe(other.project);
    expect(readPlanner(other.projectId).selectedNodeId).toBe('sibling');
    const system = model.doStreamCalls[0].prompt.find(message => message.role === 'system')!;
    expect(system.content).toContain(`"currentProjectId":"${requested.projectId}"`);
  });

  it('rejects a structural result computed before a manual edit and preserves its unfinished criterion', async () => {
    const { projectId, project } = plan();
    modelFor((step, request) => {
      if (step === 0) return [call('read', 'planner_action', { action: 'read_plan', projectId }), finish(true)];
      if (step === 1) {
        graph.getState().updateNode('target', { oQue: 'Texto escrito manualmente agora' }, { commit: true });
        graph.getState().setDraft('target', 'criterion', 'Minha previsão em escrita');
        return [call('stale', 'planner_structure', { projectId, revision: result<{ result: { revision: string } }>(request, 'read').result.revision, reason: 'Resposta anterior', operations: [
          { kind: 'update', nodeId: 'target', patch: { oQue: 'Resposta calculada antes da edição' } },
          { kind: 'add', key: 'late', parentId: 'root', name: 'Etapa tardia', nodeKind: 'passo', oQue: 'Não inserir parcialmente', porQue: '' },
        ] }), finish(true)];
      }
      expect(result<{ ok: boolean; error: string }>(request, 'stale')).toEqual({ ok: false, error: 'planChanged' });
      return reply('O plano mudou; sua edição foi preservada.');
    });
    await sendChatMessage('Atualize o Servo e acrescente uma etapa.');
    expect(graph.getState().project!.nodes.target.oQue).toBe('Texto escrito manualmente agora');
    expect(Object.keys(graph.getState().project!.nodes).sort()).toEqual(['child', 'root', 'sibling', 'target']);
    expect(JSON.stringify(graph.getState().drafts)).toContain('Minha previsão em escrita');
    expect(graph.getState().project!.visuals).toBe(project.visuals);
    expect(actions().find(action => action.name === 'planner_structure')).toMatchObject({ status: 'error', detail: 'planChanged' });
  });

  it('protects an in-progress manual text edit from update_node before the assistant has reread it', async () => {
    const { projectId } = plan();
    const begun = deferred<void>(), release = deferred<void>();
    modelFor(async step => {
      if (step === 0) {
        begun.resolve(); await release.promise;
        return [call('stale-text', 'planner_action', { action: 'update_node', projectId, nodeId: 'target', patch: { oQue: 'Substituição calculada com a premissa antiga' } }), finish(true)];
      }
      return reply('Sua edição foi preservada.');
    });
    const pending = sendChatMessage('Reescreva o texto desse nó.');
    await begun.promise;
    graph.getState().updateNode('target', { oQue: 'Edição manual durante a resposta' }, { commit: true });
    release.resolve(); await pending;
    expect(graph.getState().project!.nodes.target.oQue).toBe('Edição manual durante a resposta');
    expect(actions().find(event => event.action === 'update_node')).toMatchObject({ status: 'error' });
  });

  it.each(['before-read', 'after-read'] as const)('cannot retarget a submitted edit to a replacement plan with reused node IDs (%s)', async replacement => {
    const { projectId, project } = plan();
    const replace = () => graph.setState({ project: { ...project, id: 'replacement-plan', name: 'Plano substituto' } });
    modelFor((step, request) => {
      if (step === 0) {
        if (replacement === 'before-read') replace();
        return [call('read', 'planner_action', { action: 'read_plan', projectId }), finish(true)];
      }
      if (step === 1) {
        if (replacement === 'after-read') replace();
        expect(result<{ ok: boolean }>(request, 'read').ok).toBe(true);
        return [call('wrong-plan', 'planner_action', { action: 'update_node', projectId, nodeId: 'target', patch: { name: 'Nome destinado ao plano antigo' } }), finish(true)];
      }
      return reply('O plano foi substituído; escolha o destino novamente.');
    });
    await sendChatMessage('Renomeie esse nó.');
    expect(graph.getState().project!.id).toBe('replacement-plan');
    expect(graph.getState().project!.nodes.target.name).toBe('Servo');
    expect(chat.getState().messages[0].turnContext?.planId).toBe(project.id);
    expect(actions().find(event => event.action === 'update_node')).toMatchObject({ status: 'error' });
  });

  it('can reread a changed plan then apply a requested field patch without erasing an unrelated human note', async () => {
    const { projectId } = plan();
    modelFor((step, request) => {
      if (step === 0) {
        graph.getState().updateNode('target', { notes: 'Observação humana preservada' }, { commit: true });
        return [call('fresh-read', 'planner_action', { action: 'read_plan', projectId, nodeId: 'target' }), finish(true)];
      }
      if (step === 1) {
        expect(JSON.stringify(result(request, 'fresh-read'))).toContain('Observação humana preservada');
        return [call('fresh-update', 'planner_action', { action: 'update_node', projectId, nodeId: 'target', patch: { name: 'Servo com contexto atual' } }), finish(true)];
      }
      return reply();
    });
    await sendChatMessage('Renomeie esse nó mantendo minhas anotações.');
    expect(graph.getState().project!.nodes.target).toMatchObject({ name: 'Servo com contexto atual', notes: 'Observação humana preservada' });
    expect(actions().find(event => event.action === 'update_node')).toMatchObject({ status: 'done' });
  });

  it.each(['other-node', 'other-page'] as const)('does not unlock an old target patch by reading and updating an unrelated part (%s)', async readScope => {
    const { projectId } = plan();
    modelFor((step, request) => {
      if (step === 0) return [call('read-target', 'planner_action', { action: 'read_plan', projectId, nodeId: 'target' }), finish(true)];
      if (step === 1) {
        expect(JSON.stringify(result(request, 'read-target'))).toContain('Investigar Servo');
        graph.getState().updateNode('target', { oQue: 'Nova premissa escrita à mão' }, { commit: true });
        return [call('unrelated-read', 'planner_action', { action: 'read_plan', projectId, ...(readScope === 'other-node' ? { nodeId: 'sibling' } : { offset: 2, limit: 1 }) }), finish(true)];
      }
      if (step === 2) {
        expect(result<{ result: { project: { nodes: Record<string, unknown> } } }>(request, 'unrelated-read').result.project.nodes.target).toBeUndefined();
        return [
          call('current-sibling', 'planner_action', { action: 'update_node', projectId, nodeId: 'sibling', patch: { notes: 'Nota atual da fonte' } }),
          call('stale-target', 'planner_action', { action: 'update_node', projectId, nodeId: 'target', patch: { oQue: 'Reescrita baseada em Investigar Servo' } }), finish(true),
        ];
      }
      return reply('Atualizei a fonte; a premissa do Servo precisa de uma leitura atual.');
    });
    await sendChatMessage('Reescreva Servo e anote a fonte.');
    expect(graph.getState().project!.nodes.target.oQue).toBe('Nova premissa escrita à mão');
    expect(graph.getState().project!.nodes.sibling.notes).toBe('Nota atual da fonte');
    expect(actions().filter(event => event.action === 'update_node').map(event => event.status)).toEqual(['done', 'error']);
  });

  it.each(['update_node', 'delete_node'] as const)('does not unlock %s after a summary omits newly edited notes', async action => {
    const { projectId } = plan();
    modelFor((step, request) => {
      if (step === 0) return [call('read-details', 'planner_action', { action: 'read_plan', projectId, nodeId: 'target' }), finish(true)];
      if (step === 1) {
        expect(JSON.stringify(result(request, 'read-details'))).toContain('"notes":""');
        graph.getState().updateNode('target', { notes: 'Anotação humana ausente do resumo' }, { commit: true });
        return [call('summary', 'planner_action', { action: 'read_plan', projectId }), finish(true)];
      }
      if (step === 2) {
        const read = result<{ result: { project: { nodes: Record<string, Record<string, unknown>> } } }>(request, 'summary');
        expect(read.result.project.nodes.target).not.toHaveProperty('notes');
        return [call('hidden-note-write', 'planner_action', { action, projectId, nodeId: 'target', ...(action === 'update_node' ? { patch: { notes: 'Resposta baseada nas anotações antigas' } } : {}) }), finish(true)];
      }
      return reply('Leia os detalhes atuais antes de alterar as anotações.');
    });
    await sendChatMessage('Atualize as anotações do Servo.');
    expect(graph.getState().project!.nodes.target?.notes).toBe('Anotação humana ausente do resumo');
    expect(actions().find(event => event.action === action)).toMatchObject({ status: 'error', detail: 'planChanged' });
  });

  it('recovers an omitted-notes conflict only after receiving the complete current node details', async () => {
    const { projectId } = plan();
    modelFor((step, request) => {
      if (step === 0) return [call('old-details', 'planner_action', { action: 'read_plan', projectId, nodeId: 'target' }), finish(true)];
      if (step === 1) {
        graph.getState().updateNode('target', { notes: 'Anotação humana atual' }, { commit: true });
        return [call('summary', 'planner_action', { action: 'read_plan', projectId }), finish(true)];
      }
      if (step === 2) return [call('new-details', 'planner_action', { action: 'read_plan', projectId, nodeId: 'target' }), finish(true)];
      if (step === 3) {
        const read = result<{ result: { project: { nodes: Record<string, { notes: string; truncatedFields: string[] }> } } }>(request, 'new-details');
        expect(read.result.project.nodes.target).toMatchObject({ notes: 'Anotação humana atual', truncatedFields: [] });
        return [call('fresh-notes', 'planner_action', { action: 'update_node', projectId, nodeId: 'target', patch: { notes: 'Anotação humana atual\nRevisão solicitada' } }), finish(true)];
      }
      return reply();
    });
    await sendChatMessage('Revise as anotações preservando o texto atual.');
    expect(graph.getState().project!.nodes.target.notes).toBe('Anotação humana atual\nRevisão solicitada');
    expect(actions().find(event => event.action === 'update_node')).toMatchObject({ status: 'done' });
  });

  it('keeps the submission baseline when the person edits during asynchronous context preparation', async () => {
    const { projectId } = plan();
    const context = captureChatTurnContext(), begun = deferred<void>(), release = deferred<void>();
    vi.spyOn(intake, 'classifyPlanRequest').mockImplementationOnce(async () => { begun.resolve(); await release.promise; return { status: 'not-configured' }; });
    const model = modelFor(step => step === 0 ? [call('preparation-race', 'planner_action', { action: 'update_node', projectId, nodeId: 'target', patch: { oQue: 'Substituição atrasada' } }), finish(true)] : reply('Sua edição foi preservada.'));
    const pending = sendChatMessage('Atualize esse nó.', { turnContext: context });
    await begun.promise; graph.getState().updateNode('target', { oQue: 'Texto escrito durante preparação' }, { commit: true });
    release.resolve(); await pending;
    expect(graph.getState().project!.nodes.target.oQue).toBe('Texto escrito durante preparação');
    expect(actions().find(event => event.action === 'update_node')).toMatchObject({ status: 'error', detail: 'planChanged' });
    expect(JSON.stringify(model.doStreamCalls)).not.toContain('plannerEditBaseline');
    await flushChatPersistence(); await chat.persist.rehydrate();
    expect(JSON.stringify(chat.getState().messages)).not.toContain('plannerEditBaseline');
    expect(JSON.stringify(chat.getState().modelHistory)).not.toContain('plannerEditBaseline');
  });

  it.each(['update_node', 'delete_node', 'confirm_node', 'new_plan'] as const)('blocks %s while an editor has uncommitted prose, keeping the draft private', async action => {
    const { projectId, project } = plan();
    const clear = registerPendingPlannerEdit({ planId: project.id, nodeId: 'target', field: 'oQue' });
    modelFor(step => step === 0 ? [call('read', 'planner_action', { action: 'read_plan', projectId }), finish(true)] : step === 1 ? [call('draft-blocked', 'planner_action', {
      action, projectId, ...(action === 'new_plan' ? {} : { nodeId: 'target' }), ...(action === 'update_node' ? { patch: { oQue: 'Não substituir o rascunho' } } : {}),
    }), finish(true)] : reply('Conclua sua edição de campo antes de continuar.'));
    try {
      await sendChatMessage('Faça a alteração solicitada.');
      expect(graph.getState().project).toBe(project);
      expect(actions().find(event => event.action === action)).toMatchObject({ status: 'error', detail: expect.stringContaining('plannerDraftPending') });
    } finally { clear(); }
  });

  it('records a blocked confirmation honestly, then accepts only the criterion and observation supplied by the person', async () => {
    const { projectId } = plan();
    graph.getState().reportFailure('child', 'Polaridade ainda não conferida');
    modelFor(step => step === 0 ? [call('blocked-confirm', 'planner_action', { action: 'confirm_node', projectId, nodeId: 'child' }), finish(true)] : reply('A falha continua em aberto.'));
    await sendChatMessage('Confirme Fios.');
    expect(graph.getState().project!.nodes.child).toMatchObject({ confirmado: false, failureContext: 'Polaridade ainda não conferida' });
    expect(actions().find(event => event.action === 'confirm_node')).toMatchObject({ status: 'error', result: { changed: false } });
    modelFor(step => step === 0 ? [
      call('clear-failure', 'planner_action', { action: 'clear_failure', projectId, nodeId: 'child' }),
      call('criterion', 'planner_action', { action: 'set_criterion', projectId, nodeId: 'child', text: 'Positivo identificado antes de ligar' }),
      call('observation', 'planner_action', { action: 'attest_criterion', projectId, nodeId: 'child', observation: 'Conferi as marcas positivo e negativo' }),
      call('confirm', 'planner_action', { action: 'confirm_node', projectId, nodeId: 'child' }), finish(true),
    ] : reply('Observação registrada e etapa confirmada.'));
    await sendChatMessage('Limpe a falha. Meu critério: Positivo identificado antes de ligar. Observei: Conferi as marcas positivo e negativo. Confirme a etapa.');
    expect(graph.getState().project!.nodes.child).toMatchObject({ confirmado: true, state: 'done', comoConfirmarUsuario: 'Positivo identificado antes de ligar', comoConfirmarAtendido: { observacao: 'Conferi as marcas positivo e negativo' } });
    expect(actions().slice(-4).map(event => event.status)).toEqual(['done', 'done', 'done', 'done']);
  });

  it('refuses undo after a manual edit instead of erasing it', async () => {
    const { projectId } = plan();
    modelFor((step, request) => step === 0 ? [call('read', 'planner_action', { action: 'read_plan', projectId }), finish(true)] : step === 1 ? [
      call('structure', 'planner_structure', { projectId, revision: result<{ result: { revision: string } }>(request, 'read').result.revision, reason: 'Adicionar parte', operations: [
        { kind: 'add', key: 'new', parentId: 'root', name: 'Parte nova', nodeKind: 'passo', oQue: 'Preparar ensaio', porQue: '' },
      ] }), finish(true),
    ] : reply());
    await sendChatMessage('Adicione uma parte nova.');
    const { undoId, added } = actions().find(action => action.name === 'planner_structure')!.result as { undoId: string; added: Record<string, string> };
    graph.getState().updateNode(added.new, { notes: 'Anotação manual posterior' }, { commit: true });
    modelFor(step => step === 0 ? [call('undo', 'planner_action', { action: 'undo_structure', projectId, undoId }), finish(true)] : reply('Não desfiz por haver edição posterior.'));
    await sendChatMessage('Desfaça a parte nova.');
    expect(graph.getState().project!.nodes[added.new].notes).toBe('Anotação manual posterior');
    expect(actions().find(action => action.action === 'undo_structure')).toMatchObject({ status: 'error', detail: 'planChanged' });
    expect(actions().find(action => action.name === 'planner_structure')!.result).not.toHaveProperty('undone');
  });

  it('cancels between tool steps, keeps the completed node update and never executes the queued deletion', async () => {
    const { projectId, project } = plan();
    const begun = deferred<void>(), release = deferred<void>();
    modelFor(async step => {
      if (step === 0) return [call('update', 'planner_action', { action: 'update_node', projectId, nodeId: 'target', patch: { name: 'Atualização aplicada' } }), finish(true)];
      begun.resolve(); await release.promise;
      return [call('delete-after-cancel', 'planner_action', { action: 'delete_node', projectId, nodeId: 'sibling' }), finish(true)];
    });
    const pending = sendChatMessage('Renomeie Servo e depois apague Fonte.');
    await begun.promise; stopChat(); release.resolve(); await pending;
    expect(graph.getState().project!.nodes.target.name).toBe('Atualização aplicada');
    expect(graph.getState().project!.nodes.sibling.name).toBe('Fonte');
    expect(graph.getState().project!.visuals).toBe(project.visuals);
    expect(actions()).toEqual([expect.objectContaining({ action: 'update_node', status: 'done' })]);
    expect(chat.getState().messages[1]).toMatchObject({ interrupted: true });
    expect(chat.getState().running).toBe(false);
    expect(JSON.stringify(chat.getState().modelHistory)).toContain('Read current records before repeating mutations');
    await flushChatPersistence(); await chat.persist.rehydrate();
    expect(actions()[0]).toMatchObject({ action: 'update_node', status: 'done' });
    expect(chat.getState().messages[1].interrupted).toBe(true);
  });

  it.each(['explain_node', 'critique_node', 'decompose_node'] as const)('discards stale %s output after a manual change to its source node', async action => {
    const { projectId, project } = plan();
    const begun = deferred<void>(), release = deferred<void>();
    const wait = async () => { begun.resolve(); await release.promise; };
    vi.spyOn(service, 'explainNode').mockImplementation(async () => { await wait(); return 'STALE_EXPLANATION'; });
    vi.spyOn(service, 'critiqueNode').mockImplementation(async () => { await wait(); return { fraquezas: ['STALE_CRITIQUE'], premissasOcultas: [], criterioAlternativo: '', generatedAt: 1 }; });
    vi.spyOn(service, 'decomposeNode').mockImplementation(async () => { await wait(); return { nodes: [{ tempId: 'stale', kind: 'passo', name: 'STALE_SUGGESTION', fx: '', problem: '', confidence: 50, confidenceReason: '', pros: [], cons: [], oQue: '', porQue: '', comoConfirmar: '' }], edges: [] }; });
    modelFor(step => step === 0 ? [call('nested-ai', 'planner_ai', { action, projectId, nodeId: 'target' }), finish(true)] : reply('Sua alteração foi preservada.'));
    const pending = sendChatMessage('Analise e decomponha esse nó.');
    await begun.promise;
    graph.getState().updateNode('target', { oQue: 'Agora o usuário mudou a premissa', explicacao: 'Explicação humana atual' }, { commit: true });
    release.resolve(); await pending;
    expect(graph.getState().project!.nodes.target).toMatchObject({ oQue: 'Agora o usuário mudou a premissa', explicacao: 'Explicação humana atual' });
    expect(graph.getState().project!.nodes.target.critica).toBeUndefined();
    expect(graph.getState().pendingSuggestions).toBeNull();
    expect(graph.getState().project!.visuals).toBe(project.visuals);
    expect(actions().find(event => event.action === action)).toMatchObject({ status: 'error' });
    expect(JSON.stringify(readPlanner(projectId))).not.toMatch(/STALE_EXPLANATION|STALE_CRITIQUE|STALE_SUGGESTION/);
  });

  it('does not stage a decomposition over prose that became dirty while generation was running', async () => {
    const { projectId, project } = plan(), begun = deferred<void>(), release = deferred<void>();
    vi.spyOn(service, 'decomposeNode').mockImplementation(async () => {
      begun.resolve(); await release.promise;
      return { nodes: [{ tempId: 'late', kind: 'passo', name: 'Sugestão sem contexto atualizado', fx: '', problem: '', confidence: 50, confidenceReason: '', pros: [], cons: [], oQue: '', porQue: '', comoConfirmar: '' }], edges: [] };
    });
    modelFor(step => step === 0 ? [call('decompose', 'planner_ai', { action: 'decompose_node', projectId, nodeId: 'target' }), finish(true)] : reply('Conclua sua edição antes de decompor.'));
    const pending = sendChatMessage('Decomponha esse nó.');
    await begun.promise;
    const clear = registerPendingPlannerEdit({ planId: project.id, nodeId: 'target', field: 'notes' });
    try {
      release.resolve(); await pending;
      expect(graph.getState().pendingSuggestions).toBeNull();
      expect(graph.getState().project).toBe(project);
      expect(actions().find(event => event.action === 'decompose_node')).toMatchObject({ status: 'error', detail: expect.stringContaining('plannerDraftPending') });
    } finally { clear(); }
  });

  it('does not apply or save a late decomposition into another editor installed by an import', async () => {
    const requested = plan('Plano em análise'), replacement = plan('Plano importado'); openPlanner(requested.projectId);
    workspace.getState().selectProject(requested.projectId); workspace.getState().navigate('planner');
    const begun = deferred<void>(), release = deferred<void>();
    vi.spyOn(service, 'decomposeNode').mockImplementation(async () => {
      begun.resolve(); await release.promise;
      return { nodes: [{ tempId: 'late-import', kind: 'passo', name: 'Não aplicar no importado', fx: '', problem: '', confidence: 50, confidenceReason: '', pros: [], cons: [], oQue: '', porQue: '', comoConfirmar: '' }], edges: [] };
    });
    modelFor(step => step === 0 ? [call('decompose', 'planner_ai', { action: 'decompose_node', projectId: requested.projectId, nodeId: 'target' }), finish(true)] : reply('O editor mudou; envie o pedido no projeto correto.'));
    const pending = sendChatMessage('Decomponha esse nó.');
    await begun.promise;
    // Import/account rehydration can replace a singleton without openPlanner's
    // normal busy gate. The importer then reinitializes its ownership boundary.
    disconnect();
    graph.setState({ project: replacement.project, pendingSuggestions: null }); initializeWorkspace();
    disconnect = connectPlanner();
    workspace.getState().selectProject(replacement.projectId); workspace.getState().navigate('planner');
    release.resolve(); await pending;
    expect(graph.getState().project).toBe(replacement.project);
    expect(graph.getState().pendingSuggestions).toBeNull();
    expect(workspace.getState().projects[requested.projectId].planner!.project!.id).toBe(requested.project.id);
    expect(workspace.getState().projects[replacement.projectId].planner!.project!.id).toBe(replacement.project.id);
    expect(actions().find(event => event.action === 'decompose_node')).toMatchObject({ status: 'error', detail: 'planChanged' });
  });

  it('discards generated alternatives when the person changes the objective while the provider is running', async () => {
    const projectId = workspace.getState().createProject('Rascunho', 'Objetivo original'); openPlanner(projectId);
    workspace.getState().selectProject(projectId); workspace.getState().navigate('planner');
    const begun = deferred<void>(), release = deferred<void>();
    vi.spyOn(service, 'outlinePlans').mockImplementation(async () => { begun.resolve(); await release.promise; return []; });
    modelFor(step => step === 0 ? [call('generate', 'planner_ai', { action: 'generate_plans', projectId }), finish(true)] : reply('O objetivo mudou; gere novas alternativas.'));
    const pending = sendChatMessage('Gere alternativas para esse objetivo.');
    await begun.promise; graph.getState().setObjectiveDraft({ objective: 'Objetivo reescrito manualmente' });
    release.resolve(); await pending;
    expect(graph.getState().objectiveDraft.objective).toBe('Objetivo reescrito manualmente');
    expect(graph.getState().objectiveDraft.outlines).toBeNull();
    expect(graph.getState().objectiveDraft.plansFor).toBeNull();
    expect(actions().find(event => event.action === 'generate_plans')).toMatchObject({ status: 'error', detail: 'planChanged' });
  });

  it('creates a selected plan through the normal generator tools and edits its real returned node ID in the same conversation', async () => {
    const projectId = workspace.getState().createProject('Ensaio', 'Investigar antes de montar'); openPlanner(projectId);
    workspace.getState().selectProject(projectId); workspace.getState().navigate('planner');
    vi.spyOn(service, 'outlinePlans').mockResolvedValue([outline]);
    vi.spyOn(service, 'expandPlan').mockResolvedValue(expanded);
    const model = modelFor((step, request) => {
      if (step === 0) return [call('generate', 'planner_ai', { action: 'generate_plans', projectId }), finish(true)];
      if (step === 1) {
        expect(result<{ result: { id: string }[] }>(request, 'generate').result[0].id).toBe('alternative');
        return [call('select', 'planner_ai', { action: 'select_plan', projectId, planId: 'alternative' }), finish(true)];
      }
      if (step === 2) return [call('read-created', 'planner_action', { action: 'read_plan', projectId }), finish(true)];
      if (step === 3) {
        const read = result<{ result: { project: { nodes: Record<string, { id: string; name: string }> } } }>(request, 'read-created');
        const target = Object.values(read.result.project.nodes).find(item => item.name === 'Conferir servo')!;
        return [call('edit-created', 'planner_action', { action: 'update_node', projectId, nodeId: target.id, patch: { notes: 'Aguarda conferência física' } }), finish(true)];
      }
      return reply('Plano criado e observação adicionada.');
    });
    await sendChatMessage('Gere o plano de ensaio, escolha a alternativa e anote que aguarda conferência física.');
    const created = readPlanner(projectId).project!;
    expect(created).toMatchObject({ name: 'Ensaio', objective: 'Investigar antes de montar' });
    const target = Object.values(created.nodes).find(item => item.name === 'Conferir servo')!;
    expect(target).toMatchObject({ notes: 'Aguarda conferência física', confirmado: false, state: 'concept' });
    expect(actions().map(event => [event.action, event.status])).toEqual([['generate_plans', 'done'], ['select_plan', 'done'], ['read_plan', 'done'], ['update_node', 'done']]);
    expect(JSON.stringify(model.doStreamCalls)).not.toContain('PRIVATE_EXPANDED_CRITERION');
    expect(workspace.getState().projects[projectId].planner!.project!.id).toBe(created.id);
  });

  it('does not create a selected plan from an expansion whose rules changed during the provider request', async () => {
    const projectId = workspace.getState().createProject('Ensaio', 'Investigar antes de montar'); openPlanner(projectId);
    workspace.getState().selectProject(projectId); workspace.getState().navigate('planner');
    graph.getState().setOutlines([outline], { objective: 'Investigar antes de montar', rules: [] });
    const begun = deferred<void>(), release = deferred<void>();
    vi.spyOn(service, 'expandPlan').mockImplementation(async () => { begun.resolve(); await release.promise; return expanded; });
    modelFor(step => step === 0 ? [call('select', 'planner_ai', { action: 'select_plan', projectId, planId: 'alternative' }), finish(true)] : reply('As regras mudaram; selecione uma alternativa atualizada.'));
    const pending = sendChatMessage('Escolha o plano de ensaio.');
    await begun.promise; graph.getState().setObjectiveDraft({ rules: ['Usar somente a fonte já escolhida'] });
    release.resolve(); await pending;
    expect(graph.getState().project).toBeNull();
    expect(graph.getState().objectiveDraft.rules).toEqual(['Usar somente a fonte já escolhida']);
    expect(graph.getState().objectiveDraft.expanded.alternative).toBeUndefined();
    expect(actions().find(event => event.action === 'select_plan')).toMatchObject({ status: 'error', detail: 'planChanged' });
  });

  it('can intentionally archive and restore its own plan in one turn without treating its own replacement as a conflict', async () => {
    const { projectId, project } = plan();
    modelFor(step => step === 0 ? [
      call('archive', 'planner_action', { action: 'new_plan', projectId }),
      call('restore', 'planner_action', { action: 'restore_previous_plan', projectId }), finish(true),
    ] : reply('Plano anterior restaurado.'));
    await sendChatMessage('Abra um novo rascunho e restaure o plano anterior.');
    expect(graph.getState().project).toBe(project);
    expect(graph.getState().project!.visuals).toBe(project.visuals);
    expect(actions().map(event => [event.action, event.status])).toEqual([['new_plan', 'done'], ['restore_previous_plan', 'done']]);
  });
});
