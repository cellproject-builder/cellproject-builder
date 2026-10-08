import { safeHref } from '@/safeHref';
import { useEffect, useRef, useState } from 'react';
import {
  outlinePlans,
  expandPlan,
  countOutlineNodes,
  type AIErrorInfo,
  type ExistingPlanSummary,
  type ExpandProgressEvent,
  type OutlineProgressEvent,
} from '@/ai/service';
import { useGraphStore } from '@/store';
import { useKBStore } from '@/kb/store';
import { useConfigStore, type Provider } from '@/config/store';
import { useLocaleStore, useT, type Messages } from '@/i18n';
import type { AIPlan, AIPlanOutline, ConstructionStrategy, WebResearchDigest } from '@/types';
import { useAIAction } from '@/hooks/useAIAction';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { InlineError } from './ui/InlineError';
import { toast } from './ui/Toast';
import { ApiKeyGate, modelDisplay } from './ApiKeyGate';
import { KnowledgeRepo } from './KnowledgeRepo';
import { LanguageToggle } from './LanguageToggle';
import { OverflowMenu } from './ui/OverflowMenu';

// ---------------------------------------------------------------------------
// Helpers puros (testados em ObjectiveScreen.test.ts)
// ---------------------------------------------------------------------------

// Teto de planos na tela: 3 lotes. Mais que isso vira ruído, não escolha.
export const MAX_PLANS = 9;
// Planos por lote — o prompt pede exatamente 3.
const PLANS_PER_BATCH = 3;

// Várias regras coladas de uma vez: uma por linha ou separadas por ";".
export function parseRules(text: string): string[] {
  return text
    .split(/[;\n\r]+/)
    .map((r) => r.trim())
    .filter(Boolean);
}

// Junta sem duplicar (comparação sem caixa/espaços extras), mantendo a ordem.
export function mergeRules(rules: string[], extra: string[]): string[] {
  const seen = new Set(rules.map((r) => r.trim().toLowerCase()));
  const out = [...rules];
  for (const r of extra) {
    const key = r.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r.trim());
  }
  return out;
}

export function sameRules(a: string[], b: string[]): boolean {
  const norm = (xs: string[]) => [...new Set(xs.map((x) => x.trim().toLowerCase()))].sort().join('\n');
  return norm(a) === norm(b);
}

// Rank 1..N sem buracos nem empates. Sort estável: empate → quem veio antes
// na lista (lote mais antigo) fica na frente. Garante um único ★.
export function normalizeRanks<P extends { rank: number }>(plans: P[]): P[] {
  return plans
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.rank - b.p.rank || a.i - b.i)
    .map(({ p }, i) => ({ ...p, rank: i + 1 }));
}

// Funde um lote novo nos planos atuais: re-ranqueia o conjunto inteiro e corta
// no teto (os piores saem). `newIds` = planos do lote novo que sobreviveram.
export function mergePlanBatches<P extends { id: string; rank: number }>(
  prev: P[],
  incoming: P[],
  max = MAX_PLANS,
): { plans: P[]; newIds: string[] } {
  const plans = normalizeRanks([...prev, ...incoming])
    .slice(0, max)
    .map((p, i) => ({ ...p, rank: i + 1 }));
  const incomingIds = new Set(incoming.map((p) => p.id));
  return { plans, newIds: plans.filter((p) => incomingIds.has(p.id)).map((p) => p.id) };
}

// Agrupa por estratégia; grupos ordenados pelo melhor rank de cada um.
export function groupByStrategy<P extends { strategy: ConstructionStrategy; rank: number }>(
  plans: P[],
): { strategy: ConstructionStrategy; plans: P[] }[] {
  const map = new Map<ConstructionStrategy, P[]>();
  for (const p of [...plans].sort((a, b) => a.rank - b.rank)) {
    const list = map.get(p.strategy) ?? [];
    list.push(p);
    map.set(p.strategy, list);
  }
  return [...map.entries()].map(([strategy, ps]) => ({ strategy, plans: ps }));
}

// Relógio "m:ss" — legível pra leigo, sem casas decimais.
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Rascunho antigo (planos completos de antes das duas fases): vira esboço +
// árvore já em cache, sem gastar nada de novo.
export function outlineFromPlan(plan: AIPlan): AIPlanOutline {
  const { tree, ...header } = plan;
  return {
    ...header,
    outline: {
      categorias: tree.categorias.map((c) => ({
        name: c.name,
        kind: c.kind,
        nodes: c.children.map((n) => ({ name: n.name, kind: n.kind })),
      })),
    },
  };
}

// Uma linha da árvore no card: pronta, sendo escrita agora, ou só no esboço.
export type TreeRowState = 'ready' | 'writing' | 'pending';
export interface TreeView {
  key: string;
  name: string;
  nodes: { key: string; name: string; state: TreeRowState }[];
}

// A árvore montando: o que já chegou do stream da expansão (com o nome que o
// modelo afinou) seguido do resto do esboço, ainda pendente. Um nó está pronto
// quando o seguinte já começou — o JSON chega em ordem.
export function assembleTree(
  outline: AIPlanOutline,
  partial: ExpandProgressEvent['partial'] | undefined,
): TreeView[] {
  const pcats = partial?.categorias ?? [];
  const total = Math.max(outline.outline.categorias.length, pcats.length);
  const out: TreeView[] = [];
  for (let i = 0; i < total; i++) {
    const oc = outline.outline.categorias[i];
    const pc = pcats[i];
    const written = (pc?.children ?? []).filter((c) => !!c?.name?.trim());
    const laterStarted = pcats.slice(i + 1).some((c) => !!c?.name);
    const nodes: TreeView['nodes'] = written.map((c, j) => ({
      key: `w${j}`,
      name: c!.name!.trim(),
      state: j < written.length - 1 || laterStarted ? 'ready' : 'writing',
    }));
    (oc?.nodes ?? []).slice(written.length).forEach((n, j) => {
      nodes.push({ key: `o${written.length + j}`, name: n.name, state: 'pending' });
    });
    const name = pc?.name?.trim() || oc?.name || '';
    if (!name && nodes.length === 0) continue;
    out.push({ key: `c${i}`, name, nodes });
  }
  return out;
}

const CREDITS_URL: Record<Provider, string> = {
  openrouter: 'https://openrouter.ai/settings/credits',
  openai: 'https://platform.openai.com/settings/organization/billing/overview',
  anthropic: 'https://console.anthropic.com/settings/billing',
};

type View = 'form' | 'plans';

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

