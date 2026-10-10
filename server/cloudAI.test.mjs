import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAIProxy } from './cloudAI.mjs';
import { generateObject, generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';

async function withProxy(fetchImpl, run) {
  const proxy = createAIProxy({ keys: { openrouter: 'SERVER_PROVIDER_SECRET', openai: 'SERVER_OPENAI_SECRET', anthropic: 'SERVER_ANTHROPIC_SECRET' }, fetchImpl });
  const server = createServer((req, res) => proxy(req, res, { user: { id: 'owner-1' } })); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('AI proxy fixes destinations and credentials, strips client auth, and streams without buffering', async () => {
  let finish;
  await withProxy(async (url, init) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions'); assert.equal(init.headers.authorization, 'Bearer SERVER_PROVIDER_SECRET'); assert.equal(init.headers.cookie, undefined); assert.equal(init.headers['x-api-key'], undefined); assert.deepEqual(JSON.parse(init.body).messages, [{ role: 'user', content: 'Hello' }]);
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: first\n\n')); finish = () => { controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); controller.close(); }; } });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'set-cookie': 'LEAKED_COOKIE', authorization: 'LEAKED_KEY' } });
  }, async origin => {
    const response = await fetch(`${origin}/api/ai/openrouter/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer CLIENT_SECRET', cookie: 'client-session', 'x-api-key': 'CLIENT_SECRET' }, body: JSON.stringify({ model: 'openai/test-model', stream: true, messages: [{ role: 'user', content: 'Hello' }], max_tokens: 200 }) });
    assert.equal(response.status, 200); assert.equal(response.headers.get('set-cookie'), null); assert.equal(response.headers.get('authorization'), null);
    const reader = response.body.getReader(); const first = await reader.read(); assert.match(new TextDecoder().decode(first.value), /first/); finish(); const rest = await reader.read(); assert.match(new TextDecoder().decode(rest.value), /DONE/); await reader.cancel();
  });
});

test('unrecognized provider/paths/methods, credential payloads and unbounded generation reject before upstream', async () => {
  let calls = 0;
  await withProxy(async () => { calls++; throw new Error('SENTINEL_SECRET'); }, async origin => {
    for (const [route, method, value] of [['/api/ai/openrouter/models', 'POST', {}], ['/api/ai/openrouter/chat/completions?url=https://evil.test', 'POST', {}], ['/api/ai/openrouter/chat/completions', 'GET', null], ['/api/ai/evil/chat/completions', 'POST', {}], ['/api/ai/openrouter/chat/completions', 'POST', { model: 'x', messages: [], max_tokens: 999999 }], ['/api/ai/openai/responses', 'POST', { model: 'x', input: 'test', background: true }], ['/api/ai/openrouter/chat/completions', 'POST', { model: 'x', messages: [], api_key: 'user-key' }]]) {
      const response = await fetch(`${origin}${route}`, { method, ...(value ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) } : {}) }); assert.ok(response.status >= 400); assert.doesNotMatch(await response.text(), /SENTINEL_SECRET/);
    }
  }); assert.equal(calls, 0);
});

test('upstream auth failures and secret error text are sanitized without automatic paid retries', async () => {
  let calls = 0;
  await withProxy(async () => { calls++; return new Response(JSON.stringify({ error: 'SENTINEL_SECRET' }), { status: 401 }); }, async origin => {
    const response = await fetch(`${origin}/api/ai/openai/responses`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'test', input: 'Hello' }) }); assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /SENTINEL_SECRET/);
  }); assert.equal(calls, 1);
});

test('disconnecting a streaming client aborts its upstream request and does not retry', async () => {
  let finishAbort; let calls = 0;
  const aborted = new Promise(resolve => { finishAbort = resolve; });
  await withProxy(async (_url, init) => {
    calls++; init.signal.addEventListener('abort', finishAbort, { once: true });
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: started\n\n')); } }), { headers: { 'content-type': 'text/event-stream' } });
  }, async origin => {
    const response = await fetch(`${origin}/api/ai/openrouter/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'test', stream: true, messages: [{ role: 'user', content: 'test' }] }) });
    const reader = response.body.getReader(); assert.equal((await reader.read()).done, false); await reader.cancel();
    await Promise.race([aborted, new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Upstream was not aborted')), 2000).unref())]);
  }); assert.equal(calls, 1);
});

test('installed SDKs support structured chat and version-adapted web search tools through the fixed proxy', async () => {
  const paths = [];
  // ai@6 passes V3 provider tools unchanged to V2 models. Adapt both sides,
  // rather than a type cast that would silently drop provider search tools.
  const modelWithV2Tools = model => new Proxy(model, { get(target, property) {
    if (property === 'doGenerate' || property === 'doStream') return options => target[property]({ ...options, tools: options.tools?.map(tool => tool.type === 'provider' ? { ...tool, type: 'provider-defined' } : tool) });
    return target[property];
  } });
  await withProxy(async (url, init) => {
    paths.push(url); const body = JSON.parse(init.body);
    if (url.includes('anthropic.com')) {
      assert.equal(init.headers['x-api-key'], 'SERVER_ANTHROPIC_SECRET'); assert.equal(init.headers['anthropic-version'], '2023-06-01');
      assert.equal(body.tools[0].type, 'web_search_20250305');
      return new Response(JSON.stringify({ id: 'msg_test', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 2 } }), { headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/responses')) {
      assert.equal(body.tools[0].type, 'web_search');
      return new Response(JSON.stringify({ id: 'resp_test', object: 'response', created_at: 1, model: body.model, status: 'completed', output: [{ id: 'msg_test', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } }), { headers: { 'content-type': 'application/json' } });
    }
    const structured = Boolean(body.response_format);
    return new Response(JSON.stringify({ id: 'chat_test', object: 'chat.completion', model: body.model, created: 1, choices: [{ index: 0, message: { role: 'assistant', content: structured ? '{"label":"Board"}' : 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }), { headers: { 'content-type': 'application/json' } });
  }, async origin => {
    const openrouter = createOpenRouter({ apiKey: 'client-placeholder', baseURL: `${origin}/api/ai/openrouter` });
    const structured = await generateObject({ model: openrouter.chat('fixture'), schema: z.object({ label: z.string() }), prompt: 'Board', maxOutputTokens: 1000, maxRetries: 0 }); assert.deepEqual(structured.object, { label: 'Board' });
    const openai = createOpenAI({ apiKey: 'client-placeholder', baseURL: `${origin}/api/ai/openai` });
    assert.equal((await generateText({ model: openai.chat('fixture'), prompt: 'Hello', maxOutputTokens: 1000, maxRetries: 0 })).text, 'ok');
    assert.equal((await generateText({ model: modelWithV2Tools(openai.responses('fixture')), tools: { web_search: { ...openai.tools.webSearch({ searchContextSize: 'medium' }), type: 'provider' } }, prompt: 'Search', maxOutputTokens: 1000, maxRetries: 0 })).text, 'ok');
    const anthropic = createAnthropic({ apiKey: 'client-placeholder', baseURL: `${origin}/api/ai/anthropic` });
    assert.equal((await generateText({ model: modelWithV2Tools(anthropic('fixture')), tools: { web_search: { ...anthropic.tools.webSearch_20250305({ maxUses: 4 }), type: 'provider' } }, prompt: 'Search', maxOutputTokens: 1000, maxRetries: 0 })).text, 'ok');
  });
  assert.deepEqual(paths, ['https://openrouter.ai/api/v1/chat/completions', 'https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1/responses', 'https://api.anthropic.com/v1/messages']);
});
