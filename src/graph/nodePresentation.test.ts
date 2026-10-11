import { describe, expect, it } from 'vitest';
import { canConcludeNode, isActionableKind, isBlocked, stepSequence } from '@/store';
import type { ConceptNodeData, Project } from '@/types';
import { nodePresentation } from './nodePresentation';

function fixture(specs: Array<Partial<ConceptNodeData> & Pick<ConceptNodeData, 'id' | 'parentId'>>): Project {
  const nodes = Object.fromEntries(specs.map(spec => [spec.id, {
    kind: spec.parentId ? 'passo' : 'root', name: spec.id, fx: '', problem: '', confidence: 50,
    pros: [], cons: [], oQue: '', porQue: '', comoConfirmar: '', confirmado: false, order: 0,
    state: 'concept', notes: '', history: [], aiSuggested: false, position: { x: 0, y: 0 }, ...spec,
  } as ConceptNodeData]));
  return { id: 'presentation', rootId: 'root', name: 'Synthetic', objective: '', archetype: 'construir', createdAt: 0, updatedAt: 0, nodes, edges: {} };
}

function matchesDomain(project: Project) {
  const result = nodePresentation(project);
  for (const node of Object.values(project.nodes)) {
    const childCount = Object.values(project.nodes).filter(child => child.parentId === node.id).length;
    const edgeCount = Object.values(project.edges).filter(edge => edge.source === node.id).length + Object.values(project.edges).filter(edge => edge.target === node.id).length;
    expect(result.get(node.id), node.id).toEqual({
      childCount, edgeCount, blocked: node.kind === 'passo' && isBlocked(project, node.id),
      stepNo: node.kind === 'passo' ? stepSequence(project, node.id) : null,
      canConclude: isActionableKind(node.kind) && !childCount && !node.confirmado && canConcludeNode(project, node.id).ready,
    });
  }
}

describe('canvas node presentation index', () => {
  it('keeps sibling execution order, subtree resolution and conclusion gates equal to the domain', () => {
    const project = fixture([
      { id: 'root', parentId: null },
      { id: 'branch', parentId: 'root', order: 0 },
      { id: 'known-child', parentId: 'branch', takenAsKnown: true },
      { id: 'later', parentId: 'root', order: 2, comoConfirmarAtendido: { at: 1, observacao: 'Synthetic' } },
      { id: 'middle', parentId: 'root', order: 1, confirmado: true },
      { id: 'resource', parentId: 'root', kind: 'recurso' },
      { id: 'unlocked', parentId: 'resource', comoConfirmarUsuarioAt: 1 },
      { id: 'blocked', parentId: 'resource', order: 1, comoConfirmarAtendido: { at: 1, observacao: 'Synthetic' } },
    ]);
    project.edges = { cross: { id: 'cross', source: 'resource', target: 'later', kind: 'direct' } };
    matchesDomain(project);
    expect(nodePresentation(project).get('later')).toMatchObject({ blocked: false, stepNo: 3, canConclude: true });
    expect(nodePresentation(project).get('blocked')).toMatchObject({ blocked: true, canConclude: false });
  });

  it('preserves creation-time and name tie breakers', () => {
    const project = fixture([
      { id: 'root', parentId: null },
      { id: 'second', parentId: 'root', name: 'B', history: [{ timestamp: 1 } as ConceptNodeData['history'][number]] },
      { id: 'first', parentId: 'root', name: 'A', history: [{ timestamp: 1 } as ConceptNodeData['history'][number]], confirmado: true },
      { id: 'third', parentId: 'root', history: [{ timestamp: 2 } as ConceptNodeData['history'][number]] },
    ]);
    matchesDomain(project);
    expect(nodePresentation(project).get('second')).toMatchObject({ stepNo: 2, blocked: false });
    expect(nodePresentation(project).get('third')).toMatchObject({ stepNo: 3, blocked: true });
  });

  it('retains failure and verified-reference checks rather than inferring confirmation', () => {
    const project = fixture([
      { id: 'root', parentId: null },
      { id: 'signal', parentId: 'root', kind: 'recurso', groundTruthRefs: [{ verificado: true, addedByAI: false } as NonNullable<ConceptNodeData['groundTruthRefs']>[number]] },
      { id: 'unverified-ai', parentId: 'root', kind: 'recurso', groundTruthRefs: [{ verificado: true, addedByAI: true, observacao: '' } as NonNullable<ConceptNodeData['groundTruthRefs']>[number]] },
      { id: 'failure', parentId: 'root', kind: 'recurso', failureContext: 'Synthetic failure', comoConfirmarAtendido: { at: 1, observacao: 'Synthetic' } },
    ]);
    matchesDomain(project);
    expect(nodePresentation(project).get('signal')?.canConclude).toBe(true);
    expect(nodePresentation(project).get('unverified-ai')?.canConclude).toBe(false);
    expect(nodePresentation(project).get('failure')?.canConclude).toBe(false);
  });

  it('handles disconnected cycles with the same blocking semantics, including known nodes', () => {
    const project = fixture([
      { id: 'root', parentId: null },
      { id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' },
      { id: 'next', parentId: 'b', order: 1 },
    ]);
    matchesDomain(project);
    const known = { ...project, nodes: { ...project.nodes, a: { ...project.nodes.a, takenAsKnown: true } } };
    matchesDomain(known);
  });

  it('reuses computed metadata across draft, geometry and selection updates and invalidates node or edge changes', () => {
    const project = fixture([{ id: 'root', parentId: null }, { id: 'first', parentId: 'root' }, { id: 'next', parentId: 'root', order: 1 }]);
    const before = JSON.stringify(project), result = nodePresentation(project);
    expect(nodePresentation({ ...project, updatedAt: 10 })).toBe(result);
    const changed = { ...project, nodes: { ...project.nodes, first: { ...project.nodes.first, confirmado: true } } };
    expect(nodePresentation(changed)).not.toBe(result);
    expect(nodePresentation(changed).get('next')?.blocked).toBe(false);
    const linked = { ...project, edges: { edge: { id: 'edge', source: 'first', target: 'next', kind: 'direct' as const } } };
    expect(nodePresentation(linked)).not.toBe(result);
    expect(nodePresentation(linked).get('next')?.edgeCount).toBe(1);
    expect(JSON.stringify(project)).toBe(before);
  });

  it('resolves deep chains iteratively instead of overflowing the JavaScript stack', () => {
    const project = fixture(Array.from({ length: 12000 }, (_, index) => ({ id: index ? `n${index}` : 'root', parentId: index ? index === 1 ? 'root' : `n${index - 1}` : null, confirmado: true })));
    expect(nodePresentation(project).size).toBe(12000);
    expect(nodePresentation(project).get('n11999')?.blocked).toBe(false);
  });
});
