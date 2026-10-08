import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import { t } from '@/i18n';

// ---------------------------------------------------------------------------
// Config store — BYOK (Bring Your Own Key).
// A chave do provider mora aqui, no IndexedDB do navegador do usuário.
// Nunca é enviada para nenhum servidor além do próprio provider.
// ---------------------------------------------------------------------------

export type Provider = 'openai' | 'anthropic' | 'openrouter';

export interface ProviderConfig {
  apiKey: string;
  mainModel: string;
  kbModel: string;
  // Modelo da pesquisa web (digest = extração, não raciocínio). Ausente →
  // usa o kbModel, mais barato e rápido. Ver researchModelId().
  researchModel?: string;
}

export const PROVIDER_LABELS: Record<Provider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
};

// Prefixo da chave e onde gerá-la — separados pra UI montar link clicável.
export const PROVIDER_KEY_INFO: Record<Provider, { prefix: string; url: string }> = {
  openai: { prefix: 'sk-proj-...', url: 'https://platform.openai.com/api-keys' },
  anthropic: { prefix: 'sk-ant-...', url: 'https://console.anthropic.com/settings/keys' },
  openrouter: { prefix: 'sk-or-v1-...', url: 'https://openrouter.ai/keys' },
};

// Legado (texto único "prefixo (url)") — mantido pros call sites antigos.
export const PROVIDER_KEY_HINTS: Record<Provider, string> = {
  openai: `${PROVIDER_KEY_INFO.openai.prefix} (${PROVIDER_KEY_INFO.openai.url})`,
  anthropic: `${PROVIDER_KEY_INFO.anthropic.prefix} (${PROVIDER_KEY_INFO.anthropic.url})`,
  openrouter: `${PROVIDER_KEY_INFO.openrouter.prefix} (${PROVIDER_KEY_INFO.openrouter.url})`,
};

// Modelos conhecidos por provider, pro select do ApiKeyGate. `effort` é o
// reasoning effort que o client manda (ver ai/client.ts openrouterSettings);
// o rótulo traduzido vem de t().ai.models.effort(effort). `role` diz em qual
// campo o modelo faz sentido (principal, base/pesquisa ou ambos).
export interface KnownModel {
  id: string;
  label: string;
  effort?: 'low' | 'medium' | 'high';
  role: 'main' | 'kb' | 'both';
}

export const KNOWN_MODELS: Record<Provider, KnownModel[]> = {
  openrouter: [
    { id: 'openai/gpt-6.1-sol', label: 'GPT-6.1 Sol', effort: 'medium', role: 'main' },
    { id: 'x-ai/grok-4.3', label: 'Grok 4.3', effort: 'high', role: 'main' },
    { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash', role: 'both' },
    { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', role: 'kb' },
  ],
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o', role: 'main' },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini', role: 'kb' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', role: 'main' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', role: 'kb' },
  ],
};

export function researchModelId(cfg: ProviderConfig): string {
  return cfg.researchModel?.trim() || cfg.kbModel;
}

export const PROVIDER_DEFAULTS: Record<Provider, { mainModel: string; kbModel: string }> = {
  openai: { mainModel: 'gpt-4o', kbModel: 'gpt-4o-mini' },
  anthropic: { mainModel: 'claude-sonnet-4-5', kbModel: 'claude-haiku-4-5' },
  // GPT-6.1 Sol com reasoning effort "medium" — o effort é parâmetro de
  // request (ver ai/client.ts), não faz parte do id do modelo.
  openrouter: { mainModel: 'openai/gpt-6.1-sol', kbModel: 'google/gemini-2.5-flash-lite' },
};

// kbModel default antigo que saiu do ar no OpenRouter — migrado no persist.
const DEAD_OPENROUTER_KB_MODEL = 'google/gemini-2.0-flash-001';
// mainModel default da era gemini — config persistida volta pro grok no v3.
const OLD_OPENROUTER_MAIN_MODEL = 'google/gemini-3.5-flash';
// defaults anteriores que migram pro gpt-6.1-sol no v4.
const PRE_V4_OPENROUTER_MAIN_MODELS = ['x-ai/grok-4.3', OLD_OPENROUTER_MAIN_MODEL];

