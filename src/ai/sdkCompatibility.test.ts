import { describe, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { providerToolForCurrentSDK, researchModelForCurrentSDK } from './sdkCompatibility';

describe('installed provider SDK web tools', () => {
  it('sends the OpenAI web search tool on the wire', async () => {
    let payload: Record<string, unknown> = {};
    const client = createOpenAI({ apiKey: 'offline-fixture', fetch: async (_url, init) => {
      payload = JSON.parse(String(init?.body));
      return Response.json({ id: 'resp_test', object: 'response', created_at: 1, model: 'fixture', status: 'completed', output: [{ id: 'msg_test', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } });
    } });
    const result = await generateText({ model: researchModelForCurrentSDK(client.responses('fixture')), tools: { web_search: providerToolForCurrentSDK(client.tools.webSearch({ searchContextSize: 'medium' })) }, prompt: 'Search', maxRetries: 0 });
    expect(result.text).toBe('ok');
    expect(payload.tools).toEqual([expect.objectContaining({ type: 'web_search', search_context_size: 'medium' })]);
  });

  it('sends the Anthropic web search tool on the wire', async () => {
    let payload: Record<string, unknown> = {};
    const client = createAnthropic({ apiKey: 'offline-fixture', fetch: async (_url, init) => {
      payload = JSON.parse(String(init?.body));
      return Response.json({ id: 'msg_test', type: 'message', role: 'assistant', model: 'fixture', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 2 } });
    } });
    const result = await generateText({ model: researchModelForCurrentSDK(client('fixture')), tools: { web_search: providerToolForCurrentSDK(client.tools.webSearch_20250305({ maxUses: 4 })) }, prompt: 'Search', maxRetries: 0 });
    expect(result.text).toBe('ok');
    expect(payload.tools).toEqual([expect.objectContaining({ type: 'web_search_20250305', max_uses: 4 })]);
  });

  it('adapts streaming calls too and preserves ordinary function tools and cancellation', async () => {
    const doStream = vi.fn(async (_options: unknown) => ({ stream: new ReadableStream() }));
    const model = { specificationVersion: 'v2', provider: 'fixture', modelId: 'fixture', supportedUrls: {}, doGenerate: vi.fn(), doStream } as const;
    const bridge = researchModelForCurrentSDK(model);
    const signal = new AbortController().signal;
    const functionTool = { type: 'function', name: 'local', inputSchema: { type: 'object' } };
    const options = { prompt: [], abortSignal: signal, tools: [{ type: 'provider', id: 'openai.web_search', name: 'web_search', args: {} }, functionTool] };
    await bridge.doStream(options as never);
    expect(doStream).toHaveBeenCalledWith({ ...options, tools: [{ ...options.tools[0], type: 'provider-defined' }, functionTool] });
    expect(options.tools[0].type).toBe('provider');
  });
});
