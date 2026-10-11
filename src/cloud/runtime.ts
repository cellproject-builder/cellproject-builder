import { authorizeVaultSharing, configureVault } from './vault/privacy';
import type { CheckpointStore } from './offline/checkpoints';
import { mergeCloudDocument } from './documentMerge';
export type { CheckpointStore } from './offline/checkpoints';
export const CLOUD_DOCUMENT_KEYS = ['cellproject-workspace', 'cellproject-graph', 'dynamic_diary-chat', 'cellproject-kb', 'cellproject-config', 'cellproject-locale', 'dynamic_diary-theme', 'dynamic_diary-sidebar-collapsed', 'dynamic_diary:task-view'] as const;
export type CloudProvider = 'openrouter' | 'openai' | 'anthropic';
export interface CloudDocument { key: string; value: string; revision: number }
export interface CloudMedia { id: string; mime: string; name: string; projectId?: string; createdAt?: number; sha256: string; size: number }
export interface CloudSnapshot { documents: CloudDocument[]; media: CloudMedia[] }
export interface CloudConfig { enabled: boolean; authenticated: boolean; authMethod?: 'email_link' | 'code'; passwordAuth?: boolean; passwordProvider?: { url: string; publishableKey: string }; passwordSetup?: boolean; vaultAvailable?: boolean; liveInkAvailable?: boolean; user?: { id: string; email: string }; providers?: Partial<Record<CloudProvider, boolean>> }
export interface CloudIssue { kind: 'conflict' | 'network' | 'session'; key: string; message: string }
export interface CloudStatus { pending: number; issue: CloudIssue | null; saving: boolean; localSaved?: boolean; localSaving?: boolean; localError?: string; offline?: boolean }
export interface CloudRuntimeOptions {
  persistence?: CheckpointStore;
  checkpoint?: unknown;
  networkReady?: () => boolean;
  /** Called only after the operation's removal from the runtime queue is durable. */
  acknowledgeOperation?: (operationId: string) => Promise<void>;
  /** Retire a definitively rejected request only after its replacement queue is durable. */
  rejectOperation?: (operationId: string) => Promise<void>;
}
export interface RuntimeCheckpoint { version: 1; confirmed: CloudSnapshot; drafts: [string, string][]; queue: Operation[]; issue: CloudIssue | null }
export interface RemoteRefreshOptions {
  keys?: readonly string[];
  isIdle?: () => boolean;
  /** Must apply synchronously: no input events can interleave with this transaction. */
  apply?: (documents: readonly CloudDocument[]) => void;
}
type Operation = { key: string; value: string; operationId: string; baseRevision?: number; baseValue?: string | null; rejected?: true };
const MEDIA_BYTE_CACHE_LIMIT = 32 * 1024 * 1024;
type PendingMediaRead = { metadata: CloudMedia; controller: AbortController; promise: Promise<ArrayBuffer> };
const sameMediaBytes = (before: CloudMedia, after: CloudMedia | undefined) => !!after && before.sha256 === after.sha256 && before.size === after.size && before.mime === after.mime;
export class CloudConflictError extends Error { constructor() { super('Há um conflito remoto. Seu rascunho foi preservado.'); } }
export class CloudHttpError extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }
export const mutationHeaders = { 'Content-Type': 'application/json', 'X-Cellproject-Request': '1' };
export async function cloudJson<T>(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await sessionAwareFetch(path, { ...init, credentials: 'same-origin', cache: 'no-store' }, fetcher);
  if (!response.ok) {
    let code: string | undefined;
    try {
      const data: unknown = await response.json();
      const error = data && typeof data === 'object' && 'error' in data ? data.error : undefined;
      const candidate = error && typeof error === 'object' && 'code' in error ? error.code : error;
      if (typeof candidate === 'string' && /^[a-z_]{1,80}$/.test(candidate)) code = candidate;
    } catch { /* Error details are not trusted or shown. */ }
    throw new CloudHttpError(response.status, response.status === 409 ? 'Conflito de revisão no servidor.' : response.status === 401 || response.status === 403 ? 'Sessão expirada ou acesso recusado.' : `Não foi possível salvar na nuvem (${response.status}).`, code);
  }
  return await response.json() as T;
}
export function sanitizeCloudDocument(key: string, value: string): string {
  if (!CLOUD_DOCUMENT_KEYS.includes(key as typeof CLOUD_DOCUMENT_KEYS[number])) throw new Error('Documento de persistência desconhecido.');
  if (key !== 'cellproject-config') return value;
  const data = JSON.parse(value) as { state?: { providers?: Record<string, Record<string, unknown>> } };
  for (const config of Object.values(data.state?.providers ?? {})) delete config.apiKey;
  return JSON.stringify(data);
}

