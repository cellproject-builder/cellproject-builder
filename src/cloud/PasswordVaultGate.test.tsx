import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PasswordVaultGate } from './PasswordVaultGate';
import { createVault, sessionFromDeviceKey } from './vault/crypto';
import { DEVICE_VAULT_DATABASE, readDeviceRecovery, readDeviceVault, rememberDeviceVault } from './vault/deviceKeys';
import * as deviceKeys from './vault/deviceKeys';
import { sealPasswordAccess, type PasswordAccess } from './vault/passwordAccess';
import type { VaultHead, VaultTransport } from './vault/transport';

const provider = { url: 'https://wxfootrnfiqpzhmjwgck.supabase.co', publishableKey: 'sb_publishable_synthetic' };
const email = 'wylgnerbossman@gmail.com', password = 'synthetic-account-password';
const snapshot = { documents: [{ key: 'dynamic_diary-chat', value: '{"version":1,"state":{"private":"preserved conversation"}}', revision: 1 }], media: [] };
let host: HTMLDivElement, root: Root;
const opened: VaultTransport[] = [];
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); for (const transport of opened.splice(0)) transport.dispose(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function waitFor(assertion: () => void) { let last: unknown; for (let index = 0; index < 500; index++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); try { assertion(); return; } catch (reason) { last = reason; } } throw last; }
async function fixture() {
  const vault = await createVault(crypto.randomUUID(), 'legacy synthetic vault phrase');
  const head: VaultHead = { header: vault.header, revision: 1, manifest: await vault.session.seal(JSON.stringify({ snapshot, files: {} }), 'manifest:1') };
  return { vault, head };
}

it('opens a new device automatically with the password from login and preserves the canonical encrypted vault', async () => {
  const { vault, head } = await fixture(), canonical = JSON.stringify(head);
  const access = await sealPasswordAccess(vault.session, vault.recoveryKey, password);
  const fetcher = vi.fn<typeof fetch>(async target => { expect(target).toBe('/api/cloud/vault/password-access'); return Response.json({ access, revision: 1 }); });
  const ready = vi.fn(async (transport: VaultTransport) => { opened.push(transport); }), take = vi.fn(() => password);
  await act(async () => root.render(<PasswordVaultGate ownerId={vault.session.ownerId} email={email} provider={provider} head={head} snapshot={null} fetcher={fetcher} takeLoginPassword={take} onUnlocked={ready} onRetry={vi.fn()} onRestart={vi.fn(async () => {})}/>));
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  expect(ready.mock.calls[0][0].snapshot()).toEqual(snapshot); expect(take).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls.every(call => !call[1]?.method || call[1].method === 'GET')).toBe(true);
  expect(JSON.stringify(head)).toBe(canonical);
  const remembered = await readDeviceVault(vault.session.ownerId, vault.header); expect(remembered).not.toBeNull(); remembered?.dispose(); vault.session.dispose();
}, 15000);

it('links the account password from a trusted device without replacing its header, manifest or data key', async () => {
  const { vault, head } = await fixture(), canonical = JSON.stringify(head);
  await rememberDeviceVault(vault.session, { recoveryKey: vault.recoveryKey });
  let access: PasswordAccess | null = null;
  const fetcher = vi.fn<typeof fetch>(async (target, init) => {
    expect(target).toBe('/api/cloud/vault/password-access');
    if (init?.method === 'PUT') { access = JSON.parse(String(init.body)).access; return Response.json({ revision: 1 }); }
    return Response.json(access ? { access, revision: 1 } : { access: null });
  });
  const ready = vi.fn(async (transport: VaultTransport) => { opened.push(transport); });
  await act(async () => root.render(<PasswordVaultGate ownerId={vault.session.ownerId} email={email} provider={provider} head={head} snapshot={null} fetcher={fetcher} takeLoginPassword={() => password} onUnlocked={ready} onRetry={vi.fn()} onRestart={vi.fn(async () => {})}/>));
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  const writes = fetcher.mock.calls.filter(call => call[1]?.method === 'PUT'); expect(writes).toHaveLength(1);
  expect(String(writes[0][1]?.body)).not.toContain(password); expect(String(writes[0][1]?.body)).not.toContain(vault.recoveryKey);
  expect(JSON.stringify(head)).toBe(canonical); expect(ready.mock.calls[0][0].snapshot()).toEqual(snapshot); vault.session.dispose();
}, 15000);

it('preserves an untrusted legacy vault without offering phrase/key entry or mutating data, and lets the user restart login', async () => {
  const { vault, head } = await fixture(), canonical = JSON.stringify(head), restart = vi.fn(async () => {}), ready = vi.fn();
  const fetcher = vi.fn<typeof fetch>(async target => { expect(target).toBe('/api/cloud/vault/password-access'); return Response.json({ access: null }); });
  await act(async () => root.render(<PasswordVaultGate ownerId={vault.session.ownerId} email={email} provider={provider} head={head} snapshot={null} fetcher={fetcher} takeLoginPassword={() => password} onUnlocked={ready} onRetry={vi.fn()} onRestart={restart}/>));
  await waitFor(() => expect(host.textContent).toContain('Conecte um aparelho autorizado'));
  expect(host.querySelectorAll('input')).toHaveLength(0); expect(host.textContent).not.toMatch(/frase|Chave de recuperação/);
  expect(ready).not.toHaveBeenCalled(); expect(fetcher.mock.calls.every(call => !call[1]?.method || call[1].method === 'GET')).toBe(true); expect(JSON.stringify(head)).toBe(canonical);
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Voltar ao login')!.click());
  expect(restart).toHaveBeenCalledOnce(); vault.session.dispose();
}, 15000);

