import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { useGraphStore } from '@/store';
import { useToastStore } from './ui/Toast';
import { TutorMode } from './TutorMode';
import { ReadingMode } from './ReadingMode';
import { ExplanationContent, extractHeadings } from './Markdown';
import type { AIPlan, ConceptNodeData } from '@/types';

// Testes do loop do tutor (pacote D1): card fixo no pai durante a revisão,
// toast com desfazer e o modo leitura sem vazar o critério da IA.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

type Staged = Omit<ConceptNodeData, 'id' | 'parentId' | 'history'> & { tempId: string };

const staged = (tempId: string, name: string, order: number): Staged => ({
  tempId,
  kind: 'passo',
  name,
  fx: 'fx',
  problem: '',
  confidence: 80,
  confidenceSource: 'ai',
  confidenceReason: 'r',
  pros: [],
  cons: [],
  oQue: `o que ${name}`,
  porQue: 'porque',
  comoConfirmar: 'CRITERIO-SECRETO-DA-IA',
  confirmado: false,
  order,
  state: 'concept',
  notes: '',
  aiSuggested: true,
  position: { x: 0, y: 0 },
});

const nodeByName = (name: string) =>
  Object.values(useGraphStore.getState().project!.nodes).find((n) => n.name === name)!;

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  const st = useGraphStore.getState();
  st.resetProject();
  st.createProjectFromPlan('obj', 'Teste', plan);
  const cat = Object.values(useGraphStore.getState().project!.nodes).find((n) => n.kind === 'categoria')!;
  useGraphStore.getState().stageSuggestions(cat.id, [staged('a', 'Passo pai', 0)], []);
  useGraphStore.getState().acceptAllSuggestions();
  useGraphStore.setState({ viewMode: 'tutor', selectedNodeId: null });
  useToastStore.setState({ toasts: [] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = () => act(() => root.render(<TutorMode />));
const title = () => container.querySelector('h1')?.textContent;

describe('TutorMode — card fixo no pai durante a revisão', () => {
  it('aceitar 1 de 4 sugestões mantém o card no pai com as 3 restantes visíveis', () => {
    const parent = nodeByName('Passo pai');
    act(() => {
      useGraphStore
        .getState()
        .stageSuggestions(
          parent.id,
          [staged('s1', 'Filho 1', 0), staged('s2', 'Filho 2', 1), staged('s3', 'Filho 3', 2), staged('s4', 'Filho 4', 3)],
          [],
        );
    });
    render();
    expect(title()).toBe('Passo pai');

    act(() => useGraphStore.getState().acceptSuggestion('s1'));
    expect(title()).toBe('Passo pai');
    const text = container.textContent ?? '';
    expect(text).toContain('Filho 2');
    expect(text).toContain('Filho 3');
    expect(text).toContain('Filho 4');
  });

  it('quando o staging esvazia, desce para o primeiro filho', () => {
    const parent = nodeByName('Passo pai');
    act(() => {
      useGraphStore
        .getState()
        .stageSuggestions(parent.id, [staged('s1', 'Filho 1', 0), staged('s2', 'Filho 2', 1)], []);
    });
    render();
    act(() => useGraphStore.getState().acceptAllSuggestions());
    expect(title()).toBe('Filho 1');
  });

  it('com outro nó selecionado, mostra o banner de sugestões aguardando revisão', () => {
    const parent = nodeByName('Passo pai');
    const cat = Object.values(useGraphStore.getState().project!.nodes).find((n) => n.kind === 'categoria')!;
    act(() => {
      useGraphStore.getState().stageSuggestions(cat.id, [staged('o1', 'Outro passo', 1)], []);
      useGraphStore.getState().acceptAllSuggestions();
      useGraphStore.getState().stageSuggestions(parent.id, [staged('s1', 'Filho 1', 0)], []);
      useGraphStore.getState().selectNode(nodeByName('Outro passo').id);
    });
    render();
    expect(title()).toBe('Outro passo');
    const banner = [...container.querySelectorAll('button')].find((b) => /Revisar|Review/.test(b.textContent ?? ''));
    expect(banner).toBeTruthy();
    act(() => banner!.click());
    expect(title()).toBe('Passo pai');
  });
});

describe('TutorMode — confirmar com toast e desfazer', () => {
  it('confirmar sem prova mostra toast com Desfazer que restaura o nó', () => {
    render();
    expect(title()).toBe('Passo pai');
    const btn = (re: RegExp) => [...container.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''));

    // Gate: sem critério, o lugar principal leva ao critério; "Confirmar sem
    // prova…" mora no "…" e ainda pede o 2º passo.
    expect(btn(/Escrever meu critério|Write my criterion/)).toBeTruthy();
    act(() => container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
    act(() => btn(/sem prova…|without proof…/)!.click());
    act(() => btn(/✓ Confirmar sem prova|✓ Confirm without proof/)!.click());

    const parentId = nodeByName('Passo pai').id;
    expect(useGraphStore.getState().project!.nodes[parentId].confirmado).toBe(true);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].tone).toBe('warn');

    act(() => toasts[0].action!.onClick());
    expect(useGraphStore.getState().project!.nodes[parentId].confirmado).toBe(false);
  });

  it('critério travado e não aferido: a dica fala em aferir', () => {
    const parentId = nodeByName('Passo pai').id;
    act(() => useGraphStore.getState().setUserCriterion(parentId, 'o LED acende'));
    render();
    expect(container.textContent).toMatch(/critério foi atendido|criterion was met/);
  });
});

