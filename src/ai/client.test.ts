import { describe, it, expect, afterEach } from 'vitest';
import { useConfigStore, PROVIDER_DEFAULTS } from '@/config/store';
import { effortProviderOptions, callOpts, openrouterSettings } from './client';

// O effort por chamada (esboços/expansão em 'low') vai em providerOptions —
// só para modelos/provedores que aceitam o parâmetro.
function activate(provider: 'openrouter' | 'openai' | 'anthropic', mainModel: string) {
  const store = useConfigStore.getState();
  store.saveProviderConfig(provider, {
    apiKey: 'test-key',
    ...PROVIDER_DEFAULTS[provider],
    mainModel,
  });
  store.setActiveProvider(provider);
}

describe('effortProviderOptions', () => {
  afterEach(() => {
    useConfigStore.setState({ activeProvider: null });
  });

  it('OpenRouter + gpt-6.x-sol → reasoning.effort no corpo', () => {
    activate('openrouter', 'openai/gpt-6.1-sol');
    expect(effortProviderOptions('low')).toEqual({ openrouter: { reasoning: { effort: 'low' } } });
  });

  it('defaults GPT-6.1 Sol to low and preserves a per-call effort override', () => {
    expect(openrouterSettings('openai/gpt-6.1-sol')).toEqual({ reasoning: { effort: 'low' } });
    expect(openrouterSettings('openai/gpt-6.1-sol', 'high')).toEqual({ reasoning: { effort: 'high' } });
    expect(openrouterSettings('google/gemini-2.5-flash-lite')).toEqual({});
  });

  it('OpenRouter + modelo sem reasoning → nada', () => {
    activate('openrouter', 'google/gemini-2.5-flash');
    expect(effortProviderOptions('low')).toBeUndefined();
  });

  it('OpenAI + modelo de raciocínio → reasoningEffort', () => {
    activate('openai', 'gpt-6.1-sol');
    expect(effortProviderOptions('low')).toEqual({ openai: { reasoningEffort: 'low' } });
  });

  it('Anthropic → nada', () => {
    activate('anthropic', 'claude-sonnet-4-5');
    expect(effortProviderOptions('low')).toBeUndefined();
  });

  it('orçamentos dos fluxos novos', () => {
    expect(callOpts('outline', 0.6, 'openai/gpt-6.1-sol').maxOutputTokens).toBeLessThan(
      callOpts('plans', 0.6, 'openai/gpt-6.1-sol').maxOutputTokens,
    );
    expect(callOpts('expand', 0.5, 'x/plain-model')).toEqual({ temperature: 0.5, maxOutputTokens: 6_000 });
  });
});
