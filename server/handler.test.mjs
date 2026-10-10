import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createVisualHandler } from './handler.mjs';
import { createReferenceRegistry } from './referenceRegistry.mjs';
import { validateImageBytes } from './media.mjs';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
async function withServer(options, fn) {
  const server = createServer(createVisualHandler(options));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { await fn(origin); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('plan intake requires the authorized local session and returns only classification data', async () => {
  let calls = 0;
  await withServer({ local: true, typesafeKey: 'SENTINEL_SECRET', fetchImpl: async () => {
    calls++; return new Response(JSON.stringify({ model: 'jev-latest', answers: { plan_intent: { type: 'choice', choice: 'reference', confidence: .9, probabilities: { reference: .9, extend: .025, revise: .025, reorganize: .025, clarify: .025 } } } }));
  } }, async origin => {
    const body = JSON.stringify({ request: 'Explique o anexo', objective: 'Robô', nodes: [], files: [{ id: 'f', name: 'spec.md', text: '12 V' }] });
    const cap = await fetch(`${origin}/api/visuals/capabilities`), cookie = cap.headers.get('set-cookie').split(';')[0];
    const denied = await fetch(`${origin}/api/visuals/plan-intake`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(denied.status, 403); assert.equal(calls, 0);
    const response = await fetch(`${origin}/api/visuals/plan-intake`, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body });
    assert.equal(response.status, 200); const result = await response.json();
    assert.equal(result.classification.choice, 'reference'); assert.equal(result.status, 'classified');
    assert.equal(JSON.stringify(result).includes('SENTINEL_SECRET'), false); assert.equal(calls, 1);
  });
});

test('specification documents use the authorized local gateway without any TypeSafe call', async () => {
  let paidCalls = 0;
  await withServer({ local: true, typesafeKey: 'secret-only-server', fetchImpl: async () => { paidCalls++; assert.fail('Not an image relevance review'); }, publicFetch: async url => ({ finalUrl: url, mime: 'text/plain', bytes: Buffer.from('UNO R3 contains ATMEGA328P-PU.') }) }, async origin => {
    const capabilities = await fetch(`${origin}/api/visuals/capabilities`);
    assert.equal((await capabilities.json()).specifications, true);
    const cookie = capabilities.headers.get('set-cookie').split(';')[0];
    const body = JSON.stringify({ sources: [{ url: 'https://docs.arduino.cc/hardware/uno-rev3/', title: 'UNO R3' }] });
    const denied = await fetch(`${origin}/api/visuals/specifications`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(denied.status, 403);
    const allowed = await fetch(`${origin}/api/visuals/specifications`, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body });
    assert.equal(allowed.status, 200);
    assert.match((await allowed.json()).documents[0].text, /ATMEGA328P-PU/);
  });
  assert.equal(paidCalls, 0);
});

test('specification request bounds reject invalid sources before upstream and report empty downloads clearly', async () => {
  let calls = 0;
  await withServer({ authorize: () => 'test-access', publicFetch: async () => { calls++; throw new Error('SENTINEL_SECRET'); } }, async origin => {
    const post = sources => fetch(`${origin}/api/visuals/specifications`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sources }) });
    assert.equal((await post([])).status, 400); assert.equal((await post(Array(7).fill({ url: 'https://example.com', title: 'source' }))).status, 400);
    assert.equal(calls, 0);
    const failed = await post([{ url: 'https://example.com/source', title: 'source' }]);
    assert.equal(failed.status, 422);
    const text = await failed.text(); assert.match(text, /specifications_unavailable/); assert.equal(text.includes('SENTINEL_SECRET'), false);
  });
});

