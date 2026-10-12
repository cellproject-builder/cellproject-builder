import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const script = fileURLToPath(new URL('./mcp.mjs', import.meta.url));
const token = 'cp_test_SENTINEL_PRIVATE_TOKEN_9F264c2bca919eedb9f22cce';
const operationId = '7a39c70c-572d-49e1-951b-286fe226b537';
const catalog = [
  { name: 'projects', kind: 'query', description: 'Read projects.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 10 } }, additionalProperties: false }, permission: 'read', projectRequired: false, scope: 'projects-list' },
  { name: 'rename_project', kind: 'action', description: 'Rename a project.', inputSchema: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 240 } }, required: ['name'], additionalProperties: false }, permission: 'write', projectRequired: true, scope: 'project' },
];

async function apiFixture(t, custom) {
  const requests = []; let revoked = false; let actionCount = 0;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
    requests.push({ path: req.url, method: req.method, authorization: req.headers.authorization, body });
    const json = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (revoked || req.headers.authorization !== `Bearer ${token}`) return json(401, { error: { code: 'authentication_required', message: token } });
    if (custom && await custom({ req, res, body, json })) return;
    if (req.url === '/api/v1/capabilities' && req.method === 'GET') return json(200, { version: 1, revision: 7, catalog });
    if (req.url === '/api/v1/query' && req.method === 'POST') return json(200, { revision: 7, result: { projects: [{ id: 'p1', name: 'Original' }] } });
    if (req.url === '/api/v1/actions' && req.method === 'POST') {
      if (body.baseRevision !== 7) return json(409, { error: { code: 'revision_conflict', message: `Provider detail ${token}`, revision: 8 } });
      actionCount++;
      return json(200, { revision: 8, result: { id: body.projectId, name: body.input.name }, replayed: actionCount > 1 });
    }
    return json(404, { error: { code: 'forbidden_route', message: token } });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, revoke: () => { revoked = true; } };
}

async function protocolClient(t, api, mode = 'legacy') {
  let stderr = '';
  const transport = new StdioClientTransport({ command: process.execPath, args: [script], env: { CELLPROJECT_API_URL: api.url, CELLPROJECT_API_TOKEN: token }, stderr: 'pipe', maxBufferSize: 16 * 1024 * 1024 });
  transport.stderr.on('data', chunk => { stderr += chunk; });
  const client = new Client({ name: 'cellproject-protocol-test', version: '1.0.0' }, { versionNegotiation: { mode }, cache: { mode: 'no-store' } });
  t.after(async () => { await client.close(); assert.doesNotMatch(stderr, /SENTINEL_PRIVATE_TOKEN/); });
  await client.connect(transport);
  return client;
}

for (const [label, mode] of [['legacy', 'legacy'], ['2026-07-28', { pin: '2026-07-28' }]]) {
  test(`real stdio ${label} discovers tools and forwards queries, explicit receipts and resources without AI`, { timeout: 15_000 }, async t => {
    const api = await apiFixture(t); const client = await protocolClient(t, api, mode);
    assert.equal(client.getProtocolEra(), label === 'legacy' ? 'legacy' : 'modern');
    const listing = await client.listTools();
    assert.deepEqual(listing.tools.map(tool => tool.name), ['action_rename_project', 'query_projects']);
    const actionSchema = listing.tools[0].inputSchema;
    assert.deepEqual(actionSchema.required, ['projectId', 'operationId', 'baseRevision']);
    assert.equal(actionSchema.properties.baseRevision.minimum, 1);
    assert.equal(actionSchema.additionalProperties, false);
    assert.deepEqual(actionSchema.properties.input, catalog[1].inputSchema);
    const query = await client.callTool({ name: 'query_projects', arguments: { input: { limit: 2 } } });
    assert.deepEqual(query.structuredContent, { revision: 7, result: { projects: [{ id: 'p1', name: 'Original' }] } });
    const args = { projectId: 'p1', input: { name: 'Renamed' }, operationId, baseRevision: 7 };
    const action = await client.callTool({ name: 'action_rename_project', arguments: args });
    assert.deepEqual(action.structuredContent, { revision: 8, result: { id: 'p1', name: 'Renamed' }, replayed: false });
    const replay = await client.callTool({ name: 'action_rename_project', arguments: args });
    assert.equal(replay.structuredContent.replayed, true);
    assert.deepEqual(api.requests.filter(request => request.path === '/api/v1/actions').map(request => request.body), [{ name: 'rename_project', ...args }, { name: 'rename_project', ...args }]);
    const resources = await client.listResources(); assert.deepEqual(resources.resources.map(resource => resource.uri), ['cellproject://capabilities']);
    const resource = await client.readResource({ uri: 'cellproject://capabilities' });
    assert.deepEqual(JSON.parse(resource.contents[0].text), { version: 1, revision: 7, catalog });
    assert.ok(api.requests.every(request => request.authorization === `Bearer ${token}`));
    assert.ok(api.requests.every(request => ['/api/v1/capabilities', '/api/v1/query', '/api/v1/actions'].includes(request.path)));
  });
}

