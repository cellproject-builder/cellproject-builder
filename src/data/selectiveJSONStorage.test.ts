import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StateStorage } from 'zustand/middleware';
import { createSelectiveJSONStorage, flushDeferredPersistences, getDeferredPersistenceSnapshot, hasDeferredPersistence, isDeferredJSONStorage } from './selectiveJSONStorage';
import * as deferredPersistence from './selectiveJSONStorage';

afterEach(() => vi.restoreAllMocks());
const envelope = (content = { text: 'Preservar' }, selection = 'a', version = 1) => ({ state: { content, selection }, version });
const backend = (): StateStorage => ({ getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() });

describe('selective JSON persistence', () => {
  it('skips serialization before storage when immutable selected fields are unchanged', () => {
    const raw = backend(), storage = createSelectiveJSONStorage<ReturnType<typeof envelope>['state']>(() => raw, { select: state => [state.content] })!;
    const first = envelope(), stringify = vi.spyOn(JSON, 'stringify');
    storage.setItem('workspace', first);
    storage.setItem('workspace', { ...first, state: { ...first.state, selection: 'b' } });
    expect(stringify).toHaveBeenCalledOnce();
    expect(raw.setItem).toHaveBeenCalledWith('workspace', JSON.stringify(first));
    storage.setItem('workspace', envelope({ text: 'Conteúdo novo' }));
    expect(raw.setItem).toHaveBeenCalledTimes(2);
  });

  it('returns the original in-flight write for an identical snapshot so awaiting still means durable', async () => {
    const raw = backend(); let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    vi.mocked(raw.setItem).mockReturnValue(pending);
    const storage = createSelectiveJSONStorage(() => raw)!, value = envelope();
    const first = storage.setItem('workspace', value), duplicate = storage.setItem('workspace', { ...value, state: { ...value.state } });
    expect(duplicate).toBe(first);
    expect(duplicate).toBe(pending);
    expect(raw.setItem).toHaveBeenCalledOnce();
    finish(); await duplicate;
  });

  it.each(['sync', 'async'])('allows retry of the exact same snapshot after a %s storage failure', async mode => {
    const raw = backend(), failure = new Error('Storage full');
    vi.mocked(raw.setItem).mockImplementationOnce(() => { if (mode === 'sync') throw failure; return Promise.reject(failure); });
    const storage = createSelectiveJSONStorage(() => raw)!, value = envelope();
    if (mode === 'sync') expect(() => storage.setItem('workspace', value)).toThrow(failure);
    else await expect(storage.setItem('workspace', value)).rejects.toBe(failure);
    await storage.setItem('workspace', value);
    expect(raw.setItem).toHaveBeenCalledTimes(2);
  });

  it('invalidates the write cache on hydration, removal, version or storage-owner changes', async () => {
    const raw = backend(); let scope: unknown = {};
    const storage = createSelectiveJSONStorage(() => raw, { scope: () => scope })!, value = envelope();
    storage.setItem('workspace', value);
    await storage.getItem('workspace');
    storage.setItem('workspace', value);
    await storage.removeItem('workspace');
    storage.setItem('workspace', value);
    storage.setItem('workspace', { ...value, version: 2 });
    scope = {};
    storage.setItem('workspace', { ...value, version: 2 });
    expect(raw.setItem).toHaveBeenCalledTimes(5);
    expect(raw.removeItem).toHaveBeenCalledWith('workspace');
  });

  it('does not let rejection of an older write invalidate a newer queued snapshot', async () => {
    const raw = backend(); let reject!: (reason: Error) => void;
    vi.mocked(raw.setItem).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    const storage = createSelectiveJSONStorage(() => raw)!, first = envelope(), newer = envelope({ text: 'Mais recente' });
    const pending = storage.setItem('workspace', first);
    storage.setItem('workspace', newer);
    reject(new Error('Old write failed')); await expect(pending).rejects.toThrow('Old write failed');
    storage.setItem('workspace', newer);
    expect(raw.setItem).toHaveBeenCalledTimes(2);
  });
});