test('public default denies all API access before upstream and local POST requires exact origin and cookie', async () => {
  let calls = 0;
  const publicFetch = async () => { calls++; throw new Error('SENTINEL_SECRET'); };
  await withServer({ publicFetch, typesafeKey: 'SENTINEL_SECRET' }, async origin => {
    const response = await fetch(`${origin}/api/visuals/capabilities`);
    assert.equal(response.status, 403); assert.equal((await response.text()).includes('SENTINEL_SECRET'), false);
  });
  await withServer({ local: true, publicFetch }, async origin => {
    const cap = await fetch(`${origin}/api/visuals/capabilities`); assert.equal(cap.status, 200);
    const cookie = cap.headers.get('set-cookie').split(';')[0];
    for (const headers of [{ cookie }, { cookie, origin: 'http://evil.example' }, { origin }]) {
      const response = await fetch(`${origin}/api/visuals/reference-sessions`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ query: 'ESP32', sources: [] }) });
      assert.equal(response.status, 403);
    }
    const status = await new Promise(resolve => { const req = request(`${origin}/api/visuals/capabilities`, { headers: { host: 'evil.example', 'x-forwarded-for': '127.0.0.1' } }, res => { res.resume(); resolve(res.statusCode); }); req.end(); });
    assert.equal(status, 403);
  });
  assert.equal(calls, 0);
});

test('registry extracts real metadata, returns same-origin registered media, blocks forgery and expiry', async () => {
  let time = 0;
  const publicFetch = async url => url.includes('page') ? { finalUrl: url, mime: 'text/html', bytes: Buffer.from('<meta property="og:image" content="/actual.png"><img src="/actual.png" alt="ESP32 board"><img src="javascript:alert(1)">') } : { finalUrl: url, mime: 'image/png', bytes: png };
  const registry = createReferenceRegistry({ publicFetch, now: () => time });
  const result = await registry.create({ query: 'ESP32', sources: [{ url: 'https://example.com/page', title: 'Board' }], projectId: 'p' }, 'access');
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.match(candidate.imageUrl, /^\/api\/visuals\/media\?/); assert.equal(candidate.assessment, null);
  assert.equal(candidate.sourcePageUrl, 'https://example.com/page');
  assert.deepEqual((await registry.media(result.sessionId, candidate.id, 'access')).bytes, png);
  await assert.rejects(registry.media(result.sessionId, candidate.id, 'foreign'), /expired|unknown/i);
  await assert.rejects(registry.media(result.sessionId, 'forged', 'access'), /expired|unknown/i);
  time = 30 * 60_000 + 1;
  await assert.rejects(registry.media(result.sessionId, candidate.id, 'access'), /expired|unknown/i);
});

test('HTML/SVG disguised as supported image fails signature checks', () => {
  assert.throws(() => validateImageBytes('image/png', Buffer.from('<html>error</html>')));
  assert.throws(() => validateImageBytes('image/svg+xml', Buffer.from('<svg></svg>')));
  assert.equal(validateImageBytes('image/png', png), 'image/png');
});

test('Commons fallback uses actual imageinfo thumbnails and registered attribution', async () => {
  let searched = '';
  const registry = createReferenceRegistry({ publicFetch: async url => {
    searched = url;
    return { mime: 'application/json', finalUrl: url, bytes: Buffer.from(JSON.stringify({ query: { pages: { 1: { title: 'File:ESP32.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/thumb.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:ESP32.jpg', mime: 'image/jpeg', width: 5000, height: 3000, thumbwidth: 1280, thumbheight: 768, extmetadata: { Artist: { value: 'Photographer' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] } } } })) };
  } });
  const result = await registry.create({ query: 'ESP32', sources: [] }, 'access');
  assert.match(searched, /gsrsearch=ESP32/);
  assert.equal(result.candidates[0].width, 1280); assert.equal(result.candidates[0].credit, 'Photographer');
});

test('nine gallery images queue safely behind four downloads and all return validated bytes', async () => {
  let active = 0, peak = 0;
  const publicFetch = async url => {
    if (url.includes('/page')) return { finalUrl: url, mime: 'text/html', bytes: Buffer.from(Array.from({ length: 9 }, (_, i) => `<img src="/actual${i}.png" alt="Board ${i}">`).join('')) };
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 20)); active--;
    return { finalUrl: url, mime: 'image/png', bytes: png };
  };
  await withServer({ local: true, publicFetch }, async origin => {
    const cap = await fetch(`${origin}/api/visuals/capabilities`);
    const cookie = cap.headers.get('set-cookie').split(';')[0];
    const created = await fetch(`${origin}/api/visuals/reference-sessions`, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'p', query: 'ESP32', context: '', contextFingerprint: 'f', sources: [{ url: 'https://example.com/page' }] }) });
    assert.equal(created.status, 200);
    const session = await created.json(); assert.equal(session.candidates.length, 9);
    const downloads = await Promise.all(session.candidates.map(candidate => fetch(`${origin}${candidate.imageUrl}`, { headers: { cookie } })));
    assert.deepEqual(downloads.map(response => response.status), Array(9).fill(200));
    assert.equal(peak, 4);
    for (const response of downloads) assert.equal((await response.arrayBuffer()).byteLength, png.length);
  });
});

