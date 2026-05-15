import { useEffect, useMemo, useState } from 'react';
import {
  PROVIDER_DEFAULTS,
  PROVIDER_KEY_HINTS,
  PROVIDER_LABELS,
  useConfigStore,
  type Provider,
  type ProviderConfig,
} from '@/config/store';
import { useT } from '@/i18n';
import { useGraphStore } from '@/store';
import { Logo } from './Logo';
import { LanguageToggle } from './LanguageToggle';

const PROVIDERS: Provider[] = ['openrouter', 'openai', 'anthropic'];

interface Props {
  onClose?: () => void;
}

export function ApiKeyGate({ onClose }: Props) {
  const tr = useT();
  const activeProvider = useConfigStore((s) => s.activeProvider);
  const providers = useConfigStore((s) => s.providers);
  const saveProviderConfig = useConfigStore((s) => s.saveProviderConfig);
  const setActiveProvider = useConfigStore((s) => s.setActiveProvider);
  const clearProvider = useConfigStore((s) => s.clearProvider);
  const loadDemoProject = useGraphStore((s) => s.loadDemoProject);

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

  useEffect(() => {
    const cfg = providers[selected];
    setApiKey(cfg?.apiKey ?? '');
    setMainModel(cfg?.mainModel ?? PROVIDER_DEFAULTS[selected].mainModel);
    setKbModel(cfg?.kbModel ?? PROVIDER_DEFAULTS[selected].kbModel);
    setShowKey(false);
  }, [selected, providers]);

  const canSave = useMemo(
    () => apiKey.trim().length > 8 && mainModel.trim() && kbModel.trim(),
    [apiKey, mainModel, kbModel],
  );

  const handleSave = () => {
    if (!canSave) return;
    const cfg: ProviderConfig = {
      apiKey: apiKey.trim(),
      mainModel: mainModel.trim(),
      kbModel: kbModel.trim(),
    };
    saveProviderConfig(selected, cfg);
    setActiveProvider(selected);
    onClose?.();
  };

  const handleClear = () => {
    if (!existing) return;
    if (!confirm(tr.apiKey.removeKeyConfirm(PROVIDER_LABELS[selected]))) return;
    clearProvider(selected);
    setApiKey('');
  };

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
        {!onClose && (
          <div className="mb-6 rounded-sm border border-ai-accent/30 bg-gradient-to-br from-ai-accent/10 to-ai-accent/[0.03] p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-mono uppercase tracking-widest text-ai-accent mb-1">
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
            <div className="mt-3 text-[10px] font-mono text-text-muted">
              {tr.apiKey.demoCtaHint}
            </div>
          </div>
        )}

        {/* Divider */}
        {!onClose && (
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 h-px bg-border-base" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-text-muted">
              {tr.apiKey.demoDivider}
            </span>
            <div className="flex-1 h-px bg-border-base" />
          </div>
        )}

        {/* Provider selector */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-5">
          {PROVIDERS.map((p) => {
            const has = Boolean(providers[p]?.apiKey);
            const active = selected === p;
            return (
              <button
                key={p}
                onClick={() => setSelected(p)}
                className={`relative p-3 text-left rounded-sm border-2 transition-all ${
                  active
                    ? 'border-ai-accent bg-ai-accent/10'
                    : 'border-border-base bg-bg-secondary hover:border-text-muted'
                }`}
              >
                <div className="text-xs font-mono uppercase tracking-wider text-text-muted mb-1">
                  {has ? tr.apiKey.statusConfigured : tr.apiKey.statusConfigure}
                </div>
                <div className="text-sm font-semibold text-text-primary">{PROVIDER_LABELS[p]}</div>
                {has && p === activeProvider && (
                  <div className="absolute top-2 right-2 text-[10px] font-mono text-ai-accent">
                    {tr.apiKey.statusActive}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Form */}
        <div className="bg-bg-secondary border border-border-base rounded-sm p-5 space-y-4">
          <Field
            label={tr.apiKey.apiKeyField(PROVIDER_LABELS[selected])}
            hint={PROVIDER_KEY_HINTS[selected]}
          >
            <div className="flex gap-1">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={PROVIDER_KEY_HINTS[selected].split(' ')[0]}
                spellCheck={false}
                autoComplete="off"
                className="flex-1 bg-bg-elevated border border-border-base rounded-sm px-3 py-2 text-sm font-mono focus:border-ai-accent outline-none"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                className="px-3 text-xs border border-border-base rounded-sm text-text-muted hover:text-text-primary transition-colors"
              >
                {showKey ? tr.apiKey.hideKey : tr.apiKey.showKey}
              </button>
            </div>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={tr.apiKey.mainModelLabel} hint={tr.apiKey.mainModelHint}>
              <input
                value={mainModel}
                onChange={(e) => setMainModel(e.target.value)}
                spellCheck={false}
                className="w-full bg-bg-elevated border border-border-base rounded-sm px-3 py-2 text-sm font-mono focus:border-ai-accent outline-none"
              />
            </Field>
            <Field label={tr.apiKey.kbModelLabel} hint={tr.apiKey.kbModelHint}>
              <input
                value={kbModel}
                onChange={(e) => setKbModel(e.target.value)}
                spellCheck={false}
                className="w-full bg-bg-elevated border border-border-base rounded-sm px-3 py-2 text-sm font-mono focus:border-ai-accent outline-none"
              />
            </Field>
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

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="flex-1 bg-ai-accent/15 hover:bg-ai-accent/30 disabled:opacity-40 disabled:cursor-not-allowed text-ai-accent text-sm py-2.5 min-h-[44px] rounded-sm border border-ai-accent/40 transition-colors font-medium"
            >
              {existing ? tr.apiKey.saveAndUse : tr.apiKey.configureAndEnter}
            </button>
            {existing && (
              <button
                onClick={handleClear}
                className="px-4 py-2.5 text-xs text-text-muted hover:text-state-problem border border-border-base hover:border-state-problem/40 rounded-sm transition-colors"
              >
                {tr.apiKey.removeKey}
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="px-4 py-2.5 text-xs text-text-muted hover:text-text-primary border border-border-base rounded-sm transition-colors"
              >
                {tr.common.cancel}
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 text-[11px] font-mono text-text-muted text-center">
          {tr.apiKey.footer}
        </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1.5">
        {label}
      </label>
      {children}
      {hint && <div className="text-[10px] text-text-muted mt-1 font-mono">{hint}</div>}
    </div>
  );
}

