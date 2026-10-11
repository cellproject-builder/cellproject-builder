import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { CloudRuntime, configureCloud } from '@/cloud/runtime';
import { selectedStorage } from '@/cloud/storage';
import { flushWorkspacePersistence, useWorkspaceStore } from './store';

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

  it('rejects a read that finishes after another runtime becomes the owner', async () => {
    const previous = envelope();
    let finish!: (value: string) => void;
    vi.spyOn(selectedStorage, 'getItem').mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    const pending = storage().getItem(key);
    const cloud = new CloudRuntime({ documents: [], media: [] }, vi.fn());
    configureCloud(cloud);
    finish(JSON.stringify(previous));
    await expect(pending).rejects.toThrow('persistência');
    await expect(storage().getItem(key)).resolves.toBeNull();
  });

  it('continues to surface a failed local write and allows the exact same envelope to retry', async () => {
    const value = envelope();
    value.state.folders = { retry: { id: 'retry', name: 'Salvar exatamente isto' } };
    const failure = new DOMException('Storage full', 'QuotaExceededError');
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw failure; });
    await expect(storage().setItem(key, value)).rejects.toBe(failure);
    await expect(flushWorkspacePersistence()).rejects.toBe(failure);
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