const plannerFields = ['project', 'selectedNodeId', 'focusedParentId', 'lens', 'viewMode', 'detailPanelOpen', 'lastTutorNodeId', 'drafts', 'objectiveDraft', 'archivedProject', 'pendingSuggestions', 'parkedSuggestions', 'archivedPending'];
const jsonRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => sameJson(value, b[index]));
  if (!jsonRecord(a) || !jsonRecord(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
}
/** Compare already validated flat records without parsing their serialized document bodies. */
function sameRecord(value: unknown, confirmed: object | undefined): boolean {
  if (!jsonRecord(value) || !confirmed) return false;
  const keys = Object.keys(value), previous = confirmed as Record<string, unknown>;
  return keys.length === Object.keys(previous).length && keys.every(key => Object.hasOwn(previous, key) && value[key] === previous[key]);
}
/** The singleton graph is redundant only when both complete editors have canonical workspace owners. */
function managedGraphCheckpoint(base: string | null, local: string, remote: string | null, workspace: string | null): boolean {
  if (base === null || remote === null || workspace === null) return false;
  try {
    const before: unknown = JSON.parse(base), here: unknown = JSON.parse(local), there: unknown = JSON.parse(remote), canonical: unknown = JSON.parse(workspace);
    if (!jsonRecord(before) || !jsonRecord(here) || !jsonRecord(there) || before.version !== here.version || here.version !== there.version || !Number.isSafeInteger(here.version) || !jsonRecord(before.state) || !jsonRecord(here.state) || !jsonRecord(there.state) || !jsonRecord(canonical) || !jsonRecord(canonical.state) || !jsonRecord(canonical.state.projects)) return false;
    const id = (state: Record<string, unknown>) => jsonRecord(state.project) && typeof state.project.id === 'string' ? state.project.id : null;
    const baseId = id(before.state), localId = id(here.state), remoteId = id(there.state);
    if (!baseId || !localId || !remoteId || localId === remoteId) return false;
    const planners = Object.values(canonical.state.projects).flatMap(managed => jsonRecord(managed) && jsonRecord(managed.planner) ? [managed.planner] : []);
    const covered = (state: Record<string, unknown>) => Object.keys(state).length === plannerFields.length && plannerFields.every(field => Object.hasOwn(state, field)) && planners.filter(planner => plannerFields.every(field => Object.hasOwn(planner, field) && sameJson(state[field], planner[field]))).length === 1;
    return planners.some(planner => id(planner) === baseId) && covered(here.state) && covered(there.state);
  } catch { return false; }
}

/** Cloud is canonical; optional encrypted checkpoints preserve local drafts and exact retry identities. */
export class CloudRuntime {
  private confirmed = new Map<string, CloudDocument>();
  private drafts = new Map<string, string>();
  private queue: Operation[] = [];
  private active: Promise<void> | null = null;
  private disposed = false;
  private listeners = new Set<() => void>();
  private remoteListeners = new Set<(documents: readonly CloudDocument[]) => void>();
  private refreshing: Promise<CloudDocument[]> | null = null;
  private mutationEpoch = 0;
  private remoteApplyDepth = 0;
  private pendingMediaWrites = 0;
  private status: CloudStatus = { pending: 0, issue: null, saving: false };
  private mediaMetadata = new Map<string, CloudMedia>();
  private mediaBytes = new Map<string, ArrayBuffer>();
  private mediaByteSize = 0;
  private mediaReads = new Map<string, PendingMediaRead>();
  private localChain: Promise<void> = Promise.resolve();
  private localGeneration = 0;
  // The UI can keep a full snapshot while reconciliation installs remote entities.
  // Remember its last raw value so its next edit expresses a delta, not a rollback.
  private lastLocalValues = new Map<string, string>();
  private pendingApplication = new Set<string>();
  private retiredOperations = new Set<string>();
  constructor(snapshot: CloudSnapshot, private fetcher: typeof fetch = fetch, private vaultDisposer?: () => void, private snapshotLoader?: () => Promise<CloudSnapshot>, private options: CloudRuntimeOptions = {}) {
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
      this.mediaMetadata.set(media.id, { ...media });
    }
    if (options.checkpoint !== undefined && options.checkpoint !== null) this.restoreCheckpoint(options.checkpoint);
    for (const document of this.documents()) this.lastLocalValues.set(document.key, document.value);
    if (options.persistence) this.status = { ...this.status, localSaved: options.checkpoint != null, localSaving: false, offline: !this.networkReady() };
  }
  private restoreCheckpoint(value: unknown) {
    const data = value as RuntimeCheckpoint;
    if (!data || data.version !== 1 || !Array.isArray(data.drafts) || !Array.isArray(data.queue) || data.queue.length > 10000 || data.drafts.length > CLOUD_DOCUMENT_KEYS.length) throw new Error('Diário local inválido.');
    const checked = new CloudRuntime(data.confirmed), confirmed = checked.documents(), media = checked.media(); checked.dispose();
    const drafts = new Map<string, string>(), ids = new Set<string>();
    for (const entry of data.drafts) {
      if (!Array.isArray(entry) || entry.length !== 2 || !CLOUD_DOCUMENT_KEYS.includes(entry[0] as typeof CLOUD_DOCUMENT_KEYS[number]) || typeof entry[1] !== 'string' || drafts.has(entry[0]) || sanitizeCloudDocument(entry[0], entry[1]) !== entry[1]) throw new Error('Rascunho local inválido.');
      const check = new CloudRuntime({ documents: [{ key: entry[0], value: entry[1], revision: 1 }], media: [] }); check.dispose();
      drafts.set(entry[0], entry[1]);
    }
    const latest = new Map<string, string>();
    for (const op of data.queue) {
      if (!op || !CLOUD_DOCUMENT_KEYS.includes(op.key as typeof CLOUD_DOCUMENT_KEYS[number]) || typeof op.value !== 'string' || sanitizeCloudDocument(op.key, op.value) !== op.value || typeof op.operationId !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(op.operationId) || ids.has(op.operationId) || op.baseRevision !== undefined && (!Number.isSafeInteger(op.baseRevision) || op.baseRevision < 0) || op.rejected !== undefined && op.rejected !== true || op.baseValue !== undefined && op.baseValue !== null && typeof op.baseValue !== 'string') throw new Error('Fila local inválida.');
      const check = new CloudRuntime({ documents: [{ key: op.key, value: op.value, revision: 1 }], media: [] }); check.dispose();
      if (typeof op.baseValue === 'string') { const base = new CloudRuntime({ documents: [{ key: op.key, value: op.baseValue, revision: 1 }], media: [] }); base.dispose(); }
      ids.add(op.operationId); latest.set(op.key, op.value);
    }
    if (latest.size !== drafts.size || [...latest].some(([key, text]) => drafts.get(key) !== text)) throw new Error('Fila e rascunhos locais não correspondem.');
    if (data.issue !== null && (!data.issue || !['conflict', 'network', 'session'].includes(data.issue.kind) || typeof data.issue.key !== 'string' || typeof data.issue.message !== 'string')) throw new Error('Estado local inválido.');
    this.confirmed = new Map(confirmed.map(doc => [doc.key, doc])); this.mediaMetadata = new Map(media.map(item => [item.id, item])); this.drafts = drafts;
    this.queue = data.queue.map(op => ({ ...op })); this.status = { pending: this.queue.length, saving: false, issue: data.issue };
  }
  checkpoint(): RuntimeCheckpoint { return { version: 1, confirmed: { documents: [...this.confirmed.values()].map(doc => ({ ...doc })), media: this.media() }, drafts: [...this.drafts], queue: this.queue.map(op => ({ ...op })), issue: this.status.issue ? { ...this.status.issue } : null }; }
  persistCheckpoint(): Promise<void> {
    if (!this.options.persistence) return Promise.resolve();
    const value = this.checkpoint(), generation = ++this.localGeneration;
    this.publish({ localSaving: true, localSaved: false });
    const task = this.localChain.catch(() => {}).then(async () => {
      if (this.disposed) throw new Error('Sessão encerrada.');
      await this.options.persistence!.write('runtime', value);
      if (!this.disposed && generation === this.localGeneration) this.publish({ localSaving: false, localSaved: true, localError: undefined });
    }).catch((reason: unknown) => {
      if (!this.disposed && generation === this.localGeneration) this.publish({ localSaving: false, localSaved: false, localError: reason instanceof Error ? reason.message : 'Não foi possível salvar neste aparelho.' });
      throw reason;
    });
    this.localChain = task; return task;
  }
  private networkReady() { return this.options.networkReady?.() !== false; }
  notifyNetworkState() { this.publish({ offline: !this.networkReady() }); }
  reportSyncIssue(issue: CloudIssue) { this.publish({ issue }); if (this.options.persistence) void this.persistCheckpoint().catch(() => {}); }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  subscribeRemote = (listener: (documents: readonly CloudDocument[]) => void) => { this.remoteListeners.add(listener); return () => { this.remoteListeners.delete(listener); }; };
  getSnapshot = () => this.status;
  notifySessionExpired(key: string) { if (!this.disposed && this.status.issue?.kind !== 'conflict') this.reportSyncIssue({ kind: 'session', key, message: 'Sessão expirada ou acesso recusado. Preserve uma cópia antes de entrar novamente.' }); }
  private publish(patch: Partial<CloudStatus> = {}) { this.status = { ...this.status, ...patch, pending: this.queue.length }; for (const listener of this.listeners) listener(); }
  get(key: string): string | null { return this.drafts.get(key) ?? this.confirmed.get(key)?.value ?? null; }
  documents(): CloudDocument[] { return [...new Set([...this.confirmed.keys(), ...this.drafts.keys()])].map(key => ({ key, value: this.get(key)!, revision: this.confirmed.get(key)?.revision ?? 0 })); }
  private hasTransientReadIssue(): boolean { return this.status.issue?.key === 'remote-sync' && this.status.issue.kind === 'network'; }
  private matchesConfirmed(snapshot: CloudSnapshot): boolean {
    if (!snapshot || !Array.isArray(snapshot.documents) || !Array.isArray(snapshot.media) || snapshot.documents.length !== this.confirmed.size || snapshot.media.length !== this.mediaMetadata.size) return false;
    const documents = new Set<string>(), media = new Set<string>();
    return snapshot.documents.every(doc => {
      if (!doc || documents.has(doc.key) || !sameRecord(doc, this.confirmed.get(doc.key))) return false;
      documents.add(doc.key); return true;
    }) && snapshot.media.every(item => {
      if (!item || media.has(item.id) || !sameRecord(item, this.mediaMetadata.get(item.id))) return false;
      media.add(item.id); return true;
    }) && documents.size === this.confirmed.size && media.size === this.mediaMetadata.size;
  }
  isIdle(): boolean { return !this.disposed && !this.queue.length && !this.active && !this.pendingMediaWrites && !this.drafts.size && (!this.status.issue || this.hasTransientReadIssue()); }
  /** Suppress persistence echoes only inside a synchronous remote domain application. */
  withRemoteApply<T>(apply: () => T): T {
    this.remoteApplyDepth++;
    try { return apply(); } finally { this.remoteApplyDepth--; }
  }
  /** Adopt recovered auxiliary effects without changing any queued document's base or draft. */
  async adoptRecoveredSnapshot(snapshot: CloudSnapshot, options: Pick<RemoteRefreshOptions, 'isIdle' | 'apply'> = {}): Promise<boolean> {
    if (this.disposed) throw new Error('Sessão encerrada.');
    if (this.pendingMediaWrites || options.isIdle?.() === false) return false;
    const checked = new CloudRuntime(snapshot), documents = checked.documents(), media = checked.media(); checked.dispose();
    const queued = new Set(this.queue.map(op => op.key)), changes: CloudDocument[] = [];
    for (const old of this.confirmed.values()) {
      const next = documents.find(doc => doc.key === old.key);
      if (!next || next.revision < old.revision || next.revision === old.revision && next.value !== old.value) throw new CloudConflictError();
    }
    for (const doc of documents) {
      if (queued.has(doc.key)) continue;
      const old = this.confirmed.get(doc.key);
      if (!old || doc.revision > old.revision) changes.push(doc);
    }
    // Validate/apply domain changes synchronously before acknowledging their revisions.
    if (changes.length && options.apply) this.withRemoteApply(() => options.apply!(changes));
    for (const doc of changes) this.confirmed.set(doc.key, doc);
    const metadata = new Map(media.map(item => [item.id, item]));
    this.replaceMediaMetadata(metadata);
    if (this.options.persistence) await this.persistCheckpoint();
    if (changes.length) for (const listener of this.remoteListeners) listener(changes);
    return true;
  }
  /** Reads a real remote snapshot and adopts revisions only when local drafts stayed idle. */
  refreshRemote(options: RemoteRefreshOptions = {}): Promise<CloudDocument[]> {
    if (this.refreshing) return this.refreshing;
    if (!this.networkReady() || this.status.localError || !this.isIdle() || options.isIdle?.() === false) return Promise.resolve([]);
    const epoch = this.mutationEpoch;
    const task = (async () => {
      const snapshot = this.snapshotLoader ? await this.snapshotLoader() : await cloudJson<CloudSnapshot>('/api/cloud/snapshot', {}, this.fetcher);
      if (!this.isIdle() || epoch !== this.mutationEpoch || options.isIdle?.() === false) return [];
      const keys = new Set(options.keys ?? CLOUD_DOCUMENT_KEYS);
      // The authenticated read still runs on every poll. Only an exact, already
      // durable snapshot can skip validation/serialization and status updates.
      const needsApplication = options.apply && [...this.pendingApplication].some(key => keys.has(key));
      if ((!this.options.persistence || this.status.localSaved === true) && !this.hasTransientReadIssue() && !needsApplication && this.matchesConfirmed(snapshot)) return [];
      // Validate the entire envelope and media catalog before touching the current state.
      const checked = new CloudRuntime(snapshot), remote = checked.documents(); checked.dispose();
      const changes: CloudDocument[] = [];
      for (const old of this.confirmed.values()) {
        if (keys.has(old.key) && !remote.some(doc => doc.key === old.key)) throw new Error('Snapshot remoto incompleto.');
      }
      for (const doc of remote) {
        if (!keys.has(doc.key)) continue;
        const old = this.confirmed.get(doc.key);
        if (old && doc.revision < old.revision) throw new Error('Revisão remota desatualizada.');
        if (old && doc.revision === old.revision && doc.value !== old.value) throw new CloudConflictError();
        if (!old || doc.revision > old.revision || options.apply && this.pendingApplication.has(doc.key)) changes.push(doc);
      }
      const before = new Map(this.confirmed);
      for (const doc of changes) this.confirmed.set(doc.key, doc);
      try { if (changes.length && options.apply) this.withRemoteApply(() => options.apply!(changes)); }
      catch (reason) { this.confirmed = before; throw reason; }
      if (options.apply) for (const doc of changes) { this.lastLocalValues.set(doc.key, doc.value); this.pendingApplication.delete(doc.key); }
      const metadata = new Map(snapshot.media.map(item => [item.id, { ...item }]));
      this.replaceMediaMetadata(metadata);
      // Persist the recovered state too; a later unchanged poll no longer
      // rewrites the journal and must not leave an obsolete warning in it.
      if (this.hasTransientReadIssue()) this.publish({ issue: null });
      if (this.options.persistence) await this.persistCheckpoint();
      if (changes.length) for (const listener of this.remoteListeners) listener(changes);
      return changes;
    })().catch((reason: unknown) => {
      if (!this.disposed && epoch === this.mutationEpoch) {
        const status = reason instanceof CloudHttpError ? reason.status : 0;
        this.publish({ issue: { key: 'remote-sync', kind: reason instanceof CloudConflictError || status === 409 ? 'conflict' : status === 401 || status === 403 ? 'session' : 'network', message: reason instanceof Error ? reason.message : 'Não foi possível atualizar o desenho remoto.' } });
      }
      throw reason;
    }).finally(() => { if (this.refreshing === task) this.refreshing = null; });
    this.refreshing = task; return task;
  }
  write(key: string, raw: string): Promise<void> {
    if (this.disposed || this.remoteApplyDepth > 0) return Promise.resolve();
    const local = sanitizeCloudDocument(key, raw), current = this.get(key), previousLocal = this.lastLocalValues.get(key) ?? null;
    let value = local, baseValue = current, unsafeStaleDraft = false;
    if (this.pendingApplication.has(key) && previousLocal !== current) {
      const merged = mergeCloudDocument(key, previousLocal, local, current);
      if (merged === null) {
        // Keep the new user draft, but never submit a stale full replacement.
        baseValue = previousLocal;
        unsafeStaleDraft = true;
        this.publish({ issue: { key, kind: 'conflict', message: new CloudConflictError().message } });
      } else value = merged;
    }
    this.lastLocalValues.set(key, local);
    if (this.get(key) === value) return Promise.resolve();
    if (this.hasTransientReadIssue()) this.publish({ issue: null });
    this.mutationEpoch++;
    this.drafts.set(key, value);
    // A request that may have reached the server keeps its original body and id.
    // Adjacent drafts that have never been sent can share one latest snapshot.
    const previous = this.queue.at(-1);
    if (previous?.key === key && previous.baseRevision === undefined) { previous.value = value; if (unsafeStaleDraft) previous.rejected = true; }
    else this.queue.push({ key, value, operationId: crypto.randomUUID(), baseValue, ...(unsafeStaleDraft ? { rejected: true as const } : {}) });
    this.publish();
    return this.options.persistence ? this.persistCheckpoint().then(() => this.drain()).catch(() => {}) : this.drain();
  }
  /** Reconcile the latest local deltas only after a request was definitively rejected. */
  private async rebasePending(): Promise<boolean> {
    if (!this.snapshotLoader || !this.queue[0]?.rejected || !this.networkReady()) return false;
    const snapshot = await this.snapshotLoader();
    if (this.disposed || !this.networkReady() || this.status.issue?.kind === 'session') return false;
    const checked = new CloudRuntime(snapshot), documents = checked.documents(), media = checked.media(); checked.dispose();
    const remote = new Map(documents.map(doc => [doc.key, doc]));
    for (const old of this.confirmed.values()) {
      const next = remote.get(old.key);
      if (!next || next.revision < old.revision || next.revision === old.revision && next.value !== old.value) throw new CloudConflictError();
    }
    // Input may have changed during the read. Collapse each entire local chain
    // from its original base to its current latest draft, including those edits.
    const first = new Map<string, Operation>();
    for (const op of this.queue) if (!first.has(op.key)) first.set(op.key, op);
    const replacements: Operation[] = [], drafts = new Map<string, string>();
    // Establish the canonical per-project workspace before considering its
    // redundant singleton editor checkpoint, regardless of persistence order.
    const ordered = [...first].sort(([a], [b]) => a === 'cellproject-workspace' ? -1 : b === 'cellproject-workspace' ? 1 : 0);
    for (const [key, op] of ordered) {
      const latest = this.drafts.get(key)!;
      const base = op.baseValue !== undefined ? op.baseValue : this.confirmed.get(key)?.value ?? null;
      let merged = mergeCloudDocument(key, base, latest, remote.get(key)?.value ?? null);
      if (merged === null && key === 'cellproject-graph' && managedGraphCheckpoint(base, latest, remote.get(key)?.value ?? null, drafts.get('cellproject-workspace') ?? remote.get('cellproject-workspace')?.value ?? null)) merged = latest;
      if (merged === null) return false;
      if (merged !== remote.get(key)?.value) {
        replacements.push({ key, value: merged, operationId: crypto.randomUUID(), baseValue: remote.get(key)?.value ?? null });
        drafts.set(key, merged);
      }
    }
    for (const op of this.queue) this.retiredOperations.add(op.operationId);
    for (const doc of documents) if (this.get(doc.key) !== (drafts.get(doc.key) ?? doc.value)) this.pendingApplication.add(doc.key);
    for (const [key, value] of drafts) if (this.lastLocalValues.get(key) !== value) this.pendingApplication.add(key);
    this.confirmed = remote; this.drafts = drafts; this.queue = replacements;
    const metadata = new Map(media.map(item => [item.id, item]));
    this.replaceMediaMetadata(metadata);
    this.publish({ issue: null });
    await this.persistCheckpoint();
    // A reload between these boundaries can reconcile the now-orphaned rejected
    // request; an ambiguous request is never eligible for this replacement.
    await this.retireRejectedOperations();
    return true;
  }
  private async retireRejectedOperations() {
    for (const id of this.retiredOperations) { await this.options.rejectOperation?.(id); this.retiredOperations.delete(id); }
  }
  private drain(): Promise<void> {
    if (this.active) return this.active;
    if (this.disposed || !this.networkReady() || this.status.localError || this.status.issue || !this.queue.length) return Promise.resolve();
    this.active = (async () => {
      this.publish({ saving: true });
      let rebases = 0;
      while (this.queue.length && !this.disposed && !this.status.issue && !this.status.localError && this.networkReady()) {
        const op = this.queue[0];
        try {
          if (op.rejected) {
            if (rebases++ >= 3 || !await this.rebasePending()) throw new CloudConflictError();
            continue;
          }
          op.baseRevision ??= this.confirmed.get(op.key)?.revision ?? 0;
          op.baseValue ??= this.confirmed.get(op.key)?.value ?? null;
          if (this.options.persistence) await this.persistCheckpoint();
          if (this.retiredOperations.size) await this.retireRejectedOperations();
          if (this.disposed || !this.networkReady()) break;
          const result = await cloudJson<{ revision: number }>(`/api/cloud/documents/${encodeURIComponent(op.key)}`, { method: 'PUT', headers: mutationHeaders, body: JSON.stringify({ value: op.value, baseRevision: op.baseRevision, operationId: op.operationId }) }, this.fetcher);
          if (this.disposed) return;
          if (!Number.isSafeInteger(result.revision) || result.revision < 1) throw new Error('Revisão inválida.');
          this.confirmed.set(op.key, { key: op.key, value: op.value, revision: result.revision }); this.queue.shift();
          if (!this.queue.some(item => item.key === op.key)) this.drafts.delete(op.key);
          if (this.options.persistence) { await this.persistCheckpoint(); await this.options.acknowledgeOperation?.(op.operationId); }
          this.publish();
        } catch (reason) {
          const status = reason instanceof CloudHttpError ? reason.status : 0;
          if (reason instanceof CloudHttpError && status === 409 && reason.code === 'revision_conflict') {
            op.rejected = true;
            if (this.options.persistence) { try { await this.persistCheckpoint(); } catch { break; } }
            if (this.snapshotLoader && rebases < 3) continue;
          }
          this.publish({ issue: { key: op.key, kind: reason instanceof CloudConflictError || status === 409 ? 'conflict' : status === 401 || status === 403 ? 'session' : 'network', message: reason instanceof Error ? reason.message : 'Falha de conexão.' } });
          if (this.options.persistence && !this.status.localError) await this.persistCheckpoint().catch(() => {});
          break;
        }
      }
    })().finally(() => {
      this.active = null; this.publish({ saving: false });
      if (this.queue.length && !this.status.issue && !this.status.localError && this.networkReady() && !this.disposed) void this.drain();
    });
    return this.active;
  }
  async flush() { await this.localChain.catch(() => {}); if (this.status.localError) throw new Error(this.status.localError); do { await this.drain(); } while (this.queue.length && !this.status.issue && !this.status.localError && this.networkReady() && !this.disposed); if (this.status.localError) throw new Error(this.status.localError); if (this.status.issue?.kind === 'conflict') throw new CloudConflictError(); if (this.status.issue || this.queue.length) throw new Error('Existem alterações sem confirmação remota.'); }
  async retry() { if (this.status.issue?.kind === 'session' || this.status.issue?.kind === 'conflict' && (!this.snapshotLoader || !this.queue.length)) return; this.publish({ issue: null, offline: !this.networkReady() }); if (this.options.persistence) { try { await this.persistCheckpoint(); } catch { return; } } await this.drain(); }
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
  dispose() { if (this.disposed) return; this.disposed = true; for (const read of this.mediaReads.values()) read.controller.abort(new Error('Sessão encerrada.')); this.mediaReads.clear(); this.vaultDisposer?.(); if (this.vaultDisposer) configureVault(null); this.mediaBytes.clear(); this.mediaByteSize = 0; this.mediaMetadata.clear(); this.confirmed.clear(); this.drafts.clear(); this.queue = []; this.remoteListeners.clear(); this.publish({ issue: null }); }
  media(): CloudMedia[] { return [...this.mediaMetadata.values()].map(item => ({ ...item })); }
  private removeMediaBytes(id: string) {
    const bytes = this.mediaBytes.get(id);
    if (bytes) { this.mediaByteSize -= bytes.byteLength; this.mediaBytes.delete(id); }
  }
  private cacheMediaBytes(id: string, bytes: ArrayBuffer) {
    this.removeMediaBytes(id);
    if (bytes.byteLength > MEDIA_BYTE_CACHE_LIMIT) return;
    while (this.mediaByteSize + bytes.byteLength > MEDIA_BYTE_CACHE_LIMIT) this.removeMediaBytes(this.mediaBytes.keys().next().value!);
    this.mediaBytes.set(id, bytes); this.mediaByteSize += bytes.byteLength;
  }
  private invalidateMedia(id: string) {
    this.removeMediaBytes(id);
    this.mediaReads.get(id)?.controller.abort(new Error('O arquivo remoto mudou durante a leitura.'));
    this.mediaReads.delete(id);
  }
  private replaceMediaMetadata(metadata: Map<string, CloudMedia>) {
    for (const [id, old] of this.mediaMetadata) if (!sameMediaBytes(old, metadata.get(id))) this.invalidateMedia(id);
    this.mediaMetadata = metadata;
  }
  private assertMediaRead(id: string, metadata: CloudMedia, signal: AbortSignal) {
    if (this.disposed) throw new Error('Sessão encerrada.');
    signal.throwIfAborted();
    if (!sameMediaBytes(metadata, this.mediaMetadata.get(id))) throw new Error('O arquivo remoto mudou durante a leitura.');
  }
  cachedMedia(id: string): ArrayBuffer | null {
    const bytes = this.mediaBytes.get(id); if (!bytes) return null;
    this.mediaBytes.delete(id); this.mediaBytes.set(id, bytes);
    return bytes.slice(0);
  }
  async readMedia(id: string): Promise<ArrayBuffer | null> {
    if (this.disposed) throw new Error('Sessão encerrada.');
    const cached = this.cachedMedia(id); if (cached) return cached;
    const metadata = this.mediaMetadata.get(id); if (!metadata) return null;
    let pending = this.mediaReads.get(id);
    if (!pending) {
      const controller = new AbortController();
      const promise: Promise<ArrayBuffer> = (async () => {
        const response = await sessionAwareFetch(`/api/cloud/media/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }, this.fetcher);
        this.assertMediaRead(id, metadata, controller.signal);
        if (!response.ok) throw new CloudHttpError(response.status, 'Não foi possível ler o arquivo remoto.');
        const bytes = await response.arrayBuffer();
        this.assertMediaRead(id, metadata, controller.signal);
        if (bytes.byteLength !== metadata.size || await sha256(bytes) !== metadata.sha256) throw new Error('Integridade do arquivo remoto inválida.');
        this.assertMediaRead(id, metadata, controller.signal);
        this.cacheMediaBytes(id, bytes); return bytes;
      })().finally(() => { if (this.mediaReads.get(id)?.promise === promise) this.mediaReads.delete(id); });
      pending = { metadata, controller, promise }; this.mediaReads.set(id, pending);
    }
    const bytes = await pending.promise;
    this.assertMediaRead(id, pending.metadata, pending.controller.signal);
    return bytes.slice(0);
  }
  async writeMedia(record: { id: string; mime: string; name: string; projectId?: string; createdAt?: number; bytes: ArrayBuffer }) {
    if (this.disposed) throw new Error('Sessão encerrada.');
    if (!this.networkReady()) throw new Error('Novos arquivos precisam de conexão e conta confirmada.');
    this.mutationEpoch++;
    this.pendingMediaWrites++;
    try {
    // Own the bytes before hashing: the caller may retain and mutate its buffer.
    const bytes = record.bytes.slice(0), hash = await sha256(bytes);
    if (this.disposed) throw new Error('Sessão encerrada.');
    const existing = this.mediaMetadata.get(record.id);
    if (existing && (existing.sha256 !== hash || existing.mime !== record.mime || existing.size !== bytes.byteLength)) throw new CloudConflictError();
    if (!existing) {
      const { bytes: _bytes, ...metadata } = record;
      const operationId = crypto.randomUUID();
      const result = await cloudJson<{ id: string; sha256: string; size: number }>('/api/cloud/media', { method: 'POST', headers: mutationHeaders, body: JSON.stringify({ ...metadata, sha256: hash, base64: encodeBytes(bytes), operationId }) }, this.fetcher);
      if (result.id !== record.id || result.sha256 !== hash || result.size !== bytes.byteLength) throw new Error('Upload não confirmado.');
      if (this.disposed) throw new Error('Sessão encerrada.');
      this.mediaMetadata.set(record.id, { ...metadata, sha256: hash, size: bytes.byteLength });
      if (this.options.persistence) { await this.persistCheckpoint(); await this.options.acknowledgeOperation?.(operationId); }
    }
    if (this.disposed) throw new Error('Sessão encerrada.');
    this.invalidateMedia(record.id); this.cacheMediaBytes(record.id, bytes);
    if (this.options.persistence) await this.persistCheckpoint();
    } finally { this.pendingMediaWrites--; }
  }
}

let runtime: CloudRuntime | null = null;
let providers: Partial<Record<CloudProvider, boolean>> = {};
export function configureCloud(next: CloudRuntime | null, capabilities: Partial<Record<CloudProvider, boolean>> = {}) { runtime?.dispose(); runtime = next; providers = capabilities; }
export const isCloudEnabled = () => runtime !== null;
export const cloudProviderAvailable = (provider: CloudProvider) => isCloudEnabled() && runtime?.getSnapshot().offline !== true && providers[provider] === true;
export const getCloudRuntime = () => runtime;
/** Report authentication failures without retrying paid requests or changing the selected backend. */
export async function sessionAwareFetch(input: RequestInfo | URL, init?: RequestInit, fetcher: typeof fetch = fetch): Promise<Response> {
  if (runtime?.getSnapshot().offline === true) {
    const url = new URL(input instanceof Request ? input.url : String(input), typeof window === 'undefined' ? 'http://localhost' : window.location.href);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    // Browser connectivity and a previous privacy approval do not verify the
    // owner/header after an offline reopen. Recovery reads must stay available.
    if (method === 'POST' && (url.pathname.startsWith('/api/ai/') || url.pathname.startsWith('/api/visuals/'))) throw new Error('IA, pesquisa e leitura externa precisam de conexão e confirmação da mesma conta e cofre.');
  }
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
