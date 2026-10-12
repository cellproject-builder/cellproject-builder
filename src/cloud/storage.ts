import { get, set, del } from 'idb-keyval';
import type { StateStorage } from 'zustand/middleware';
import { getCloudRuntime } from './runtime';
import { demoStorage, isPublicDemo } from '@/demo/session';

/** Selection happens in bootstrap before importing any persisted store. */
export const selectedStorage: StateStorage = {
  getItem: async name => { if (isPublicDemo()) return demoStorage.getItem(name); const cloud = getCloudRuntime(); return cloud ? cloud.get(name) : (await get<string>(name)) ?? null; },
  setItem: async (name, value) => { if (isPublicDemo()) { demoStorage.setItem(name, value); return; } const cloud = getCloudRuntime(); if (cloud) await cloud.write(name, value); else await set(name, value); },
  removeItem: async name => { if (isPublicDemo()) { demoStorage.removeItem(name); return; } if (getCloudRuntime()) throw new Error('A remoção da persistência remota requer uma ação de domínio explícita.'); await del(name); },
};
export function readPreference(key: string): string | null { if (isPublicDemo()) return demoStorage.getItem(key); const cloud = getCloudRuntime(); if (cloud) return cloud.get(key); try { return localStorage.getItem(key); } catch { return null; } }
export function writePreference(key: string, value: string) { if (isPublicDemo()) { demoStorage.setItem(key, value); return; } const cloud = getCloudRuntime(); if (cloud) { void cloud.write(key, value); return; } try { localStorage.setItem(key, value); } catch { /* Session preference still works. */ } }
