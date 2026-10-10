import { describe, expect, it, vi } from 'vitest';
import { APICallError, NoObjectGeneratedError } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { pickRelevantDocs } from './service';
import type { KBDocument } from './types';

const holder = vi.hoisted(() => ({ model: null as unknown as Record<string | symbol, unknown> }));
vi.mock('@/ai/client', () => ({
  assertAIReady: () => {},
  currentModelIds: () => ({ kb: 'test-model' }),
  isReasoningModel: () => false,
  kbModel: new Proxy({}, {
    get: (_target, key) => {
      const value = holder.model[key];
      return typeof value === 'function' ? value.bind(holder.model) : value;
    },
  }),
}));

const docs: KBDocument[] = [{
  id: 'd1', filename: 'doc.pdf', sizeBytes: 1, pageCount: 1, extractedAt: 1,
  extractedText: 'text', fingerprint: 'fp',
  summary: { titulo: 'Doc', dominio: 'test', tags: [], resumo: ['summary'], fatos: [], nivel: 'iniciante' },
}];

describe('chat knowledge selection request controls', () => {
  it('does not retry a retryable provider limit or replace its metadata', async () => {
    const error = new APICallError({
      message: 'Too many requests', url: 'https://provider.invalid', requestBodyValues: {},
      statusCode: 429, responseHeaders: { 'retry-after': '7' }, isRetryable: true,
    });
    const model = new MockLanguageModelV3({ doGenerate: async () => { throw error; } });
    holder.model = model as unknown as Record<string | symbol, unknown>;
    const beforeRequest = vi.fn().mockResolvedValue(undefined);
    await expect(pickRelevantDocs({ label: 'goal' }, docs, 2, {
      maxRetries: 0, beforeRequest,
    })).rejects.toBe(error);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(beforeRequest).toHaveBeenCalledTimes(1);
  });

  it('cancellation while waiting for the chat request gate prevents a provider call', async () => {
    const model = new MockLanguageModelV3({ doGenerate: async () => { throw new Error('must not run'); } });
    holder.model = model as unknown as Record<string | symbol, unknown>;
    let release!: () => void;
    const beforeRequest = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const ctrl = new AbortController();
    const request = pickRelevantDocs({ label: 'goal' }, docs, 2, {
      signal: ctrl.signal, maxRetries: 0, beforeRequest,
    });
    expect(beforeRequest).toHaveBeenCalledTimes(1);
    expect(model.doGenerateCalls).toHaveLength(0);
    ctrl.abort();
    release();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('does not use the malformed JSON retry for a wrapped provider limit', async () => {
    const error = new NoObjectGeneratedError({
      cause: new APICallError({
        message: 'Too many requests', url: 'https://provider.invalid', requestBodyValues: {},
        statusCode: 429, isRetryable: false,
      }),
      text: '{', response: { id: 'r', timestamp: new Date(), modelId: 'test' },
      usage: {
        inputTokens: 1, outputTokens: 1, totalTokens: 2,
        inputTokenDetails: { noCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        outputTokenDetails: { textTokens: 1, reasoningTokens: 0 },
      },
      finishReason: 'error',
    });
    const model = new MockLanguageModelV3({ doGenerate: async () => { throw error; } });
    holder.model = model as unknown as Record<string | symbol, unknown>;
    await expect(pickRelevantDocs({ label: 'goal' }, docs, 2, { maxRetries: 0 })).rejects.toBe(error);
    expect(model.doGenerateCalls).toHaveLength(1);
  });
});
