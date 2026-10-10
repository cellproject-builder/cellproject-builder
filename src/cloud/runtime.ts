import { authorizeVaultSharing, configureVault } from './vault/privacy';
export const CLOUD_DOCUMENT_KEYS = ['cellproject-workspace', 'cellproject-graph', 'dynamic_diary-chat', 'cellproject-kb', 'cellproject-config', 'cellproject-locale', 'dynamic_diary-theme', 'dynamic_diary-sidebar-collapsed', 'dynamic_diary:task-view'] as const;
export type CloudProvider = 'openrouter' | 'openai' | 'anthropic';
export interface CloudDocument { key: string; value: string; revision: number }
export interface CloudMedia { id: string; mime: string; name: string; projectId?: string; createdAt?: number; sha256: string; size: number }
export interface CloudSnapshot { documents: CloudDocument[]; media: CloudMedia[] }
export interface CloudConfig { enabled: boolean; authenticated: boolean; authMethod?: 'email_link' | 'code'; passwordAuth?: boolean; passwordSetup?: boolean; vaultAvailable?: boolean; user?: { id: string; email: string }; providers?: Partial<Record<CloudProvider, boolean>> }
export interface CloudIssue { kind: 'conflict' | 'network' | 'session'; key: string; message: string }
export interface CloudStatus { pending: number; issue: CloudIssue | null; saving: boolean }
type Operation = { key: string; value: string; operationId: string; baseRevision?: number };
export class CloudConflictError extends Error { constructor() { super('Há um conflito remoto. Seu rascunho foi preservado.'); } }
export class CloudHttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export const mutationHeaders = { 'Content-Type': 'application/json', 'X-Cellproject-Request': '1' };
export async function cloudJson<T>(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await sessionAwareFetch(path, { ...init, credentials: 'same-origin', cache: 'no-store' }, fetcher);
  if (!response.ok) throw new CloudHttpError(response.status, response.status === 409 ? 'Conflito de revisão no servidor.' : response.status === 401 || response.status === 403 ? 'Sessão expirada ou acesso recusado.' : `Não foi possível salvar na nuvem (${response.status}).`);
  return await response.json() as T;
}
export function sanitizeCloudDocument(key: string, value: string): string {
  if (!CLOUD_DOCUMENT_KEYS.includes(key as typeof CLOUD_DOCUMENT_KEYS[number])) throw new Error('Documento de persistência desconhecido.');
  if (key !== 'cellproject-config') return value;
  const data = JSON.parse(value) as { state?: { providers?: Record<string, Record<string, unknown>> } };
  for (const config of Object.values(data.state?.providers ?? {})) delete config.apiKey;
  return JSON.stringify(data);
}

