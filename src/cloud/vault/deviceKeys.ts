import { sessionFromDeviceKey, validateCipher, validateHeader, type CipherEnvelope, type VaultHeader, type VaultSession } from './crypto';
import type { PreparedVaultActivation } from './transport';

export const DEVICE_VAULT_DATABASE = 'dynamic-diary-vault-keys';
const STORE = 'keys', PROBE = 'dynamic-diary-device-key-v1';
interface DeviceRecord {
  version: 1; ownerId: string; vaultId: string; header: VaultHeader; fingerprint: string;
  key: CryptoKey; probe: CipherEnvelope; recovery: CipherEnvelope | null; activation: PreparedVaultActivation | null;
}
const recordId = (owner: string, vault: string) => JSON.stringify(['vault', owner, vault]);
const pendingId = (owner: string) => JSON.stringify(['prepared', owner]);
async function storage<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = indexedDB.open(DEVICE_VAULT_DATABASE, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
      request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('Armazenamento ocupado.'));
      request.onsuccess = () => {
        const db = request.result; let value: T;
        try {
          const transaction = db.transaction(STORE, mode);
          transaction.oncomplete = () => { db.close(); resolve(value); };
          transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error); };
          action(transaction.objectStore(STORE), next => { value = next; });
        } catch (reason) { db.close(); reject(reason); }
      };
    });
  } catch { throw new Error('Não foi possível guardar ou ler a chave neste navegador. Verifique o armazenamento permitido.'); }
}
const read = <T,>(id: string) => storage<T | undefined>('readonly', (store, result) => { const request = store.get(id); request.onsuccess = () => result(request.result); });
async function fingerprint(header: VaultHeader) {
  const value = validateHeader(header), { kdf, password, recovery } = value;
  const canonical = JSON.stringify([value.format, value.version, value.id, kdf.name, kdf.hash, kdf.iterations, kdf.salt, password.v, password.iv, password.data, recovery.v, recovery.iv, recovery.data]);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function restore(ownerId: string, header: VaultHeader, value: DeviceRecord) {
  if (!value || value.version !== 1 || value.ownerId !== ownerId || value.vaultId !== header.id || value.fingerprint !== await fingerprint(header) || value.fingerprint !== await fingerprint(value.header)) throw new Error('A chave deste navegador não corresponde a este cofre. Use sua recuperação ou frase original.');
  const session = sessionFromDeviceKey(ownerId, header, value.key);
  try {
    if (await session.openText(validateCipher(value.probe, 128), 'device-key-probe') !== PROBE) throw new Error('Chave inválida.');
    return session;
  } catch { session.dispose(); throw new Error('Não foi possível usar a chave deste navegador. Use sua recuperação ou frase original.'); }
}
/** Call only after the authenticated account has been verified by CloudBootstrap. */
export async function readDeviceVault(ownerId: string, header: VaultHeader): Promise<VaultSession | null> {
  validateHeader(header); if (!ownerId) throw new Error('Conta inválida.');
  const value = await read<DeviceRecord>(recordId(ownerId, header.id));
  return value ? restore(ownerId, header, value) : null;
}
export async function readPreparedDeviceVault(ownerId: string): Promise<{ session: VaultSession; activation: PreparedVaultActivation } | null> {
  if (!ownerId) throw new Error('Conta inválida.');
  const id = await read<string>(pendingId(ownerId)); if (!id) return null;
  const value = await read<DeviceRecord>(id);
  if (!value?.activation || id !== recordId(ownerId, value.vaultId)) throw new Error('A preparação deste navegador está incompleta. Nenhum dado remoto foi alterado.');
  return { session: await restore(ownerId, value.header, value), activation: value.activation };
}
/** Readback + authenticated probe are required before any remote activation is allowed. */
export async function rememberDeviceVault(session: VaultSession, options: { recoveryKey?: string; activation?: PreparedVaultActivation } = {}) {
  const id = recordId(session.ownerId, session.header.id), previous = await read<DeviceRecord>(id);
  if (previous && previous.fingerprint !== await fingerprint(session.header)) throw new Error('Já existe outra chave para este cofre neste navegador.');
  const record: DeviceRecord = {
    version: 1, ownerId: session.ownerId, vaultId: session.header.id, header: session.header, fingerprint: await fingerprint(session.header),
    key: session.deviceKeyForStorage(), probe: await session.seal(PROBE, 'device-key-probe'),
    recovery: options.recoveryKey ? await session.seal(options.recoveryKey, 'device-recovery') : previous?.recovery ?? null,
    activation: options.activation ?? previous?.activation ?? null,
  };
  await storage<void>('readwrite', store => { store.put(record, id); if (record.activation) store.put(id, pendingId(session.ownerId)); });
  const saved = await read<DeviceRecord>(id); if (!saved) throw new Error('A chave não foi confirmada neste navegador. Nenhum dado remoto foi alterado.');
  const tested = await restore(session.ownerId, session.header, saved);
  try {
    if (JSON.stringify(saved.activation) !== JSON.stringify(record.activation) || options.recoveryKey && (!saved.recovery || await tested.openText(saved.recovery, 'device-recovery') !== options.recoveryKey)) throw new Error('A recuperação não foi confirmada neste navegador.');
  } finally { tested.dispose(); }
}
export async function completeDeviceActivation(session: VaultSession) {
  const id = recordId(session.ownerId, session.header.id), value = await read<DeviceRecord>(id); if (!value) throw new Error('A chave deste navegador não está disponível.');
  await storage<void>('readwrite', store => {
    store.put({ ...value, activation: null }, id);
    const request = store.get(pendingId(session.ownerId)); request.onsuccess = () => { if (request.result === id) store.delete(pendingId(session.ownerId)); };
  });
}
export async function readDeviceRecovery(session: VaultSession): Promise<string | null> {
  const value = await read<DeviceRecord>(recordId(session.ownerId, session.header.id)); if (!value) return null;
  const tested = await restore(session.ownerId, session.header, value); tested.dispose();
  return value.recovery ? session.openText(validateCipher(value.recovery, 256), 'device-recovery') : null;
}
export async function downloadDeviceRecovery(session: VaultSession) {
  const recovery = await readDeviceRecovery(session);
  session.deviceKeyForStorage();
  if (!recovery) throw new Error('Este cofre usa sua frase ou chave de recuperação original. Nenhuma nova chave foi criada.');
  const url = URL.createObjectURL(new Blob([`Dynamic Diary — chave de recuperação\nConta: ${session.ownerId}\nCofre: ${session.header.id}\n\n${recovery}\n\nGuarde fora do navegador. Quem possui esta chave pode abrir o cofre.\n`], { type: 'text/plain' }));
  const link = document.createElement('a'); link.href = url; link.download = 'dynamic-diary-chave-recuperacao.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
