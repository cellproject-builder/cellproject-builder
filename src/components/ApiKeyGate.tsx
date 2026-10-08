import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import {
  KNOWN_MODELS,
  PROVIDER_DEFAULTS,
  PROVIDER_KEY_INFO,
  PROVIDER_LABELS,
  useConfigStore,
  type KnownModel,
  type Provider,
  type ProviderConfig,
} from '@/config/store';
import { useT, type Messages } from '@/i18n';
import { useGraphStore } from '@/store';
import { Modal } from './ui/Modal';
import { Logo } from './Logo';
import { LanguageToggle } from './LanguageToggle';

const PROVIDERS: Provider[] = ['openrouter', 'openai', 'anthropic'];

// Prefixo real que a chave de cada provider tem — só pra avisar, nunca bloquear.
const KEY_PREFIX: Record<Provider, string> = {
  openrouter: 'sk-or-',
  openai: 'sk-',
  anthropic: 'sk-ant-',
};

const OTHER = '__other__';

// Rótulo humano do modelo ("GPT-6.1 Sol") + esforço de raciocínio traduzido.
// Modelo fora da lista → o próprio id, sem o prefixo do provedor.
export function modelDisplay(
  provider: Provider,
  modelId: string,
  tr: Messages,
): { label: string; effort?: string } {
  const known = KNOWN_MODELS[provider].find((m) => m.id === modelId);
  if (!known) return { label: modelId.split('/').pop() || modelId };
  return { label: known.label, effort: known.effort ? tr.ai.models.effort(known.effort) : undefined };
}

interface Props {
  onClose?: () => void;
  // Abre já com "Avançado" expandido (ex.: vindo de "Trocar modelo").
  initialAdvanced?: boolean;
}

export function ApiKeyGate({ onClose, initialAdvanced = false }: Props) {
  const tr = useT();

  // Aberto por cima de outra tela (TopBar, tela de objetivo): modal acessível.
  if (onClose) {
    return (
      <Modal open onClose={onClose} title={tr.apiKey.modalTitle} className="max-w-2xl">
        <ConfigForm onClose={onClose} initialAdvanced={initialAdvanced} />
      </Modal>
    );
  }

  return <FullScreenGate />;
}

function FullScreenGate() {
  const tr = useT();
  const loadDemoProject = useGraphStore((s) => s.loadDemoProject);

  return (
    <div className="fixed inset-0 bg-bg-primary overflow-y-auto z-50">
      <div
        className="min-h-full flex items-center justify-center px-4 sm:px-6 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1rem)] sm:pt-[max(env(safe-area-inset-top),1.5rem)] sm:pb-[max(env(safe-area-inset-bottom),1.5rem)]"
      >
        <div className="w-full max-w-2xl py-4 sm:py-6">
        {/* Utility row — language picker stays out of the brand line */}
        <div className="flex justify-end mb-2">
          <LanguageToggle />
        </div>
        <div className="flex items-center gap-2.5 mb-3 min-w-0">
          <Logo size={22} className="text-text-primary shrink-0" />
          <div className="text-ai-accent text-xs font-mono uppercase tracking-widest truncate">
            {tr.apiKey.kicker}
          </div>
        </div>
        <h1 className="text-2xl font-semibold text-text-primary mb-2">{tr.apiKey.title}</h1>
        <p className="text-sm text-text-secondary mb-5 leading-relaxed">{tr.apiKey.subtitle}</p>

        {/* Demo CTA — visible BEFORE the config form so newcomers can try without setup */}
        <div className="mb-6 rounded-sm border border-ai-accent/30 bg-gradient-to-br from-ai-accent/10 to-ai-accent/[0.03] p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-mono uppercase tracking-widest text-ai-accent mb-1">
                {tr.apiKey.demoTitle}
              </div>
              <p className="text-sm text-text-secondary leading-relaxed">
                {tr.apiKey.demoBody}
              </p>
            </div>
            <button
              onClick={loadDemoProject}
              className="shrink-0 px-4 sm:px-5 py-3 min-h-[44px] bg-ai-accent/20 hover:bg-ai-accent/35 border border-ai-accent/50 text-ai-accent text-sm font-semibold rounded-sm transition-colors whitespace-nowrap"
            >
              {tr.apiKey.demoCta}
            </button>
          </div>
          <div className="mt-3 text-[11px] font-mono text-text-muted">
            {tr.apiKey.demoCtaHint}
          </div>
          <div className="mt-2">
            <a
              href="/landing"
              className="text-[11px] font-mono text-text-muted hover:text-ai-accent transition-colors"
            >
              {tr.apiKey.learnMore}
            </a>
          </div>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 h-px bg-border-base" />
          <span className="text-[11px] font-mono uppercase tracking-widest text-text-muted">
            {tr.apiKey.demoDivider}
          </span>
          <div className="flex-1 h-px bg-border-base" />
        </div>

        <div className="bg-bg-secondary border border-border-base rounded-sm p-5">
          <ConfigForm />
        </div>

        <div className="mt-6 text-[11px] font-mono text-text-muted text-center">
          {tr.apiKey.footer}
        </div>
        </div>
      </div>
    </div>
  );
}