describe('ReadingMode — critério do usuário antes do da IA', () => {
  it('não mostra o critério da IA antes do lock', () => {
    const parent = nodeByName('Passo pai');
    act(() => root.render(<ReadingMode node={parent} breadcrumb={[]} onClose={() => {}} />));
    expect(document.body.textContent).not.toContain('CRITERIO-SECRETO-DA-IA');
  });

  it('segura o critério da IA durante a janela de desfazer do lock', () => {
    const parentId = nodeByName('Passo pai').id;
    act(() => useGraphStore.getState().setUserCriterion(parentId, 'meu critério'));
    const parent = useGraphStore.getState().project!.nodes[parentId];
    act(() => root.render(<ReadingMode node={parent} breadcrumb={[]} onClose={() => {}} />));
    expect(document.body.textContent).not.toContain('CRITERIO-SECRETO-DA-IA');
    expect(document.body.textContent).toContain('meu critério');
  });

  it('mostra o critério da IA depois do lock e da janela de desfazer', () => {
    const parentId = nodeByName('Passo pai').id;
    act(() => useGraphStore.getState().setUserCriterion(parentId, 'meu critério'));
    const locked = useGraphStore.getState().project!.nodes[parentId];
    // Lock de 11s atrás: a janela de 10s para destravar já passou.
    const parent = { ...locked, comoConfirmarUsuarioAt: Date.now() - 11_000 };
    act(() => root.render(<ReadingMode node={parent} breadcrumb={[]} onClose={() => {}} />));
    expect(document.body.textContent).toContain('CRITERIO-SECRETO-DA-IA');
    expect(document.body.textContent).toContain('meu critério');
  });
});

describe('Markdown', () => {
  it('extrai títulos e gera ids para o índice', () => {
    const md = '**O QUE É**\ntexto\n## Como fazer\n```\n# não é título\n```\n- item';
    expect(extractHeadings(md)).toEqual(['O QUE É', 'Como fazer']);
    const html = renderToStaticMarkup(<ExplanationContent text={md} idPrefix="x" />);
    expect(html).toContain('id="x-h-0"');
    expect(html).toContain('id="x-h-1"');
    expect(html).not.toContain('id="x-h-2"');
  });

  it('renderiza itálico, tabela simples e sub-bullets indentados', () => {
    const md = 'um *destaque* e **forte**\n| a | b |\n|---|---|\n| 1 | 2 |\n- pai\n  - filho';
    const html = renderToStaticMarkup(<ExplanationContent text={md} />);
    expect(html).toContain('<em class="italic">destaque</em>');
    expect(html).toContain('<table');
    expect(html).toContain('<td');
    expect(html).toContain('margin-left:16px');
  });
});
