import { useEffect, useMemo, useState } from 'react';
import {
  PROVIDER_DEFAULTS,
  PROVIDER_KEY_HINTS,
  PROVIDER_LABELS,
  useConfigStore,
  type Provider,
  type ProviderConfig,
} from '@/config/store';

const PROVIDERS: Provider[] = ['openrouter', 'openai', 'anthropic'];

interface Props {
  // Quando aberto via "settings" (já tem config), mostra botão fechar.
  onClose?: () => void;
}

export function ApiKeyGate({ onClose }: Props) {
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

  // Quando troca de provider, carrega o que já existe (ou defaults).
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
    if (!confirm(`Remover chave de ${PROVIDER_LABELS[selected]}?`)) return;
    clearProvider(selected);
    setApiKey('');
  };

  return (
    <div className="fixed inset-0 bg-bg-primary flex items-center justify-center overflow-y-auto p-4 sm:p-6 z-50">
      <div className="w-full max-w-2xl">
        <div className="text-ai-accent text-xs font-mono uppercase tracking-widest mb-2">
          ◆ Cellproject · Configuração de IA
        </div>
        <h1 className="text-2xl font-semibold text-text-primary mb-2">
          Traga sua própria chave (BYOK).
        </h1>
        <p className="text-sm text-text-secondary mb-6 leading-relaxed">
          O Cellproject é local-first. Sua chave fica salva apenas no IndexedDB deste navegador —
          nunca passa por nenhum servidor além do provider que você escolheu.
        </p>

        {/* Seletor de provider */}
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
                  {has ? '✓ configurado' : 'configurar'}
                </div>
                <div className="text-sm font-semibold text-text-primary">{PROVIDER_LABELS[p]}</div>
                {has && p === activeProvider && (
                  <div className="absolute top-2 right-2 text-[10px] font-mono text-ai-accent">
                    ATIVO
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Formulário */}
        <div className="bg-bg-secondary border border-border-base rounded-sm p-5 space-y-4">
          <Field
            label={`Chave de API ${PROVIDER_LABELS[selected]}`}
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
                {showKey ? 'ocultar' : 'ver'}
              </button>
            </div>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Modelo principal" hint="usado em todo planejamento">
              <input
                value={mainModel}
                onChange={(e) => setMainModel(e.target.value)}
                spellCheck={false}
                className="w-full bg-bg-elevated border border-border-base rounded-sm px-3 py-2 text-sm font-mono focus:border-ai-accent outline-none"
              />
            </Field>
            <Field label="Modelo do KB" hint="resumir PDF, escolher relevância (mais barato)">
              <input
                value={kbModel}
                onChange={(e) => setKbModel(e.target.value)}
                spellCheck={false}
                className="w-full bg-bg-elevated border border-border-base rounded-sm px-3 py-2 text-sm font-mono focus:border-ai-accent outline-none"
              />
            </Field>
          </div>

          <div className="text-[11px] text-text-muted leading-relaxed border-t border-border-base pt-3">
            <strong className="text-text-secondary">Onde a chave fica:</strong> só neste navegador,
            dentro do IndexedDB (chave <code className="font-mono">cellproject-config</code>).
            Limpe os dados do site e a chave some.
            {selected === 'anthropic' && (
              <>
                <br />
                <span className="text-conf-mid">
                  Aviso Anthropic: chamadas diretas do browser usam o header
                  <code className="font-mono"> anthropic-dangerous-direct-browser-access</code>.
                  Funciona, mas se der CORS, use OpenRouter como gateway.
                </span>
              </>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="flex-1 bg-ai-accent/15 hover:bg-ai-accent/30 disabled:opacity-40 disabled:cursor-not-allowed text-ai-accent text-sm py-2.5 min-h-[44px] rounded-sm border border-ai-accent/40 transition-colors font-medium"
            >
              {existing ? 'Salvar e usar' : 'Configurar e entrar'}
            </button>
            {existing && (
              <button
                onClick={handleClear}
                className="px-4 py-2.5 text-xs text-text-muted hover:text-state-problem border border-border-base hover:border-state-problem/40 rounded-sm transition-colors"
              >
                Remover chave
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="px-4 py-2.5 text-xs text-text-muted hover:text-text-primary border border-border-base rounded-sm transition-colors"
              >
                Cancelar
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 text-[11px] font-mono text-text-muted text-center">
          ◆ open-source · BYOK · sem backend · seus projetos vivem no seu navegador
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