function ConfigForm({
  onClose,
  initialAdvanced = false,
}: {
  onClose?: () => void;
  initialAdvanced?: boolean;
}) {
  const tr = useT();
  const activeProvider = useConfigStore((s) => s.activeProvider);
  const providers = useConfigStore((s) => s.providers);
  const saveProviderConfig = useConfigStore((s) => s.saveProviderConfig);
  const setActiveProvider = useConfigStore((s) => s.setActiveProvider);
  const clearProvider = useConfigStore((s) => s.clearProvider);

  const [selected, setSelected] = useState<Provider>(activeProvider ?? 'openrouter');
  const existing = providers[selected];

  const [apiKey, setApiKey] = useState(existing?.apiKey ?? '');
  const [mainModel, setMainModel] = useState(
    existing?.mainModel ?? PROVIDER_DEFAULTS[selected].mainModel,
  );
  const [kbModel, setKbModel] = useState(
    existing?.kbModel ?? PROVIDER_DEFAULTS[selected].kbModel,
  );
  const [showKey, setShowKey] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(initialAdvanced);
  // Confirmação inline de "remover chave" (no lugar do confirm() nativo).
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  useEffect(() => {
    const cfg = providers[selected];
    setApiKey(cfg?.apiKey ?? '');
    setMainModel(cfg?.mainModel ?? PROVIDER_DEFAULTS[selected].mainModel);
    setKbModel(cfg?.kbModel ?? PROVIDER_DEFAULTS[selected].kbModel);
    setShowKey(false);
    setConfirmingRemove(false);
  }, [selected, providers]);

  const canSave = useMemo(
    () => apiKey.trim().length > 8 && mainModel.trim() && kbModel.trim(),
    [apiKey, mainModel, kbModel],
  );

  const trimmedKey = apiKey.trim();
  const prefixMismatch =
    trimmedKey.length > 0 && !trimmedKey.startsWith(KEY_PREFIX[selected]);

  const handleSave = () => {
    if (!canSave) return;
    const cfg: ProviderConfig = {
      // Preserva campos que este formulário não edita (ex.: researchModel).
      ...existing,
      apiKey: trimmedKey,
      mainModel: mainModel.trim(),
      kbModel: kbModel.trim(),
    };
    saveProviderConfig(selected, cfg);
    setActiveProvider(selected);
    onClose?.();
  };

  const handleClear = () => {
    if (!existing) return;
    clearProvider(selected);
    setApiKey('');
    setConfirmingRemove(false);
  };

  const keyInfo = PROVIDER_KEY_INFO[selected];
  const summary = modelDisplay(selected, mainModel.trim(), tr);

  return (
    <div className="space-y-4">
      {/* Provider selector */}
      <div className="grid grid-cols-3 gap-2">
        {PROVIDERS.map((p) => {
          const has = Boolean(providers[p]?.apiKey);
          const active = selected === p;
          const inUse = has && p === activeProvider;
          return (
            <button
              key={p}
              type="button"
              onClick={() => setSelected(p)}
              aria-pressed={active}
              className={`min-w-0 p-2.5 sm:p-3 text-left rounded-sm border-2 transition-all ${
                active
                  ? 'border-ai-accent bg-ai-accent/10'
                  : 'border-border-base bg-bg-elevated/40 hover:border-text-muted'
              }`}
            >
              <div
                className={`text-[11px] font-mono uppercase tracking-wider mb-1 truncate ${
                  inUse ? 'text-ai-accent' : 'text-text-muted'
                }`}
              >
                {inUse
                  ? `✓ ${tr.apiKey.statusActive}`
                  : has
                  ? tr.apiKey.statusConfigured
                  : tr.apiKey.statusConfigure}
              </div>
              <div className="text-sm font-semibold text-text-primary truncate">{PROVIDER_LABELS[p]}</div>
            </button>
          );
        })}
      </div>

      <Field label={tr.apiKey.apiKeyField(PROVIDER_LABELS[selected])}>
        {(id) => (
          <>
            <div className="flex gap-1">
              <input
                id={id}
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={keyInfo.prefix}
                spellCheck={false}
                autoComplete="off"
                aria-describedby={prefixMismatch ? `${id}-warn` : undefined}
                className="flex-1 min-w-0 bg-bg-elevated border border-border-base rounded-sm px-3 py-2 text-sm font-mono focus:border-ai-accent outline-none"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                className="tap px-3 text-xs border border-border-base rounded-sm text-text-muted hover:text-text-primary transition-colors"
              >
                {showKey ? tr.apiKey.hideKey : tr.apiKey.showKey}
              </button>
            </div>
            {prefixMismatch && (
              <p id={`${id}-warn`} className="mt-1.5 text-[11px] text-conf-mid">
                {tr.apiKey.keyPrefixWarning(PROVIDER_LABELS[selected], KEY_PREFIX[selected])}
              </p>
            )}
            <div className="mt-2 text-[11px] text-text-muted leading-relaxed">
              <a
                href={keyInfo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ai-accent hover:underline"
              >
                {tr.apiKey.createKeyLink(PROVIDER_LABELS[selected])}
              </a>
              {selected === 'openrouter' && (
                <ol className="mt-1 list-decimal pl-4 space-y-0.5">
                  {tr.apiKey.openrouterSteps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              )}
            </div>
          </>
        )}
      </Field>

      {/* Modelos atrás de "Avançado" — o padrão serve para quase todo mundo. */}
      <div className="border border-border-base rounded-sm">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
          className="tap w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary hover:text-text-primary"
        >
          <span className="text-text-muted">{advancedOpen ? '▾' : '▸'}</span>
          <span className="font-medium">{tr.apiKey.advanced}</span>
          <span className="ml-auto min-w-0 truncate text-text-muted">
            {tr.apiKey.modelSummary(summary.label, summary.effort)}
          </span>
        </button>
        {advancedOpen && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-border-base p-3">
            <ModelPicker
              label={tr.apiKey.mainModelLabel}
              hint={tr.apiKey.mainModelHint}
              options={KNOWN_MODELS[selected].filter((m) => m.role !== 'kb')}
              value={mainModel}
              onChange={setMainModel}
            />
            <ModelPicker
              label={tr.apiKey.kbModelLabel}
              hint={tr.apiKey.kbModelHint}
              options={KNOWN_MODELS[selected].filter((m) => m.role !== 'main')}
              value={kbModel}
              onChange={setKbModel}
            />
          </div>
        )}
      </div>

      <div className="text-[11px] text-text-muted leading-relaxed border-t border-border-base pt-3">
        <strong className="text-text-secondary">{tr.apiKey.whereTitle}</strong>{' '}
        {tr.apiKey.whereBody('cellproject-config')}
        {selected === 'anthropic' && (
          <>
            <br />
            <span className="text-conf-mid">{tr.apiKey.anthropicWarning}</span>
          </>
        )}
      </div>

      {confirmingRemove ? (
        <div
          role="alertdialog"
          aria-label={tr.apiKey.removeKeyConfirm(PROVIDER_LABELS[selected])}
          className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-sm border border-state-problem/40 bg-state-problem/10 p-3"
        >
          <span className="flex-1 text-sm text-text-primary">
            {tr.apiKey.removeKeyConfirm(PROVIDER_LABELS[selected])}
          </span>
          <button
            type="button"
            onClick={handleClear}
            className="tap px-3 py-1.5 text-xs text-state-problem border border-state-problem/50 rounded-sm hover:bg-state-problem/20 transition-colors"
          >
            {tr.apiKey.removeKeyYes}
          </button>
          <button
            type="button"
            onClick={() => setConfirmingRemove(false)}
            className="tap px-3 py-1.5 text-xs text-text-muted border border-border-base rounded-sm hover:text-text-primary transition-colors"
          >
            {tr.common.cancel}
          </button>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="flex-1 bg-ai-accent/15 hover:bg-ai-accent/30 disabled:opacity-40 disabled:cursor-not-allowed text-ai-accent text-sm py-2.5 min-h-[44px] rounded-sm border border-ai-accent/40 transition-colors font-medium"
          >
            {existing ? tr.apiKey.saveAndUse : tr.apiKey.configureAndEnter}
          </button>
          {existing && (
            <button
              type="button"
              onClick={() => setConfirmingRemove(true)}
              className="tap px-4 py-2.5 text-xs text-text-muted hover:text-state-problem border border-border-base hover:border-state-problem/40 rounded-sm transition-colors"
            >
              {tr.apiKey.removeKey}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="tap px-4 py-2.5 text-xs text-text-muted hover:text-text-primary border border-border-base rounded-sm transition-colors"
            >
              {tr.common.cancel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Select dos modelos conhecidos + "outro…" que revela um campo livre.
function ModelPicker({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  options: KnownModel[];
  value: string;
  onChange: (v: string) => void;
}) {
  const tr = useT();
  const isKnown = options.some((m) => m.id === value);
  const [custom, setCustom] = useState(!isKnown);

  // Troca de provider (valor externo muda) → select se o modelo for conhecido,
  // campo livre se não for. Depende só do valor: escolher "outro…" não o muda.
  useEffect(() => {
    setCustom(!isKnown);
  }, [value]);

  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <>
          <select
            id={id}
            value={custom ? OTHER : value}
            onChange={(e) => {
              if (e.target.value === OTHER) {
                setCustom(true);
                return;
              }
              setCustom(false);
              onChange(e.target.value);
            }}
            className="w-full bg-bg-elevated border border-border-base rounded-sm px-2 py-2 text-sm focus:border-ai-accent outline-none"
          >
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.effort ? ` · ${tr.ai.models.effort(m.effort)}` : ''}
              </option>
            ))}
            <option value={OTHER}>{tr.apiKey.otherModel}</option>
          </select>
          {custom && (
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={tr.apiKey.customModelPlaceholder}
              aria-label={label}
              spellCheck={false}
              className="mt-1.5 w-full bg-bg-elevated border border-border-base rounded-sm px-3 py-2 text-sm font-mono focus:border-ai-accent outline-none"
            />
          )}
        </>
      )}
    </Field>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[11px] font-mono uppercase tracking-wider text-text-muted mb-1.5"
      >
        {label}
      </label>
      {children(id)}
      {hint && <div className="text-[11px] text-text-muted mt-1">{hint}</div>}
    </div>
  );
}
