import { describe, it, expect, beforeEach } from 'vitest';
import {
  useGraphStore,
  projectProgress,
  nextPendingForTutor,
  isBlocked,
  computeTreeLayout,
} from './store';
import type { AIPlan, ConceptNodeData } from './types';

const minimalPlan: AIPlan = {
  id: 'p1',
  title: 'Plano teste',
  pitch: 'pitch',
  approach: 'approach',
  strategy: 'reaproveitar',
  archetype: 'construir',
  rank: 1,
  rankReason: 'simples',
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

  it('a locked criterion ALONE does not earn done — it must be attested met', () => {
    const id = singlePasso();
    useGraphStore.getState().setUserCriterion(id, 'meu critério');
    useGraphStore.getState().confirmNode(id);
    // Reality must confirm: a written-but-unmet criterion is not enough.
    expect(node(id).state).toBe('validated');
  });

  it('a criterion attested MET (attack a) reaches state done', () => {
    const id = singlePasso();
    useGraphStore.getState().setUserCriterion(id, 'meu critério');
    useGraphStore.getState().attestCriterion(id, 'medi e atende');
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

  // Process != confirmation: a bare critique or failure-report must NOT earn
  // 'done' (that would reward engaging a mechanism, not reality confirming it).
  it('a critique alone does NOT earn done', () => {
    const id = singlePasso();
    useGraphStore.getState().setCritica(id, {
      fraquezas: ['premissa frágil'],
      premissasOcultas: [],
      criterioAlternativo: 'meça y de forma externa',
      generatedAt: 1,
    });
    useGraphStore.getState().confirmNode(id);
    expect(node(id).state).toBe('validated');
  });

  it('a reported failure alone does NOT earn done', () => {
    const id = singlePasso();
    useGraphStore.getState().reportFailure(id, 'quebrou na prática');
    useGraphStore.getState().confirmNode(id);
    expect(node(id).state).not.toBe('done');
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

  it('pickDecisionOption WITH an attested criterion reaches done', () => {
    const id = stageDecisao();
    useGraphStore.getState().setUserCriterion(id, 'porque medi a carga');
    useGraphStore.getState().attestCriterion(id, 'a carga bate');
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

describe('understand archetype — concept counts as a progress leaf', () => {
  beforeEach(() => {
    useGraphStore.getState().resetProject();
    useGraphStore.getState().createProjectFromPlan('obj', 'U', {
      ...minimalPlan,
      archetype: 'entender',
    });
  });

  function stageConcept(name: string): string {
    const catId = categoryId();
    const concept: StagedNode = { ...makeSuggestionNode('c', name, 0), kind: 'concept' };
    useGraphStore.getState().stageSuggestions(catId, [concept], []);
    useGraphStore.getState().acceptSuggestion('c');
    return Object.values(useGraphStore.getState().project!.nodes).find(
      (n) => n.kind === 'concept',
    )!.id;
  }

  it('a terminal concept counts in progress and resolves via takenAsKnown', () => {
    const id = stageConcept('um conceito');
    let p = projectProgress(useGraphStore.getState().project);
    expect(p.total).toBe(1); // concept is a leaf in an understand project
    expect(p.done).toBe(0);
    useGraphStore.getState().toggleTakenAsKnown(id);
    p = projectProgress(useGraphStore.getState().project);
    expect(p.done).toBe(1);
    expect(useGraphStore.getState().project!.nodes[id].takenAsKnown).toBe(true);
  });

  // A concept the AI produced in a BUILD project is still a part the user must
  // resolve. Hiding it let the tutor declare "done" with work pending.
  it('a concept counts as a leaf in a build project too (no invisible pending work)', () => {
    useGraphStore.getState().resetProject();
    useGraphStore.getState().createProjectFromPlan('obj', 'B', minimalPlan); // construir
    stageConcept('auxiliar');
    expect(projectProgress(useGraphStore.getState().project).total).toBe(1);
    expect(nextPendingForTutor(useGraphStore.getState().project)?.name).toBe('auxiliar');
  });
});

describe('tree-faithful selectors — the tutor follows the decomposition', () => {
  beforeEach(() => {
    useGraphStore.getState().resetProject();
    useGraphStore.getState().createProjectFromPlan('obj', 'Tree', minimalPlan);
    stageChain();
    useGraphStore.getState().acceptAllSuggestions();
  });

  function decomposeFirstPasso(children: StagedNode[]) {
    const [p1] = passosOrdered();
    useGraphStore.getState().stageSuggestions(p1.id, children, []);
    useGraphStore.getState().acceptAllSuggestions();
    return p1;
  }

  it('walks depth-first: children of a decomposed step come before the next step', () => {
    decomposeFirstPasso([
      makeSuggestionNode('s1', 'sub 1', 0),
      makeSuggestionNode('s2', 'sub 2', 1),
    ]);
    // Down to the atom: the decomposition of passo 1 comes before passo 2.
    expect(nextPendingForTutor(useGraphStore.getState().project)?.name).toBe('sub 1');
  });

  it('a decomposed step unblocks its next sibling once all sub-steps are resolved', () => {
    decomposeFirstPasso([makeSuggestionNode('s1', 'sub 1', 0)]);
    const project = () => useGraphStore.getState().project;
    const p2 = passosOrdered().find((p) => p.name === 'passo 2')!;
    expect(isBlocked(project(), p2.id)).toBe(true);
    const sub = Object.values(project()!.nodes).find((n) => n.name === 'sub 1')!;
    useGraphStore.getState().confirmNode(sub.id);
    // passo 1 was never confirmed directly, but every child is resolved →
    // resolved through its decomposition → passo 2 is free.
    expect(isBlocked(project(), p2.id)).toBe(false);
  });

  it('takenAsKnown on a decomposed node closes the whole subtree (recursion floor)', () => {
    const p1 = decomposeFirstPasso([makeSuggestionNode('s1', 'sub 1', 0)]);
    let progress = projectProgress(useGraphStore.getState().project);
    expect(progress.total).toBe(3); // sub 1 + passo 2 + passo 3 (passo 1 is a container)
    useGraphStore.getState().toggleTakenAsKnown(p1.id);
    progress = projectProgress(useGraphStore.getState().project);
    expect(progress.total).toBe(3); // the floor itself becomes the leaf again
    expect(progress.done).toBe(1); // …and counts as resolved
    // The tutor skips the closed subtree entirely.
    expect(nextPendingForTutor(useGraphStore.getState().project)?.name).toBe('passo 2');
  });

  it('computeTreeLayout: depth maps to y, siblings keep order without overlap, parent is centered', () => {
    const project = useGraphStore.getState().project!;
    const pos = computeTreeLayout(project);
    const root = project.nodes[project.rootId];
    const cat = Object.values(project.nodes).find((n) => n.kind === 'categoria')!;
    const [p1, p2, p3] = passosOrdered();

    expect(pos[root.id]).toEqual({ x: 0, y: 0 });
    expect(pos[cat.id].y).toBeGreaterThan(pos[root.id].y);
    expect(pos[p1.id].y).toBeGreaterThan(pos[cat.id].y);

    // Sibling order preserved with clearance for the widest node card (300px).
    expect(pos[p1.id].x).toBeLessThan(pos[p2.id].x);
    expect(pos[p2.id].x).toBeLessThan(pos[p3.id].x);
    expect(pos[p2.id].x - pos[p1.id].x).toBeGreaterThanOrEqual(300);

    // Single-child chains stack straight; a parent sits centered over its kids.
    expect(pos[cat.id].x).toBeCloseTo((pos[p1.id].x + pos[p3.id].x) / 2, 5);
  });

  it('applyLayoutPositions repositions every known node in one shot', () => {
    const project = useGraphStore.getState().project!;
    const pos = computeTreeLayout(project);
    useGraphStore.getState().applyLayoutPositions(pos);
    const after = useGraphStore.getState().project!;
    for (const [id, p] of Object.entries(pos)) {
      expect(after.nodes[id].position).toEqual(p);
    }
  });
});

describe('project rules — hard constraints carried by the project', () => {
  beforeEach(() => {
    useGraphStore.getState().resetProject();
  });

  it('createProjectFromPlan persists trimmed rules; empty list stays undefined', () => {
    useGraphStore
      .getState()
      .createProjectFromPlan('obj', 'R', minimalPlan, ['  orçamento máximo R$300  ', '', 'sem solda']);
    expect(useGraphStore.getState().project!.rules).toEqual([
      'orçamento máximo R$300',
      'sem solda',
    ]);

    useGraphStore.getState().resetProject();
    useGraphStore.getState().createProjectFromPlan('obj', 'R2', minimalPlan, []);
    expect(useGraphStore.getState().project!.rules).toBeUndefined();
  });

  it('addRule/removeRule manage rules with an audit entry on the root', () => {
    useGraphStore.getState().createProjectFromPlan('obj', 'R', minimalPlan);
    const { addRule, removeRule } = useGraphStore.getState();

    addRule('  prazo: 2 fins de semana  ');
    addRule('prazo: 2 fins de semana'); // duplicate → ignored
    let project = useGraphStore.getState().project!;
    expect(project.rules).toEqual(['prazo: 2 fins de semana']);

    removeRule('prazo: 2 fins de semana');
    project = useGraphStore.getState().project!;
    expect(project.rules).toBeUndefined(); // last rule removed → undefined again

    const rootHistory = project.nodes[project.rootId].history.map((h) => h.message);
    expect(rootHistory.some((m) => m.includes('prazo: 2 fins de semana'))).toBe(true);
  });
});
