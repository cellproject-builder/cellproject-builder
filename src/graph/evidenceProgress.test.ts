import { describe, expect, it } from 'vitest';
import { projectEvidenceProgress } from '@/store';
import type { ConceptNodeData, Project } from '@/types';

const part = (id: string, patch: Partial<ConceptNodeData> = {}): ConceptNodeData => ({
  id, parentId: 'root', kind: 'concept', name: id, fx: '', problem: '',
  confidence: 50, confidenceReason: '', pros: [], cons: [], oQue: '', porQue: '',
  comoConfirmar: '', confirmado: false, order: 0, state: 'concept', notes: '',
  history: [], aiSuggested: false, position: { x: 0, y: 0 }, ...patch,
});
const project = (parts: ConceptNodeData[]): Project => ({
  id: 'p', rootId: 'root', name: 'Understand', objective: 'Understand a motor',
  archetype: 'entender', createdAt: 0, updatedAt: 0, edges: {},
  nodes: Object.fromEntries([part('root', { parentId: null, kind: 'root' }), ...parts].map((node) => [node.id, node])),
});

describe('evidence displayed alongside plan progress', () => {
  it('keeps declared knowledge separate from recorded verification', () => {
    const plan = project([
      part('known', { takenAsKnown: true }),
      part('confirmed', { confirmado: true, confirmedWithoutSignal: true }),
      part('checked', { confirmado: true, comoConfirmarAtendido: { observacao: 'Explained and tested', at: 1 } }),
    ]);
    expect(projectEvidenceProgress(plan)).toEqual({ withEvidence: 1, assumedKnown: 1 });
  });

  it('counts checked sources only after resolution and excludes failed parts', () => {
    const ref = { id: 'ref', kind: 'link' as const, label: 'Source', value: 'https://example.com', verificado: true, addedAt: 0, addedByAI: true };
    const plan = project([
      part('unchecked-ai-source', { confirmado: true, groundTruthRefs: [ref] }),
      part('checked-ai-source', { confirmado: true, groundTruthRefs: [{ ...ref, observacao: 'Checked the mechanism' }] }),
      part('pending', { groundTruthRefs: [{ ...ref, addedByAI: false }] }),
      part('failed', { confirmado: true, failureContext: 'Experiment failed', groundTruthRefs: [{ ...ref, addedByAI: false }] }),
    ]);
    expect(projectEvidenceProgress(plan)).toEqual({ withEvidence: 1, assumedKnown: 0 });
  });

  it('counts only the current decomposition frontier, including declared floors', () => {
    const plan = project([
      part('parent', { confirmado: true, comoConfirmarAtendido: { observacao: 'Old observation', at: 1 } }),
      part('child', { parentId: 'parent' }),
      part('floor', { takenAsKnown: true }),
      part('hidden-child', { parentId: 'floor', confirmado: true, comoConfirmarAtendido: { observacao: 'Hidden', at: 1 } }),
    ]);
    expect(projectEvidenceProgress(plan)).toEqual({ withEvidence: 0, assumedKnown: 1 });
    expect(projectEvidenceProgress(null)).toEqual({ withEvidence: 0, assumedKnown: 0 });
  });
});
