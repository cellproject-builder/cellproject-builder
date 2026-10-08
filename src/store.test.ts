import { describe, it, expect, beforeEach } from 'vitest';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import {
  useGraphStore,
  projectProgress,
  nextPendingForTutor,
  isBlocked,
  computeTreeLayout,
  canConcludeNode,
  canRevealAICriterion,
  refCountsAsSignal,
  nodesWithoutSignal,
  projectMetrics,
  stepSequence,
  firstBlockerOf,
  pendingParent,
  flushGraphPersistence,
  EMPTY_OBJECTIVE_DRAFT,
} from './store';
import type { AIPlan, AIPlanOutline, ConceptNodeData } from './types';
import { isPlanOutline } from './types';

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

  // Per-cell web research: digest persists on the node and each source becomes
  // an UNVERIFIED link anchor — verifying is still the user's act, so research
  // alone must not earn 'done'.
  it('applyWebResearch stores the digest and adds sources as unverified link anchors', () => {
    const id = singlePasso();
    const digest = {
      query: 'passo 1',
      findings: '- fato real [site](https://exemplo.com/doc)',
      sources: [
        { url: 'https://exemplo.com/doc', title: 'Doc oficial' },
        { url: 'https://exemplo.com/preco', title: 'Preço real' },
      ],
      searchedAt: 1,
    };
    useGraphStore.getState().applyWebResearch(id, digest);
    const n = node(id);
    expect(n.webResearch).toEqual(digest);
    const links = (n.groundTruthRefs ?? []).filter((r) => r.kind === 'link');
    expect(links).toHaveLength(2);
    expect(links.every((r) => r.addedByAI && !r.verificado)).toBe(true);

    // Re-pesquisar não duplica âncoras de URLs já conhecidas.
    useGraphStore.getState().applyWebResearch(id, digest);
    expect((node(id).groundTruthRefs ?? []).filter((r) => r.kind === 'link')).toHaveLength(2);

    useGraphStore.getState().confirmNode(id);
    expect(node(id).state).toBe('validated');
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

// ---------------------------------------------------------------------------
// Gate honesto — falha aberta, âncora da IA sem observação, promoção tardia
// ---------------------------------------------------------------------------

describe('honest gate — open failure, AI anchors, late promotion', () => {
  beforeEach(() => {
    useGraphStore.getState().resetProject();
    useGraphStore.getState().createProjectFromPlan('obj', 'Gate', minimalPlan);
  });

  function singlePasso(): string {
    const catId = categoryId();
    useGraphStore.getState().stageSuggestions(catId, [makeSuggestionNode('a', 'passo 1', 0)], []);
    useGraphStore.getState().acceptSuggestion('a');
    return passosOrdered()[0].id;
  }

  const node = (id: string): ConceptNodeData => useGraphStore.getState().project!.nodes[id];
  const gate = (id: string) => canConcludeNode(useGraphStore.getState().project, id);

  function addAIAnchor(id: string): string {
    useGraphStore.getState().addGroundTruthRef(id, {
      kind: 'link',
      label: 'doc',
      value: 'https://exemplo.com',
      verificado: false,
      addedByAI: true,
    });
    const refs = node(id).groundTruthRefs!;
    return refs[refs.length - 1].id;
  }

  it('an open failure blocks confirm (even forced) and shows up as openFailure', () => {
    const id = singlePasso();
    useGraphStore.getState().setUserCriterion(id, 'critério');
    useGraphStore.getState().attestCriterion(id, 'atendido');
    useGraphStore.getState().reportFailure(id, 'quebrou');
    expect(gate(id).ready).toBe(false);
    expect(gate(id).missingKeys).toContain('openFailure');

    useGraphStore.getState().confirmNode(id);
    useGraphStore.getState().confirmNode(id, { force: true });
    expect(node(id).confirmado).toBe(false);
    expect(node(id).state).toBe('problem');

    // A falha refutou a aferição anterior: limpar a falha não devolve o 'done'
    // com a prova velha — é preciso aferir de novo.
    expect(node(id).comoConfirmarAtendido).toBeUndefined();
    useGraphStore.getState().clearFailure(id);
    expect(node(id).failureContext).toBeUndefined();
    expect(node(id).state).toBe('concept');
    useGraphStore.getState().attestCriterion(id, 'atendido de novo, depois do conserto');
    useGraphStore.getState().confirmNode(id);
    expect(node(id).state).toBe('done');
  });

  it('an open failure also blocks picking a decision option', () => {
    const catId = categoryId();
    useGraphStore.getState().stageSuggestions(
      catId,
      [
        {
          ...makeSuggestionNode('d', 'qual', 0),
          kind: 'decisao',
          decisionOptions: [{ id: 'o1', label: 'A', pitch: 'a' }],
        },
      ],
      [],
    );
    useGraphStore.getState().acceptSuggestion('d');
    const id = Object.values(useGraphStore.getState().project!.nodes).find(
      (n) => n.kind === 'decisao',
    )!.id;
    useGraphStore.getState().reportFailure(id, 'não serve');
    useGraphStore.getState().pickDecisionOption(id, 'o1');
    expect(node(id).decisionPickedId).toBeUndefined();
    expect(node(id).confirmado).toBe(false);
  });

  it('missingKeys tells "not locked" apart from "locked but not attested"', () => {
    const id = singlePasso();
    expect(gate(id).missingKeys).toEqual(['criterionNotLocked', 'noSignal']);
    useGraphStore.getState().setUserCriterion(id, 'critério');
    expect(gate(id).missingKeys).toEqual(['criterionNotAttested', 'noSignal']);
    useGraphStore.getState().attestCriterion(id, 'ok');
    expect(gate(id)).toMatchObject({ ready: true, missingKeys: [] });
  });

  it('an AI anchor ticked WITHOUT an observation does not earn done', () => {
    const id = singlePasso();
    const refId = addAIAnchor(id);
    useGraphStore.getState().toggleGroundTruthVerified(id, refId);
    expect(node(id).groundTruthRefs![0].verificado).toBe(true);
    expect(gate(id).ready).toBe(false);
    useGraphStore.getState().confirmNode(id);
    expect(node(id).state).toBe('validated');
  });

  it('verifyGroundTruthRef refuses an AI anchor without observation, accepts with one', () => {
    const id = singlePasso();
    const refId = addAIAnchor(id);
    useGraphStore.getState().verifyGroundTruthRef(id, refId, '   ');
    expect(node(id).groundTruthRefs![0].verificado).toBe(false);
    useGraphStore.getState().verifyGroundTruthRef(id, refId, 'li a seção 3: bate');
    const ref = node(id).groundTruthRefs![0];
    expect(ref.verificado).toBe(true);
    expect(ref.observacao).toBe('li a seção 3: bate');
    expect(refCountsAsSignal(ref)).toBe(true);
    useGraphStore.getState().confirmNode(id);
    expect(node(id).state).toBe('done');
  });

  it('a user-added anchor still counts with a plain toggle', () => {
    const id = singlePasso();
    useGraphStore.getState().addGroundTruthRef(id, {
      kind: 'medida',
      label: 'massa',
      value: '178g',
      verificado: false,
      addedByAI: false,
    });
    useGraphStore.getState().toggleGroundTruthVerified(id, node(id).groundTruthRefs![0].id);
    expect(gate(id).ready).toBe(true);
  });

  it('markRefOpened records when the user opened the source', () => {
    const id = singlePasso();
    const refId = addAIAnchor(id);
    useGraphStore.getState().markRefOpened(id, refId);
    expect(node(id).groundTruthRefs![0].openedAt).toBeTypeOf('number');
    expect(node(id).groundTruthRefs![0].verificado).toBe(false);
  });

  it('late promotion: attesting a "confirmed without proof" node turns it done', () => {
    const id = singlePasso();
    useGraphStore.getState().confirmNode(id);
    expect(node(id).confirmedWithoutSignal).toBe(true);
    let p = projectProgress(useGraphStore.getState().project);
    expect(p.doneWithoutSignal).toBe(1);

    useGraphStore.getState().setUserCriterion(id, 'critério');
    useGraphStore.getState().attestCriterion(id, 'atendido');
    expect(node(id).state).toBe('done');
    expect(node(id).confirmedWithoutSignal).toBe(false);
    expect(node(id).history.at(-1)!.kind).toBe('state');
    p = projectProgress(useGraphStore.getState().project);
    expect(p.doneWithoutSignal).toBe(0);
    expect(p.doneWithSignal).toBe(1);
  });

  it('late promotion also happens when an anchor is verified with observation', () => {
    const id = singlePasso();
    useGraphStore.getState().confirmNode(id);
    const refId = addAIAnchor(id);
    useGraphStore.getState().verifyGroundTruthRef(id, refId, 'conferi o preço');
    expect(node(id).state).toBe('done');
    expect(nodesWithoutSignal(useGraphStore.getState().project)).toEqual([]);
  });

  it('no promotion for an unconfirmed node — proof alone does not conclude', () => {
    const id = singlePasso();
    useGraphStore.getState().setUserCriterion(id, 'c');
    useGraphStore.getState().attestCriterion(id, 'ok');
    expect(node(id).confirmado).toBe(false);
    expect(node(id).state).toBe('concept');
  });

  it('nodesWithoutSignal lists resolved leaves without proof; atRisk counts pending low-confidence leaves', () => {
    const catId = categoryId();
    useGraphStore.getState().stageSuggestions(
      catId,
      [
        { ...makeSuggestionNode('a', 'p1', 0), confidence: 20 },
        { ...makeSuggestionNode('b', 'p2', 1), confidence: 30 },
      ],
      [],
    );
    useGraphStore.getState().acceptAllSuggestions();
    const [p1] = passosOrdered();
    expect(projectMetrics(useGraphStore.getState().project)!.atRisk).toBe(2);
    useGraphStore.getState().confirmNode(p1.id);
    expect(nodesWithoutSignal(useGraphStore.getState().project)).toEqual([p1.id]);
    // Resolvido sai do risco; o pendente continua.
    expect(projectMetrics(useGraphStore.getState().project)!.atRisk).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Desfazer, critério destravável, rascunhos, histórico de edição
// ---------------------------------------------------------------------------

describe('undo, drafts and edit history', () => {
  beforeEach(() => {
    useGraphStore.getState().resetProject();
    useGraphStore.getState().createProjectFromPlan('obj', 'Undo', minimalPlan);
    const catId = categoryId();
    useGraphStore.getState().stageSuggestions(catId, [makeSuggestionNode('a', 'passo 1', 0)], []);
    useGraphStore.getState().acceptSuggestion('a');
  });

  const id = () => passosOrdered()[0].id;
  const node = (): ConceptNodeData => useGraphStore.getState().project!.nodes[id()];

  it('undoLastAction restores the node before confirm and selects it', () => {
    const before = node();
    useGraphStore.getState().selectNode(null);
    useGraphStore.getState().confirmNode(id());
    expect(node().confirmado).toBe(true);
    expect(useGraphStore.getState().undoLastAction()).toBe(true);
    expect(node().confirmado).toBe(false);
    expect(node().state).toBe(before.state);
    expect(useGraphStore.getState().selectedNodeId).toBe(id());
    expect(useGraphStore.getState().lastAction).toBeNull();
  });

  it('undo works for takenAsKnown and refuses when the node changed afterwards', () => {
    useGraphStore.getState().toggleTakenAsKnown(id());
    expect(useGraphStore.getState().undoLastAction()).toBe(true);
    expect(node().takenAsKnown).toBeFalsy();

    useGraphStore.getState().confirmNode(id());
    useGraphStore.getState().addManualHistory(id(), 'mexi depois');
    expect(useGraphStore.getState().undoLastAction()).toBe(false);
    expect(node().confirmado).toBe(true);
  });

  it('unlockCriterion reopens a just-locked criterion and puts the text back in the draft', () => {
    useGraphStore.getState().setUserCriterion(id(), 'meu critério');
    expect(useGraphStore.getState().unlockCriterion(id())).toBe(true);
    expect(node().comoConfirmarUsuarioAt).toBeUndefined();
    expect(useGraphStore.getState().drafts[id()]?.criterion).toBe('meu critério');
  });

  it('drafts are set, cleared on empty, and auto-cleared by the matching action', () => {
    const s = useGraphStore.getState();
    s.setDraft(id(), 'criterion', 'rascunho');
    s.setDraft(id(), 'failure', 'quebrou?');
    expect(useGraphStore.getState().drafts[id()]).toEqual({
      criterion: 'rascunho',
      failure: 'quebrou?',
    });
    useGraphStore.getState().setUserCriterion(id(), 'rascunho');
    expect(useGraphStore.getState().drafts[id()]).toEqual({ failure: 'quebrou?' });
    useGraphStore.getState().setDraft(id(), 'met', 'medi');
    useGraphStore.getState().attestCriterion(id(), 'medi');
    useGraphStore.getState().reportFailure(id(), 'quebrou');
    expect(useGraphStore.getState().drafts[id()]).toBeUndefined();
    useGraphStore.getState().setDraft(id(), 'met', '   ');
    expect(useGraphStore.getState().drafts[id()]).toBeUndefined();
  });

  it('typing a 10-letter name produces at most one rename entry', () => {
    const before = node().history.length;
    const word = 'Carburador';
    for (let i = 1; i <= word.length; i++) {
      useGraphStore.getState().updateNode(id(), { name: word.slice(0, i) });
    }
    const renames = node().history.slice(before).filter((h) => h.kind === 'rename');
    expect(renames).toHaveLength(1);
    expect(renames[0].message).toContain('passo 1');
    expect(renames[0].message).toContain('Carburador');
  });

  it('oQue edits record one "edit" entry with the value from before the edit, on commit', () => {
    const original = node().oQue;
    useGraphStore.getState().updateNode(id(), { oQue: 'novo t' });
    useGraphStore.getState().updateNode(id(), { oQue: 'novo texto' });
    expect(node().history.filter((h) => h.kind === 'edit')).toHaveLength(0);
    useGraphStore.getState().updateNode(id(), { oQue: 'novo texto final' }, { commit: true });
    const edits = node().history.filter((h) => h.kind === 'edit');
    expect(edits).toHaveLength(1);
    expect(edits[0].field).toBe('oQue');
    expect(edits[0].prevValue).toBe(original);
  });

  it('state changes are written to history with translated labels', () => {
    useGraphStore.getState().updateNode(id(), { state: 'executing' });
    const msg = node().history.at(-1)!.message;
    expect(msg).not.toContain('executing');
  });
});

// ---------------------------------------------------------------------------
// Objetivo, layout, navegação
// ---------------------------------------------------------------------------

describe('objective draft, layout and navigation', () => {
  beforeEach(() => {
    useGraphStore.getState().resetProject();
    useGraphStore.getState().clearObjectiveDraft();
  });

  it('createProjectFromPlan clears the objective draft and keeps the other plans', () => {
    const alt: AIPlan = { ...minimalPlan, id: 'p2', title: 'Outro' };
    useGraphStore.getState().setObjectiveDraft({ objective: 'obj', plans: [minimalPlan, alt] });
    expect(useGraphStore.getState().objectiveDraft.plans).toHaveLength(2);
    useGraphStore.getState().createProjectFromPlan('obj', '', minimalPlan, [], [minimalPlan, alt]);
    const project = useGraphStore.getState().project!;
    expect(project.alternativePlans?.map((p) => p.id)).toEqual(['p2']);
    expect(project.name).toBeTruthy(); // fallback traduzido
    expect(useGraphStore.getState().objectiveDraft).toEqual(EMPTY_OBJECTIVE_DRAFT);
  });

  it('a new project is laid out with the tidy tree', () => {
    useGraphStore.getState().createProjectFromPlan('obj', 'L', minimalPlan);
    const project = useGraphStore.getState().project!;
    const pos = computeTreeLayout(project);
    for (const [nid, p] of Object.entries(pos)) {
      expect(project.nodes[nid].position).toEqual(p);
    }
  });

  it('accepting suggestions re-lays out the tree until the user drags a node', () => {
    useGraphStore.getState().createProjectFromPlan('obj', 'L', minimalPlan);
    stageChain();
    useGraphStore.getState().acceptAllSuggestions();
    const [p1, p2] = passosOrdered();
    expect(p2.position.x - p1.position.x).toBeGreaterThanOrEqual(300);

    useGraphStore.getState().updateNodePosition(p1.id, { x: 999, y: 999 });
    expect(useGraphStore.getState().project!.manualLayout).toBe(true);
    useGraphStore.getState().stageSuggestions(p2.id, [makeSuggestionNode('x', 'sub', 0)], []);
    useGraphStore.getState().acceptSuggestion('x');
    expect(useGraphStore.getState().project!.nodes[p1.id].position).toEqual({ x: 999, y: 999 });
  });

  it('stepSequence and firstBlockerOf follow sibling order', () => {
    useGraphStore.getState().createProjectFromPlan('obj', 'S', minimalPlan);
    stageChain();
    useGraphStore.getState().acceptAllSuggestions();
    const project = () => useGraphStore.getState().project;
    const [p1, p2, p3] = passosOrdered();
    expect([p1, p2, p3].map((p) => stepSequence(project(), p.id))).toEqual([1, 2, 3]);
    expect(firstBlockerOf(project(), p3.id)?.id).toBe(p1.id);
    useGraphStore.getState().confirmNode(p1.id);
    expect(firstBlockerOf(project(), p3.id)?.id).toBe(p2.id);
    expect(firstBlockerOf(project(), p2.id)).toBeNull();
    expect(stepSequence(project(), project()!.rootId)).toBeNull();
  });

  it('canRevealAICriterion only after the user locked theirs (or closed the node)', () => {
    const base = { comoConfirmarUsuarioAt: undefined, confirmado: false, takenAsKnown: false };
    expect(canRevealAICriterion(base)).toBe(false);
    expect(canRevealAICriterion({ ...base, comoConfirmarUsuarioAt: 1 })).toBe(true);
    expect(canRevealAICriterion({ ...base, confirmado: true })).toBe(true);
    expect(canRevealAICriterion({ ...base, takenAsKnown: true })).toBe(true);
  });

  it('switching to the graph without a selection opens the tutor node', () => {
    useGraphStore.getState().createProjectFromPlan('obj', 'N', minimalPlan);
    stageChain();
    useGraphStore.getState().acceptAllSuggestions();
    const [, p2] = passosOrdered();
    useGraphStore.getState().setLastTutorNode(p2.id);
    useGraphStore.getState().selectNode(null);
    useGraphStore.getState().setViewMode('graph');
    expect(useGraphStore.getState().selectedNodeId).toBe(p2.id);
    expect(useGraphStore.getState().centerRequest?.nodeId).toBe(p2.id);

    // Sem nó do tutor: cai no próximo pendente.
    useGraphStore.getState().setViewMode('tutor');
    useGraphStore.getState().setLastTutorNode(null);
    useGraphStore.getState().selectNode(null);
    useGraphStore.getState().setViewMode('graph');
    expect(useGraphStore.getState().selectedNodeId).toBe(passosOrdered()[0].id);
  });

  it('focusNode bumps focusVersion; requestCenter bumps the center version', () => {
    useGraphStore.getState().createProjectFromPlan('obj', 'F', minimalPlan);
    const v = useGraphStore.getState().focusVersion;
    useGraphStore.getState().focusNode(categoryId());
    useGraphStore.getState().focusNode(categoryId());
    expect(useGraphStore.getState().focusVersion).toBe(v + 2);
    useGraphStore.getState().requestCenter(categoryId());
    const c1 = useGraphStore.getState().centerRequest!.version;
    useGraphStore.getState().requestCenter(categoryId());
    expect(useGraphStore.getState().centerRequest!.version).toBe(c1 + 1);
  });

  it('aiJobs track running AI calls per node; pendingParent resolves the staging parent', () => {
    useGraphStore.getState().createProjectFromPlan('obj', 'J', minimalPlan);
    const catId = categoryId();
    useGraphStore.getState().startAIJob(catId, 'decompose');
    expect(useGraphStore.getState().aiJobs[catId]?.decompose?.kind).toBe('decompose');
    // Outro job no mesmo nó não apaga o marcador da quebra.
    useGraphStore.getState().startAIJob(catId, 'research');
    useGraphStore.getState().endAIJob(catId, 'research');
    expect(useGraphStore.getState().aiJobs[catId]?.decompose).toBeTruthy();
    useGraphStore.getState().endAIJob(catId, 'decompose');
    expect(useGraphStore.getState().aiJobs[catId]).toBeUndefined();
    stageChain();
    expect(pendingParent(useGraphStore.getState())?.id).toBe(catId);
  });
});

// ---------------------------------------------------------------------------
// Reset seguro, import e persistência
// ---------------------------------------------------------------------------

describe('safe reset and import', () => {
  beforeEach(() => {
    useGraphStore.getState().resetProject();
    useGraphStore.setState({ archivedProject: null });
  });

  it('resetProject archives the project and undoReset brings it back', () => {
    useGraphStore.getState().createProjectFromPlan('obj', 'Arquivo', minimalPlan);
    const before = useGraphStore.getState().project!;
    useGraphStore.getState().resetProject();
    expect(useGraphStore.getState().project).toBeNull();
    expect(useGraphStore.getState().archivedProject?.id).toBe(before.id);
    expect(useGraphStore.getState().undoReset()).toBe(true);
    expect(useGraphStore.getState().project?.id).toBe(before.id);
    expect(useGraphStore.getState().archivedProject).toBeNull();
  });

  it('leaving the demo does not overwrite the archived real project', () => {
    useGraphStore.getState().createProjectFromPlan('obj', 'Real', minimalPlan);
    const real = useGraphStore.getState().project!;
    useGraphStore.getState().resetProject();
    useGraphStore.getState().loadDemoProject();
    useGraphStore.getState().resetProject();
    expect(useGraphStore.getState().archivedProject?.id).toBe(real.id);
  });

  it('importProject accepts the exported JSON and archives the current project', () => {
    useGraphStore.getState().createProjectFromPlan('obj', 'Export', minimalPlan);
    stageChain();
    useGraphStore.getState().acceptAllSuggestions();
    const original = useGraphStore.getState().project!;
    const exported = JSON.stringify(original, null, 2);

    useGraphStore.getState().resetProject();
    useGraphStore.getState().createProjectFromPlan('obj', 'Atual', minimalPlan);
    const current = useGraphStore.getState().project!;

    expect(useGraphStore.getState().importProject(exported)).toEqual({ ok: true });
    const imported = useGraphStore.getState().project!;
    expect(imported.id).toBe(original.id);
    expect(Object.keys(imported.nodes)).toHaveLength(Object.keys(original.nodes).length);
    expect(Object.keys(imported.edges)).toHaveLength(Object.keys(original.edges).length);
    expect(useGraphStore.getState().archivedProject?.id).toBe(current.id);
  });

  it('importProject rejects invalid input without touching the current project', () => {
    useGraphStore.getState().createProjectFromPlan('obj', 'Fica', minimalPlan);
    const current = useGraphStore.getState().project!;
    for (const bad of ['nem json', '{}', JSON.stringify({ rootId: 'x', nodes: {}, edges: {} }), 42]) {
      expect(useGraphStore.getState().importProject(bad).ok).toBe(false);
    }
    expect(useGraphStore.getState().project?.id).toBe(current.id);
  });

  it('the demo keeps the gate honest: every done node has real proof', () => {
    useGraphStore.getState().loadDemoProject();
    const project = useGraphStore.getState().project!;
    for (const n of Object.values(project.nodes)) {
      if (n.state === 'done' && !n.failureContext) {
        expect(canConcludeNode(project, n.id).missingKeys).not.toContain('noSignal');
      }
    }
  });
});

describe('persistence — drafts survive a reload', () => {
  it('drafts and the objective draft come back after rehydrate', async () => {
    useGraphStore.getState().resetProject();
    useGraphStore.getState().createProjectFromPlan('obj', 'P', minimalPlan);
    const catId = categoryId();
    useGraphStore.getState().setDraft(catId, 'failure', 'algo estranho');
    useGraphStore.getState().setObjectiveDraft({ objective: 'meu objetivo', ruleDraft: 'regra' });
    await flushGraphPersistence();

    // O que está no IndexedDB é o que um reload vai ler.
    const raw = await idbGet<string>('cellproject-graph');
    const stored = JSON.parse(raw!).state;
    expect(stored.drafts[catId]).toEqual({ failure: 'algo estranho' });
    expect(stored.objectiveDraft.objective).toBe('meu objetivo');

    // "Reload": zera a memória e reidrata do IndexedDB.
    useGraphStore.setState({ drafts: {}, objectiveDraft: EMPTY_OBJECTIVE_DRAFT });
    await flushGraphPersistence();
    await idbSet('cellproject-graph', raw!);
    await useGraphStore.persist.rehydrate();
    expect(useGraphStore.getState().drafts[catId]).toEqual({ failure: 'algo estranho' });
    expect(useGraphStore.getState().objectiveDraft.objective).toBe('meu objetivo');
    expect(useGraphStore.getState().objectiveDraft.ruleDraft).toBe('regra');
  });
});

// ---------------------------------------------------------------------------
// Planejamento em duas fases — esboços + cache de expansão no rascunho
// ---------------------------------------------------------------------------

function makeOutline(id: string, title = `Esboço ${id}`): AIPlanOutline {
  const { tree: _tree, ...header } = minimalPlan;
  return {
    ...header,
    id,
    title,
    outline: {
      categorias: [{ name: 'Execução', kind: 'execucao', nodes: [{ name: 'Passo 1', kind: 'passo' }] }],
    },
  };
}

function expandedFor(id: string): AIPlan {
  // O service devolve id = id do esboço; aqui um id diferente prova que o
  // store força a chave.
  return { ...minimalPlan, id: `outro-${id}`, title: `Esboço ${id}` };
}

describe('objective draft — two-phase planning (outlines + expansion cache)', () => {
  beforeEach(() => {
    useGraphStore.getState().resetProject();
    useGraphStore.getState().clearObjectiveDraft();
  });

  it('setOutlines → setExpansion → setExpandedPlan caches the tree by outline id', () => {
    const s = useGraphStore.getState();
    s.setOutlines([makeOutline('a'), makeOutline('b')], { objective: 'obj', rules: ['r'] });
    s.setExpansion('a');
    expect(useGraphStore.getState().objectiveDraft.expansion?.outlineId).toBe('a');

    s.setExpandedPlan('a', expandedFor('a'));
    const d = useGraphStore.getState().objectiveDraft;
    expect(d.expanded.a.id).toBe('a');
    expect(d.expansion).toBeNull();
    expect(d.plansFor).toEqual({ objective: 'obj', rules: ['r'] });
  });

  it('a finished expansion of another outline does not clear the one in progress', () => {
    const s = useGraphStore.getState();
    s.setOutlines([makeOutline('a'), makeOutline('b')]);
    s.setExpansion('b');
    s.setExpandedPlan('a', expandedFor('a'));
    expect(useGraphStore.getState().objectiveDraft.expansion?.outlineId).toBe('b');
  });

  it('setOutlines prunes cached trees, the expansion and the selection of outlines that left', () => {
    const s = useGraphStore.getState();
    s.setOutlines([makeOutline('a'), makeOutline('b')]);
    s.setExpandedPlan('a', expandedFor('a'));
    s.setExpandedPlan('b', expandedFor('b'));
    s.setExpansion('a');
    s.setObjectiveDraft({ selectedId: 'a' });

    // "Gerar mais" fundido: b fica, a sai, c entra.
    s.setOutlines([makeOutline('b'), makeOutline('c')]);
    const d = useGraphStore.getState().objectiveDraft;
    expect(Object.keys(d.expanded)).toEqual(['b']);
    expect(d.expansion).toBeNull();
    expect(d.selectedId).toBeNull();
    expect(d.outlines?.map((o) => o.id)).toEqual(['b', 'c']);
  });

  it('createProjectFromOutline uses the cached tree; alternatives keep outlines or their trees', () => {
    const s = useGraphStore.getState();
    s.setOutlines([makeOutline('a'), makeOutline('b'), makeOutline('c')]);
    expect(s.createProjectFromOutline('obj', '', 'a')).toBe(false);
    expect(useGraphStore.getState().project).toBeNull();

    s.setExpandedPlan('a', expandedFor('a'));
    s.setExpandedPlan('c', expandedFor('c'));
    expect(s.createProjectFromOutline('obj', 'Meu', 'a', ['r'])).toBe(true);

    const project = useGraphStore.getState().project!;
    expect(project.name).toBe('Meu');
    expect(project.rules).toEqual(['r']);
    const alts = project.alternativePlans ?? [];
    expect(alts.map((p) => p.id)).toEqual(['b', 'c']);
    expect(isPlanOutline(alts[0])).toBe(true);
    expect(isPlanOutline(alts[1])).toBe(false);
    expect(useGraphStore.getState().objectiveDraft).toEqual(EMPTY_OBJECTIVE_DRAFT);
  });

  it('createProjectFromPlan accepts outlines as alternatives', () => {
    useGraphStore
      .getState()
      .createProjectFromPlan('obj', 'P', minimalPlan, [], [minimalPlan, makeOutline('x')]);
    expect(useGraphStore.getState().project!.alternativePlans?.map((p) => p.id)).toEqual(['x']);
  });

  it('outlines and the expansion cache survive a reload', async () => {
    const s = useGraphStore.getState();
    s.setOutlines([makeOutline('a')], { objective: 'obj', rules: [] });
    s.setExpandedPlan('a', expandedFor('a'));
    await flushGraphPersistence();
    const raw = await idbGet<string>('cellproject-graph');

    useGraphStore.setState({ objectiveDraft: EMPTY_OBJECTIVE_DRAFT });
    await flushGraphPersistence();
    await idbSet('cellproject-graph', raw!);
    await useGraphStore.persist.rehydrate();
    const d = useGraphStore.getState().objectiveDraft;
    expect(d.outlines?.[0].id).toBe('a');
    expect(d.expanded.a.tree.categorias).toHaveLength(1);
  });

  it('a v5 snapshot (no outline fields) migrates with the new defaults', async () => {
    const oldDraft = {
      name: 'n',
      objective: 'objetivo antigo',
      rules: [],
      ruleDraft: '',
      plans: [minimalPlan],
      plansFor: { objective: 'objetivo antigo', rules: [] },
      selectedId: null,
      generatingSince: null,
      updatedAt: 1,
    };
    await flushGraphPersistence();
    await idbSet('cellproject-graph', JSON.stringify({ state: { objectiveDraft: oldDraft }, version: 5 }));
    await useGraphStore.persist.rehydrate();
    const d = useGraphStore.getState().objectiveDraft;
    expect(d.objective).toBe('objetivo antigo');
    expect(d.plans).toHaveLength(1);
    expect(d.outlines).toBeNull();
    expect(d.expanded).toEqual({});
    expect(d.expansion).toBeNull();
    expect(d.outlineResearch).toBeNull();
  });
});
