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
    gen.reset();
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
    <div className="fixed inset-0 bg-bg-primary flex items-start justify-center overflow-y-auto">
      <div className="w-full max-w-5xl px-4 sm:px-8 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1rem)] sm:pt-[max(env(safe-area-inset-top),2rem)] sm:pb-[max(env(safe-area-inset-bottom),2rem)]">
        {/* Linha utilitária — modelo/configurações, demo e idioma */}
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mb-3 sm:mb-4 text-[11px] font-mono">
          <button
            type="button"
            onClick={() => openSettings(false)}
            title={`${tr.objective.modelButtonTitle}${model?.effort ? ` · ${model.effort}` : ''}`}
            className="tap inline-flex items-center text-text-muted hover:text-ai-accent transition-colors"
          >
            {tr.objective.modelButton(model ? model.label : '—')}
          </button>
          <button
            type="button"
            onClick={loadDemoProject}
            disabled={busy}
            className="tap inline-flex items-center text-text-muted hover:text-ai-accent transition-colors disabled:opacity-40"
          >
            {tr.objective.seeDemo}
          </button>
          <LanguageToggle className="ml-auto" />
        </div>

        <div className="mb-6 sm:mb-8 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-ai-accent text-xs font-mono uppercase tracking-widest mb-2">
              {tr.objective.kicker}
            </div>
            {/* Na escolha de plano o título da seção já orienta — hero enxuto. */}
            {view === 'form' && (
              <>
                <h1 className="text-2xl sm:text-3xl font-semibold text-text-primary mb-2">
                  {tr.objective.title}
                </h1>
                <p className="text-text-secondary text-sm">{tr.objective.lead}</p>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => setKbOpen(true)}
            className="tap shrink-0 px-3 py-1.5 text-xs border border-border-base rounded-sm text-text-secondary hover:text-ai-accent hover:border-ai-accent/40 transition-colors flex items-center gap-2"
            title={tr.objective.kbTitle}
          >
            <span>{tr.objective.kbBadge}</span>
            {kbCount > 0 && (
              <span className="font-mono text-[11px] text-ai-accent bg-ai-accent/10 px-1.5 py-0.5 rounded-[2px]">
                {kbCount}
              </span>
            )}
          </button>
        </div>

        {kbUsed.length > 0 && (
          <div className="mb-4 max-w-2xl text-[11px] bg-ai-accent/5 border border-ai-accent/30 rounded-sm px-3 py-2">
            <span className="font-mono uppercase tracking-wider text-ai-accent">
              {tr.objective.baseUsed}
            </span>{' '}
            <span className="text-text-secondary">
              {kbUsed.map((k) => k.titulo).join(' · ')}
            </span>
          </div>
        )}

        {/* Fontes reais consultadas na pesquisa web — links clicáveis, são as
            mesmas URLs que o plano pode citar como âncora kind="link". */}
        {progress?.research && progress.research.sources.length > 0 && (
          <div className="mb-4 text-[11px] bg-ai-accent/5 border border-ai-accent/30 rounded-sm px-3 py-2">
            <span className="font-mono uppercase tracking-wider text-ai-accent">
              {tr.objective.webSources}
            </span>{' '}
            <span className="text-text-secondary">
              {progress.research.sources.map((s, i) => (
                <span key={s.url}>
                  {i > 0 && ' · '}
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-ai-accent/40 hover:text-ai-accent transition-colors"
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
          <div className="space-y-5 max-w-2xl">
            <div>
              <label
                htmlFor="cp-objective"
                className="block text-sm font-medium text-text-primary"
              >
                {tr.objective.objectiveLabel}
              </label>
              <p id="cp-objective-hint" className="text-xs text-text-muted mt-0.5 mb-1.5">
                {tr.objective.objectiveHint}
              </p>
              <textarea
                id="cp-objective"
                aria-describedby="cp-objective-hint"
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                disabled={busy}
                placeholder={tr.objective.objectivePlaceholder}
                rows={3}
                className="w-full bg-bg-secondary border border-border-base rounded-sm px-3 py-2 text-sm focus:border-ai-accent outline-none resize-y disabled:opacity-50"
              />
              <div className="mt-2 flex gap-1.5 flex-wrap items-center">
                <span className="text-[11px] text-text-muted">{tr.objective.examplesLabel}</span>
                {tr.objective.examples.map((ex) => (
                  <button
                    key={ex.label}
                    type="button"
                    onClick={() => applyExample(ex.objective)}
                    disabled={busy}
                    className="tap text-[11px] text-text-muted hover:text-text-primary border border-border-base rounded-sm px-2 py-0.5 transition-colors disabled:opacity-50"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="cp-name"
                className="block text-[11px] font-mono uppercase tracking-wider text-text-muted mb-1.5"
              >
                {tr.objective.projectNameLabel}
              </label>
              <input
                id="cp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
                placeholder={tr.objective.projectNamePlaceholder}
                className="w-full bg-bg-secondary border border-border-base rounded-sm px-3 py-2 text-sm focus:border-ai-accent outline-none disabled:opacity-50"
              />
            </div>

            {/* Regras = limites duros do desafio. Condicionam todo plano,
                decomposição, replan, crítica e explicação. */}
            <div>
              <label
                htmlFor="cp-rule"
                className="block text-[11px] font-mono uppercase tracking-wider text-text-muted mb-1.5"
              >
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
                  className="flex-1 min-w-0 bg-bg-secondary border border-border-base rounded-sm px-3 py-2 text-sm focus:border-ai-accent outline-none disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={addRule}
                  disabled={busy || !ruleDraft.trim()}
                  className="tap px-3 text-xs border border-border-base rounded-sm text-text-secondary hover:text-ai-accent hover:border-ai-accent/40 transition-colors disabled:opacity-40"
                >
                  {tr.objective.rulesAddBtn}
                </button>
              </div>
              {rules.length > 0 && (
                <div className="mt-2 flex gap-1.5 flex-wrap">
                  {rules.map((r) => (
                    <span
                      key={r}
                      className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-sm bg-ai-accent/5 text-text-secondary border border-ai-accent/30"
                    >
                      <span className="text-ai-accent" aria-hidden>
                        ⛓
                      </span>
                      {r}
                      <button
                        type="button"
                        onClick={() => setRules((rs) => rs.filter((x) => x !== r))}
                        disabled={busy}
                        className="text-text-muted hover:text-state-problem transition-colors px-0.5"
                        aria-label={`${tr.common.remove}: ${r}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <p id="cp-rule-hint" className="mt-1.5 text-[11px] text-text-muted">
                {tr.objective.rulesHint}
              </p>
            </div>

            {/* Pesquisa real na web — modo global (vale pra planos, tutor,
                crítica e replan). Opt-in: custa créditos e adiciona latência. */}
            <label
              className={`flex items-start gap-2.5 p-3 rounded-sm border cursor-pointer transition-colors ${
                webResearch
                  ? 'border-ai-accent/50 bg-ai-accent/5'
                  : 'border-border-base bg-bg-secondary hover:border-text-muted'
              } ${busy ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <input
                type="checkbox"
                checked={webResearch}
                onChange={(e) => setWebResearch(e.target.checked)}
                disabled={busy}
                className="mt-0.5 accent-ai-accent"
              />
              <span className="min-w-0">
                <span
                  className={`block text-xs font-medium ${
                    webResearch ? 'text-ai-accent' : 'text-text-secondary'
                  }`}
                >
                  {tr.objective.researchToggle}
                </span>
                <span className="block text-[11px] text-text-muted mt-0.5">
                  {tr.objective.researchToggleHint}
                </span>
              </span>
            </label>

            {gen.running ? (
              <GenerationProgress
                progress={progress}
                elapsedMs={gen.elapsedMs}
                withResearch={webResearch}
                onCancel={handleCancel}
                tr={tr}
              />
            ) : sameInputs ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setView('plans')}
                  className="w-full bg-ai-accent/15 hover:bg-ai-accent/30 text-ai-accent text-sm py-3 min-h-[44px] rounded-sm border border-ai-accent/40 transition-colors font-medium"
                >
                  {tr.objective.viewExistingPlans(plans!.length)}
                </button>
                <button
                  type="button"
                  onClick={handleGenerate}
                  className="tap w-full text-xs text-text-muted hover:text-text-primary py-1.5 transition-colors"
                >
                  {tr.objective.regenerate}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={!objective.trim()}
                  className="w-full bg-ai-accent/15 hover:bg-ai-accent/30 disabled:opacity-40 disabled:cursor-not-allowed text-ai-accent text-sm py-3 min-h-[44px] rounded-sm border border-ai-accent/40 transition-colors font-medium"
                >
                  {plans ? tr.objective.regenerate : tr.objective.generate}
                </button>
                {plans && (
                  <button
                    type="button"
                    onClick={() => setView('plans')}
                    className="tap w-full text-xs text-text-muted hover:text-text-primary py-1.5 transition-colors"
                  >
                    {tr.objective.viewPreviousPlans(plans.length)}
                  </button>
                )}
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
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-text-primary text-lg font-semibold">
                  {plans[0]?.archetype === 'entender'
                    ? tr.objective.pickStrategyTitleUnderstand
                    : tr.objective.pickStrategyTitle}
                </h1>
                <p className="text-text-secondary text-xs mt-0.5">{tr.objective.pickStrategyHint}</p>
              </div>
              <button
                type="button"
                onClick={() => setView('form')}
                disabled={more.running}
                className="tap shrink-0 text-text-muted hover:text-text-secondary text-xs disabled:opacity-40"
              >
                ← {tr.common.back}
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
                  <h3 className="text-[11px] font-mono uppercase tracking-wider text-text-muted mb-2">
                    {tr.objective.strategyLabel(g.strategy)} · {g.plans.length}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {g.plans.map(renderCard)}
                  </div>
                </section>
              ))
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{sortedPlans.map(renderCard)}</div>
            )}

            {more.running ? (
              <GenerationProgress
                progress={progress}
                elapsedMs={more.elapsedMs}
                withResearch={webResearch}
                onCancel={handleCancel}
                tr={tr}
              />
            ) : plans.length >= MAX_PLANS ? (
              <p className="text-xs text-text-muted text-center py-2">{tr.objective.morePlansLimit}</p>
            ) : (
              <button
                type="button"
                onClick={handleMorePlans}
                className="w-full py-2.5 min-h-[44px] text-xs border border-dashed border-border-base rounded-sm text-text-muted hover:text-ai-accent hover:border-ai-accent/40 transition-colors"
              >
                {tr.objective.morePlans}
              </button>
            )}

            {more.error && !more.running && (
              <InlineError
                error={more.error}
                onRetry={handleMorePlans}
                onAction={errorAction(more.error)}
              />
            )}

            {/* CTA fixo: sempre visível no mobile depois de escolher. */}
            <div className="sticky bottom-0 z-10 -mx-4 sm:-mx-8 px-4 sm:px-8 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] bg-bg-primary/95 backdrop-blur border-t border-border-base">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!selectedPlan}
                className="w-full bg-ai-accent/15 hover:bg-ai-accent/30 disabled:opacity-40 disabled:cursor-not-allowed text-ai-accent text-sm py-3 min-h-[44px] px-3 rounded-sm border border-ai-accent/40 transition-colors font-medium truncate"
              >
                {selectedPlan ? tr.objective.startWith(selectedPlan.title) : tr.objective.pickFirst}
              </button>
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
      className={`mb-4 max-w-2xl flex items-center gap-2 flex-wrap rounded-sm border px-3 py-2 text-xs ${
        tone === 'warn'
          ? 'border-conf-mid/40 bg-conf-mid/10 text-text-primary'
          : 'border-ai-accent/30 bg-ai-accent/5 text-text-secondary'
      }`}
    >
      <span className="flex-1 min-w-0">{children}</span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          className="tap rounded-sm border border-border-base px-2.5 py-1 text-xs text-text-primary hover:bg-bg-elevated disabled:opacity-40"
        >
          {action.label}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={dismissLabel}
        className="tap rounded-sm px-1.5 text-text-muted hover:text-text-primary"
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
    <div
      className="border border-ai-accent/30 bg-ai-accent/5 rounded-sm p-4 space-y-3"
      aria-label={tr.objective.progressAria}
    >
      <style>{`
        @keyframes cp-indeterminate { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }
        .cp-indeterminate { animation: cp-indeterminate 1.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .cp-indeterminate { animation: none; width: 100%; opacity: .5; } }
      `}</style>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1 overflow-hidden rounded-full bg-ai-accent/15" aria-hidden>
          <div className="cp-indeterminate h-full w-1/3 rounded-full bg-ai-accent/70" />
        </div>
        <span className="font-mono text-xs text-text-secondary tabular-nums">{formatClock(elapsedMs)}</span>
        <button
          type="button"
          onClick={onCancel}
          className="tap rounded-sm border border-border-base px-3 py-1 text-xs text-text-secondary hover:text-text-primary hover:border-text-muted transition-colors"
        >
          {tr.objective.cancel}
        </button>
      </div>

      <ol className="space-y-1.5 text-sm">
        {steps.map((s) => (
          <li key={s.key} className="flex items-start gap-2">
            <span
              aria-hidden
              className={`w-4 shrink-0 text-center ${
                s.state === 'done'
                  ? 'text-conf-high'
                  : s.state === 'active'
                  ? 'text-ai-accent animate-pulse'
                  : 'text-text-faint'
              }`}
            >
              {s.state === 'done' ? '✓' : s.state === 'active' ? '◆' : '·'}
            </span>
            <span className="min-w-0">
              <span
                className={
                  s.state === 'active'
                    ? 'text-text-primary'
                    : s.state === 'done'
                    ? 'text-text-secondary'
                    : 'text-text-faint'
                }
              >
                {s.label}
              </span>
              {s.hint && <span className="block text-xs text-text-muted">{s.hint}</span>}
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
    <div className="space-y-2 border-t border-ai-accent/20 pt-3">
      {plans.map((p, i) => (
        <div key={i} className="border-l-2 border-ai-accent/40 pl-3">
          <div className="text-sm text-text-primary">
            <span className="text-ai-accent" aria-hidden>
              ◆
            </span>{' '}
            <span className="font-semibold">{p?.title ?? '…'}</span>
          </div>
          {p?.pitch && <div className="text-xs text-text-secondary leading-snug mt-0.5">{p.pitch}</div>}
          {p?.tree?.categorias && p.tree.categorias.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {p.tree.categorias.map((cat, j) => (
                <div key={j} className="text-[11px] text-text-muted">
                  <span className="text-ai-accent/60" aria-hidden>
                    ›
                  </span>{' '}
                  {cat?.name ?? '…'}
                  {cat?.children && cat.children.length > 0 && <span> · {cat.children.length}</span>}
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
  cumpre: { icon: '✓', cls: 'border-conf-high/40 text-conf-high bg-conf-high/10' },
  risco: { icon: '⚠', cls: 'border-conf-mid/40 text-conf-mid bg-conf-mid/10' },
  viola: { icon: '✗', cls: 'border-state-problem/40 text-state-problem bg-state-problem/10' },
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

  return (
    <div
      onClick={onSelect}
      className={`p-4 rounded-sm border-2 transition-all flex flex-col cursor-pointer ${
        selected
          ? 'border-ai-accent bg-ai-accent/5'
          : 'border-border-base bg-bg-secondary hover:border-text-muted'
      }`}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={stop(onSelect)}
        className="text-left w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-ai-accent rounded-sm"
      >
        <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
          <span
            className={`shrink-0 text-[11px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-[2px] border ${
              p.rank === 1
                ? 'bg-conf-high/15 text-conf-high border-conf-high/40'
                : 'bg-bg-primary text-text-muted border-border-base'
            }`}
          >
            {p.rank === 1 ? `★ ${tr.objective.rankBest}` : `#${p.rank}`}
          </span>
          {isNew && (
            <span className="shrink-0 text-[11px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-[2px] border border-ai-accent/50 text-ai-accent bg-ai-accent/15">
              {tr.objective.newBadge}
            </span>
          )}
          <span className="ml-auto shrink-0 text-[11px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-[2px] bg-ai-accent/10 text-ai-accent border border-ai-accent/30">
            {tr.objective.strategyLabel(p.strategy)}
          </span>
        </div>
        <div className="text-base font-semibold leading-tight text-text-primary">{p.title}</div>
      </button>

      {(p.estimates || (p.rulesCheck && p.rulesCheck.length > 0)) && (
        <div className="mt-2 flex gap-1 flex-wrap">
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
                  className={`inline-flex max-w-full items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-[2px] border ${st.cls}`}
                >
                  <span aria-hidden>{st.icon}</span>
                  <span className="truncate max-w-[14rem]">{r.rule}</span>
                </span>
              );
            })}
        </div>
      )}

      <p className="mt-2 text-sm text-text-secondary leading-snug">{p.pitch}</p>

      {!collapsed && (
        <>
          {p.rankReason && (
            <p
              className={`mt-2 text-xs leading-snug ${
                p.rank === 1 ? 'text-conf-high/90' : 'text-text-muted'
              }`}
            >
              {p.rankReason}
            </p>
          )}

          {p.approach && (
            <div className="mt-2">
              <button
                type="button"
                onClick={stop(() => setApproachOpen((v) => !v))}
                aria-expanded={approachOpen}
                className="tap text-xs text-text-muted hover:text-text-primary"
              >
                {approachOpen ? `▾ ${tr.objective.hideApproach}` : `▸ ${tr.objective.showApproach}`}
              </button>
              {approachOpen && (
                <p className="mt-1 text-xs text-text-secondary leading-snug">{p.approach}</p>
              )}
            </div>
          )}

          {p.tree.categorias.map((cat) => {
            const shown = fullOpen ? cat.children : cat.children.slice(0, PREVIEW_CHILDREN);
            const rest = cat.children.length - shown.length;
            return (
              <div key={cat.tempId} className="mt-2 border-t border-border-base pt-2">
                <div className="text-[11px] font-mono uppercase tracking-wider text-text-muted mb-1">
                  {cat.name} · {cat.children.length}
                </div>
                <ul className="space-y-0.5">
                  {shown.map((n) => (
                    <li key={n.tempId} className="text-xs text-text-secondary leading-snug">
                      <span className="text-text-muted font-mono" aria-hidden>
                        ·
                      </span>{' '}
                      {n.name}
                    </li>
                  ))}
                  {rest > 0 && <li className="text-[11px] text-text-muted">+{rest}</li>}
                </ul>
              </div>
            );
          })}

          {hiddenNodes > 0 && (
            <button
              type="button"
              onClick={stop(() => setFullOpen((v) => !v))}
              aria-expanded={fullOpen}
              className="tap mt-2 self-start text-xs text-text-muted hover:text-text-primary"
            >
              {fullOpen ? `▾ ${tr.objective.hideFullPlan}` : `▸ ${tr.objective.showFullPlan(totalNodes)}`}
            </button>
          )}
        </>
      )}

      {collapsible && !selected && (
        <button
          type="button"
          onClick={stop(() => setDetailsOpen((v) => !v))}
          aria-expanded={detailsOpen}
          className="tap mt-2 self-start text-xs text-text-muted hover:text-text-primary"
        >
          {detailsOpen ? `▾ ${tr.objective.hideDetails}` : `▸ ${tr.objective.showDetails}`}
        </button>
      )}
    </div>
  );
}

function Chip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span
      title={label}
      className="inline-flex items-center text-[11px] px-1.5 py-0.5 rounded-[2px] border border-border-base bg-bg-primary text-text-secondary"
    >
      <span className="sr-only">{label}: </span>
      {children}
    </span>
  );
}
