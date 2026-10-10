import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewReference } from './typesafe.mjs';
import * as typesafe from './typesafe.mjs';

const answer = { type: 'score', score: 1.999, confidence: .99, probabilities: { 0: .1, 1: .2, 2: .3, 3: .4 }, legend: { 0: 'irrelevant', 1: 'family', 2: 'useful', 3: 'exact' } };
test('review missing key returns null and configured review sends only metadata to fixed upstream', async () => {
  let calls = 0;
  const input = { query: 'ESP32', contextText: 'selected note', reference: { title: 'Board', description: 'board photo', sourcePageUrl: 'https://example.com/', imageUrl: 'https://example.com/secret-pixels.png', pixels: 'not allowed' } };
  const fetchImpl = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    const body = JSON.parse(options.body); assert.equal(body.model, 'jev-latest');
    assert.equal(body.questions.relevance.type, 'score'); assert.equal(body.questions.relevance.criteria.length, 4);
    assert.equal(options.body.includes('secret-pixels'), false); assert.equal(options.body.includes('not allowed'), false);
    return new Response(JSON.stringify({ model: 'jev-latest', answers: { relevance: answer } }));
  };
  assert.equal(await reviewReference(input, { fetchImpl }), null); assert.equal(calls, 0);
  const reviewed = await reviewReference(input, { key: 'fake', fetchImpl });
  assert.equal(reviewed.score, 1.999); assert.equal(reviewed.confidence, .99); assert.equal(calls, 1);
});
test('rejects malformed score, distribution, excessive context, and upstream error without retry', async () => {
  for (const change of [{ type: 'choice' }, { score: 3.1 }, { probabilities: { 0: 1 } }, { confidence: -1 }]) {
    await assert.rejects(reviewReference({ query: 'x', contextText: '', reference: {} }, { key: 'fake', fetchImpl: async () => new Response(JSON.stringify({ model: 'jev-latest', answers: { relevance: { ...answer, ...change } } })) }));
  }
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('SENTINEL_SECRET'); };
  await assert.rejects(reviewReference({ query: 'x', contextText: 'x'.repeat(8193), reference: {} }, { key: 'fake', fetchImpl }));
  assert.equal(calls, 0);
  await assert.rejects(reviewReference({ query: 'x', contextText: '', reference: {} }, { key: 'fake', fetchImpl }), error => !error.message.includes('SENTINEL_SECRET'));
  assert.equal(calls, 1);
});

const references = [
  { id: 'registered-a', title: 'Stepper motor', description: 'NEMA 23 motor', sourcePageUrl: 'https://example.com/motor', imageUrl: '/api/visuals/media?secret-pixels', pixels: 'SENTINEL_PIXELS' },
  { id: 'registered-b', title: 'Robot arm', description: 'Complete assembly', sourcePageUrl: 'https://example.com/arm', sessionId: 'SENTINEL_SESSION' },
];
const batchInput = { query: 'NEMA 23 stepper motor', contextText: 'selected component only', references };
const response = answers => new Response(JSON.stringify({ model: 'jev-latest', answers }));

test('batch review evaluates two registered references in one call and maps named answers back to their IDs', async () => {
  assert.equal(typeof typesafe.reviewReferences, 'function');
  let calls = 0;
  const reviewed = await typesafe.reviewReferences(batchInput, { key: 'fake', now: () => 123, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    const body = JSON.parse(options.body);
    assert.deepEqual(Object.keys(body.questions), ['relevance_0', 'relevance_1']);
    assert.equal(body.state.references.length, 2);
    assert.equal(body.state.pixelsAnalyzed, false);
    assert.deepEqual(Object.keys(body.state.references[0]), ['title', 'description', 'sourcePageUrl', 'credit', 'license', 'width', 'height']);
    for (let index = 0; index < 2; index++) {
      const question = body.questions[`relevance_${index}`];
      assert.equal(question.type, 'score'); assert.equal(question.criteria.length, 4);
      assert.match(question.instructions, new RegExp(`references\\[${index}\\]`));
      assert.match(question.instructions, /untrusted/);
      assert.match(question.instructions, /not a measured accuracy/);
    }
    assert.equal(/SENTINEL|secret-pixels|registered-a|registered-b/.test(options.body), false);
    return response({ relevance_1: { ...answer, score: .5 }, relevance_0: { ...answer, score: 2.8 } });
  } });
  assert.equal(calls, 1);
  assert.deepEqual(reviewed.map(({ id, assessment }) => [id, assessment.score, assessment.assessedAt]), [['registered-a', 2.8, 123], ['registered-b', .5, 123]]);
});

