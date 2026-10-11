import { createJSONStorage, type PersistStorage, type StateStorage, type StorageValue } from 'zustand/middleware';

interface Options<S> {
  select?: (state: S) => readonly unknown[];
  scope?: () => unknown;
  /** Opt in only after integrating flush/pending barriers with the owning store. */
  deferMs?: number;
  /** Bind deferred operations to the backend selected at enqueue time. */
  captureStorage?: () => StateStorage;
}

export interface JSONPersistenceSnapshot {
  pending: boolean;
  error: unknown;
  revision: number;
  savedRevision: number;
}
export interface DeferredJSONStorage<S> extends PersistStorage<S> {
  flush: () => Promise<void>;
  hasPending: () => boolean;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => JSONPersistenceSnapshot;
}
const deferredStorages = new Set<DeferredJSONStorage<unknown>>();
const deferredListeners = new Set<() => void>();
interface PendingPersistenceCapture {
  isCurrent: () => boolean;
  acknowledge: () => void;
  publish: () => void;
}
const captureSources = new Map<DeferredJSONStorage<unknown>, (owner: unknown, read: (name: string) => string | null) => PendingPersistenceCapture | undefined>();
declare const deferredCaptureBrand: unique symbol;
export interface DeferredPersistenceCapture {
  readonly revision: number;
  readonly [deferredCaptureBrand]: true;
}
const captureTokens = new WeakMap<DeferredPersistenceCapture, { revision: number; captures: Map<DeferredJSONStorage<unknown>, PendingPersistenceCapture> }>();
let deferredSnapshot: Pick<JSONPersistenceSnapshot, 'pending' | 'error' | 'revision'> = { pending: false, error: null, revision: 0 };
function publishDeferredPersistence() {
  const states = [...deferredStorages].map(storage => storage.getSnapshot());
  const pending = states.some(state => state.pending), error = states.find(state => state.error)?.error ?? null;
  const revision = states.reduce((total, state) => total + state.revision, 0);
  if (pending === deferredSnapshot.pending && error === deferredSnapshot.error && revision === deferredSnapshot.revision) return;
  deferredSnapshot = { pending, error, revision };
  for (const listener of deferredListeners) listener();
}
export const subscribeDeferredPersistence = (listener: () => void) => { deferredListeners.add(listener); return () => { deferredListeners.delete(listener); }; };
export const getDeferredPersistenceSnapshot = () => deferredSnapshot;
export const hasDeferredPersistence = () => deferredSnapshot.pending;
export const flushDeferredPersistences = async () => { await Promise.all([...deferredStorages].map(storage => storage.flush())); };
/** Capture the pending set; any drafts must have failed and exist verbatim in the owner's rescue source. */
export function captureDeferredPersistence(owner: unknown, read: (name: string) => string | null): DeferredPersistenceCapture | undefined {
  const revision = deferredSnapshot.revision, captures = new Map<DeferredJSONStorage<unknown>, PendingPersistenceCapture>();
  try {
    for (const storage of deferredStorages) {
      if (!storage.hasPending()) continue;
      const capture = captureSources.get(storage)?.(owner, read);
      if (!capture) return undefined;
      captures.set(storage, capture);
    }
    const token = Object.freeze({ revision }) as DeferredPersistenceCapture;
    captureTokens.set(token, { revision, captures });
    if (isDeferredPersistenceCaptureCurrent(token)) return token;
    captureTokens.delete(token);
  } catch { /* Serialization/read failure must keep every pending draft. */ }
  return undefined;
}
export function isDeferredPersistenceCaptureCurrent(token: DeferredPersistenceCapture): boolean {
  const captured = captureTokens.get(token);
  if (!captured || captured.revision !== deferredSnapshot.revision) return false;
  try {
    for (const storage of deferredStorages) if (storage.hasPending() !== captured.captures.has(storage)) return false;
    for (const capture of captured.captures.values()) if (!capture.isCurrent()) return false;
    return captured.revision === deferredSnapshot.revision;
  } catch { return false; }
}
/** Call only after the captured rescue was saved and the owning session ended successfully. */
export function acknowledgeDeferredPersistenceCapture(token: DeferredPersistenceCapture): boolean {
  if (!isDeferredPersistenceCaptureCurrent(token)) return false;
  const captured = captureTokens.get(token)!;
  captureTokens.delete(token);
  // Clear the complete verified set before notifying subscribers.
  for (const capture of captured.captures.values()) capture.acknowledge();
  for (const capture of captured.captures.values()) capture.publish();
  return !hasDeferredPersistence() && captured.revision === deferredSnapshot.revision;
}
export function isDeferredJSONStorage<S>(storage: PersistStorage<S> | undefined): storage is DeferredJSONStorage<S> {
  return !!storage && 'flush' in storage && 'getSnapshot' in storage && 'subscribe' in storage;
}

