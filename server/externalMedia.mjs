import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CloudError, invalid } from './cloudUtils.mjs';
import { MEDIA_LIMIT, mediaInput, mediaMetadata, stableId, hash } from './cloudValidation.mjs';
import { validateExternalManifest, sealVaultMedia, openVaultMedia } from './externalVault.mjs';
import { createMediaScopeResolver } from '../src/external/mediaOwnership.js';
import { validateExternalMediaBytes } from './externalMediaValidation.mjs';

const id = z.string().min(1).max(180).regex(/^[A-Za-z0-9_.:-]+$/).refine(value => !['.', '..'].includes(value));
const schemas = {
  list: z.object({ offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
  read: z.object({ id }).strict(),
  put: z.object({ id, name: z.string().max(512).regex(/^[^\0\r\n]*$/), mime: z.enum(['application/pdf', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg', 'image/webp']), base64: z.string().max(Math.ceil(MEDIA_LIMIT / 3) * 4), sha256: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.number().int().min(0).optional() }).strict(),
  delete: z.object({ id }).strict(),
};
const descriptions = {
  list: 'List original media metadata for the selected scope with offset/limit pagination.',
  read: 'Read original bytes as base64 after ciphertext and plaintext integrity checks.',
  put: 'Upload original media bytes with their SHA-256; encrypt before immutable storage and publish through the revision-checked manifest commit.',
  delete: 'Remove unreferenced media from the manifest; reject document references and retain immutable encrypted blobs for retention/cleanup.',
};

export const externalMediaCatalog = ['media', 'personal_media'].flatMap(prefix => Object.entries(schemas).map(([verb, schema]) => ({
  name: `${prefix}.${verb}`, kind: ['list', 'read'].includes(verb) ? 'query' : 'action',
  description: descriptions[verb], inputSchema: z.toJSONSchema(schema, { unrepresentable: 'any' }),
  permission: ['list', 'read'].includes(verb) ? 'read' : 'write', projectRequired: prefix === 'media', scope: prefix === 'media' ? 'project' : 'account',
})));

const denied = () => new CloudError(403, 'media_forbidden', 'This media operation is not permitted for the selected scope.');
const missing = () => new CloudError(404, 'media_not_found', 'Media was not found in the selected scope.');
const corrupt = () => new CloudError(502, 'media_corrupt', 'The encrypted media did not pass its integrity checks.');

function authorizeScope(credential, entry, projectId) {
  if (!credential?.permissions?.includes(entry.permission)) throw denied();
  if (entry.scope === 'account') {
    if (credential.projects !== '*') throw denied();
    if (projectId !== undefined && projectId !== null) throw invalid('Personal media does not accept a project ID.');
    return { projectId: null, accountOperation: true };
  }
  stableId(projectId);
  if (credential.projects !== '*' && (!Array.isArray(credential.projects) || !credential.projects.includes(projectId))) throw denied();
  return { projectId, accountOperation: false };
}

function findOwned(manifest, logicalId, projectId, sameScope) {
  const metadata = manifest.snapshot.media.find(item => item.id === logicalId);
  if (!metadata || !sameScope(metadata, projectId)) throw missing();
  return mediaMetadata(metadata);
}

function referencedByDocuments(manifest, logicalId) {
  // Conservatively protect references in every persisted document, including
  // archives and personal notes. Text mentioning an ID can also block deletion.
  for (const doc of manifest.snapshot.documents) {
    let value;
    try { value = JSON.parse(doc.value); } catch { if (doc.value.includes(logicalId)) return true; continue; }
    const stack = [value];
    while (stack.length) {
      const item = stack.pop();
      if (typeof item === 'string' && item.includes(logicalId)) return true;
      if (item && typeof item === 'object') {
        if (Object.keys(item).some(key => key.includes(logicalId))) return true;
        stack.push(...Object.values(item));
      }
    }
  }
  return false;
}

async function readMedia(repository, credential, manifest, rawKey, input, scope, sameScope) {
  const metadata = findOwned(manifest, input.id, scope.projectId, sameScope), descriptor = manifest.files[input.id];
  const encrypted = await repository.readBlob(credential, { ...scope, id: descriptor.blobId });
  let bytes;
  try {
    if (!(encrypted instanceof Uint8Array) || encrypted.byteLength !== descriptor.size || hash(encrypted) !== descriptor.sha256) throw corrupt();
    const cipher = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(encrypted));
    bytes = openVaultMedia(rawKey, credential.ownerId, credential.vaultId, descriptor.blobId, cipher);
    if (bytes.length !== metadata.size || hash(bytes) !== metadata.sha256) throw corrupt();
    return { result: { metadata, base64: bytes.toString('base64') }, manifest };
  } catch { throw corrupt(); }
  finally { bytes?.fill(0); }
}

async function putMedia(repository, credential, manifest, rawKey, input, scope, sameScope) {
  const existing = manifest.snapshot.media.find(item => item.id === input.id);
  if (existing && !sameScope(existing, scope.projectId)) throw denied();
  const { bytes, metadata: withPath } = mediaInput({ ...input, ...(scope.projectId === null ? {} : { projectId: scope.projectId }), operationId: 'external-media-put' }, credential.ownerId);
  const metadata = mediaMetadata(withPath), blobId = randomUUID();
  try {
    if (!sameScope(metadata, scope.projectId)) throw denied();
    const retained = manifest.snapshot.media.filter(item => item.id !== input.id);
    const globalBytes = retained.reduce((sum, item) => sum + item.size, bytes.length);
    const scopeBytes = retained.filter(item => sameScope(item, scope.projectId)).reduce((sum, item) => sum + item.size, bytes.length);
    if (globalBytes > 500 * 1024 * 1024 || scopeBytes > 50 * 1024 * 1024) throw new CloudError(413, 'external_storage_limit', 'The original media storage limit has been reached.');
    await validateExternalMediaBytes(bytes, metadata.mime);
    const cipher = sealVaultMedia(rawKey, credential.ownerId, credential.vaultId, blobId, bytes);
    const encrypted = Buffer.from(JSON.stringify(cipher)), cipherHash = hash(encrypted);
    await repository.writeBlob(credential, { ...scope, id: blobId, sha256: cipherHash, base64: encrypted.toString('base64') });
    const next = { snapshot: { ...manifest.snapshot, media: existing ? manifest.snapshot.media.map(item => item.id === input.id ? metadata : item) : [...manifest.snapshot.media, metadata] }, files: { ...manifest.files, [input.id]: { blobId, sha256: cipherHash, size: encrypted.length } } };
    validateExternalManifest(next);
    return { result: { metadata }, manifest: next };
  } finally { bytes.fill(0); }
}

/** The caller performs the live API authorization, CAS commit and receipt transaction. */
export async function executeExternalMedia({ repository, credential, manifest, rawKey, operation, projectId }) {
  try {
    const entry = externalMediaCatalog.find(item => item.name === operation?.name && item.kind === operation?.kind);
    if (!entry) throw invalid('Unknown media operation.');
    const scope = authorizeScope(credential, entry, projectId), verb = entry.name.split('.')[1];
    const parsed = schemas[verb].safeParse(operation.input ?? {});
    if (!parsed.success) throw invalid('Invalid media operation arguments.');
    validateExternalManifest(manifest);
    const input = parsed.data, sameScope = createMediaScopeResolver(manifest.snapshot);
    if (verb === 'list') {
      const items = manifest.snapshot.media.filter(item => sameScope(item, scope.projectId)).map(item => mediaMetadata(item));
      const offset = input.offset ?? 0, limit = input.limit ?? 20;
      return { result: { items: items.slice(offset, offset + limit), total: items.length, offset, nextOffset: offset + limit < items.length ? offset + limit : null }, manifest };
    }
    if (verb === 'read') return await readMedia(repository, credential, manifest, rawKey, input, scope, sameScope);
    if (verb === 'put') return await putMedia(repository, credential, manifest, rawKey, input, scope, sameScope);
    findOwned(manifest, input.id, scope.projectId, sameScope);
    if (referencedByDocuments(manifest, input.id)) throw new CloudError(409, 'media_referenced', 'Remove document references to this media before deleting it.');
    const files = { ...manifest.files }; delete files[input.id];
    const next = { snapshot: { ...manifest.snapshot, media: manifest.snapshot.media.filter(item => item.id !== input.id) }, files };
    validateExternalManifest(next);
    return { result: { id: input.id, deleted: true }, manifest: next };
  } catch (error) {
    if (error instanceof CloudError) throw error;
    throw new CloudError(502, 'media_unavailable', 'The original media operation could not be completed.');
  }
}
