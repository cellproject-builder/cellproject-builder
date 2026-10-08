import { useEffect, useRef, useState } from 'react';
import {
  generatePlans,
  type AIErrorInfo,
  type ExistingPlanSummary,
  type PlanProgressEvent,
} from '@/ai/service';
import { useGraphStore } from '@/store';
import { useKBStore } from '@/kb/store';
import { useConfigStore, type Provider } from '@/config/store';
import { useLocaleStore, useT, type Messages } from '@/i18n';
import type { AIPlan, ConstructionStrategy } from '@/types';
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
  const createProjectFromPlan = useGraphStore((s) => s.createProjectFromPlan);
  const loadDemoProject = useGraphStore((s) => s.loadDemoProject);
  const archivedProject = useGraphStore((s) => s.archivedProject);
  const undoReset = useGraphStore((s) => s.undoReset);

  const [name, setName] = useState(draft0.name);
  const [objective, setObjective] = useState(draft0.objective);
  const [rules, setRules] = useState<string[]>(draft0.rules);
  const [ruleDraft, setRuleDraft] = useState(draft0.ruleDraft);
  const [plans, setPlans] = useState<AIPlan[] | null>(
    draft0.plans && draft0.plans.length > 0 ? draft0.plans : null,
  );
  const [plansFor, setPlansFor] = useState(draft0.plansFor);
  const [selectedId, setSelectedId] = useState<string | null>(draft0.selectedId);
  const [view, setView] = useState<View>(plans ? 'plans' : 'form');
  const [newIds, setNewIds] = useState<string[]>([]);
  // Avisos de retomada: planos restaurados / geração interrompida pelo reload.
  const [restoredAt, setRestoredAt] = useState<number | null>(
    plans ? draft0.updatedAt || null : null,
  );
  const [interrupted, setInterrupted] = useState(draft0.generatingSince != null);

  const [progress, setProgress] = useState<PlanProgressEvent | null>(null);
  const [kbOpen, setKbOpen] = useState(false);
  const [kbUsed, setKbUsed] = useState<{ titulo: string; docId: string }[]>([]);
  const [settings, setSettings] = useState<{ advanced: boolean } | null>(null);

  const kbCount = useKBStore((s) => Object.keys(s.docs).length);
  const getContextFor = useKBStore((s) => s.getContextFor);
  const webResearch = useConfigStore((s) => s.webResearchEnabled);
  const setWebResearch = useConfigStore((s) => s.setWebResearchEnabled);
  const activeProvider = useConfigStore((s) => s.activeProvider);
  const activeConfig = useConfigStore((s) =>
    s.activeProvider ? s.providers[s.activeProvider] : undefined,
  );

  // Uma geração = KB + (pesquisa) + planos, com cancelamento real.
  const runPlans = async (
    signal: AbortSignal,
    objectiveText: string,
    effRules: string[],
    existing?: ExistingPlanSummary[],
  ) => {
    const kbPromise = getContextFor({ label: tr.notify.objectivePromptLabel(objectiveText) });
    kbPromise.then(
      (kb) => {
        if (!signal.aborted && kb.length > 0) {
          setKbUsed(kb.map((c) => ({ titulo: c.titulo, docId: c.docId })));
        }
      },
      () => {}, // a falha chega pelo generatePlans
    );
    return generatePlans(
      objectiveText,
      (ev) => {
        if (!signal.aborted) setProgress(ev);
      },
      kbPromise,
      effRules,
      existing,
      { signal },
    );
  };
  const gen = useAIAction(runPlans);
  const more = useAIAction(runPlans);
  const busy = gen.running || more.running;

  const mountedRef = useRef(true);
  const moreProgressRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<() => void>(() => {});
  cancelRef.current = () => {
    gen.cancel();
    more.cancel();
  };
  useEffect(() => {
    mountedRef.current = true;
    // Geração que ficou "em andamento" no rascunho morreu com o reload.
    if (useGraphStore.getState().objectiveDraft.generatingSince != null) {
      useGraphStore.getState().setObjectiveDraft({ generatingSince: null });
    }
    return () => {
      mountedRef.current = false;
      // Saiu da tela (demo, projeto criado): não gasta crédito à toa.
      cancelRef.current();
    };
  }, []);

  // Espelha o formulário e os planos no rascunho persistido.
  const firstSync = useRef(true);
  useEffect(() => {
    if (firstSync.current) {
      firstSync.current = false;
      return;
    }
    setObjectiveDraft({ name, objective, rules, ruleDraft, plans, plansFor, selectedId });
  }, [name, objective, rules, ruleDraft, plans, plansFor, selectedId, setObjectiveDraft]);

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
    !!plans &&
    !!plansFor &&
    plansFor.objective === objective.trim() &&
    sameRules(plansFor.rules, effectiveRules);

  const handleGenerate = async () => {
    const obj = objective.trim();
    if (!obj || busy) return;
    const eff = commitPendingRules();
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
    setPlans(normalizeRanks(result));
    setPlansFor({ objective: obj, rules: eff });
    // Nada pré-selecionado: a estratégia é escolha consciente do usuário.
    setSelectedId(null);
    setNewIds([]);
    setRestoredAt(null);
    setView('plans');
  };

  // Mais alternativas: o prompt leva os planos já mostrados pra explorar
  // ângulos diferentes; o conjunto todo é re-ranqueado na fusão.
  const handleMorePlans = async () => {
    if (!plans || busy || plans.length >= MAX_PLANS) return;
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
    const existing = plans.map((p) => ({
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
    const merged = mergePlanBatches(plans, result);
    setPlans(merged.plans);
    setNewIds(merged.newIds);
    setPlansFor({ objective: obj, rules: eff });
  };

  const handleCancel = () => {
    gen.cancel();
    more.cancel();
    setProgress(null);
    setObjectiveDraft({ generatingSince: null });
  };

  const handleConfirm = () => {
    if (!plans || !selectedId) return;
    const plan = plans.find((p) => p.id === selectedId);
    if (!plan) return;
    cancelRef.current();
    const alternatives = plans.filter((p) => p.id !== plan.id);
    createProjectFromPlan(
      plansFor?.objective ?? objective.trim(),
      name.trim() || plan.title,
      plan,
      plansFor?.rules ?? effectiveRules,
      alternatives,
    );
  };

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

  const sortedPlans = plans ? [...plans].sort((a, b) => a.rank - b.rank) : [];
  const groups = groupByStrategy(sortedPlans);
  const grouped = groups.some((g) => g.plans.length > 1);
  const selectedPlan = sortedPlans.find((p) => p.id === selectedId) ?? null;
  const newSet = new Set(newIds);

  const renderCard = (p: AIPlan) => (
    <PlanCard
      key={p.id}
      plan={p}
      selected={selectedId === p.id}
      isNew={newSet.has(p.id)}
      collapsible={isMobile && p.rank !== 1}
      onSelect={() => setSelectedId(p.id)}
      tr={tr}
    />
  );


  return (
    <div className="fixed inset-0 bg-bg-primary overflow-y-auto scroll-stable">
      <div
        className={`mx-auto w-full px-4 sm:px-8 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1rem)] sm:pt-[max(env(safe-area-inset-top),1.5rem)] sm:pb-[max(env(safe-area-inset-bottom),2rem)] ${
          view === 'plans' ? 'max-w-5xl' : 'max-w-2xl'
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

        {kbUsed.length > 0 && (
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
        {progress?.research && progress.research.sources.length > 0 && (
          <div className="mb-4 rounded-card bg-ai-accent/8 px-3 py-2 text-footnote">
            <span className="font-medium text-ai-accent">
              <span aria-hidden>✦ </span>
              {tr.objective.webSources}
            </span>{' '}
            <span className="text-text-secondary">
              {progress.research.sources.map((s, i) => (
                <span key={s.url}>
                  {i > 0 && ', '}
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-ai-accent/40 underline-offset-2 hover:text-ai-accent transition-colors duration-120 ease-mac"
                  >
                    {s.title}
                  </a>
                </span>
              ))}
            </span>
          </div>
        )}

        <KnowledgeRepo open={kbOpen} onClose={() => setKbOpen(false)} />
        {settings && (
          <ApiKeyGate onClose={() => setSettings(null)} initialAdvanced={settings.advanced} />
        )}

        {interrupted && !busy && (
          <Notice
            onDismiss={() => setInterrupted(false)}
            action={{
              label: tr.objective.interruptedAction,
              onClick: () => (plans && view === 'plans' ? handleMorePlans() : handleGenerate()),
              disabled: !objective.trim() && !plans,
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
                  {tr.objective.viewExistingPlans(plans!.length)}
                </button>
              </div>
            ) : (
              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-1">
                {plans && (
                  <button
                    type="button"
                    onClick={() => setView('plans')}
                    className="tap btn btn-tertiary"
                  >
                    {tr.objective.viewPreviousPlans(plans.length)}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={!objective.trim()}
                  className="btn btn-primary h-9 px-5 min-w-0"
                >
                  <span aria-hidden>✦</span>
                  <span className="truncate">{plans ? tr.objective.regenerate : tr.objective.generate}</span>
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

        {view === 'plans' && plans && (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-title2 font-semibold tracking-[-0.01em] text-text-primary">
                  {plans[0]?.archetype === 'entender'
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
                  plans.length < MAX_PLANS
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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{sortedPlans.map(renderCard)}</div>
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
            ) : plans.length >= MAX_PLANS ? (
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
                  disabled={!selectedPlan}
                  className="btn btn-primary h-9 w-full min-w-0 px-4"
                >
                  <span className="truncate">
                    {selectedPlan ? tr.objective.startWith(selectedPlan.title) : tr.objective.pickFirst}
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
  progress: PlanProgressEvent | null;
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
          : tr.ai.progress.streaming,
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
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-state-done">
                  <path
                    d="M3 7.4 5.8 10 11 4.2"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pathLength={1}
                    strokeDasharray="1"
                    className="animate-check-draw"
                  />
                </svg>
              ) : s.state === 'active' ? (
                <span className="h-3.5 w-3.5 rounded-full border-2 border-accent/25 border-t-accent animate-spin" />
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

      <PartialPlansPreview progress={progress} />
    </div>
  );
}

function PartialPlansPreview({ progress }: { progress: PlanProgressEvent | null }) {
  const plans = progress?.partial?.plans;
  if (!plans || plans.length === 0) return null;

  return (
    <div className="space-y-3 border-t border-border-base/70 pt-4">
      {plans.map((p, i) => (
        <div key={i}>
          <div className="text-control text-text-primary">
            <span className="ai-icon" aria-hidden>
              ✦
            </span>{' '}
            <span className="font-semibold">{p?.title ?? '…'}</span>
          </div>
          {p?.pitch && <div className="text-footnote text-text-secondary mt-0.5 pl-4">{p.pitch}</div>}
          {p?.tree?.categorias && p.tree.categorias.length > 0 && (
            <div className="mt-1 space-y-0.5 pl-4">
              {p.tree.categorias.map((cat, j) => (
                <div key={j} className="text-footnote text-text-muted">
                  {cat?.name ?? '…'}
                  {cat?.children && cat.children.length > 0 && (
                    <span className="text-text-faint tabular-nums"> {cat.children.length}</span>
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

const RULE_STYLE = {
  cumpre: { icon: '✓', cls: 'bg-conf-high/12 text-conf-high' },
  risco: { icon: '!', cls: 'bg-conf-mid/12 text-conf-mid' },
  viola: { icon: '✕', cls: 'bg-state-problem/12 text-state-problem' },
} as const;

const PREVIEW_CHILDREN = 4;

function PlanCard({
  plan: p,
  selected,
  isNew,
  collapsible,
  onSelect,
  tr,
}: {
  plan: AIPlan;
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

  const totalNodes = p.tree.categorias.reduce((n, c) => n + c.children.length, 0);
  const hiddenNodes = p.tree.categorias.reduce(
    (n, c) => n + Math.max(0, c.children.length - PREVIEW_CHILDREN),
    0,
  );
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

          {p.tree.categorias.map((cat) => {
            const shown = fullOpen ? cat.children : cat.children.slice(0, PREVIEW_CHILDREN);
            const rest = cat.children.length - shown.length;
            return (
              <div key={cat.tempId} className="mt-3 border-t border-border-base/70 pt-3">
                <div className="label mb-1.5 flex items-center gap-1.5">
                  <span className="min-w-0 truncate">{cat.name}</span>
                  <span className="text-text-faint tabular-nums">{cat.children.length}</span>
                </div>
                <ul className="space-y-1">
                  {shown.map((n) => (
                    <li key={n.tempId} className="flex gap-2 text-footnote text-text-secondary">
                      <span
                        className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-text-faint/60"
                        aria-hidden
                      />
                      <span className="min-w-0">{n.name}</span>
                    </li>
                  ))}
                  {rest > 0 && (
                    <li className="pl-3 text-footnote text-text-muted tabular-nums">+{rest}</li>
                  )}
                </ul>
              </div>
            );
          })}

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

function Chip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span title={label} className="chip max-w-full">
      <span className="sr-only">{label}: </span>
      <span className="truncate">{children}</span>
    </span>
  );
}
