import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({ slots: new Map<string, unknown>(), authorization: null as any, leased: false, failRecoveredRuntime: false }));
const canvas = vi.hoisted(() => ({ idle: true, apply: vi.fn() }));
vi.mock('../CloudLiveSync', () => ({ cloudCanvasIdle: () => canvas.idle, applyRemoteCanvasDocuments: canvas.apply }));
vi.mock('./repository', () => ({
  OfflineRepository: class {
    async read(slot: string) { return structuredClone(storage.slots.get(slot) ?? null); }
    async write(slot: string, value: any) { if (storage.failRecoveredRuntime && slot === 'runtime' && value.confirmed.documents.some((doc: any) => doc.key === 'cellproject-workspace')) throw new Error('synthetic adoption quota'); storage.slots.set(slot, structuredClone(value)); }
    async remove(slot: string) { storage.slots.delete(slot); }
    async settled() {}
  },
  readOfflineAuthorization: async () => storage.authorization,
  authorizeOffline: async (value: unknown) => { storage.authorization = structuredClone(value); },
  revokeOfflineAuthorization: async () => { storage.authorization = null; },
  acquireOfflineLease: async () => { if (storage.leased) return null; storage.leased = true; return () => { storage.leased = false; }; },
}));
import { createVault } from '../vault/crypto';
import { readDeviceVault, rememberDeviceVault } from '../vault/deviceKeys';
import { VaultTransport } from '../vault/transport';
import { prepareOfflineWorkspace, openOfflineWorkspace } from './session';
import type { CloudConfig } from '../runtime';

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); storage.slots.clear(); storage.authorization = null; storage.leased = false; storage.failRecoveredRuntime = false; canvas.idle = true; canvas.apply.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function fixture() {
  const keys = await createVault(crypto.randomUUID(), 'synthetic offline test password');
  await rememberDeviceVault(keys.session);
  const snapshot = { documents: [{ key: 'dynamic_diary-theme', value: 'dark', revision: 1 }], media: [] };
  const head = { header: keys.header, revision: 1, manifest: await keys.session.seal(JSON.stringify({ snapshot, files: {} }), 'manifest:1') };
  const config: CloudConfig = { enabled: true, authenticated: true, user: { id: keys.session.ownerId, email: 'wylgnerbossman@gmail.com' }, vaultAvailable: true };
  return { keys, head, config };
}
function remoteServer(config: CloudConfig, first: Awaited<ReturnType<typeof fixture>>['head']) {
  let head = first, lose = false;
  const replies = new Map<string, number>(), puts: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (path, init) => {
    if (path === '/api/cloud/config') return Response.json(config);
    if (path === '/api/cloud/vault' && init?.method !== 'PUT') return Response.json(head);
    if (path === '/api/cloud/vault' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)); puts.push(String(init.body));
      if (!replies.has(body.operationId)) {
        if (body.baseRevision !== head.revision) return Response.json({}, { status: 409 });
        head = { ...head, revision: head.revision + 1, manifest: body.manifest }; replies.set(body.operationId, head.revision);
      }
      if (lose) { lose = false; throw new TypeError('response lost'); }
      return Response.json({ revision: replies.get(body.operationId) });
    }
    throw new Error('unexpected request');
  });
  return { fetcher, puts, loseNext: () => { lose = true; } };
}
it('does not read device keys or request account data without a prior offline authorization', async () => {
  const fetcher = vi.fn<typeof fetch>();
  expect(await openOfflineWorkspace(fetcher)).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
});
it('prepares both checkpoints before authorizing offline opening', async () => {
  const { keys, head, config } = await fixture(), fetcher = vi.fn<typeof fetch>();
  const vault = await VaultTransport.open(keys.session, head, fetcher);
  const offline = await prepareOfflineWorkspace(config, vault, fetcher);
  expect(storage.slots.has('transport')).toBe(true); expect(storage.slots.has('runtime')).toBe(true);
  expect(storage.authorization.ownerId).toBe(config.user!.id); expect(offline.runtime.get('dynamic_diary-theme')).toBe('dark');
  offline.runtime.dispose();
});
it('adopts a newer verified head over an idle checkpoint before online application loading', async () => {
  const { keys, head, config } = await fixture(), server = remoteServer(config, head);
  const prepared = await prepareOfflineWorkspace(config, await VaultTransport.open(keys.session, head, server.fetcher), server.fetcher);
  const newer = { ...head, revision: 2, manifest: await keys.session.seal(JSON.stringify({ snapshot: { documents: [{ key: 'dynamic_diary-theme', value: 'light', revision: 2 }], media: [] }, files: {} }), 'manifest:2') };
  prepared.runtime.dispose();
  const session = await readDeviceVault(config.user!.id, keys.header);
  if (!session) throw new Error('missing trusted device');
  const fetcher = vi.fn<typeof fetch>(async path => {
    if (path === '/api/cloud/config') return Response.json(config);
    if (path === '/api/cloud/vault') return Response.json(newer);
    throw new Error('unexpected request');
  });
  const reopened = await prepareOfflineWorkspace(config, await VaultTransport.open(session, newer, fetcher), fetcher);
  expect(reopened.runtime.get('dynamic_diary-theme')).toBe('light');
  expect(reopened.vault.head().revision).toBe(2);
  expect((storage.slots.get('runtime') as any).confirmed.documents[0]).toMatchObject({ value: 'light', revision: 2 });
  expect(canvas.apply).not.toHaveBeenCalled(); expect(fetcher.mock.calls.every(([, init]) => init?.method !== 'PUT')).toBe(true);
  reopened.runtime.dispose();
});
it('adopts newer canonical documents on an idle reconnect even without recovered auxiliary requests', async () => {
  const { keys, head, config } = await fixture(), server = remoteServer(config, head);
  const prepared = await prepareOfflineWorkspace(config, await VaultTransport.open(keys.session, head, server.fetcher), server.fetcher);
  const newer = { ...head, revision: 2, manifest: await keys.session.seal(JSON.stringify({ snapshot: { documents: [{ key: 'dynamic_diary-theme', value: 'light', revision: 2 }], media: [] }, files: {} }), 'manifest:2') };
  prepared.runtime.dispose();
  const fetcher = vi.fn<typeof fetch>(async path => {
    if (path === '/api/cloud/config') return Response.json(config);
    if (path === '/api/cloud/vault') return Response.json(newer);
    throw new Error('unexpected request');
  });
  const reopened = await openOfflineWorkspace(fetcher);
  if (!reopened) throw new Error('missing offline workspace');
  expect(reopened.runtime.get('dynamic_diary-theme')).toBe('dark');
  await reopened.reconnect();
  expect(reopened.runtime.get('dynamic_diary-theme')).toBe('light');
  expect(reopened.runtime.getSnapshot()).toMatchObject({ pending: 0, issue: null, localSaved: true, offline: false });
  expect((storage.slots.get('transport') as any).head.revision).toBe(2); reopened.runtime.dispose();
});
it('defers a newer canonical head while editing and retries adoption without an auxiliary receipt', async () => {
  const { keys, head, config } = await fixture(), server = remoteServer(config, head);
  const prepared = await prepareOfflineWorkspace(config, await VaultTransport.open(keys.session, head, server.fetcher), server.fetcher);
  const newer = { ...head, revision: 2, manifest: await keys.session.seal(JSON.stringify({ snapshot: { documents: [{ key: 'dynamic_diary-theme', value: 'light', revision: 2 }], media: [] }, files: {} }), 'manifest:2') };
  prepared.runtime.dispose();
  const fetcher = vi.fn<typeof fetch>(async path => {
    if (path === '/api/cloud/config') return Response.json(config);
    if (path === '/api/cloud/vault') return Response.json(newer);
    throw new Error('unexpected request');
  });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const reopened = await openOfflineWorkspace(fetcher);
  if (!reopened) throw new Error('missing offline workspace');
  vi.useFakeTimers(); reopened.start();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true); canvas.idle = false;
  await reopened.reconnect();
  expect(reopened.runtime.get('dynamic_diary-theme')).toBe('dark'); expect(canvas.apply).not.toHaveBeenCalled();
  expect((storage.slots.get('transport') as any).auxiliary).toHaveLength(0);
  canvas.idle = true; await vi.advanceTimersByTimeAsync(5000); await reopened.reconnect();
  expect(reopened.runtime.get('dynamic_diary-theme')).toBe('light');
  expect(canvas.apply).toHaveBeenCalledWith([{ key: 'dynamic_diary-theme', value: 'light', revision: 2 }]);
  reopened.runtime.dispose();
});
it('reopens durable edits without contacting the server and confirms the owner before replay', async () => {
  const { keys, head, config } = await fixture(); let connected = false;
  const fetcher = vi.fn<typeof fetch>(async path => {
    if (!connected) throw new TypeError('offline');
    if (path === '/api/cloud/config') return Response.json(config);
    if (path === '/api/cloud/vault') return Response.json(head);
    throw new Error('unexpected request');
  });
  const prepared = await prepareOfflineWorkspace(config, await VaultTransport.open(keys.session, head, fetcher), fetcher);
  prepared.disconnect(); await prepared.runtime.write('dynamic_diary-theme', 'light');
  expect(prepared.runtime.getSnapshot().localSaved).toBe(true); prepared.runtime.dispose();
  fetcher.mockClear();
  const reopened = await openOfflineWorkspace(fetcher);
  if (!reopened) throw new Error('missing offline workspace');
  expect(reopened.runtime.get('dynamic_diary-theme')).toBe('light'); expect(reopened.runtime.getSnapshot().pending).toBe(1);
  expect(fetcher).not.toHaveBeenCalled();
  connected = true;
  const wrong = vi.fn<typeof fetch>(async () => Response.json({ ...config, user: { id: 'other-owner', email: config.user!.email } }));
  // A new offline session with a different reconnect response cannot upload the draft.
  reopened.runtime.dispose();
  const refused = await openOfflineWorkspace(wrong);
  if (!refused) throw new Error('missing offline workspace');
  await refused.reconnect();
  expect(wrong.mock.calls.map(([path]) => path)).toEqual(['/api/cloud/config']);
  expect(refused.runtime.getSnapshot().issue?.kind).toBe('session');
  expect(refused.runtime.get('dynamic_diary-theme')).toBe('light'); refused.runtime.dispose();
});
it('refuses a second writer and preserves the first session and its checkpoint', async () => {
  const { keys, head, config } = await fixture();
  const first = await prepareOfflineWorkspace(config, await VaultTransport.open(keys.session, head), fetch);
  await expect(openOfflineWorkspace()).rejects.toThrow(/outra aba/);
  expect(first.runtime.get('dynamic_diary-theme')).toBe('dark'); first.runtime.dispose();
});
it('does not replace a missing encrypted checkpoint with an empty or legacy workspace', async () => {
  const { keys, head, config } = await fixture();
  const first = await prepareOfflineWorkspace(config, await VaultTransport.open(keys.session, head), fetch); first.runtime.dispose();
  storage.slots.delete('runtime');
  await expect(openOfflineWorkspace()).rejects.toThrow(/cópia offline/);
  expect(storage.slots.has('transport')).toBe(true);
  expect(await readDeviceVault(config.user!.id, keys.header)).not.toBeNull();
});
it('clears a persisted session issue while writes remain gated, then sends its durable queue', async () => {
  const { keys, head, config } = await fixture(), server = remoteServer(config, head);
  const prepared = await prepareOfflineWorkspace(config, await VaultTransport.open(keys.session, head, server.fetcher), server.fetcher);
  prepared.disconnect(); prepared.runtime.notifySessionExpired('synthetic-session');
  await prepared.runtime.write('dynamic_diary-theme', 'light'); prepared.runtime.dispose();
  const reopened = await openOfflineWorkspace(server.fetcher);
  if (!reopened) throw new Error('missing offline workspace');
  server.fetcher.mockClear(); await reopened.reconnect();
  expect(server.fetcher.mock.calls.slice(0, 3).map(([path]) => path)).toEqual(['/api/cloud/config', '/api/cloud/vault', '/api/cloud/config']);
  expect(server.puts).toHaveLength(1);
  expect(reopened.runtime.getSnapshot()).toMatchObject({ pending: 0, issue: null, offline: false });
  expect(reopened.runtime.get('dynamic_diary-theme')).toBe('light'); reopened.runtime.dispose();
});
it('defers recovered import adoption while the editor is busy and retries before acknowledging it', async () => {
  const { keys, head, config } = await fixture(), server = remoteServer(config, head);
  const prepared = await prepareOfflineWorkspace(config, await VaultTransport.open(keys.session, head, server.fetcher), server.fetcher);
  const value = JSON.stringify({ version: 2, state: { projects: {}, notes: {} } });
  server.loseNext();
  await expect(prepared.vault.fetch('/api/cloud/import', { method: 'POST', body: JSON.stringify({ documents: [{ key: 'cellproject-workspace', value }], operationId: 'recover-import' }) })).rejects.toThrow('response lost');
  prepared.runtime.dispose();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const reopened = await openOfflineWorkspace(server.fetcher);
  if (!reopened) throw new Error('missing offline workspace');
  vi.useFakeTimers(); reopened.start();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true); canvas.idle = false;
  await reopened.reconnect();
  expect(server.puts).toHaveLength(2); expect(server.puts[1]).toBe(server.puts[0]);
  expect(reopened.runtime.get('cellproject-workspace')).toBeNull(); expect(canvas.apply).not.toHaveBeenCalled();
  expect((storage.slots.get('transport') as any).auxiliary).toHaveLength(1);
  const reads = server.fetcher.mock.calls.length;
  canvas.idle = true; await vi.advanceTimersByTimeAsync(5000);
  expect(server.fetcher.mock.calls.length).toBeGreaterThan(reads);
  await reopened.reconnect(); // Join the interval's Web Crypto work, which uses real async tasks.
  expect(reopened.runtime.get('cellproject-workspace')).toBe(value);
  expect(canvas.apply).toHaveBeenCalledWith([{ key: 'cellproject-workspace', value, revision: 1 }]);
  expect((storage.slots.get('runtime') as any).confirmed.documents.some((doc: any) => doc.key === 'cellproject-workspace')).toBe(true);
  expect((storage.slots.get('transport') as any).auxiliary).toHaveLength(0);
  expect(server.puts).toHaveLength(2); reopened.runtime.dispose();
});
it('adopts a recovered import before initial online application loading without touching domain stores', async () => {
  const { keys, head, config } = await fixture(), server = remoteServer(config, head);
  const prepared = await prepareOfflineWorkspace(config, await VaultTransport.open(keys.session, head, server.fetcher), server.fetcher);
  const value = JSON.stringify({ version: 2, state: { projects: {}, notes: {} } });
  server.loseNext();
  await expect(prepared.vault.fetch('/api/cloud/import', { method: 'POST', body: JSON.stringify({ documents: [{ key: 'cellproject-workspace', value }], operationId: 'before-load-import' }) })).rejects.toThrow('response lost');
  prepared.runtime.dispose();
  const session = await readDeviceVault(config.user!.id, keys.header);
  if (!session) throw new Error('missing trusted device');
  const canonical = await (await server.fetcher('/api/cloud/vault')).json();
  canvas.idle = false;
  const reopened = await prepareOfflineWorkspace(config, await VaultTransport.open(session, canonical, server.fetcher), server.fetcher);
  expect(reopened.runtime.get('cellproject-workspace')).toBe(value); expect(canvas.apply).not.toHaveBeenCalled();
  expect((storage.slots.get('transport') as any).auxiliary).toHaveLength(0);
  expect(server.puts).toHaveLength(2); expect(server.puts[1]).toBe(server.puts[0]); reopened.runtime.dispose();
});
it('retains the auxiliary receipt when durable adoption fails and recovers it on another reload', async () => {
  const { keys, head, config } = await fixture(), server = remoteServer(config, head);
  const prepared = await prepareOfflineWorkspace(config, await VaultTransport.open(keys.session, head, server.fetcher), server.fetcher);
  const value = JSON.stringify({ version: 2, state: { projects: {}, notes: {} } });
  server.loseNext();
  await expect(prepared.vault.fetch('/api/cloud/import', { method: 'POST', body: JSON.stringify({ documents: [{ key: 'cellproject-workspace', value }], operationId: 'quota-import' }) })).rejects.toThrow();
  prepared.runtime.dispose();
  const reopened = await openOfflineWorkspace(server.fetcher);
  if (!reopened) throw new Error('missing offline workspace');
  storage.failRecoveredRuntime = true; await reopened.reconnect();
  expect(reopened.runtime.getSnapshot()).toMatchObject({ localSaved: false, localError: 'synthetic adoption quota' });
  expect((storage.slots.get('transport') as any).auxiliary).toHaveLength(1);
  reopened.runtime.dispose(); storage.failRecoveredRuntime = false;
  const restored = await openOfflineWorkspace(server.fetcher);
  if (!restored) throw new Error('missing offline workspace');
  await restored.reconnect();
  expect(restored.runtime.get('cellproject-workspace')).toBe(value);
  expect((storage.slots.get('transport') as any).auxiliary).toHaveLength(0);
  expect(server.puts).toHaveLength(2); restored.runtime.dispose();
});
it('preserves a queued conflict if account verification fails during another reconnect', async () => {
  const { keys, head, config } = await fixture(); let wrongOwner = false;
  const server = remoteServer(config, head);
  const fetcher = vi.fn<typeof fetch>((path, init) => wrongOwner && path === '/api/cloud/config' ? Promise.resolve(Response.json({ ...config, user: { ...config.user!, id: 'other-owner' } })) : server.fetcher(path, init));
  const prepared = await prepareOfflineWorkspace(config, await VaultTransport.open(keys.session, head, fetcher), fetcher);
  prepared.disconnect(); await prepared.runtime.write('dynamic_diary-theme', 'light');
  prepared.runtime.reportSyncIssue({ key: 'dynamic_diary-theme', kind: 'conflict', message: 'preserved conflict' });
  wrongOwner = true; await prepared.reconnect();
  expect(prepared.runtime.getSnapshot()).toMatchObject({ pending: 1, issue: { kind: 'conflict', message: 'preserved conflict' }, offline: true });
  expect(prepared.runtime.get('dynamic_diary-theme')).toBe('light'); expect(server.puts).toHaveLength(0); prepared.runtime.dispose();
});
it('does not send restored drafts when initial online opening sees changed ciphertext under the same head revision', async () => {
  const { keys, head, config } = await fixture();
  const prepared = await prepareOfflineWorkspace(config, await VaultTransport.open(keys.session, head), fetch);
  prepared.disconnect(); await prepared.runtime.write('dynamic_diary-theme', 'light'); prepared.runtime.dispose();
  const session = await readDeviceVault(config.user!.id, keys.header);
  if (!session) throw new Error('missing trusted device');
  const manifest = await session.seal(JSON.stringify({ snapshot: { documents: [{ key: 'dynamic_diary-theme', value: 'unexpected', revision: 1 }], media: [] }, files: {} }), 'manifest:1');
  const changed = { ...head, manifest }, server = remoteServer(config, changed);
  const reopened = await prepareOfflineWorkspace(config, await VaultTransport.open(session, changed, server.fetcher), server.fetcher);
  expect(server.puts).toHaveLength(0); expect(reopened.runtime.get('dynamic_diary-theme')).toBe('light');
  expect(reopened.runtime.getSnapshot()).toMatchObject({ pending: 1, issue: { kind: 'conflict' }, offline: true }); reopened.runtime.dispose();
});
