import { beforeEach, describe, expect, it } from 'vitest';
import { canConcludeNode, isBlocked, isNodeResolved, nextPendingForTutor, parseImportedProject, projectProgress, useGraphStore } from './store';
import { nodePresentation } from './graph/nodePresentation';
import { prepareVisualPlanImport } from './visuals/portable';
import type { AIPlan, AIPlanOutline, ConceptNodeData, WebResearchDigest } from './types';

const plan: AIPlan = { id: 'audit-plan', title: 'Plan', pitch: '', approach: '', strategy: 'hibrido', archetype: 'construir', rank: 1, rankReason: '', tree: { categorias: [{ tempId: 'cat', name: 'Execution', kind: 'execucao', oQue: '', porQue: '', children: [] }] } };
const st = () => useGraphStore.getState();
const node = (name: string) => Object.values(st().project!.nodes).find(item => item.name === name)!;
const stage = (tempId: string, name: string, order = 0): Omit<ConceptNodeData, 'id' | 'parentId' | 'history'> & { tempId: string } => ({ tempId, kind: 'passo', name, fx: '', problem: '', confidence: 50, pros: [], cons: [], oQue: '', porQue: '', comoConfirmar: '', confirmado: false, order, state: 'concept', notes: '', aiSuggested: true, position: { x: 0, y: 0 } });
const addSteps = () => { st().stageSuggestions(node('Execution').id, [stage('a', 'A'), stage('b', 'B', 1)], []); st().acceptAllSuggestions(); };

beforeEach(() => {
  useGraphStore.setState({ project: null, archivedProject: null, archivedPending: null, replacedArchive: null });
  st().createProjectFromPlan('Objective', 'Audit', plan);
});

describe('planning generation context', () => {
  const outline: AIPlanOutline = { id: 'outline', title: 'Outline', pitch: '', approach: '', strategy: 'hibrido', archetype: 'construir', rank: 1, rankReason: '', outline: { categorias: [{ name: 'Execution', kind: 'execucao', nodes: [{ name: 'A', kind: 'passo' }] }] } };
  const research: WebResearchDigest = { query: 'Battery', findings: 'Battery-only research', sources: [], searchedAt: 1 };
  const prepare = () => {
    st().clearObjectiveDraft();
    st().setObjectiveDraft({ objective: 'Servo objective', rules: ['Use MG90S'], planApproach: 'new_creation' });
    st().setOutlines([outline], { objective: 'Servo objective', rules: ['Use MG90S'], planApproach: 'new_creation', attachmentsFingerprint: 'old-file' }, research);
    st().setExpandedPlan(outline.id, plan);
    st().setExpansion(outline.id);
    st().setObjectiveDraft({ selectedId: outline.id, plans: [plan] });
  };

  it.each([{ objective: 'Different objective' }, { rules: ['Use another servo'] }, { planApproach: 'reverse_engineering' as const }, { referenceTarget: 'Existing measured bracket' }])('invalidates research and expanded plans after context change %j', partial => {
    prepare();
    st().setObjectiveDraft(partial);
    expect(st().objectiveDraft).toMatchObject({ outlines: null, plans: null, outlineResearch: null, expanded: {}, expansion: null, plansFor: null, selectedId: null });
    expect(st().objectiveDraft.expanded).toEqual({});
  });

  it('clears a previous digest when a new outline batch has no research', () => {
    prepare();
    st().setOutlines([{ ...outline, id: 'new-outline' }]);
    expect(st().objectiveDraft.outlineResearch).toBeNull();
  });

  it('invalidates retained outline caches when attachment context changes', () => {
    prepare();
    st().setOutlines([outline], { objective: 'Servo objective', rules: ['Use MG90S'], planApproach: 'new_creation', attachmentsFingerprint: 'new-file' }, research);
    expect(st().objectiveDraft.expanded).toEqual({});
    expect(st().objectiveDraft.expansion).toBeNull();
  });

  it('retains research and cached trees for title edits and a merged batch in the same context', () => {
    prepare();
    st().setObjectiveDraft({ name: 'Renamed project', ruleDraft: 'Unsubmitted rule' });
    st().setOutlines([outline, { ...outline, id: 'additional-outline' }], { objective: 'Servo objective', rules: ['Use MG90S'], planApproach: 'new_creation', attachmentsFingerprint: 'old-file' }, research);
    expect(st().objectiveDraft.expanded.outline?.id).toBe('outline');
    expect(st().objectiveDraft.outlineResearch).toEqual(research);
  });
});