test('targetTerms accepts bounded aliases and rejects invalid contracts before any source is requested', async () => {
  let calls = 0;
  const publicFetch = async url => { calls++; return { finalUrl: url, mime: 'text/html', bytes: Buffer.from('<img src="/motor.jpg" alt="Stepper motor">') }; };
  await withServer({ local: true, publicFetch }, async origin => {
    const cap = await fetch(`${origin}/api/visuals/capabilities`);
    const cookie = cap.headers.get('set-cookie').split(';')[0];
    const request = targetTerms => fetch(`${origin}/api/visuals/reference-sessions`, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'p', query: 'stepper motor', context: '', contextFingerprint: 'f', sources: [{ url: 'https://example.com/page' }], targetTerms }) });
    for (const targetTerms of [null, 'motor', [], [''], ['   '], [1], Array(9).fill('motor'), ['x'.repeat(121)], Array(6).fill('x'.repeat(101))]) {
      const response = await request(targetTerms);
      assert.equal(response.status, 400, JSON.stringify(targetTerms));
    }
    assert.equal(calls, 0);
    const response = await request(['stepper motor', 'motor de passo']);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).candidates.length, 1);
  });
});

test('targets validates bounded object groups before fetching and keeps identifiers coupled to aliases', async () => {
  let calls = 0;
  const publicFetch = async url => { calls++; return { finalUrl: url, mime: 'text/html', bytes: Buffer.from('<img src="/seventeen.jpg" alt="NEMA 17 stepper motor"><img src="/twenty-three.jpg" alt="NEMA-23 stepper motor">') }; };
  await withServer({ local: true, publicFetch }, async origin => {
    const cap = await fetch(`${origin}/api/visuals/capabilities`);
    const cookie = cap.headers.get('set-cookie').split(';')[0];
    const request = targets => fetch(`${origin}/api/visuals/reference-sessions`, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'p', query: 'NEMA 23 stepper motor', context: '', contextFingerprint: 'f', sources: [{ url: 'https://example.com/page' }], targetTerms: ['stepper motor', 'NEMA23'], targets }) });
    const group = { aliases: ['stepper motor'], identifiers: [] };
    for (const targets of [null, {}, [], [null], Array(9).fill(group), [{ aliases: [], identifiers: [] }], [{ aliases: [' '], identifiers: [] }], [{ aliases: [1], identifiers: [] }], [{ aliases: ['x'.repeat(121)], identifiers: [] }], [{ aliases: Array(9).fill('motor'), identifiers: [] }], [{ aliases: Array(6).fill('x'.repeat(101)), identifiers: [] }], [{ aliases: ['motor'], identifiers: null }], [{ aliases: ['motor'], identifiers: [''] }], [{ aliases: ['motor'], identifiers: [1] }], [{ aliases: ['motor'], identifiers: Array(9).fill('M1') }], [{ aliases: ['motor'], identifiers: ['x'.repeat(81)] }], [{ aliases: ['motor'], identifiers: Array(4).fill('x'.repeat(76)) }], Array(6).fill({ aliases: ['x'.repeat(101)], identifiers: [] }), Array(4).fill({ aliases: ['motor'], identifiers: ['x'.repeat(76)] })]) {
      const response = await request(targets);
      assert.equal(response.status, 400, JSON.stringify(targets));
    }
    assert.equal(calls, 0);
    const response = await request([{ aliases: ['stepper motor'], identifiers: ['NEMA23'] }]);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).candidates.map(image => image.title), ['NEMA-23 stepper motor']);
  });
});

