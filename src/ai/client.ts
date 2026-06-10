import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';
import {
  getActiveConfig,
  assertAIReady,
  AIMissingKeyError,
  type Provider,
  type ProviderConfig,
} from '@/config/store';

// ---------------------------------------------------------------------------
// Multi-provider AI client.
// O usuário traz a própria chave (BYOK) — lida em runtime do config store.
// Nada de import.meta.env: a chave nunca entra no bundle.
// ---------------------------------------------------------------------------

interface ResolvedModels {
  main: LanguageModel;
  kb: LanguageModel;
  mainId: string;
  kbId: string;
  provider: Provider;
}

function buildModels(provider: Provider, cfg: ProviderConfig): ResolvedModels {
  if (provider === 'openai') {
    const client = createOpenAI({ apiKey: cfg.apiKey });
    return {
      main: client.chat(cfg.mainModel),
      kb: client.chat(cfg.kbModel),
      mainId: cfg.mainModel,
      kbId: cfg.kbModel,
      provider,
    };
  }
  if (provider === 'anthropic') {
    // O Anthropic SDK valida que estamos fora do browser por padrão. Como o
    // user trouxe a própria chave e aceita o trade-off de XSS, liberamos.
    const client = createAnthropic({
      apiKey: cfg.apiKey,
      headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
    });
    return {
      main: client(cfg.mainModel),
      kb: client(cfg.kbModel),
      mainId: cfg.mainModel,
      kbId: cfg.kbModel,
      provider,
    };
  }
  // openrouter
  const client = createOpenRouter({
    apiKey: cfg.apiKey,
    appName: 'cellproject',
    appUrl: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173',
  });
  return {
    main: client.chat(cfg.mainModel, openrouterSettings(cfg.mainModel)),
    kb: client.chat(cfg.kbModel, openrouterSettings(cfg.kbModel)),
    mainId: cfg.mainModel,
    kbId: cfg.kbModel,
    provider,
  };
}

// "Grok 4.3 high" = modelo x-ai/grok-4.3 + reasoning effort "high" — no
// OpenRouter o effort vai no corpo da request, não no id do modelo. Restrito
// aos grok: outros modelos podem rejeitar o parâmetro de reasoning.
function openrouterSettings(modelId: string): { reasoning?: { effort: 'high' } } {
  return /(^|\/)grok-/i.test(modelId) ? { reasoning: { effort: 'high' } } : {};
}

function resolve(): ResolvedModels {
  const active = getActiveConfig();
  if (!active) throw new AIMissingKeyError();
  return buildModels(active.provider, active.config);
}

// Proxy lazy: ai/service.ts importa `aiModel` e `kbModel` como se fossem
// objetos prontos, mas internamente cada call resolve a config atual. Isso
// permite trocar de provider em runtime (botão Settings) sem reload.
function lazyModel(pick: 'main' | 'kb'): LanguageModel {
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        const resolved = resolve();
        const model = resolved[pick] as unknown as Record<string | symbol, unknown>;
        const value = model[prop];
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(model) : value;
      },
    },
  ) as unknown as LanguageModel;
}

export const aiModel = lazyModel('main');
export const kbModel = lazyModel('kb');

// IDs continuam disponíveis pra debug / telemetria.
export function currentModelIds(): { main: string; kb: string; provider: Provider } | null {
  const active = getActiveConfig();
  if (!active) return null;
  return {
    main: active.config.mainModel,
    kb: active.config.kbModel,
    provider: active.provider,
  };
}

export { assertAIReady, AIMissingKeyError };