describe('open failure precedence', () => {
  it('reopens a known step for resolution, progress, tutor and subsequent-step presentation', () => {
    addSteps();
    st().toggleTakenAsKnown(node('A').id);
    st().reportFailure(node('A').id, 'The actual test failed');
    expect(node('A').takenAsKnown).toBe(false);
    expect(canConcludeNode(st().project, node('A').id).missingKeys).toContain('openFailure');
    expect(isNodeResolved(st().project!, node('A').id)).toBe(false);
    expect(isBlocked(st().project, node('B').id)).toBe(true);
    expect(projectProgress(st().project).done).toBe(0);
    expect(nextPendingForTutor(st().project)?.name).toBe('A');
    expect(nodePresentation(st().project!).get(node('B').id)?.blocked).toBe(true);
  });

  it('keeps a failed parent pending after all its children were resolved', () => {
    addSteps();
    st().stageSuggestions(node('A').id, [stage('a1', 'A1')], []);
    st().acceptAllSuggestions();
    st().toggleTakenAsKnown(node('A1').id);
    st().toggleTakenAsKnown(node('B').id);
    st().reportFailure(node('A').id, 'The assembled result failed');
    expect(isNodeResolved(st().project!, node('A').id)).toBe(false);
    expect(projectProgress(st().project).percent).toBeLessThan(100);
    expect(nextPendingForTutor(st().project)?.name).toBe('A');
    expect(isBlocked(st().project, node('B').id)).toBe(true);
    expect(nodePresentation(st().project!).get(node('B').id)?.blocked).toBe(true);
  });

  it('also rejects legacy known and confirmed flags on an open failure', () => {
    addSteps();
    const current = st().project!;
    useGraphStore.setState({ project: { ...current, nodes: { ...current.nodes, [node('A').id]: { ...node('A'), takenAsKnown: true, confirmado: true, failureContext: 'Legacy failure' } } } });
    expect(isNodeResolved(st().project!, node('A').id)).toBe(false);
    expect(projectProgress(st().project).done).toBe(0);
    expect(nextPendingForTutor(st().project)?.name).toBe('A');
    expect(nodePresentation(st().project!).get(node('B').id)?.blocked).toBe(true);
  });

  it.each(['root', 'category'] as const)('keeps an open failure on the %s visible even when every step is resolved', kind => {
    addSteps();
    st().toggleTakenAsKnown(node('A').id);
    st().toggleTakenAsKnown(node('B').id);
    const id = kind === 'root' ? st().project!.rootId : node('Execution').id;
    st().reportFailure(id, 'The complete result failed');
    expect(projectProgress(st().project).percent).toBeLessThan(100);
    expect(nextPendingForTutor(st().project)?.id).toBe(id);
  });
});

describe('complete archived domain session', () => {
  it('restores parked and active suggestions and node drafts while preserving the older archive', () => {
    const older = st().project!;
    st().resetProject();
    st().createProjectFromPlan('New objective', 'Current', plan);
    addSteps();
    const current = st().project!;
    st().stageSuggestions(node('A').id, [stage('a1', 'A1')], []);
    st().stageSuggestions(node('B').id, [stage('b1', 'B1')], []);
    st().setDraft(node('A').id, 'criterion', 'Lift 100 g for 30 seconds');
    const pending = st().pendingSuggestions, parked = st().parkedSuggestions, drafts = st().drafts;
    st().resetProject();
    expect(st().undoReset()).toBe(true);
    expect(st().project?.id).toBe(current.id);
    expect(st().pendingSuggestions).toEqual(pending);
    expect(st().parkedSuggestions).toEqual(parked);
    expect(st().drafts).toEqual(drafts);
    expect(st().archivedProject?.id).toBe(older.id);
  });

  it('swaps session drafts and parked batches with the current project when undoing an import', () => {
    addSteps();
    const first = st().project!;
    st().stageSuggestions(node('A').id, [stage('a1', 'A1')], []);
    st().stageSuggestions(node('B').id, [stage('b1', 'B1')], []);
    st().setDraft(node('A').id, 'failure', 'First unfinished report');
    const firstDrafts = st().drafts, firstParked = st().parkedSuggestions;
    expect(st().importProject({ ...first, id: 'second-project' })).toEqual({ ok: true });
    st().setDraft(node('B').id, 'criterion', 'Second unfinished criterion');
    const secondDrafts = st().drafts;
    expect(st().undoReset()).toBe(true);
    expect(st().drafts).toEqual(firstDrafts);
    expect(st().parkedSuggestions).toEqual(firstParked);
    expect(st().undoReset()).toBe(true);
    expect(st().project?.id).toBe('second-project');
    expect(st().drafts).toEqual(secondDrafts);
  });
});

