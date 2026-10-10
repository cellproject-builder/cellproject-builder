import { randomUUID } from 'node:crypto';

export class CloudError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const invalid = (message = 'Invalid cloud request.') => new CloudError(400, 'invalid_request', message);
export const unavailable = () => new CloudError(502, 'upstream_unavailable', 'The server could not complete the remote request.');
export function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
}
export function sendError(res, error) {
  if (res.writableEnded || res.destroyed) return;
  if (res.headersSent) { res.destroy(); return; }
  const safe = error instanceof CloudError ? error : unavailable();
  sendJson(res, safe.status, { error: { code: safe.code, message: safe.message, requestId: randomUUID() } });
}
export async function readBytes(stream, maxBytes) {
  if (Number(stream.headers?.['content-length']) > maxBytes) throw new CloudError(413, 'request_too_large', 'Request exceeds the server limit.');
  const chunks = []; let size = 0;
  for await (const chunk of stream) { size += chunk.length; if (size > maxBytes) throw new CloudError(413, 'request_too_large', 'Request exceeds the server limit.'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
export async function readJson(req, maxBytes = 32 * 1024) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json' || req.headers['content-encoding']) throw invalid('A plain JSON request is required.');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(req, maxBytes))); }
  catch (error) { if (error instanceof CloudError) throw error; throw invalid(); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value;
}
export async function boundedResponseBytes(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw unavailable(); }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw unavailable(); } chunks.push(value); }
    return Buffer.concat(chunks);
  } finally { reader.releaseLock(); }
}
export async function remoteJson(response, limit = 1024 * 1024) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await boundedResponseBytes(response, limit))); }
  catch { throw unavailable(); }
}
export function timeoutSignal(signal, ms = 20_000) { return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms); }