test('tool errors preserve conflict codes and never retry writes or leak API error bodies', { timeout: 15_000 }, async t => {
  const api = await apiFixture(t); const client = await protocolClient(t, api);
  const result = await client.callTool({ name: 'action_rename_project', arguments: { projectId: 'p1', input: { name: 'Renamed' }, operationId, baseRevision: 6 } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, 'revision_conflict');
  assert.equal(result.structuredContent.error.status, 409);
  assert.doesNotMatch(JSON.stringify(result), /SENTINEL_PRIVATE_TOKEN|Provider detail/);
  assert.equal(api.requests.filter(request => request.path === '/api/v1/actions').length, 1);
});

test('API receipt, vault, content and media failures keep their distinct safe error codes', { timeout: 30_000 }, async t => {
  for (const [code, status] of [['external_operation_conflict', 409], ['vault_revision_conflict', 409], ['conversation_busy', 409], ['conversation_deleted', 400], ['knowledge_missing', 404], ['content_budget', 413], ['external_storage_limit', 413], ['external_blob_conflict', 409], ['media_corrupt', 502], ['chatReferenceChanged', 400], ['attachmentLimit', 400], ['backup_conflict', 409], ['backup_media_corrupt', 502], ['backup_document_corrupt', 502], ['backup_manifest_limit', 413]]) {
    const api = await apiFixture(t, ({ req, json }) => {
      if (req.url !== '/api/v1/actions') return false;
      json(status, { error: { code, message: `Unsafe ${token}` } }); return true;
    });
    const client = await protocolClient(t, api);
    const result = await client.callTool({ name: 'action_rename_project', arguments: { projectId: 'p1', input: { name: 'Renamed' }, operationId, baseRevision: 7 } });
    assert.equal(result.isError, true); assert.equal(result.structuredContent.error.code, code); assert.equal(result.structuredContent.error.status, status);
    assert.doesNotMatch(JSON.stringify(result), /SENTINEL_PRIVATE_TOKEN/);
  }
});

test('local schema references resolve after wrapping while the capability resource stays unchanged', { timeout: 15_000 }, async t => {
  const schema = { type: 'object', properties: { root: { $ref: '#/$defs/node' }, literal: { const: { $ref: '#/data-literal' } } }, $defs: { node: { type: 'object', properties: { value: { type: 'string' }, children: { type: 'array', items: { $ref: '#/$defs/node' } } }, additionalProperties: false } }, additionalProperties: false };
  const entries = [{ ...catalog[0], inputSchema: schema }];
  const api = await apiFixture(t, ({ req, json }) => {
    if (req.url !== '/api/v1/capabilities') return false;
    json(200, { version: 1, revision: 7, catalog: entries }); return true;
  });
  const client = await protocolClient(t, api), listing = await client.listTools(), wrapped = listing.tools[0].inputSchema;
  const resolve = ref => ref.slice(2).split('/').reduce((value, key) => value?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], wrapped);
  assert.deepEqual(resolve(wrapped.properties.input.properties.root.$ref), wrapped.properties.input.$defs.node);
  assert.deepEqual(resolve(wrapped.properties.input.$defs.node.properties.children.items.$ref), wrapped.properties.input.$defs.node);
  assert.deepEqual(wrapped.properties.input.properties.literal.const, { $ref: '#/data-literal' });
  const resource = await client.readResource({ uri: 'cellproject://capabilities' });
  assert.deepEqual(JSON.parse(resource.contents[0].text).catalog[0].inputSchema, schema);
});

