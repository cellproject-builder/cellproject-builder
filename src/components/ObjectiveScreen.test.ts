import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import * as aiService from '@/ai/service';
import { useGraphStore, EMPTY_OBJECTIVE_DRAFT } from '@/store';
import { useKBStore } from '@/kb/store';
import { useConfigStore } from '@/config/store';
import { hasActiveAIActions } from '@/ai/actions';
import { useWorkspaceStore } from '@/workspace/store';
import { initializeWorkspace, openPlanner } from '@/workspace/planner';
import {
  MAX_PLANS,
  ObjectiveScreen,
  assembleTree,
  formatClock,
  groupByStrategy,
  mergePlanBatches,
  mergeRules,
  normalizeRanks,
  outlineFromPlan,
  parseRules,
  sameRules,
} from './ObjectiveScreen';
import { en, ptBR } from '@/i18n/messages';
import type { AIPlan, AIPlanOutline } from '@/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('geração sem chave de API', () => {
  const savedOutline: AIPlanOutline = {
    id: 'saved-plan', title: 'Plano salvo', pitch: 'Um caminho para compreender circuitos',
    approach: 'Explorar cada parte', strategy: 'do_zero', archetype: 'entender', rank: 1, rankReason: 'Direto',
    outline: { categorias: [{ name: 'Partes', kind: 'execucao', nodes: [] }] },
  };
  const savedPlan: AIPlan = {
    ...savedOutline,
    tree: { categorias: [{ tempId: 'parts', name: 'Partes', kind: 'execucao', oQue: 'Partes', porQue: 'Compreender', children: [] }] },
  };

  it.each([
    { provider: null, action: 'generate' },
    { provider: 'openai', action: 'generate' },
    { provider: null, action: 'more' },
    { provider: null, action: 'expand' },
    { provider: null, action: 'start' },
    { provider: null, action: 'cached' },
  ] as const)('protege chamadas de IA sem bloquear um plano já salvo ($provider, $action)', async ({ provider, action }) => {
    const graphBefore = useGraphStore.getState();
    const configBefore = useConfigStore.getState();
    useGraphStore.getState().clearObjectiveDraft();
    useGraphStore.getState().setObjectiveDraft({ objective: 'aprender a ler um circuito' });
    if (action !== 'generate') {
      useGraphStore.getState().setOutlines([savedOutline], { objective: 'aprender a ler um circuito', rules: [] });
      if (action === 'start' || action === 'cached') {
        useGraphStore.getState().setObjectiveDraft({ selectedId: savedOutline.id });
      }
      if (action === 'cached') useGraphStore.getState().setExpandedPlan(savedOutline.id, savedPlan);
    }
    useConfigStore.setState({
      activeProvider: provider,
      providers: provider ? { openai: { apiKey: '   ', mainModel: 'gpt-4o', kbModel: 'gpt-4o-mini' } } : {},
    });
    const kb = vi.spyOn(useKBStore.getState(), 'getContextFor').mockResolvedValue([]);
    const outline = vi.spyOn(aiService, 'outlinePlans').mockResolvedValue([]);
    const expand = vi.spyOn(aiService, 'expandPlan').mockResolvedValue(savedPlan);
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(ObjectiveScreen)));
      const labels = action === 'generate'
        ? [en.objective.generate, ptBR.objective.generate]
        : action === 'more'
        ? [en.objective.morePlans, ptBR.objective.morePlans]
        : action === 'expand'
        ? [savedOutline.title]
        : [en.objective.startWith(savedOutline.title), ptBR.objective.startWith(savedOutline.title)];
      const trigger = [...container.querySelectorAll('button')].find((button) =>
        labels.some((label) => button.textContent?.includes(label)),
      );
      expect(trigger).toBeTruthy();
      await act(async () => trigger!.click());
      expect(kb).not.toHaveBeenCalled();
      expect(outline).not.toHaveBeenCalled();
      expect(expand).not.toHaveBeenCalled();
      if (action === 'cached') {
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(useGraphStore.getState().project?.objective).toBe('aprender a ler um circuito');
        expect(useGraphStore.getState().project?.name).toBe('Plano salvo');
      } else {
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
        expect(useGraphStore.getState().objectiveDraft.objective).toBe('aprender a ler um circuito');
      }
      expect(useGraphStore.getState().objectiveDraft.generatingSince).toBeNull();
      expect(useGraphStore.getState().objectiveDraft.expansion).toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      useGraphStore.setState(graphBefore);
      useConfigStore.setState(configBefore);
    }
  });
});

