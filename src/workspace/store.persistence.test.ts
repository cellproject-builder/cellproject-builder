import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { CloudRuntime, configureCloud } from '@/cloud/runtime';
import { selectedStorage } from '@/cloud/storage';
import { flushWorkspacePersistence, useWorkspaceStore } from './store';
import { hasDeferredPersistence, isDeferredJSONStorage } from '@/data/selectiveJSONStorage';

const key = 'cellproject-workspace';
const storage = () => useWorkspaceStore.persist.getOptions().storage!;
const envelope = () => ({ state: { ...useWorkspaceStore.getState() }, version: 2 });
const savedFolders = async () => JSON.parse((await idbGet<string>(key))!).state.folders;

beforeEach(async () => {
  configureCloud(null);
  await flushWorkspacePersistence();
  await useWorkspaceStore.persist.rehydrate();
  useWorkspaceStore.setState({ folders: {} });
  await flushWorkspacePersistence();
});

afterEach(async () => {
  vi.restoreAllMocks();
  configureCloud(null);
  await flushWorkspacePersistence();
});

describe('workspace persistence backend boundaries', () => {
  it('flushes an unacknowledged local edit before unload and warns only while pending', async () => {
    const note = useWorkspaceStore.getState().createNote({ title: 'Última edição local' });
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await flushWorkspacePersistence();
    expect(JSON.parse((await idbGet<string>(key))!).state.notes[note].title).toBe('Última edição local');
    const saved = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(saved);
    expect(saved.defaultPrevented).toBe(false);
  });

  it('flushes local edits when the page becomes hidden without waiting for the timer', async () => {
    const folder = useWorkspaceStore.getState().createFolder('Preservar ao ocultar');
    const adapter = storage();
    if (!isDeferredJSONStorage(adapter)) throw new Error('deferred adapter missing');
    const flush = vi.spyOn(adapter, 'flush');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(flush).toHaveBeenCalledOnce();
    await vi.waitFor(async () => expect((await savedFolders())[folder]?.name).toBe('Preservar ao ocultar'));
    expect(hasDeferredPersistence()).toBe(false);
  });

  it('coalesces note keystrokes before serialization and flushes the final envelope explicitly', async () => {
    const stringify = vi.spyOn(JSON, 'stringify');
    const note = useWorkspaceStore.getState().createNote({ title: 'Original' });
    for (let i = 0; i < 10; i++) useWorkspaceStore.getState().updateNote(note, { title: `Edição ${i}` });
    expect(stringify.mock.calls.filter(([value]) => value?.state?.notes?.[note])).toHaveLength(0);
    expect(hasDeferredPersistence()).toBe(true);
    await flushWorkspacePersistence();
    expect(stringify.mock.calls.filter(([value]) => value?.state?.notes?.[note])).toHaveLength(1);
    const saved = JSON.parse((await idbGet<string>(key))!);
    expect(saved.state.notes[note].title).toBe('Edição 9');
    expect(hasDeferredPersistence()).toBe(false);
  });

  it('does not acknowledge a cloud write whose runtime swallowed a network failure', async () => {
    const cloud = new CloudRuntime({ documents: [], media: [] }, async () => { throw new Error('Offline'); });
    configureCloud(cloud);
    await useWorkspaceStore.persist.rehydrate();
    const pending = storage().setItem(key, envelope());
    await expect(flushWorkspacePersistence()).rejects.toThrow();
    await expect(pending).rejects.toThrow();
    const adapter = storage();
    expect(isDeferredJSONStorage(adapter) && adapter.getSnapshot().pending).toBe(true);
    expect(isDeferredJSONStorage(adapter) && adapter.getSnapshot().error).toBeTruthy();
    // Restore network and acknowledge this captured owner's queue before changing scope.
    vi.spyOn(cloud, 'flush').mockResolvedValue();
    vi.spyOn(cloud, 'write').mockResolvedValue();
    await storage().setItem(key, envelope());
    await flushWorkspacePersistence();
  });

  it('acknowledges a durable encrypted checkpoint while remote delivery is offline', async () => {
    const persistence = { read: async <T,>() => null as T | null, write: vi.fn(async () => {}), remove: async () => {} };
    const cloud = new CloudRuntime({ documents: [], media: [] }, vi.fn(), undefined, undefined, { persistence, networkReady: () => false });
    configureCloud(cloud); await useWorkspaceStore.persist.rehydrate();
    const adapter = storage();
    if (!isDeferredJSONStorage(adapter)) throw new Error('deferred adapter missing');
    const pending = adapter.setItem(key, envelope());
    await adapter.flush(); await pending;
    expect(adapter.getSnapshot()).toMatchObject({ pending: false, error: null });
    expect(cloud.getSnapshot()).toMatchObject({ pending: 1, localSaved: true, localSaving: false, offline: true });
    expect(persistence.write).toHaveBeenCalled();
    // Explicit remote confirmation remains an error while offline; the checkpoint is retained.
    await expect(flushWorkspacePersistence()).rejects.toThrow('confirmação remota');
  });

  it('keeps an enqueued local workspace in IndexedDB when a cloud runtime takes over before the queue drains', async () => {
    const folder = useWorkspaceStore.getState().createFolder('Rascunho local privado');
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ revision: 1 }));
    const cloud = new CloudRuntime({ documents: [], media: [] }, fetcher);
    const write = vi.spyOn(cloud, 'write');
    // The local queue has not reached its first microtask yet.
    configureCloud(cloud);
    await flushWorkspacePersistence();
    expect(write).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await savedFolders()).toHaveProperty(folder, expect.objectContaining({ name: 'Rascunho local privado' }));
    expect(cloud.get(key)).toBeNull();
  });

  it('rejects a flush whose owner changed while its original backend was finishing', async () => {
    const folder = useWorkspaceStore.getState().createFolder('Preservar no destino original');
    const adapter = storage();
    if (!isDeferredJSONStorage(adapter)) throw new Error('deferred adapter missing');
    const originalFlush = adapter.flush;
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    vi.spyOn(adapter, 'flush').mockImplementationOnce(async () => { await originalFlush(); await gate; });
    const pending = flushWorkspacePersistence();
    await vi.waitFor(async () => expect((await savedFolders())[folder]?.name).toBe('Preservar no destino original'));
    const replacement = new CloudRuntime({ documents: [], media: [] }, vi.fn());
    const flush = vi.spyOn(replacement, 'flush'); configureCloud(replacement); finish();
    await expect(pending).rejects.toThrow('sessão de persistência mudou');
    expect(flush).not.toHaveBeenCalled(); expect(replacement.get(key)).toBeNull();
  });

  it('rejects a read that finishes after another runtime becomes the owner', async () => {
    const previous = envelope();
    let finish!: (value: string) => void;
    vi.spyOn(selectedStorage, 'getItem').mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    const pending = storage().getItem(key);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const cloud = new CloudRuntime({ documents: [], media: [] }, vi.fn());
    configureCloud(cloud);
    finish(JSON.stringify(previous));
    await expect(pending).rejects.toThrow('persistência');
    await expect(storage().getItem(key)).resolves.toBeNull();
  });

  it('surfaces a failed local write and supports an explicit flush retry of the same envelope', async () => {
    const value = envelope();
    value.state.folders = { retry: { id: 'retry', name: 'Salvar exatamente isto' } };
    const failure = new DOMException('Storage full', 'QuotaExceededError');
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw failure; });
    await expect(storage().setItem(key, value)).rejects.toBe(failure);
    await expect(flushWorkspacePersistence()).resolves.toBeUndefined();
    await expect(storage().setItem(key, value)).resolves.toBeUndefined();
    await expect(flushWorkspacePersistence()).resolves.toBeUndefined();
    expect(await savedFolders()).toHaveProperty('retry.name', 'Salvar exatamente isto');
  });

  it('preserves local write order and removes only the requested document', async () => {
    const first = envelope(), second = envelope();
    first.state.folders = { first: { id: 'first', name: 'Primeiro' } };
    second.state.folders = { second: { id: 'second', name: 'Segundo' } };
    await Promise.all([storage().setItem(key, first), storage().setItem(key, second)]);
    await flushWorkspacePersistence();
    expect(await savedFolders()).toEqual(second.state.folders);
    await idbSet('another-workspace-key', 'keep');
    await storage().removeItem(key);
    expect(await idbGet(key)).toBeUndefined();
    expect(await idbGet('another-workspace-key')).toBe('keep');
    configureCloud(new CloudRuntime({ documents: [], media: [] }, vi.fn()));
    await expect(storage().removeItem(key)).rejects.toThrow('ação de domínio');
  });
});