test('revoked credentials are checked on a later tool call and resource read in the same process', { timeout: 15_000 }, async t => {
  const api = await apiFixture(t); const client = await protocolClient(t, api);
  await client.listTools(); api.revoke();
  const result = await client.callTool({ name: 'query_projects', arguments: {} });
  assert.equal(result.isError, true); assert.equal(result.structuredContent.error.status, 401);
  await assert.rejects(client.readResource({ uri: 'cellproject://capabilities' }), /authenticat|credential/i);
  assert.equal(api.requests.filter(request => request.path === '/api/v1/query').length, 0);
  assert.doesNotMatch(JSON.stringify(result), /SENTINEL_PRIVATE_TOKEN/);
});

test('missing receipt fields and unknown wrapper fields cannot dispatch a mutation', { timeout: 15_000 }, async t => {
  const api = await apiFixture(t); const client = await protocolClient(t, api);
  for (const args of [
    { projectId: 'p1', input: { name: 'Changed' } },
    { projectId: 'p1', input: { name: 'Changed' }, operationId, baseRevision: 0 },
    { projectId: 'p1', input: { name: 'Changed' }, operationId: 'invalid', baseRevision: 7 },
    { projectId: 'p1', input: { name: 'Changed' }, operationId, baseRevision: 7, url: 'https://evil.test/api/ai' },
  ]) {
    const result = await client.callTool({ name: 'action_rename_project', arguments: args });
    assert.equal(result.isError, true);
  }
  assert.equal(api.requests.filter(request => request.path === '/api/v1/actions').length, 0);
  await assert.rejects(client.callTool({ name: 'planner_ai', arguments: {} }), /Unknown tool/i);
});

test('redirect responses cannot forward the bearer or be reported as success', { timeout: 15_000 }, async t => {
  let redirected = 0;
  const target = createServer((_req, res) => { redirected++; res.end('{}'); });
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => target.close(resolve)));
  const api = await apiFixture(t, ({ req, res }) => {
    if (req.url !== '/api/v1/query') return false;
    res.writeHead(307, { location: `http://127.0.0.1:${target.address().port}/collect` }); res.end(); return true;
  });
  const client = await protocolClient(t, api);
  const result = await client.callTool({ name: 'query_projects', arguments: {} });
  assert.equal(result.isError, true); assert.equal(redirected, 0);
  assert.doesNotMatch(JSON.stringify(result), /SENTINEL_PRIVATE_TOKEN/);
});

test('malformed API success fails closed without reflecting upstream content', { timeout: 15_000 }, async t => {
  const api = await apiFixture(t, ({ req, json }) => {
    if (req.url !== '/api/v1/query') return false;
    json(200, { providerSecret: token }); return true;
  });
  const client = await protocolClient(t, api);
  const result = await client.callTool({ name: 'query_projects', arguments: {} });
  assert.equal(result.isError, true); assert.doesNotMatch(JSON.stringify(result), /SENTINEL_PRIVATE_TOKEN/);
});

test('a valid API response cannot echo the bridge credential into protocol stdout', { timeout: 15_000 }, async t => {
  const api = await apiFixture(t, ({ req, json }) => {
    if (req.url !== '/api/v1/query') return false;
    json(200, { revision: 7, result: { leakedCredential: token } }); return true;
  });
  const client = await protocolClient(t, api);
  const result = await client.callTool({ name: 'query_projects', arguments: {} });
  assert.equal(result.isError, true); assert.doesNotMatch(JSON.stringify(result), /SENTINEL_PRIVATE_TOKEN/);
});

