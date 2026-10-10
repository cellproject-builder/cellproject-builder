// Run with: node scripts/planner-load.mjs
// Only this process's ephemeral loopback listener receives network traffic.
// Provider/auth/RPC fixtures are explicit; no .env, credentials or live services.
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createProductionHandler } from '../server/production.mjs';
import { createVaultRepository } from '../server/vaultRepository.mjs';

const ROUTES = {
  planning: '/api/ai/openrouter/chat/completions',
  intake: '/api/visuals/plan-intake',
  persistence: '/api/cloud/vault',
};
const FIXTURE_KEY = 'synthetic-fixture-not-a-credential';
const PRIVATE_ERROR = 'SYNTHETIC_PRIVATE_UPSTREAM_ERROR';
const choices = ['reference', 'extend', 'revise', 'reorganize', 'clarify'];
const maximumWaitMs = 5000;

async function until(predicate, label) {
  const started = performance.now();
  while (!predicate()) {
    assert.ok(performance.now() - started < maximumWaitMs, `Timed out: ${label}`);
    await delay(1);
  }
}

function fixtureBody(kind, marker) {
  if (kind === 'planning') return { model: 'fixture', messages: [{ role: 'user', content: JSON.stringify(marker) }], max_tokens: 100, stream: marker.mode === 'stream' };
  if (kind === 'intake') return { request: JSON.stringify(marker), objective: marker.owner, nodes: [], files: [] };
  // Synthetic bytes exercise the real envelope validator; they are not ciphertext.
  return { manifest: { v: 1, iv: Buffer.alloc(12).toString('base64'), data: Buffer.from(JSON.stringify(marker)).toString('base64') }, baseRevision: marker.baseRevision ?? 1, operationId: marker.id };
}

