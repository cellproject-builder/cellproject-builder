import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore } from './store';
import type { AIPlan, ConceptNodeData } from './types';

const minimalPlan: AIPlan = {
  id: 'p1',
  title: 'Plano teste',
  pitch: 'pitch',
  approach: 'approach',
  tree: {
    categorias: [
      {
        tempId: 'cat1',
        name: 'Execução',
        kind: 'execucao',
        oQue: 'oque',
        porQue: 'porque',
        children: [],
      },
    ],
  },
};

type StagedNode = Omit<ConceptNodeData, 'id' | 'parentId' | 'history'> & {
  tempId: string;
};

function makeSuggestionNode(tempId: string, name: string, order: number): StagedNode {
  return {
    tempId,
    kind: 'passo',
    name,
    fx: 'fx',
    problem: '',
    confidence: 80,
    confidenceSource: 'ai',
    confidenceReason: 'reason',
    pros: [],
    cons: [],
    oQue: 'oque',
    porQue: 'porque',
    comoConfirmar: 'check',
    confirmado: false,
    order,
    state: 'concept',
    notes: '',
    aiSuggested: true,
    position: { x: 0, y: 0 },
  };
}

function categoryId(): string {
  const project = useGraphStore.getState().project!;
  const cat = Object.values(project.nodes).find((n) => n.kind === 'categoria');
  if (!cat) throw new Error('categoria não criada');
  return cat.id;
}

function stageChain() {
  const catId = categoryId();
  useGraphStore.getState().stageSuggestions(
    catId,
    [
      makeSuggestionNode('a', 'passo 1', 0),
      makeSuggestionNode('b', 'passo 2', 1),
      makeSuggestionNode('c', 'passo 3', 2),
    ],
    [
      { sourceTempId: 'a', targetTempId: 'b', kind: 'direct' },
      { sourceTempId: 'b', targetTempId: 'c', kind: 'direct' },
    ],
  );
  return catId;
}

function chainEdges() {
  const project = useGraphStore.getState().project!;
  const passoIds = new Set(
    Object.values(project.nodes)
      .filter((n) => n.kind === 'passo')
      .map((n) => n.id),
  );
  return Object.values(project.edges)
    .filter((e) => passoIds.has(e.source) && passoIds.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }));
}

function passosOrdered() {
  const project = useGraphStore.getState().project!;
  return Object.values(project.nodes)
    .filter((n) => n.kind === 'passo')
    .sort((a, b) => a.order - b.order);
}

describe('staging suggestions — accept/reject preserves chain edges', () => {
  beforeEach(() => {
    useGraphStore.getState().resetProject();
    useGraphStore.getState().createProjectFromPlan('obj', 'Test', minimalPlan);
  });

  it('preserves chain edges when accepting in order (a, b, c)', () => {
    stageChain();
    const { acceptSuggestion } = useGraphStore.getState();
    acceptSuggestion('a');
    acceptSuggestion('b');
    acceptSuggestion('c');

    expect(useGraphStore.getState().pendingSuggestions).toBeNull();

    const passos = passosOrdered();
    expect(passos.map((p) => p.name)).toEqual(['passo 1', 'passo 2', 'passo 3']);

    const internal = chainEdges();
    expect(internal).toHaveLength(2);
    expect(internal).toEqual(
      expect.arrayContaining([
        { source: passos[0].id, target: passos[1].id },
        { source: passos[1].id, target: passos[2].id },
      ]),
    );
  });

  it('preserves chain edges when accepting out of order (b, c, a)', () => {
    stageChain();
    const { acceptSuggestion } = useGraphStore.getState();
    acceptSuggestion('b');
    acceptSuggestion('c');
    acceptSuggestion('a');

    expect(useGraphStore.getState().pendingSuggestions).toBeNull();

    const passos = passosOrdered();
    const internal = chainEdges();
    expect(internal).toHaveLength(2);
    expect(internal).toEqual(
      expect.arrayContaining([
        { source: passos[0].id, target: passos[1].id },
        { source: passos[1].id, target: passos[2].id },
      ]),
    );
  });

  it('rejecting middle node drops both orphan edges', () => {
    stageChain();
    const { acceptSuggestion, rejectSuggestion } = useGraphStore.getState();
    acceptSuggestion('a');
    rejectSuggestion('b');
    acceptSuggestion('c');

    expect(useGraphStore.getState().pendingSuggestions).toBeNull();
    const passos = passosOrdered();
    expect(passos.map((p) => p.name).sort()).toEqual(['passo 1', 'passo 3']);
    expect(chainEdges()).toHaveLength(0);
  });

  it('edge stays in staging while one endpoint is still pending', () => {
    stageChain();
    useGraphStore.getState().acceptSuggestion('a');

    expect(chainEdges()).toHaveLength(0);
    const pending = useGraphStore.getState().pendingSuggestions;
    expect(pending).not.toBeNull();
    expect(pending!.edges).toHaveLength(2); // a→b waits for b, b→c not touched
    expect(pending!.acceptedMap?.['a']).toBeDefined();
  });

  it('acceptAllSuggestions creates the full chain in one shot', () => {
    stageChain();
    useGraphStore.getState().acceptAllSuggestions();

    expect(useGraphStore.getState().pendingSuggestions).toBeNull();
    expect(chainEdges()).toHaveLength(2);
  });
});
