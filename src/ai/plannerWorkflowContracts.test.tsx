import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';

// Only the external provider is replaced. Tools, stores, service, research and
// the failure UI run together, with no network or paid model requests.
const transport = vi.hoisted(() => ({ models: {} as Record<string, unknown> }));
vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: () => ({ chat: (id: string) => {
    const model = transport.models[id];
    if (!model) throw new Error(`No synthetic transport configured for ${id}`);
    return model;
  } }),
}));

import { useConfigStore } from '@/config/store';
import { useLocaleStore } from '@/i18n';
import { en } from '@/i18n/messages';
import { useKBStore } from '@/kb/store';
import { CRITERION_UNLOCK_MS, EMPTY_OBJECTIVE_DRAFT, useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { capturePlanner, initializeWorkspace, openPlanner } from '@/workspace/planner';
import type { ConceptNodeData, Project } from '@/types';
import { FailureSection } from '@/components/GroundTruth';
import { ObjectiveScreen } from '@/components/ObjectiveScreen';
import { createAssistantTools } from './workspaceTools';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};
const alternateCriterion = 'Hold 100 g for 30 seconds without drift.';
const ownCriterion = 'Lift 100 g to 90 degrees with at most 2 degrees of error.';
const aiCriterion = 'Move the unloaded arm within 5 degrees.';
const staleResearch = {
  query: 'battery', findings: 'STALE-BATTERY-DOCUMENTATION', searchedAt: 1,
  sources: [{ url: 'https://stale.example/battery', title: 'Old battery document' }],
};
const outlineReply = {
  plans: [{ title: 'Current servo plan', pitch: 'Investigate the servo', approach: 'Measure the selected variant',
    strategy: 'hibrido', archetype: 'construir', rank: 1, rankReason: 'Check the available hardware',
    estimates: { custo: 'Unknown', tempo: 'Unknown', dificuldade: 'iniciante' }, rulesCheck: [],
    outline: { categorias: [{ name: 'Execution', kind: 'execucao', nodes: [{ name: 'Measure the servo', kind: 'passo' }] }] },
  }],
};
const expansionReply = { categorias: [{ tempId: 'category', name: 'Execution', kind: 'execucao', oQue: 'Measure', porQue: 'Investigate',
  children: [{ tempId: 'measure', kind: 'passo', name: 'Measure the servo', fx: 'unknown → measured', confidence: 50,
    confidenceReason: 'Measurement pending', oQue: 'Measure the selected servo.', porQue: 'Investigate its behavior.',
    comoConfirmar: 'Record the observed angle.', ruleConflict: null, order: 1, decisionOptions: null, groundTruthHints: [] }],
}] };

function providerModel(replies: { generate?: unknown; streams?: unknown[]; research?: boolean; onStream?: () => void; streamGate?: Promise<void> }) {
  const streams = [...(replies.streams ?? [])];
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: replies.research ? 'CURRENT-SERVO-DOCUMENTATION' : JSON.stringify(replies.generate) },
        ...(replies.research ? [{ type: 'source' as const, sourceType: 'url' as const, id: 'servo',
          url: 'https://current.example/servo', title: 'Current servo document' }] : [])],
      warnings: [], finishReason: { unified: 'stop', raw: 'stop' }, usage,
    }),
    doStream: async () => {
      replies.onStream?.();
      await replies.streamGate;
      const reply = streams.shift();
      if (!reply) throw new Error('Unexpected model stream');
      const parts: LanguageModelV3StreamPart[] = [
        { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'text' },
        { type: 'text-delta', id: 'text', delta: JSON.stringify(reply) }, { type: 'text-end', id: 'text' },
        { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
      ];
      return { stream: new ReadableStream({ start(controller) { parts.forEach(part => controller.enqueue(part)); controller.close(); } }) };
    },
  });
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await Promise.all([useWorkspaceStore.persist.rehydrate(), useGraphStore.persist.rehydrate(), useConfigStore.persist.rehydrate(), useKBStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, tasks: {}, notes: {}, sprints: {}, folders: {}, comments: {}, legacyImported: true });
  useGraphStore.setState({ project: null, archivedProject: null, pendingSuggestions: null, parkedSuggestions: {}, drafts: {}, aiJobs: {}, objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT } });
  useKBStore.setState({ docs: {}, pickCache: {}, usage: {}, lastContext: null });
  useConfigStore.setState({ activeProvider: 'openrouter', providers: { openrouter: {
    apiKey: 'synthetic-test-key', mainModel: 'audit-main', kbModel: 'audit-research', researchModel: 'audit-research',
  } }, webResearchEnabled: false });
  useLocaleStore.setState({ locale: 'en' });
  transport.models = { 'audit-research': providerModel({ research: true }) };
  initializeWorkspace();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function managedPlan(patch: Partial<ConceptNodeData> = {}) {
  const projectId = useWorkspaceStore.getState().createProject('Servo investigation', 'Investigate a servo');
  openPlanner(projectId);
  const part: ConceptNodeData = { id: 'servo', parentId: 'root', order: 0, kind: 'passo', name: 'Test servo under load',
    fx: 'command → position', problem: '', confidence: 50, pros: [], cons: [], oQue: 'Test the selected servo.', porQue: 'Measure its behavior.',
    comoConfirmar: aiCriterion, confirmado: false, state: 'concept', notes: '', history: [], aiSuggested: false, position: { x: 0, y: 0 }, ...patch };
  const project: Project = { id: 'plan-servo', rootId: 'root', name: 'Servo investigation', objective: 'Investigate a servo',
    createdAt: 0, updatedAt: 0, archetype: 'construir', edges: {},
    nodes: { root: { ...part, id: 'root', parentId: null, kind: 'root' }, servo: part } };
  useGraphStore.setState({ project });
  useWorkspaceStore.getState().savePlanner(projectId, capturePlanner());
  return { projectId, part, project };
}