function createFixtures(fixtureFault) {
  const records = [], states = new Map(), active = { planning: 0, intake: 0, persistence: 0 };
  const peak = { ...active }, ownerActive = new Map(), ownerPeak = new Map();
  let held = true, unexpectedUrls = 0, effects = 0, aborts = 0;
  const finish = record => {
    if (record.finished) return;
    record.finished = true;
    active[record.kind]--;
    ownerActive.set(`${record.kind}:${record.marker.owner}`, ownerActive.get(`${record.kind}:${record.marker.owner}`) - 1);
  };
  const start = (kind, marker, init) => {
    const record = { kind, marker, requestBody: init.body, finished: false, released: !held, aborted: false };
    records.push(record); active[kind]++; peak[kind] = Math.max(peak[kind], active[kind]);
    const key = `${kind}:${marker.owner}`;
    ownerActive.set(key, (ownerActive.get(key) ?? 0) + 1);
    ownerPeak.set(key, Math.max(ownerPeak.get(key) ?? 0, ownerActive.get(key)));
    record.wait = () => new Promise((resolve, reject) => {
      const abort = () => { record.aborted = true; aborts++; reject(init.signal.reason ?? new DOMException('Aborted', 'AbortError')); };
      const cleanup = () => init.signal?.removeEventListener('abort', abort);
      record.release = () => { record.released = true; cleanup(); resolve(); };
      if (!held) { record.release(); return; }
      init.signal?.addEventListener('abort', abort, { once: true });
      if (init.signal?.aborted) { cleanup(); abort(); }
    });
    return record;
  };
  const fetchImpl = async (url, init) => {
    let kind, marker, rpc;
    const headers = new Headers(init.headers);
    assert.equal(headers.get('cookie'), null, 'Client cookie reached an upstream adapter');
    if (url === 'https://openrouter.ai/api/v1/chat/completions') {
      kind = 'planning'; marker = JSON.parse(JSON.parse(init.body).messages[0].content);
      assert.equal(headers.get('authorization'), `Bearer ${FIXTURE_KEY}`);
    } else if (url === 'https://api.typesafe.ai/v1/systemone') {
      kind = 'intake'; marker = JSON.parse(JSON.parse(init.body).state.request);
      assert.equal(headers.get('authorization'), `Bearer ${FIXTURE_KEY}`);
    } else if (url === 'https://fixture.invalid/rest/v1/rpc/dynamic_diary_write_vault') {
      kind = 'persistence'; rpc = JSON.parse(init.body);
      marker = JSON.parse(Buffer.from(rpc.p_manifest.data, 'base64').toString('utf8'));
      assert.equal(headers.get('authorization'), `Bearer fixture-session:${marker.owner}`, 'Persistence owner isolation');
      assert.equal(headers.get('apikey'), FIXTURE_KEY);
      assert.equal(rpc.p_operation_id, marker.id);
      assert.equal(rpc.p_base_revision, marker.baseRevision ?? 1);
    } else {
      unexpectedUrls++;
      throw new Error(`Unexpected upstream URL: ${url}`);
    }
    const record = start(kind, marker, init);
    if (marker.mode === 'stream') {
      assert.equal(kind, 'planning');
      return new Response(new ReadableStream({
        start(controller) {
          const abort = () => {
            if (record.finished) return;
            record.aborted = true; aborts++; finish(record);
            controller.error(new DOMException('Fixture stream cancelled', 'AbortError'));
          };
          record.release = () => {
            if (record.finished) return;
            init.signal.removeEventListener('abort', abort);
            controller.enqueue(Buffer.from('data: [DONE]\n\n')); controller.close(); finish(record);
          };
          init.signal.addEventListener('abort', abort, { once: true });
          controller.enqueue(Buffer.from(`data: ${JSON.stringify(marker)}\n\n`));
          if (init.signal.aborted) abort();
        },
      }), { headers: { 'content-type': 'text/event-stream' } });
    }
    try {
      await record.wait();
      // A transient first failure allows an exact-byte client retry to recover.
      if (marker.mode === 'fail' && records.filter(value => value.kind === kind && value.marker.id === marker.id).length === 1) return Response.json({ error: PRIVATE_ERROR }, { status: 500 });
      if (kind === 'planning') return Response.json({ marker: fixtureFault === 'wrong-ai-marker' ? { ...marker, id: 'WRONG_REQUEST' } : marker });
      if (kind === 'intake') {
        const choice = choices[(marker.index ?? 0) % choices.length];
        return Response.json({ model: `fixture:${marker.id}`, answers: { plan_intent: { type: 'choice', choice, confidence: .9, probabilities: Object.fromEntries(choices.map(value => [value, value === choice ? .9 : .025])) } } });
      }
      // A deliberately small atomic RPC model, not a Supabase/RLS implementation.
      const state = states.get(marker.owner) ?? { revision: 1, operations: new Map(), manifest: null };
      states.set(marker.owner, state);
      const fingerprint = JSON.stringify(rpc);
      const previous = state.operations.get(marker.id);
      if (previous) return previous.fingerprint === fingerprint ? Response.json(previous.result) : Response.json({ message: `conflict ${PRIVATE_ERROR}` }, { status: 409 });
      if (rpc.p_base_revision !== state.revision) return Response.json({ message: `conflict ${PRIVATE_ERROR}` }, { status: 409 });
      const result = { revision: ++state.revision };
      state.manifest = rpc.p_manifest;
      state.operations.set(marker.id, { fingerprint, result }); effects++;
      return Response.json(result);
    } finally { finish(record); }
  };
  return {
    fetchImpl, records, peak, ownerPeak, states,
    get effects() { return effects; }, get aborts() { return aborts; }, get unexpectedUrls() { return unexpectedUrls; },
    hold() { held = true; },
    async releaseAll() {
      held = false;
      // Reverse completion intentionally differs from request/admission order.
      for (const record of [...records].reverse()) { if (!record.finished) record.release?.(); await delay(1); }
    },
  };
}