interface ConfigState {
  activeProvider: Provider | null;
  providers: Partial<Record<Provider, ProviderConfig>>;
  // Pesquisa real na web: a IA busca fontes/documentação antes de planejar,
  // explicar e criticar. Opt-in global — cada busca custa créditos do provider.
  webResearchEnabled: boolean;

  setActiveProvider: (p: Provider) => void;
  saveProviderConfig: (p: Provider, cfg: ProviderConfig) => void;
  clearProvider: (p: Provider) => void;
  clearAll: () => void;
  setWebResearchEnabled: (enabled: boolean) => void;
}

const idbStorage: StateStorage = {
  getItem: async (name) => (await idbGet(name)) ?? null,
  setItem: async (name, value) => {
    await idbSet(name, value);
  },
  removeItem: async (name) => {
    await idbDel(name);
  },
};

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      activeProvider: null,
      providers: {},
      webResearchEnabled: false,

      setActiveProvider: (p) => set({ activeProvider: p }),

      setWebResearchEnabled: (enabled) => set({ webResearchEnabled: enabled }),

      saveProviderConfig: (p, cfg) =>
        set((state) => ({
          providers: { ...state.providers, [p]: cfg },
          activeProvider: state.activeProvider ?? p,
        })),

      clearProvider: (p) =>
        set((state) => {
          const { [p]: _gone, ...rest } = state.providers;
          void _gone;
          return {
            providers: rest,
            activeProvider: state.activeProvider === p ? null : state.activeProvider,
          };
        }),

      clearAll: () => set({ activeProvider: null, providers: {} }),
    }),
    {
      name: 'cellproject-config',
      version: 4, // v4: mainModel do OpenRouter → gpt-6.1-sol (medium)
      storage: createJSONStorage(() => idbStorage),
      migrate: (persisted, version) => {
        const state = persisted as Partial<ConfigState>;
        if (version < 2) {
          const or = state.providers?.openrouter;
          if (or && or.kbModel === DEAD_OPENROUTER_KB_MODEL) {
            or.kbModel = PROVIDER_DEFAULTS.openrouter.kbModel;
          }
        }
        if (version < 3) {
          const or = state.providers?.openrouter;
          if (or && or.mainModel === OLD_OPENROUTER_MAIN_MODEL) {
            or.mainModel = PROVIDER_DEFAULTS.openrouter.mainModel;
          }
        }
        if (version < 4) {
          const or = state.providers?.openrouter;
          if (or && PRE_V4_OPENROUTER_MAIN_MODELS.includes(or.mainModel)) {
            or.mainModel = PROVIDER_DEFAULTS.openrouter.mainModel;
          }
        }
        return state as ConfigState;
      },
    },
  ),
);

// Dev-only: sem provider configurado, semeia o OpenRouter com a chave do
// .env (ver vite.config). Em produção __DEV_OPENROUTER_KEY__ é '' e isto é no-op.
export function seedDevKey() {
  const key = typeof __DEV_OPENROUTER_KEY__ === 'string' ? __DEV_OPENROUTER_KEY__ : '';
  if (!key) return;
  const run = () => {
    const s = useConfigStore.getState();
    if (s.activeProvider && s.providers[s.activeProvider]?.apiKey) return;
    s.saveProviderConfig('openrouter', { apiKey: key, ...PROVIDER_DEFAULTS.openrouter });
    useConfigStore.getState().setActiveProvider('openrouter');
  };
  if (useConfigStore.persist.hasHydrated()) run();
  else useConfigStore.persist.onFinishHydration(run);
}

export function getActiveConfig(): { provider: Provider; config: ProviderConfig } | null {
  const s = useConfigStore.getState();
  if (!s.activeProvider) return null;
  const cfg = s.providers[s.activeProvider];
  if (!cfg || !cfg.apiKey) return null;
  return { provider: s.activeProvider, config: cfg };
}

export class AIMissingKeyError extends Error {
  constructor() {
    const e = t().ai.errors;
    super(`${e.missingKeyTitle}. ${e.missingKeyHint}`);
    this.name = 'AIMissingKeyError';
  }
}

export function assertAIReady() {
  if (!getActiveConfig()) throw new AIMissingKeyError();
}
