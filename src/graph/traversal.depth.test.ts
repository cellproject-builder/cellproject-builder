import { expect, it } from 'vitest';
import { effectiveLeavesUnder, isNodeResolved, nextPendingForTutor, projectEvidenceProgress, projectProgress, type PendingSuggestions } from '@/store';
import type { ConceptNodeData, Project } from '@/types';

const node = (id: string, parentId: string | null, patch: Partial<ConceptNodeData> = {}): ConceptNodeData => ({
  id, parentId, order: 0, kind: parentId ? 'passo' : 'root', name: id,
  fx: '', problem: '', confidence: 50, pros: [], cons: [], oQue: '', porQue: '',
  comoConfirmar: '', confirmado: false, state: 'concept', notes: '', history: [],
  aiSuggested: false, position: { x: 0, y: 0 }, ...patch,
});
const project = (nodes: ConceptNodeData[]): Project => ({
  id: 'traversal-depth', rootId: 'root', name: 'Synthetic tree', objective: 'Test traversal',
  archetype: 'construir', createdAt: 0, updatedAt: 0, edges: {},
  nodes: Object.fromEntries(nodes.map(item => [item.id, item])),
});
const chain = (): Project => {
  const nodes = [node('root', null)];
  for (let index = 1; index < 12000; index++) nodes.push(node(`n${index}`, index === 1 ? 'root' : `n${index - 1}`));
  return project(nodes);
};

it('finds the effective frontier of a 12000-node chain without recursive calls', () => {
  const plan = chain();
  expect(effectiveLeavesUnder(plan, plan.rootId).map(item => item.id)).toEqual(['n11999']);
});
it('computes progress on the deep frontier', () => {
  expect(projectProgress(chain())).toEqual({ total: 1, done: 0, doneWithSignal: 0, doneWithoutSignal: 0, percent: 0 });
});
it('computes evidence on the deep frontier', () => {
  const plan = chain(); plan.nodes.n11999.confirmado = true;
  plan.nodes.n11999.comoConfirmarAtendido = { observacao: 'Synthetic verified result', at: 1 };
  expect(projectEvidenceProgress(plan)).toEqual({ withEvidence: 1, assumedKnown: 0 });
});
it('resolves a deep chain only when its terminal part is resolved', () => {
  const plan = chain(); plan.nodes.n11999.confirmado = true;
  expect(isNodeResolved(plan, plan.rootId)).toBe(true);
  plan.nodes.n11999.confirmado = false;
  expect(isNodeResolved(plan, plan.rootId)).toBe(false);
});
it('finds the next deep actionable part without recursive calls', () => {
  expect(nextPendingForTutor(chain())?.id).toBe('n11999');
});

it('preserves depth-first staging, reviewing parents and declared knowledge floors', () => {
  const plan = project([
    node('root', null), node('parent', 'root'), node('closed', 'parent', { confirmado: true }),
    node('structure', 'parent', { kind: 'categoria', order: 1 }),
    node('floor', 'root', { order: 1, takenAsKnown: true }), node('hidden', 'floor'),
    node('later', 'root', { order: 2 }),
  ]);
  const pending: Pick<PendingSuggestions, 'parentId' | 'nodes'> = {
    parentId: 'parent', nodes: [
      { tempId: 'new-part', data: { ...node('unused', null, { kind: 'passo' }), tempId: 'new-part' } },
      { tempId: 'new-structure', data: { ...node('unused-structure', null, { kind: 'categoria' }), tempId: 'new-structure' } },
    ],
  };
  expect(effectiveLeavesUnder(plan, 'root', undefined, pending, new Set(['parent'])).map(item => item.id)).toEqual(['pending:parent', 'closed', 'pending:new-part', 'floor', 'later']);
  expect(nextPendingForTutor(plan, pending)?.id).toBe('parent');
  expect(nextPendingForTutor(plan, undefined, new Set(['parent']))?.id).toBe('parent');
  expect(nextPendingForTutor(plan)?.id).toBe('later');
  expect(isNodeResolved(plan, 'floor')).toBe(true);
  expect(effectiveLeavesUnder(plan, 'parent', undefined, pending, new Set(['parent'])).map(item => item.id)).toEqual(['pending:parent', 'closed', 'pending:new-part']);
  expect(effectiveLeavesUnder(plan, 'root', undefined, { ...pending, parentId: 'root' }).map(item => item.id)).toEqual(['closed', 'floor', 'later', 'pending:new-part']);
});

it('does not report malformed cycles as resolved or finished', () => {
  const plan = project([node('root', 'b'), node('a', 'root', { confirmado: true }), node('b', 'a', { confirmado: true })]);
  expect(isNodeResolved(plan, 'root')).toBe(false);
  expect(() => effectiveLeavesUnder(plan, 'root')).toThrow(/ciclo/i);
  expect(() => nextPendingForTutor(plan)).toThrow(/ciclo/i);
});
it('keeps a declared knowledge floor closed without visiting descendants beneath it', () => {
  const plan = project([node('root', 'b'), node('a', 'root', { takenAsKnown: true }), node('b', 'a')]);
  expect(isNodeResolved(plan, 'root')).toBe(true);
  expect(effectiveLeavesUnder(plan, 'root').map(item => item.id)).toEqual(['a']);
  expect(nextPendingForTutor(plan)).toBeNull();
});
