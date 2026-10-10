import { afterEach, describe, expect, it, vi } from 'vitest';
import { del, get, set } from 'idb-keyval';
import { IndexedDbWorkspaceRepository, createWorkspaceStorage, workspaceRepository } from './workspaceRepository';

afterEach(() => vi.restoreAllMocks());

describe('workspace persistence boundary', () => {
  it('reads the existing Zustand key without parsing or rewriting its raw JSON', async () => {
    const existing = ' { "state": {"projects":{},"notes":{"n":{"title":"Diário"}},"futureField":true}, "version": 1 } ';
    await set('cellproject-workspace', existing);
    expect(await workspaceRepository.getItem('cellproject-workspace')).toBe(existing);
    expect(await get('cellproject-workspace')).toBe(existing);
  });

  it('writes and removes only the requested storage name', async () => {
    const storage = createWorkspaceStorage(new IndexedDbWorkspaceRepository());
    await set('another-store', 'keep');
    await del('workspace-test');
    expect(await storage.getItem('workspace-test')).toBeNull();
    await storage.setItem('workspace-test', '{"state":{"legacyImported":true},"version":1}');
    expect(await get('workspace-test')).toBe('{"state":{"legacyImported":true},"version":1}');
    await storage.removeItem('workspace-test');
    expect(await storage.getItem('workspace-test')).toBeNull();
    expect(await get('another-store')).toBe('keep');
  });

  it.each(['get', 'put', 'delete'] as const)('propagates IndexedDB %s errors to the caller', async (method) => {
    const failure = new DOMException('Storage unavailable', 'InvalidStateError');
    vi.spyOn(IDBObjectStore.prototype, method).mockImplementationOnce(() => { throw failure; });
    const operation = method === 'get' ? workspaceRepository.getItem('failure')
      : method === 'put' ? workspaceRepository.setItem('failure', 'payload')
      : workspaceRepository.removeItem('failure');
    await expect(operation).rejects.toBe(failure);
  });
});
