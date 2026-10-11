import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get as idbGet } from 'idb-keyval';
import type { StateStorage } from 'zustand/middleware';
import { selectedStorage } from '@/cloud/storage';
import { CloudRuntime, configureCloud } from '@/cloud/runtime';
import { EMPTY_OBJECTIVE_DRAFT, flushGraphPersistence, hasPendingGraphPersistence, useGraphStore } from './store';
import { flushWorkspacePersistence, useWorkspaceStore } from '@/workspace/store';

vi.mock('@/cloud/storage', async importOriginal => {
  const actual = await importOriginal<typeof import('@/cloud/storage')>();
  return { ...actual, selectedStorage: { ...actual.selectedStorage, getItem: vi.fn(actual.selectedStorage.getItem), setItem: vi.fn(actual.selectedStorage.setItem) } };
});

beforeEach(async () => {
  configureCloud(null);
  const actual = await vi.importActual<{ selectedStorage: StateStorage }>('@/cloud/storage');
  vi.mocked(selectedStorage.getItem).mockReset().mockImplementation(actual.selectedStorage.getItem);
  vi.mocked(selectedStorage.setItem).mockReset().mockImplementation(actual.selectedStorage.setItem);
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  useGraphStore.setState({ objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT } });
  useWorkspaceStore.setState({ notes: {} });
  await Promise.all([flushGraphPersistence(), flushWorkspacePersistence()]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  configureCloud(null);
  await Promise.all([flushGraphPersistence(), flushWorkspacePersistence()]);
});

const savedObjective = async () => JSON.parse((await idbGet<string>('cellproject-graph'))!).state.objectiveDraft.objective;
async function anotherOwner() {
  const document = JSON.parse((await idbGet<string>('cellproject-graph'))!);
  document.state.objectiveDraft.objective = 'Rascunho exclusivo de B';
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ revision: 2 }));
  const runtime = new CloudRuntime({ documents: [{ key: 'cellproject-graph', value: JSON.stringify(document), revision: 1 }], media: [] }, fetcher);
  configureCloud(runtime);
  return { runtime, fetcher };
}

describe('debounced graph persistence failures', () => {
  it('keeps a failed IndexedDB write pending and retries an identical snapshot on flush', async () => {
    useGraphStore.getState().setObjectiveDraft({ objective: 'Preservar exatamente este rascunho' });
    const failure = new DOMException('Storage full', 'QuotaExceededError');
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw failure; });
    await expect(flushGraphPersistence()).rejects.toBe(failure);
    expect(hasPendingGraphPersistence()).toBe(true);
    // UI updates have no changed content fields and the selective adapter skips them.
    useGraphStore.setState({ selectedNodeId: 'only-ui-changed' });
    await flushGraphPersistence();
    expect(await savedObjective()).toBe('Preservar exatamente este rascunho');
    expect(hasPendingGraphPersistence()).toBe(false);
  });

  it('does not replace a newer pending snapshot with an older failed write', async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(selectedStorage.setItem).mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    useGraphStore.getState().setObjectiveDraft({ objective: 'Antigo' });
    const pending = flushGraphPersistence();
    useGraphStore.getState().setObjectiveDraft({ objective: 'Mais recente' });
    reject(new Error('Older write failed'));
    await expect(pending).rejects.toThrow('Older write failed');
    await flushGraphPersistence();
    expect(await savedObjective()).toBe('Mais recente');
    expect(hasPendingGraphPersistence()).toBe(false);
  });

  it('does not requeue an older failure after a newer snapshot was already saved', async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(selectedStorage.setItem).mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    useGraphStore.getState().setObjectiveDraft({ objective: 'Antigo' });
    const pending = flushGraphPersistence();
    useGraphStore.getState().setObjectiveDraft({ objective: 'Novo já durável' });
    await flushGraphPersistence();
    reject(new Error('Late older failure'));
    await expect(pending).rejects.toThrow('Late older failure');
    expect(hasPendingGraphPersistence()).toBe(false);
    await flushGraphPersistence();
    expect(await savedObjective()).toBe('Novo já durável');
  });

  it('does not restore a deleted document when an earlier write fails late', async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(selectedStorage.setItem).mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    useGraphStore.getState().setObjectiveDraft({ objective: 'Excluir' });
    const pending = flushGraphPersistence();
    await useGraphStore.persist.getOptions().storage!.removeItem('cellproject-graph');
    reject(new Error('Write failed after removal'));
    await expect(pending).rejects.toThrow('Write failed after removal');
    expect(hasPendingGraphPersistence()).toBe(false);
    await flushGraphPersistence();
    expect(await idbGet('cellproject-graph')).toBeUndefined();
  });
});

