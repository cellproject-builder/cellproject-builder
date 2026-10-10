import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useGraphStore } from '@/store';
import { useLocaleStore, type Locale } from '@/i18n';
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

function typeInto(field: HTMLTextAreaElement, text: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setValue.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  useLocaleStore.setState({ locale: 'pt-BR' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('GroundTruthInlineTutor', () => {
  it.each<Locale>(['pt-BR', 'en'])('associa a previsão ao contexto da parte e às instruções antes do ensaio (%s)', (locale) => {
    useLocaleStore.setState({ locale });
    setupNode({ name: 'Testar a fixação do braço esquerdo' });
    render();
    const field = container.querySelector<HTMLTextAreaElement>('textarea[name="user-criterion"]')!;
    const descriptionIds = field.getAttribute('aria-describedby')?.split(/\s+/) ?? [];
    expect(descriptionIds).toHaveLength(2);
    const descriptions = descriptionIds.map((id) => document.getElementById(id));
    expect(descriptions.every((element) => Boolean(element?.textContent?.trim()))).toBe(true);
    expect(descriptions[0]?.textContent).toContain('Testar a fixação do braço esquerdo');
    expect(container.querySelector('#gt-attest')).toBeNull();
    expect(container.textContent).not.toContain('CRITERIO_DA_IA_SECRETO');

    setupNode({ name: 'Explicar a transmissão', kind: 'concept' });
    render();
    const conceptField = container.querySelector<HTMLTextAreaElement>('textarea[name="user-criterion"]')!;
    const conceptContext = conceptField.getAttribute('aria-describedby')?.split(/\s+/)[0];
    expect(document.getElementById(conceptContext!)?.textContent).toContain('Explicar a transmissão');
    expect(container.textContent).not.toContain('Testar a fixação do braço esquerdo');
  });

  it('trava a previsão escrita pelo usuário e mantém a IA oculta enquanto ainda pode desfazer', () => {
    setupNode({});
    render();
    const field = container.querySelector<HTMLTextAreaElement>('textarea[name="user-criterion"]')!;
    const prediction = 'Com a carga fixada, medir o desvio e comparar com o limite definido.';
    typeInto(field, prediction);
    act(() => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })));
    render();

    const node = useGraphStore.getState().project!.nodes[nodeId];
    expect(node.comoConfirmarUsuario).toBe(prediction);
    expect(node.comoConfirmarUsuarioAt).toBeGreaterThan(0);
    expect(node.comoConfirmarAtendido).toBeUndefined();
    expect(container.querySelector('#gt-attest textarea')).not.toBeNull();
    expect(container.textContent).not.toContain('CRITERIO_DA_IA_SECRETO');
  });

  it('registra a observação real separada da previsão e recusa observação vazia', () => {
    setupNode({
      comoConfirmarUsuario: 'Explicar o caminho da transmissão sem consultar a fonte.',
      comoConfirmarUsuarioAt: Date.now() - CRITERION_UNDO_MS - 1000,
    });
    render();
    const field = container.querySelector<HTMLTextAreaElement>('#gt-attest textarea')!;
    const submit = container.querySelector<HTMLButtonElement>('#gt-attest button')!;
    expect(submit.disabled).toBe(true);
    act(() => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })));
    expect(useGraphStore.getState().project!.nodes[nodeId].comoConfirmarAtendido).toBeUndefined();

    const observation = 'Sem a fonte, expliquei a transmissão e comparei meu desenho com a referência.';
    typeInto(field, `  ${observation}  `);
    act(() => submit.click());
    render();
    const node = useGraphStore.getState().project!.nodes[nodeId];
    expect(node.comoConfirmarAtendido?.observacao).toBe(observation);
    expect(node.comoConfirmarUsuario).toBe('Explicar o caminho da transmissão sem consultar a fonte.');
    expect(node.confirmado).toBe(false);
    expect(useGraphStore.getState().drafts[nodeId]?.met).toBeUndefined();
    expect(container.querySelector('#gt-attest textarea')).toBeNull();
    expect(container.textContent).toContain(observation);
  });

  it('relatar divergência invalida o resultado atendido e abre a revisão preservando a previsão', () => {
    setupNode({
      confirmado: true,
      state: 'done',
      comoConfirmarUsuario: 'O braço deve manter a posição durante o teste.',
      comoConfirmarUsuarioAt: Date.now() - CRITERION_UNDO_MS - 1000,
      comoConfirmarAtendido: { observacao: 'Manteve a posição no primeiro teste.', at: Date.now() },
    });
    render();
    const failureSection = container.querySelector<HTMLDetailsElement>('#gt-failure')!;
    act(() => failureSection.querySelector('summary')!.click());
    act(() => failureSection.querySelector('button')!.click());
    const field = failureSection.querySelector<HTMLTextAreaElement>('textarea[name="failure-context"]')!;
    const failure = 'Com a carga reposicionada, o braço perdeu a posição antes do fim do teste.';
    typeInto(field, failure);
    const recordOnly = [...failureSection.querySelectorAll('button')].find((button) =>
      /Só registrar|Record only/.test(button.textContent ?? ''),
    )!;
    act(() => recordOnly.click());
    render();

    const node = useGraphStore.getState().project!.nodes[nodeId];
    expect(node.failureContext).toBe(failure);
    expect(node.state).toBe('problem');
    expect(node.confirmado).toBe(false);
    expect(node.comoConfirmarAtendido).toBeUndefined();
    expect(node.comoConfirmarUsuario).toBe('O braço deve manter a posição durante o teste.');
    expect(container.querySelector<HTMLDetailsElement>('#gt-failure')!.open).toBe(true);
    expect(container.querySelector('#gt-failure textarea')).toBeNull();
    expect(container.querySelector('#gt-failure')!.textContent).toContain(failure);
  });

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