// Returning the full stored critique would bypass both the own-criterion lock
// and its undo window through chat, while the UI still hides the same result.
it.each(['no-own-criterion', 'undo-window', 'released'] as const)('projects the critique alternative for %s through the chat tool', async state => {
  const now = Date.now();
  const { projectId } = managedPlan(state === 'no-own-criterion' ? {} : {
    comoConfirmarUsuario: ownCriterion, comoConfirmarUsuarioAt: now - (state === 'released' ? CRITERION_UNLOCK_MS + 1000 : 1000),
  });
  transport.models['audit-main'] = providerModel({ generate: { fraquezas: ['Variant remains unknown.'], premissasOcultas: [], criterioAlternativo: alternateCriterion } });
  const tools = createAssistantTools(new AbortController().signal, () => {}, 'Critique the servo test');
  const result = await tools.planner_ai.execute!({ action: 'critique_node', projectId, nodeId: 'servo' }, { toolCallId: 'critique', messages: [] });
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true, result: { fraquezas: ['Variant remains unknown.'] } });
  expect(useGraphStore.getState().project?.nodes.servo.critica?.criterioAlternativo).toBe(alternateCriterion);
  if (state === 'released') expect(result).toMatchObject({ result: { criterioAlternativo: alternateCriterion } });
  else expect(JSON.stringify(result)).not.toContain(alternateCriterion);
});

// Selecting the new batch must carry the digest emitted by that batch. A
// missing progress callback or inherited digest contaminates the real prompt.
it.each([true, false])('expands the new chat batch with only its own research (enabled=%s)', async enabled => {
  const projectId = useWorkspaceStore.getState().createProject('Servo investigation', 'Investigate a servo'); openPlanner(projectId);
  useGraphStore.getState().setOutlines([], { objective: 'Investigate a battery', rules: [] }, staleResearch);
  useConfigStore.setState({ webResearchEnabled: enabled });
  const main = providerModel({ streams: [outlineReply, expansionReply] });
  transport.models['audit-main'] = main;
  transport.models['audit-research'] = providerModel({ research: true });
  const tools = createAssistantTools(new AbortController().signal, () => {}, 'Generate and use the current servo plan');
  expect(await tools.planner_ai.execute!({ action: 'generate_plans', projectId }, { toolCallId: 'generate', messages: [] })).toMatchObject({ ok: true });
  const draft = useGraphStore.getState().objectiveDraft;
  if (enabled) expect(draft.outlineResearch).toMatchObject({ findings: 'CURRENT-SERVO-DOCUMENTATION', sources: [{ url: 'https://current.example/servo', title: 'Current servo document' }] });
  else expect(draft.outlineResearch).toBeNull();
  expect(await tools.planner_ai.execute!({ action: 'select_plan', projectId, planId: draft.outlines![0].id }, { toolCallId: 'select', messages: [] })).toMatchObject({ ok: true });
  const expansionPrompt = JSON.stringify(main.doStreamCalls[1].prompt);
  expect(expansionPrompt).not.toContain('STALE-BATTERY-DOCUMENTATION');
  if (enabled) expect(expansionPrompt).toContain('CURRENT-SERVO-DOCUMENTATION');
  expect(Object.values(useGraphStore.getState().project!.nodes).some(node => node.name === 'Measure the servo')).toBe(true);
});

