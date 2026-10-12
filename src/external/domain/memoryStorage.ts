import type { StateStorage } from 'zustand/middleware';
import type { CloudSnapshot } from '@/cloud/runtime';

const values = new Map<string, string>();
/** The worker has no browser, database, network or account persistence port. */
export const selectedStorage: StateStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value); },
  removeItem: key => { values.delete(key); },
};
export const workspaceRepository = selectedStorage;
export class IndexedDbWorkspaceRepository {
  async load(key: string) { return values.get(key) ?? null; }
  async save(key: string, value: string) { values.set(key, value); }
  async remove(key: string) { values.delete(key); }
}
export function createWorkspaceStorage(repository: IndexedDbWorkspaceRepository): StateStorage {
  return { getItem: key => repository.load(key), setItem: (key, value) => repository.save(key, value), removeItem: key => repository.remove(key) };
}
export function readPreference(key: string) { return values.get(key) ?? null; }
export function writePreference(key: string, value: string) { values.set(key, value); }
export function seedMemory(snapshot: CloudSnapshot) {
  values.clear();
  for (const document of snapshot.documents) values.set(document.key, document.value);
}