describe('deferred JSON persistence', () => {
  it('coalesces before serialization, preserves the await contract, and has a bounded window', async () => {
    vi.useFakeTimers();
    try {
      const raw = backend(), storage = createSelectiveJSONStorage(() => raw, { deferMs: 200 })!;
      expect(isDeferredJSONStorage(storage)).toBe(true);
      if (!isDeferredJSONStorage(storage)) throw new Error('deferred adapter missing');
      const stringify = vi.spyOn(JSON, 'stringify');
      const first = storage.setItem('workspace', envelope({ text: 'a' }));
      await vi.advanceTimersByTimeAsync(150);
      const last = storage.setItem('workspace', envelope({ text: 'latest' }));
      expect(stringify).not.toHaveBeenCalled();
      expect(raw.setItem).not.toHaveBeenCalled();
      expect(storage.hasPending()).toBe(true);
      expect(hasDeferredPersistence()).toBe(true);
      await vi.advanceTimersByTimeAsync(50);
      await Promise.all([first, last]);
      expect(stringify).toHaveBeenCalledOnce();
      expect(raw.setItem).toHaveBeenCalledWith('workspace', expect.stringContaining('latest'));
      expect(storage.getSnapshot()).toMatchObject({ pending: false, error: null });
    } finally { vi.useRealTimers(); }
  });

  it('keeps saving until the captured backend acknowledges and drains explicitly before a read', async () => {
    const raw = backend(); let finish!: () => void;
    vi.mocked(raw.setItem).mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    vi.mocked(raw.getItem).mockImplementation(() => JSON.stringify(envelope({ text: 'latest' })));
    const storage = createSelectiveJSONStorage(() => raw, { deferMs: 200 })!;
    if (!isDeferredJSONStorage(storage)) throw new Error('deferred adapter missing');
    const write = storage.setItem('workspace', envelope({ text: 'latest' }));
    const read = storage.getItem('workspace');
    await Promise.resolve();
    expect(raw.setItem).toHaveBeenCalledOnce();
    expect(raw.getItem).not.toHaveBeenCalled();
    expect(storage.getSnapshot().pending).toBe(true);
    finish(); await write;
    await expect(read).resolves.toEqual(envelope({ text: 'latest' }));
    expect(storage.getSnapshot().pending).toBe(false);
  });

  it('retains a rejected snapshot and retries an identical value without losing newer edits', async () => {
    const raw = backend(), failure = new Error('Storage full');
    vi.mocked(raw.setItem).mockRejectedValueOnce(failure);
    const storage = createSelectiveJSONStorage(() => raw, { deferMs: 200 })!;
    if (!isDeferredJSONStorage(storage)) throw new Error('deferred adapter missing');
    const value = envelope(), pending = storage.setItem('workspace', value);
    await expect(storage.flush()).rejects.toBe(failure);
    await expect(pending).rejects.toBe(failure);
    expect(storage.getSnapshot()).toMatchObject({ pending: true, error: failure });
    const retry = storage.setItem('workspace', value);
    await flushDeferredPersistences(); await retry;
    expect(raw.setItem).toHaveBeenCalledTimes(2);
    expect(storage.hasPending()).toBe(false);
  });

  it('retries a failed snapshot only when explicitly flushed and gives the retry a fresh acknowledgement', async () => {
    vi.useFakeTimers();
    try {
      const raw = backend(), failure = new Error('Temporary storage failure');
      vi.mocked(raw.setItem).mockRejectedValueOnce(failure);
      const storage = createSelectiveJSONStorage(() => raw, { deferMs: 200 })!;
      if (!isDeferredJSONStorage(storage)) throw new Error('deferred adapter missing');
      const value = envelope(), first = storage.setItem('workspace', value);
      await vi.advanceTimersByTimeAsync(200);
      await expect(first).rejects.toBe(failure);
      await vi.advanceTimersByTimeAsync(1000);
      expect(raw.setItem).toHaveBeenCalledOnce();
      const flushing = storage.flush(), retry = storage.setItem('workspace', value);
      expect(retry).not.toBe(first);
      await Promise.all([flushing, retry]);
      await expect(first).rejects.toBe(failure);
      expect(raw.setItem).toHaveBeenCalledTimes(2);
      expect(storage.getSnapshot()).toMatchObject({ pending: false, error: null });
    } finally { vi.useRealTimers(); }
  });

  it('keeps a failed explicit retry pending without starting an automatic retry loop', async () => {
    vi.useFakeTimers();
    try {
      const raw = backend(), failure = new Error('Still unavailable');
      vi.mocked(raw.setItem).mockRejectedValue(failure);
      const storage = createSelectiveJSONStorage(() => raw, { deferMs: 200 })!;
      if (!isDeferredJSONStorage(storage)) throw new Error('deferred adapter missing');
      const first = storage.setItem('workspace', envelope());
      await vi.advanceTimersByTimeAsync(200); await expect(first).rejects.toBe(failure);
      await expect(storage.flush()).rejects.toBe(failure);
      await vi.advanceTimersByTimeAsync(1000);
      expect(raw.setItem).toHaveBeenCalledTimes(2);
      expect(storage.getSnapshot()).toMatchObject({ pending: true, error: failure });
      vi.mocked(raw.setItem).mockResolvedValue(undefined);
      await storage.flush();
    } finally { vi.useRealTimers(); }
  });

  it('drains a newer edit after an explicit retry without replacing its pending acknowledgement', async () => {
    const raw = backend(), failure = new Error('First attempt failed'); let finish!: () => void;
    vi.mocked(raw.setItem).mockRejectedValueOnce(failure)
      .mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const storage = createSelectiveJSONStorage(() => raw, { deferMs: 200 })!;
    if (!isDeferredJSONStorage(storage)) throw new Error('deferred adapter missing');
    const first = storage.setItem('workspace', envelope({ text: 'first' }));
    await expect(storage.flush()).rejects.toBe(failure); await expect(first).rejects.toBe(failure);
    const retrying = storage.flush();
    await Promise.resolve();
    const newer = storage.setItem('workspace', envelope({ text: 'newer' }));
    expect(finish).toBeTypeOf('function'); finish();
    await Promise.all([retrying, newer]);
    expect(raw.setItem).toHaveBeenCalledTimes(3);
    expect(vi.mocked(raw.setItem).mock.calls[2][1]).toContain('newer');
    expect(storage.getSnapshot()).toMatchObject({ pending: false, error: null });
  });

  it('publishes a new global revision for a newer edit while persistence is already pending', async () => {
    const raw = backend(), storage = createSelectiveJSONStorage(() => raw, { deferMs: 200 })!;
    if (!isDeferredJSONStorage(storage)) throw new Error('deferred adapter missing');
    const first = storage.setItem('workspace', envelope({ text: 'first' }));
    const before = getDeferredPersistenceSnapshot();
    const value = envelope({ text: 'newer' }), newer = storage.setItem('workspace', value);
    const after = getDeferredPersistenceSnapshot();
    const duplicate = storage.setItem('workspace', value);
    await storage.flush(); await Promise.all([first, newer, duplicate]);
    expect(before.pending).toBe(true); expect(after.pending).toBe(true);
    expect(after).not.toBe(before);
    expect(after.revision).toBeGreaterThan(before.revision);
  });

  it('binds queued writes to their original backend and refuses another owner until they settle', async () => {
    const local = backend(), cloud = backend(); let owner: unknown = local;
    const storage = createSelectiveJSONStorage(() => local, { deferMs: 200, scope: () => owner, captureStorage: () => owner === local ? local : cloud })!;
    if (!isDeferredJSONStorage(storage)) throw new Error('deferred adapter missing');
    const first = storage.setItem('workspace', envelope()); owner = cloud;
    expect(() => storage.setItem('workspace', envelope({ text: 'other account' }))).toThrow('persistência');
    await storage.flush(); await first;
    expect(local.setItem).toHaveBeenCalledOnce(); expect(cloud.setItem).not.toHaveBeenCalled();
    const next = storage.setItem('workspace', envelope({ text: 'other account' }));
    await storage.flush(); await next;
    expect(cloud.setItem).toHaveBeenCalledOnce();
  });

  it('never returns another owner snapshot after the original scope is restored during a read', async () => {
    const local = backend(), cloud = backend(), localValue = envelope({ text: 'local document' });
    let owner: unknown = local, read!: (value: string) => void;
    vi.mocked(local.getItem).mockReturnValueOnce(new Promise<string>(resolve => { read = resolve; }))
      .mockReturnValue(JSON.stringify(localValue));
    const storage = createSelectiveJSONStorage(() => local, { deferMs: 200, scope: () => owner, captureStorage: () => owner === local ? local : cloud })!;
    if (!isDeferredJSONStorage(storage)) throw new Error('deferred adapter missing');
    const reading = storage.getItem('workspace'); await vi.waitFor(() => expect(local.getItem).toHaveBeenCalledOnce());
    owner = cloud;
    const otherOwnerWrite = storage.setItem('workspace', envelope({ text: 'private cloud document' }));
    owner = local; read(JSON.stringify(localValue));
    const result = await reading; await storage.flush(); await otherOwnerWrite;
    expect(result).toEqual(localValue);
    expect(cloud.setItem).toHaveBeenCalledOnce(); expect(local.setItem).not.toHaveBeenCalled();
  });

  it('orders removal after an in-flight write and never resurrects the removed document', async () => {
    const raw = backend(); let finish!: () => void;
    vi.mocked(raw.setItem).mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    const storage = createSelectiveJSONStorage(() => raw, { deferMs: 200 })!;
    if (!isDeferredJSONStorage(storage)) throw new Error('deferred adapter missing');
    const write = storage.setItem('workspace', envelope()), flush = storage.flush();
    const remove = storage.removeItem('workspace');
    await Promise.resolve(); expect(raw.removeItem).not.toHaveBeenCalled();
    finish(); await Promise.all([write, flush, remove]);
    expect(raw.removeItem).toHaveBeenCalledOnce(); expect(storage.hasPending()).toBe(false);
  });

  it('does not return a removed document from a read that started before removal', async () => {
    const raw = backend(), oldValue = JSON.stringify(envelope()); let saved: string | null = oldValue, read!: (value: string) => void;
    vi.mocked(raw.getItem).mockReturnValueOnce(new Promise<string>(resolve => { read = resolve; }))
      .mockImplementation(() => saved);
    vi.mocked(raw.removeItem).mockImplementation(() => { saved = null; });
    const storage = createSelectiveJSONStorage(() => raw, { deferMs: 200 })!;
    const reading = storage.getItem('workspace'); await vi.waitFor(() => expect(raw.getItem).toHaveBeenCalledOnce());
    await storage.removeItem('workspace'); read(oldValue);
    await expect(reading).resolves.toBeNull();
  });

  it('persists edits made during an in-flight failure in order and keeps the newer acknowledgement pending', async () => {
    const raw = backend(); let reject!: (reason: Error) => void, finish!: () => void;
    vi.mocked(raw.setItem).mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }))
      .mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const storage = createSelectiveJSONStorage(() => raw, { deferMs: 200 })!;
    if (!isDeferredJSONStorage(storage)) throw new Error('deferred adapter missing');
    const first = storage.setItem('workspace', envelope({ text: 'first' })), flushing = storage.flush();
    await Promise.resolve();
    const last = storage.setItem('workspace', envelope({ text: 'latest' }));
    reject(new Error('Old failure'));
    await expect(first).rejects.toThrow('Old failure');
    await vi.waitFor(() => expect(raw.setItem).toHaveBeenCalledTimes(2));
    expect(storage.getSnapshot()).toMatchObject({ pending: true, error: null });
    finish(); await Promise.all([last, flushing]);
    expect(storage.hasPending()).toBe(false);
    expect(vi.mocked(raw.setItem).mock.calls[1][1]).toContain('latest');
  });

  it('returns a cloned newer acknowledged edit when an earlier hydration read is pending', async () => {
    const raw = backend(); let read!: (value: string) => void, acknowledge!: () => void;
    vi.mocked(raw.getItem).mockReturnValueOnce(new Promise<string>(resolve => { read = resolve; }));
    vi.mocked(raw.setItem).mockReturnValueOnce(new Promise<void>(resolve => { acknowledge = resolve; }));
    const storage = createSelectiveJSONStorage<ReturnType<typeof envelope>['state']>(() => raw, { deferMs: 200 })!;
    if (!isDeferredJSONStorage(storage)) throw new Error('deferred adapter missing');
    const reading = Promise.resolve(storage.getItem('workspace')); await vi.waitFor(() => expect(raw.getItem).toHaveBeenCalledOnce());
    let readSettled = false; void reading.then(() => { readSettled = true; });
    const value = envelope({ text: 'new edit' }), pending = storage.setItem('workspace', value);
    read(JSON.stringify(envelope({ text: 'old saved' })));
    await vi.waitFor(() => expect(raw.setItem).toHaveBeenCalledOnce());
    expect(readSettled).toBe(false);
    acknowledge(); const result = await reading;
    await storage.flush(); await pending;
    expect(result).toEqual(value);
    expect(result?.state.content).not.toBe(value.state.content);
    expect(raw.setItem).toHaveBeenCalledWith('workspace', expect.stringContaining('new edit'));
    expect(storage.hasPending()).toBe(false);
  });
});