test('search uses one TypeSafe batch, removes confident unrelated candidates, preserves uncertain ones and caches the assessment', async () => {
  let paidCalls = 0;
  const publicFetch = async url => ({ finalUrl: url, mime: 'text/html', bytes: Buffer.from('<img src="/basic.jpg" alt="Stepper motor basic"><img src="/related.jpg" alt="Stepper motor related"><img src="/uncertain.jpg" alt="Stepper motor uncertain">') });
  const distribution = (score, confidence, probabilities) => ({ type: 'score', score, confidence, probabilities, legend: { 0: 'Irrelevant', 1: 'Same family', 2: 'Useful', 3: 'Exact' } });
  const scores = [distribution(2.78, .9, { 0: .02, 1: .02, 2: .12, 3: .84 }), distribution(.18, .9, { 0: .85, 1: .12, 2: .03, 3: 0 }), distribution(1.15, .3, { 0: .35, 1: .3, 2: .2, 3: .15 })];
  const fetchImpl = async (_url, options) => {
    paidCalls++;
    const body = JSON.parse(options.body);
    assert.equal(Object.keys(body.questions).length, 3);
    return new Response(JSON.stringify({ model: 'jev-test', answers: Object.fromEntries(Object.keys(body.questions).map((name, i) => [name, scores[i]])) }));
  };
  await withServer({ local: true, publicFetch, fetchImpl, typesafeKey: 'fake-key' }, async origin => {
    const cap = await fetch(`${origin}/api/visuals/capabilities`);
    const cookie = cap.headers.get('set-cookie').split(';')[0];
    const headers = { cookie, origin, 'content-type': 'application/json' };
    const response = await fetch(`${origin}/api/visuals/reference-sessions`, { method: 'POST', headers, body: JSON.stringify({ projectId: 'p', query: 'stepper motor', targetTerms: ['stepper motor'], context: '', contextFingerprint: 'f', sources: [{ url: 'https://example.com/page' }] }) });
    assert.equal(response.status, 200);
    const session = await response.json();
    assert.deepEqual(session.review, { status: 'ranked', assessed: 3, removed: 1 });
    assert.deepEqual(session.candidates.map(item => item.title), ['Stepper motor basic', 'Stepper motor uncertain']);
    assert.equal(session.candidates[0].assessment.model, 'jev-test');
    const repeat = await fetch(`${origin}/api/visuals/review`, { method: 'POST', headers, body: JSON.stringify({ projectId: 'p', sessionId: session.sessionId, candidateId: session.candidates[0].id, contextFingerprint: 'f' }) });
    assert.equal(repeat.status, 200);
    assert.equal((await repeat.json()).assessment.score, 2.78);
    assert.equal(paidCalls, 1);
  });
});

test('a failed automatic TypeSafe review keeps filtered image references and reports the fallback without retry', async () => {
  let paidCalls = 0;
  const publicFetch = async url => ({ finalUrl: url, mime: 'text/html', bytes: Buffer.from('<img src="/motor.jpg" alt="Stepper motor">') });
  await withServer({ local: true, publicFetch, typesafeKey: 'fake-key', fetchImpl: async () => { paidCalls++; throw new Error('SENTINEL_SECRET'); } }, async origin => {
    const cap = await fetch(`${origin}/api/visuals/capabilities`);
    const cookie = cap.headers.get('set-cookie').split(';')[0];
    const response = await fetch(`${origin}/api/visuals/reference-sessions`, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'p', query: 'stepper motor', context: '', contextFingerprint: 'f', sources: [{ url: 'https://example.com/page' }] }) });
    assert.equal(response.status, 200);
    const body = await response.text(); assert.equal(body.includes('SENTINEL_SECRET'), false);
    const session = JSON.parse(body);
    assert.deepEqual(session.review, { status: 'unavailable', assessed: 0, removed: 0 });
    assert.equal(session.candidates.length, 1); assert.equal(session.candidates[0].assessment, null);
    assert.equal(paidCalls, 1);
  });
});

