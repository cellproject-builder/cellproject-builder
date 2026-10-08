import { describe, it, expect, beforeEach } from 'vitest';
import {
  useGraphStore,
  projectProgress,
  nextPendingForTutor,
  demoteUnprovenDone,
  canRevealAICriterionNow,
  CRITERION_UNLOCK_MS,
  reviewingParentIds,
} from './store';
import type { AIPlan, ConceptNodeData, Project } from './types';

// Correção rodada 1: sugestões pendentes contam como partes abertas, arquivo
// leva o staging junto, migração v5 e o grafo abre no nó do tutor.

const plan: AIPlan = {
  id: 'p1',
  title: 'Plano',
  pitch: 'pitch',
  approach: 'approach',
  strategy: 'reaproveitar',
  archetype: 'construir',
  rank: 1,
  rankReason: 'r',
  tree: {
    categorias: [
      { tempId: 'cat1', name: 'Execução', kind: 'execucao', oQue: 'o', porQue: 'p', children: [] },
    ],
  },
};

type Staged = Omit<ConceptNodeData, 'id' | 'parentId' | 'history'> & { tempId: string };

const staged = (tempId: string, name: string, order: number): Staged => ({
  tempId,
  kind: 'recurso',
  name,
  fx: 'fx',
  problem: '',
  confidence: 80,
  confidenceSource: 'ai',
  confidenceReason: 'r',
  pros: [],
  cons: [],
  oQue: 'o',
  porQue: 'p',
  comoConfirmar: 'c',
  confirmado: false,
  order,
  state: 'concept',
  notes: '',
  aiSuggested: true,
  position: { x: 0, y: 0 },
});

const st = () => useGraphStore.getState();
const byName = (name: string) => Object.values(st().project!.nodes).find((n) => n.name === name)!;
const catId = () => Object.values(st().project!.nodes).find((n) => n.kind === 'categoria')!.id;

beforeEach(() => {
  st().resetProject();
  st().createProjectFromPlan('obj', 'Teste', plan);
  // Um recurso folha "vaso" sob a categoria + um segundo recurso irmão.
  st().stageSuggestions(catId(), [staged('v', 'vaso', 0), staged('w', 'água', 1)], []);
  st().acceptAllSuggestions();
});

describe('sugestões pendentes ficam fora do progresso (rodada 2)', () => {
  it('aceitar 1 de N não pula o pai no "próximo", mas o progresso só conta o aceito', () => {
    const vaso = byName('vaso');
    st().stageSuggestions(
      vaso.id,
      [staged('a', 'substrato', 0), staged('b', 'mudas', 1), staged('c', 'bandeja', 2)],
      [],
    );
    st().acceptSuggestion('a');
    st().toggleTakenAsKnown(byName('substrato').id);

    const { project, pendingSuggestions } = st();
    const p = projectProgress(project);
    // substrato (resolvido) + água — as 2 sugestões não aceitas não contam.
    expect(p.total).toBe(2);
    expect(p.done).toBe(1);
    // O pai com sugestões em revisão continua sendo o próximo — não "água".
    expect(nextPendingForTutor(project, pendingSuggestions)?.id).toBe(vaso.id);
    // Com o conjunto de pais em revisão, o pai conta como UMA parte aberta:
    // 1 de 4 aceita não deixa o vaso "resolvido".
    const reviewing = reviewingParentIds(pendingSuggestions, st().parkedSuggestions);
    const pr = projectProgress(project, reviewing);
    expect(pr.total).toBe(3);
    expect(pr.done).toBe(1);
    expect(nextPendingForTutor(project, null, reviewing)?.id).toBe(vaso.id);
  });

  it('chegar sugestões não muda o denominador', () => {
    const before = projectProgress(st().project).total;
    st().stageSuggestions(byName('vaso').id, [staged('a', 's1', 0), staged('b', 's2', 1)], []);
    expect(projectProgress(st().project).total).toBe(before);
  });
});

describe('lotes de sugestões por pai (rodada 2)', () => {
  it('quebrar outro nó estaciona o lote em revisão; reabrir o pai traz de volta', () => {
    const vaso = byName('vaso');
    const agua = byName('água');
    st().stageSuggestions(vaso.id, [staged('a', 's1', 0), staged('b', 's2', 1)], []);
    st().acceptSuggestion('a');
    st().stageSuggestions(agua.id, [staged('x', 'cano', 0)], []);
    expect(st().pendingSuggestions?.parentId).toBe(agua.id);
    expect(st().parkedSuggestions[vaso.id]?.nodes).toHaveLength(1);

    st().selectNode(vaso.id);
    expect(st().pendingSuggestions?.parentId).toBe(vaso.id);
    expect(st().pendingSuggestions?.acceptedMap?.a).toBeDefined();
    expect(st().parkedSuggestions[agua.id]?.nodes).toHaveLength(1);
    expect(st().parkedSuggestions[vaso.id]).toBeUndefined();
  });

  it('apagar o pai descarta o lote estacionado dele', () => {
    const vaso = byName('vaso');
    st().stageSuggestions(vaso.id, [staged('a', 's1', 0)], []);
    st().stageSuggestions(byName('água').id, [staged('x', 'cano', 0)], []);
    st().deleteNode(vaso.id);
    expect(st().parkedSuggestions[vaso.id]).toBeUndefined();
  });
});

describe('arquivar/desfazer leva as sugestões pendentes junto', () => {
  it('restaura o staging no undoReset', () => {
    const vaso = byName('vaso');
    st().stageSuggestions(vaso.id, [staged('a', 's1', 0)], []);
    st().resetProject();
    expect(st().pendingSuggestions).toBeNull();
    expect(st().undoReset()).toBe(true);
    expect(st().pendingSuggestions?.parentId).toBe(vaso.id);
    expect(st().pendingSuggestions?.nodes).toHaveLength(1);
  });
});

