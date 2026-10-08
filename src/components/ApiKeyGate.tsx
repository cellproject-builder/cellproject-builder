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

  // Aberto por cima de outra tela (TopBar, tela de objetivo): sheet de Ajustes.
  if (onClose) {
    return (
      <Modal open onClose={onClose} title={tr.apiKey.modalTitle} className="max-w-xl">
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
    <div className="fixed inset-0 bg-bg-primary overflow-y-auto scroll-stable z-50">
      <div
        className="min-h-full flex items-center justify-center px-4 sm:px-6 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1rem)] sm:pt-[max(env(safe-area-inset-top),1.5rem)] sm:pb-[max(env(safe-area-inset-bottom),1.5rem)]"
      >
        <div className="w-full max-w-xl py-4 sm:py-8">
          {/* Utility row — language picker stays out of the brand line */}
          <div className="flex items-center justify-between gap-3 mb-8">
            <div className="flex items-center gap-2 min-w-0">
              <Logo size={20} className="text-text-primary shrink-0" />
              <span className="text-control font-semibold text-text-primary truncate">
                {tr.apiKey.kicker}
              </span>
            </div>
            <LanguageToggle />
          </div>

          <h1 className="text-title2 sm:text-title1 font-bold tracking-[-0.01em] text-text-primary mb-2">
            {tr.apiKey.title}
          </h1>
          <p className="text-body text-text-secondary mb-6">{tr.apiKey.subtitle}</p>

          {/* Demo CTA — visible BEFORE the config form so newcomers can try without setup */}
          <div className="card p-4 sm:p-5 mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5">
              <div className="flex-1 min-w-0">
                <div className="text-control font-semibold text-text-primary mb-1">
                  {tr.apiKey.demoTitle}
                </div>
                <p className="text-footnote text-text-secondary">{tr.apiKey.demoBody}</p>
              </div>
              <button
                type="button"
                onClick={loadDemoProject}
                className="tap btn btn-secondary shrink-0 px-4"
              >
                {tr.apiKey.demoCta}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="text-footnote text-text-muted">{tr.apiKey.demoCtaHint}</span>
              <a
                href="/landing"
                className="tap inline-flex items-center text-footnote text-accent hover:underline underline-offset-2"
              >
                {tr.apiKey.learnMore}
              </a>
            </div>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-6">
            <div className="divider flex-1" />
            <span className="text-footnote text-text-muted">{tr.apiKey.demoDivider}</span>
            <div className="divider flex-1" />
          </div>

          <div className="card p-4 sm:p-6">
            <ConfigForm />
          </div>

          <p className="mt-6 text-footnote text-text-muted text-center">{tr.apiKey.footer}</p>
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
    <div className="space-y-5">
      {/* Provider selector — controle segmentado com o estado de cada provedor */}
      <div className="segmented grid w-full grid-cols-3">
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
              className="segmented-item min-w-0 flex-col gap-0 py-1.5 px-2"
            >
              <span className="block w-full truncate text-control font-semibold">
                {PROVIDER_LABELS[p]}
              </span>
              <span
                className={`flex w-full items-center justify-center gap-1 truncate text-caption font-normal ${
                  inUse ? 'text-accent' : has ? 'text-text-secondary' : 'text-text-muted'
                }`}
              >
                {(inUse || has) && (
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${inUse ? 'bg-accent' : 'bg-state-done'}`}
                  />
                )}
                <span className="truncate">
                  {inUse
                    ? tr.apiKey.statusActive
                    : has
                    ? tr.apiKey.statusConfigured
                    : tr.apiKey.statusConfigure}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <Field label={tr.apiKey.apiKeyField(PROVIDER_LABELS[selected])}>
        {(id) => (
          <>
            <div className="flex gap-2">
              <input
                id={id}
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={keyInfo.prefix}
                spellCheck={false}
                autoComplete="off"
                aria-describedby={prefixMismatch ? `${id}-warn` : undefined}
                className="field flex-1 min-w-0 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                className="tap btn btn-secondary shrink-0"
              >
                {showKey ? tr.apiKey.hideKey : tr.apiKey.showKey}
              </button>
            </div>
            {prefixMismatch && (
              <p id={`${id}-warn`} className="mt-1.5 text-footnote text-conf-mid">
                {tr.apiKey.keyPrefixWarning(PROVIDER_LABELS[selected], KEY_PREFIX[selected])}
              </p>
            )}
            <div className="mt-2 text-footnote text-text-muted">
              <a
                href={keyInfo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline underline-offset-2"
              >
                {tr.apiKey.createKeyLink(PROVIDER_LABELS[selected])}
              </a>
              {selected === 'openrouter' && (
                <ol className="mt-1.5 list-decimal pl-4 space-y-0.5 marker:text-text-faint">
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
      <div>
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
          className="tap -mx-2 flex h-8 w-[calc(100%+1rem)] items-center gap-2 rounded-control px-2 text-left text-control text-text-primary transition-colors duration-120 ease-mac hover:bg-bg-elevated"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            aria-hidden
            className={`shrink-0 text-text-muted transition-transform duration-180 ease-mac ${
              advancedOpen ? 'rotate-90' : ''
            }`}
          >
            <path d="M3.5 2 6.5 5l-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="font-medium">{tr.apiKey.advanced}</span>
          <span className="ml-auto min-w-0 truncate text-footnote text-text-muted">
            {tr.apiKey.modelSummary(summary.label, summary.effort)}
          </span>
        </button>
        {advancedOpen && (
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-card bg-bg-primary p-3 sm:p-4">
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

      <div className="text-footnote text-text-muted">
        <strong className="font-medium text-text-secondary">{tr.apiKey.whereTitle}</strong>{' '}
        {tr.apiKey.whereBody('cellproject-config')}
        {selected === 'anthropic' && (
          <span className="mt-2 block rounded-control bg-conf-mid/12 px-2.5 py-1.5 text-conf-mid">
            {tr.apiKey.anthropicWarning}
          </span>
        )}
      </div>

      {confirmingRemove ? (
        <div
          role="alertdialog"
          aria-label={tr.apiKey.removeKeyConfirm(PROVIDER_LABELS[selected])}
          className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-card bg-state-problem/8 p-3"
        >
          <span className="flex-1 text-control text-text-primary">
            {tr.apiKey.removeKeyConfirm(PROVIDER_LABELS[selected])}
          </span>
          <button type="button" onClick={handleClear} className="tap btn btn-danger">
            {tr.apiKey.removeKeyYes}
          </button>
          <button
            type="button"
            onClick={() => setConfirmingRemove(false)}
            className="tap btn btn-secondary"
          >
            {tr.common.cancel}
          </button>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="btn btn-primary px-5 sm:order-last"
          >
            {existing ? tr.apiKey.saveAndUse : tr.apiKey.configureAndEnter}
          </button>
          {existing && (
            <button
              type="button"
              onClick={() => setConfirmingRemove(true)}
              className="tap btn btn-danger sm:order-first sm:mr-auto"
            >
              {tr.apiKey.removeKey}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="tap btn btn-secondary"
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
            className="field"
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
              className="field mt-1.5 font-mono"
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
      <label htmlFor={id} className="label block mb-1.5">
        {label}
      </label>
      {children(id)}
      {hint && <div className="text-footnote text-text-muted mt-1">{hint}</div>}
    </div>
  );
}
