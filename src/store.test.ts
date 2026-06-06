import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore, projectProgress } from './store';
import type { AIPlan, ConceptNodeData } from './types';

const minimalPlan: AIPlan = {
  id: 'p1',
  title: 'Plano teste',
  pitch: 'pitch',
  approach: 'approach',
  strategy: 'reaproveitar',
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

describe('confirmNode — guarded conclusion (E2 fidelity gate)', () => {
  beforeEach(() => {
    useGraphStore.getState().resetProject();
    useGraphStore.getState().createProjectFromPlan('obj', 'Test', minimalPlan);
  });

  // Single first passo: not blocked, no signal yet.
  function singlePasso(): string {
    const catId = categoryId();
    useGraphStore
      .getState()
      .stageSuggestions(catId, [makeSuggestionNode('a', 'passo 1', 0)], []);
    useGraphStore.getState().acceptSuggestion('a');
    return passosOrdered()[0].id;
  }

  function node(id: string): ConceptNodeData {
    return useGraphStore.getState().project!.nodes[id];
  }

  // This is the live H2 regression: a node MUST NOT reach 'done' on a bare
  // confirm with no locked criterion and no verified anchor.
  it('confirm WITHOUT signal advances but does NOT reach state done', () => {
    const id = singlePasso();
    useGraphStore.getState().confirmNode(id);
    const n = node(id);
    expect(n.confirmado).toBe(true); // flow advances — never a hard block
    expect(n.state).not.toBe('done');
    expect(n.state).toBe('validated');
    expect(n.confirmedWithoutSignal).toBe(true);
  });

  it('confirm WITH a locked user criterion (attack a) reaches state done', () => {
    const id = singlePasso();
    useGraphStore.getState().setUserCriterion(id, 'meu critério independente');
    useGraphStore.getState().confirmNode(id);
    const n = node(id);
    expect(n.state).toBe('done');
    expect(n.confirmedWithoutSignal).toBe(false);
  });

  it('confirm WITH a verified anchor (attack d) reaches state done', () => {
    const id = singlePasso();
    useGraphStore.getState().addGroundTruthRef(id, {
      kind: 'medida',
      label: 'massa',
      value: '178g',
      verificado: false,
      addedByAI: false,
    });
    const refId = node(id).groundTruthRefs![0].id;
    useGraphStore.getState().toggleGroundTruthVerified(id, refId);
    useGraphStore.getState().confirmNode(id);
    expect(node(id).state).toBe('done');
  });

  it('force:true concludes without signal (explicit opt-out)', () => {
    const id = singlePasso();
    useGraphStore.getState().confirmNode(id, { force: true });
    const n = node(id);
    expect(n.state).toBe('done');
    expect(n.confirmedWithoutSignal).toBe(false);
  });

  it('unconfirmNode clears the without-signal flag', () => {
    const id = singlePasso();
    useGraphStore.getState().confirmNode(id);
    expect(node(id).confirmedWithoutSignal).toBe(true);
    useGraphStore.getState().unconfirmNode(id);
    const n = node(id);
    expect(n.confirmado).toBe(false);
    expect(n.confirmedWithoutSignal).toBe(false);
  });

  function stageDecisao(): string {
    const catId = categoryId();
    const dec: StagedNode = {
      tempId: 'd',
      kind: 'decisao',
      name: 'qual material',
      fx: 'fx',
      problem: '',
      confidence: 70,
      confidenceSource: 'ai',
      confidenceReason: 'r',
      pros: [],
      cons: [],
      oQue: 'o',
      porQue: 'p',
      comoConfirmar: 'c',
      confirmado: false,
      order: 0,
      decisionOptions: [
        { id: 'opt1', label: 'A', pitch: 'a' },
        { id: 'opt2', label: 'B', pitch: 'b' },
      ],
      state: 'concept',
      notes: '',
      aiSuggested: true,
      position: { x: 0, y: 0 },
    };
    useGraphStore.getState().stageSuggestions(catId, [dec], []);
    useGraphStore.getState().acceptSuggestion('d');
    return Object.values(useGraphStore.getState().project!.nodes).find(
      (n) => n.kind === 'decisao',
    )!.id;
  }

  it('pickDecisionOption WITHOUT signal records the pick but does NOT reach done', () => {
    const id = stageDecisao();
    useGraphStore.getState().pickDecisionOption(id, 'opt1');
    const n = node(id);
    expect(n.confirmado).toBe(true);
    expect(n.decisionPickedId).toBe('opt1');
    expect(n.state).toBe('validated');
    expect(n.confirmedWithoutSignal).toBe(true);
  });

  it('pickDecisionOption WITH a locked criterion reaches done', () => {
    const id = stageDecisao();
    useGraphStore.getState().setUserCriterion(id, 'porque medi a carga');
    useGraphStore.getState().pickDecisionOption(id, 'opt2');
    expect(node(id).state).toBe('done');
  });

  it('projectProgress counts a decisao as a leaf', () => {
    const id = stageDecisao();
    const before = projectProgress(useGraphStore.getState().project);
    expect(before.total).toBe(1); // the decisao is the only leaf
    expect(before.done).toBe(0);
    useGraphStore.getState().pickDecisionOption(id, 'opt1');
    expect(projectProgress(useGraphStore.getState().project).done).toBe(1);
  });
});
