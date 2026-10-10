import type { CloudProvider } from '../runtime';
import { validateCipher, validateHeader, type CipherEnvelope, type VaultHeader, type VaultSession } from '../vault/crypto';

export const OFFLINE_DATABASE = 'dynamic-diary-offline';
const RECORDS = 'records', AUTHORIZATION = 'authorization', ACTIVE = 'active';
export interface OfflineAuthorization { version: 1; ownerId: string; email: string; header: VaultHeader; providers?: Partial<Record<CloudProvider, boolean>>; liveInkAvailable?: boolean }
interface OfflineRecord { version: 1; ownerId: string; vaultId: string; slot: string; fingerprint: string; cipher: CipherEnvelope }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\u0000-\u001f]/.test(value);
const physicalKey = (owner: string, vault: string, slot: string) => JSON.stringify([owner, vault, slot]);
function canonicalHeader(header: VaultHeader): string {
  const value = validateHeader(header), { kdf, password, recovery } = value;
  return JSON.stringify([value.format, value.version, value.id, kdf.name, kdf.hash, kdf.iterations, kdf.salt, password.v, password.iv, password.data, recovery.v, recovery.iv, recovery.data]);
}
async function storage<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = indexedDB.open(OFFLINE_DATABASE, 1); let abandoned = false;
      request.onupgradeneeded = () => { for (const name of [RECORDS, AUTHORIZATION]) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name); };
      request.onerror = () => reject(request.error);
      request.onblocked = () => { abandoned = true; reject(new Error('Armazenamento ocupado.')); };
      request.onsuccess = () => {
        const db = request.result;
        if (abandoned) { db.close(); return; }
        let transaction: IDBTransaction;
        try { transaction = db.transaction(storeName, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined); }
        catch (reason) { db.close(); reject(reason); return; }
        let value: T;
        transaction.oncomplete = () => { db.close(); resolve(value); };
        transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error); };
        try { const operation = action(transaction.objectStore(storeName)); operation.onsuccess = () => { value = operation.result; }; }
        catch (reason) { transaction.abort(); db.close(); reject(reason); }
      };
    });
  } catch { throw new Error('Não foi possível guardar ou ler a cópia offline neste aparelho. Verifique o armazenamento e o espaço disponível.'); }
}

/** Slots contain protocol names only. All application content is sealed before IDB receives it. */
export class OfflineRepository {
  private readonly ownerId: string;
  private readonly vaultId: string;
  private readonly header: string;
  private digest: Promise<string> | null = null;
  private chain: Promise<void> = Promise.resolve();
  constructor(private session: VaultSession) {
    if (!identifier(session.ownerId)) throw new Error('Conta offline inválida.');
    this.ownerId = session.ownerId; this.vaultId = session.header.id; this.header = canonicalHeader(session.header);
    this.available();
  }
  private available() {
    if (this.session.ownerId !== this.ownerId || canonicalHeader(this.session.header) !== this.header) throw new Error('O cofre desta sessão mudou. A cópia offline foi preservada.');
    this.session.deviceKeyForStorage();
  }
  private fingerprint(): Promise<string> {
    return this.digest ??= crypto.subtle.digest('SHA-256', new TextEncoder().encode(this.header)).then(bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join(''));
  }
  private key(slot: string) {
    if (!identifier(slot)) throw new Error('Slot offline inválido.');
    return physicalKey(this.ownerId, this.vaultId, slot);
  }
  private async decode(slot: string, value: unknown): Promise<string> {
    this.available();
    if (!object(value) || Object.keys(value).sort().join(',') !== 'cipher,fingerprint,ownerId,slot,vaultId,version' || value.version !== 1 || value.ownerId !== this.ownerId || value.vaultId !== this.vaultId || value.slot !== slot || value.fingerprint !== await this.fingerprint()) throw new Error('A cópia offline não corresponde a esta conta, cofre e conteúdo.');
    const sealed: unknown = JSON.parse(await this.session.openText(validateCipher(value.cipher), `offline:${slot}`));
    // Authenticate the header binding inside the cipher too: editable IDB
    // metadata must not transplant a slot to another header using the same key.
    if (!object(sealed) || Object.keys(sealed).sort().join(',') !== 'content,fingerprint' || sealed.fingerprint !== value.fingerprint || typeof sealed.content !== 'string') throw new Error('O vínculo cifrado da cópia offline é inválido.');
    this.available(); return sealed.content;
  }
  private mutate(task: () => Promise<void>): Promise<void> {
    const operation = this.chain.catch(() => {}).then(task); this.chain = operation; return operation;
  }
  /** Stop accepting mutations before awaiting this barrier and releasing the lease. */
  settled(): Promise<void> { return this.chain.catch(() => {}); }
  async read<T>(slot: string): Promise<T | null> {
    const key = this.key(slot); await this.chain.catch(() => {}); this.available();
    const value: unknown = await storage(RECORDS, 'readonly', store => store.get(key));
    this.available(); return value === undefined ? null : JSON.parse(await this.decode(slot, value)) as T;
  }
  write(slot: string, value: unknown): Promise<void> {
    const key = this.key(slot);
    // Serialize now so a caller cannot mutate its checkpoint during encryption.
    const text = JSON.stringify(value);
    if (text === undefined) return Promise.reject(new Error('Conteúdo offline inválido. Use um valor JSON.'));
    return this.mutate(async () => {
      this.available();
      const fingerprint = await this.fingerprint();
      const cipher = await this.session.seal(JSON.stringify({ fingerprint, content: text }), `offline:${slot}`); this.available();
      const record: OfflineRecord = { version: 1, ownerId: this.ownerId, vaultId: this.vaultId, slot, fingerprint, cipher };
      await storage(RECORDS, 'readwrite', store => store.put(record, key)); this.available();
      const saved: unknown = await storage(RECORDS, 'readonly', store => store.get(key));
      if (await this.decode(slot, saved) !== text || JSON.stringify((saved as OfflineRecord).cipher) !== JSON.stringify(cipher)) throw new Error('A gravação offline não foi confirmada. Preserve esta sessão.');
    });
  }
  remove(slot: string): Promise<void> {
    const key = this.key(slot);
    return this.mutate(async () => {
      this.available(); await storage(RECORDS, 'readwrite', store => store.delete(key));
      if (await storage(RECORDS, 'readonly', store => store.get(key)) !== undefined) throw new Error('A remoção offline não foi confirmada.');
      this.available();
    });
  }
}

