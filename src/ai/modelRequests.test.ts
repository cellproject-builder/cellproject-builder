import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import { configureCloud } from '@/cloud/runtime';
import { PROVIDER_DEFAULTS, useConfigStore } from '@/config/store';
import { aiModel, kbModel } from './client';
import { groundedText } from './research';

let payloads: Record<string, unknown>[];
beforeEach(async () => {
  configureCloud(null);
  await useConfigStore.persist.rehydrate();
  useConfigStore.getState().saveProviderConfig('openrouter', { apiKey: 'offline-fixture', ...PROVIDER_DEFAULTS.openrouter });
  useConfigStore.getState().setActiveProvider('openrouter');
  payloads = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    payloads.push(JSON.parse(String(init?.body)));
    return Response.json({ id: 'fixture-response', created: 1, model: 'openai/gpt-6.1-sol', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); useConfigStore.setState({ activeProvider: null, providers: {} }); });

describe('serialized model requests', () => {
  it.each(['main', 'pdf'] as const)('sends GPT-6.1 Sol with low reasoning for %s requests', async role => {
    const result = await generateText({ model: role === 'main' ? aiModel : kbModel, prompt: 'Offline request fixture', maxRetries: 0 });
    expect(result.text).toBe('ok');
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ model: 'openai/gpt-6.1-sol', reasoning: { effort: 'low' } });
  });

  it('sends low reasoning on the first web research request with its search plugin', async () => {
    expect(await groundedText({ system: 'Offline fixture', prompt: 'Offline research fixture', maxRetries: 0 })).toMatchObject({ text: 'ok' });
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ model: 'openai/gpt-6.1-sol', reasoning: { effort: 'low' }, plugins: [{ id: 'web', engine: 'exa' }] });
  });
});