describe('graph persistence owner boundaries', () => {
  it('hydrates only B and retains A when a queued local write meets a different runtime', async () => {
    useGraphStore.getState().setObjectiveDraft({ objective: 'Rascunho privado de A' });
    const { fetcher } = await anotherOwner();
    await useGraphStore.persist.rehydrate();
    expect(useGraphStore.getState().objectiveDraft.objective).toBe('Rascunho exclusivo de B');
    await expect(flushGraphPersistence()).rejects.toThrow('persistência');
    expect(hasPendingGraphPersistence()).toBe(true);
    expect(() => useGraphStore.getState().setObjectiveDraft({ objective: 'Novo rascunho de B' })).toThrow('persistência');
    expect(useGraphStore.getState().objectiveDraft.objective).toBe('Novo rascunho de B');
    expect(fetcher).not.toHaveBeenCalled();
    configureCloud(null);
    await flushGraphPersistence();
    expect(await savedObjective()).toBe('Rascunho privado de A');
  });

  it('does not expose or send a failed A retry while B owns the runtime', async () => {
    useGraphStore.getState().setObjectiveDraft({ objective: 'Falha privada de A' });
    const failure = new DOMException('Storage full', 'QuotaExceededError');
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw failure; });
    await expect(flushGraphPersistence()).rejects.toBe(failure);
    const { fetcher } = await anotherOwner();
    await useGraphStore.persist.rehydrate();
    expect(useGraphStore.getState().objectiveDraft.objective).toBe('Rascunho exclusivo de B');
    await expect(flushGraphPersistence()).rejects.toThrow('persistência');
    expect(fetcher).not.toHaveBeenCalled();
    configureCloud(null);
    await flushGraphPersistence();
    expect(await savedObjective()).toBe('Falha privada de A');
  });

  it('rejects a read that finishes after its original runtime was replaced', async () => {
    let finish!: (value: string) => void;
    vi.mocked(selectedStorage.getItem).mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    const read = useGraphStore.persist.getOptions().storage!.getItem('cellproject-graph');
    const { fetcher } = await anotherOwner();
    const previous = JSON.parse((await idbGet<string>('cellproject-graph'))!);
    previous.state.objectiveDraft.objective = 'Leitura antiga privada de A';
    finish(JSON.stringify(previous));
    await expect(read).rejects.toThrow('persistência');
    await useGraphStore.persist.rehydrate();
    expect(useGraphStore.getState().objectiveDraft.objective).toBe('Rascunho exclusivo de B');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['enqueue', 'remove', 'flush'] as const)('rejects B %s while A is in flight and retains A after its late failure', async operation => {
    let reject!: (reason: Error) => void;
    vi.mocked(selectedStorage.setItem).mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    useGraphStore.getState().setObjectiveDraft({ objective: 'A aguardando confirmação' });
    const pending = flushGraphPersistence().catch(error => error);
    const { fetcher } = await anotherOwner();
    let problem: unknown;
    try {
      if (operation === 'enqueue') useGraphStore.getState().setObjectiveDraft({ objective: 'B deve ficar apenas em RAM' });
      else if (operation === 'remove') await useGraphStore.persist.getOptions().storage!.removeItem('cellproject-graph');
      else await flushGraphPersistence();
    } catch (error) { problem = error; }
    reject(new Error('Late A write failure'));
    expect(await pending).toMatchObject({ message: 'Late A write failure' });
    expect(problem).toBeInstanceOf(Error);
    expect((problem as Error).message).toContain('persistência');
    await expect(flushGraphPersistence()).rejects.toThrow('persistência');
    expect(fetcher).not.toHaveBeenCalled();
    configureCloud(null);
    await flushGraphPersistence();
    expect(await savedObjective()).toBe('A aguardando confirmação');
  });
});

it('retries the exact same workspace snapshot after an IndexedDB failure', async () => {
  const failure = new DOMException('Storage full', 'QuotaExceededError');
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw failure; });
  const note = useWorkspaceStore.getState().createNote({ title: 'Nota preservada' });
  await expect(flushWorkspacePersistence()).rejects.toBe(failure);
  useWorkspaceStore.setState({});
  await flushWorkspacePersistence();
  expect(JSON.parse((await idbGet<string>('cellproject-workspace'))!).state.notes[note].title).toBe('Nota preservada');
});
