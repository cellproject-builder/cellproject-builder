import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CloudError, invalid } from './cloudUtils.mjs';
import { DOCUMENT_KEYS, DOCUMENT_LIMIT, MEDIA_LIMIT, documentValue, mediaMetadata, mediaInput, hash } from './cloudValidation.mjs';
import { validateExternalManifest, sealVaultMedia, openVaultMedia } from './externalVault.mjs';
import { validateExternalMediaBytes } from './externalMediaValidation.mjs';
let validationPromise;
function validation() { validationPromise ??= import('../dist-server/backup-validation.mjs').catch(error => { validationPromise = undefined; throw error; }); return validationPromise; }

const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,180}$/).refine(value => !['.', '..'].includes(value));
const key = z.enum([...DOCUMENT_KEYS]);
const mime = z.enum(['application/pdf', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg', 'image/webp']);
const fileFields = { id, name: z.string().max(512).regex(/^[^\0\r\n]*$/), mime, projectId: z.string().min(1).max(180).regex(/^[A-Za-z0-9_.:-]+$/).optional(), createdAt: z.number().int().nonnegative().optional(), sha256: z.string().regex(/^[a-f0-9]{64}$/) };
const metadataSchema = z.object({ ...fileFields, size: z.number().int().min(1).max(MEDIA_LIMIT) }).strict();
const descriptorSchema = z.object({ blobId: z.string().uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().min(1).max(15 * 1024 * 1024) }).strict();
const CHUNK_LIMIT = 8 * 1024 * 1024, MANIFEST_LIMIT = 96 * 1024 * 1024;
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const partSchema = z.object({ descriptor: descriptorSchema, sha256: digestSchema, size: z.number().int().min(1).max(CHUNK_LIMIT) }).strict();
const documentSchema = z.union([
  z.object({ key, value: z.string().max(DOCUMENT_LIMIT) }).strict(),
  z.object({ key, parts: z.array(partSchema).min(1).max(128), sha256: digestSchema, size: z.number().int().min(1).max(DOCUMENT_LIMIT) }).strict(),
]);
const headerSchema = z.object({ format: z.literal('cellproject-global-backup'), version: z.literal(1), exportedAt: z.string().max(100).refine(value => Number.isFinite(Date.parse(value))), operationId: z.string().uuid(), manifestHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const schemas = {
  'backup.manifest': z.object({ offset: z.number().int().min(0).max(100000).optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
  'backup.document': z.object({ key, offset: z.number().int().min(0).max(DOCUMENT_LIMIT).optional(), limit: z.number().int().min(1).max(1024 * 1024).optional() }).strict(),
  'backup.media.read': z.object({ id }).strict(),
  'backup.media.stage': z.object({ ...fileFields, base64: z.string().max(Math.ceil(MEDIA_LIMIT / 3) * 4) }).strict(),
  'backup.document.stage': z.object({ key, base64: z.string().max(Math.ceil(CHUNK_LIMIT / 3) * 4), sha256: digestSchema }).strict(),
  'backup.import': headerSchema.extend({ documents: z.array(documentSchema).max(DOCUMENT_KEYS.size), media: z.array(z.object({ metadata: metadataSchema, descriptor: descriptorSchema }).strict()).max(10000) }).strict(),
};
const descriptions = {
  'backup.manifest': 'Read the global backup header/hash, all document descriptors and paginated original-media metadata. Provider credentials are excluded.',
  'backup.document': 'Read a global backup document in bounded character chunks (at most 1 MiB characters per query), with the full UTF-8 hash.',
  'backup.media.read': 'Read any account original, including historical scope aliases, after encrypted and plaintext integrity checks for global backup export.',
  'backup.media.stage': 'Encrypt and store one backup original without publishing it in the media catalog. The operation receipt retains its metadata/descriptor for final atomic import.',
  'backup.document.stage': 'Encrypt and store one document byte chunk of at most 8 MiB without publishing a document. The encrypted operation receipt retains its key, ciphertext descriptor and plaintext hash/size for final backup import.',
  'backup.import': 'Validate a complete global backup against the shared UI hash/notebook/board/credential rules, reconstruct inline or staged documents with owner-bound integrity and fatal UTF-8 checks, verify originals, and atomically add only absent or identical content. Each document is at most 32 MiB and the final serialized manifest at most 96 MiB including the encryption tag. Divergence returns 409; the small descriptor request fits the 16 MiB HTTP limit.',
};
export const externalBackupCatalog = Object.entries(schemas).map(([name, schema]) => ({ name, kind: ['backup.media.stage', 'backup.document.stage', 'backup.import'].includes(name) ? 'action' : 'query', description: descriptions[name], inputSchema: z.toJSONSchema(schema, { unrepresentable: 'any' }), permission: ['backup.media.stage', 'backup.document.stage', 'backup.import'].includes(name) ? 'write' : 'read', projectRequired: false, scope: 'account' }));
const scope = { projectId: null, accountOperation: true };
const denied = () => new CloudError(403, 'backup_forbidden', 'Global backups require account-wide access.');
const conflict = () => new CloudError(409, 'backup_conflict', 'Existing documents or originals differ from this backup.');
const corrupt = () => new CloudError(502, 'backup_media_corrupt', 'The backup original did not pass its integrity checks.');
const documentCorrupt = () => new CloudError(502, 'backup_document_corrupt', 'The backup document did not pass its integrity or UTF-8 checks.');
const manifestLimit = () => new CloudError(413, 'backup_manifest_limit', 'The reconstructed encrypted manifest exceeds its 96 MiB limit.');

/** Header is directly compatible with the browser archive manifest. */
export async function createExternalBackupHeader(documents, media, exportedAt = Date.now()) {
  const { backupManifestHash } = await validation();
  return { format: 'cellproject-global-backup', version: 1, exportedAt: new Date(exportedAt).toISOString(), operationId: randomUUID(), manifestHash: await backupManifestHash({ documents, media: media.map(metadata => ({ ...metadata, base64: '' })) }) };
}
async function encryptedBytes(repository, credential, rawKey, metadata, descriptor, corruptError) {
  let bytes;
  try {
    const encrypted = await repository.readBlob(credential, { ...scope, id: descriptor.blobId });
    if (!(encrypted instanceof Uint8Array) || encrypted.length !== descriptor.size || hash(encrypted) !== descriptor.sha256) throw corruptError();
    const cipher = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(encrypted));
    bytes = openVaultMedia(rawKey, credential.ownerId, credential.vaultId, descriptor.blobId, cipher);
    if (bytes.length !== metadata.size || hash(bytes) !== metadata.sha256) throw corruptError();
    return bytes;
  } catch { bytes?.fill(0); throw corruptError(); }
}
async function originalBytes(repository, credential, rawKey, metadata, descriptor) {
  const bytes = await encryptedBytes(repository, credential, rawKey, metadata, descriptor, corrupt);
  try { await validateExternalMediaBytes(bytes, metadata.mime); return bytes; }
  catch { bytes.fill(0); throw corrupt(); }
}
async function writeEncryptedBytes(repository, credential, rawKey, bytes) {
  const blobId = randomUUID(), cipher = sealVaultMedia(rawKey, credential.ownerId, credential.vaultId, blobId, bytes);
  const encrypted = Buffer.from(JSON.stringify(cipher)), descriptor = { blobId, sha256: hash(encrypted), size: encrypted.length };
  try { await repository.writeBlob(credential, { ...scope, id: blobId, sha256: descriptor.sha256, base64: encrypted.toString('base64') }); return descriptor; }
  finally { encrypted.fill(0); }
}
async function stage(repository, credential, manifest, rawKey, input) {
  const { bytes, metadata: raw } = mediaInput({ ...input, operationId: 'external-backup-stage' }, credential.ownerId);
  try {
    await validateExternalMediaBytes(bytes, raw.mime);
    const metadata = mediaMetadata(raw), descriptor = await writeEncryptedBytes(repository, credential, rawKey, bytes);
    return { result: { metadata, descriptor }, manifest };
  } finally { bytes.fill(0); }
}
async function stageDocument(repository, credential, manifest, rawKey, input) {
  if (input.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) throw invalid('Invalid document chunk bytes.');
  const bytes = Buffer.from(input.base64, 'base64');
  try {
    if (!bytes.length || bytes.length > CHUNK_LIMIT || bytes.toString('base64') !== input.base64 || hash(bytes) !== input.sha256) throw invalid('Invalid document chunk hash or size.');
    const descriptor = await writeEncryptedBytes(repository, credential, rawKey, bytes);
    return { result: { key: input.key, descriptor, sha256: input.sha256, size: bytes.length }, manifest };
  } finally { bytes.fill(0); }
}
async function reconstructDocument(repository, credential, rawKey, document) {
  const bytes = Buffer.alloc(document.size); let offset = 0;
  try {
    for (const part of document.parts) {
      const chunk = await encryptedBytes(repository, credential, rawKey, part, part.descriptor, documentCorrupt);
      try { chunk.copy(bytes, offset); offset += chunk.length; } finally { chunk.fill(0); }
    }
    if (offset !== document.size || hash(bytes) !== document.sha256) throw documentCorrupt();
    // Preserve a BOM as part of the authored value; only decoding malformed
    // byte sequences is forbidden. Chunks may split a multibyte code point.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch { throw documentCorrupt(); }
  finally { bytes.fill(0); }
}
async function importBackup(repository, credential, manifest, rawKey, input, rawInput) {
  const keys = new Set(); let documentBytes = 0;
  for (const document of input.documents) {
    if (keys.has(document.key)) throw invalid('Duplicate backup document key.'); keys.add(document.key);
    if ('value' in document) { documentValue(document.key, document.value); documentBytes += Buffer.byteLength(document.value); }
    else {
      if (document.parts.reduce((sum, part) => sum + part.size, 0) !== document.size) throw invalid('Document chunk sizes do not match.');
      documentBytes += document.size;
    }
  }
  if (documentBytes > MANIFEST_LIMIT) throw new CloudError(413, 'backup_document_limit', 'Backup documents exceed the reconstructed manifest limit.');
  const media = input.media.map(item => ({ metadata: mediaMetadata(item.metadata), descriptor: item.descriptor }));
  const mediaIds = new Set(), originals = [...manifest.snapshot.media], files = { ...manifest.files };
  for (const item of media) {
    if (mediaIds.has(item.metadata.id)) throw invalid('Duplicate backup media ID.'); mediaIds.add(item.metadata.id);
    const existing = manifest.snapshot.media.find(value => value.id === item.metadata.id);
    if (existing && JSON.stringify(mediaMetadata(existing)) !== JSON.stringify(item.metadata)) throw conflict();
    if (!existing) { originals.push(item.metadata); files[item.metadata.id] = item.descriptor; }
  }
  if (originals.reduce((sum, item) => sum + item.size, 0) > 500 * 1024 * 1024) throw new CloudError(413, 'external_storage_limit', 'The original media storage limit has been reached.');
  // A cheap lower bound rejects impossible manifests before downloading parts
  // or originals; the exact serialized byte size is checked after decoding.
  const projected = [...manifest.snapshot.documents]; let stagedBytes = 0;
  for (const document of input.documents) if (!projected.some(value => value.key === document.key)) {
    projected.push({ key: document.key, value: 'value' in document ? document.value : '', revision: 1 });
    if ('parts' in document) stagedBytes += document.size;
  }
  if (Buffer.byteLength(JSON.stringify({ snapshot: { documents: projected, media: originals }, files })) + stagedBytes + 16 > MANIFEST_LIMIT) throw manifestLimit();
  const incoming = [];
  for (let index = 0; index < input.documents.length; index++) {
    const document = input.documents[index];
    const resolved = 'value' in document ? rawInput.documents[index] : { key: document.key, value: await reconstructDocument(repository, credential, rawKey, document) };
    documentValue(resolved.key, resolved.value);
    const existing = manifest.snapshot.documents.find(value => value.key === resolved.key);
    if (existing && existing.value !== resolved.value) throw conflict();
    incoming.push(resolved);
  }
  const documents = [...manifest.snapshot.documents];
  for (const document of incoming) if (!documents.some(value => value.key === document.key)) documents.push({ key: document.key, value: document.value, revision: 1 });
  const next = { snapshot: { documents, media: originals }, files };
  if (Buffer.byteLength(JSON.stringify(next)) + 16 > MANIFEST_LIMIT) throw manifestLimit();
  const byId = new Map(media.map(item => [item.metadata.id, item]));
  try {
    const { validateBackup } = await validation();
    // The browser archive hash retains object-property ordering. Schemas check
    // attributes, but their normalized key order must not rewrite that hash.
    await validateBackup({ ...input, documents: incoming, media: rawInput.media.map(item => ({ ...item.metadata, base64: '' })) }, { readMedia: async metadata => {
      const item = byId.get(metadata.id); return originalBytes(repository, credential, rawKey, item.metadata, item.descriptor);
    } });
  } catch (error) { if (error instanceof CloudError) throw error; throw invalid('Invalid global backup content or manifest hash.'); }
  validateExternalManifest(next);
  return { result: { imported: true, documents: input.documents.length, media: media.length, manifestHash: input.manifestHash }, manifest: next };
}
/** The API owns the live scope check, CAS manifest commit and encrypted receipt. */
export async function executeExternalBackup({ repository, credential, manifest, rawKey, operation, projectId }) {
  try {
    const entry = externalBackupCatalog.find(value => value.name === operation?.name && value.kind === operation?.kind);
    if (!entry) throw invalid('Unknown backup operation.');
    if (credential?.projects !== '*' || !credential?.permissions?.includes(entry.permission)) throw denied();
    if (projectId !== undefined && projectId !== null) throw invalid('Global backups do not accept a project ID.');
    const parsed = schemas[entry.name].safeParse(operation.input ?? {}); if (!parsed.success) throw invalid('Invalid backup arguments.');
    validateExternalManifest(manifest); const input = parsed.data;
    if (entry.name === 'backup.media.stage') return await stage(repository, credential, manifest, rawKey, input);
    if (entry.name === 'backup.document.stage') return await stageDocument(repository, credential, manifest, rawKey, input);
    if (entry.name === 'backup.import') return await importBackup(repository, credential, manifest, rawKey, input, operation.input);
    const { sanitizeCloudDocument } = await validation();
    const documents = manifest.snapshot.documents.map(({ key, value }) => ({ key, value: sanitizeCloudDocument(key, value) }));
    if (entry.name === 'backup.manifest') {
      const media = manifest.snapshot.media.map(item => mediaMetadata(item)), offset = input.offset ?? 0, limit = input.limit ?? 100;
      const header = await createExternalBackupHeader(documents, media);
      return { result: { ...header, documents: documents.map(document => ({ key: document.key, length: document.value.length, byteLength: Buffer.byteLength(document.value), sha256: hash(Buffer.from(document.value)) })), media: media.slice(offset, offset + limit), totalMedia: media.length, offset, nextOffset: offset + limit < media.length ? offset + limit : null }, manifest };
    }
    if (entry.name === 'backup.document') {
      const document = documents.find(value => value.key === input.key); if (!document) throw new CloudError(404, 'backup_document_missing', 'The backup document was not found.');
      const offset = input.offset ?? 0, limit = input.limit ?? 1024 * 1024, value = document.value.slice(offset, offset + limit);
      return { result: { key: document.key, value, offset, total: document.value.length, nextOffset: offset + value.length < document.value.length ? offset + value.length : null, sha256: hash(Buffer.from(document.value)) }, manifest };
    }
    const metadata = manifest.snapshot.media.find(value => value.id === input.id); if (!metadata) throw new CloudError(404, 'backup_media_missing', 'The backup original was not found.');
    const bytes = await originalBytes(repository, credential, rawKey, mediaMetadata(metadata), manifest.files[input.id]);
    try { return { result: { metadata: mediaMetadata(metadata), base64: bytes.toString('base64') }, manifest }; } finally { bytes.fill(0); }
  } catch (error) {
    if (error instanceof CloudError) throw error;
    throw new CloudError(502, 'backup_unavailable', 'The global backup operation could not be completed.');
  }
}
