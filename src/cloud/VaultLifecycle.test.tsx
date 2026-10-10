import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VaultGate } from '@/cloud/VaultGate';
import { CloudBootstrap } from '@/cloud/CloudBootstrap';
import { configureCloud, getCloudRuntime } from '@/cloud/runtime';
import { configureVault, getVaultSession } from '@/cloud/vault/privacy';

const mocks = vi.hoisted(() => ({ read: vi.fn(), prepared: vi.fn(), remember: vi.fn(), complete: vi.fn(), create: vi.fn(), recover: vi.fn(), unlock: vi.fn(), activate: vi.fn(), prepare: vi.fn(), open: vi.fn() }));
vi.mock('@/cloud/vault/deviceKeys', () => ({ readDeviceVault: mocks.read, readPreparedDeviceVault: mocks.prepared, rememberDeviceVault: mocks.remember, completeDeviceActivation: mocks.complete }));
vi.mock('@/cloud/vault/crypto', () => ({ b64: () => 'synthetic-random-secret', createVault: mocks.create, recoverVault: mocks.recover, unlockVault: mocks.unlock, validateHeader: (value: unknown) => value, validateCipher: (value: unknown) => value }));
vi.mock('@/cloud/vault/transport', () => ({ activateVault: mocks.activate, prepareVaultActivation: mocks.prepare, VaultTransport: { open: mocks.open } }));
// These lifecycle fixtures stub cryptography. Checkpoint authentication is
// exercised with real vaults in offline/session.test.ts, not these partial keys.
vi.mock('@/cloud/offline/session', async importOriginal => ({
  ...await importOriginal<typeof import('./offline/session')>(),
  hasOfflineCheckpoints: async () => false,
}));
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(ready => { resolve = ready; }); return { promise, resolve }; };
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, mounted: boolean;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // Also drop unconsumed one-shot replies when an earlier lifecycle is cancelled.
  vi.resetAllMocks(); configureCloud(null); configureVault(null, false);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); mounted = true;
});
afterEach(async () => { if (mounted) await act(async () => root.unmount()); host.remove(); configureCloud(null); configureVault(null, false); });
async function unmount() { await act(async () => root.unmount()); mounted = false; }
const session = () => ({ ownerId: 'owner', header: { id: 'public-fixture' }, dispose: vi.fn() });

it('must not activate or unlock after protection is unmounted while reading a prepared key', async () => {
  const pending = deferred<null>(), created = session(), ready = vi.fn();
  mocks.prepared.mockReturnValue(pending.promise); mocks.create.mockResolvedValue({ session: created, recoveryKey: 'synthetic-recovery' });
  mocks.prepare.mockResolvedValue({ head: {} }); mocks.remember.mockResolvedValue(undefined); mocks.activate.mockResolvedValue({}); mocks.complete.mockResolvedValue(undefined); mocks.open.mockResolvedValue({ session: created });
  await act(async () => root.render(<VaultGate ownerId="owner" head={null} snapshot={{ documents: [], media: [] }} fetcher={vi.fn()} onUnlocked={ready} onSkip={vi.fn()}/>));
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Proteger meus dados neste navegador')!.click());
  await unmount(); await act(async () => { pending.resolve(null); await pending.promise; });
  expect(mocks.activate).not.toHaveBeenCalled(); expect(ready).not.toHaveBeenCalled();
});

it('must dispose a manual recovery that finishes after the gate unmounts', async () => {
  const restored = session(), pending = deferred<typeof restored>(), ready = vi.fn();
  mocks.recover.mockReturnValue(pending.promise); mocks.open.mockResolvedValue({ session: restored }); mocks.remember.mockResolvedValue(undefined);
  await act(async () => root.render(<VaultGate ownerId="owner" head={{ header: {}, revision: 1, manifest: {} } as never} snapshot={null} fetcher={vi.fn()} onUnlocked={ready} onSkip={vi.fn()}/>));
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await unmount(); await act(async () => { pending.resolve(restored); await pending.promise; });
  expect(ready).not.toHaveBeenCalled(); expect(restored.dispose).toHaveBeenCalled();
});

