import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useGraphStore } from '@/store';
import type { AIPlan, ConceptNodeData } from '@/types';
import {
  assessCriterion,
  criterionOverlap,
  detectRefKind,
  isVagueCriterion,
  normalizeLinkInput,
  safeHref,
  GroundTruthInlineTutor,
  CRITERION_UNDO_MS,
} from './GroundTruth';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('helpers puros', () => {
  it('safeHref só aceita http(s)', () => {
    expect(safeHref('https://example.com/a')).toBe('https://example.com/a');
    expect(safeHref('http://x.io')).toBe('http://x.io/');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,hi')).toBeNull();
    expect(safeHref('example.com')).toBeNull();
  });

  it('detectRefKind reconhece link, medida e spec', () => {
    expect(detectRefKind('https://docs.arduino.cc/x')).toBe('link');
    expect(detectRefKind('www.mouser.com/p/123')).toBe('link');
    expect(normalizeLinkInput('www.mouser.com/p/123')).toBe('https://www.mouser.com/p/123');
    expect(detectRefKind('178 g')).toBe('medida');
    expect(detectRefKind('40cm ± 2cm')).toBe('medida');
    expect(detectRefKind('2200mAh')).toBe('medida');
    expect(detectRefKind('ESP32-WROOM-32 com antena PCB')).toBe('spec');
  });

  it('overlap ignora acentos e stopwords', () => {
    const ai = 'O motor gira sem travar quando ligado na bateria';
    const user = 'motor gira sem travar ligado bateria';
    expect(criterionOverlap(ai, user)).toBeGreaterThanOrEqual(0.9);
    expect(criterionOverlap('Medição é precisa', 'medicao e precisa')).toBe(1);
  });

  it('critério quase igual ao da IA não recebe o selo independente', () => {
    const ai = 'O drone decola, paira estável por 30 segundos e pousa sem tombar';
    expect(assessCriterion(ai, 'drone decola e paira estável por 30 segundos')).toBe('similar');
  });

  it('critério vago pede algo mais testável', () => {
    expect(isVagueCriterion('funciona bem')).toBe(true);
    expect(isVagueCriterion('fica bom e bonito no final do dia')).toBe(true);
    expect(assessCriterion('', 'ficou bom')).toBe('vague');
  });

  it('critério concreto e diferente é independente', () => {
    const ai = 'O drone decola, paira estável por 30 segundos e pousa sem tombar';
    const user = 'Peso total na balança abaixo de 250 g com a bateria encaixada';
    expect(isVagueCriterion(user)).toBe(false);
    expect(assessCriterion(ai, user)).toBe('independent');
  });
});

// ---------------------------------------------------------------------------
// Card do tutor
// ---------------------------------------------------------------------------

const plan: AIPlan = {
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
      { tempId: 'cat1', name: 'Execução', kind: 'execucao', oQue: 'o', porQue: 'p', children: [] },
    ],
  },
};

let nodeId = '';

function setupNode(patch: Partial<ConceptNodeData>) {
  useGraphStore.getState().createProjectFromPlan('objetivo', 'Projeto', plan);
  const project = useGraphStore.getState().project!;
  const cat = Object.values(project.nodes).find((n) => n.name === 'Execução')!;
  nodeId = cat.id;
  const node: ConceptNodeData = {
    ...cat,
    kind: 'passo',
    comoConfirmar: 'CRITERIO_DA_IA_SECRETO',
    ...patch,
  };
  useGraphStore.setState({
    project: { ...project, nodes: { ...project.nodes, [nodeId]: node } },
    drafts: {},
  });
}

let container: HTMLDivElement;
let root: Root;

function render() {
  const project = useGraphStore.getState().project!;
  act(() => {
    root.render(<GroundTruthInlineTutor node={project.nodes[nodeId]} project={project} />);
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('GroundTruthInlineTutor', () => {
  it('só o critério fica aberto; as outras seções mostram resumo', () => {
    setupNode({});
    render();
    expect(container.querySelector('#gt-criterion')).not.toBeNull();
    const folds = [...container.querySelectorAll('details')];
    expect(folds).toHaveLength(3);
    expect(folds.every((d) => !d.open)).toBe(true);
    expect(container.querySelector('#gt-failure')).not.toBeNull();
    // O critério da IA não aparece antes do lock.
    expect(container.textContent).not.toContain('CRITERIO_DA_IA_SECRETO');
  });

  it('a seção de falha abre sozinha quando há falha registrada', () => {
    setupNode({ failureContext: 'quebrou o eixo', state: 'problem' });
    render();
    const failure = container.querySelector<HTMLDetailsElement>('#gt-failure')!;
    expect(failure.open).toBe(true);
  });

  it('criterioAlternativo da crítica fica escondido até o lock', () => {
    const critica = {
      fraquezas: ['f1'],
      premissasOcultas: [],
      criterioAlternativo: 'ALT_DO_CETICO',
      generatedAt: Date.now(),
    };
    setupNode({ critica });
    render();
    expect(container.textContent).not.toContain('ALT_DO_CETICO');

    // Travado há pouco: ainda na janela de desfazer → continua escondido.
    setupNode({ critica, comoConfirmarUsuario: 'peso abaixo de 250 g', comoConfirmarUsuarioAt: Date.now() });
    render();
    expect(container.textContent).not.toContain('ALT_DO_CETICO');
    expect(container.textContent).not.toContain('CRITERIO_DA_IA_SECRETO');

    // Travado e fora da janela → revelado.
    setupNode({
      critica,
      comoConfirmarUsuario: 'peso abaixo de 250 g',
      comoConfirmarUsuarioAt: Date.now() - CRITERION_UNDO_MS - 1000,
    });
    render();
    expect(container.textContent).toContain('ALT_DO_CETICO');
    expect(container.textContent).toContain('CRITERIO_DA_IA_SECRETO');
  });

  it('prova da IA não pode ser marcada sem abrir o link', () => {
    setupNode({
      groundTruthRefs: [
        {
          id: 'r1',
          kind: 'link',
          label: 'Datasheet',
          value: 'https://example.com/ds.pdf',
          verificado: false,
          addedAt: Date.now(),
          addedByAI: true,
        },
      ],
    });
    render();
    const box = container.querySelector<HTMLButtonElement>('button[role="checkbox"]')!;
    expect(box.disabled).toBe(true);

    act(() => useGraphStore.getState().markRefOpened(nodeId, 'r1'));
    render();
    const box2 = container.querySelector<HTMLButtonElement>('button[role="checkbox"]')!;
    expect(box2.disabled).toBe(false);
    // Clicar abre o campo de observação em vez de marcar direto.
    act(() => box2.click());
    expect(useGraphStore.getState().project!.nodes[nodeId].groundTruthRefs![0].verificado).toBe(false);
    expect(container.querySelector('#gt-verify-r1')).not.toBeNull();
  });

  it('rascunho do critério vem do store e sobrevive à remontagem', () => {
    setupNode({});
    act(() => useGraphStore.getState().setDraft(nodeId, 'criterion', 'meu critério em andamento'));
    render();
    act(() => root.unmount());
    root = createRoot(container);
    render();
    const ta = container.querySelector<HTMLTextAreaElement>('#gt-criterion textarea')!;
    expect(ta.value).toBe('meu critério em andamento');
  });
});