function validateAuthorization(value: unknown): OfflineAuthorization {
  const fields = ['version', 'ownerId', 'email', 'header', 'providers', 'liveInkAvailable'];
  if (!object(value) || Object.keys(value).some(key => !fields.includes(key)) || value.version !== 1 || !identifier(value.ownerId) || typeof value.email !== 'string' || value.email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) throw new Error('Autorização offline inválida. Entre novamente com conexão.');
  const header = validateHeader(value.header);
  if (value.providers !== undefined && (!object(value.providers) || Object.entries(value.providers).some(([name, enabled]) => !['openai', 'openrouter', 'anthropic'].includes(name) || typeof enabled !== 'boolean'))) throw new Error('Capacidades offline inválidas.');
  if (value.liveInkAvailable !== undefined && typeof value.liveInkAvailable !== 'boolean') throw new Error('Capacidades offline inválidas.');
  return JSON.parse(JSON.stringify({ version: 1, ownerId: value.ownerId, email: value.email, header, ...(value.providers !== undefined ? { providers: value.providers } : {}), ...(value.liveInkAvailable !== undefined ? { liveInkAvailable: value.liveInkAvailable } : {}) })) as OfflineAuthorization;
}
export async function readOfflineAuthorization(): Promise<OfflineAuthorization | null> {
  const value: unknown = await storage(AUTHORIZATION, 'readonly', store => store.get(ACTIVE));
  return value === undefined ? null : validateAuthorization(value);
}
/** Only call after the authenticated owner, vault and initial encrypted checkpoints were confirmed. */
export async function authorizeOffline(record: OfflineAuthorization): Promise<void> {
  const checked = validateAuthorization(record);
  await storage(AUTHORIZATION, 'readwrite', store => store.put(checked, ACTIVE));
  if (JSON.stringify(await readOfflineAuthorization()) !== JSON.stringify(checked)) throw new Error('A autorização offline não foi confirmada.');
}
/** Revokes reopening only; pending encrypted checkpoints remain available for authenticated recovery. */
export async function revokeOfflineAuthorization(): Promise<void> {
  await storage(AUTHORIZATION, 'readwrite', store => store.delete(ACTIVE));
  if (await storage(AUTHORIZATION, 'readonly', store => store.get(ACTIVE)) !== undefined) throw new Error('A revogação offline não foi confirmada.');
}
export async function acquireOfflineLease(ownerId: string, vaultId: string): Promise<(() => void) | null> {
  if (!identifier(ownerId) || !identifier(vaultId)) return null;
  let locks: LockManager;
  try { if (typeof navigator === 'undefined' || !navigator.locks?.request) return null; locks = navigator.locks; }
  catch { return null; }
  return new Promise(resolve => {
    try {
      void locks.request(`dynamic-diary-offline:${JSON.stringify([ownerId, vaultId])}`, { mode: 'exclusive', ifAvailable: true }, lock => {
        if (!lock) { resolve(null); return; }
        return new Promise<void>(release => { let released = false; resolve(() => { if (!released) { released = true; release(); } }); });
      }).catch(() => resolve(null));
    } catch { resolve(null); }
  });
}