// A managed objective is the effective generation goal while the local draft
// is empty. Changing it must not expand a previously cached goal and digest.
it.each(['before selection', 'during expansion'])('rejects cached alternatives when the managed fallback objective changes %s', async when => {
  const projectId = useWorkspaceStore.getState().createProject('Investigation', 'Investigate a battery'); openPlanner(projectId);
  useGraphStore.getState().setObjectiveDraft({ objective: '' });
  const outline = { ...outlineReply.plans[0], id: 'old', strategy: 'hibrido' as const, archetype: 'construir' as const,
    estimates: { ...outlineReply.plans[0].estimates, dificuldade: 'iniciante' as const },
    outline: { categorias: [] } };
  useGraphStore.getState().setOutlines([outline], { objective: 'Investigate a battery', rules: [] }, staleResearch);
  const changeObjective = () => useWorkspaceStore.getState().updateProject(projectId, { objective: 'Investigate a servo' });
  if (when === 'before selection') changeObjective();
  transport.models['audit-main'] = providerModel({ streams: [expansionReply], onStream: when === 'during expansion' ? changeObjective : undefined });
  const tools = createAssistantTools(new AbortController().signal, () => {}, 'Use the selected plan for the current objective');
  expect(await tools.planner_ai.execute!({ action: 'select_plan', projectId, planId: 'old' }, { toolCallId: 'select-old', messages: [] })).toMatchObject({ ok: false, error: expect.stringMatching(/objective/i) });
  expect(useGraphStore.getState().project).toBeNull();
});

it('discards generated alternatives when their managed fallback objective changes while the model responds', async () => {
  const projectId = useWorkspaceStore.getState().createProject('Investigation', 'Investigate a battery'); openPlanner(projectId);
  useGraphStore.getState().setObjectiveDraft({ objective: '' });
  transport.models['audit-main'] = providerModel({ streams: [outlineReply], onStream: () => {
    useWorkspaceStore.getState().updateProject(projectId, { objective: 'Investigate a servo' });
  } });
  const tools = createAssistantTools(new AbortController().signal, () => {}, 'Generate current alternatives');
  expect(await tools.planner_ai.execute!({ action: 'generate_plans', projectId }, { toolCallId: 'generate-obsolete', messages: [] })).toMatchObject({ ok: false, error: expect.stringMatching(/objective/i) });
  expect(useGraphStore.getState().objectiveDraft.outlines).toBeNull();
  expect(useGraphStore.getState().objectiveDraft.outlineResearch).toBeNull();
});

// Dropping verified references or using the AI threshold in place of the
// user's threshold loses the evidence needed to discriminate possible causes.
it.each([true, false])('replans with independent criteria and reference provenance (AI released=%s)', async released => {
  const { part, project } = managedPlan({
    failureContext: 'The actuator stopped under load.', failureReportedAt: 500,
    comoConfirmarUsuario: ownCriterion, comoConfirmarUsuarioAt: Date.now() - (released ? CRITERION_UNLOCK_MS + 1000 : 1000),
    comoConfirmarAtendido: { observacao: 'Earlier unloaded test reached 90 degrees.', at: 400 },
    groundTruthRefs: [
      { id: 'supply', kind: 'medida', label: 'Loaded supply', value: '5.1 V', verificado: true, addedByAI: false,
        observacao: 'Measured supply at the servo terminals under load: 5.1 V.', addedAt: 100, verifiedAt: 300 },
      { id: 'manual', kind: 'link', label: 'Candidate manual', value: 'https://maker.example/servo', verificado: false, addedByAI: true, addedAt: 200 },
    ],
  });
  const main = providerModel({ generate: { diagnosis: 'Cause remains undetermined; measure the command signal under load.', nodes: [], edges: [] } });
  transport.models['audit-main'] = main;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    act(() => root.render(<FailureSection node={part} project={project} />));
    const button = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.includes('Replan knowing what failed'))!;
    expect(button).toBeDefined();
    await act(async () => { button.click(); });
    expect(main.doGenerateCalls.length, host.textContent ?? '').toBeGreaterThan(0);
    const prompt = JSON.stringify(main.doGenerateCalls[0].prompt);
    expect(prompt).toContain(ownCriterion);
    if (released) expect(prompt).toContain(aiCriterion); else expect(prompt).not.toContain(aiCriterion);
    expect(prompt).toContain('The actuator stopped under load.');
    expect(prompt).toContain('Earlier unloaded test reached 90 degrees.');
    expect(prompt).toContain('Measured supply at the servo terminals under load: 5.1 V.');
    expect(prompt).toContain('https://maker.example/servo');
    expect(prompt).toMatch(/user-added/);
    expect(prompt).toMatch(/AI-suggested/);
    expect(prompt).toMatch(/verification recorded/);
    expect(prompt).toMatch(/no verification recorded/);
    expect(prompt).toContain('verifiedAt');
    expect(host.textContent).toContain('Cause remains undetermined');
    expect(useGraphStore.getState().project?.nodes.servo.confirmado).toBe(false);
  } finally { act(() => root.unmount()); host.remove(); }
});

