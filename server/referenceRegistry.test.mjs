import test from 'node:test';
import assert from 'node:assert/strict';
import { createReferenceRegistry } from './referenceRegistry.mjs';

const html = (url, content) => ({ finalUrl: url, mime: 'text/html', bytes: Buffer.from(content) });
const commons = files => ({ finalUrl: 'https://commons.wikimedia.org/w/api.php', mime: 'application/json', bytes: Buffer.from(JSON.stringify({ query: { pages: Object.fromEntries(files.map((name, index) => [index, { title: `File:${name}.jpg`, imageinfo: [{ url: `https://upload.wikimedia.org/${index}.jpg`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name)}.jpg`, mime: 'image/jpeg', width: 400, height: 300, extmetadata: {} }] }])) } })) });
const search = { query: 'stepper motor', context: 'Quatro motores de passo, reduções, rolamentos, matéria-prima e fixadores.', targetTerms: ['stepper motor', 'motor de passo'] };

test('twelve irrelevant images on the first page cannot prevent a relevant motor from a second source', async () => {
  const registry = createReferenceRegistry({ publicFetch: async url => {
    if (url.endsWith('/one')) return html(url, '<title>Stepper motors</title>' + Array.from({ length: 12 }, (_, index) => `<img src="/robot-${index}.jpg" alt="Complete robot ${index}">`).join(''));
    if (url.endsWith('/two')) return html(url, '<figure><img src="/motor.jpg"><figcaption>Stepper motor</figcaption></figure>');
    throw new Error('Unexpected upstream');
  } });
  const result = await registry.create({ ...search, sources: [{ url: 'https://example.com/one' }, { url: 'https://example.com/two' }] }, 'access');
  assert.deepEqual(result.candidates.map(image => image.title), ['Stepper motor']);
  assert.equal(result.candidates[0].sourcePageUrl, 'https://example.com/two');
});

test('all sources are ranked before truncation and one source cannot monopolize a diverse result set', async () => {
  const registry = createReferenceRegistry({ publicFetch: async url => {
    if (url.endsWith('/one')) return html(url, Array.from({ length: 16 }, (_, index) => `<img src="/one-${index}.jpg" alt="Stepper motor photo ${index}">`).join(''));
    if (url.endsWith('/two')) return html(url, '<img src="/two.jpg" alt="Motor de passo - foto de produto">');
    throw new Error('Unexpected upstream');
  } });
  const result = await registry.create({ ...search, sources: [{ url: 'https://example.com/one' }, { url: 'https://example.com/two' }] }, 'access');
  assert.ok(result.candidates.some(image => image.sourcePageUrl.endsWith('/two')));
  assert.ok(result.candidates.filter(image => image.sourcePageUrl.endsWith('/one')).length <= 4);
});

test('zero relevant page images triggers Commons fallback and irrelevant Commons images stay excluded', async () => {
  const registry = createReferenceRegistry({ publicFetch: async url => {
    if (url.startsWith('https://commons.wikimedia.org/w/api.php')) return commons(['OpenArm logo', 'Complete robot', 'Stepper motor']);
    return html(url, '<title>Stepper motors</title><img src="/logo.png"><img src="/robot.jpg" alt="Complete robot">');
  } });
  const result = await registry.create({ ...search, sources: [{ url: 'https://example.com/one' }] }, 'access');
  assert.deepEqual(result.candidates.map(image => image.title), ['Stepper motor.jpg']);
});

test('a search with no matching objects stays empty instead of filling its gallery with whole robots', async () => {
  const registry = createReferenceRegistry({ publicFetch: async url => url.startsWith('https://commons.wikimedia.org/w/api.php') ? commons(['Robot arm', 'Robotics center logo']) : html(url, '<img src="/robot.jpg" alt="Whole robot">') });
  assert.deepEqual((await registry.create({ ...search, sources: [{ url: 'https://example.com/one' }] }, 'access')).candidates, []);
});

test('tracking parameters and fragments do not duplicate the same image, while variant query parameters are retained', async () => {
  const registry = createReferenceRegistry({ publicFetch: async url => html(url, '<img src="/motor.jpg?utm_source=a" alt="Stepper motor"><img src="/motor.jpg?utm_source=b#view" alt="Stepper motor"><img src="/motor.jpg?variant=long" alt="Stepper motor">') });
  const result = await registry.create({ ...search, sources: [{ url: 'https://example.com/one' }] }, 'access');
  assert.equal(result.candidates.length, 2);
});

test('source downloads run concurrently with at most the six allowed pages', async () => {
  let active = 0, peak = 0, calls = 0;
  const registry = createReferenceRegistry({ publicFetch: async url => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 15)); active--;
    return html(url, `<img src="${url}/motor.jpg" alt="Stepper motor">`);
  } });
  const result = await registry.create({ ...search, sources: Array.from({ length: 7 }, (_, index) => ({ url: `https://example.com/source-${index}` })) }, 'access');
  assert.equal(calls, 6);
  assert.ok(peak >= 3 && peak <= 6, `observed ${peak} concurrent source downloads`);
  assert.equal(result.candidates.length, 6);
});

test('an empty normalized alias cannot turn absent Commons descriptions into relevance', async () => {
  const registry = createReferenceRegistry({ publicFetch: async () => commons(['Whole robot']) });
  const result = await registry.create({ ...search, sources: [], targetTerms: ['---'] }, 'access');
  assert.deepEqual(result.candidates, []);
});

test('structured target identifiers filter sources and Commons fallback with the same object groups', async () => {
  const registry = createReferenceRegistry({ publicFetch: async url => url.startsWith('https://commons.wikimedia.org/w/api.php') ? commons(['NEMA 17 stepper motor', 'NEMA-23 stepper motor']) : html(url, '<img src="/seventeen.jpg" alt="NEMA 17 stepper motor">') });
  const result = await registry.create({ ...search, targets: [{ aliases: ['stepper motor'], identifiers: ['NEMA23'] }], sources: [{ url: 'https://example.com/one' }] }, 'access');
  assert.deepEqual(result.candidates.map(image => image.title), ['NEMA-23 stepper motor.jpg']);
});

const arduinoTargets = [{ aliases: ['Arduino Uno'], identifiers: ['UNO'] }, { aliases: ['USB cable'], identifiers: [] }];

test('a cable result still triggers an independent Commons query for the missing board, with internal matches only', async () => {
  const calls = [];
  const registry = createReferenceRegistry({ publicFetch: async url => {
    calls.push(url);
    return url.startsWith('https://commons.wikimedia.org/') ? commons(['Arduino Uno']) : html(url, '<img src="/cable.jpg" alt="Arduino UNO Cable USB">');
  } });
  const result = await registry.create({ query: 'Arduino Uno USB cable', targets: arduinoTargets, sources: [{ url: 'https://example.com/parts' }] }, 'access');
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[1]).searchParams.get('gsrsearch'), 'Arduino Uno');
  assert.deepEqual(new Set(result.candidates.map(image => image.title)), new Set(['Arduino UNO Cable USB', 'Arduino Uno.jpg']));
  assert.equal(JSON.stringify(result).includes('matchedTargetIndexes'), false);
  assert.deepEqual(registry.get(result.sessionId, result.candidates.find(image => image.title.includes('Cable')).id, 'access').candidate.metadata.matchedTargetIndexes, [1]);
});

test('missing targets have separate bounded Commons searches with at most three simultaneous requests', async () => {
  const targets = Array.from({ length: 8 }, (_, i) => ({ aliases: [`part-${i}`], identifiers: [] }));
  let active = 0, peak = 0; const queries = [];
  const registry = createReferenceRegistry({ publicFetch: async url => {
    const query = new URL(url).searchParams.get('gsrsearch'); queries.push(query); active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 15)); active--;
    const payload = commons([query]); const parsed = JSON.parse(payload.bytes.toString('utf8'));
    parsed.query.pages[0].imageinfo[0].url = `https://upload.wikimedia.org/${encodeURIComponent(query)}.jpg`;
    return { ...payload, bytes: Buffer.from(JSON.stringify(parsed)) };
  } });
  const result = await registry.create({ query: 'all parts together', targets, sources: [] }, 'access');
  assert.deepEqual(new Set(queries), new Set(targets.map(target => target.aliases[0])));
  assert.equal(queries.length, 8); assert.ok(peak >= 2 && peak <= 3);
  assert.equal(result.candidates.length, 8);
});

test('complementary Commons failure preserves already retrieved candidates and does not invent the missing class', async () => {
  let calls = 0;
  const registry = createReferenceRegistry({ publicFetch: async url => {
    calls++; if (url.startsWith('https://commons.wikimedia.org/')) throw new Error('unavailable');
    return html(url, '<img src="/cable.jpg" alt="USB cable for Arduino Uno">');
  } });
  const result = await registry.create({ query: 'Arduino Uno USB cable', targets: arduinoTargets, sources: [{ url: 'https://example.com/parts' }] }, 'access');
  assert.equal(calls, 2); assert.deepEqual(result.candidates.map(image => image.title), ['USB cable for Arduino Uno']);
});

test('cancellation during a complementary search propagates instead of returning partial success', async () => {
  const controller = new AbortController();
  const registry = createReferenceRegistry({ publicFetch: async url => {
    if (url.startsWith('https://commons.wikimedia.org/')) { controller.abort(); throw controller.signal.reason; }
    return html(url, '<img src="/cable.jpg" alt="USB cable for Arduino Uno">');
  } });
  await assert.rejects(registry.create({ query: 'Arduino Uno USB cable', targets: arduinoTargets, sources: [{ url: 'https://example.com/parts' }] }, 'access', controller.signal), { name: 'AbortError' });
});
