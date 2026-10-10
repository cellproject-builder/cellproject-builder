import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VaultGate } from './VaultGate';
import { readPreparedDeviceVault, readDeviceRecovery } from './vault/deviceKeys';
let container: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function waitFor(assertion: () => void) { let last: unknown; for (let index = 0; index < 250; index++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); try { assertion(); return; } catch (reason) { last = reason; } } throw last; }
it('offers one explicit protection action without an extra phrase or mandatory downloads', async () => {
  const ready = vi.fn(), skip = vi.fn(), fetcher = vi.fn();
  await act(async () => root.render(<VaultGate ownerId="owner" head={null} snapshot={{ documents: [], media: [] }} fetcher={fetcher} onUnlocked={ready} onSkip={skip}/>));
  expect(container.textContent).toContain('Proteger meus dados neste navegador'); expect(container.textContent).toContain('Limpar este navegador');
  expect(container.querySelectorAll('input')).toHaveLength(0); expect(ready).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Continuar sem ativar agora')!.click()); expect(skip).toHaveBeenCalledOnce();
});
it('blocks unsupported legacy media without attempting activation or deleting anything', async () => {
  const fetcher = vi.fn();
  await act(async () => root.render(<VaultGate ownerId="owner" head={null} snapshot={{ documents: [], media: [{ id: 'old-file', name: 'private.png', mime: 'image/png', sha256: '0'.repeat(64), size: 2 }] }} fetcher={fetcher} onUnlocked={vi.fn()} onSkip={vi.fn()}/>));
  expect(container.textContent).toContain('migração assistida'); expect(container.querySelector('input[type=password]')).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
});
it('never activates remotely when browser key storage is unavailable', async () => {
  const fetcher = vi.fn(); vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new Error('disabled'); });
  await act(async () => root.render(<VaultGate ownerId={crypto.randomUUID()} head={null} snapshot={{ documents: [], media: [] }} fetcher={fetcher} onUnlocked={vi.fn()} onSkip={vi.fn()}/>));
  await act(async () => container.querySelector<HTMLButtonElement>('button.primary')!.click());
  await waitFor(() => expect(container.querySelector('[role=alert]')?.textContent).toContain('navegador'));
  expect(fetcher).not.toHaveBeenCalled();
});
it('readbacks its device key before activation and keeps exactly the same preparation after a 502 retry', async () => {
  const ownerId = crypto.randomUUID(), bodies: string[] = [], ready = vi.fn();
  const fetcher = vi.fn<typeof fetch>(async (_path, init) => {
    const prepared = await readPreparedDeviceVault(ownerId); expect(prepared).not.toBeNull();
    expect(await readDeviceRecovery(prepared!.session)).toMatch(/^[a-f0-9-]+$/); prepared!.session.dispose();
    bodies.push(String(init!.body)); return bodies.length === 1 ? Response.json({}, { status: 502 }) : Response.json({ revision: 1 });
  });
  await act(async () => root.render(<VaultGate ownerId={ownerId} head={null} snapshot={{ documents: [], media: [] }} fetcher={fetcher} onUnlocked={ready} onSkip={vi.fn()}/>));
  await act(async () => container.querySelector<HTMLButtonElement>('button.primary')!.click());
  await waitFor(() => expect(container.querySelector('[role=alert]')?.textContent).toContain('502'));
  await act(async () => container.querySelector<HTMLButtonElement>('button.primary')!.click());
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  expect(bodies).toHaveLength(2); expect(bodies[0]).toBe(bodies[1]);
  expect(await readPreparedDeviceVault(ownerId)).toBeNull();
  ready.mock.calls[0][0].dispose();
}, 15000);
