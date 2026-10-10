import { get, set, del } from 'idb-keyval';
import type { StateStorage } from 'zustand/middleware';

/** Persistence stores the exact Zustand envelope; it does not own domain actions. */
export interface WorkspaceRepository {
  load(storageName: string): Promise<string | null>;
  save(storageName: string, serializedWorkspace: string): Promise<void>;
  remove(storageName: string): Promise<void>;
}

export class IndexedDbWorkspaceRepository implements WorkspaceRepository {
  async load(storageName: string): Promise<string | null> {
    return (await get<string>(storageName)) ?? null;
  }

  async save(storageName: string, serializedWorkspace: string): Promise<void> {
    await set(storageName, serializedWorkspace);
  }

  async remove(storageName: string): Promise<void> {
    await del(storageName);
  }
}

/** Write ordering and error presentation remain the store's responsibility. */
export function createWorkspaceStorage(repository: WorkspaceRepository): StateStorage {
  return {
    getItem: (name) => repository.load(name),
    setItem: (name, value) => repository.save(name, value),
    removeItem: (name) => repository.remove(name),
  };
}

/** Uses the same idb-keyval database/store and keys as the existing local app. */
export const workspaceRepository = createWorkspaceStorage(new IndexedDbWorkspaceRepository());
