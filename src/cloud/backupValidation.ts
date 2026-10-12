import { validatePersistedNoteCanvases } from '@/workspace/noteCanvasPersistence';
import { validatePersistedBoards } from '@/boards/model';
import { CLOUD_DOCUMENT_KEYS, sanitizeCloudDocument } from './documentContract';

export { CLOUD_DOCUMENT_KEYS, sanitizeCloudDocument } from './documentContract';
export interface MigrationBackup {
  format: 'cellproject-global-backup'; version: 1; exportedAt: string; operationId: string; manifestHash: string;
  documents: { key: string; value: string }[];
  media: { id: string; mime: string; name: string; projectId?: string; createdAt?: number; sha256: string; size: number; base64: string }[];
}
export const MAX_BACKUP_BYTES = 500 * 1024 * 1024;
async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
function decodeBytes(value: string): Uint8Array {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Arquivo inválido no backup.');
  const decoded = atob(value);
  return Uint8Array.from(decoded, char => char.charCodeAt(0));
}
export async function backupManifestHash(backup: Pick<MigrationBackup, 'documents' | 'media'>) {
  const documents = [...backup.documents].sort((a, b) => a.key.localeCompare(b.key));
  const media = [...backup.media].sort((a, b) => a.id.localeCompare(b.id)).map(({ base64: _bytes, ...metadata }) => metadata);
  return sha256(new TextEncoder().encode(JSON.stringify({ documents, media })));
}
/** Portable archive validation. The server can stream originals one at a time from authenticated encrypted descriptors. */
export async function validateBackup(value: unknown, options: { readMedia?: (file: MigrationBackup['media'][number]) => Promise<Uint8Array> } = {}): Promise<MigrationBackup> {
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
        validatePersistedNoteCanvases(workspace.notes); validatePersistedBoards(workspace.boards, workspace.notes);
      }
    }
    if (sanitizeCloudDocument(doc.key, doc.value) !== doc.value) throw new Error('Backup contém configuração de credencial.');
  }
  for (const file of backup.media) {
    if (!file || !/^[A-Za-z0-9_.:-]{1,180}$/.test(file.id) || ['.', '..'].includes(file.id) || ids.has(file.id) || typeof file.base64 !== 'string' || file.base64.length > 14 * 1024 * 1024 || typeof file.mime !== 'string' || typeof file.name !== 'string') throw new Error('Arquivo inválido no backup.');
    ids.add(file.id);
    const bytes = options.readMedia ? await options.readMedia(file) : decodeBytes(file.base64);
    try {
      total += bytes.byteLength;
      if (!bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024 || total > MAX_BACKUP_BYTES || bytes.byteLength !== file.size || await sha256(bytes) !== file.sha256) throw new Error('Falha de integridade do arquivo no backup.');
    } finally { bytes.fill(0); }
  }
  if (await backupManifestHash(backup) !== backup.manifestHash) throw new Error('Falha de integridade do manifesto.');
  return backup;
}