async function withGateway(fixtureFault, fn) {
  const fixtures = createFixtures(fixtureFault), attempts = [];
  let handler, clients = 0, peakClients = 0;
  const server = createServer((req, res) => handler(req, res));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  assert.notEqual(port, 5190, 'Never use the running application listener');
  const origin = `http://127.0.0.1:${port}`;
  const config = { enabled: true, vaultEnabled: true, origin, supabaseUrl: 'https://fixture.invalid', publishableKey: FIXTURE_KEY, providers: { openrouter: FIXTURE_KEY }, typesafeKey: FIXTURE_KEY };
  const auth = {
    sameOrigin: req => req.headers.origin === origin && req.headers['x-cellproject-request'] === '1' && (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin'),
    authorize: async req => {
      const owner = /^fixture-owner=(owner-[0-9]+)$/.exec(req.headers.cookie ?? '')?.[1];
      return owner ? { id: `fixture-${owner}`, user: { id: owner }, accessToken: `fixture-session:${owner}` } : null;
    },
  };
  const unused = new Proxy({}, { get: (_target, name) => async () => { throw new Error(`Unexpected fixture repository call: ${String(name)}`); } });
  handler = createProductionHandler({ config, auth, repository: unused, passwordAccessRepository: unused, vaultRepository: createVaultRepository({ config, fetchImpl: fixtures.fetchImpl }), fetchImpl: fixtures.fetchImpl, publicFetch: async () => { throw new Error('Public fetch is outside benchmark scope'); } });
  const send = (kind, marker, extraHeaders = {}) => {
    const started = performance.now();
    let req, response, expectedAbort = false, done = false, first;
    const chunks = [];
    const firstChunk = new Promise(resolve => { first = resolve; });
    clients++; peakClients = Math.max(peakClients, clients);
    const result = new Promise(resolve => {
      const finish = (outcome, status = null) => {
        if (done) return;
        done = true; clients--; first();
        const text = Buffer.concat(chunks).toString('utf8');
        let body = null; try { body = JSON.parse(text); } catch { /* SSE or interrupted body. */ }
        const attempt = { kind, id: marker.id, owner: marker.owner, outcome, status, latencyMs: performance.now() - started, responseBytes: Buffer.byteLength(text), body, text };
        attempts.push(attempt); resolve(attempt);
      };
      // A new loopback socket per request makes 20/50 simultaneous clients real.
      req = httpRequest(`${origin}${ROUTES[kind]}`, { method: kind === 'persistence' ? 'PUT' : 'POST', agent: false, headers: { cookie: `fixture-owner=${marker.owner}`, origin, 'x-cellproject-request': '1', 'content-type': 'application/json', authorization: 'UNTRUSTED_CLIENT_AUTHORIZATION', ...extraHeaders } }, res => {
        response = res;
        res.on('data', chunk => { chunks.push(chunk); first(); });
        res.once('end', () => finish('response', res.statusCode));
        res.once('aborted', () => finish(expectedAbort ? 'client_aborted' : 'transport_error'));
        res.once('error', () => finish(expectedAbort ? 'client_aborted' : 'transport_error'));
      });
      req.setTimeout(maximumWaitMs, () => req.destroy(new Error('Local HTTP timeout')));
      req.once('error', () => finish(expectedAbort ? 'client_aborted' : 'transport_error'));
      req.end(JSON.stringify(fixtureBody(kind, marker)));
    });
    return { result, firstChunk, abort() { expectedAbort = true; response?.destroy(); req.destroy(); } };
  };
  try { return await fn({ fixtures, attempts, send, get peakClients() { return peakClients; } }); }
  finally {
    await fixtures.releaseAll(); handler.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

const markerFor = (id, owner, index = 0, mode = 'ok') => ({ id, owner, index, mode });
function checkAssociation(attempt) {
  assert.notEqual(attempt.outcome, 'transport_error', `HTTP transport failed: ${attempt.id}`);
  assert.ok(!attempt.text.includes(PRIVATE_ERROR) && !attempt.text.includes(FIXTURE_KEY) && !attempt.text.includes('fixture-session:'), 'Private adapter data leaked in HTTP response');
  if (attempt.status !== 200) return;
  if (attempt.kind === 'planning') {
    assert.equal(attempt.body.marker.id, attempt.id, 'Planning response association');
    assert.equal(attempt.body.marker.owner, attempt.owner, 'Planning owner association');
  } else if (attempt.kind === 'intake') {
    assert.equal(attempt.body.classification.model, `fixture:${attempt.id}`, 'Intake response association');
    assert.equal(attempt.body.status, 'classified');
  } else assert.ok(Number.isSafeInteger(attempt.body.revision) && attempt.body.revision > 1);
}

function latency(values) {
  const sorted = values.map(value => value.latencyMs).sort((a, b) => a - b);
  const p = fraction => sorted.length ? Math.round(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] * 1000) / 1000 : null;
  return { samples: sorted.length, p50: p(.5), p95: p(.95), p99: p(.99), max: p(1) };
}
function summarize(name, concurrency, context, checks, extra = {}) {
  const { attempts, fixtures } = context;
  assert.equal(fixtures.unexpectedUrls, 0, 'Unexpected upstream URL');
  assert.ok(fixtures.records.every(record => record.finished), 'Upstream work leaked after scenario');
  for (const owner of fixtures.states.keys()) {
    const marker = JSON.parse(Buffer.from(fixtures.states.get(owner).manifest.data, 'base64').toString('utf8'));
    assert.equal(marker.owner, owner, 'Stored manifest crossed owner boundary');
  }
  return {
    name, concurrency, passed: true, checks, httpAttempts: attempts.length,
    statuses: Object.fromEntries([...new Set(attempts.map(value => String(value.status ?? value.outcome)))].sort().map(status => [status, attempts.filter(value => String(value.status ?? value.outcome) === status).length])),
    peakPendingHttpRequests: context.peakClients, peakUpstreamActive: { ...fixtures.peak },
    admitted: fixtures.records.length, committedEffects: fixtures.effects, upstreamAborts: fixtures.aborts,
    latencyMs: { all: latency(attempts), success: latency(attempts.filter(value => value.status === 200)), overloaded: latency(attempts.filter(value => value.status === 429)) },
    perRoute: Object.fromEntries(Object.keys(ROUTES).map(kind => [kind, { httpAttempts: attempts.filter(value => value.kind === kind).length, upstreamAttempts: fixtures.records.filter(value => value.kind === kind).length, latencyMs: latency(attempts.filter(value => value.kind === kind)) }])),
    ...extra,
  };
}

async function burst(concurrency, kind, fixtureFault) {
  return withGateway(fixtureFault, async context => {
    const { fixtures, send, attempts } = context;
    const mixed = kind === 'mixed';
    const expected = mixed ? 12 : kind === 'planning' ? 4 : 2;
    const requests = Array.from({ length: concurrency }, (_unused, index) => {
      const route = mixed ? Object.keys(ROUTES)[index % 3] : kind;
      const owner = mixed ? `owner-${Math.floor(index / 3) % 8}` : 'owner-0';
      return send(route, markerFor(`${kind}-${concurrency}-${index}`, owner, index));
    });
    await until(() => fixtures.records.length === expected && attempts.length === concurrency - expected, 'all burst requests admitted or rejected');
    assert.ok(attempts.every(attempt => attempt.status === 429), 'Overload must be rejected without upstream work');
    await fixtures.releaseAll();
    const responses = await Promise.all(requests.map(value => value.result));
    for (const response of responses) checkAssociation(response);
    const conflicts = kind === 'persistence' ? 1 : 0;
    assert.equal(responses.filter(value => value.status === 200).length, expected - conflicts);
    assert.equal(responses.filter(value => value.status === 409).length, conflicts);
    assert.equal(responses.filter(value => value.status === 429).length, concurrency - expected);
    for (const [key, peak] of fixtures.ownerPeak) assert.ok(peak <= (key.startsWith('planning:') ? 4 : 2), `Per-owner admission leaked: ${key}`);
    assert.equal(new Set(fixtures.records.map(value => value.marker.id)).size, expected, 'Gateway automatically retried a request');
    const checks = ['20/50 concurrently issued loopback HTTP requests', 'production global and per-owner admission', 'overload has no upstream effects', 'reordered response and owner association', 'no gateway retries', 'safe private errors', 'all admitted work settled'];
    // These scenarios report the original simultaneous burst separately from probes.
    return summarize(`${kind}-burst-${concurrency}`, concurrency, context, checks);
  });
}

async function failureRecovery() {
  return withGateway(undefined, async context => {
    const { fixtures, attempts, send } = context;
    const failing = [];
    for (const [kind, count] of [['planning', 6], ['intake', 2], ['persistence', 4]]) {
      for (let i = 0; i < count; i++) failing.push(send(kind, markerFor(`fail-${kind}-${i}`, `owner-${i}`, i, 'fail')));
    }
    await until(() => fixtures.records.length === 12, 'failure pools saturated');
    const effectsBefore = fixtures.records.length;
    const denied = [];
    for (const kind of Object.keys(ROUTES)) {
      denied.push(send(kind, markerFor(`unauthorized-${kind}`, 'owner-9'), { cookie: '' }));
      denied.push(send(kind, markerFor(`cross-origin-${kind}`, 'owner-9'), { origin: 'https://untrusted.invalid' }));
    }
    const deniedResults = await Promise.all(denied.map(value => value.result));
    assert.equal(deniedResults.filter(value => value.status === 401).length, 3);
    assert.equal(deniedResults.filter(value => value.status === 403).length, 3);
    assert.equal(fixtures.records.length, effectsBefore, 'Denied request reached an adapter');
    await fixtures.releaseAll();
    const failures = await Promise.all(failing.map(value => value.result));
    assert.equal(failures.filter(value => value.status === 502).length, 10);
    assert.equal(failures.filter(value => value.status === 400).length, 2);
    assert.equal(fixtures.effects, 0, 'Failed RPC committed an effect');
    // Explicit client retries occur only after every failed response has drained.
    fixtures.hold();
    const retries = failures.map(value => send(value.kind, fixtures.records.find(record => record.kind === value.kind && record.marker.id === value.id).marker));
    await until(() => fixtures.records.length === 24, 'all twelve failed admission slots reused simultaneously');
    await fixtures.releaseAll();
    const recovered = await Promise.all(retries.map(value => value.result));
    assert.ok(recovered.every(value => value.status === 200), 'Admission slots did not recover after failures');
    for (const attempt of attempts) checkAssociation(attempt);
    assert.equal(fixtures.records.length, 24, 'Unexpected automatic upstream retries');
    for (const first of fixtures.records.slice(0, 12)) {
      const sameRequest = fixtures.records.filter(value => value.kind === first.kind && value.marker.id === first.marker.id);
      assert.equal(sameRequest.length, 2);
      assert.equal(sameRequest[0].requestBody, sameRequest[1].requestBody, 'Client retry changed upstream request bytes');
    }
    return summarize('failure-and-auth-recovery', 12, context, ['all three limit pools saturated', 'unauthorized and cross-origin denied before adapters', 'failed RPC has no effect', 'safe provider errors', 'all twelve admission slots reused simultaneously after failure', 'explicit client retries preserve upstream request bytes', 'no gateway automatic retry'], { explicitClientRetries: 12, recoveryAdmitted: 12, retryBodiesPreserved: true });
  });
}

async function streamRecovery() {
  return withGateway(undefined, async context => {
    const { fixtures, send } = context;
    const streams = Array.from({ length: 4 }, (_unused, i) => send('planning', markerFor(`stream-${i}`, `owner-${i}`, i, 'stream')));
    await Promise.all(streams.map(value => value.firstChunk));
    assert.equal(fixtures.records.length, 4, 'SSE headers/chunks must arrive before completion');
    streams[0].abort(); streams[1].abort();
    await until(() => fixtures.aborts === 2, 'upstream abort propagation');
    await fixtures.releaseAll();
    const results = await Promise.all(streams.map(value => value.result));
    assert.equal(results.filter(value => value.outcome === 'client_aborted').length, 2);
    for (const result of results.slice(2)) {
      assert.equal(result.status, 200); assert.ok(result.text.includes(`"id":"${result.id}"`)); assert.ok(result.text.includes('[DONE]'));
    }
    fixtures.hold();
    const probes = Array.from({ length: 6 }, (_unused, i) => send('planning', markerFor(`stream-probe-${i}`, `owner-${i}`)));
    await until(() => fixtures.records.length === 10, 'all six AI slots reused simultaneously after disconnect');
    await fixtures.releaseAll();
    const recovered = await Promise.all(probes.map(value => value.result));
    assert.ok(recovered.every(value => value.status === 200), 'Global slots leaked after SSE cancellation');
    recovered.forEach(checkAssociation);
    return summarize('stream-cancel-recovery', 4, context, ['SSE first chunk arrives while upstream held', 'two disconnects abort only their upstreams', 'surviving streams finish with their own markers', 'all six global slots reused simultaneously', 'no automatic retry'], { recoveryAdmitted: 6 });
  });
}

async function ambiguousRetry() {
  return withGateway(undefined, async context => {
    const { fixtures, send } = context;
    const marker = markerFor('ambiguous-operation', 'owner-0');
    const first = send('persistence', marker);
    await until(() => fixtures.records.length === 1, 'write admitted');
    first.abort(); assert.equal((await first.result).outcome, 'client_aborted');
    await fixtures.releaseAll();
    await until(() => fixtures.effects === 1 && fixtures.records.every(value => value.finished), 'disconnected write commits in modeled RPC');
    const retry = await send('persistence', marker).result;
    assert.equal(retry.status, 200); assert.equal(retry.body.revision, 2);
    const changed = await send('persistence', { ...marker, index: 99 }).result;
    assert.equal(changed.status, 409); assert.equal(changed.body.error.code, 'vault_conflict');
    assert.equal(fixtures.effects, 1, 'Retry duplicated modeled commit');
    [retry, changed].forEach(checkAssociation);
    assert.equal(fixtures.records.length, 3, 'Gateway silently retried a write');
    return summarize('ambiguous-write-retry', 1, context, ['disconnect does not assert rollback', 'exact operation ID and bytes reach modeled RPC on retry', 'same operation with changed bytes conflicts', 'one modeled commit', 'no gateway automatic retries'], { explicitClientRetries: 1 });
  });
}

export async function runPlannerGatewayLoad({ concurrencies = [20, 50], onlyMixed = false, fixtureFault } = {}) {
  assert.ok(concurrencies.length && concurrencies.every(value => [20, 50].includes(value)), 'Only bounded 20/50-client scenarios are supported');
  assert.ok(fixtureFault === undefined || fixtureFault === 'wrong-ai-marker');
  const started = performance.now(), memoryBefore = process.memoryUsage(), scenarios = [];
  for (const concurrency of concurrencies) {
    for (const kind of onlyMixed ? ['mixed'] : ['mixed', 'planning', 'intake', 'persistence']) scenarios.push(await burst(concurrency, kind, fixtureFault));
  }
  if (!onlyMixed) scenarios.push(await failureRecovery(), await streamRecovery(), await ambiguousRetry());
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(), passed: true,
    environment: { node: process.version, platform: process.platform, architecture: process.arch, bind: '127.0.0.1, ephemeral port, closed after every scenario' },
    scope: {
      real: ['Node HTTP sockets with 20/50 clients', 'createProductionHandler routing and admission', 'AI JSON/SSE proxy and abort propagation', 'TypeSafe request/response validation', 'createVaultRepository envelope validation, owner headers, RPC serialization and error mapping'],
      simulated: ['authenticated sessions and origin adapter', 'planning provider and TypeSafe responses', 'atomic in-memory vault RPC with revisions and operation IDs'],
      notMeasured: ['LLM planning quality or latency', 'Supabase authentication, SQL CAS/RLS, durability or network capacity', 'Railway capacity or multiple server replicas', 'browser/offline/UI behavior', 'large request bodies or sustained minute-window exhaustion'],
      timing: 'Client-observed loopback round trip; includes controlled admission barriers and reverse-order fixture release. No production throughput or latency claim.',
      persistence: 'CAS and idempotency results validate adapter transport against a modeled RPC, not the actual database implementation.',
    },
    externalNetworkRequests: 0, elapsedMs: Math.round((performance.now() - started) * 1000) / 1000,
    resources: { note: 'Gateway, fixtures and load clients share this Node process; snapshots are not a server-only memory measurement.', before: memoryBefore, after: process.memoryUsage() },
    scenarios,
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const report = await runPlannerGatewayLoad();
  // Keep dated evidence immutable; repeat runs only replace the local latest report.
  const destination = path.resolve('.codex-audit-planning-performance/gateway-load-latest.json');
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ passed: report.passed, scenarios: report.scenarios.length, httpAttempts: report.scenarios.reduce((total, value) => total + value.httpAttempts, 0), externalNetworkRequests: report.externalNetworkRequests, output: destination }));
}
