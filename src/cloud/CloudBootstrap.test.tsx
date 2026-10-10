import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CloudBootstrap } from './CloudBootstrap';
import { configureCloud } from './runtime';
import { webcrypto } from 'node:crypto';
import * as migration from './migration';
let host: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); configureCloud(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('does not load application stores before authentication and snapshot selection', async () => {
  const load = vi.fn(async () => ({ default: () => <div>Workspace</div> }));
  const fetcher = vi.fn(async () => Response.json({ enabled: true, authenticated: false, providers: {} }));
  await act(async () => root.render(<CloudBootstrap loadApplication={load} fetcher={fetcher}/>));
  expect(load).not.toHaveBeenCalled(); expect(host.textContent).toContain('Entrar'); expect(host.querySelector('input[type="email"]')?.getAttribute('value')).toBe('wylgnerbossman@gmail.com');
});
it('loads the local app only after an explicit disabled config and fails closed on config error', async () => {
  const load = vi.fn(async () => ({ default: () => <div>Local workspace</div> }));
  await act(async () => root.render(<CloudBootstrap loadApplication={load} fetcher={vi.fn(async () => Response.json({ enabled: false, authenticated: false }))}/>));
  expect(load).toHaveBeenCalledOnce(); expect(host.textContent).toContain('Local workspace');
  await act(async () => { root.unmount(); root = createRoot(host); });
  load.mockClear();
  await act(async () => root.render(<CloudBootstrap loadApplication={load} fetcher={vi.fn(async () => { throw new Error('network'); })}/>));
  expect(load).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')).not.toBeNull();
});
it('requires a valid authenticated snapshot and never falls back to local data on a server failure', async () => {
  const load = vi.fn(async () => ({ default: () => <div>Workspace</div> }));
  const fetcher = vi.fn(async (path: RequestInfo | URL) => String(path).endsWith('/config') ? Response.json({ enabled: true, authenticated: true, user: { id: 'allowed', email: 'wylgnerbossman@gmail.com' } }) : Response.json({}, { status: 503 }));
  await act(async () => root.render(<CloudBootstrap loadApplication={load} fetcher={fetcher}/>));
  expect(load).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toContain('503');
});
it('offers backup import before loading the application on an empty new origin', async () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.spyOn(migration, 'captureLegacyBackup').mockResolvedValue(await migration.captureLegacyBackup({ getDocument: async () => null, getPreference: () => null, getMedia: async () => [] }));
  const load = vi.fn(async () => ({ default: () => <div>Workspace</div> }));
  const fetcher = vi.fn(async (path: RequestInfo | URL) => String(path).endsWith('/config') ? Response.json({ enabled: true, authenticated: true, user: { id: 'allowed', email: 'wylgnerbossman@gmail.com' } }) : Response.json({ documents: [], media: [] }));
  await act(async () => root.render(<CloudBootstrap loadApplication={load} fetcher={fetcher}/>));
  expect(load).not.toHaveBeenCalled(); expect(host.querySelector('input[type="file"]')).not.toBeNull(); expect(host.textContent).toContain('Começar na nuvem sem importar agora');
});
it('uses an email link by default while keeping code verification optional', async () => {
  const load = vi.fn(async () => ({ default: () => <div>Workspace</div> }));
  const fetcher = vi.fn<typeof fetch>(async path => String(path).endsWith('/config') ? Response.json({ enabled: true, authenticated: false, authMethod: 'email_link' }) : Response.json({ sent: true }));
  await act(async () => root.render(<CloudBootstrap loadApplication={load} fetcher={fetcher}/>));
  expect(host.textContent).toContain('Enviar link de acesso');
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(host.textContent).toContain('neste navegador'); expect(host.querySelector('input[autocomplete="one-time-code"]')).toBeNull();
  expect(fetcher.mock.calls[1][0]).toBe('/api/auth/request-code');
  expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({ email: 'wylgnerbossman@gmail.com' });
  await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'Já tenho um código')!.click(); });
  expect(host.querySelector('input[autocomplete="one-time-code"]')).not.toBeNull(); expect(load).not.toHaveBeenCalled();
});
it('shows a safe invalid-link message and removes only the callback flag from the URL', async () => {
  window.history.replaceState(null, '', '/?auth_error=link_invalid&view=all#panel');
  const load = vi.fn(async () => ({ default: () => <div>Workspace</div> }));
  await act(async () => root.render(<CloudBootstrap loadApplication={load} fetcher={vi.fn(async () => Response.json({ enabled: true, authenticated: false, authMethod: 'email_link' }))}/>));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Solicite um novo link');
  expect(window.location.search).toBe('?view=all'); expect(window.location.hash).toBe('#panel'); expect(load).not.toHaveBeenCalled();
  window.history.replaceState(null, '', '/');
});
it.each([
  { documents: [{ key: 'cellproject-workspace', revision: 1, value: '{"state":{}}' }], media: [] },
  { documents: [], media: [{ id: 'bad', mime: 'image/png', name: 'bad.png', sha256: 'not-a-hash', size: 1 }] },
])('fails closed on malformed authenticated snapshots before importing the application', async snapshot => {
  const load = vi.fn(async () => ({ default: () => <div>Workspace</div> }));
  const fetcher = vi.fn(async (path: RequestInfo | URL) => String(path).endsWith('/config') ? Response.json({ enabled: true, authenticated: true, user: { id: 'allowed', email: 'wylgnerbossman@gmail.com' } }) : Response.json(snapshot));
  await act(async () => root.render(<CloudBootstrap loadApplication={load} fetcher={fetcher}/>));
  expect(load).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.querySelector('input[type="file"]')).toBeNull();
});