describe('cancelamento ao sair da tela de objetivo', () => {
  it.each([
    { action: 'generate', replaceMarker: false },
    { action: 'more', replaceMarker: false },
    { action: 'generate', replaceMarker: true },
  ] as const)('libera apenas seu marcador e preserva o rascunho ($action, outro marcador: $replaceMarker)', async ({ action, replaceMarker }) => {
    const graphBefore = useGraphStore.getState();
    const workspaceBefore = useWorkspaceStore.getState();
    const configBefore = useConfigStore.getState();
    useWorkspaceStore.setState({ projects: {}, legacyImported: true });
    useGraphStore.setState({ project: null, archivedProject: null, aiJobs: {}, pendingSuggestions: null,
      parkedSuggestions: {}, objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT } });
    initializeWorkspace();
    const first = useWorkspaceStore.getState().createProject('Primeiro', 'Compreender circuitos');
    const other = useWorkspaceStore.getState().createProject('Outro', 'Compreender motores');
    openPlanner(first);
    const cachedPlan: AIPlan = { id: 'cached', title: 'Plano pago', pitch: 'Explorar circuitos', approach: 'Por partes',
      strategy: 'do_zero', archetype: 'entender', rank: 1, rankReason: 'Direto', tree: { categorias: [] } };
    const { tree: _tree, ...header } = cachedPlan;
    const cachedOutline: AIPlanOutline = { ...header, outline: { categorias: [] } };
    useGraphStore.getState().setObjectiveDraft({ rules: ['Preservar o circuito'], outlines: [cachedOutline],
      expanded: { cached: cachedPlan }, plansFor: null });
    useConfigStore.setState({ activeProvider: 'openai',
      providers: { openai: { apiKey: 'fake-nonsecret-test-key', mainModel: 'gpt-4o', kbModel: 'gpt-4o-mini' } } });
    let rejectGeneration!: (reason: Error) => void;
    let actionSignal: AbortSignal | undefined;
    const deferred = new Promise<AIPlanOutline[]>((_resolve, reject) => { rejectGeneration = reject; });
    vi.spyOn(aiService, 'outlinePlans').mockImplementation((_objective, _progress, _kb, _rules, _existing, options) => {
      actionSignal = options?.signal;
      return deferred;
    });
    vi.spyOn(useKBStore.getState(), 'getContextFor').mockResolvedValue([]);
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    let unmounted = false;
    try {
      await act(async () => root.render(createElement(ObjectiveScreen)));
      const buttonWith = (labels: string[]) => [...container.querySelectorAll('button')]
        .find((button) => labels.some((label) => button.textContent?.includes(label)));
      if (action === 'generate') {
        act(() => buttonWith([en.common.back, ptBR.common.back])!.click());
        act(() => buttonWith([en.objective.regenerate, ptBR.objective.regenerate])!.click());
      } else act(() => buttonWith([en.objective.morePlans, ptBR.objective.morePlans])!.click());
      const ownMarker = useGraphStore.getState().objectiveDraft.generatingSince!;
      expect(ownMarker).toBeGreaterThan(0);
      expect(hasActiveAIActions()).toBe(true);
      if (replaceMarker) useGraphStore.getState().setObjectiveDraft({ generatingSince: ownMarker + 1 });
      act(() => root.unmount());
      unmounted = true;
      expect(actionSignal?.aborted).toBe(true);
      await act(async () => rejectGeneration(new DOMException('Canceled test request', 'AbortError')));
      expect(hasActiveAIActions()).toBe(false);
      const draft = useGraphStore.getState().objectiveDraft;
      expect(draft.rules).toEqual(['Preservar o circuito']);
      expect(draft.expanded.cached).toEqual(cachedPlan);
      expect(draft.outlines).toEqual([cachedOutline]);
      expect(draft.generatingSince).toBe(replaceMarker ? ownMarker + 1 : null);
      if (replaceMarker) expect(() => openPlanner(other)).toThrow('plannerBusy');
      else {
        expect(() => openPlanner(other)).not.toThrow();
        expect(useGraphStore.getState().objectiveDraft.objective).toBe('Compreender motores');
      }
    } finally {
      if (!unmounted) act(() => root.unmount());
      await act(async () => rejectGeneration(new DOMException('Cleanup', 'AbortError')));
      container.remove();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      useGraphStore.setState(graphBefore);
      useWorkspaceStore.setState(workspaceBefore);
      useConfigStore.setState(configBefore);
      initializeWorkspace();
    }
  });
});

