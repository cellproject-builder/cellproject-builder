import type { VaultSession } from './crypto';
import { validateHeader, validateCipher } from './crypto';
let active: VaultSession | null = null;
let aiApproved = false;
let protectedMode = false;
export function configureVault(session: VaultSession | null, protectedStorage = protectedMode || session !== null) { active = session; protectedMode = protectedStorage; aiApproved = false; }
export const vaultIsProtected = () => protectedMode;
export const getVaultSession = () => active;
/** Storage secrecy does not conceal context deliberately sent to online AI/search. */
export function authorizeVaultSharing(input: RequestInfo | URL, init?: RequestInit) {
  if (!protectedMode) return;
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method !== 'POST' || !(url.pathname.startsWith('/api/ai/') || url.pathname.startsWith('/api/visuals/'))) return;
  if (!active) throw new Error('Cofre bloqueado. Desbloqueie antes de compartilhar contexto.');
  if (aiApproved) return;
  if (!window.confirm('Seu cofre protege o armazenamento. Para usar IA, busca ou TypeSafe, o contexto necessário (incluindo textos e anexos selecionados) será enviado ao servidor Dynamic Diary e aos provedores. Permitir nesta sessão desbloqueada?')) throw new Error('Compartilhamento com IA não autorizado. Seu cofre continua privado.');
  aiApproved = true;
}
const CHUNK = 16 * 1024 * 1024, EXPORT_LIMIT = 600 * 1024 * 1024;
export async function encryptedExport(bytes: ArrayBuffer, kind: 'backup' | 'rescue'): Promise<Blob> {
  const session = active;
  if (!session) throw new Error('Cofre bloqueado. Desbloqueie antes de exportar.');
  if (bytes.byteLength > EXPORT_LIMIT) throw new Error('Backup excede o limite criptografado de 600 MB.');
  const count = Math.max(1, Math.ceil(bytes.byteLength / CHUNK)), chunks = [], exportId = crypto.randomUUID();
  for (let index = 0; index < count; index++) chunks.push(await session.seal(bytes.slice(index * CHUNK, (index + 1) * CHUNK), `export:${exportId}:${kind}:${index}:${count}`));
  if (active !== session) throw new Error('Cofre bloqueado.');
  return new Blob([JSON.stringify({ format: 'dynamic-diary-encrypted-export', version: 1, exportId, kind, ownerId: session.ownerId, header: session.header, chunks })], { type: 'application/json' });
}
export async function decryptExport(bytes: ArrayBuffer, kind: 'backup'): Promise<ArrayBuffer> {
  const value = JSON.parse(new TextDecoder().decode(bytes)), session = active;
  if (!session || value?.format !== 'dynamic-diary-encrypted-export' || value.version !== 1 || typeof value.exportId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.exportId) || value.kind !== kind || value.ownerId !== session.ownerId || validateHeader(value.header).id !== session.header.id) throw new Error('Desbloqueie o cofre original deste backup.');
  if (!Array.isArray(value.chunks) || value.chunks.length < 1 || value.chunks.length > Math.ceil(EXPORT_LIMIT / CHUNK)) throw new Error('Backup criptografado inválido.');
  const parts: Uint8Array<ArrayBuffer>[] = []; let total = 0;
  for (const [index, chunk] of value.chunks.entries()) {
    const data = new Uint8Array(await session.openBytes(validateCipher(chunk, CHUNK + 16), `export:${value.exportId}:${kind}:${index}:${value.chunks.length}`));
    total += data.byteLength; if (total > EXPORT_LIMIT || index < value.chunks.length - 1 && data.byteLength !== CHUNK) throw new Error('Backup criptografado inválido.'); parts.push(data);
  }
  if (active !== session) throw new Error('Cofre bloqueado.');
  const plain = new Uint8Array(total); let offset = 0; for (const part of parts) { plain.set(part, offset); offset += part.length; part.fill(0); } return plain.buffer;
}

