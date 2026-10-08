import { describe, it, expect, beforeEach } from 'vitest';
import {
  useGraphStore,
  projectProgress,
  nextPendingForTutor,
  demoteUnprovenDone,
  canRevealAICriterionNow,
  CRITERION_UNLOCK_MS,
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

describe('sugestões pendentes contam como partes abertas', () => {
  it('aceitar 1 de N não deixa o pai completo nem pula ele no "próximo"', () => {
    const vaso = byName('vaso');
    st().stageSuggestions(
      vaso.id,
      [staged('a', 'substrato', 0), staged('b', 'mudas', 1), staged('c', 'bandeja', 2)],
      [],
    );
    st().acceptSuggestion('a');
    st().toggleTakenAsKnown(byName('substrato').id);

    const { project, pendingSuggestions } = st();
    const p = projectProgress(project, pendingSuggestions);
    // substrato (resolvido) + 2 pendentes + água
    expect(p.total).toBe(4);
    expect(p.done).toBe(1);
    // O pai com sugestões em revisão é o próximo — não "água".
    expect(nextPendingForTutor(project, pendingSuggestions)?.id).toBe(vaso.id);
    // Sem o staging, o comportamento antigo (pai "completo").
    expect(nextPendingForTutor(project)?.name).toBe('água');
  });

  it('um pai folha é substituído pelas suas sugestões no total', () => {
    const vaso = byName('vaso');
    st().stageSuggestions(vaso.id, [staged('a', 's1', 0), staged('b', 's2', 1)], []);
    const p = projectProgress(st().project, st().pendingSuggestions);
    expect(p.total).toBe(3); // s1 + s2 + água (vaso vira contêiner)
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
