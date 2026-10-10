import { describe, expect, it, vi } from 'vitest';
import { generateObject } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import { normalizeVisualVisionError, visualVisionPrompt } from './vision';

describe('installed SDK and OpenRouter vision compatibility', () => {
  it('encodes local image bytes as a multimodal request and parses structured output without network access', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      expect(body.model).toBe('vision-fixture');
      expect(body.messages).toEqual([{ role: 'user', content: [
        { type: 'text', text: 'Build the selected board' },
        { type: 'text', text: expect.stringContaining('board.png') },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
      ] }]);
      expect(body.response_format.type).toBe('json_schema');
      return new Response(JSON.stringify({ id: 'vision-test', model: 'vision-fixture', created: 1, choices: [{ index: 0, message: { role: 'assistant', content: '{"label":"Board"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }), { headers: { 'content-type': 'application/json' } });
    });
    const provider = createOpenRouter({ apiKey: 'fixture-only', fetch: fetcher });
    const result = await generateObject({ model: provider.chat('vision-fixture'), schema: z.object({ label: z.string() }), ...visualVisionPrompt('Build the selected board', [{ mediaId: 'local-board', label: 'board.png', image: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }]), maxRetries: 0 });
    expect(result.object).toEqual({ label: 'Board' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves explicit provider rejection of a non-vision model without a text-only retry', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { code: 400, message: 'This model does not support image input' } }), { status: 400, headers: { 'content-type': 'application/json' } }));
    const provider = createOpenRouter({ apiKey: 'fixture-only', fetch: fetcher });
    const call = generateObject({ model: provider.chat('text-only-fixture'), schema: z.object({ label: z.string() }), ...visualVisionPrompt('Build', [{ mediaId: 'image', label: 'board', image: new Uint8Array([1]), mediaType: 'image/png' }]), maxRetries: 0 }).catch(reason => { throw normalizeVisualVisionError(reason); });
    await expect(call).rejects.toThrow('visualVisionUnsupported');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
