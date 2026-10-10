import { createHash } from 'node:crypto';
import { invalid } from './cloudUtils.mjs';

export const DOCUMENT_KEYS = new Set(['cellproject-workspace', 'cellproject-graph', 'dynamic_diary-chat', 'cellproject-kb', 'cellproject-config', 'cellproject-locale', 'dynamic_diary-theme', 'dynamic_diary-sidebar-collapsed', 'dynamic_diary:task-view']);
const STORE_KEYS = new Set([...DOCUMENT_KEYS].slice(0, 6));
export const DOCUMENT_LIMIT = 32 * 1024 * 1024;
export const IMPORT_LIMIT = 64 * 1024 * 1024;
export const MEDIA_LIMIT = 10 * 1024 * 1024;
const MEDIA_TYPES = new Set(['application/pdf', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg', 'image/webp']);
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function stableId(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,180}$/.test(value) || value === '.' || value === '..') throw invalid(); return value; }
export function operationId(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(value)) throw invalid('A stable operation ID is required.'); return value; }
export function documentKey(key) { if (!DOCUMENT_KEYS.has(key)) throw invalid('Unknown document key.'); return key; }
export function documentValue(key, value) {
  documentKey(key);
  if (typeof value !== 'string' || Buffer.byteLength(value) > DOCUMENT_LIMIT || value.includes('\0')) throw invalid('Invalid document value.');
  if (STORE_KEYS.has(key)) {
    let envelope; try { envelope = JSON.parse(value); } catch { throw invalid('Invalid persisted document envelope.'); }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || !Number.isSafeInteger(envelope.version) || envelope.version < 0 || !envelope.state || typeof envelope.state !== 'object' || Array.isArray(envelope.state)) throw invalid('Invalid persisted document envelope.');
    if (key === 'cellproject-config') {
      const providers = envelope.state.providers;
      if (providers && (typeof providers !== 'object' || Array.isArray(providers))) throw invalid();
      for (const provider of Object.values(providers ?? {})) {
        if (!provider || typeof provider !== 'object' || Object.entries(provider).some(([name, field]) => /^(api_?key|access_?token|refresh_?token|secret|service_?role)$/i.test(name) && field !== '' && field !== null && field !== undefined)) throw invalid('Provider credentials cannot be stored in cloud documents.');
      }
    }
  }
  return value;
}
export function writeDocumentInput(key, input) {
  documentKey(key); documentValue(key, input?.value); operationId(input?.operationId);
  if (input.key !== undefined && input.key !== key || !Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) throw invalid();
  return { p_key: key, p_value: input.value, p_base_revision: input.baseRevision, p_operation_id: input.operationId };
}
export function importInput(input) {
  operationId(input?.operationId);
  if (!/^[a-f0-9]{64}$/.test(input?.manifestHash) || !Array.isArray(input.documents) || input.documents.length < 1 || input.documents.length > DOCUMENT_KEYS.size) throw invalid();
  const keys = new Set(); let bytes = 0;
  const documents = input.documents.map(item => {
    if (!item || typeof item !== 'object') throw invalid();
    const key = documentKey(item.key); const value = documentValue(key, item.value);
    if (keys.has(key)) throw invalid('Duplicate document key.'); keys.add(key); bytes += Buffer.byteLength(value);
    return { key, value };
  });
  if (bytes > IMPORT_LIMIT) throw invalid('Import exceeds the server limit.');
  return { p_documents: documents, p_manifest_hash: input.manifestHash, p_operation_id: input.operationId };
}
export function mediaMetadata(value, { path = false } = {}) {
  if (!value || typeof value !== 'object') throw invalid();
  const id = stableId(value.id);
  if (!MEDIA_TYPES.has(value.mime) || typeof value.name !== 'string' || value.name.length > 512 || /[\0\r\n]/.test(value.name) || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > MEDIA_LIMIT) throw invalid('Invalid media metadata.');
  if (value.projectId !== undefined && value.projectId !== null) stableId(value.projectId);
  if (value.createdAt !== undefined && value.createdAt !== null && (!Number.isSafeInteger(value.createdAt) || value.createdAt < 0)) throw invalid();
  if (value.mime.startsWith('image/') && value.size > 5 * 1024 * 1024) throw invalid('Image exceeds the server limit.');
  return { id, mime: value.mime, name: value.name, ...(value.projectId != null ? { projectId: value.projectId } : {}), ...(value.createdAt != null ? { createdAt: value.createdAt } : {}), sha256: value.sha256, size: value.size, ...(path ? { path: value.path } : {}) };
}
export function mediaInput(input, owner) {
  operationId(input?.operationId);
  if (typeof input?.base64 !== 'string' || input.base64.length > Math.ceil(MEDIA_LIMIT / 3) * 4 || input.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) throw invalid('Invalid media bytes.');
  const bytes = Buffer.from(input.base64, 'base64');
  if (bytes.toString('base64') !== input.base64) throw invalid('Invalid media bytes.');
  const metadata = mediaMetadata({ ...input, size: bytes.length });
  if (hash(bytes) !== metadata.sha256 || input.size !== undefined && input.size !== bytes.length) throw invalid('Media hash or size does not match.');
  return { bytes, metadata: { ...metadata, path: `${owner}/${hash(metadata.id)}/${metadata.sha256}` }, operationId: input.operationId };
}