test('catalog collisions, mismatched permissions and credential-bearing metadata are rejected', { timeout: 15_000 }, async t => {
  for (const invalidCatalog of [[catalog[0], catalog[0]], [{ ...catalog[0], permission: 'write' }], [{ ...catalog[0], description: `Leaked ${token}` }]]) {
    const api = await apiFixture(t, ({ req, json }) => {
      if (req.url !== '/api/v1/capabilities') return false;
      json(200, { version: 1, revision: 7, catalog: invalidCatalog }); return true;
    });
    const client = await protocolClient(t, api);
    await assert.rejects(client.listTools(), error => { assert.doesNotMatch(String(error), /SENTINEL_PRIVATE_TOKEN/); return true; });
    assert.equal(api.requests.filter(request => request.method === 'POST').length, 0);
  }
});

test('cancelling the stdio request aborts the in-flight API request', { timeout: 15_000 }, async t => {
  let entered, closed;
  const queryEntered = new Promise(resolve => { entered = resolve; });
  const queryClosed = new Promise(resolve => { closed = resolve; });
  const api = await apiFixture(t, ({ req, res }) => {
    if (req.url !== '/api/v1/query') return false;
    res.once('close', () => { if (!res.writableEnded) closed(); }); entered(); return true;
  });
  const client = await protocolClient(t, api, { pin: '2026-07-28' });
  const controller = new AbortController();
  const pending = client.callTool({ name: 'query_projects', arguments: {} }, { signal: controller.signal });
  await queryEntered; controller.abort(); await assert.rejects(pending);
  await queryClosed;
  assert.equal(api.requests.filter(request => request.path === '/api/v1/query').length, 1);
});

test('responses larger than the documented bridge limit are rejected before reading the body', { timeout: 15_000 }, async t => {
  const api = await apiFixture(t, ({ req, res }) => {
    if (req.url !== '/api/v1/query') return false;
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': 17 * 1024 * 1024 }); res.end('{}'); return true;
  });
  const client = await protocolClient(t, api);
  const result = await client.callTool({ name: 'query_projects', arguments: {} });
  assert.equal(result.isError, true); assert.equal(result.structuredContent.error.code, 'invalid_api_response');
});

test('a ten MiB original media response fits stdio without duplicating its base64 in text content', { timeout: 15_000 }, async t => {
  const base64 = Buffer.alloc(10 * 1024 * 1024, 37).toString('base64');
  const api = await apiFixture(t, ({ req, json }) => {
    if (req.url !== '/api/v1/query') return false;
    json(200, { revision: 7, result: { metadata: { id: 'file1', size: 10 * 1024 * 1024 }, base64 } }); return true;
  });
  const client = await protocolClient(t, api);
  const result = await client.callTool({ name: 'query_projects', arguments: {} });
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.result.base64, base64);
  assert.ok(result.content[0].text.length < 1000);
});

test('unsafe endpoint URLs and missing credentials exit cleanly without stdout or credential disclosure', { timeout: 15_000 }, async () => {
  for (const url of ['http://remote.example', 'https://user:password@example.test', `https://example.test/?token=${token}`, 'https://example.test/#fragment', 'file:///tmp/api', 'https://example.test/api/ai', 'http://127.1']) {
    const result = await runInvalidProcess({ CELLPROJECT_API_URL: url, CELLPROJECT_API_TOKEN: token });
    assert.equal(result.code, 1, url); assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /SENTINEL_PRIVATE_TOKEN|password|example\.test|127\.1/);
  }
  const result = await runInvalidProcess({ CELLPROJECT_API_URL: 'https://example.test', CELLPROJECT_API_TOKEN: '' });
  assert.equal(result.code, 1); assert.equal(result.stdout, '');
});

function runInvalidProcess(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { env, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject); child.once('close', code => resolve({ code, stdout, stderr }));
  });
}
