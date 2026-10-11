import { CloudConflictError, CloudHttpError, CloudRuntime, cloudJson, decodeBytes, encodeBytes, mutationHeaders, sanitizeCloudDocument, sha256, type CloudSnapshot } from '../runtime';
import { type CipherEnvelope, type VaultHeader, type VaultSession, validateHeader, validateCipher } from './crypto';
import type { CheckpointStore } from '../offline/checkpoints';
export interface VaultTransportOptions { persistence?: CheckpointStore; networkReady?: () => boolean }
export interface VaultHead { header: VaultHeader; revision: number; manifest: CipherEnvelope }
interface PrivateFile { blobId: string; sha256: string; size: number }
interface Manifest { snapshot: CloudSnapshot; files: Record<string, PrivateFile> }
interface Pending { body: string; next: Manifest; manifest: CipherEnvelope; operationId: string; reply: unknown }
interface Receipt { response: string | null; bytes: number; pinned: boolean }
interface AuxiliaryRequest { method: 'POST' | 'DELETE'; path: string; body: string; fingerprint: string }
export interface VaultCheckpoint {
  version: 1; ownerId: string; vaultId: string; head: VaultHead;
  pending: { body: string; operationId: string; reply: unknown } | null;
  requests: [string, string][]; completed: [string, Receipt][];
  uploads: [string, { blobId: string; cipherBytes: string; cipherHash: string }][];
  auxiliary?: [string, AuxiliaryRequest][];
  rejected?: string[];
}
const RESPONSE_COUNT_LIMIT = 128, RESPONSE_BYTE_LIMIT = 512 * 1024;
const DURABLE_OPERATION_LIMIT = 1024, DURABLE_RECEIPT_BYTE_LIMIT = 2 * 1024 * 1024;
const DURABLE_AUXILIARY_BYTE_LIMIT = 32 * 1024 * 1024;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const requestFingerprint = (method: string, path: string, body: string) => sha256(new TextEncoder().encode(JSON.stringify([method.toUpperCase(), path, body])).buffer);
function auxiliaryRoute(method: string, path: string): boolean {
  if (method === 'POST') return ['/api/cloud/import', '/api/cloud/media'].includes(path);
  if (method !== 'DELETE' || typeof path !== 'string' || !path.startsWith('/api/cloud/media/')) return false;
  try { const id = decodeURIComponent(path.slice('/api/cloud/media/'.length)); return /^[A-Za-z0-9_.:-]{1,180}$/.test(id) && !['.', '..'].includes(id) && path === '/api/cloud/media/' + encodeURIComponent(id); }
  catch { return false; }
}
async function validateAuxiliary(id: string, value: unknown, fingerprint: string): Promise<AuxiliaryRequest> {
  const request = value as AuxiliaryRequest;
  if (!request || Object.keys(request).sort().join(',') !== 'body,fingerprint,method,path' || typeof request.body !== 'string' || !auxiliaryRoute(request.method, request.path) || request.fingerprint !== fingerprint || await requestFingerprint(request.method, request.path, request.body) !== fingerprint) throw new Error('Requisição privada de recuperação inválida.');
  const body = JSON.parse(request.body);
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.operationId !== id || !/^[A-Za-z0-9_.:-]{1,160}$/.test(id)) throw new Error('Identidade de recuperação inválida.');
  if (request.path === '/api/cloud/import') {
    if (!Array.isArray(body.documents) || body.documents.some((doc: any) => !doc || Object.keys(doc).sort().join(',') !== 'key,value') || Object.keys(body).some(key => !['documents', 'operationId', 'manifestHash'].includes(key)) || body.manifestHash !== undefined && (typeof body.manifestHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.manifestHash))) throw new Error('Importação de recuperação inválida.');
    const check = new CloudRuntime({ documents: body.documents.map((doc: any) => ({ ...doc, revision: 1 })), media: [] }); check.dispose();
  } else if (request.path === '/api/cloud/media') {
    if (typeof body.base64 !== 'string' || Object.keys(body).some(key => !['id', 'mime', 'name', 'projectId', 'createdAt', 'sha256', 'size', 'base64', 'operationId'].includes(key))) throw new Error('Arquivo de recuperação inválido.');
    const bytes = decodeBytes(body.base64), { base64: _base64, operationId: _operationId, ...metadata } = body;
    if (await sha256(bytes) !== body.sha256 || body.size !== undefined && body.size !== bytes.byteLength) throw new Error('Arquivo de recuperação corrompido.');
    const check = new CloudRuntime({ documents: [], media: [{ ...metadata, size: bytes.byteLength }] }); check.dispose();
  } else if (Object.keys(body).join(',') !== 'operationId' || ['.', '..'].includes(request.path.slice('/api/cloud/media/'.length))) throw new Error('Exclusão de recuperação inválida.');
  return { ...request };
}
function validateManifest(value: unknown): Manifest {
  const data = value as Manifest;
  if (!data || Object.keys(data).sort().join(',') !== 'files,snapshot' || !data.files || typeof data.files !== 'object' || Array.isArray(data.files)) throw new Error('Manifesto privado inválido.');
  const check = new CloudRuntime(data.snapshot); check.dispose();
  if (Object.keys(data.files).length !== data.snapshot.media.length || data.snapshot.media.some(media => {
    const item = Object.hasOwn(data.files, media.id) ? data.files[media.id] : null; return !item || Object.keys(item).sort().join(',') !== 'blobId,sha256,size' || !/^[a-f0-9-]{36}$/.test(item.blobId) || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > 15 * 1024 * 1024;
  })) throw new Error('Catálogo privado inválido.');
  return data;
}
/** Merge only disjoint document/file identities here. Document content belongs to the runtime. */
function rebaseManifest(base: Manifest, local: Manifest, remote: Manifest): Manifest | null {
  const mergeEntries = <T,>(before: Map<string, T>, changed: Map<string, T>, current: Map<string, T>) => {
    const result = new Map(current);
    for (const id of new Set([...before.keys(), ...changed.keys()])) {
      const old = before.get(id), next = changed.get(id), latest = current.get(id);
      if (JSON.stringify(old) === JSON.stringify(next)) continue;
      if (JSON.stringify(old) !== JSON.stringify(latest)) return null;
      if (next === undefined) result.delete(id); else result.set(id, next);
    }
    return result;
  };
  const documents = mergeEntries(new Map(base.snapshot.documents.map(d => [d.key, d])), new Map(local.snapshot.documents.map(d => [d.key, d])), new Map(remote.snapshot.documents.map(d => [d.key, d])));
  const media = mergeEntries(new Map(base.snapshot.media.map(d => [d.id, d])), new Map(local.snapshot.media.map(d => [d.id, d])), new Map(remote.snapshot.media.map(d => [d.id, d])));
  const files = mergeEntries(new Map(Object.entries(base.files)), new Map(Object.entries(local.files)), new Map(Object.entries(remote.files)));
  if (!documents || !media || !files) return null;
  return validateManifest({ snapshot: { documents: [...documents.values()], media: [...media.values()] }, files: Object.fromEntries(files) });
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
  private auxiliary = new Map<string, AuxiliaryRequest>();
  private remote: typeof fetch;
  private persistenceChain: Promise<void> = Promise.resolve();
  private recoveryRequired = false;
  private rejected = new Set<string>();
  private constructor(readonly session: VaultSession, private state: Manifest, private revision: number, remote: typeof fetch, private knownManifest: CipherEnvelope, private options: VaultTransportOptions = {}) {
    // Invoke native fetch as a function: using it as a transport method gives
    // browsers an invalid receiver. Preserve the injected request and its signal.
    this.remote = (input, init) => remote(input, init);
  }
  static async open(session: VaultSession, head: VaultHead, remote: typeof fetch = fetch, options: VaultTransportOptions = {}) {
    if (!head || !Number.isSafeInteger(head.revision) || head.revision < 1 || JSON.stringify(validateHeader(head.header)) !== JSON.stringify(session.header)) throw new Error('Cofre remoto inválido.');
    const manifest = validateCipher(head.manifest), state = validateManifest(JSON.parse(await session.openText(manifest, `manifest:${head.revision}`)));
    const transport = new VaultTransport(session, state, head.revision, remote, manifest, options);
    await transport.persistCheckpoint(); return transport;
  }
  static async restore(session: VaultSession, value: unknown, remote: typeof fetch = fetch, options: VaultTransportOptions = {}) {
    const data = value as VaultCheckpoint;
    if (!data || data.version !== 1 || data.ownerId !== session.ownerId || data.vaultId !== session.header.id || !Array.isArray(data.requests) || !Array.isArray(data.completed) || !Array.isArray(data.uploads) || data.auxiliary !== undefined && !Array.isArray(data.auxiliary) || data.requests.length > DURABLE_OPERATION_LIMIT || data.completed.length > DURABLE_OPERATION_LIMIT || data.uploads.length > DURABLE_OPERATION_LIMIT || (data.auxiliary?.length ?? 0) > DURABLE_OPERATION_LIMIT) throw new Error('Diário privado inválido.');
    const transport = await VaultTransport.open(session, data.head, remote);
    const validId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(id);
    for (const entry of data.requests) {
      if (!Array.isArray(entry) || entry.length !== 2 || !validId(entry[0]) || typeof entry[1] !== 'string' || !/^[a-f0-9]{64}$/.test(entry[1]) || transport.requests.has(entry[0])) throw new Error('Identidade de operação inválida.');
      transport.requests.set(entry[0], entry[1]);
    }
    let auxiliaryBytes = 0;
    for (const entry of data.auxiliary ?? []) {
      if (!Array.isArray(entry) || entry.length !== 2 || !transport.requests.has(entry[0]) || transport.auxiliary.has(entry[0])) throw new Error('Requisição privada duplicada ou inválida.');
      const descriptor = await validateAuxiliary(entry[0], entry[1], transport.requests.get(entry[0])!);
      auxiliaryBytes += new TextEncoder().encode(descriptor.body).byteLength;
      if (auxiliaryBytes > DURABLE_AUXILIARY_BYTE_LIMIT) throw new Error('Fila de arquivos excede o limite local.');
      transport.auxiliary.set(entry[0], descriptor);
    }
    let receiptBytes = 0;
    for (const entry of data.completed) {
      const receipt = entry?.[1];
      if (!Array.isArray(entry) || entry.length !== 2 || !transport.requests.has(entry[0]) || transport.completed.has(entry[0]) || !receipt || typeof receipt.pinned !== 'boolean' || receipt.response !== null && typeof receipt.response !== 'string' || receipt.bytes !== (receipt.response === null ? 0 : new TextEncoder().encode(receipt.response).byteLength)) throw new Error('Confirmação de operação inválida.');
      if (receipt.response !== null) JSON.parse(receipt.response);
      receiptBytes += receipt.bytes; transport.completed.set(entry[0], { ...receipt });
      if (!receipt.pinned && receipt.response !== null) transport.responses.set(entry[0], receipt.bytes);
    }
    if (receiptBytes > DURABLE_RECEIPT_BYTE_LIMIT) throw new Error('Diário privado excede o limite de confirmações.');
    transport.responseBytes = [...transport.responses.values()].reduce((sum, bytes) => sum + bytes, 0);
    for (const entry of data.uploads) {
      const upload = entry?.[1];
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !upload || !/^[a-f0-9-]{36}$/.test(upload.blobId) || typeof upload.cipherBytes !== 'string' || !/^[a-f0-9]{64}$/.test(upload.cipherHash) || transport.uploads.has(entry[0])) throw new Error('Upload local inválido.');
      const bytes = decodeBytes(upload.cipherBytes);
      if (bytes.byteLength > 15 * 1024 * 1024 || await sha256(bytes) !== upload.cipherHash) throw new Error('Upload local corrompido.');
      const cipher = validateCipher(JSON.parse(new TextDecoder().decode(bytes)));
      const descriptor = [...transport.auxiliary.values()].find(request => { const body = JSON.parse(request.body); return request.path === '/api/cloud/media' && `${body.id}:${body.sha256}` === entry[0]; });
      if (descriptor) { const body = JSON.parse(descriptor.body); if (await sha256(await session.openBytes(cipher, `media:${upload.blobId}`)) !== body.sha256) throw new Error('Upload não corresponde à requisição original.'); }
      transport.uploads.set(entry[0], { ...upload, cipherBytes: bytes });
    }
    if (data.pending !== null) {
      const pending = data.pending, body = JSON.parse(pending.body);
      if (!validId(pending.operationId) || !validId(body.operationId) || !transport.requests.has(pending.operationId) || transport.completed.has(pending.operationId) || body.baseRevision !== transport.revision || Object.keys(body).sort().join(',') !== 'baseRevision,manifest,operationId') throw new Error('Gravação privada pendente inválida.');
      const manifest = validateCipher(body.manifest), next = validateManifest(JSON.parse(await session.openText(manifest, `manifest:${transport.revision + 1}`)));
      transport.pending = { ...pending, manifest, next };
    }
    if (data.rejected !== undefined) {
      if (!Array.isArray(data.rejected) || data.rejected.length > DURABLE_OPERATION_LIMIT || new Set(data.rejected).size !== data.rejected.length || data.rejected.some(id => !validId(id) || !transport.requests.has(id) || transport.completed.has(id) || transport.pending?.operationId === id)) throw new Error('Rejeições privadas inválidas.');
      transport.rejected = new Set(data.rejected);
    }
    transport.recoveryRequired = transport.pending !== null || transport.uploads.size > 0 || transport.auxiliary.size > 0;
    transport.options = options; return transport;
  }
  head(): VaultHead { this.available(); return clone({ header: this.session.header, revision: this.revision, manifest: this.knownManifest }); }
  checkpoint(): VaultCheckpoint {
    this.available();
    return { version: 1, ownerId: this.session.ownerId, vaultId: this.session.header.id, head: this.head(), pending: this.pending ? { body: this.pending.body, operationId: this.pending.operationId, reply: clone(this.pending.reply) } : null, requests: [...this.requests], completed: [...this.completed].map(([id, receipt]) => [id, { ...receipt }]), uploads: [...this.uploads].map(([key, upload]) => [key, { ...upload, cipherBytes: encodeBytes(upload.cipherBytes) }]), auxiliary: [...this.auxiliary].map(([id, request]) => [id, { ...request }]), ...(this.rejected.size ? { rejected: [...this.rejected] } : {}) };
  }
  persistCheckpoint(): Promise<void> {
    if (!this.options.persistence) return Promise.resolve();
    const value = this.checkpoint();
    const task = this.persistenceChain.catch(() => {}).then(async () => { this.available(); await this.options.persistence!.write('transport', value); this.available(); });
    this.persistenceChain = task; return task;
  }
  hasPendingOperations(): boolean { this.available(); return !!this.pending || !!this.requests.size || !!this.completed.size || !!this.uploads.size || !!this.auxiliary.size; }
  /** Call only after validating the durable runtime journal under its exclusive writer lease. */
  reconcileOperations(operationIds: readonly string[]): Promise<void> {
    const task = this.chain.catch(() => {}).then(async () => {
      this.available();
      if (!Array.isArray(operationIds) || operationIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(id)) || new Set(operationIds).size !== operationIds.length) throw new Error('Fila de recuperação inválida.');
      const active = new Set(operationIds);
      const mediaKeys = new Set([...this.auxiliary.values()].filter(request => request.path === '/api/cloud/media').map(request => { const body = JSON.parse(request.body); return `${body.id}:${body.sha256}`; }));
      if (this.pending && !active.has(this.pending.operationId) && !this.auxiliary.has(this.pending.operationId) || [...this.uploads.keys()].some(key => !mediaKeys.has(key))) { this.recoveryRequired = true; throw new Error('Existe uma gravação privada pendente sem fila de recuperação. Preserve a cópia local.'); }
      const completed = new Map(this.completed), requests = new Map(this.requests), responses = new Map(this.responses), responseBytes = this.responseBytes, rejected = new Set(this.rejected);
      let changed = false;
      for (const id of this.requests.keys()) if (!active.has(id) && !this.auxiliary.has(id)) {
        this.completed.delete(id); this.requests.delete(id); this.rejected.delete(id);
        const bytes = this.responses.get(id); if (bytes !== undefined) { this.responses.delete(id); this.responseBytes -= bytes; }
        changed = true;
      }
      try { if (changed) await this.persistCheckpoint(); this.recoveryRequired = false; }
      catch (reason) { this.completed = completed; this.requests = requests; this.responses = responses; this.responseBytes = responseBytes; this.rejected = rejected; throw reason; }
    });
    this.chain = task; return task;
  }
  /** Replays previously authorized auxiliary requests only after the owner/header gate opens. */
  recoverAuxiliaryOperations(): Promise<string[]> {
    const task = this.chain.catch(() => {}).then(async () => {
      this.requireNetwork(); if (this.recoveryRequired) throw new Error('A fila privada precisa de reconciliação antes da recuperação.');
      const ids = [...this.auxiliary.keys()];
      for (const id of ids) { const request = this.auxiliary.get(id)!; await this.perform(request.path, { method: request.method, body: request.body }, true); }
      return ids;
    });
    this.chain = task; return task;
  }
  acknowledgeOperation(operationId: string): Promise<void> {
    const task = this.chain.catch(() => {}).then(async () => {
      this.available();
      if (!this.options.persistence || !this.requests.has(operationId)) return;
      if (!this.completed.has(operationId)) throw new Error('A operação ainda não foi confirmada.');
      const checkpoint = this.checkpoint(), descriptor = this.auxiliary.get(operationId);
      this.completed.delete(operationId); this.requests.delete(operationId);
      this.auxiliary.delete(operationId);
      const bytes = this.responses.get(operationId); if (bytes !== undefined) { this.responses.delete(operationId); this.responseBytes -= bytes; }
      try { await this.persistCheckpoint(); }
      catch (reason) { if (descriptor) this.auxiliary.set(operationId, descriptor); const receipt = checkpoint.completed.find(([id]) => id === operationId); if (receipt) { this.completed.set(...receipt); if (!receipt[1].pinned && receipt[1].response !== null) { this.responses.set(operationId, receipt[1].bytes); this.responseBytes += receipt[1].bytes; } } const request = checkpoint.requests.find(([id]) => id === operationId); if (request) this.requests.set(...request); throw reason; }
    });
    this.chain = task; return task;
  }
  /** Remove a definitely rejected identity only after its replacement queue is durable. */
  discardRejectedOperation(operationId: string): Promise<void> {
    const task = this.chain.catch(() => {}).then(async () => {
      this.available();
      if (!this.requests.has(operationId)) return;
      if (!this.rejected.has(operationId) || this.pending?.operationId === operationId || this.completed.has(operationId) || this.auxiliary.has(operationId)) throw new Error('Não é possível descartar uma gravação sem rejeição confirmada.');
      const request = this.requests.get(operationId)!;
      this.requests.delete(operationId); this.rejected.delete(operationId);
      try { await this.persistCheckpoint(); }
      catch (reason) { this.requests.set(operationId, request); this.rejected.add(operationId); throw reason; }
    });
    this.chain = task; return task;
  }
  private requireNetwork() { this.available(); if (this.options.networkReady?.() === false) throw new Error('Esta operação precisa de conexão e conta confirmada.'); }
  snapshot(): CloudSnapshot { this.available(); return clone(this.state.snapshot); }
  /** Read/decrypt the canonical head, serialized with writes; never settle an ambiguous write here. */
  refreshSnapshot(): Promise<CloudSnapshot> {
    const task = this.chain.catch(() => {}).then(async () => {
      this.requireNetwork(); if (this.pending) throw new Error('Existe uma gravação privada pendente. Preserve o rascunho e tente novamente.');
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
        await this.persistCheckpoint();
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
    this.completed.set(operationId, receipt); this.rejected.delete(operationId);
    if (!pinned) this.cacheResponse(operationId, receipt);
  }
  private async replay(operationId: string) {
    const receipt = this.completed.get(operationId)!;
    if (receipt.response === null) throw new CloudConflictError();
    const response = receipt.response;
    // A previous ACK checkpoint may have failed even though its reply is in memory.
    await this.persistCheckpoint();
    // A commit recovered by another request keeps its reply until its original caller retries.
    if (receipt.pinned && !this.options.persistence) { receipt.pinned = false; this.cacheResponse(operationId, receipt); }
    return new Response(response, { headers: { 'Content-Type': 'application/json' } });
  }
  private async settle(deliverTo?: string) {
    if (!this.pending) return;
    if (this.recoveryRequired) throw new Error('A gravação privada pendente precisa de recuperação da fila local.');
    let op = this.pending;
    let reply: { revision: number };
    for (let attempt = 0; ; attempt++) {
      this.requireNetwork(); await this.persistCheckpoint(); this.requireNetwork();
      try {
        reply = await cloudJson<{ revision: number }>('/api/cloud/vault', { method: 'PUT', headers: mutationHeaders, body: op.body }, this.remote);
        break;
      } catch (reason) {
        // A lost reply remains the identical durable ciphertext/operation. Only
        // the server's explicit CAS rejection permits preparing a new wire ID.
        if (!(reason instanceof CloudHttpError) || reason.status !== 409 || reason.code !== 'vault_revision_conflict') throw reason;
        const head = await cloudJson<VaultHead>('/api/cloud/vault', {}, this.remote); this.available();
        if (!head || !Number.isSafeInteger(head.revision) || head.revision <= this.revision || JSON.stringify(validateHeader(head.header)) !== JSON.stringify(this.session.header)) throw new CloudConflictError();
        const cipher = validateCipher(head.manifest);
        const remote = validateManifest(JSON.parse(await this.session.openText(cipher, `manifest:${head.revision}`))); this.available();
        for (const old of this.state.snapshot.documents) {
          const current = remote.snapshot.documents.find(doc => doc.key === old.key);
          if (!current || current.revision < old.revision || current.revision === old.revision && current.value !== old.value) throw new CloudConflictError();
        }
        const next = rebaseManifest(this.state, op.next, remote);
        if (!next || attempt >= 3) {
          // No remote write was accepted. Let the runtime merge the original
          // document base against this authenticated head, keeping its draft.
          this.state = remote; this.revision = head.revision; this.knownManifest = cipher;
          this.pending = null; this.rejected.add(op.operationId);
          await this.persistCheckpoint();
          throw new CloudHttpError(409, 'As alterações remotas precisam ser conciliadas.', 'revision_conflict');
        }
        const manifest = await this.session.seal(JSON.stringify(next), `manifest:${head.revision + 1}`); this.available();
        const rebased: Pending = { ...op, next, manifest, body: JSON.stringify({ manifest, baseRevision: head.revision, operationId: crypto.randomUUID() }) };
        this.state = remote; this.revision = head.revision; this.knownManifest = cipher; this.pending = op = rebased;
        // The new head, ciphertext and wire identity are one durable checkpoint
        // before any retry. Runtime's logical request identity stays immutable.
      }
    }
    this.available(); if (reply.revision !== this.revision + 1) throw new Error('Revisão do cofre inválida.');
    this.state = op.next; this.revision = reply.revision; this.knownManifest = op.manifest; this.rememberReply(op.operationId, op.reply, !!this.options.persistence || op.operationId !== deliverTo); this.pending = null;
    for (const [key, upload] of this.uploads) if (Object.values(this.state.files).some(file => file.blobId === upload.blobId)) this.uploads.delete(key);
    await this.persistCheckpoint();
  }
  private async commit(next: Manifest, operationId: string, reply: unknown) {
    validateManifest(next);
    if (this.options.persistence && [...this.completed.values()].reduce((sum, receipt) => sum + receipt.bytes, 0) + new TextEncoder().encode(JSON.stringify(reply)).byteLength > DURABLE_RECEIPT_BYTE_LIMIT) throw new Error('Confirme as operações pendentes antes de continuar.');
    const manifest = await this.session.seal(JSON.stringify(next), `manifest:${this.revision + 1}`); this.available();
    this.pending = { body: JSON.stringify({ manifest, baseRevision: this.revision, operationId }), next, manifest, operationId, reply };
    await this.settle(operationId); return Response.json(reply);
  }
  private rememberAuxiliary(operationId: string, request: AuxiliaryRequest | null) {
    if (!request || !this.options.persistence) return;
    const bytes = new TextEncoder().encode(request.body).byteLength + [...this.auxiliary].reduce((sum, [id, item]) => sum + (id === operationId ? 0 : new TextEncoder().encode(item.body).byteLength), 0);
    if (bytes > DURABLE_AUXILIARY_BYTE_LIMIT) throw new Error('Conclua os arquivos pendentes antes de enviar outros.');
    this.auxiliary.set(operationId, request);
  }
  fetch: typeof fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input);
    if (!path.startsWith('/api/cloud/') || path.startsWith('/api/cloud/config') || path.startsWith('/api/cloud/vault')) { if (!['GET', 'HEAD'].includes((init.method ?? 'GET').toUpperCase())) this.requireNetwork(); return this.remote(input, init); }
    const task = this.chain.catch(() => {}).then(() => this.perform(path, init));
    this.chain = task; return task;
  }) as typeof fetch;
  private async perform(path: string, init: RequestInit, recovering = false): Promise<Response> {
      this.available();
      if (path === '/api/cloud/snapshot' && (!init.method || init.method === 'GET')) return Response.json(this.snapshot());
      if (path.startsWith('/api/cloud/media/') && (!init.method || init.method === 'GET')) {
        const id = decodeURIComponent(path.slice('/api/cloud/media/'.length)), item = this.state.files[id]; if (!item) return Response.json({}, { status: 404 });
        const cached = await this.options.persistence?.read<{ bytes: string }>('media:' + item.blobId);
        let bytes: ArrayBuffer;
        if (cached) { if (typeof cached.bytes !== 'string') throw new Error('Arquivo local inválido.'); bytes = decodeBytes(cached.bytes); }
        else { this.requireNetwork(); const response = await this.remote(`/api/cloud/vault/blobs/${item.blobId}`, { credentials: 'same-origin', cache: 'no-store' }); if (!response.ok) return response; bytes = await response.arrayBuffer(); }
        if (bytes.byteLength !== item.size || await sha256(bytes) !== item.sha256) throw new Error('Arquivo criptografado corrompido.');
        const data = JSON.parse(new TextDecoder().decode(bytes));
        const plain = await this.session.openBytes(data, `media:${item.blobId}`); this.available();
        const metadata = this.state.snapshot.media.find(media => media.id === id)!;
        if (plain.byteLength !== metadata.size || await sha256(plain) !== metadata.sha256) throw new Error('Arquivo privado inválido.');
        if (!cached) await this.options.persistence?.write('media:' + item.blobId, { bytes: encodeBytes(bytes) });
        return new Response(plain);
      }
      this.requireNetwork();
      if (this.recoveryRequired) throw new Error('A gravação privada pendente precisa de recuperação da fila local.');
      const body = JSON.parse(String(init.body));
      if (!body || typeof body.operationId !== 'string') throw new Error('Operação inválida.');
      if (!recovering) for (const [id, descriptor] of this.auxiliary) if (id !== body.operationId && !this.completed.has(id)) await this.perform(descriptor.path, { method: descriptor.method, body: descriptor.body }, true);
      await this.settle(); this.requireNetwork();
      const method = (init.method ?? 'GET').toUpperCase(), request = await requestFingerprint(method, path, String(init.body)), prior = this.requests.get(body.operationId);
      this.available();
      if (prior !== undefined && prior !== request) throw new CloudConflictError();
      if (this.options.persistence && prior === undefined && this.requests.size >= DURABLE_OPERATION_LIMIT) throw new Error('Confirme as operações pendentes antes de continuar.');
      this.requests.set(body.operationId, request);
      if (this.completed.has(body.operationId)) return this.replay(body.operationId);
      const descriptor = this.options.persistence && auxiliaryRoute(method, path) ? await validateAuxiliary(body.operationId, { method, path, body: String(init.body), fingerprint: request }, request) : null;
      const next = clone(this.state);
      if (path.startsWith('/api/cloud/documents/') && init.method === 'PUT') {
        const key = decodeURIComponent(path.slice('/api/cloud/documents/'.length)), old = next.snapshot.documents.find(doc => doc.key === key);
        if ((old?.revision ?? 0) !== body.baseRevision) {
          this.rejected.add(body.operationId); await this.persistCheckpoint();
          return Response.json({ error: 'revision_conflict' }, { status: 409 });
        }
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
        this.rememberAuxiliary(body.operationId, descriptor);
        return this.commit(next, body.operationId, { documents: body.documents.map((doc: { key: string }) => next.snapshot.documents.find(item => item.key === doc.key)) });
      }
      if (path === '/api/cloud/media' && init.method === 'POST') {
        const bytes = decodeBytes(body.base64), hash = await sha256(bytes), old = next.snapshot.media.find(media => media.id === body.id);
        if (hash !== body.sha256) throw new Error('Integridade do arquivo inválida.');
        const { base64: _base64, operationId: _operation, ...metadata } = body; metadata.size = bytes.byteLength;
        if (old) {
          if (['id', 'mime', 'name', 'sha256', 'size', 'projectId', 'createdAt'].some(field => (old as unknown as Record<string, unknown>)[field] !== metadata[field])) throw new CloudConflictError();
          const reply = { id: old.id, sha256: old.sha256, size: old.size };
          // Another device may already have registered the identical logical
          // media. The unused encrypted upload is not part of the canonical head.
          this.uploads.delete(`${body.id}:${hash}`);
          if (this.options.persistence) { this.rememberAuxiliary(body.operationId, descriptor); this.rememberReply(body.operationId, reply, true); await this.persistCheckpoint(); }
          return Response.json(reply);
        }
        this.rememberAuxiliary(body.operationId, descriptor);
        const uploadKey = `${body.id}:${hash}`;
        let upload = this.uploads.get(uploadKey);
        if (!upload) {
          const blobId = crypto.randomUUID(), encrypted = await this.session.seal(bytes, `media:${blobId}`);
          const cipherBytes = new TextEncoder().encode(JSON.stringify(encrypted)).buffer;
          upload = { blobId, cipherBytes, cipherHash: await sha256(cipherBytes) }; this.uploads.set(uploadKey, upload);
        }
        const { blobId, cipherBytes, cipherHash } = upload;
        await this.persistCheckpoint(); this.requireNetwork();
        const result = await cloudJson<{ id: string; sha256: string; size: number }>('/api/cloud/vault/blobs', { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ id: blobId, sha256: cipherHash, base64: encodeBytes(cipherBytes) }) }, this.remote);
        if (result.id !== blobId || result.sha256 !== cipherHash || result.size !== cipherBytes.byteLength) throw new Error('Upload privado não confirmado.');
        const readback = await this.remote(`/api/cloud/vault/blobs/${blobId}`, { credentials: 'same-origin', cache: 'no-store' });
        if (!readback.ok) throw new Error('Não foi possível conferir o upload privado.');
        const confirmed = await readback.arrayBuffer(); if (await sha256(confirmed) !== cipherHash) throw new Error('Upload privado corrompido.');
        if (await sha256(await this.session.openBytes(JSON.parse(new TextDecoder().decode(confirmed)), `media:${blobId}`)) !== hash) throw new Error('Arquivo privado inválido.');
        await this.options.persistence?.write('media:' + blobId, { bytes: encodeBytes(confirmed) });
        next.snapshot.media.push(metadata); next.files[body.id] = { blobId, sha256: cipherHash, size: cipherBytes.byteLength };
        return this.commit(next, body.operationId, { id: body.id, sha256: hash, size: bytes.byteLength });
      }
      if (path.startsWith('/api/cloud/media/') && init.method === 'DELETE') {
        const id = decodeURIComponent(path.slice('/api/cloud/media/'.length)); next.snapshot.media = next.snapshot.media.filter(item => item.id !== id); delete next.files[id];
        this.rememberAuxiliary(body.operationId, descriptor);
        return this.commit(next, body.operationId, { deleted: true });
      }
      throw new Error('Operação privada não suportada.');
  }
  async flush() { await this.chain.catch(() => {}); await this.settle(); }
  dispose() { this.disposed = true; this.session.dispose(); this.state = { snapshot: { documents: [], media: [] }, files: {} }; this.knownManifest = { v: 1, iv: '', data: '' }; this.pending = null; this.completed.clear(); this.requests.clear(); this.responses.clear(); this.responseBytes = 0; this.uploads.clear(); this.auxiliary.clear(); }
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


