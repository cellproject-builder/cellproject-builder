import { decryptExport, encryptedExport, getVaultSession, vaultIsProtected } from './vault/privacy';
import { get, entries, createStore } from 'idb-keyval';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { validatePersistedNoteCanvases } from '@/workspace/noteCanvasPersistence';
import { validatePersistedBoards } from '@/boards/model';
import { CLOUD_DOCUMENT_KEYS, CloudConflictError, CloudRuntime, cloudJson, decodeBytes, encodeBytes, mutationHeaders, sanitizeCloudDocument, sha256, type CloudSnapshot } from './runtime';

interface LegacyMedia { id: string; mime: string; name: string; projectId?: string; createdAt?: number; bytes: ArrayBuffer }
export interface MigrationBackup {
  format: 'cellproject-global-backup'; version: 1; exportedAt: string; operationId: string; manifestHash: string;
  documents: { key: string; value: string }[];
  media: { id: string; mime: string; name: string; projectId?: string; createdAt?: number; sha256: string; size: number; base64: string }[];
}
interface LegacySource { getDocument: (key: string) => Promise<string | null>; getPreference: (key: string) => string | null; getMedia: () => Promise<LegacyMedia[]> }
const MAX_BYTES = 500 * 1024 * 1024;
const defaultSource: LegacySource = {
  getDocument: async key => (await get<string>(key)) ?? null,
  getPreference: key => localStorage.getItem(key),
  getMedia: async () => (await entries<string, Omit<LegacyMedia, 'id'>>(createStore('cellproject-visual-media', 'media'))).map(([id, value]) => ({ ...value, id })),
};
async function manifestHash(backup: Pick<MigrationBackup, 'documents' | 'media'>) {
  const documents = [...backup.documents].sort((a, b) => a.key.localeCompare(b.key));
  const media = [...backup.media].sort((a, b) => a.id.localeCompare(b.id)).map(({ base64: _bytes, ...metadata }) => metadata);
  return sha256(strToU8(JSON.stringify({ documents, media })).buffer as ArrayBuffer);
}
export async function captureLegacyBackup(source: LegacySource = defaultSource, prepare?: () => Promise<void>): Promise<MigrationBackup> {
  await prepare?.();
  const documents: MigrationBackup['documents'] = [];
  for (const [index, key] of CLOUD_DOCUMENT_KEYS.entries()) {
    const value = index < 6 ? await source.getDocument(key) : source.getPreference(key);
    if (value !== null) { if (typeof value !== 'string') throw new Error('Persistência local inválida.'); documents.push({ key, value: sanitizeCloudDocument(key, value) }); }
  }
  const media: MigrationBackup['media'] = [];
  for (const { bytes, ...metadata } of await source.getMedia()) media.push({ ...metadata, sha256: await sha256(bytes), size: bytes.byteLength, base64: encodeBytes(bytes) });
  const backup: MigrationBackup = { format: 'cellproject-global-backup', version: 1, exportedAt: new Date().toISOString(), operationId: crypto.randomUUID(), manifestHash: '', documents, media };
  backup.manifestHash = await manifestHash(backup); await validateBackup(backup); return backup;
}
export async function validateBackup(value: unknown): Promise<MigrationBackup> {
  const backup = value as MigrationBackup;
  if (!backup || backup.format !== 'cellproject-global-backup' || backup.version !== 1 || !Array.isArray(backup.documents) || !Array.isArray(backup.media) || typeof backup.manifestHash !== 'string' || typeof backup.operationId !== 'string' || backup.documents.length > 9 || backup.media.length > 10000) throw new Error('Backup global inválido.');
  const keys = new Set<string>(), ids = new Set<string>(); let total = 0;
  for (const doc of backup.documents) {
    if (!doc || typeof doc.value !== 'string' || keys.has(doc.key) || !CLOUD_DOCUMENT_KEYS.includes(doc.key as typeof CLOUD_DOCUMENT_KEYS[number])) throw new Error('Documento duplicado ou inválido.');
    keys.add(doc.key);
    if (doc.key.startsWith('cellproject-') || doc.key === 'dynamic_diary-chat') {
      const envelope = JSON.parse(doc.value) as { state?: unknown; version?: unknown };
      if (!envelope || !envelope.state || typeof envelope.state !== 'object' || !Number.isInteger(envelope.version)) throw new Error('Envelope de persistência inválido.');
      if (doc.key === 'cellproject-workspace') {
        const workspace = envelope.state as { notes?: unknown; boards?: unknown };
        validatePersistedNoteCanvases(workspace.notes);
        validatePersistedBoards(workspace.boards, workspace.notes);
      }
    }
    if (sanitizeCloudDocument(doc.key, doc.value) !== doc.value) throw new Error('Backup contém configuração de credencial.');
  }
  for (const file of backup.media) {
    if (!file || !/^[\w-]{1,100}$/.test(file.id) || ids.has(file.id) || typeof file.base64 !== 'string' || file.base64.length > 14 * 1024 * 1024 || typeof file.mime !== 'string' || typeof file.name !== 'string') throw new Error('Arquivo inválido no backup.');
    ids.add(file.id); const bytes = decodeBytes(file.base64); total += bytes.byteLength;
    if (!bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024 || total > MAX_BYTES || bytes.byteLength !== file.size || await sha256(bytes) !== file.sha256) throw new Error('Falha de integridade do arquivo no backup.');
  }
  if (await manifestHash(backup) !== backup.manifestHash) throw new Error('Falha de integridade do manifesto.');
  return backup;
}
export async function backupBlob(backup: MigrationBackup): Promise<Blob> {
  await validateBackup(backup);
  const files: Record<string, Uint8Array> = {};
  files['manifest.json'] = strToU8(JSON.stringify({ ...backup, media: backup.media.map(({ base64: _bytes, ...metadata }) => metadata) }));
  for (const file of backup.media) files[`media/${file.id}`] = new Uint8Array(decodeBytes(file.base64));
  const bytes = zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>;
  return vaultIsProtected() ? encryptedExport(bytes.buffer, 'backup') : new Blob([bytes], { type: 'application/zip' });
}
export async function readBackup(blob: Blob): Promise<MigrationBackup> {
  if (blob.size > 850 * 1024 * 1024) throw new Error('Backup muito grande.');
  let bytes = typeof blob.arrayBuffer === 'function' ? await blob.arrayBuffer() : await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
  if (new Uint8Array(bytes)[0] === 123) bytes = await decryptExport(bytes, 'backup');
  let unpackedBytes = 0;
  const files = unzipSync(new Uint8Array(bytes), { filter: item => { unpackedBytes += item.originalSize; if (unpackedBytes > MAX_BYTES + 64 * 1024 * 1024 || (item.name !== 'manifest.json' && !/^media\/[\w-]{1,100}$/.test(item.name))) throw new Error('Estrutura do backup inválida.'); return true; } });
  if (!files['manifest.json']) throw new Error('Manifesto ausente.');
  const backup = JSON.parse(strFromU8(files['manifest.json'])) as MigrationBackup;
  if (!Array.isArray(backup.media)) throw new Error('Manifesto inválido.');
  for (const file of backup.media) { const bytes = files[`media/${file.id}`]; if (!bytes) throw new Error('Arquivo ausente no backup.'); file.base64 = encodeBytes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer); }
  if (Object.keys(files).length !== backup.media.length + 1) throw new Error('Arquivos sem referência no backup.');
  return validateBackup(backup);
}
export async function importBackup(backup: MigrationBackup, fetcher: typeof fetch = fetch, progress: (message: string) => void = () => {}): Promise<CloudSnapshot> {
  await validateBackup(backup);
  progress('Conferindo dados existentes antes do envio…');
  const before = await cloudJson<CloudSnapshot>('/api/cloud/snapshot', {}, fetcher);
  const validation = new CloudRuntime(before, fetcher); validation.dispose();
  for (const document of backup.documents) {
    const existing = before.documents.find(item => item.key === document.key);
    if (existing && existing.value !== document.value) throw new CloudConflictError();
  }
  for (const file of backup.media) {
    const existing = before.media.find(item => item.id === file.id);
    if (existing && (existing.sha256 !== file.sha256 || existing.size !== file.size || existing.mime !== file.mime || existing.name !== file.name || existing.projectId !== file.projectId || existing.createdAt !== file.createdAt)) throw new CloudConflictError();
  }
  for (const file of backup.media) {
    progress(`Enviando ${file.name}…`);
    const { size: _size, ...upload } = file;
    const result = await cloudJson<{ id: string; sha256: string; size: number }>('/api/cloud/media', { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ ...upload, operationId: crypto.randomUUID() }) }, fetcher);
    if (result.id !== file.id || result.sha256 !== file.sha256 || result.size !== file.size) throw new Error('Falha na conferência do upload.');
  }
  progress('Importando documentos sem sobrescrever dados divergentes…');
  if (backup.documents.length) await cloudJson('/api/cloud/import', { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ documents: backup.documents, manifestHash: backup.manifestHash, operationId: backup.operationId }) }, fetcher);
  progress('Conferindo documentos e arquivos remotos…');
  const snapshot = await cloudJson<CloudSnapshot>('/api/cloud/snapshot', {}, fetcher);
  for (const document of backup.documents) if (snapshot.documents.find(item => item.key === document.key)?.value !== document.value) throw new Error('Falha na conferência dos documentos importados.');
  for (const file of backup.media) {
    const remote = snapshot.media.find(item => item.id === file.id);
    if (!remote || remote.sha256 !== file.sha256 || remote.size !== file.size || remote.mime !== file.mime || remote.name !== file.name || remote.projectId !== file.projectId || remote.createdAt !== file.createdAt) throw new Error('Falha na conferência do catálogo de arquivos.');
    const response = await fetcher(`/api/cloud/media/${encodeURIComponent(file.id)}`, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('Falha na conferência dos arquivos remotos.');
    const bytes = await response.arrayBuffer(); if (bytes.byteLength !== file.size || await sha256(bytes) !== file.sha256) throw new Error('Falha na conferência dos bytes remotos.');
  }
  return snapshot;
}
export async function downloadBackup(backup: MigrationBackup) {
  const url = URL.createObjectURL(await backupBlob(backup)); const link = document.createElement('a');
  link.href = url; link.download = `dynamic-diary-backup-${backup.exportedAt.slice(0, 10)}${getVaultSession() ? '.ddvault' : '.zip'}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