test('batch review skips upstream when the key is absent or the candidate list is empty', async () => {
  assert.equal(typeof typesafe.reviewReferences, 'function');
  const fetchImpl = async () => { assert.fail('No upstream call expected'); };
  assert.equal(await typesafe.reviewReferences(batchInput, { fetchImpl }), null);
  assert.deepEqual(await typesafe.reviewReferences({ ...batchInput, references: [] }, { key: 'fake', fetchImpl }), []);
});

test('batch review accepts rounded probabilities while rejecting missing, extra, or malformed named answers', async () => {
  assert.equal(typeof typesafe.reviewReferences, 'function');
  const rounded = { ...answer, probabilities: { 0: .17, 1: .17, 2: .33, 3: .34 } };
  const reviewed = await typesafe.reviewReferences(batchInput, { key: 'fake', fetchImpl: async () => response({ relevance_0: rounded, relevance_1: answer }) });
  assert.equal(reviewed[0].assessment.score, answer.score);
  for (const answers of [
    { relevance_0: answer },
    { relevance_0: answer, relevance_1: answer, relevance_2: answer },
    { relevance_0: answer, relevance_1: { ...answer, score: NaN } },
    { relevance_0: answer, relevance_1: { ...answer, confidence: 1.1 } },
    { relevance_0: answer, relevance_1: { ...answer, probabilities: { 0: .2, 1: .2, 2: .2, 3: .2 } } },
    { relevance_0: answer, relevance_1: { ...answer, legend: { 0: 'x', 1: 'y', 2: 'z' } } },
    { relevance_0: answer, relevance_1: { ...answer, type: 'choice' } },
  ]) await assert.rejects(typesafe.reviewReferences(batchInput, { key: 'fake', fetchImpl: async () => response(answers) }), /unavailable or invalid/);
});

test('batch review rejects duplicate or missing IDs, excessive candidates and oversized UTF-8 context before upstream', async () => {
  assert.equal(typeof typesafe.reviewReferences, 'function');
  const fetchImpl = async () => { assert.fail('Invalid input must remain local'); };
  for (const candidates of [[{}], [{ id: '' }], [references[0], references[0]], Array.from({ length: 13 }, (_, index) => ({ id: `id-${index}` }))]) {
    await assert.rejects(typesafe.reviewReferences({ ...batchInput, references: candidates }, { key: 'fake', fetchImpl }));
  }
  await assert.rejects(typesafe.reviewReferences({ ...batchInput, contextText: '漢'.repeat(2731) }, { key: 'fake', fetchImpl }));
});

test('batch request bounds all metadata and twelve questions without splitting UTF-8 text', async () => {
  assert.equal(typeof typesafe.reviewReferences, 'function');
  const candidates = Array.from({ length: 12 }, (_, index) => ({ id: `id-${index}`, title: '🚀漢'.repeat(200), description: '\u0000漢🚀'.repeat(800), sourcePageUrl: 'https://example.com/' + 'a'.repeat(1000), credit: '漢'.repeat(300), license: '🚀'.repeat(300), width: 800, height: 600 }));
  const reviewed = await typesafe.reviewReferences({ query: 'motor', contextText: '漢'.repeat(2700), references: candidates }, { key: 'fake', fetchImpl: async (_url, options) => {
    assert.ok(Buffer.byteLength(options.body) <= 32 * 1024);
    const body = JSON.parse(options.body);
    assert.ok(Buffer.byteLength(body.state.context) <= 4096);
    assert.equal(body.state.references.length, 12);
    for (const reference of body.state.references) {
      assert.ok(reference.title.length <= 200); assert.ok(reference.description.length <= 512);
      assert.ok(reference.sourcePageUrl.length <= 512); assert.ok(reference.credit.length <= 100); assert.ok(reference.license.length <= 100);
      assert.equal(JSON.stringify(reference).includes('�'), false);
    }
    return response(Object.fromEntries(candidates.map((_reference, index) => [`relevance_${index}`, answer])));
  } });
  assert.equal(reviewed.length, 12);
});

