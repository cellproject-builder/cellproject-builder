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

// O reasoning effort vai no corpo da request do OpenRouter, não no id do
// modelo. Só mandamos pra famílias que aceitam o parâmetro: GPT-6.x Sol
// (padrão, effort "medium") e Grok (effort "high"). Outros modelos podem
// rejeitar o campo.
export type Effort = 'low' | 'medium' | 'high';
export function openrouterSettings(
  modelId: string,
  override?: Effort,
): { reasoning?: { effort: Effort } } {
  if (/(^|\/)gpt-6(\.\d+)?-sol/i.test(modelId)) return { reasoning: { effort: override ?? 'medium' } };
  if (/(^|\/)grok-/i.test(modelId)) return { reasoning: { effort: override ?? 'high' } };
  return {};
}

// ---------------------------------------------------------------------------
// callOpts — parâmetros de geração por fluxo.
// - Modelos de raciocínio (gpt-6.x/gpt-5, o-series, grok-4) ignoram ou
//   rejeitam temperature → omitida.
// - maxOutputTokens limita o custo de cada fluxo. Em modelos de raciocínio o
//   orçamento inclui os tokens de pensamento, então somamos uma folga.
// ---------------------------------------------------------------------------

export type AICallKind = 'plans' | 'decompose' | 'replan' | 'explain' | 'critique' | 'research';

const OUTPUT_BUDGET: Record<AICallKind, number> = {
  plans: 12_000,
  decompose: 3_000,
  replan: 3_000,
  explain: 3_000,
  critique: 1_200,
  research: 2_000,
};
const REASONING_HEADROOM = 4_000;

export function isReasoningModel(modelId: string): boolean {
  return /(^|\/)(gpt-[56]|o\d|grok-4)/i.test(modelId);
}

export function callOpts(
  kind: AICallKind,
  temperature: number,
  modelId: string | undefined = currentModelIds()?.main,
): { temperature?: number; maxOutputTokens: number } {
  const reasoning = !!modelId && isReasoningModel(modelId);
  const maxOutputTokens = OUTPUT_BUDGET[kind] + (reasoning ? REASONING_HEADROOM : 0);
  return reasoning ? { maxOutputTokens } : { temperature, maxOutputTokens };
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
