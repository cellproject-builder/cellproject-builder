import { CloudConflictError, CloudRuntime, cloudJson, decodeBytes, encodeBytes, mutationHeaders, sanitizeCloudDocument, sha256, type CloudSnapshot } from '../runtime';
import { type CipherEnvelope, type VaultHeader, type VaultSession, validateHeader, validateCipher } from './crypto';
export interface VaultHead { header: VaultHeader; revision: number; manifest: CipherEnvelope }
interface PrivateFile { blobId: string; sha256: string; size: number }
interface Manifest { snapshot: CloudSnapshot; files: Record<string, PrivateFile> }
interface Pending { body: string; next: Manifest; manifest: CipherEnvelope; operationId: string; reply: unknown }
interface Receipt { response: string | null; bytes: number; pinned: boolean }
const RESPONSE_COUNT_LIMIT = 128, RESPONSE_BYTE_LIMIT = 512 * 1024;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function validateManifest(value: unknown): Manifest {
  const data = value as Manifest;
  if (!data || Object.keys(data).sort().join(',') !== 'files,snapshot' || !data.files || typeof data.files !== 'object' || Array.isArray(data.files)) throw new Error('Manifesto privado inválido.');
  const check = new CloudRuntime(data.snapshot); check.dispose();
  if (Object.keys(data.files).length !== data.snapshot.media.length || data.snapshot.media.some(media => {
    const item = Object.hasOwn(data.files, media.id) ? data.files[media.id] : null; return !item || Object.keys(item).sort().join(',') !== 'blobId,sha256,size' || !/^[a-f0-9-]{36}$/.test(item.blobId) || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > 15 * 1024 * 1024;
  })) throw new Error('Catálogo privado inválido.');
  return data;
}
/** Compatibility transport: existing stores see plaintext in memory, network sees ciphertext only. */
export class VaultTransport {
  private chain: Promise<unknown> = Promise.resolve();
  private pending: Pending | null = null;
  private completed = new Map<string, Receipt>();
  private requests = new Map<string, string>();
  private responses = new Map<string, number>();
  private responseBytes = 0;
  private disposed = false;
  private uploads = new Map<string, { blobId: string; cipherBytes: ArrayBuffer; cipherHash: string }>();
  private constructor(readonly session: VaultSession, private state: Manifest, private revision: number, private remote: typeof fetch, private knownManifest: CipherEnvelope) {}
  static async open(session: VaultSession, head: VaultHead, remote: typeof fetch = fetch) {
    if (!head || !Number.isSafeInteger(head.revision) || head.revision < 1 || JSON.stringify(validateHeader(head.header)) !== JSON.stringify(session.header)) throw new Error('Cofre remoto inválido.');
    const manifest = validateCipher(head.manifest), state = validateManifest(JSON.parse(await session.openText(manifest, `manifest:${head.revision}`)));
    return new VaultTransport(session, state, head.revision, remote, manifest);
  }
  snapshot(): CloudSnapshot { this.available(); return clone(this.state.snapshot); }
  /** Read/decrypt the canonical head, serialized with writes; never settle an ambiguous write here. */
  refreshSnapshot(): Promise<CloudSnapshot> {
    const task = this.chain.catch(() => {}).then(async () => {
      this.available(); if (this.pending) throw new Error('Existe uma gravação privada pendente. Preserve o rascunho e tente novamente.');
      const head = await cloudJson<VaultHead>('/api/cloud/vault', {}, this.remote); this.available();
      if (!head || !Number.isSafeInteger(head.revision) || head.revision < this.revision || JSON.stringify(validateHeader(head.header)) !== JSON.stringify(this.session.header)) throw new Error('Revisão do cofre inválida.');
      const manifest = validateCipher(head.manifest);
      if (head.revision === this.revision) {
        // This exact ciphertext was already authenticated when opened/committed.
        // Comparing it avoids parsing/decrypting a potentially large manifest every tick.
        if (manifest.iv !== this.knownManifest.iv || manifest.data !== this.knownManifest.data) throw new CloudConflictError();
      } else {
        const next = validateManifest(JSON.parse(await this.session.openText(manifest, `manifest:${head.revision}`))); this.available();
        for (const old of this.state.snapshot.documents) {
          const document = next.snapshot.documents.find(item => item.key === old.key);
          if (!document || document.revision < old.revision || document.revision === old.revision && document.value !== old.value) throw new CloudConflictError();
        }
        this.state = next; this.revision = head.revision; this.knownManifest = manifest;
      }
      return this.snapshot();
    });
    this.chain = task; return task;
  }
  private available() { if (this.disposed) throw new Error('Cofre bloqueado.'); }
  private cacheResponse(operationId: string, receipt: Receipt) {
    this.responses.set(operationId, receipt.bytes); this.responseBytes += receipt.bytes;
    while (this.responses.size > RESPONSE_COUNT_LIMIT || this.responseBytes > RESPONSE_BYTE_LIMIT) {
      const oldest = this.responses.keys().next().value!;
      this.responseBytes -= this.responses.get(oldest)!; this.responses.delete(oldest);
      // Keep the fingerprint/tombstone: replay must not generate fresh ciphertext for an old ID.
      const expired = this.completed.get(oldest)!; expired.response = null; expired.bytes = 0;
    }
  }
  private rememberReply(operationId: string, reply: unknown, pinned: boolean) {
    const response = JSON.stringify(reply), receipt = { response, bytes: new TextEncoder().encode(response).byteLength, pinned };
    this.completed.set(operationId, receipt);
    if (!pinned) this.cacheResponse(operationId, receipt);
  }
  private replay(operationId: string) {
    const receipt = this.completed.get(operationId)!;
    if (receipt.response === null) throw new CloudConflictError();
    const response = receipt.response;
    // A commit recovered by another request keeps its reply until its original caller retries.
    if (receipt.pinned) { receipt.pinned = false; this.cacheResponse(operationId, receipt); }
    return new Response(response, { headers: { 'Content-Type': 'application/json' } });
  }
  private async settle(deliverTo?: string) {
    if (!this.pending) return;
    const op = this.pending;
    const reply = await cloudJson<{ revision: number }>('/api/cloud/vault', { method: 'PUT', headers: mutationHeaders, body: op.body }, this.remote);
    this.available(); if (reply.revision !== this.revision + 1) throw new Error('Revisão do cofre inválida.');
    this.state = op.next; this.revision = reply.revision; this.knownManifest = op.manifest; this.rememberReply(op.operationId, op.reply, op.operationId !== deliverTo); this.pending = null;
    for (const [key, upload] of this.uploads) if (Object.values(this.state.files).some(file => file.blobId === upload.blobId)) this.uploads.delete(key);
  }
  private async commit(next: Manifest, operationId: string, reply: unknown) {
    validateManifest(next);
    const manifest = await this.session.seal(JSON.stringify(next), `manifest:${this.revision + 1}`); this.available();
    this.pending = { body: JSON.stringify({ manifest, baseRevision: this.revision, operationId }), next, manifest, operationId, reply };
    await this.settle(operationId); return Response.json(reply);
  }
  fetch: typeof fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input);
    if (!path.startsWith('/api/cloud/') || path.startsWith('/api/cloud/config') || path.startsWith('/api/cloud/vault')) return this.remote(input, init);
    const task = this.chain.catch(() => {}).then(async () => {
      this.available(); await this.settle(); this.available();
      if (path === '/api/cloud/snapshot' && (!init.method || init.method === 'GET')) return Response.json(this.snapshot());
      if (path.startsWith('/api/cloud/media/') && (!init.method || init.method === 'GET')) {
        const id = decodeURIComponent(path.slice('/api/cloud/media/'.length)), item = this.state.files[id]; if (!item) return Response.json({}, { status: 404 });
        const response = await this.remote(`/api/cloud/vault/blobs/${item.blobId}`, { credentials: 'same-origin', cache: 'no-store' }); if (!response.ok) return response;
        const bytes = await response.arrayBuffer(); if (bytes.byteLength !== item.size || await sha256(bytes) !== item.sha256) throw new Error('Arquivo criptografado corrompido.');
        const data = JSON.parse(new TextDecoder().decode(bytes));
        const plain = await this.session.openBytes(data, `media:${item.blobId}`); this.available(); return new Response(plain);
      }
      const body = JSON.parse(String(init.body));
      if (!body || typeof body.operationId !== 'string') throw new Error('Operação inválida.');
      const request = await sha256(new TextEncoder().encode(JSON.stringify([(init.method ?? 'GET').toUpperCase(), path, String(init.body)])).buffer), prior = this.requests.get(body.operationId);
      this.available();
      if (prior !== undefined && prior !== request) throw new CloudConflictError();
      this.requests.set(body.operationId, request);
      if (this.completed.has(body.operationId)) return this.replay(body.operationId);
      const next = clone(this.state);
      if (path.startsWith('/api/cloud/documents/') && init.method === 'PUT') {
        const key = decodeURIComponent(path.slice('/api/cloud/documents/'.length)), old = next.snapshot.documents.find(doc => doc.key === key);
        if ((old?.revision ?? 0) !== body.baseRevision) return Response.json({}, { status: 409 });
        const item = { key, value: sanitizeCloudDocument(key, body.value), revision: body.baseRevision + 1 };
        next.snapshot.documents = next.snapshot.documents.filter(doc => doc.key !== key).concat(item);
        return this.commit(next, body.operationId, { revision: item.revision });
      }
      if (path === '/api/cloud/import' && init.method === 'POST') {
        for (const doc of body.documents) {
          const old = next.snapshot.documents.find(item => item.key === doc.key);
          if (old && old.value !== doc.value) throw new CloudConflictError();
          if (!old) next.snapshot.documents.push({ key: doc.key, value: sanitizeCloudDocument(doc.key, doc.value), revision: 1 });
        }
        return this.commit(next, body.operationId, { documents: body.documents.map((doc: { key: string }) => next.snapshot.documents.find(item => item.key === doc.key)) });
      }
      if (path === '/api/cloud/media' && init.method === 'POST') {
        const bytes = decodeBytes(body.base64), hash = await sha256(bytes), old = next.snapshot.media.find(media => media.id === body.id);
        if (hash !== body.sha256) throw new Error('Integridade do arquivo inválida.');
        const { base64: _base64, operationId: _operation, ...metadata } = body; metadata.size = bytes.byteLength;
        if (old) {
          if (['id', 'mime', 'name', 'sha256', 'size', 'projectId', 'createdAt'].some(field => (old as unknown as Record<string, unknown>)[field] !== metadata[field])) throw new CloudConflictError();
          return Response.json({ id: old.id, sha256: old.sha256, size: old.size });
        }
        const uploadKey = `${body.id}:${hash}`;
        let upload = this.uploads.get(uploadKey);
        if (!upload) {
          const blobId = crypto.randomUUID(), encrypted = await this.session.seal(bytes, `media:${blobId}`);
          const cipherBytes = new TextEncoder().encode(JSON.stringify(encrypted)).buffer;
          upload = { blobId, cipherBytes, cipherHash: await sha256(cipherBytes) }; this.uploads.set(uploadKey, upload);
        }
        const { blobId, cipherBytes, cipherHash } = upload;
        const result = await cloudJson<{ id: string; sha256: string; size: number }>('/api/cloud/vault/blobs', { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ id: blobId, sha256: cipherHash, base64: encodeBytes(cipherBytes) }) }, this.remote);
        if (result.id !== blobId || result.sha256 !== cipherHash || result.size !== cipherBytes.byteLength) throw new Error('Upload privado não confirmado.');
        const readback = await this.remote(`/api/cloud/vault/blobs/${blobId}`, { credentials: 'same-origin', cache: 'no-store' });
        if (!readback.ok) throw new Error('Não foi possível conferir o upload privado.');
        const confirmed = await readback.arrayBuffer(); if (await sha256(confirmed) !== cipherHash) throw new Error('Upload privado corrompido.');
        if (await sha256(await this.session.openBytes(JSON.parse(new TextDecoder().decode(confirmed)), `media:${blobId}`)) !== hash) throw new Error('Arquivo privado inválido.');
        next.snapshot.media.push(metadata); next.files[body.id] = { blobId, sha256: cipherHash, size: cipherBytes.byteLength };
        return this.commit(next, body.operationId, { id: body.id, sha256: hash, size: bytes.byteLength });
      }
      if (path.startsWith('/api/cloud/media/') && init.method === 'DELETE') {
        const id = decodeURIComponent(path.slice('/api/cloud/media/'.length)); next.snapshot.media = next.snapshot.media.filter(item => item.id !== id); delete next.files[id];
        return this.commit(next, body.operationId, { deleted: true });
      }
      throw new Error('Operação privada não suportada.');
    });
    this.chain = task; return task;
  }) as typeof fetch;
  async flush() { await this.chain.catch(() => {}); await this.settle(); }
  dispose() { this.disposed = true; this.session.dispose(); this.state = { snapshot: { documents: [], media: [] }, files: {} }; this.knownManifest = { v: 1, iv: '', data: '' }; this.pending = null; this.completed.clear(); this.requests.clear(); this.responses.clear(); this.responseBytes = 0; this.uploads.clear(); }
}
export interface PreparedVaultActivation { body: string; head: VaultHead; snapshotFingerprint: string }
const activations = new WeakMap<VaultSession, PreparedVaultActivation>();
const snapshotFingerprint = (snapshot: CloudSnapshot) => sha256(new TextEncoder().encode(JSON.stringify({ documents: [...snapshot.documents].sort((a, b) => a.key.localeCompare(b.key)), media: snapshot.media })).buffer);
export async function prepareVaultActivation(session: VaultSession, snapshot: CloudSnapshot, restored?: PreparedVaultActivation): Promise<PreparedVaultActivation> {
  session.deviceKeyForStorage();
  const check = new CloudRuntime(snapshot); check.dispose();
  if (snapshot.media.length) throw new Error('A ativação com arquivos antigos exige migração assistida. O conteúdo atual foi preservado.');
  const fingerprint = await snapshotFingerprint(snapshot);
  let activation = activations.get(session) ?? restored;
  if (activation && activation.snapshotFingerprint !== fingerprint) throw new Error('O conteúdo remoto mudou. A preparação deste navegador foi preservada.');
  if (restored) {
    const body = JSON.parse(restored.body);
    if (JSON.stringify(validateHeader(body.header)) !== JSON.stringify(session.header) || JSON.stringify(validateHeader(restored.head.header)) !== JSON.stringify(session.header) || JSON.stringify(body.manifest) !== JSON.stringify(restored.head.manifest) || restored.head.revision !== 1 || typeof body.operationId !== 'string' || JSON.stringify([...body.expectedDocuments].sort((a, b) => a.key.localeCompare(b.key))) !== JSON.stringify(snapshot.documents.map(({ key, revision }) => ({ key, revision })).sort((a, b) => a.key.localeCompare(b.key)))) throw new Error('Preparação local inválida.');
    const plain = validateManifest(JSON.parse(await session.openText(validateCipher(body.manifest), 'manifest:1')));
    if (await snapshotFingerprint(plain.snapshot) !== fingerprint) throw new Error('Preparação local inválida.');
  }
  const manifest = activation?.head.manifest ?? await session.seal(JSON.stringify({ snapshot, files: {} }), 'manifest:1');
  const body = activation?.body ?? JSON.stringify({ header: session.header, manifest, expectedDocuments: snapshot.documents.map(({ key, revision }) => ({ key, revision })), operationId: crypto.randomUUID() });
  if (!activation) activation = { body, head: { header: session.header, manifest, revision: 1 }, snapshotFingerprint: fingerprint };
  session.deviceKeyForStorage(); activations.set(session, activation); return activation;
}
export async function activateVault(session: VaultSession, snapshot: CloudSnapshot, remote: typeof fetch = fetch, restored?: PreparedVaultActivation): Promise<VaultHead> {
  const activation = await prepareVaultActivation(session, snapshot, restored);
  session.deviceKeyForStorage();
  const reply = await cloudJson<{ revision: number }>('/api/cloud/vault/activate', { method: 'POST', headers: mutationHeaders, body: activation.body }, remote);
  session.deviceKeyForStorage();
  if (reply.revision !== 1) throw new Error('Ativação do cofre não confirmada.'); return activation.head;
}


