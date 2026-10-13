import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CloudBootstrap } from './CloudBootstrap';
import { configureCloud, getCloudRuntime } from './runtime';
import { configureVault } from './vault/privacy';
import { createVault } from './vault/crypto';
import { rememberDeviceVault } from './vault/deviceKeys';
import { sealPasswordAccess } from './vault/passwordAccess';
import { VaultTransport } from './vault/transport';
import { prepareOfflineWorkspace, type OfflineWorkspace } from './offline/session';

vi.mock('./CloudLiveSync', () => ({ CloudLiveSync: () => null, cloudCanvasIdle: () => true, applyRemoteCanvasDocuments: () => {} }));
vi.mock('./CloudStatus', () => ({ CloudStatus: () => null }));
let host: HTMLDivElement, root: Root, first: OfflineWorkspace | undefined;
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const tails = new Map<string, Promise<unknown>>();
  vi.stubGlobal('navigator', { onLine: true, locks: { request: (name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) => {
    if (options.ifAvailable && tails.has(name)) return Promise.resolve(callback(null));
    const previous = tails.get(name) ?? Promise.resolve();
    const task = previous.then(() => {
      if (options.signal?.aborted) throw options.signal.reason;
      return callback({ name, mode: 'exclusive' });
    });
    tails.set(name, task);
    void task.finally(() => { if (tails.get(name) === task) tails.delete(name); }).catch(() => {});
    return task;
  } } });
});
afterEach(async () => { await act(async () => root.unmount()); first?.runtime.dispose(); first = undefined; host.remove(); configureCloud(null); configureVault(null, false); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function waitFor(assertion: () => void) {
  let last: unknown;
  for (let index = 0; index < 200; index++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); try { assertion(); return; } catch (reason) { last = reason; } }
  throw last;
}

it('waits outside the password form, then opens automatically with the first tab draft intact', async () => {
  const keys = await createVault(crypto.randomUUID(), 'synthetic tab access password');
  await rememberDeviceVault(keys.session, { recoveryKey: keys.recoveryKey });
  const access = await sealPasswordAccess(keys.session, keys.recoveryKey, 'synthetic account password');
  const config = { enabled: true, authenticated: true, vaultAvailable: true, user: { id: keys.session.ownerId, email: 'wylgnerbossman@gmail.com' }, passwordProvider: { url: 'https://example.supabase.co', publishableKey: 'synthetic' } };
  const snapshot = { documents: [{ key: 'dynamic_diary-theme', value: 'dark', revision: 1 }], media: [] };
  let head = { header: keys.header, revision: 1, manifest: await keys.session.seal(JSON.stringify({ snapshot, files: {} }), 'manifest:1') };
  const fetcher = vi.fn<typeof fetch>(async (target, init) => {
    if (target === '/api/cloud/config') return Response.json(config);
    if (target === '/api/cloud/vault/password-access') return Response.json({ access, revision: 1 });
    if (target === '/api/cloud/vault' && init?.method === 'PUT') { const body = JSON.parse(String(init.body)); head = { ...head, revision: head.revision + 1, manifest: body.manifest }; return Response.json({ revision: head.revision }); }
    if (target === '/api/cloud/vault') return Response.json(head);
    throw new Error(`Unexpected request: ${target}`);
  });
  first = await prepareOfflineWorkspace(config, await VaultTransport.open(keys.session, head, fetcher), fetcher);
  first.disconnect(); await first.runtime.write('dynamic_diary-theme', 'light');
  const load = vi.fn(async () => ({ default: () => <p>Workspace: {getCloudRuntime()?.get('dynamic_diary-theme')}</p> }));
  await act(async () => root.render(<CloudBootstrap loadApplication={load} fetcher={fetcher}/>));
  await waitFor(() => expect(host.querySelector('[aria-label="Workspace em outra aba"]')).not.toBeNull());
  expect(host.querySelector('input[type=password]')).toBeNull(); expect(host.querySelector('form')).toBeNull();
  expect(load).not.toHaveBeenCalled();
  expect(first.runtime.get('dynamic_diary-theme')).toBe('light');
  first.runtime.dispose();
  await waitFor(() => expect(host.textContent).toContain('Workspace: light'));
  expect(load).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls.some(([target]) => String(target).includes('/sign-in'))).toBe(false);
}, 15000);