function objectiveUI() {
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  return {
    host, render: () => act(() => root.render(<ObjectiveScreen />)),
    button: (text: string) => Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes(text))!,
    close: () => { act(() => root.unmount()); host.remove(); },
  };
}
function savedObjective() {
  const outline = { id: 'saved', title: 'Old battery plan', pitch: '', approach: '', strategy: 'hibrido' as const,
    archetype: 'construir' as const, rank: 1, rankReason: '', planApproach: 'new_creation' as const, outline: { categorias: [] } };
  useGraphStore.setState({ objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT, objective: 'Investigate battery',
    rules: ['Keep original hardware'], planApproach: 'new_creation' } });
  return outline;
}

// The store clears old generation data immediately. A late UI callback must
// not restore it, even if the request still has the same files and intent.
it.each([
  { action: 'generate', field: 'objective' }, { action: 'generate', field: 'rules' },
  { action: 'more', field: 'objective' }, { action: 'more', field: 'rules' },
  { action: 'expand', field: 'objective' }, { action: 'expand', field: 'rules' },
] as const)('discards late UI $action results after $field changes', async ({ action, field }) => {
    const outline = savedObjective();
    if (action !== 'generate') useGraphStore.getState().setOutlines([outline], {
      objective: 'Investigate battery', rules: ['Keep original hardware'], planApproach: 'new_creation',
    }, staleResearch);
    let release!: () => void;
    const main = providerModel({ streams: [action === 'expand' ? expansionReply : outlineReply], streamGate: new Promise<void>(resolve => { release = resolve; }) });
    transport.models['audit-main'] = main;
    const ui = objectiveUI();
    try {
      ui.render();
      await act(async () => ui.button(action === 'generate' ? en.objective.generate : action === 'more' ? en.objective.morePlans : outline.title).click());
      await vi.waitFor(() => expect(main.doStreamCalls).toHaveLength(1));
      await act(async () => useGraphStore.getState().setObjectiveDraft(field === 'objective'
        ? { objective: 'Investigate servo' } : { rules: ['Use a documented servo variant'] }));
      expect(useGraphStore.getState().objectiveDraft.outlines).toBeNull();
      await act(async () => release());
      const draft = useGraphStore.getState().objectiveDraft;
      expect(draft.outlines).toBeNull();
      expect(draft.expanded).toEqual({});
      expect(draft.outlineResearch).toBeNull();
      expect(draft.expansion).toBeNull(); expect(draft.generatingSince).toBeNull();
      expect(useGraphStore.getState().project).toBeNull();
    } finally { release(); ui.close(); }
});

it('keeps speculative UI expansion valid when only the project name changes', async () => {
  const outline = savedObjective();
  useGraphStore.getState().setOutlines([outline], { objective: 'Investigate battery', rules: ['Keep original hardware'], planApproach: 'new_creation' }, staleResearch);
  let release!: () => void;
  const main = providerModel({ streams: [expansionReply], streamGate: new Promise<void>(resolve => { release = resolve; }) });
  transport.models['audit-main'] = main;
  const ui = objectiveUI();
  try {
    ui.render(); await act(async () => ui.button(outline.title).click());
    await vi.waitFor(() => expect(main.doStreamCalls).toHaveLength(1));
    await act(async () => useGraphStore.getState().setObjectiveDraft({ name: 'Renamed investigation' }));
    await act(async () => release());
    expect(useGraphStore.getState().objectiveDraft.expanded.saved?.tree.categorias[0].children[0].name).toBe('Measure the servo');
  } finally { release(); ui.close(); }
});

it('keeps existing alternatives when generating more commits a pending rule', async () => {
  const outline = savedObjective();
  useGraphStore.getState().setObjectiveDraft({ ruleDraft: 'Use a measured supply' });
  useGraphStore.getState().setOutlines([outline], { objective: 'Investigate battery', rules: ['Keep original hardware'], planApproach: 'new_creation' }, staleResearch);
  transport.models['audit-main'] = providerModel({ streams: [outlineReply] });
  const ui = objectiveUI();
  try {
    ui.render(); await act(async () => ui.button(en.objective.morePlans).click());
    await vi.waitFor(() => expect(useGraphStore.getState().objectiveDraft.generatingSince).toBeNull());
    const draft = useGraphStore.getState().objectiveDraft;
    expect(draft.plansFor?.rules).toEqual(['Keep original hardware', 'Use a measured supply']);
    expect(draft.outlines?.map(value => value.title)).toEqual(['Old battery plan', 'Current servo plan']);
    expect(draft.expanded).toEqual({});
  } finally { ui.close(); }
});