/** Cloud is canonical; drafts and retry operations live in memory only. No browser credential or data writes. */
export class CloudRuntime {
  private confirmed = new Map<string, CloudDocument>();
  private drafts = new Map<string, string>();
  private queue: Operation[] = [];
  private active: Promise<void> | null = null;
  private disposed = false;
  private listeners = new Set<() => void>();
  private status: CloudStatus = { pending: 0, issue: null, saving: false };
  private mediaMetadata = new Map<string, CloudMedia>();
  private mediaBytes = new Map<string, ArrayBuffer>();
  constructor(snapshot: CloudSnapshot, private fetcher: typeof fetch = fetch, private vaultDisposer?: () => void) {
    if (!snapshot || !Array.isArray(snapshot.documents) || !Array.isArray(snapshot.media)) throw new Error('Snapshot remoto inválido.');
    for (const doc of snapshot.documents) {
      if (!CLOUD_DOCUMENT_KEYS.includes(doc.key as typeof CLOUD_DOCUMENT_KEYS[number]) || typeof doc.value !== 'string' || !Number.isSafeInteger(doc.revision) || doc.revision < 1 || this.confirmed.has(doc.key)) throw new Error('Snapshot remoto inválido.');
      if (CLOUD_DOCUMENT_KEYS.slice(0, 6).includes(doc.key as typeof CLOUD_DOCUMENT_KEYS[number])) {
        let envelope; try { envelope = JSON.parse(doc.value); } catch { throw new Error('Envelope remoto inválido.'); }
        if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || !envelope.state || typeof envelope.state !== 'object' || Array.isArray(envelope.state) || !Number.isSafeInteger(envelope.version) || envelope.version < 0) throw new Error('Envelope remoto inválido.');
      }
      this.confirmed.set(doc.key, { ...doc, value: sanitizeCloudDocument(doc.key, doc.value) });
    }
    for (const media of snapshot.media) {
      if (!media || typeof media.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,180}$/.test(media.id) || ['.', '..'].includes(media.id) || this.mediaMetadata.has(media.id) || !['application/pdf', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg', 'image/webp'].includes(media.mime) || typeof media.name !== 'string' || !/^[a-f0-9]{64}$/.test(media.sha256) || !Number.isSafeInteger(media.size) || media.size < 1 || media.size > 10 * 1024 * 1024 || (media.mime.startsWith('image/') && media.size > 5 * 1024 * 1024)) throw new Error('Catálogo remoto inválido.');
      this.mediaMetadata.set(media.id, media);
    }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.status;
  notifySessionExpired(key: string) { if (!this.disposed && this.status.issue?.kind !== 'conflict') this.publish({ issue: { kind: 'session', key, message: 'Sessão expirada ou acesso recusado. Preserve uma cópia antes de entrar novamente.' } }); }
  private publish(patch: Partial<CloudStatus> = {}) { this.status = { ...this.status, ...patch, pending: this.queue.length }; for (const listener of this.listeners) listener(); }
  get(key: string): string | null { return this.drafts.get(key) ?? this.confirmed.get(key)?.value ?? null; }
  documents(): CloudDocument[] { return [...new Set([...this.confirmed.keys(), ...this.drafts.keys()])].map(key => ({ key, value: this.get(key)!, revision: this.confirmed.get(key)?.revision ?? 0 })); }
  write(key: string, raw: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const value = sanitizeCloudDocument(key, raw);
    if (this.get(key) === value) return Promise.resolve();
    this.drafts.set(key, value);
    // A request that may have reached the server keeps its original body and id.
    // Adjacent drafts that have never been sent can share one latest snapshot.
    const previous = this.queue.at(-1);
    if (previous?.key === key && previous.baseRevision === undefined) previous.value = value;
    else this.queue.push({ key, value, operationId: crypto.randomUUID() });
    this.publish();
    return this.drain();
  }
  private drain(): Promise<void> {
    if (this.active) return this.active;
    if (this.disposed || this.status.issue || !this.queue.length) return Promise.resolve();
    this.active = (async () => {
      this.publish({ saving: true });
      while (this.queue.length && !this.disposed) {
        const op = this.queue[0]; op.baseRevision ??= this.confirmed.get(op.key)?.revision ?? 0;
        try {
          const result = await cloudJson<{ revision: number }>(`/api/cloud/documents/${encodeURIComponent(op.key)}`, { method: 'PUT', headers: mutationHeaders, body: JSON.stringify({ value: op.value, baseRevision: op.baseRevision, operationId: op.operationId }) }, this.fetcher);
          if (this.disposed) return;
          if (!Number.isSafeInteger(result.revision) || result.revision < 1) throw new Error('Revisão inválida.');
          this.confirmed.set(op.key, { key: op.key, value: op.value, revision: result.revision }); this.queue.shift();
          if (!this.queue.some(item => item.key === op.key)) this.drafts.delete(op.key);
          this.publish();
        } catch (reason) {
          const status = reason instanceof CloudHttpError ? reason.status : 0;
          this.publish({ issue: { key: op.key, kind: status === 409 ? 'conflict' : status === 401 || status === 403 ? 'session' : 'network', message: reason instanceof Error ? reason.message : 'Falha de conexão.' } });
          break;
        }
      }
    })().finally(() => {
      this.active = null; this.publish({ saving: false });
      if (this.queue.length && !this.status.issue && !this.disposed) void this.drain();
    });
    return this.active;
  }
  async flush() { do { await this.drain(); } while (this.queue.length && !this.status.issue && !this.disposed); if (this.status.issue?.kind === 'conflict') throw new CloudConflictError(); if (this.status.issue || this.queue.length) throw new Error('Existem alterações sem confirmação remota.'); }
  async retry() { if (this.status.issue?.kind === 'conflict' || this.status.issue?.kind === 'session') return; this.publish({ issue: null }); await this.drain(); }
  async resumeAfterAuthentication(expectedUserId: string) {
    if (this.disposed) throw new Error('Sessão encerrada.');
    if (this.status.issue?.kind !== 'session') return;
    const config = await cloudJson<CloudConfig>('/api/cloud/config', {}, this.fetcher);
    if (!expectedUserId || !config.enabled || !config.authenticated || config.user?.id !== expectedUserId) throw new Error('Conclua o acesso com a mesma conta na outra aba antes de retomar. Seus rascunhos continuam preservados aqui.');
    if (this.disposed) throw new Error('Sessão encerrada.');
    // A concurrent recovery must never clear a new conflict or change the draft base.
    if (this.getSnapshot().issue?.kind !== 'session') return;
    this.publish({ issue: null }); await this.drain();
  }
  requestFetch(): typeof fetch { return this.fetcher; }
  dispose() { this.vaultDisposer?.(); if (this.vaultDisposer) configureVault(null); this.disposed = true; this.mediaBytes.clear(); this.mediaMetadata.clear(); this.confirmed.clear(); this.drafts.clear(); this.queue = []; this.publish({ issue: null }); }
  media(): CloudMedia[] { return [...this.mediaMetadata.values()]; }
  cachedMedia(id: string): ArrayBuffer | null { return this.mediaBytes.get(id)?.slice(0) ?? null; }
  async readMedia(id: string): Promise<ArrayBuffer | null> {
    const cached = this.mediaBytes.get(id); if (cached) return cached.slice(0);
    const metadata = this.mediaMetadata.get(id); if (!metadata) return null;
    const response = await sessionAwareFetch(`/api/cloud/media/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store' }, this.fetcher);
    if (!response.ok) throw new CloudHttpError(response.status, 'Não foi possível ler o arquivo remoto.');
    const bytes = await response.arrayBuffer(); if (bytes.byteLength !== metadata.size || await sha256(bytes) !== metadata.sha256) throw new Error('Integridade do arquivo remoto inválida.');
    if (this.disposed) throw new Error('Sessão encerrada.'); this.mediaBytes.set(id, bytes); return bytes.slice(0);
  }
  async writeMedia(record: { id: string; mime: string; name: string; projectId?: string; createdAt?: number; bytes: ArrayBuffer }) {
    if (this.disposed) throw new Error('Sessão encerrada.');
    const hash = await sha256(record.bytes), existing = this.mediaMetadata.get(record.id);
    if (existing && (existing.sha256 !== hash || existing.mime !== record.mime || existing.size !== record.bytes.byteLength)) throw new CloudConflictError();
    if (!existing) {
      const { bytes, ...metadata } = record;
      const result = await cloudJson<{ id: string; sha256: string; size: number }>('/api/cloud/media', { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ ...metadata, sha256: hash, base64: encodeBytes(bytes), operationId: crypto.randomUUID() }) }, this.fetcher);
      if (result.id !== record.id || result.sha256 !== hash || result.size !== bytes.byteLength) throw new Error('Upload não confirmado.');
      if (this.disposed) throw new Error('Sessão encerrada.');
      this.mediaMetadata.set(record.id, { ...metadata, sha256: hash, size: bytes.byteLength });
    }
    this.mediaBytes.set(record.id, record.bytes.slice(0));
  }
}

let runtime: CloudRuntime | null = null;
let providers: Partial<Record<CloudProvider, boolean>> = {};
export function configureCloud(next: CloudRuntime | null, capabilities: Partial<Record<CloudProvider, boolean>> = {}) { runtime?.dispose(); runtime = next; providers = capabilities; }
export const isCloudEnabled = () => runtime !== null;
export const cloudProviderAvailable = (provider: CloudProvider) => isCloudEnabled() && providers[provider] === true;
export const getCloudRuntime = () => runtime;
/** Report authentication failures without retrying paid requests or changing the selected backend. */
export async function sessionAwareFetch(input: RequestInfo | URL, init?: RequestInit, fetcher: typeof fetch = fetch): Promise<Response> {
  authorizeVaultSharing(input, init);
  const response = await fetcher(input, init);
  if (response.status === 401 || response.status === 403) {
    let key = 'api'; try { key = new URL(input instanceof Request ? input.url : String(input), typeof window === 'undefined' ? 'http://localhost' : window.location.href).pathname; } catch { /* Keep a non-sensitive fallback. */ }
    runtime?.notifySessionExpired(key);
  }
  return response;
}
export async function sha256(bytes: ArrayBuffer): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join(''); }
export function encodeBytes(bytes: ArrayBuffer): string { let value = ''; const data = new Uint8Array(bytes); for (let i = 0; i < data.length; i += 8192) value += String.fromCharCode(...data.subarray(i, i + 8192)); return btoa(value); }
export function decodeBytes(value: string): ArrayBuffer { return Uint8Array.from(atob(value), c => c.charCodeAt(0)).buffer; }