describe('explicit planning approach in the objective form', () => {
  it('persists the selected starting point, synchronizes the reference from chat and passes both to generation', async () => {
    const graphBefore = useGraphStore.getState(), configBefore = useConfigStore.getState();
    useGraphStore.setState({ project: null, objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT, objective: 'Construir um patinete caseiro' } });
    useConfigStore.setState({ activeProvider: 'openai', providers: { openai: { apiKey: 'nonsecret-test-key', mainModel: 'gpt-4o', kbModel: 'gpt-4o-mini' } } });
    vi.spyOn(useKBStore.getState(), 'getContextFor').mockResolvedValue([]);
    const generate = vi.spyOn(aiService, 'outlinePlans').mockResolvedValue([]);
    vi.stubGlobal('requestAnimationFrame', () => 0); vi.stubGlobal('cancelAnimationFrame', () => {});
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(ObjectiveScreen)));
      expect(container.querySelector('[data-plan-approach="new_creation"]')?.getAttribute('aria-checked')).toBe('true');
      await act(async () => (container.querySelector('[data-plan-approach="reverse_engineering"]') as HTMLButtonElement).click());
      expect(useGraphStore.getState().objectiveDraft.planApproach).toBe('reverse_engineering');
      await act(async () => useGraphStore.getState().setObjectiveDraft({ referenceTarget: 'Produto real, variante a confirmar pela etiqueta' }));
      expect((container.querySelector('#cp-reference-target') as HTMLInputElement).value).toBe('Produto real, variante a confirmar pela etiqueta');
      expect(container.querySelector('#cp-reference-target-hint')?.textContent).toMatch(/variants|Variantes/);
      const generateButton = [...container.querySelectorAll('button')].find(button => [en.objective.generate, ptBR.objective.generate].some(label => button.textContent?.includes(label)));
      expect(generateButton).toBeTruthy(); await act(async () => generateButton!.click());
      expect(generate.mock.calls[0][5]).toMatchObject({ planApproach: 'reverse_engineering', referenceTarget: 'Produto real, variante a confirmar pela etiqueta' });
      expect(useGraphStore.getState().objectiveDraft.plansFor).toMatchObject({ planApproach: 'reverse_engineering', referenceTarget: 'Produto real, variante a confirmar pela etiqueta' });
    } finally {
      act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
      useGraphStore.setState(graphBefore); useConfigStore.setState(configBefore);
    }
  });

  it.each(['generate', 'more', 'expand'] as const)('discards the %s response when the reference changes while it is running', async action => {
    const graphBefore = useGraphStore.getState(), configBefore = useConfigStore.getState();
    const intent = { planApproach: 'reverse_engineering' as const, referenceTarget: 'Modelo A' };
    const outline: AIPlanOutline = { id: 'old', title: 'Plano A', pitch: '', approach: '', strategy: 'hibrido', archetype: 'construir', rank: 1, rankReason: '', ...intent, outline: { categorias: [] } };
    useGraphStore.setState({ project: null, objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT, objective: 'Construir patinete', ...intent } });
    if (action !== 'generate') useGraphStore.getState().setOutlines([outline], { objective: 'Construir patinete', rules: [], ...intent });
    useConfigStore.setState({ activeProvider: 'openai', providers: { openai: { apiKey: 'nonsecret-test-key', mainModel: 'gpt-4o', kbModel: 'gpt-4o-mini' } } });
    vi.spyOn(useKBStore.getState(), 'getContextFor').mockResolvedValue([]);
    let resolveOutlines!: (outlines: AIPlanOutline[]) => void, resolvePlan!: (plan: AIPlan) => void;
    const generation = vi.spyOn(aiService, 'outlinePlans').mockReturnValue(new Promise(resolve => { resolveOutlines = resolve; }));
    const expansion = vi.spyOn(aiService, 'expandPlan').mockReturnValue(new Promise(resolve => { resolvePlan = resolve; }));
    vi.stubGlobal('requestAnimationFrame', () => 0); vi.stubGlobal('cancelAnimationFrame', () => {});
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(ObjectiveScreen)));
      const labels = action === 'generate' ? [en.objective.generate, ptBR.objective.generate] : action === 'more' ? [en.objective.morePlans, ptBR.objective.morePlans] : [outline.title];
      const trigger = [...container.querySelectorAll('button')].find(button => labels.some(label => button.textContent?.includes(label)));
      expect(trigger).toBeTruthy(); await act(async () => trigger!.click());
      expect(action === 'expand' ? expansion : generation).toHaveBeenCalledOnce();
      await act(async () => useGraphStore.getState().setObjectiveDraft({ referenceTarget: 'Modelo B' }));
      await act(async () => {
        if (action === 'expand') resolvePlan({ ...outline, tree: { categorias: [] } });
        else resolveOutlines([{ ...outline, id: 'obsolete' }]);
      });
      const draft = useGraphStore.getState().objectiveDraft;
      expect(draft.referenceTarget).toBe('Modelo B');
      expect(draft.outlines?.some(value => value.id === 'obsolete') ?? false).toBe(false);
      expect(draft.expanded.old).toBeUndefined();
      expect(draft.expansion).toBeNull(); expect(draft.generatingSince).toBeNull();
      expect(useGraphStore.getState().project).toBeNull();
    } finally {
      act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
      useGraphStore.setState(graphBefore); useConfigStore.setState(configBefore);
    }
  });
});

