import { clear, get, set } from 'idb-keyval';
import { afterEach, expect, it, vi } from 'vitest';
import { CloudRuntime, configureCloud, isCloudEnabled } from './runtime';
import { selectedStorage, readPreference, writePreference } from './storage';
afterEach(async () => { configureCloud(null); await clear(); localStorage.clear(); });
it('retains local behavior when disabled and never overwrites legacy values in cloud mode', async () => {
  await set('cellproject-kb', 'legacy'); expect(await selectedStorage.getItem('cellproject-kb')).toBe('legacy');
  const fetcher = vi.fn(async () => Response.json({ revision: 2 }));
  const remote = '{"state":{"docs":{}},"version":0}';
  const runtime = new CloudRuntime({ documents: [{ key: 'cellproject-kb', value: remote, revision: 1 }], media: [] }, fetcher); configureCloud(runtime);
  expect(await selectedStorage.getItem('cellproject-kb')).toBe(remote); await selectedStorage.setItem('cellproject-kb', 'remote edit');
  expect(await get('cellproject-kb')).toBe('legacy'); expect(runtime.get('cellproject-kb')).toBe('remote edit');
});
it('reads remote preferences before mounting and sends changes without using localStorage', async () => {
  localStorage.setItem('dynamic_diary-theme', 'light');
  const runtime = new CloudRuntime({ documents: [{ key: 'dynamic_diary-theme', value: 'dark', revision: 1 }], media: [] }, vi.fn(async () => Response.json({ revision: 2 }))); configureCloud(runtime);
  expect(readPreference('dynamic_diary-theme')).toBe('dark'); writePreference('dynamic_diary-theme', 'oled'); await runtime.flush();
  expect(localStorage.getItem('dynamic_diary-theme')).toBe('light'); expect(readPreference('dynamic_diary-theme')).toBe('oled');
});
it('keeps a disposed cloud selection closed until navigation, without falling back to legacy storage', async () => {
  await set('cellproject-kb', 'legacy'); localStorage.setItem('dynamic_diary-theme', 'light');
  const cloud = new CloudRuntime({ documents: [], media: [] }, vi.fn()); configureCloud(cloud); cloud.dispose();
  await selectedStorage.setItem('cellproject-kb', 'late callback'); writePreference('dynamic_diary-theme', 'oled');
  expect(isCloudEnabled()).toBe(true); expect(await selectedStorage.getItem('cellproject-kb')).toBeNull(); expect(readPreference('dynamic_diary-theme')).toBeNull();
  expect(await get('cellproject-kb')).toBe('legacy'); expect(localStorage.getItem('dynamic_diary-theme')).toBe('light');
});