describe('deferred persistence rescue capture', () => {
  it('captures an empty pending set and invalidates it when a new edit is enqueued', async () => {
    const token = deferredPersistence.captureDeferredPersistence({}, () => null);
    expect(token).toBeDefined();
    if (!token) return;
    expect(deferredPersistence.isDeferredPersistenceCaptureCurrent(token)).toBe(true);
    const raw = backend(), storage = createSelectiveJSONStorage(() => raw, { deferMs: 200 })!;
    if (!isDeferredJSONStorage(storage)) throw new Error('deferred adapter missing');
    const pending = storage.setItem('workspace', envelope());
    expect(deferredPersistence.isDeferredPersistenceCaptureCurrent(token)).toBe(false);
    expect(deferredPersistence.acknowledgeDeferredPersistenceCapture(token)).toBe(false);
    expect(storage.hasPending()).toBe(true);
    await storage.flush(); await pending;
    const clean = deferredPersistence.captureDeferredPersistence({}, () => null)!;
    expect(deferredPersistence.acknowledgeDeferredPersistenceCapture(clean)).toBe(true);
    expect(deferredPersistence.acknowledgeDeferredPersistenceCapture(clean)).toBe(false);
  });

  async function failed(owner: unknown, value = envelope()) {
    const raw = backend(), failure = new Error('Backend unavailable');
    vi.mocked(raw.setItem).mockRejectedValueOnce(failure);
    const storage = createSelectiveJSONStorage(() => raw, { deferMs: 200, scope: () => owner })!;
    if (!isDeferredJSONStorage(storage)) throw new Error('deferred adapter missing');
    const write = storage.setItem('workspace', value);
    await expect(storage.flush()).rejects.toBe(failure); await expect(write).rejects.toBe(failure);
    return { raw, storage, value, write, failure };
  }

  it('acknowledges only an exact failed snapshot for its owner and consumes its opaque token', async () => {
    const owner = {}, { raw, storage, value, write, failure } = await failed(owner);
    expect(deferredPersistence.captureDeferredPersistence({}, () => JSON.stringify(value))).toBeUndefined();
    expect(deferredPersistence.captureDeferredPersistence(owner, () => '{invalid')).toBeUndefined();
    const token = deferredPersistence.captureDeferredPersistence(owner, () => JSON.stringify(value));
    expect(token).toBeDefined();
    expect(deferredPersistence.isDeferredPersistenceCaptureCurrent(token!)).toBe(true);
    expect(deferredPersistence.acknowledgeDeferredPersistenceCapture(token!)).toBe(true);
    expect(storage.hasPending()).toBe(false);
    expect(raw.setItem).toHaveBeenCalledOnce();
    expect(deferredPersistence.acknowledgeDeferredPersistenceCapture(token!)).toBe(false);
    await expect(write).rejects.toBe(failure);
    const next = storage.setItem('workspace', value);
    expect(next).not.toBe(write); await storage.flush(); await next;
    expect(raw.setItem).toHaveBeenCalledTimes(2);
  });

  it('refuses queued and writing snapshots that have not failed', async () => {
    const owner = {}, raw = backend(), value = envelope(); let finish!: () => void;
    vi.mocked(raw.setItem).mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
    const storage = createSelectiveJSONStorage(() => raw, { deferMs: 200, scope: () => owner })!;
    if (!isDeferredJSONStorage(storage)) throw new Error('deferred adapter missing');
    const write = storage.setItem('workspace', value);
    expect(deferredPersistence.captureDeferredPersistence(owner, () => JSON.stringify(value))).toBeUndefined();
    const flushing = storage.flush(); await Promise.resolve();
    expect(deferredPersistence.captureDeferredPersistence(owner, () => JSON.stringify(value))).toBeUndefined();
    finish(); await Promise.all([write, flushing]);
  });

  it('rejects a capture after a newer edit and preserves the newer pending write', async () => {
    const owner = {}, { raw, storage, value } = await failed(owner);
    const token = deferredPersistence.captureDeferredPersistence(owner, () => JSON.stringify(value))!;
    const newer = storage.setItem('workspace', envelope({ text: 'newer edit' }));
    expect(deferredPersistence.isDeferredPersistenceCaptureCurrent(token)).toBe(false);
    expect(deferredPersistence.acknowledgeDeferredPersistenceCapture(token)).toBe(false);
    expect(storage.hasPending()).toBe(true);
    await storage.flush(); await newer;
    expect(vi.mocked(raw.setItem).mock.calls.at(-1)?.[1]).toContain('newer edit');
  });

  it('rejects a capture when an explicit retry replaced the failed entry at the same revision', async () => {
    const owner = {}, { storage, value } = await failed(owner);
    const token = deferredPersistence.captureDeferredPersistence(owner, () => JSON.stringify(value))!;
    const retrying = storage.flush();
    expect(deferredPersistence.isDeferredPersistenceCaptureCurrent(token)).toBe(false);
    expect(deferredPersistence.acknowledgeDeferredPersistenceCapture(token)).toBe(false);
    await retrying;
  });

  it('requires every pending adapter to belong to the captured owner', async () => {
    const owner = {}, first = await failed(owner), second = await failed({});
    expect(deferredPersistence.captureDeferredPersistence(owner, () => JSON.stringify(first.value))).toBeUndefined();
    await Promise.all([first.storage.flush(), second.storage.flush()]);
  });

  it('rechecks the exact JSON at acknowledgement and rejects a forged token', async () => {
    const owner = {}, { storage, value } = await failed(owner);
    const token = deferredPersistence.captureDeferredPersistence(owner, () => JSON.stringify(value))!;
    value.state.content.text = 'changed outside the captured snapshot';
    expect(deferredPersistence.isDeferredPersistenceCaptureCurrent(token)).toBe(false);
    expect(deferredPersistence.acknowledgeDeferredPersistenceCapture(token)).toBe(false);
    expect(deferredPersistence.acknowledgeDeferredPersistenceCapture({ revision: token.revision } as typeof token)).toBe(false);
    expect(storage.hasPending()).toBe(true); await storage.flush();
  });
});