type P = { id: string; rank: number; strategy: 'reaproveitar' | 'hibrido' | 'do_zero' };
const plan = (id: string, rank: number, strategy: P['strategy'] = 'reaproveitar'): P => ({
  id,
  rank,
  strategy,
});

describe('regras', () => {
  it('separa por ";" e quebra de linha, ignorando vazios', () => {
    expect(parseRules('orçamento R$300; sem solda\n\n  2 fins de semana  ;')).toEqual([
      'orçamento R$300',
      'sem solda',
      '2 fins de semana',
    ]);
    expect(parseRules('   ')).toEqual([]);
  });

  it('junta sem duplicar (caixa e espaços não contam)', () => {
    expect(mergeRules(['Sem solda'], ['sem solda ', 'até R$ 300'])).toEqual(['Sem solda', 'até R$ 300']);
  });

  it('compara conjuntos de regras independente da ordem', () => {
    expect(sameRules(['a', 'B'], ['b', 'a'])).toBe(true);
    expect(sameRules(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('ranking dos planos', () => {
  it('normaliza para 1..N com um único #1', () => {
    const out = normalizeRanks([plan('a', 2), plan('b', 2), plan('c', 7)]);
    expect(out.map((p) => [p.id, p.rank])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
  });

  it('após "gerar mais": um só ★, empate favorece o lote antigo, novos marcados', () => {
    const prev = [plan('a', 1), plan('b', 2), plan('c', 3)];
    const incoming = [plan('x', 1), plan('y', 4), plan('z', 2)];
    const { plans, newIds } = mergePlanBatches(prev, incoming);
    expect(plans.filter((p) => p.rank === 1)).toHaveLength(1);
    expect(plans[0].id).toBe('a');
    expect(plans.map((p) => p.id)).toEqual(['a', 'x', 'b', 'z', 'c', 'y']);
    expect(plans.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(newIds.sort()).toEqual(['x', 'y', 'z']);
  });

  it('corta no teto de planos', () => {
    const prev = Array.from({ length: 8 }, (_, i) => plan(`p${i}`, i + 1));
    const { plans, newIds } = mergePlanBatches(prev, [plan('n1', 20), plan('n2', 21), plan('n3', 1)]);
    expect(plans).toHaveLength(MAX_PLANS);
    expect(newIds).toEqual(['n3']);
  });

  it('agrupa por estratégia, grupos na ordem do melhor rank', () => {
    const groups = groupByStrategy([
      plan('a', 3, 'do_zero'),
      plan('b', 1, 'hibrido'),
      plan('c', 2, 'do_zero'),
    ]);
    expect(groups.map((g) => g.strategy)).toEqual(['hibrido', 'do_zero']);
    expect(groups[1].plans.map((p) => p.id)).toEqual(['c', 'a']);
  });
});

describe('relógio', () => {
  it('formata m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65_400)).toBe('1:05');
  });
});

describe('copy da tela de objetivo', () => {
  it('pt-BR sem jargão técnico ("chunks", "token", "f(X)", "AI")', () => {
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string') strings.push(v);
      else if (typeof v === 'function') {
        const out = (v as (...a: unknown[]) => unknown)('x', 'y', 'z');
        if (typeof out === 'string') strings.push(out);
      } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(ptBR.objective);
    walk(ptBR.apiKey);
    const text = strings.join('\n');
    expect(text).not.toMatch(/chunk|token|f\(X\)/i);
    expect(text).not.toMatch(/\bAI\b/);
  });

  it('en e pt-BR têm os mesmos exemplos', () => {
    expect(ptBR.objective.examples).toHaveLength(en.objective.examples.length);
  });
});

describe('duas fases: esboço e árvore montando', () => {
  const outline = {
    id: 'o1',
    title: 'Plano',
    outline: {
      categorias: [
        { name: 'Recursos', kind: 'recursos', nodes: [{ name: 'Motor', kind: 'recurso' }, { name: 'Bateria', kind: 'recurso' }] },
        { name: 'Execução', kind: 'execucao', nodes: [{ name: 'Montar', kind: 'passo' }, { name: 'Testar', kind: 'passo' }] },
      ],
    },
  } as unknown as AIPlanOutline;

  it('sem parcial: tudo pendente, com os nomes do esboço', () => {
    const tree = assembleTree(outline, undefined);
    expect(tree.map((c) => c.name)).toEqual(['Recursos', 'Execução']);
    expect(tree.flatMap((c) => c.nodes.map((n) => n.state))).toEqual(['pending', 'pending', 'pending', 'pending']);
  });

  it('parcial: pronto quando o seguinte começou, o último está sendo escrito, o resto pendente', () => {
    const tree = assembleTree(outline, {
      categorias: [
        { name: 'Recursos', children: [{ name: 'Motor 2207 (4x)' }, { name: 'Bateria' }] },
        { name: 'Execução', children: [{ name: 'Montar o frame' }] },
      ],
    });
    expect(tree[0].nodes.map((n) => [n.name, n.state])).toEqual([
      ['Motor 2207 (4x)', 'ready'],
      ['Bateria', 'ready'],
    ]);
    expect(tree[1].nodes.map((n) => [n.name, n.state])).toEqual([
      ['Montar o frame', 'writing'],
      ['Testar', 'pending'],
    ]);
  });

  it('rascunho antigo: plano completo vira esboço com os mesmos nomes', () => {
    const plan = {
      id: 'p1',
      title: 'T',
      rank: 1,
      tree: {
        categorias: [
          { tempId: 'c', name: 'Recursos', kind: 'recursos', oQue: '', porQue: '', children: [{ tempId: 'r', name: 'Motor', kind: 'recurso' }] },
        ],
      },
    } as unknown as AIPlan;
    const o = outlineFromPlan(plan);
    expect('tree' in o).toBe(false);
    expect(o.id).toBe('p1');
    expect(o.outline.categorias[0].nodes).toEqual([{ name: 'Motor', kind: 'recurso' }]);
  });

  it('copy das duas fases nos dois idiomas, sem caixa alta', () => {
    for (const m of [en, ptBR]) {
      const tp = m.ai.twoPhase;
      for (const v of [tp.outlineOnly, tp.expandingHint, tp.startingHint, tp.backToPlans, tp.startingTitle('x')]) {
        expect(v.trim().length).toBeGreaterThan(0);
        expect(v).not.toMatch(/[A-ZÁÉÍÓÚÇ]{4,}/);
      }
    }
  });
});