describe('migração v5 — done só por âncora da IA sem observação', () => {
  it('rebaixa para confirmado sem prova; mantém os comprovados', () => {
    const base = st().project!;
    const vaso = byName('vaso');
    const agua = byName('água');
    const project: Project = {
      ...base,
      nodes: {
        ...base.nodes,
        [vaso.id]: {
          ...vaso,
          confirmado: true,
          state: 'done',
          groundTruthRefs: [
            { id: 'r1', kind: 'spec', label: 'x', value: 'y', verificado: true, addedByAI: true },
          ],
        } as ConceptNodeData,
        [agua.id]: {
          ...agua,
          confirmado: true,
          state: 'done',
          comoConfirmarAtendido: { observacao: 'ok', at: 1 },
        },
      },
    };
    const out = demoteUnprovenDone(project);
    expect(out.nodes[vaso.id].state).toBe('validated');
    expect(out.nodes[vaso.id].confirmedWithoutSignal).toBe(true);
    expect(out.nodes[agua.id].state).toBe('done');
  });
});

describe('critério da IA e a janela de desfazer do lock', () => {
  it('só revela depois da janela', () => {
    const n = { comoConfirmarUsuarioAt: 1000, confirmado: false, takenAsKnown: false };
    expect(canRevealAICriterionNow(n, 1000 + CRITERION_UNLOCK_MS - 1)).toBe(false);
    expect(canRevealAICriterionNow(n, 1000 + CRITERION_UNLOCK_MS)).toBe(true);
    expect(canRevealAICriterionNow({ ...n, confirmado: true }, 1001)).toBe(true);
  });
});

describe('tutor → grafo abre no nó do tutor', () => {
  it('prefere o lastTutorNodeId à seleção antiga', () => {
    st().setViewMode('tutor');
    st().selectNode(catId());
    st().setLastTutorNode(byName('água').id);
    st().setViewMode('graph');
    expect(st().selectedNodeId).toBe(byName('água').id);
    expect(st().centerRequest?.nodeId).toBe(byName('água').id);
  });
});

describe('correção rodada 1 (overhaul)', () => {
  it('ver o critério da IA ("já sei") impede destravar o lock, mesmo após desfazer', () => {
    const vaso = byName('vaso');
    st().setUserCriterion(vaso.id, 'meu critério');
    st().toggleTakenAsKnown(vaso.id);
    expect(st().undoLastAction()).toBe(true);
    expect(st().unlockCriterion(vaso.id)).toBe(false);
    expect(byName('vaso').comoConfirmarUsuario).toBe('meu critério');
  });

  it('desmarcar a única âncora rebaixa o done', () => {
    const vaso = byName('vaso');
    st().addGroundTruthRef(vaso.id, { kind: 'medida', label: 'peso', value: '2kg', verificado: false, addedByAI: false });
    const refId = byName('vaso').groundTruthRefs!.at(-1)!.id;
    st().toggleGroundTruthVerified(vaso.id, refId);
    st().confirmNode(vaso.id);
    expect(byName('vaso').state).toBe('done');
    st().toggleGroundTruthVerified(vaso.id, refId);
    expect(byName('vaso').state).toBe('validated');
    expect(byName('vaso').confirmedWithoutSignal).toBe(true);
  });

  it('carregar a demo arquiva o projeto real', () => {
    const id = st().project!.id;
    st().loadDemoProject();
    expect(st().archivedProject?.id).toBe(id);
  });

  it('import descarta URLs não-http e rebaixa done sem prova', () => {
    const project = st().project!;
    const vaso = byName('vaso');
    const json = JSON.parse(JSON.stringify(project));
    json.nodes[vaso.id].state = 'done';
    json.nodes[vaso.id].confirmado = true;
    json.nodes[vaso.id].webResearch = {
      query: 'q',
      findings: 'f',
      searchedAt: 1,
      sources: [
        { url: 'javascript:alert(1)', title: 'x' },
        { url: 'https://ok.example', title: 'ok' },
      ],
    };
    expect(st().importProject(json).ok).toBe(true);
    const n = byName('vaso');
    expect(n.webResearch?.sources.map((s) => s.url)).toEqual(['https://ok.example']);
    expect(n.state).toBe('validated');
  });
});

describe('correção rodada 2 (e2e com IA real)', () => {
  it('"Descartar todas" pode ser desfeito: restoreSuggestions devolve o lote', () => {
    const vaso = byName('vaso');
    st().stageSuggestions(vaso.id, [staged('a', 'substrato', 0), staged('b', 'mudas', 1)], []);
    st().acceptSuggestion('a');
    const batch = st().pendingSuggestions!;
    expect(Object.keys(batch.acceptedMap ?? {})).toHaveLength(1);
    st().rejectAllSuggestions();
    expect(st().pendingSuggestions).toBeNull();
    expect(st().restoreSuggestions(batch)).toBe(true);
    expect(st().pendingSuggestions?.nodes.map((n) => n.data.name)).toEqual(['mudas']);
    // Já restaurado: um segundo desfazer não duplica.
    expect(st().restoreSuggestions(batch)).toBe(false);
  });

  it('aceitar o replanejamento de um nó com falha marca o texto do pai como antigo e tira a explicação', () => {
    const vaso = byName('vaso');
    st().setNodeExplanation(vaso.id, 'explicação do plano antigo');
    st().reportFailure(vaso.id, 'rachou');
    st().stageSuggestions(vaso.id, [staged('a', 'vaso novo', 0)], []);
    st().acceptAllSuggestions();
    const after = byName('vaso');
    expect(after.planReplacedAt).toBeTypeOf('number');
    expect(after.explicacao).toBeUndefined();
  });
});