it('must clear an auto-opened vault if bootstrap unmounts while application import is pending', async () => {
  const restored = session(), application = deferred<{ default: () => React.JSX.Element }>();
  const vault = { session: restored, snapshot: () => ({ documents: [], media: [] }), fetch: vi.fn(), dispose: vi.fn(() => restored.dispose()) };
  mocks.read.mockResolvedValue(restored); mocks.open.mockResolvedValue(vault);
  const config = { enabled: true, authenticated: true, vaultAvailable: true, user: { id: 'owner', email: 'wylgnerbossman@gmail.com' } };
  const fetcher = vi.fn<typeof fetch>(async path => Response.json(String(path).endsWith('/config') ? config : { header: { id: 'public-fixture' }, revision: 1, manifest: {} }));
  const load = vi.fn(() => application.promise);
  await act(async () => root.render(<CloudBootstrap fetcher={fetcher} loadApplication={load}/>));
  expect(load).toHaveBeenCalledOnce(); expect(getVaultSession()).toBe(restored);
  await unmount(); await act(async () => { application.resolve({ default: () => <div>Workspace</div> }); await application.promise; });
  expect(getCloudRuntime()).toBeNull(); expect(getVaultSession()).toBeNull(); expect(restored.dispose).toHaveBeenCalled();
});

it('must not clear the next owner vault when an old application import finally resolves', async () => {
  const first = { ...session(), ownerId: 'owner-a' }, second = { ...session(), ownerId: 'owner-b' };
  const oldApplication = deferred<{ default: () => React.JSX.Element }>(), newApplication = deferred<{ default: () => React.JSX.Element }>();
  const vault = (selected: typeof first) => ({ session: selected, snapshot: () => ({ documents: [], media: [] }), fetch: vi.fn(), dispose: vi.fn(() => selected.dispose()) });
  mocks.read.mockResolvedValueOnce(first).mockResolvedValueOnce(second); mocks.open.mockResolvedValueOnce(vault(first)).mockResolvedValueOnce(vault(second));
  const fetchFor = (owner: string) => vi.fn<typeof fetch>(async path => Response.json(String(path).endsWith('/config') ? { enabled: true, authenticated: true, vaultAvailable: true, user: { id: owner, email: 'wylgnerbossman@gmail.com' } } : { header: { id: `public-fixture-${owner}` }, revision: 1, manifest: {} }));
  await act(async () => root.render(<CloudBootstrap fetcher={fetchFor('owner-a')} loadApplication={() => oldApplication.promise}/>));
  expect(getVaultSession()).toBe(first);
  await unmount();
  root = createRoot(host); mounted = true;
  await act(async () => root.render(<CloudBootstrap fetcher={fetchFor('owner-b')} loadApplication={() => newApplication.promise}/>));
  expect(getVaultSession()).toBe(second);
  await act(async () => { oldApplication.resolve({ default: () => <div>Old workspace</div> }); await oldApplication.promise; });
  expect(getVaultSession()).toBe(second);
});

it('must not remember a recovered vault after the gate unmounts during transport opening', async () => {
  const restored = session(), pending = deferred<{ session: typeof restored }>(), ready = vi.fn();
  mocks.recover.mockResolvedValue(restored); mocks.open.mockReturnValue(pending.promise); mocks.remember.mockResolvedValue(undefined);
  await act(async () => root.render(<VaultGate ownerId="owner" head={{ header: {}, revision: 1, manifest: {} } as never} snapshot={null} fetcher={vi.fn()} onUnlocked={ready} onSkip={vi.fn()}/>));
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(mocks.open).toHaveBeenCalledOnce();
  await unmount(); await act(async () => { pending.resolve({ session: restored }); await pending.promise; });
  expect(mocks.remember).not.toHaveBeenCalled(); expect(ready).not.toHaveBeenCalled(); expect(restored.dispose).toHaveBeenCalled();
});
