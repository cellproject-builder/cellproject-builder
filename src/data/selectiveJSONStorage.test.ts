import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StateStorage } from 'zustand/middleware';
import { createSelectiveJSONStorage } from './selectiveJSONStorage';

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
