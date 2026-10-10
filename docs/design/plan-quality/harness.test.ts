import { describe, expect, it } from 'vitest';
import { BudgetLedger, createRecordedFetch, redact, readUsage } from '../../../scripts/planning-quality-core';

describe('planning evaluation evidence boundary', () => {
  it('redacts nested credentials and literal secrets without deleting unrelated source evidence', () => {
    const evidence = redact({ authorization: 'Bearer any-value', apiKey: 'hidden', nested: ['key=local-secret', '300 W [specs]'], token: 'hidden' }, ['local-secret']);
    expect(evidence).toEqual({ authorization: '[REDACTED]', apiKey: '[REDACTED]', nested: ['key=[REDACTED]', '300 W [specs]'], token: '[REDACTED]' });
    expect(redact('Bearer abc.def sk-or-v1-abcdef', [])).toBe('Bearer [REDACTED] [REDACTED]');
  });

  it('reserves each HTTP attempt before sending, including a retry and failed responses', async () => {
    const ledger = new BudgetLedger(2, 5, { prompt: 0.001, completion: 0.01 });
    const records: unknown[] = [];
    const fetcher = createRecordedFetch({ ledger, model: 'test/model', stage: () => 'cell:outline', secrets: [],
      remote: async () => new Response('first response', { status: 429 }), onRecord: record => { records[record.attempt - 1] = record; } });
    const init = { method: 'POST', body: JSON.stringify({ model: 'test/model', messages: [], max_tokens: 10 }) };
    await (await fetcher('https://openrouter.ai/api/v1/chat/completions', init)).text();
    await (await fetcher('https://openrouter.ai/api/v1/chat/completions', init)).text();
    await fetcher.flush();
    await expect(fetcher('https://openrouter.ai/api/v1/chat/completions', init)).rejects.toThrow('request_limit');
    expect(ledger.attempts).toBe(2);
    expect(records).toMatchObject([{ attempt: 1, status: 429, responseText: 'first response' }, { attempt: 2, status: 429, responseText: 'first response' }]);
  });

  it('refuses an unaffordable request and a different model before touching the network', async () => {
    let networkCalls = 0;
    const ledger = new BudgetLedger(12, 0.01, { prompt: 0.01, completion: 0.01 });
    const fetcher = createRecordedFetch({ ledger, model: 'test/model', stage: () => 'x', secrets: [], remote: async () => { networkCalls++; return new Response(''); }, onRecord: () => {} });
    await expect(fetcher('https://openrouter.ai/api/v1/chat/completions', { body: JSON.stringify({ model: 'test/model', max_tokens: 100 }) })).rejects.toThrow('budget_limit');
    await expect(fetcher('https://openrouter.ai/api/v1/chat/completions', { body: JSON.stringify({ model: 'other', max_tokens: 1 }) })).rejects.toThrow('model_mismatch');
    expect(networkCalls).toBe(0);
    expect(ledger.attempts).toBe(0);
  });

  it('keeps malformed provider text and first-attempt transport errors verbatim except secrets', async () => {
    const records: any[] = [];
    let requests = 0;
    const fetcher = createRecordedFetch({ ledger: new BudgetLedger(3, 1, { prompt: 0, completion: 0 }), model: 'm', stage: () => 'conflict:expand', secrets: ['local-secret'],
      remote: async () => { if (requests++ === 0) throw new Error('network local-secret'); return new Response('data: {bad json local-secret}\n\ndata: [DONE]\n\n'); }, onRecord: record => { records[record.attempt - 1] = record; } });
    const init = { body: '{"model":"m","max_tokens":1}' };
    await expect(fetcher('https://openrouter.ai/api/v1/chat/completions', init)).rejects.toThrow('network');
    await (await fetcher('https://openrouter.ai/api/v1/chat/completions', init)).text();
    await fetcher.flush();
    expect(records[0]).toMatchObject({ attempt: 1, error: 'network [REDACTED]' });
    expect(records[1].responseText).toBe('data: {bad json [REDACTED]}\n\ndata: [DONE]\n\n');
    expect(records[1].requestText).toBe(init.body);
  });

  it('reads terminal SSE usage once and leaves absent cost unknown', () => {
    expect(readUsage(': OPENROUTER PROCESSING\n\ndata: {"usage":{"prompt_tokens":4,"completion_tokens":6,"cost":0.3}}\n\ndata: [DONE]\n\n')).toEqual({ inputTokens: 4, outputTokens: 6, costUsd: 0.3 });
    expect(readUsage('data: {"usage":{"prompt_tokens":4,"completion_tokens":6,"cost":0.3}}\n\ndata: [DONE]\n\n')).toEqual({ inputTokens: 4, outputTokens: 6, costUsd: 0.3 });
    expect(readUsage('{"usage":{"prompt_tokens":2,"completion_tokens":3}}')).toEqual({ inputTokens: 2, outputTokens: 3, costUsd: null });
    expect(readUsage('not json')).toEqual({ inputTokens: null, outputTokens: null, costUsd: null });
  });

  it('retains received text when the response stream fails midway', async () => {
    const records: any[] = []; let pulls = 0;
    const fetcher = createRecordedFetch({ ledger: new BudgetLedger(1, 1, { prompt: 0, completion: 0 }), model: 'm', stage: () => 'x', secrets: [],
      remote: async () => new Response(new ReadableStream({ async pull(controller) { if (pulls++ === 0) controller.enqueue(new TextEncoder().encode('data: partial\n\n')); else { await new Promise(resolve => setTimeout(resolve, 10)); controller.error(new Error('stream_lost')); } } })),
      onRecord: record => { records[record.attempt - 1] = record; } });
    const response = await fetcher('https://openrouter.ai/api/v1/chat/completions', { body: '{"model":"m","max_tokens":1}' });
    await expect(response.text()).rejects.toThrow('stream_lost'); await fetcher.flush();
    expect(records[0]).toMatchObject({ responseText: 'data: partial\n\n', error: 'stream_lost' });
  });
});