function deferredJSONStorage<S extends object>(getStorage: () => StateStorage, options: Options<S>): DeferredJSONStorage<S> | undefined {
  let initialStorage: StateStorage;
  try { initialStorage = getStorage(); } catch { return undefined; }
  type Entry = {
    value: StorageValue<S>; selected: readonly unknown[]; scope: unknown; backend: StateStorage;
    revision: number; status: 'queued' | 'writing' | 'saved' | 'failed'; error?: unknown;
    promise: Promise<void>; resolve: () => void; reject: (reason: unknown) => void;
  };
  const latest = new Map<string, Entry>(), queued = new Map<string, Entry>();
  const writeRevisions = new Map<string, number>();
  const active = new Map<string, Promise<void>>(), removals = new Map<string, Promise<void>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>(), listeners = new Set<() => void>();
  let revision = 0, savedRevision = 0;
  let snapshot: JSONPersistenceSnapshot = { pending: false, error: null, revision, savedRevision };
  const ownerChanged = () => new Error('Há alterações de outra sessão de persistência nesta aba. Preserve o rascunho antes de trocar de sessão.');
  const backend = () => options.captureStorage?.() ?? initialStorage;
  const pending = () => queued.size > 0 || active.size > 0 || removals.size > 0;
  const publish = () => {
    const error = [...latest.values()].find(entry => entry.status === 'failed')?.error ?? null;
    snapshot = { pending: pending(), error, revision, savedRevision };
    for (const listener of listeners) listener();
    publishDeferredPersistence();
  };
  const clearTimer = (name: string) => { const timer = timers.get(name); if (timer) clearTimeout(timer); timers.delete(name); };
  const acknowledgement = () => {
    let resolve!: () => void, reject!: (reason: unknown) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    // Zustand does not await writes; explicit callers still receive rejection.
    void promise.catch(() => {});
    return { promise, resolve, reject };
  };
  const assertOwner = (name: string, scope: unknown) => {
    const entry = latest.get(name);
    if (entry && entry.status !== 'saved' && entry.scope !== scope) throw ownerChanged();
  };
  async function drain(name: string): Promise<void> {
    const running = active.get(name);
    if (running) {
      try { await running; } catch (reason) { if (!queued.has(name) || queued.get(name)?.status === 'failed') throw reason; }
      return drain(name);
    }
    const entry = queued.get(name);
    if (!entry) return;
    if (entry.status === 'failed') throw entry.error;
    clearTimer(name); queued.delete(name); entry.status = 'writing';
    const task = Promise.resolve().then(async () => {
      // A dynamic backend without captureStorage must fail closed after a scope switch.
      if (!options.captureStorage && options.scope?.() !== entry.scope) throw ownerChanged();
      await entry.backend.setItem(name, JSON.stringify(entry.value));
    }).then(() => {
      entry.status = 'saved'; savedRevision = Math.max(savedRevision, entry.revision); entry.resolve();
    }, (reason: unknown) => {
      entry.status = 'failed'; entry.error = reason; entry.reject(reason);
      if (latest.get(name) === entry) queued.set(name, entry);
      throw reason;
    }).finally(() => { active.delete(name); publish(); });
    active.set(name, task); publish();
    try { await task; } catch (reason) { if (!queued.has(name) || queued.get(name) === entry) throw reason; }
    return drain(name);
  }
  const flushWrites = async (retryFailed = false) => {
    for (const name of timers.keys()) clearTimer(name);
    if (retryFailed) {
      let retried = false;
      for (const [name, entry] of queued) {
        if (entry.status !== 'failed' || latest.get(name) !== entry) continue;
        // One explicit flush grants one attempt. Keep the original rejection
        // intact and never let a retry replace a newer queued snapshot.
        const retry: Entry = { ...entry, ...acknowledgement(), status: 'queued', error: undefined };
        latest.set(name, retry); queued.set(name, retry); retried = true;
      }
      if (retried) publish();
    }
    await Promise.all([...new Set([...queued.keys(), ...active.keys()])].map(drain));
  };
  const storage: DeferredJSONStorage<S> = {
    setItem: (name, value) => {
      if (removals.has(name)) throw new Error('A remoção da persistência ainda está em andamento.');
      const scope = options.scope?.(); assertOwner(name, scope);
      const selected = options.select?.(value.state) ?? Object.entries(value.state).flat();
      const before = latest.get(name);
      if (before && before.status !== 'failed' && before.scope === scope && before.value.version === value.version && before.selected.length === selected.length && selected.every((item, index) => Object.is(item, before.selected[index]))) return before.promise;
      revision++;
      writeRevisions.set(name, revision);
      if (before?.status === 'queued' && queued.get(name) === before && before.scope === scope) {
        before.value = value; before.selected = selected; before.revision = revision;
        publish(); return before.promise;
      }
      const entry: Entry = { value, selected, scope, backend: backend(), revision, status: 'queued', ...acknowledgement() };
      latest.set(name, entry); queued.set(name, entry);
      if (!timers.has(name)) timers.set(name, setTimeout(() => { timers.delete(name); void drain(name).catch(() => {}); }, Math.min(200, Math.max(0, options.deferMs ?? 0))));
      publish(); return entry.promise;
    },
    getItem: async name => {
      const scope = options.scope?.();
      await flushWrites(); await removals.get(name);
      if (options.scope?.() !== scope) throw ownerChanged();
      const beforeRead = latest.get(name);
      const beforeRevision = writeRevisions.get(name), wasSettled = !beforeRead || beforeRead.status === 'saved';
      const value = await backend().getItem(name);
      if (options.scope?.() !== scope) throw ownerChanged();
      if (writeRevisions.get(name) !== beforeRevision || latest.get(name) !== beforeRead || !wasSettled) {
        await drain(name); await removals.get(name);
        if (options.scope?.() !== scope) throw ownerChanged();
        const confirmed = latest.get(name);
        // Another reader/removal may have invalidated the cache, or a newer
        // write may have arrived while drain settled. Re-read in that case.
        if (!confirmed || confirmed.status !== 'saved' || confirmed.scope !== scope) return storage.getItem(name);
        const result = JSON.parse(JSON.stringify(confirmed.value)) as StorageValue<S>;
        if (latest.get(name) === confirmed) latest.delete(name);
        publish(); return result;
      }
      if (latest.get(name) === beforeRead) latest.delete(name);
      publish();
      return value == null ? null : JSON.parse(value) as StorageValue<S>;
    },
    removeItem: name => {
      const scope = options.scope?.(), target = backend();
      if (removals.has(name)) return removals.get(name)!;
      const removeRevision = ++revision; writeRevisions.set(name, removeRevision);
      const task = Promise.resolve().then(async () => {
        await drain(name);
        if (!options.captureStorage && options.scope?.() !== scope) throw ownerChanged();
        await target.removeItem(name);
        latest.delete(name); clearTimer(name);
        savedRevision = Math.max(savedRevision, removeRevision);
      }).finally(() => { removals.delete(name); publish(); });
      removals.set(name, task); publish(); return task;
    },
    flush: async () => { await flushWrites(true); await Promise.all(removals.values()); },
    hasPending: pending,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
  };
  deferredStorages.add(storage as DeferredJSONStorage<unknown>);
  captureSources.set(storage as DeferredJSONStorage<unknown>, (owner, read) => {
    if (active.size || removals.size || !queued.size || options.scope && options.scope() !== owner) return undefined;
    const entries: { name: string; entry: Entry; revision: number; json: string }[] = [];
    for (const [name, entry] of queued) {
      if (entry.status !== 'failed' || entry.scope !== owner || latest.get(name) !== entry) return undefined;
      const json = JSON.stringify(entry.value);
      if (typeof json !== 'string' || read(name) !== json) return undefined;
      entries.push({ name, entry, revision: entry.revision, json });
    }
    return {
      isCurrent: () => !active.size && !removals.size && queued.size === entries.length && (!options.scope || options.scope() === owner) && entries.every(({ name, entry, revision, json }) =>
        queued.get(name) === entry && latest.get(name) === entry && entry.status === 'failed' && entry.scope === owner && entry.revision === revision && JSON.stringify(entry.value) === json),
      acknowledge: () => {
        for (const { name, entry } of entries) {
          queued.delete(name); latest.delete(name); clearTimer(name);
          entry.status = 'saved'; savedRevision = Math.max(savedRevision, entry.revision);
        }
      },
      publish,
    };
  });
  return storage;
}

