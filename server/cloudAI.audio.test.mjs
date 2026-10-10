import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAIProxy } from './cloudAI.mjs';

const ROUTE = '/api/ai/openrouter/audio/transcriptions';
const BYTE_LIMIT = 12 * 1024 * 1024;
const models = ['openai/gpt-4o-mini-transcribe', 'openai/whisper-large-v3-turbo'];
const fixtures = {
  wav: Buffer.from('524946462400000057415645666d74201000000001000100803e0000007d0000020010006461746100000000', 'hex'),
  mp3: Buffer.from('fffb906400000000', 'hex'),
  flac: Buffer.concat([Buffer.from('fLaC'), Buffer.from([0x80, 0, 0, 34]), Buffer.alloc(34)]),
  m4a: Buffer.from('00000018667479704d3441200000000069736f6d6d703432', 'hex'),
  ogg: Buffer.concat([Buffer.from('OggS'), Buffer.alloc(23)]),
  webm: Buffer.from('1a45dfa3874282847765626d', 'hex'),
  aac: Buffer.from('fff1508000fffc', 'hex'),
};
const requestBody = (format = 'wav', bytes = fixtures[format]) => ({ model: models[0], input_audio: { data: bytes.toString('base64'), format }, language: 'pt', response_format: 'json' });
const post = (origin, body, extra = {}) => fetch(`${origin}${ROUTE}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...extra });
const transcript = value => Response.json(value ?? { text: 'Uma anotação.' });
async function withProxy(fetchImpl, run, session = { user: { id: 'owner-1' } }) {
  const proxy = createAIProxy({ keys: { openrouter: 'SERVER_AUDIO_SECRET' }, fetchImpl });
  const server = createServer((req, res) => proxy(req, res, session));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { proxy.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('audio uses one fixed endpoint and server key, no token budget, and a sanitized JSON response', async () => {
  let calls = 0;
  await withProxy(async (url, init) => {
    calls++;
    assert.equal(url, 'https://openrouter.ai/api/v1/audio/transcriptions');
    assert.deepEqual(init.headers, { 'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer SERVER_AUDIO_SECRET' });
    assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(init.body), requestBody());
    return new Response(JSON.stringify({ text: 'Uma anotação.', usage: { seconds: 2.5, cost: 0.001, input_tokens: 12, output_tokens: 4, total_tokens: 16, provider_secret: 123 }, provider: 'PRIVATE_PROVIDER', internal: 'PRIVATE_TOKEN' }), { headers: { 'content-type': 'application/json', 'set-cookie': 'PRIVATE_COOKIE', authorization: 'PRIVATE_KEY' } });
  }, async origin => {
    const response = await post(origin, requestBody(), { headers: { 'content-type': 'application/json', authorization: 'Bearer CLIENT_SECRET', 'x-api-key': 'CLIENT_SECRET', cookie: 'CLIENT_COOKIE' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('authorization'), null);
    assert.deepEqual(await response.json(), { text: 'Uma anotação.', usage: { seconds: 2.5, cost: 0.001, input_tokens: 12, output_tokens: 4, total_tokens: 16 } });
  });
  assert.equal(calls, 1);
});

test('both transcription models and all seven real container signatures are accepted', async () => {
  const seen = [];
  await withProxy(async (_url, init) => { seen.push(JSON.parse(init.body)); return transcript(); }, async origin => {
    for (const [format, bytes] of Object.entries(fixtures)) {
      const response = await post(origin, requestBody(format, bytes));
      assert.equal(response.status, 200, format); await response.json();
    }
    const body = { model: models[1], input_audio: requestBody().input_audio };
    const response = await post(origin, body); assert.equal(response.status, 200); await response.json();
    assert.deepEqual(seen.at(-1), { ...body, response_format: 'json' });
    const english = { ...requestBody(), language: 'en' };
    assert.equal((await post(origin, english)).status, 200);
    const taggedMp3 = Buffer.concat([Buffer.from('49443304000000000000', 'hex'), fixtures.mp3]);
    assert.equal((await post(origin, requestBody('mp3', taggedMp3))).status, 200);
  });
  assert.equal(seen.length, 10);
});

test('container mismatches, fabricated signatures, unsupported brands and Matroska reject before upstream', async () => {
  let calls = 0;
  const bad = [
    ...Object.keys(fixtures).map(format => requestBody(format, Buffer.from('this is not audio'))),
    requestBody('wav', fixtures.mp3), requestBody('mp3', fixtures.aac), requestBody('aac', fixtures.mp3),
    requestBody('mp3', Buffer.from('fffd906400000000', 'hex')),
    requestBody('mp3', Buffer.from('49443304000000000000', 'hex')),
    requestBody('wav', Buffer.from('RIFFxxxxxxxxnotWAVE')),
    requestBody('m4a', Buffer.from('0000001866747970626164200000000069736f6d6d703432', 'hex')),
    requestBody('webm', Buffer.from('1a45dfa38b4282886d6174726f736b61', 'hex')),
    requestBody('ogg', Buffer.concat([Buffer.from('OggS'), Buffer.from([1]), Buffer.alloc(22)])),
  ];
  await withProxy(async () => { calls++; return transcript(); }, async origin => {
    for (const body of bad) { const response = await post(origin, body); assert.equal(response.status, 400, body.input_audio.format); await response.json(); }
  });
  assert.equal(calls, 0);
});

test('base64 is nonempty canonical raw data, never a URL, data URI or permissively decoded string', async () => {
  let calls = 0;
  const good = requestBody().input_audio.data;
  const invalid = ['', 'https://example.test/audio.wav', `data:audio/wav;base64,${good}`, `${good}\n`, ` ${good}`, good.replace(/.$/, '!'), good.slice(1), 'AB==', 'AAAA===='];
  await withProxy(async () => { calls++; return transcript(); }, async origin => {
    for (const data of invalid) { const response = await post(origin, { ...requestBody(), input_audio: { format: 'wav', data } }); assert.equal(response.status, 400); await response.json(); }
  });
  assert.equal(calls, 0);
});

test('magic bytes are compared exactly, without masking the high bit as ASCII decoding does', async () => {
  let calls = 0;
  const offsets = { wav: 0, flac: 0, m4a: 4, ogg: 0, webm: 8 };
  await withProxy(async () => { calls++; return transcript(); }, async origin => {
    for (const [format, offset] of Object.entries(offsets)) {
      const bytes = Buffer.from(fixtures[format]); bytes[offset] |= 0x80;
      const response = await post(origin, requestBody(format, bytes)); assert.equal(response.status, 400, format); await response.json();
    }
  });
  assert.equal(calls, 0);
});

test('only the exact transcription fields, languages, formats and models reach the provider', async () => {
  let calls = 0;
  const bad = [
    ...['apiKey', 'api_key', 'authorization', 'access_token', 'url', 'provider', 'max_tokens', 'prompt', 'stream'].map(key => ({ ...requestBody(), [key]: key === 'stream' ? false : 'PRIVATE_VALUE' })),
    { ...requestBody(), model: 'openai/gpt-6.1-sol' }, { ...requestBody(), model: 'openai/whisper-large-v3' },
    { ...requestBody(), language: 'pt-BR' }, { ...requestBody(), language: null },
    { ...requestBody(), response_format: 'verbose_json' },
    { ...requestBody(), input_audio: { ...requestBody().input_audio, url: 'https://evil.test/recording' } },
    { ...requestBody(), input_audio: { ...requestBody().input_audio, format: 'mp4' } },
    { ...requestBody(), input_audio: null },
  ];
  await withProxy(async () => { calls++; return transcript(); }, async origin => {
    for (const body of bad) { const response = await post(origin, body); assert.equal(response.status, 400); assert.doesNotMatch(await response.text(), /PRIVATE_VALUE/); }
  });
  assert.equal(calls, 0);
});

test('the binary limit accepts exactly 12 MiB and rejects one extra byte without upstream', async () => {
  let calls = 0;
  const bytes = Buffer.alloc(BYTE_LIMIT); fixtures.wav.copy(bytes);
  await withProxy(async () => { calls++; return transcript(); }, async origin => {
    const accepted = await post(origin, requestBody('wav', bytes)); assert.equal(accepted.status, 200); await accepted.json();
    const rejected = await post(origin, requestBody('wav', Buffer.concat([bytes, Buffer.from([0])]))); assert.equal(rejected.status, 413); await rejected.json();
    const tooLargeJson = await post(origin, { padding: 'X'.repeat(16 * 1024 * 1024 + 16 * 1024) }); assert.equal(tooLargeJson.status, 413); await tooLargeJson.json();
  });
  assert.equal(calls, 1);
});

test('invalid upstream text, overlong text, oversized JSON and SSE are rejected without leaking provider data', async () => {
  const bad = [
    () => transcript({ text: 42, secret: 'PRIVATE_TOKEN' }),
    () => transcript({ text: 'x'.repeat(32_001), secret: 'PRIVATE_TOKEN' }),
    () => transcript({ text: 'ok', internal: 'PRIVATE_TOKEN'.repeat(40_000) }),
    () => new Response('data: PRIVATE_TOKEN\n\n', { headers: { 'content-type': 'text/event-stream' } }),
    () => new Response('{PRIVATE_TOKEN', { headers: { 'content-type': 'application/json' } }),
  ];
  let calls = 0;
  await withProxy(async () => bad[calls++](), async origin => {
    for (const _ of bad) { const response = await post(origin, requestBody()); assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /PRIVATE_TOKEN/); }
  });
  assert.equal(calls, bad.length);
});

test('response accepts 32000 characters and omits unsafe or unknown usage values', async () => {
  await withProxy(async () => transcript({ text: 'á'.repeat(32_000), usage: { seconds: -1, cost: 0.0001, input_tokens: 1.5, output_tokens: Number.MAX_SAFE_INTEGER + 1, total_tokens: '5', secret: 9 } }), async origin => {
    const response = await post(origin, requestBody()); assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { text: 'á'.repeat(32_000), usage: { cost: 0.0001 } });
  });
});

test('transcription uses a 90 second deadline, propagates timeout, and never retries', async t => {
  const deadline = new AbortController(); const timeouts = []; let calls = 0;
  t.mock.method(AbortSignal, 'timeout', ms => { timeouts.push(ms); return deadline.signal; });
  await withProxy(async (_url, init) => {
    calls++;
    return new Promise((_resolve, reject) => { init.signal.addEventListener('abort', () => reject(new Error('PRIVATE_TIMEOUT')), { once: true }); deadline.abort(); });
  }, async origin => {
    const response = await post(origin, requestBody()); assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /PRIVATE_TIMEOUT/);
  });
  assert.deepEqual(timeouts, [90_000]); assert.equal(calls, 1);
});

test('disconnecting the audio client aborts its upstream before a transcript is returned', async () => {
  let entered, aborted; let calls = 0;
  const inProvider = new Promise(resolve => { entered = resolve; });
  const providerAborted = new Promise(resolve => { aborted = resolve; });
  await withProxy(async (_url, init) => {
    calls++; entered();
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => { aborted(); reject(new Error('cancelled')); }, { once: true }));
  }, async origin => {
    const controller = new AbortController();
    const pending = post(origin, requestBody(), { signal: controller.signal }).catch(error => error);
    await Promise.race([inProvider, new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Audio never reached provider')), 1000).unref())]);
    controller.abort(); await pending;
    await Promise.race([providerAborted, new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Audio upstream not aborted')), 1000).unref())]);
  });
  assert.equal(calls, 1);
});

test('audio and chat share the same per-owner request budget', async () => {
  let calls = 0;
  await withProxy(async () => { calls++; return transcript(); }, async origin => {
    for (let index = 0; index < 40; index++) {
      const response = index % 2 ? await post(origin, requestBody()) : await fetch(`${origin}/api/ai/openrouter/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'fixture', messages: [] }) });
      assert.equal(response.status, 200); await response.json();
    }
    assert.equal((await post(origin, requestBody())).status, 429);
  });
  assert.equal(calls, 40);
});

test('audio requires an authenticated owner before any provider request', async () => {
  let calls = 0;
  await withProxy(async () => { calls++; return transcript(); }, async origin => {
    assert.equal((await post(origin, requestBody())).status, 401);
  }, null);
  assert.equal(calls, 0);
});