test('TypeSafe ranking keeps multiple requested objects represented without restoring rejected references', async t => {
  for (const rejectBoard of [false, true]) {
    await t.test(rejectBoard ? 'confidently rejected boards stay excluded' : 'a useful board remains visible beside higher scoring cables', async () => {
      const references = [
        { id: 'cable-high', title: 'USB cable A' },
        { id: 'cable-mid', title: 'USB cable B' },
        { id: 'cable-low', title: 'USB cable C' },
        { id: 'board', title: 'Arduino UNO board' },
        { id: 'rejected-board', title: 'Unrelated board' },
      ].map(reference => ({ ...reference, sourcePageUrl: 'https://example.com/products', assessment: null }));
      const candidates = new Map(references.map(reference => [reference.id, {
        reference, metadata: { matchedTargetIndexes: [reference.id.startsWith('cable') ? 1 : 0] },
      }]));
      const registry = {
        async create(_input, accessId) {
          assert.equal(accessId, 'authorized-test');
          return { sessionId: 'target-session', candidates: references };
        },
        get(sessionId, candidateId, accessId) {
          assert.equal(sessionId, 'target-session');
          assert.equal(accessId, 'authorized-test');
          return { candidate: candidates.get(candidateId) };
        },
      };
      let paidCalls = 0;
      const fetchImpl = async (_url, options) => {
        paidCalls++;
        const body = JSON.parse(options.body);
        const scores = [2.9, 2.8, 2.7, rejectBoard ? .1 : 2.1, .1];
        const answers = Object.fromEntries(Object.keys(body.questions).map((name, index) => [name, {
          type: 'score', score: scores[index], confidence: .9,
          probabilities: scores[index] < 1 ? { 0: .9, 1: .1, 2: 0, 3: 0 } : { 0: 0, 1: 0, 2: .2, 3: .8 },
          legend: { 0: 'Irrelevant', 1: 'Same family', 2: 'Useful', 3: 'Exact' },
        }]));
        return new Response(JSON.stringify({ model: 'jev-test', answers }));
      };
      await withServer({ authorize: () => 'authorized-test', referenceRegistry: registry, typesafeKey: 'fake-key', fetchImpl }, async origin => {
        const response = await fetch(`${origin}/api/visuals/reference-sessions`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectId: 'p', query: 'Arduino UNO and USB cable', context: '', contextFingerprint: 'f', sources: [], targets: [{ aliases: ['Arduino UNO'], identifiers: [] }, { aliases: ['USB cable'], identifiers: [] }] }),
        });
        assert.equal(response.status, 200);
        const session = await response.json();
        const ids = session.candidates.map(reference => reference.id);
        assert.equal(ids.includes('rejected-board'), false);
        assert.deepEqual(session.review, { status: 'ranked', assessed: 5, removed: rejectBoard ? 2 : 1 });
        if (rejectBoard) assert.deepEqual(ids, ['cable-high', 'cable-mid', 'cable-low']);
        else {
          assert.equal(ids.slice(0, 2).includes('board'), true, 'the first two results should cover both requested objects');
          assert.deepEqual(ids.filter(id => id.startsWith('cable')), ['cable-high', 'cable-mid', 'cable-low']);
        }
        assert.equal(session.candidates.some(reference => Object.hasOwn(reference, 'matchedTargetIndexes') || Object.hasOwn(reference, 'metadata')), false);
        assert.equal(paidCalls, 1);
      });
    });
  }
});
