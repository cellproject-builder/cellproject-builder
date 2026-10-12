import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Server, ProtocolError } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const CAPABILITIES_URI = 'cellproject://capabilities';
const RESPONSE_LIMIT = 16 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const entrySchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_.-]{1,110}$/), kind: z.enum(['query', 'action']),
  description: z.string().max(8000), inputSchema: z.record(z.string(), z.unknown()),
  permission: z.enum(['read', 'write']), projectRequired: z.boolean(), scope: z.enum(['project', 'projects-list', 'account']).optional(),
}).strict();
const capabilitiesSchema = z.object({ version: z.literal(1), revision: z.number().int().min(1), catalog: z.array(entrySchema).max(500) }).strict();
const responseSchema = z.object({ revision: z.number().int().min(1), result: z.unknown(), replayed: z.boolean().optional() }).strict().refine(value => Object.hasOwn(value, 'result'));
const SAFE_CODES = new Set([
  'authentication_required', 'invalid_credential', 'credential_expired', 'credential_revoked',
  'forbidden', 'insufficient_scope', 'scope_forbidden', 'project_forbidden', 'project_not_found',
  'invalid_request', 'validation_failed', 'revision_conflict', 'operation_conflict',
  'external_revision_conflict', 'external_operation_conflict', 'external_credential_conflict',
  'vault_revision_conflict', 'vault_changed', 'vault_locked', 'vault_required', 'workspace_invalid',
  'plan_changed', 'node_missing', 'draft_pending', 'operation_rejected', 'unknown_operation',
  'request_too_large', 'rate_limited', 'external_rate_limited', 'external_api_busy',
  'external_api_disabled', 'external_api_not_configured', 'external_not_configured', 'external_forbidden',
  'upstream_unavailable', 'worker_unavailable', 'internal_error',
  'media_forbidden', 'media_not_found', 'media_referenced', 'media_corrupt', 'media_unavailable',
  'external_blob_conflict', 'external_storage_limit', 'external_capsule_invalid',
  'conversation_missing', 'conversation_deleted', 'conversation_archived', 'conversation_busy', 'conversation_invalid',
  'knowledge_missing', 'knowledge_invalid', 'content_budget', 'invalid_input', 'account_scope', 'project_scope', 'project_required',
  'chatReferenceMissing', 'chatReferenceChanged', 'chatReferenceSelectionChanged', 'chatReferenceLimit', 'chatReferenceDuplicate',
  'attachmentLimit', 'attachmentChanged', 'projectMissing',
  'backup_forbidden', 'backup_conflict', 'backup_media_corrupt', 'backup_document_limit', 'backup_document_missing', 'backup_media_missing', 'backup_unavailable',
  'backup_document_corrupt', 'backup_manifest_limit',
]);

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function configFromEnvironment(env) {
  const raw = env.CELLPROJECT_API_URL;
  const token = env.CELLPROJECT_API_TOKEN;
  let url;
  try { url = new URL(raw); } catch { throw new Error('Invalid MCP configuration.'); }
  const authority = typeof raw === 'string' && /^https?:\/\/([^/?#]+)\/?$/i.exec(raw)?.[1];
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!authority || authority.toLowerCase() !== url.host || url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || typeof token !== 'string' || token.length < 16 || token.length > 4096 || !/^[\x21-\x7e]+$/.test(token)) throw new Error('Invalid MCP configuration.');
  return { origin: url.origin, token };
}

function errorForStatus(status, upstreamCode) {
  const code = SAFE_CODES.has(upstreamCode) ? upstreamCode : status === 401 ? 'authentication_required' : status === 403 ? 'forbidden' : status === 409 ? 'revision_conflict' : status === 429 ? 'rate_limited' : 'api_error';
  const message = status === 401 ? 'The integration credential is invalid, expired or revoked.' : status === 403 ? 'The integration does not have permission for this operation.' : status === 409 ? 'Remote data or the operation receipt changed. Read current state before deciding whether to retry.' : status === 429 ? 'The API request limit was reached. Retry later.' : 'The API could not complete this operation. Check the arguments and integration access.';
  return new ApiError(status, code, message);
}

async function requestApi(config, route, body, signal) {
  try {
    const response = await fetch(`${config.origin}/api/v1/${route}`, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${config.token}`, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
    });
    if (Number(response.headers.get('content-length')) > RESPONSE_LIMIT) { await response.body?.cancel(); throw new ApiError(502, 'invalid_api_response', 'The API response exceeded the bridge limit.'); }
    const chunks = []; let size = 0;
    if (response.body) for await (const chunk of response.body) { size += chunk.byteLength; if (size > RESPONSE_LIMIT) throw new ApiError(502, 'invalid_api_response', 'The API response exceeded the bridge limit.'); chunks.push(Buffer.from(chunk)); }
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { if (!response.ok) throw errorForStatus(response.status); throw new ApiError(502, 'invalid_api_response', 'The API returned an invalid response.'); }
    if (!response.ok) throw errorForStatus(response.status, value?.error?.code);
    // API payloads are untrusted too: never reflect this process's bearer in a
    // tool result, catalog field or resource, including JSON-escaped variants.
    if (JSON.stringify(value).includes(JSON.stringify(config.token).slice(1, -1))) throw new ApiError(502, 'invalid_api_response', 'The API returned an unsafe response.');
    if (response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new ApiError(502, 'invalid_api_response', 'The API returned an invalid response.');
    return value;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, 'api_unavailable', 'The API request failed or was cancelled. Verify the API address and connection.');
  }
}

async function capabilities(config, signal) {
  const parsed = capabilitiesSchema.safeParse(await requestApi(config, 'capabilities', undefined, signal));
  if (!parsed.success) throw new ApiError(502, 'invalid_api_response', 'The API returned an invalid capability catalog.');
  const names = new Set();
  for (const entry of parsed.data.catalog) {
    const name = toolName(entry);
    if (names.has(name) || entry.permission !== (entry.kind === 'query' ? 'read' : 'write') || entry.inputSchema.type !== 'object') throw new ApiError(502, 'invalid_api_response', 'The API returned an invalid capability catalog.');
    names.add(name);
  }
  return parsed.data;
}

function toolName(entry) { return `${entry.kind}_${entry.name}`; }

function wrappedInputSchema(schema) {
  const copy = structuredClone(schema);
  const single = ['additionalProperties', 'additionalItems', 'unevaluatedProperties', 'unevaluatedItems', 'propertyNames', 'contains', 'not', 'if', 'then', 'else', 'items'];
  const arrays = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];
  const maps = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependencies'];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const child of node) visit(child); return; }
    // A nested $id defines its own resource root, so local refs keep that scope.
    if (typeof node.$id === 'string') return;
    for (const key of ['$ref', '$dynamicRef', '$recursiveRef']) {
      if (node[key] === '#') node[key] = '#/properties/input';
      else if (typeof node[key] === 'string' && node[key].startsWith('#/')) node[key] = '#/properties/input/' + node[key].slice(2);
    }
    for (const key of [...single, ...arrays]) visit(node[key]);
    for (const key of maps) if (node[key] && typeof node[key] === 'object' && !Array.isArray(node[key])) for (const child of Object.values(node[key])) visit(child);
  };
  visit(copy);
  return copy;
}

function toolSchema(entry) {
  const properties = { input: wrappedInputSchema(entry.inputSchema), projectId: { type: 'string', minLength: 1, maxLength: 100 } };
  const required = entry.projectRequired ? ['projectId'] : [];
  if (entry.kind === 'action') {
    properties.operationId = { type: 'string', format: 'uuid', description: 'Client-generated operation UUID; reuse only for an identical retry.' };
    properties.baseRevision = { type: 'integer', minimum: 1, description: 'Revision returned by the latest authorized read.' };
    required.push('operationId', 'baseRevision');
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

function parseArguments(entry, raw) {
  const fields = { input: z.record(z.string(), z.unknown()).optional(), projectId: z.string().min(1).max(100).optional() };
  if (entry.projectRequired) fields.projectId = fields.projectId.unwrap();
  if (entry.kind === 'action') { fields.operationId = z.string().regex(UUID); fields.baseRevision = z.number().int().min(1); }
  const parsed = z.object(fields).strict().safeParse(raw ?? {});
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Invalid tool arguments. Follow the advertised schema and provide the required revision and operation ID for actions.');
  return parsed.data;
}

function toolResult(value, isError = false) {
  const serialized = JSON.stringify(value);
  // Large originals already contain base64. Repeating them in the compatibility
  // text block would double the wire message and exceed clients' buffer limits.
  const text = Buffer.byteLength(serialized) > 1024 * 1024 ? 'The complete result is available in structuredContent.' : serialized;
  return { content: [{ type: 'text', text }], structuredContent: value, isError };
}

function protocolError(error) {
  return new ProtocolError(-32603, error instanceof ApiError ? error.message : 'The API request failed.');
}

function buildServer(config) {
  const server = new Server({ name: 'cellproject', version: '1.0.0' }, { capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } } });
  server.setRequestHandler('tools/list', async (_request, ctx) => {
    try {
      const data = await capabilities(config, ctx.mcpReq.signal);
      return { tools: data.catalog.map(entry => ({ name: toolName(entry), description: entry.description, inputSchema: toolSchema(entry), annotations: { readOnlyHint: entry.kind === 'query', destructiveHint: entry.kind === 'action', idempotentHint: true, openWorldHint: false } })).sort((a, b) => a.name.localeCompare(b.name)) };
    } catch (error) { throw protocolError(error); }
  });
  server.setRequestHandler('tools/call', async (request, ctx) => {
    try {
      const data = await capabilities(config, ctx.mcpReq.signal);
      const entry = data.catalog.find(item => toolName(item) === request.params.name);
      if (!entry) throw new ProtocolError(-32602, 'Unknown tool.');
      const args = parseArguments(entry, request.params.arguments);
      const response = responseSchema.safeParse(await requestApi(config, entry.kind === 'query' ? 'query' : 'actions', { name: entry.name, ...args }, ctx.mcpReq.signal));
      if (!response.success) throw new ApiError(502, 'invalid_api_response', 'The API returned an invalid operation response.');
      return toolResult(response.data);
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      const safe = error instanceof ApiError ? error : new ApiError(502, 'api_unavailable', 'The API request failed.');
      return toolResult({ error: { code: safe.code, message: safe.message, status: safe.status } }, true);
    }
  });
  server.setRequestHandler('resources/list', async (_request, ctx) => {
    try { await capabilities(config, ctx.mcpReq.signal); return { resources: [{ uri: CAPABILITIES_URI, name: 'capabilities', description: 'Current authorized deterministic operations and API revision.', mimeType: 'application/json' }] }; }
    catch (error) { throw protocolError(error); }
  });
  server.setRequestHandler('resources/read', async (request, ctx) => {
    if (request.params.uri !== CAPABILITIES_URI) throw new ProtocolError(-32602, 'Unknown resource.');
    try { const data = await capabilities(config, ctx.mcpReq.signal); return { contents: [{ uri: CAPABILITIES_URI, mimeType: 'application/json', text: JSON.stringify(data) }] }; }
    catch (error) { throw protocolError(error); }
  });
  return server;
}

export function startMcpBridge(env = process.env) {
  const config = configFromEnvironment(env);
  return serveStdio(() => buildServer(config), { transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: RESPONSE_LIMIT }), onerror: () => { console.error('The MCP protocol request could not be processed.'); } });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const bridge = startMcpBridge();
    const close = () => { bridge.close().catch(() => {}); };
    process.once('SIGINT', close); process.once('SIGTERM', close);
  } catch {
    console.error('Cellproject MCP could not start. Check CELLPROJECT_API_URL and CELLPROJECT_API_TOKEN.');
    process.exitCode = 1;
  }
}