it.each([{ notes: 'Saved after confirmation' }, { problem: 'A newly recorded constraint' }])('preserves subsequent saved node edits when undoing a confirmation: %j', patch => {
  addSteps();
  const id = node('A').id;
  st().confirmNode(id);
  st().updateNode(id, patch, { commit: true });
  expect(st().undoLastAction()).toBe(true);
  expect(st().project!.nodes[id]).toMatchObject(patch);
  expect(st().project!.nodes[id].confirmado).toBe(false);
});

it.each(['all', 'individual', 'mixed'] as const)('materializes the same suggested topology using %s acceptance', mode => {
  st().stageSuggestions(node('Execution').id, [stage('a', 'A'), stage('b', 'B', 1)], [{ sourceTempId: 'a', targetTempId: 'b', kind: 'direct' }]);
  if (mode !== 'all') st().acceptSuggestion('a');
  if (mode === 'individual') st().acceptSuggestion('b'); else st().acceptAllSuggestions();
  const p = st().project!;
  const connections = Object.values(p.edges).map(edge => [p.nodes[edge.source].name, p.nodes[edge.target].name]).sort();
  expect(connections).toEqual([['A', 'B'], ['Audit', 'Execution'], ['Execution', 'A'], ['Execution', 'B']]);
});

it.each([false, true])('removes deleted accepted endpoints from %s parked staged batches', parked => {
  st().stageSuggestions(node('Execution').id, [stage('a', 'A'), stage('b', 'B', 1)], [{ sourceTempId: 'a', targetTempId: 'b', kind: 'direct' }]);
  st().acceptSuggestion('a');
  const removedId = node('A').id;
  if (parked) st().stageSuggestions(st().project!.rootId, [stage('x', 'Other')], []);
  st().deleteNode(removedId);
  if (parked) st().resumeSuggestions(node('Execution').id);
  expect(st().pendingSuggestions?.acceptedMap?.a).toBeUndefined();
  expect(st().pendingSuggestions?.edges).toEqual([]);
  st().acceptSuggestion('b');
  expect(Object.values(st().project!.edges).every(edge => st().project!.nodes[edge.source] && st().project!.nodes[edge.target])).toBe(true);
});

it.each(['individual', 'all'] as const)('validates legacy staged endpoints during %s acceptance', mode => {
  st().stageSuggestions(node('Execution').id, [stage('b', 'B')], [{ sourceTempId: 'a', targetTempId: 'b', kind: 'direct' }]);
  useGraphStore.setState({ pendingSuggestions: { ...st().pendingSuggestions!, acceptedMap: { a: 'deleted-node' } } });
  if (mode === 'individual') st().acceptSuggestion('b'); else st().acceptAllSuggestions();
  expect(Object.values(st().project!.edges).every(edge => st().project!.nodes[edge.source] && st().project!.nodes[edge.target])).toBe(true);
});

it('rejects disconnected parent cycles through public preparation and direct import without replacing the editor', async () => {
  addSteps();
  const before = st().project!, broken = structuredClone(before);
  broken.nodes[node('A').id].parentId = node('B').id;
  broken.nodes[node('B').id].parentId = node('A').id;
  expect(parseImportedProject(broken)).toBeNull();
  await expect(prepareVisualPlanImport(broken)).rejects.toThrow(/ciclo|cycle/i);
  expect(st().importProject(broken)).toMatchObject({ ok: false, error: expect.stringMatching(/ciclo|cycle/i) });
  expect(st().project).toBe(before);
});

it.each([null, 'missing-parent'])('rejects a disconnected imported node with parent %j without silently reparenting it', async parentId => {
  addSteps();
  const before = st().project!, broken = structuredClone(before);
  broken.nodes[node('A').id].parentId = parentId;
  await expect(prepareVisualPlanImport(broken)).rejects.toThrow(/desconect|disconnect/i);
  expect(st().importProject(broken)).toMatchObject({ ok: false, error: expect.stringMatching(/desconect|disconnect/i) });
  expect(st().project).toBe(before);
});

it('deletes legacy cyclic descendants safely and removes their incident edges', () => {
  addSteps();
  const broken = structuredClone(st().project!);
  broken.nodes[node('A').id].parentId = node('B').id;
  broken.nodes[node('B').id].parentId = node('A').id;
  const a = node('A').id, b = node('B').id;
  useGraphStore.setState({ project: broken });
  expect(() => st().deleteNode(a)).not.toThrow();
  expect(st().project!.nodes[a]).toBeUndefined();
  expect(st().project!.nodes[b]).toBeUndefined();
  expect(Object.values(st().project!.edges).every(edge => st().project!.nodes[edge.source] && st().project!.nodes[edge.target])).toBe(true);
});