/** Skip unchanged immutable domain fields before Zustand serializes a complete envelope. */
export function createSelectiveJSONStorage<S extends object>(getStorage: () => StateStorage, options: Options<S> = {}): PersistStorage<S> | undefined {
  if (options.deferMs !== undefined) return deferredJSONStorage(getStorage, options);
  const storage = createJSONStorage<S>(getStorage);
  if (!storage) return undefined;
  const previous = new Map<string, { version: number | undefined; scope: unknown; selected: readonly unknown[]; result?: unknown }>();
  return {
    getItem: name => { previous.delete(name); return storage.getItem(name); },
    removeItem: name => { previous.delete(name); return storage.removeItem(name); },
    setItem: (name, value) => {
      const selected = options.select?.(value.state) ?? Object.entries(value.state).flat();
      const scope = options.scope?.(), before = previous.get(name);
      if (before && before.scope === scope && before.version === value.version && before.selected.length === selected.length && selected.every((item, index) => Object.is(item, before.selected[index]))) return before.result;
      const entry: { version: number | undefined; scope: unknown; selected: readonly unknown[]; result?: unknown } = { version: value.version, scope, selected };
      previous.set(name, entry);
      const invalidate = () => { if (previous.get(name) === entry) previous.delete(name); };
      try {
        const result = storage.setItem(name, value);
        entry.result = result;
        // Keep the adapter's original return/error contract, while making an
        // identical retry eligible after an asynchronous storage failure.
        if (result && typeof (result as PromiseLike<unknown>).then === 'function') void Promise.resolve(result).catch(invalidate);
        return result;
      } catch (reason) { invalidate(); throw reason; }
    },
  };
}