test('batch review reduces context to fit twelve candidates with maximum ASCII metadata and query', async () => {
  const candidates = Array.from({ length: 12 }, (_, index) => ({ id: `id-${index}`, title: 't'.repeat(200), description: 'd'.repeat(512), sourcePageUrl: 'https://example.com/' + 'u'.repeat(493), credit: 'c'.repeat(100), license: 'l'.repeat(100), width: 100_000, height: 100_000 }));
  let calls = 0;
  const reviewed = await typesafe.reviewReferences({ query: 'q'.repeat(2000), contextText: 'x'.repeat(8192), references: candidates }, { key: 'fake', fetchImpl: async (_url, options) => {
    calls++;
    assert.ok(Buffer.byteLength(options.body) <= 32 * 1024);
    const body = JSON.parse(options.body);
    assert.equal(body.state.references.length, 12);
    assert.equal(body.state.references[0].description.length, 512);
    assert.ok(body.state.context.length > 0 && body.state.context.length < 4096);
    return response(Object.fromEntries(candidates.map((_reference, index) => [`relevance_${index}`, answer])));
  } });
  assert.equal(calls, 1); assert.equal(reviewed.length, 12);
});

test('batch review propagates external cancellation as AbortError and sanitizes upstream errors without retry', async () => {
  assert.equal(typeof typesafe.reviewReferences, 'function');
  const controller = new AbortController(); let calls = 0;
  const pending = typesafe.reviewReferences(batchInput, { key: 'fake', signal: controller.signal, fetchImpl: async (_url, options) => {
    calls++;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  } });
  controller.abort(new Error('SENTINEL_REASON'));
  await assert.rejects(pending, error => error.name === 'AbortError' && !error.message.includes('SENTINEL'));
  assert.equal(calls, 1);
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(typesafe.reviewReferences(batchInput, { key: 'fake', signal: stopped.signal, fetchImpl: async () => { assert.fail('Already aborted'); } }), { name: 'AbortError' });
  const customStopped = new AbortController(); customStopped.abort(new Error('SENTINEL_REASON'));
  await assert.rejects(typesafe.reviewReferences(batchInput, { key: 'fake', signal: customStopped.signal }), error => error.name === 'AbortError' && !error.message.includes('SENTINEL'));
  await assert.rejects(typesafe.reviewReferences(batchInput, { key: 'fake', fetchImpl: async () => { calls++; throw new Error('SENTINEL_SECRET'); } }), error => !error.message.includes('SENTINEL_SECRET'));
  assert.equal(calls, 2);
});

test('batch response is bounded and individual review also preserves external AbortError', async () => {
  assert.equal(typeof typesafe.reviewReferences, 'function');
  await assert.rejects(typesafe.reviewReferences(batchInput, { key: 'fake', fetchImpl: async () => new Response(JSON.stringify({ model: 'jev-latest', answers: { relevance_0: answer, relevance_1: answer }, padding: 'x'.repeat(32 * 1024) })) }), /unavailable or invalid/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(reviewReference({ query: 'motor', reference: {} }, { key: 'fake', signal: controller.signal, fetchImpl: async () => { assert.fail('Already aborted'); } }), { name: 'AbortError' });
});

test('batch review maps results to the IDs captured before the asynchronous request', async () => {
  const candidates = references.map(reference => ({ ...reference }));
  const reviewed = await typesafe.reviewReferences({ ...batchInput, references: candidates }, { key: 'fake', fetchImpl: async () => {
    candidates[0].id = 'mutated-after-request';
    candidates.reverse();
    return response({ relevance_0: { ...answer, score: 2.8 }, relevance_1: { ...answer, score: .5 } });
  } });
  assert.deepEqual(reviewed.map(({ id, assessment }) => [id, assessment.score]), [['registered-a', 2.8], ['registered-b', .5]]);
});