async function deviceRecords(transform?: { id: string; change: (record: Record<string, unknown>) => Record<string, unknown> }): Promise<Array<[IDBValidKey, Record<string, unknown>]>> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DEVICE_VAULT_DATABASE, 1); open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, transaction = db.transaction('keys', transform ? 'readwrite' : 'readonly'), store = transaction.objectStore('keys');
      if (transform) { const target = store.get(transform.id); target.onsuccess = () => store.put(transform.change(target.result), transform.id); }
      const keys = store.getAllKeys(), values = store.getAll();
      transaction.oncomplete = () => { db.close(); resolve(keys.result.map((key, index) => [key, values.result[index]])); }; transaction.onerror = transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  });
}

it('repairs an invalid local record through the valid remote password wrapper and preserves the previous record', async () => {
  const { vault, head } = await fixture(), canonical = JSON.stringify(head), ownerId = vault.session.ownerId;
  await rememberDeviceVault(vault.session, { recoveryKey: vault.recoveryKey });
  await deviceRecords({ id: JSON.stringify(['vault', ownerId, vault.header.id]), change: record => ({ ...record, fingerprint: 'invalid local fingerprint' }) });
  const access = await sealPasswordAccess(vault.session, vault.recoveryKey, password);
  const fetcher = vi.fn<typeof fetch>(async target => { expect(target).toBe('/api/cloud/vault/password-access'); return Response.json({ access, revision: 1 }); });
  const ready = vi.fn(async (transport: VaultTransport) => { opened.push(transport); });
  await act(async () => root.render(<PasswordVaultGate ownerId={ownerId} email={email} provider={provider} head={head} snapshot={null} fetcher={fetcher} takeLoginPassword={() => password} onUnlocked={ready} onRetry={vi.fn()} onRestart={vi.fn(async () => {})}/>));
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  const archive = (await deviceRecords()).filter(([key]) => typeof key === 'string' && key.startsWith(JSON.stringify(['previous-device-key', ownerId, vault.header.id]).slice(0, -1)));
  expect(archive).toHaveLength(1); expect(archive[0][1].fingerprint).toBe('invalid local fingerprint');
  const restored = await readDeviceVault(ownerId, vault.header); expect(restored).not.toBeNull(); expect(await readDeviceRecovery(restored!)).toBe(vault.recoveryKey); restored!.dispose();
  expect(ready.mock.calls[0][0].snapshot()).toEqual(snapshot); expect(JSON.stringify(head)).toBe(canonical); expect(fetcher.mock.calls.every(call => !call[1]?.method || call[1].method === 'GET')).toBe(true); vault.session.dispose();
}, 15000);

it('does not remember a recovered key when the canonical encrypted manifest fails authentication', async () => {
  const { vault, head } = await fixture(), access = await sealPasswordAccess(vault.session, vault.recoveryKey, password), ready = vi.fn();
  const corrupted = { ...head, manifest: { ...head.manifest, iv: 'AAAAAAAAAAAAAAAA' } }, put = vi.spyOn(IDBObjectStore.prototype, 'put');
  const fetcher = vi.fn<typeof fetch>(async target => { expect(target).toBe('/api/cloud/vault/password-access'); return Response.json({ access, revision: 1 }); });
  await act(async () => root.render(<PasswordVaultGate ownerId={vault.session.ownerId} email={email} provider={provider} head={corrupted} snapshot={null} fetcher={fetcher} takeLoginPassword={() => password} onUnlocked={ready} onRetry={vi.fn()} onRestart={vi.fn(async () => {})}/>));
  await waitFor(() => expect(host.querySelector('[role=alert]')).not.toBeNull());
  expect(ready).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled(); expect(await readDeviceVault(vault.session.ownerId, vault.header)).toBeNull(); vault.session.dispose();
}, 15000);

it('disposes a device key that finishes loading after unmount and never continues to the password wrapper', async () => {
  const { vault, head } = await fixture(), restored = sessionFromDeviceKey(vault.session.ownerId, vault.header, vault.session.deviceKeyForStorage());
  let resolve!: (value: typeof restored) => void;
  const pending = new Promise<typeof restored>(ready => { resolve = ready; });
  vi.spyOn(deviceKeys, 'readDeviceVault').mockReturnValue(pending);
  const disposed = vi.spyOn(restored, 'dispose'), fetcher = vi.fn<typeof fetch>(), ready = vi.fn();
  await act(async () => root.render(<PasswordVaultGate ownerId={vault.session.ownerId} email={email} provider={provider} head={head} snapshot={null} fetcher={fetcher} takeLoginPassword={() => password} onUnlocked={ready} onRetry={vi.fn()} onRestart={vi.fn(async () => {})}/>));
  await act(async () => root.unmount()); await act(async () => { resolve(restored); await pending; });
  expect(disposed).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled(); expect(ready).not.toHaveBeenCalled(); vault.session.dispose();
}, 15000);