export function ObjectiveScreen() {
  const tr = useT();
  const locale = useLocaleStore((s) => s.locale);
  const isMobile = useIsMobile();

  // Rascunho persistido (store → IndexedDB): nada se perde ao recarregar.
  // O App só monta esta tela depois da hidratação, então ler uma vez basta.
  const [draft0] = useState(() => useGraphStore.getState().objectiveDraft);
  const setObjectiveDraft = useGraphStore((s) => s.setObjectiveDraft);
  const setOutlines = useGraphStore((s) => s.setOutlines);
  const setExpandedPlan = useGraphStore((s) => s.setExpandedPlan);
  const setExpansion = useGraphStore((s) => s.setExpansion);
  const createProjectFromOutline = useGraphStore((s) => s.createProjectFromOutline);
  const loadDemoProject = useGraphStore((s) => s.loadDemoProject);
  const archivedProject = useGraphStore((s) => s.archivedProject);
  const undoReset = useGraphStore((s) => s.undoReset);

  // Esboços, cache de árvores e o "para quê" vivem só no store.
  const storedOutlines = useGraphStore((s) => s.objectiveDraft.outlines);
  const outlines = storedOutlines && storedOutlines.length > 0 ? storedOutlines : null;
  const expanded = useGraphStore((s) => s.objectiveDraft.expanded);
  const plansFor = useGraphStore((s) => s.objectiveDraft.plansFor);
  const outlineResearch = useGraphStore((s) => s.objectiveDraft.outlineResearch);

  const hasLegacyPlans = !draft0.outlines?.length && !!draft0.plans?.length;
  const [name, setName] = useState(draft0.name);
  const [objective, setObjective] = useState(draft0.objective);
  const [rules, setRules] = useState<string[]>(draft0.rules);
  const [ruleDraft, setRuleDraft] = useState(draft0.ruleDraft);
  const [selectedId, setSelectedId] = useState<string | null>(draft0.selectedId);
  const [view, setView] = useState<View>(
    draft0.outlines?.length || hasLegacyPlans ? 'plans' : 'form',
  );
  const [newIds, setNewIds] = useState<string[]>([]);
  // Avisos de retomada: planos restaurados / geração interrompida pelo reload.
  const [restoredAt, setRestoredAt] = useState<number | null>(
    draft0.outlines?.length || hasLegacyPlans ? draft0.updatedAt || null : null,
  );
  const [interrupted, setInterrupted] = useState(draft0.generatingSince != null);

  const [progress, setProgress] = useState<OutlineProgressEvent | null>(null);
  const [kbOpen, setKbOpen] = useState(false);
  const [kbUsed, setKbUsed] = useState<{ titulo: string; docId: string }[]>([]);
  const [settings, setSettings] = useState<{ advanced: boolean } | null>(null);

  // Expansão (fase 2): um plano por vez, o selecionado.
  const [expandProgress, setExpandProgress] = useState<ExpandProgressEvent | null>(null);
  const [expandingId, setExpandingId] = useState<string | null>(null);
  // "Começar" clicado sem a árvore pronta: tela de espera até o cache chegar.
  const [starting, setStarting] = useState(false);

  const kbCount = useKBStore((s) => Object.keys(s.docs).length);
  const getContextFor = useKBStore((s) => s.getContextFor);
  const webResearch = useConfigStore((s) => s.webResearchEnabled);
  const setWebResearch = useConfigStore((s) => s.setWebResearchEnabled);
  const activeProvider = useConfigStore((s) => s.activeProvider);
  const activeConfig = useConfigStore((s) =>
    s.activeProvider ? s.providers[s.activeProvider] : undefined,
  );

  // Pesquisa web feita junto com o lote de esboços — a expansão reaproveita.
  const batchResearchRef = useRef<WebResearchDigest | null>(null);

  // Fase 1: KB + (pesquisa) + esboços, com cancelamento real.
  const runOutlines = async (
    signal: AbortSignal,
    objectiveText: string,
    effRules: string[],
    existing?: ExistingPlanSummary[],
  ) => {
    batchResearchRef.current = null;
    const kbPromise = getContextFor({ label: tr.notify.objectivePromptLabel(objectiveText) });
    kbPromise.then(
      (kb) => {
        if (!signal.aborted && kb.length > 0) {
          setKbUsed(kb.map((c) => ({ titulo: c.titulo, docId: c.docId })));
        }
      },
      () => {}, // a falha chega pelo outlinePlans
    );
    return outlinePlans(
      objectiveText,
      (ev) => {
        if (signal.aborted) return;
        if (ev.research) batchResearchRef.current = ev.research;
        setProgress(ev);
      },
      kbPromise,
      effRules,
      existing,
      { signal },
    );
  };
  const gen = useAIAction(runOutlines);
  const more = useAIAction(runOutlines);
  const busy = gen.running || more.running;

  // Fase 2: árvore completa de um esboço.
  const runExpand = async (
    signal: AbortSignal,
    outline: AIPlanOutline,
    objectiveText: string,
    effRules: string[],
    research: WebResearchDigest | null,
  ) => {
    const kbPromise = getContextFor({ label: tr.notify.objectivePromptLabel(objectiveText) });
    return expandPlan(
      objectiveText,
      outline,
      (ev) => {
        if (signal.aborted) return;
        if (ev.warning) expandWarningRef.current = ev.warning;
        setExpandProgress(ev);
      },
      kbPromise,
      effRules,
      { signal, research },
    );
  };
  const expand = useAIAction(runExpand);
  const expandWarningRef = useRef<string | null>(null);
  // Id da expansão em voo e um token por execução: uma execução substituída
  // (troca de seleção, cancelar) não mexe mais no estado ao terminar.
  const activeExpandRef = useRef<string | null>(null);
  const expandTokenRef = useRef(0);

  const stopExpansion = () => {
    expand.cancel();
    expandTokenRef.current++;
    activeExpandRef.current = null;
    setExpandingId(null);
    setExpandProgress(null);
    if (useGraphStore.getState().objectiveDraft.expansion) setExpansion(null);
  };

  // Expansão especulativa: começa ao selecionar o card, antes do "Começar".
  const startExpansion = async (id: string) => {
    const d = useGraphStore.getState().objectiveDraft;
    const outline = d.outlines?.find((o) => o.id === id);
    if (!outline) return;
    if (d.expanded[id]) {
      // Já em cache: nada a gerar — e a expansão de outro card perde o sentido.
      if (activeExpandRef.current) stopExpansion();
      return;
    }
    if (activeExpandRef.current === id) return;
    const token = ++expandTokenRef.current;
    activeExpandRef.current = id;
    setExpandingId(id);
    setExpandProgress(null);
    expandWarningRef.current = null;
    setExpansion(id);
    const result = await expand.run(
      outline,
      d.plansFor?.objective ?? objective.trim(),
      d.plansFor?.rules ?? effectiveRules,
      d.outlineResearch,
    );
    if (token !== expandTokenRef.current) return; // substituída ou cancelada
    activeExpandRef.current = null;
    if (result) {
      setExpandedPlan(id, result);
      setExpandingId(null);
      setExpandProgress(null);
      // Árvore recuperada pela metade: avisa o que ficou de fora.
      if (expandWarningRef.current) toast.show({ message: expandWarningRef.current });
    } else if (useGraphStore.getState().objectiveDraft.expansion?.outlineId === id) {
      setExpansion(null);
    }
  };

  const mountedRef = useRef(true);
  const moreProgressRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<() => void>(() => {});
  cancelRef.current = () => {
    gen.cancel();
    more.cancel();
    stopExpansion();
  };
  const startExpansionRef = useRef(startExpansion);
  startExpansionRef.current = startExpansion;

  useEffect(() => {
    mountedRef.current = true;
    const store = useGraphStore.getState();
    // Geração que ficou "em andamento" no rascunho morreu com o reload.
    if (store.objectiveDraft.generatingSince != null) {
      store.setObjectiveDraft({ generatingSince: null });
    }
    // Rascunho de antes das duas fases: planos completos viram esboços com a
    // árvore já em cache.
    if (!store.objectiveDraft.outlines?.length && store.objectiveDraft.plans?.length) {
      const legacy = store.objectiveDraft.plans;
      store.setOutlines(legacy.map(outlineFromPlan));
      legacy.forEach((p) => store.setExpandedPlan(p.id, p));
      store.setObjectiveDraft({ plans: null, selectedId: draft0.selectedId });
    }
    // Expansão interrompida pelo reload: limpa e, se o card continua
    // selecionado, detalha de novo. (draft0 — o StrictMode monta duas vezes.)
    const interruptedExpansion = draft0.expansion;
    if (interruptedExpansion) {
      useGraphStore.getState().setExpansion(null);
      const d = useGraphStore.getState().objectiveDraft;
      if (d.selectedId === interruptedExpansion.outlineId && !d.expanded[interruptedExpansion.outlineId]) {
        void startExpansionRef.current(interruptedExpansion.outlineId);
      }
    }
    return () => {
      mountedRef.current = false;
      // Saiu da tela (demo, projeto criado): não gasta crédito à toa.
      cancelRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Espelha o formulário e a seleção no rascunho persistido.
  const firstSync = useRef(true);
  useEffect(() => {
    if (firstSync.current) {
      firstSync.current = false;
      return;
    }
    setObjectiveDraft({ name, objective, rules, ruleDraft, selectedId });
  }, [name, objective, rules, ruleDraft, selectedId, setObjectiveDraft]);

  // Regras efetivas = chips + o que ficou digitado sem "+ adicionar".
  const effectiveRules = mergeRules(rules, parseRules(ruleDraft));

  const commitPendingRules = (): string[] => {
    const eff = mergeRules(rules, parseRules(ruleDraft));
    if (ruleDraft.trim()) {
      setRules(eff);
      setRuleDraft('');
    }
    return eff;
  };

  const addRule = () => {
    const parts = parseRules(ruleDraft);
    if (parts.length === 0) return;
    setRules((r) => mergeRules(r, parts));
    setRuleDraft('');
  };

  const sameInputs =
    !!outlines &&
    !!plansFor &&
    plansFor.objective === objective.trim() &&
    sameRules(plansFor.rules, effectiveRules);

  const handleGenerate = async () => {
    const obj = objective.trim();
    if (!obj || busy) return;
    const eff = commitPendingRules();
    stopExpansion();
    setStarting(false);
    setProgress(null);
    setKbUsed([]);
    setInterrupted(false);
    // Nova geração: o aviso de "retomamos seus planos" deixou de valer.
    setRestoredAt(null);
    more.reset();
    setObjectiveDraft({ generatingSince: Date.now() });
    const result = await gen.run(obj, eff, undefined);
    if (!mountedRef.current) return;
    setObjectiveDraft({ generatingSince: null });
    if (!result) {
      // Cancelado ou erro: o erro aparece pelo gen.error; o progresso some.
      setProgress(null);
      return;
    }
    // Nada pré-selecionado: a estratégia é escolha consciente do usuário.
    setSelectedId(null);
    setOutlines(normalizeRanks(result), { objective: obj, rules: eff }, batchResearchRef.current);
    setNewIds([]);
    setRestoredAt(null);
    setView('plans');
  };

  // Mais alternativas: o prompt leva os esboços já mostrados pra explorar
  // ângulos diferentes; o conjunto todo é re-ranqueado na fusão.
  const handleMorePlans = async () => {
    if (!outlines || busy || outlines.length >= MAX_PLANS) return;
    const obj = plansFor?.objective ?? objective.trim();
    const eff = mergeRules(plansFor?.rules ?? [], commitPendingRules());
    setProgress(null);
    setInterrupted(false);
    setRestoredAt(null);
    gen.reset();
    // O painel de progresso fica abaixo dos cards: traz ele pra vista.
    requestAnimationFrame(() =>
      moreProgressRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    );
    setObjectiveDraft({ generatingSince: Date.now() });
    const existing = outlines.map((p) => ({
      title: p.title,
      strategy: p.strategy,
      approach: p.approach,
      rank: p.rank,
    }));
    const result = await more.run(obj, eff, existing);
    if (!mountedRef.current) return;
    setObjectiveDraft({ generatingSince: null });
    if (!result) {
      setProgress(null);
      return;
    }
    // Lê de novo: o cache pode ter ganhado árvores durante a geração.
    const current = useGraphStore.getState().objectiveDraft;
    const merged = mergePlanBatches(current.outlines ?? [], result);
    const keep = new Set(merged.plans.map((p) => p.id));
    if (activeExpandRef.current && !keep.has(activeExpandRef.current)) stopExpansion();
    if (selectedId && !keep.has(selectedId)) setSelectedId(null);
    setOutlines(
      merged.plans,
      { objective: obj, rules: eff },
      current.outlineResearch ?? batchResearchRef.current,
    );
    setNewIds(merged.newIds);
  };

  const handleCancel = () => {
    gen.cancel();
    more.cancel();
    setProgress(null);
    setObjectiveDraft({ generatingSince: null });
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    void startExpansion(id);
  };

  const effectiveObjective = plansFor?.objective ?? objective.trim();
  const effectiveRulesForProject = plansFor?.rules ?? effectiveRules;

  const createProject = (id: string) => {
    const outline = outlines?.find((o) => o.id === id);
    if (!outline) return false;
    cancelRef.current();
    return createProjectFromOutline(
      effectiveObjective,
      name.trim() || outline.title,
      id,
      effectiveRulesForProject,
    );
  };

  const handleConfirm = () => {
    if (!outlines || !selectedId) return;
    if (expanded[selectedId]) {
      createProject(selectedId);
      return;
    }
    // Sem a árvore ainda: espera a expansão em andamento (ou começa uma).
    setStarting(true);
    if (activeExpandRef.current !== selectedId) void startExpansion(selectedId);
  };

  // A árvore chegou enquanto o usuário esperava: cria o projeto.
  useEffect(() => {
    if (starting && selectedId && expanded[selectedId]) {
      setStarting(false);
      createProject(selectedId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starting, selectedId, expanded]);

  const applyExample = (text: string) => {
    const prev = objective;
    setObjective(text);
    if (prev.trim() && prev.trim() !== text) {
      toast.show({
        message: tr.objective.exampleReplaced,
        action: { label: tr.common.undo, onClick: () => setObjective(prev) },
      });
    }
  };

  const openSettings = (advanced: boolean) => setSettings({ advanced });

  // CTA do erro conforme o tipo: chave, modelo, créditos ou tentar de novo.
  const errorAction = (err: AIErrorInfo) => {
    if (err.kind === 'auth') {
      return { label: tr.objective.changeKey, onClick: () => openSettings(false) };
    }
    if (err.kind === 'model' || err.kind === 'schema' || err.status === 400) {
      return { label: tr.objective.changeModel, onClick: () => openSettings(true) };
    }
    if (err.kind === 'credits') {
      const url = CREDITS_URL[activeProvider ?? 'openrouter'];
      return {
        label: tr.objective.addCredits,
        onClick: () => window.open(url, '_blank', 'noopener,noreferrer'),
      };
    }
    return undefined;
  };

  const model = activeProvider && activeConfig
    ? modelDisplay(activeProvider, activeConfig.mainModel, tr)
    : null;

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay
      ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const sortedOutlines = outlines ? [...outlines].sort((a, b) => a.rank - b.rank) : [];
  const groups = groupByStrategy(sortedOutlines);
  const grouped = groups.some((g) => g.plans.length > 1);
  const selectedOutline = sortedOutlines.find((p) => p.id === selectedId) ?? null;
  const newSet = new Set(newIds);
  const research = progress?.research ?? (view === 'plans' ? outlineResearch : null);

  // Estado da expansão de um card: em andamento, com erro, ou nenhum.
  const expansionFor = (id: string): CardExpansion | null => {
    if (expandingId !== id || expanded[id]) return null;
    if (expand.running) return { kind: 'running', progress: expandProgress };
    if (expand.error) {
      return {
        kind: 'error',
        error: expand.error,
        onRetry: () => void startExpansion(id),
        action: errorAction(expand.error),
      };
    }
    return null;
  };

  const renderCard = (p: AIPlanOutline) => (
    <PlanCard
      key={p.id}
      outline={p}
      plan={expanded[p.id] ?? null}
      expansion={expansionFor(p.id)}
      selected={selectedId === p.id}
      isNew={newSet.has(p.id)}
      collapsible={isMobile && p.rank !== 1}
      onSelect={() => handleSelect(p.id)}
      tr={tr}
    />
  );

  return (
    <div className="fixed inset-0 bg-bg-primary overflow-y-auto scroll-stable">
      <div
        className={`mx-auto w-full px-4 sm:px-8 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1rem)] sm:pt-[max(env(safe-area-inset-top),1.5rem)] sm:pb-[max(env(safe-area-inset-bottom),2rem)] ${
          view === 'plans' && !starting ? 'max-w-5xl' : 'max-w-2xl'
        }`}
      >
        {/* Linha utilitária — modelo/configurações, demo e idioma */}
        <div className="flex items-center gap-2 mb-6 sm:mb-8 -ml-2">
          <div className="flex min-w-0 flex-1 items-center gap-0.5 sm:gap-1">
            <button
              type="button"
              onClick={() => openSettings(false)}
              title={`${tr.objective.modelButtonTitle}${model?.effort ? ` · ${model.effort}` : ''}`}
              className="tap btn btn-ghost btn-sm min-w-0 max-w-full sm:max-w-[220px]"
            >
              <GearIcon />
              <span className="truncate">{tr.objective.modelButton(model ? model.label : '—')}</span>
            </button>
            <button
              type="button"
              onClick={loadDemoProject}
              disabled={busy}
              className="tap btn btn-ghost btn-sm hidden sm:inline-flex"
            >
              {tr.objective.seeDemo}
            </button>
            {/* "Novo projeto" arquiva o atual: daqui dá pra voltar a ele. */}
            {archivedProject && (
              <button
                type="button"
                onClick={() => void undoReset()}
                disabled={busy}
                title={tr.objective.reopenArchivedTitle}
                className="tap btn btn-ghost btn-sm max-w-[260px] hidden sm:inline-flex"
              >
                <span className="truncate">{tr.objective.reopenArchived(archivedProject.name)}</span>
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setKbOpen(true)}
              className="tap btn btn-ghost btn-sm hidden sm:inline-flex"
              title={tr.objective.kbTitle}
            >
              <span>{tr.objective.kbBadge}</span>
              {kbCount > 0 && (
                <span className="chip !h-4 px-1.5 bg-accent/12 text-accent tabular-nums">{kbCount}</span>
              )}
            </button>
            {/* Mobile: demo, arquivado e PDFs num menu "…" — o cabeçalho cabe numa linha. */}
            <OverflowMenu
              label={tr.topBar.moreActions}
              buttonClassName="btn-ghost btn-sm"
              items={[
                { key: 'demo', label: tr.objective.seeDemo, onClick: loadDemoProject, disabled: busy, mobileOnly: true },
                ...(archivedProject
                  ? [
                      {
                        key: 'archived',
                        label: tr.objective.reopenArchived(archivedProject.name),
                        title: tr.objective.reopenArchivedTitle,
                        onClick: () => void undoReset(),
                        disabled: busy,
                        mobileOnly: true,
                      },
                    ]
                  : []),
                {
                  key: 'kb',
                  label: kbCount > 0 ? `${tr.objective.kbBadge} (${kbCount})` : tr.objective.kbBadge,
                  title: tr.objective.kbTitle,
                  onClick: () => setKbOpen(true),
                  mobileOnly: true,
                },
              ]}
            />
            <LanguageToggle />
          </div>
        </div>

        {/* Na escolha de plano o título da seção já orienta — hero só no formulário. */}
        {view === 'form' && (
          <div className="mb-6 sm:mb-8">
            <div className="label mb-1.5">{tr.objective.kicker}</div>
            <h1 className="text-title2 sm:text-title1 font-bold tracking-[-0.01em] text-text-primary mb-2">
              {tr.objective.title}
            </h1>
            <p className="text-body text-text-secondary">{tr.objective.lead}</p>
          </div>
        )}

        {kbUsed.length > 0 && !starting && (
          <div className="mb-4 max-w-2xl rounded-card bg-ai-accent/8 px-3 py-2 text-footnote">
            <span className="font-medium text-ai-accent">
              <span aria-hidden>✦ </span>
              {tr.objective.baseUsed}
            </span>{' '}
            <span className="text-text-secondary">
              {kbUsed.map((k) => k.titulo).join(', ')}
            </span>
          </div>
        )}

        {/* Fontes reais consultadas na pesquisa web — links clicáveis, são as
            mesmas URLs que o plano pode citar como âncora kind="link". */}
        {research && research.sources.length > 0 && !starting && (
          <div className="mb-4 rounded-card bg-ai-accent/8 px-3 py-2 text-footnote">
            <span className="font-medium text-ai-accent">
              <span aria-hidden>✦ </span>
              {tr.objective.webSources}
            </span>{' '}
            <span className="text-text-secondary">
              {research.sources.map((s, i) => (
                <span key={s.url}>
                  {i > 0 && ', '}
                  {safeHref(s.url) ? (
                    <a
                      href={safeHref(s.url) ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-ai-accent/40 underline-offset-2 hover:text-ai-accent transition-colors duration-120 ease-mac"
                    >
                      {s.title}
                    </a>
                  ) : (
                    s.title
                  )}
                </span>
              ))}
            </span>
          </div>
        )}

        <KnowledgeRepo open={kbOpen} onClose={() => setKbOpen(false)} />
        {settings && (
          <ApiKeyGate onClose={() => setSettings(null)} initialAdvanced={settings.advanced} />
        )}

        {interrupted && !busy && !starting && (
          <Notice
            onDismiss={() => setInterrupted(false)}
            action={{
              label: tr.objective.interruptedAction,
              onClick: () => (outlines && view === 'plans' ? handleMorePlans() : handleGenerate()),
              disabled: !objective.trim() && !outlines,
            }}
            dismissLabel={tr.common.dismiss}
          >
            {tr.objective.interrupted}
          </Notice>
        )}

        {view === 'form' && (
          <div className="space-y-4">
            {/* O campo principal: grande e calmo, como a folha de um app nativo. */}
            <div className="card p-4 sm:p-5">
              <label
                htmlFor="cp-objective"
                className="block text-control font-semibold text-text-primary"
              >
                {tr.objective.objectiveLabel}
              </label>
              <p id="cp-objective-hint" className="text-footnote text-text-muted mt-0.5 mb-3">
                {tr.objective.objectiveHint}
              </p>
              <textarea
                id="cp-objective"
                aria-describedby="cp-objective-hint"
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                disabled={busy}
                placeholder={tr.objective.objectivePlaceholder}
                rows={4}
                className="field text-body px-3 py-2.5 min-h-[112px]"
              />
              <div className="mt-3 flex gap-1.5 flex-wrap items-center">
                <span className="text-footnote text-text-muted mr-0.5">{tr.objective.examplesLabel}</span>
                {tr.objective.examples.map((ex) => (
                  <button
                    key={ex.label}
                    type="button"
                    onClick={() => applyExample(ex.objective)}
                    disabled={busy}
                    className="relative chip h-6 px-2.5 text-footnote font-normal after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-[''] transition-colors duration-120 ease-mac hover:bg-accent/12 hover:text-accent disabled:opacity-45 disabled:pointer-events-none"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Opções: grupo estilo Ajustes do Sistema. */}
            <div className="card p-4 sm:p-5 space-y-5">
              <div>
                <label htmlFor="cp-name" className="label block mb-1.5">
                  {tr.objective.projectNameLabel}
                </label>
                <input
                  id="cp-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                  placeholder={tr.objective.projectNamePlaceholder}
                  className="field"
                />
              </div>

              {/* Regras = limites duros do desafio. Condicionam todo plano,
                  decomposição, replan, crítica e explicação. */}
              <div>
                <label htmlFor="cp-rule" className="label block mb-1.5">
                  {tr.objective.rulesLabel}
                </label>
                <div className="flex gap-2">
                  <input
                    id="cp-rule"
                    value={ruleDraft}
                    onChange={(e) => setRuleDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addRule();
                      }
                    }}
                    onPaste={(e) => {
                      // Colar várias regras de uma vez vira vários chips.
                      const parts = parseRules(e.clipboardData.getData('text'));
                      if (parts.length > 1) {
                        e.preventDefault();
                        setRules((r) => mergeRules(r, parts));
                      }
                    }}
                    disabled={busy}
                    placeholder={tr.objective.rulesPlaceholder}
                    aria-describedby="cp-rule-hint"
                    className="field flex-1 min-w-0"
                  />
                  <button
                    type="button"
                    onClick={addRule}
                    disabled={busy || !ruleDraft.trim()}
                    className="tap btn btn-secondary shrink-0"
                  >
                    {tr.objective.rulesAddBtn}
                  </button>
                </div>
                {rules.length > 0 && (
                  <div className="mt-2 flex gap-1.5 flex-wrap">
                    {rules.map((r) => (
                      <span
                        key={r}
                        className="chip h-auto min-h-6 max-w-full whitespace-normal py-0.5 pl-2 pr-0.5 text-footnote font-normal bg-accent/12 text-text-primary"
                      >
                        <span className="min-w-0 break-words">{r}</span>
                        <button
                          type="button"
                          onClick={() => setRules((rs) => rs.filter((x) => x !== r))}
                          disabled={busy}
                          className="relative btn btn-ghost btn-icon btn-sm !h-5 !min-h-0 w-5 shrink-0 rounded-full text-caption hover:text-state-problem after:absolute after:-inset-3 after:content-['']"
                          aria-label={`${tr.common.remove}: ${r}`}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <p id="cp-rule-hint" className="mt-1.5 text-footnote text-text-muted">
                  {tr.objective.rulesHint}
                </p>
              </div>

              {/* Pesquisa real na web — modo global (vale pra planos, tutor,
                  crítica e replan). Opt-in: custa créditos e adiciona latência. */}
              <label
                className={`flex items-start gap-2.5 cursor-pointer ${
                  busy ? 'opacity-50 pointer-events-none' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={webResearch}
                  onChange={(e) => setWebResearch(e.target.checked)}
                  disabled={busy}
                  className="checkbox-mac mt-px"
                />
                <span className="min-w-0">
                  <span className="block text-control font-medium text-text-primary">
                    {tr.objective.researchToggle}
                  </span>
                  <span className="block text-footnote text-text-muted mt-0.5">
                    {tr.objective.researchToggleHint}
                  </span>
                </span>
              </label>
            </div>

            {gen.running ? (
              <GenerationProgress
                progress={progress}
                elapsedMs={gen.elapsedMs}
                withResearch={webResearch}
                onCancel={handleCancel}
                tr={tr}
              />
            ) : sameInputs ? (
              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleGenerate}
                  className="tap btn btn-tertiary"
                >
                  {tr.objective.regenerate}
                </button>
                <button
                  type="button"
                  onClick={() => setView('plans')}
                  className="btn btn-primary h-9 px-5"
                >
                  {tr.objective.viewExistingPlans(outlines!.length)}
                </button>
              </div>
            ) : (
              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-1">
                {outlines && (
                  <button
                    type="button"
                    onClick={() => setView('plans')}
                    className="tap btn btn-tertiary"
                  >
                    {tr.objective.viewPreviousPlans(outlines.length)}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={!objective.trim()}
                  className="btn btn-primary h-9 px-5 min-w-0"
                >
                  <span aria-hidden>✦</span>
                  <span className="truncate">{outlines ? tr.objective.regenerate : tr.objective.generate}</span>
                </button>
              </div>
            )}

            {gen.error && !gen.running && (
              <InlineError
                error={gen.error}
                onRetry={handleGenerate}
                onAction={errorAction(gen.error)}
              />
            )}
          </div>
        )}

        {view === 'plans' && outlines && starting && selectedOutline && (
          <StartingView
            outline={selectedOutline}
            expansion={expansionFor(selectedOutline.id)}
            elapsedMs={expand.elapsedMs}
            onBack={() => setStarting(false)}
            tr={tr}
          />
        )}

        {view === 'plans' && outlines && !starting && (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-title2 font-semibold tracking-[-0.01em] text-text-primary">
                  {outlines[0]?.archetype === 'entender'
                    ? tr.objective.pickStrategyTitleUnderstand
                    : tr.objective.pickStrategyTitle}
                </h1>
                <p className="text-control text-text-secondary mt-1">{tr.objective.pickStrategyHint}</p>
              </div>
              <button
                type="button"
                onClick={() => setView('form')}
                disabled={more.running}
                className="tap btn btn-secondary btn-sm shrink-0"
              >
                <ChevronIcon className="rotate-180" />
                {tr.common.back}
              </button>
            </div>

            {restoredAt && (
              <Notice onDismiss={() => setRestoredAt(null)} dismissLabel={tr.common.dismiss} tone="info">
                {tr.objective.restored(formatTime(restoredAt))}
              </Notice>
            )}

            {progress?.warning && !busy && (
              <Notice
                onDismiss={() => setProgress((p) => (p ? { ...p, warning: undefined } : p))}
                dismissLabel={tr.common.dismiss}
                action={
                  outlines.length < MAX_PLANS
                    ? { label: tr.objective.partialAction, onClick: handleMorePlans }
                    : undefined
                }
              >
                {progress.warning}
              </Notice>
            )}

            {grouped ? (
              groups.map((g) => (
                <section key={g.strategy} aria-label={tr.objective.strategyLabel(g.strategy)}>
                  <h3 className="label mb-2 flex items-center gap-1.5">
                    {tr.objective.strategyLabel(g.strategy)}
                    <span className="text-text-faint tabular-nums">{g.plans.length}</span>
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {g.plans.map(renderCard)}
                  </div>
                </section>
              ))
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{sortedOutlines.map(renderCard)}</div>
            )}

            {more.running ? (
              <div ref={moreProgressRef} className="scroll-mb-24">
                <GenerationProgress
                  progress={progress}
                  elapsedMs={more.elapsedMs}
                  withResearch={webResearch}
                  onCancel={handleCancel}
                  tr={tr}
                />
              </div>
            ) : outlines.length >= MAX_PLANS ? (
              <p className="text-footnote text-text-muted text-center py-2">{tr.objective.morePlansLimit}</p>
            ) : (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={handleMorePlans}
                  className="tap btn btn-ai w-full sm:w-auto"
                >
                  <span className="ai-icon" aria-hidden>
                    ✦
                  </span>
                  {tr.objective.morePlans}
                </button>
              </div>
            )}

            {more.error && !more.running && (
              <InlineError
                error={more.error}
                onRetry={handleMorePlans}
                onAction={errorAction(more.error)}
              />
            )}

            {/* CTA fixo: barra de vidro flutuando sobre os cards, sempre à mão. */}
            <div className="sticky bottom-[max(env(safe-area-inset-bottom),0.75rem)] z-10 mx-auto w-full max-w-md">
              <div className="glass border rounded-window shadow-mac-lg p-2">
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={!selectedOutline}
                  className="btn btn-primary h-9 w-full min-w-0 px-4"
                >
                  <span className="truncate">
                    {selectedOutline ? tr.objective.startWith(selectedOutline.title) : tr.objective.pickFirst}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

type CardExpansion =
  | { kind: 'running'; progress: ExpandProgressEvent | null }
  | {
      kind: 'error';
      error: AIErrorInfo;
      onRetry: () => void;
      action?: { label: string; onClick: () => void };
    };

function GearIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
      <circle cx="8" cy="8" r="2.25" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 1.75v1.5M8 12.75v1.5M14.25 8h-1.5M3.25 8h-1.5M12.42 3.58l-1.06 1.06M4.64 11.36l-1.06 1.06M12.42 12.42l-1.06-1.06M4.64 4.64 3.58 3.58"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden
      className={`shrink-0 transition-transform duration-180 ease-mac ${className}`}
    >
      <path d="M3.5 2 6.5 5l-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon({ size = 14, draw = false }: { size?: number; draw?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden className="shrink-0 text-state-done">
      <path
        d="M3 7.4 5.8 10 11 4.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...(draw ? { pathLength: 1, strokeDasharray: '1', className: 'animate-check-draw' } : {})}
      />
    </svg>
  );
}

function Spinner({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`shrink-0 rounded-full border-2 border-accent/25 border-t-accent animate-spin ${className}`}
    />
  );
}

function Notice({
  children,
  onDismiss,
  dismissLabel,
  action,
  tone = 'warn',
}: {
  children: React.ReactNode;
  onDismiss: () => void;
  dismissLabel: string;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  tone?: 'warn' | 'info';
}) {
  return (
    <div
      role="status"
      className={`mb-4 max-w-2xl flex items-center gap-2 flex-wrap rounded-card pl-3 pr-1.5 py-1.5 text-footnote ${
        tone === 'warn' ? 'bg-bg-elevated/60 border-l-2 border-conf-mid rounded-l-control text-text-primary' : 'bg-accent/8 text-text-secondary'
      }`}
    >
      <span
        aria-hidden
        className={`h-2 w-2 shrink-0 rounded-full ${tone === 'warn' ? 'bg-conf-mid' : 'bg-accent'}`}
      />
      <span className="flex-1 min-w-0 py-1">{children}</span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          className="tap btn btn-secondary btn-sm"
        >
          {action.label}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={dismissLabel}
        className="tap btn btn-ghost btn-icon btn-sm text-caption"
      >
        ✕
      </button>
    </div>
  );
}

type StepState = 'done' | 'active' | 'pending';

// Espera honesta: etapas humanas + relógio local (tick do useAIAction, não
// depende de eventos do stream) + barra indeterminada + cancelar.
function GenerationProgress({
  progress,
  elapsedMs,
  withResearch,
  onCancel,
  tr,
}: {
  progress: OutlineProgressEvent | null;
  elapsedMs: number;
  withResearch: boolean;
  onCancel: () => void;
  tr: Messages;
}) {
  const phase = progress?.phase;
  // 0 = lendo (KB) · 1 = pesquisando · 2 = pensando · 3 = escrevendo · 4 = conferindo
  const stage =
    phase == null
      ? 0
      : phase === 'researching'
      ? 1
      : phase === 'connecting' || phase === 'thinking'
      ? 2
      : phase === 'streaming'
      ? 3
      : 4;
  const state = (i: number): StepState => (stage > i ? 'done' : stage === i ? 'active' : 'pending');

  const partialPlans = progress?.partial?.plans ?? [];
  const writingN = Math.min(PLANS_PER_BATCH, Math.max(1, partialPlans.length));
  const writingTitle = partialPlans[writingN - 1]?.title?.trim();

  const steps: { key: string; label: string; hint?: string; state: StepState }[] = [
    { key: 'read', label: tr.objective.stepRead, state: state(0) },
    ...(withResearch ? [{ key: 'research', label: tr.objective.stepResearch, state: state(1) }] : []),
    {
      key: 'think',
      label: tr.objective.stepThinking,
      hint: stage === 2 ? tr.objective.stepThinkingHint : undefined,
      state: state(2),
    },
    {
      key: 'write',
      label:
        stage === 3
          ? tr.objective.stepWriting(writingN, PLANS_PER_BATCH, writingTitle)
          : tr.ai.twoPhase.outlineProgress.streaming,
      state: state(3),
    },
    { key: 'check', label: tr.objective.stepChecking, state: state(4) },
  ];
  const current = steps.find((s) => s.state === 'active');

  return (
    <div className="card p-4 sm:p-5 flex flex-col gap-4" aria-label={tr.objective.progressAria}>
      <style>{`
        @keyframes cp-indeterminate { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }
        .cp-indeterminate { animation: cp-indeterminate 1.4s cubic-bezier(.4,0,.2,1) infinite; }
        @media (prefers-reduced-motion: reduce) { .cp-indeterminate { animation: none; width: 100%; opacity: .5; } }
      `}</style>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1 overflow-hidden rounded-full bg-bg-elevated" aria-hidden>
          <div className="cp-indeterminate h-full w-1/3 rounded-full bg-accent" />
        </div>
        <span className="text-footnote text-text-muted tabular-nums">{formatClock(elapsedMs)}</span>
        <button type="button" onClick={onCancel} className="tap btn btn-secondary btn-sm">
          {tr.objective.cancel}
        </button>
      </div>

      <ol className="space-y-2 text-control">
        {steps.map((s) => (
          <li key={s.key} className="flex items-start gap-2.5">
            <span aria-hidden className="mt-px flex h-4 w-4 shrink-0 items-center justify-center">
              {s.state === 'done' ? (
                <CheckIcon draw />
              ) : s.state === 'active' ? (
                <Spinner />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-text-faint/50" />
              )}
            </span>
            <span className="min-w-0">
              <span
                className={
                  s.state === 'active'
                    ? 'text-text-primary font-medium'
                    : s.state === 'done'
                    ? 'text-text-secondary'
                    : 'text-text-faint'
                }
              >
                {s.label}
              </span>
              {s.hint && <span className="block text-footnote text-text-muted mt-0.5">{s.hint}</span>}
            </span>
          </li>
        ))}
      </ol>
      {/* Leitor de tela ouve só a troca de etapa, não o relógio. */}
      <span className="sr-only" role="status" aria-live="polite">
        {current?.label}
      </span>

      <PartialOutlinesPreview progress={progress} />
    </div>
  );
}

// Os esboços aparecendo enquanto chegam: título, pitch e as partes de cada um.
function PartialOutlinesPreview({ progress }: { progress: OutlineProgressEvent | null }) {
  const plans = progress?.partial?.plans;
  if (!plans || plans.length === 0) return null;

  return (
    <div className="space-y-3 border-t border-border-base/70 pt-4">
      {plans.map((p, i) => (
        <div key={i} className="animate-card-swap">
          <div className="text-control text-text-primary">
            <span className="ai-icon" aria-hidden>
              ✦
            </span>{' '}
            <span className="font-semibold">{p?.title ?? '…'}</span>
          </div>
          {p?.pitch && <div className="text-footnote text-text-secondary mt-0.5 pl-4">{p.pitch}</div>}
          {p?.outline?.categorias && p.outline.categorias.length > 0 && (
            <div className="mt-1 space-y-0.5 pl-4">
              {p.outline.categorias.map((cat, j) => (
                <div key={j} className="text-footnote text-text-muted">
                  {cat?.name ?? '…'}
                  {cat?.nodes && cat.nodes.length > 0 && (
                    <span className="text-text-faint tabular-nums"> {cat.nodes.length}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Linha discreta de progresso da expansão: fase + "x de ~y passos" + barra fina.
function ExpansionStatus({
  progress,
  tr,
}: {
  progress: ExpandProgressEvent | null;
  tr: Messages;
}) {
  const phase = progress?.phase ?? 'connecting';
  const label =
    phase === 'done' || phase === 'error'
      ? tr.ai.twoPhase.expandProgress.finalizing
      : tr.ai.twoPhase.expandProgress[phase];
  const ready = progress?.nodesReady ?? 0;
  const total = progress?.nodesTotal ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((ready / total) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-footnote">
        <Spinner className="h-3 w-3" />
        <span className="mr-auto font-medium text-text-secondary">{label}</span>
        {total > 0 && ready > 0 && (
          <span className="text-text-muted tabular-nums">{tr.ai.twoPhase.nodesProgress(ready, total)}</span>
        )}
      </div>
      <div
        className="h-0.5 overflow-hidden rounded-full bg-bg-elevated"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total || undefined}
        aria-valuenow={ready}
        aria-label={label}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-240 ease-mac"
          style={{ width: `${Math.max(pct, 3)}%` }}
        />
      </div>
    </div>
  );
}

const PREVIEW_CHILDREN = 4;

// Árvore do card: categorias com seus nós. Durante a expansão cada nó mostra
// se já foi detalhado (✓), está sendo escrito agora (ponto pulsando) ou ainda
// é só o nome do resumo (esmaecido).
function TreeList({
  tree,
  full,
  assembling,
}: {
  tree: TreeView[];
  full: boolean;
  assembling: boolean;
}) {
  return (
    <>
      {tree.map((cat) => {
        const shown = full || assembling ? cat.nodes : cat.nodes.slice(0, PREVIEW_CHILDREN);
        const rest = cat.nodes.length - shown.length;
        return (
          <div key={cat.key} className="mt-3 border-t border-border-base/70 pt-3">
            <div className="label mb-1.5 flex items-center gap-1.5">
              <span className="min-w-0 truncate">{cat.name}</span>
              <span className="text-text-faint tabular-nums">{cat.nodes.length}</span>
            </div>
            <ul className="space-y-1">
              {shown.map((n) => (
                <li
                  key={n.key}
                  className={`flex gap-2 text-footnote transition-colors duration-180 ease-mac ${
                    n.state === 'pending' && assembling ? 'text-text-faint' : 'text-text-secondary'
                  }`}
                >
                  <span className="mt-[3px] flex h-3 w-3 shrink-0 items-center justify-center" aria-hidden>
                    {assembling && n.state === 'ready' ? (
                      <CheckIcon size={12} draw />
                    ) : assembling && n.state === 'writing' ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse-subtle" />
                    ) : (
                      <span className="h-1 w-1 rounded-full bg-text-faint/60" />
                    )}
                  </span>
                  <span className="min-w-0">{n.name}</span>
                </li>
              ))}
              {rest > 0 && (
                <li className="pl-5 text-footnote text-text-muted tabular-nums">+{rest}</li>
              )}
            </ul>
          </div>
        );
      })}
    </>
  );
}

function treeFromPlan(plan: AIPlan): TreeView[] {
  return plan.tree.categorias.map((c, i) => ({
    key: c.tempId || `c${i}`,
    name: c.name,
    nodes: c.children.map((n, j) => ({ key: n.tempId || `n${j}`, name: n.name, state: 'ready' as const })),
  }));
}

const RULE_STYLE = {
  cumpre: { icon: '✓', cls: 'bg-conf-high/12 text-conf-high' },
  risco: { icon: '!', cls: 'bg-conf-mid/12 text-conf-mid' },
  viola: { icon: '✕', cls: 'bg-state-problem/12 text-state-problem' },
} as const;

function PlanCard({
  outline: p,
  plan,
  expansion,
  selected,
  isNew,
  collapsible,
  onSelect,
  tr,
}: {
  outline: AIPlanOutline;
  // Árvore completa, quando já está no cache.
  plan: AIPlan | null;
  expansion: CardExpansion | null;
  selected: boolean;
  isNew: boolean;
  // Mobile: só o #1 abre completo; os demais mostram o essencial até expandir.
  collapsible: boolean;
  onSelect: () => void;
  tr: Messages;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [approachOpen, setApproachOpen] = useState(false);
  const [fullOpen, setFullOpen] = useState(false);
  const collapsed = collapsible && !detailsOpen && !selected;

  const assembling = expansion?.kind === 'running';
  const tree = plan
    ? treeFromPlan(plan)
    : assembleTree(p, assembling ? expansion.progress?.partial : undefined);
  const totalNodes = plan
    ? tree.reduce((n, c) => n + c.nodes.length, 0)
    : countOutlineNodes(p);
  const hiddenNodes = assembling
    ? 0
    : tree.reduce((n, c) => n + Math.max(0, c.nodes.length - PREVIEW_CHILDREN), 0);
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  const disclosure = 'tap btn btn-tertiary btn-sm -ml-2 self-start';

  return (
    <div
      onClick={onSelect}
      className={`card p-4 sm:p-5 flex flex-col cursor-pointer transition-shadow duration-180 ease-mac ${
        selected ? 'ring-2 ring-accent shadow-mac-lg' : 'shadow-mac'
      }`}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={stop(onSelect)}
        className="text-left w-full rounded-control"
      >
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          <span
            className={`chip shrink-0 tabular-nums ${
              p.rank === 1 ? 'bg-state-done/12 text-state-done' : ''
            }`}
          >
            {p.rank === 1 ? `★ ${tr.objective.rankBest}` : `#${p.rank}`}
          </span>
          {isNew && (
            <span className="chip shrink-0 bg-ai-accent/12 text-ai-accent">{tr.objective.newBadge}</span>
          )}
          <span className="chip ml-auto shrink-0">{tr.objective.strategyLabel(p.strategy)}</span>
        </div>
        <div className="text-title3 font-semibold leading-snug tracking-[-0.01em] text-text-primary">
          {p.title}
        </div>
      </button>

      {(p.estimates || (p.rulesCheck && p.rulesCheck.length > 0)) && (
        <div className="mt-2.5 flex gap-1 flex-wrap">
          {p.estimates && (
            <>
              <Chip label={tr.objective.costAria}>{p.estimates.custo}</Chip>
              <Chip label={tr.objective.timeAria}>{p.estimates.tempo}</Chip>
              <Chip label={tr.objective.difficultyAria}>
                {tr.objective.difficultyLabel(p.estimates.dificuldade)}
              </Chip>
            </>
          )}
          {!collapsed &&
            p.rulesCheck?.map((r) => {
              const st = RULE_STYLE[r.status] ?? RULE_STYLE.risco;
              const desc = `${tr.objective.ruleStatusLabel(r.status)}: ${r.rule}${r.nota ? ` — ${r.nota}` : ''}`;
              return (
                <span
                  key={r.rule}
                  title={desc}
                  aria-label={desc}
                  className={`chip max-w-full ${st.cls}`}
                >
                  <span aria-hidden className="font-semibold">
                    {st.icon}
                  </span>
                  <span className="truncate max-w-[14rem]">{r.rule}</span>
                </span>
              );
            })}
        </div>
      )}

      <p className="mt-3 text-control text-text-secondary leading-relaxed">{p.pitch}</p>

      {!collapsed && (
        <>
          {p.rankReason && (
            <p
              className={`mt-2 text-footnote ${
                p.rank === 1 ? 'text-conf-high' : 'text-text-muted'
              }`}
            >
              {p.rankReason}
            </p>
          )}

          {p.approach && (
            <div className="mt-2 flex flex-col">
              <button
                type="button"
                onClick={stop(() => setApproachOpen((v) => !v))}
                aria-expanded={approachOpen}
                className={disclosure}
              >
                <ChevronIcon className={approachOpen ? 'rotate-90' : ''} />
                {approachOpen ? tr.objective.hideApproach : tr.objective.showApproach}
              </button>
              {approachOpen && (
                <p className="mt-1 text-footnote text-text-secondary">{p.approach}</p>
              )}
            </div>
          )}

          {assembling && (
            <div className="mt-3 animate-card-swap">
              <ExpansionStatus progress={expansion.progress} tr={tr} />
            </div>
          )}

          <TreeList tree={tree} full={fullOpen} assembling={assembling} />

          {hiddenNodes > 0 && (
            <button
              type="button"
              onClick={stop(() => setFullOpen((v) => !v))}
              aria-expanded={fullOpen}
              className={`${disclosure} mt-2`}
            >
              <ChevronIcon className={fullOpen ? 'rotate-90' : ''} />
              {fullOpen ? tr.objective.hideFullPlan : tr.objective.showFullPlan(totalNodes)}
            </button>
          )}

          {expansion?.kind === 'error' && (
            <div onClick={(e) => e.stopPropagation()} className="mt-3">
              <InlineError error={expansion.error} onRetry={expansion.onRetry} onAction={expansion.action} />
            </div>
          )}

          {/* Resumo × plano completo, dito sem jargão. */}
          {plan ? (
            <p className="mt-3 flex items-center gap-1.5 text-footnote text-text-muted">
              <CheckIcon size={12} />
              {tr.ai.twoPhase.expandReady}
            </p>
          ) : assembling ? (
            <p className="mt-3 text-footnote text-text-muted">{tr.ai.twoPhase.expandingHint}</p>
          ) : expansion?.kind !== 'error' ? (
            <p className="mt-3 text-footnote text-text-muted">{tr.ai.twoPhase.outlineOnly}</p>
          ) : null}
        </>
      )}

      {collapsible && !selected && (
        <button
          type="button"
          onClick={stop(() => setDetailsOpen((v) => !v))}
          aria-expanded={detailsOpen}
          className={`${disclosure} mt-2`}
        >
          <ChevronIcon className={detailsOpen ? 'rotate-90' : ''} />
          {detailsOpen ? tr.objective.hideDetails : tr.objective.showDetails}
        </button>
      )}
    </div>
  );
}

// "Começar" antes da árvore ficar pronta: a folha do plano escolhido com a
// árvore se montando. O projeto abre sozinho quando a expansão termina.
function StartingView({
  outline,
  expansion,
  elapsedMs,
  onBack,
  tr,
}: {
  outline: AIPlanOutline;
  expansion: CardExpansion | null;
  elapsedMs: number;
  onBack: () => void;
  tr: Messages;
}) {
  const progress = expansion?.kind === 'running' ? expansion.progress : null;
  const tree = assembleTree(outline, progress?.partial);
  return (
    <div className="space-y-4 animate-card-swap" aria-label={tr.ai.twoPhase.startingAria}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-title2 font-semibold tracking-[-0.01em] text-text-primary">
            {tr.ai.twoPhase.startingTitle(outline.title)}
          </h1>
          <p className="text-control text-text-secondary mt-1">{tr.ai.twoPhase.startingHint}</p>
        </div>
        <button type="button" onClick={onBack} className="tap btn btn-secondary btn-sm shrink-0">
          <ChevronIcon className="rotate-180" />
          {tr.ai.twoPhase.backToPlans}
        </button>
      </div>

      <div className="card shadow-mac p-4 sm:p-6">
        {expansion?.kind === 'error' ? (
          <InlineError error={expansion.error} onRetry={expansion.onRetry} onAction={expansion.action} />
        ) : (
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <ExpansionStatus progress={progress} tr={tr} />
            </div>
            <span className="text-footnote text-text-muted tabular-nums leading-4">{formatClock(elapsedMs)}</span>
          </div>
        )}
        <TreeList tree={tree} full assembling={expansion?.kind === 'running'} />
      </div>
    </div>
  );
}

function Chip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span title={label} className="chip max-w-full">
      <span className="sr-only">{label}: </span>
      <span className="truncate">{children}</span>
    </span>
  );
}
