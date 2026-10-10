import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { captureLegacyBackup, validateBackup, importBackup, backupBlob, readBackup } from './migration';
import { CLOUD_DOCUMENT_KEYS, CloudConflictError, decodeBytes } from './runtime';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
const source = () => ({
  getDocument: async (key: string) => key === 'cellproject-config' ? JSON.stringify({ version: 4, state: { providers: { openrouter: { apiKey: 'LOCAL_TEST_KEY', mainModel: 'm' } } } }) : key === 'cellproject-workspace' ? JSON.stringify({ version: 2, state: { projects: { p: { attachments: [{ text: 'source' }], planner: { pendingSuggestions: { nodes: ['paid'] } } } } } }) : key === 'dynamic_diary-chat' ? JSON.stringify({ version: 1, state: { messages: [{ files: [{ text: 'code' }], references: [{ id: 'image' }], intake: { mode: 'extend' } }], pendingHistory: [] } }) : null,
  getPreference: (key: string) => key === 'dynamic_diary-theme' ? 'dark' : null,
  getMedia: async () => [{ id: 'image', mime: 'image/png', name: 'original.png', projectId: 'p', bytes: new Uint8Array([137, 80, 78, 71]).buffer }],
});
it('round-trips complete envelopes, preferences and all blobs with SHA256 without credential fields', async () => {
  const backup = await captureLegacyBackup(source());
  expect(backup.documents.find(item => item.key === 'dynamic_diary-chat')?.value).toContain('intake');
  expect(backup.documents.find(item => item.key === 'cellproject-workspace')?.value).toContain('paid');
  expect(JSON.stringify(backup)).not.toContain('LOCAL_TEST_KEY'); expect(backup.media[0].size).toBe(4);
  const restored = await readBackup(await backupBlob(backup)); expect(restored).toEqual(backup);
  expect([...new Uint8Array(decodeBytes(restored.media[0].base64))]).toEqual([137, 80, 78, 71]);
});
it('rejects altered documents or bytes before making import requests', async () => {
  const backup = await captureLegacyBackup(source());
  backup.documents[0].value = backup.documents[0].value.replace('paid', 'changed'); await expect(validateBackup(backup)).rejects.toThrow('integridade');
  const next = await captureLegacyBackup(source()); next.media[0].base64 = 'AA=='; await expect(validateBackup(next)).rejects.toThrow('integridade');
});
it('uploads bytes before importing envelopes, verifies independent readback and preserves source data', async () => {
  const backup = await captureLegacyBackup(source()); const calls: string[] = [];
  const fetcher = vi.fn(async (path: string, _init?: RequestInit) => {
    calls.push(path);
    if (path === '/api/cloud/media') return Response.json(backup.media[0]);
    if (path === '/api/cloud/import') return Response.json({ imported: true });
    if (path === '/api/cloud/snapshot') return Response.json({ documents: backup.documents.map(item => ({ ...item, revision: 1 })), media: backup.media });
    return new Response(decodeBytes(backup.media[0].base64));
  });
  await importBackup(backup, fetcher as typeof fetch);
  expect(calls.indexOf('/api/cloud/media')).toBeLessThan(calls.indexOf('/api/cloud/import'));
  expect(calls.at(-1)).toBe('/api/cloud/media/image');
  expect(JSON.parse(fetcher.mock.calls.find(([path]) => path === '/api/cloud/import')![1]!.body as string).manifestHash).toBe(backup.manifestHash);
});
it('stops on import conflict and fails if readback omits data instead of declaring success', async () => {
  const backup = await captureLegacyBackup(source());
  const conflict = vi.fn(async (path: string) => path === '/api/cloud/media' ? Response.json(backup.media[0]) : Response.json({}, { status: 409 }));
  await expect(importBackup(backup, conflict as typeof fetch)).rejects.toThrow('Conflito');
  const missing = vi.fn(async (path: string) => path === '/api/cloud/media' ? Response.json(backup.media[0]) : path === '/api/cloud/snapshot' ? Response.json({ documents: [], media: [] }) : Response.json({}));
  await expect(importBackup(backup, missing as typeof fetch)).rejects.toThrow('conferência');
});
it('preflights divergent documents before uploading any media', async () => {
  const backup = await captureLegacyBackup(source());
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ documents: [{ ...backup.documents[0], value: '{"state":{"projects":{"newer":{}}},"version":2}', revision: 2 }], media: [] }));
  await expect(importBackup(backup, fetcher)).rejects.toBeInstanceOf(CloudConflictError);
  expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][0]).toBe('/api/cloud/snapshot');
});
it('preserves every store, raw preferences and unreferenced originals in a global ZIP', async () => {
  const documents = new Map<string, string>(CLOUD_DOCUMENT_KEYS.slice(0, 6).map(key => [key, JSON.stringify({ version: 2, state: { futureField: { archives: ['keep'], references: [{ id: 'image' }], proposals: ['paid'] } } })]));
  const preferences: Record<string, string> = { 'dynamic_diary-theme': 'oled', 'dynamic_diary-sidebar-collapsed': 'false', 'dynamic_diary:task-view': 'list' };
  const original = source();
  const backup = await captureLegacyBackup({ getDocument: async key => documents.get(key) ?? null, getPreference: key => preferences[key] ?? null, getMedia: async () => [...await original.getMedia(), { id: 'orphan', mime: 'text/plain', name: 'source.ts', bytes: new TextEncoder().encode('unreferenced original').buffer }] });
  expect(backup.documents).toHaveLength(9); expect(backup.media).toHaveLength(2);
  expect(await readBackup(await backupBlob(backup))).toEqual(backup);
  for (const item of backup.documents) expect(item.value).toBe(documents.get(item.key) ?? preferences[item.key]);
  expect(backup.media.some(file => file.id === 'orphan')).toBe(true);
});
it('refuses media metadata conflicts before upload and can restore an originals-only backup', async () => {
  const original = source();
  const backup = await captureLegacyBackup({ ...original, getDocument: async () => null, getPreference: () => null });
  const conflict = vi.fn<typeof fetch>(async () => Response.json({ documents: [], media: [{ ...backup.media[0], name: 'another.png' }] }));
  await expect(importBackup(backup, conflict)).rejects.toBeInstanceOf(CloudConflictError); expect(conflict).toHaveBeenCalledOnce();
  let snapshots = 0;
  const fetcher = vi.fn<typeof fetch>(async path => String(path) === '/api/cloud/snapshot' ? Response.json({ documents: [], media: snapshots++ ? backup.media : [] }) : String(path) === '/api/cloud/media' ? Response.json(backup.media[0]) : new Response(decodeBytes(backup.media[0].base64)));
  await importBackup(backup, fetcher);
  expect(fetcher.mock.calls.some(([path]) => path === '/api/cloud/import')).toBe(false);
});
