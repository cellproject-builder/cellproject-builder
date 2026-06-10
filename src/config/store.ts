import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';

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
}

export const PROVIDER_LABELS: Record<Provider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
};

export const PROVIDER_KEY_HINTS: Record<Provider, string> = {
  openai: 'sk-proj-... (https://platform.openai.com/api-keys)',
  anthropic: 'sk-ant-... (https://console.anthropic.com/settings/keys)',
  openrouter: 'sk-or-v1-... (https://openrouter.ai/keys)',
};

export const PROVIDER_DEFAULTS: Record<Provider, { mainModel: string; kbModel: string }> = {
  openai: { mainModel: 'gpt-4o', kbModel: 'gpt-4o-mini' },
  anthropic: { mainModel: 'claude-sonnet-4-5', kbModel: 'claude-haiku-4-5' },
  openrouter: { mainModel: 'google/gemini-3.5-flash', kbModel: 'google/gemini-2.0-flash-001' },
};

interface ConfigState {
  activeProvider: Provider | null;
  providers: Partial<Record<Provider, ProviderConfig>>;

  setActiveProvider: (p: Provider) => void;
  saveProviderConfig: (p: Provider, cfg: ProviderConfig) => void;
  clearProvider: (p: Provider) => void;
  clearAll: () => void;
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

      setActiveProvider: (p) => set({ activeProvider: p }),

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
      version: 1,
      storage: createJSONStorage(() => idbStorage),
    },
  ),
);

export function getActiveConfig(): { provider: Provider; config: ProviderConfig } | null {
  const s = useConfigStore.getState();
  if (!s.activeProvider) return null;
  const cfg = s.providers[s.activeProvider];
  if (!cfg || !cfg.apiKey) return null;
  return { provider: s.activeProvider, config: cfg };
}

export class AIMissingKeyError extends Error {
  constructor() {
    super('Nenhuma chave de API configurada. Abra as configurações e adicione uma.');
    this.name = 'AIMissingKeyError';
  }
}

export function assertAIReady() {
  if (!getActiveConfig()) throw new AIMissingKeyError();
}
