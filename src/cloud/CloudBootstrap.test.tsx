import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CloudBootstrap } from './CloudBootstrap';
import { configureCloud } from './runtime';
import { webcrypto } from 'node:crypto';
import * as migration from './migration';
import { createVault } from './vault/crypto';
import { configureVault } from './vault/privacy';
import * as deviceKeys from './vault/deviceKeys';
let host: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); configureCloud(null); configureVault(null, false); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function fill(input: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function submit() { await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
it('does not import application stores before an encrypted-vault unlock or explicit legacy choice', async () => {
  const load = vi.fn(async () => ({ default: () => <div>Workspace</div> }));
  const fetcher = vi.fn<typeof fetch>(async path => String(path).endsWith('/config') ? Response.json({ enabled: true, authenticated: true, vaultAvailable: true, user: { id: 'owner', email: 'wylgnerbossman@gmail.com' } }) : String(path).endsWith('/vault') ? Response.json({ vault: null }) : Response.json({ documents: [{ key: 'dynamic_diary-theme', value: 'dark', revision: 1 }], media: [] }));
  await act(async () => root.render(<CloudBootstrap loadApplication={load} fetcher={fetcher}/>));
  expect(host.textContent).toContain('Proteja seus dados'); expect(load).not.toHaveBeenCalled();
  await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Continuar sem ativar agora')!.click());
  expect(load).toHaveBeenCalledOnce();
});
it('unlocks a remote cofre locally before importing stores and never sends the phrase to the server', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const phrase = 'synthetic test-only private vault phrase';
  const vault = await createVault('owner', phrase), snapshot = { documents: [{ key: 'dynamic_diary-theme', value: 'dark', revision: 1 }], media: [] };
  const head = { header: vault.header, revision: 1, manifest: await vault.session.seal(JSON.stringify({ snapshot, files: {} }), 'manifest:1') };
  const load = vi.fn(async () => ({ default: () => <div>Private workspace</div> }));
  const fetcher = vi.fn<typeof fetch>(async path => String(path).endsWith('/config') ? Response.json({ enabled: true, authenticated: true, vaultAvailable: true, user: { id: 'owner', email: 'wylgnerbossman@gmail.com' } }) : Response.json(head));
  await act(async () => root.render(<CloudBootstrap loadApplication={load} fetcher={fetcher}/>));
  for (let index = 0; index < 200 && !host.textContent?.includes('Abrir seus dados neste navegador'); index++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(host.textContent).toContain('Abrir seus dados neste navegador'); expect(load).not.toHaveBeenCalled();
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Usar minha frase antiga do cofre')!.click());
  await fill(host.querySelector('input[type=password]')!, phrase); await submit();
  await act(async () => { await vi.waitFor(() => expect(load).toHaveBeenCalledOnce(), { timeout: 10000 }); });
  expect(load).toHaveBeenCalledOnce(); expect(host.textContent).toContain('Private workspace');
  expect(fetcher.mock.calls.map(call => String(call[1]?.body ?? '')).join()).not.toContain(phrase);
  expect(fetcher.mock.calls.some(call => call[0] === '/api/cloud/snapshot')).toBe(false);
}, 15000);
it('opens a remembered device key only after the authenticated owner and remote header are verified', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const owner = crypto.randomUUID(), vault = await createVault(owner, 'synthetic remembered-device phrase');
  await deviceKeys.rememberDeviceVault(vault.session, { recoveryKey: vault.recoveryKey });
  const snapshot = { documents: [{ key: 'dynamic_diary-theme', value: 'dark', revision: 1 }], media: [] };
  const head = { header: vault.header, revision: 1, manifest: await vault.session.seal(JSON.stringify({ snapshot, files: {} }), 'manifest:1') };
  const load = vi.fn(async () => ({ default: () => <div>Remembered workspace</div> })), events: string[] = [];
  const read = vi.spyOn(deviceKeys, 'readDeviceVault');
  const fetcher = vi.fn<typeof fetch>(async path => { events.push(String(path)); return Response.json(String(path).endsWith('/config') ? { enabled: true, authenticated: true, vaultAvailable: true, user: { id: owner, email: 'wylgnerbossman@gmail.com' } } : head); });
  await act(async () => root.render(<CloudBootstrap loadApplication={load} fetcher={fetcher}/>));
  for (let index = 0; index < 100 && !load.mock.calls.length; index++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(load).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledWith(owner, vault.header);
  expect(events.slice(0, 2)).toEqual(['/api/cloud/config', '/api/cloud/vault']); expect(host.textContent).toContain('Remembered workspace');
  expect(fetcher.mock.calls.every(call => !call[1]?.body)).toBe(true); vault.session.dispose();
}, 15000);
it.each([
  { enabled: true, authenticated: false, vaultAvailable: true },
  { enabled: true, authenticated: true, vaultAvailable: true, passwordSetup: true, user: { id: 'owner', email: 'wylgnerbossman@gmail.com' } },
  { enabled: true, authenticated: true, vaultAvailable: true, user: { id: 'owner', email: 'unauthorized@example.test' } },
])('never reads device keys or imports stores before account authorization: %j', async config => {
  const read = vi.spyOn(deviceKeys, 'readDeviceVault'), load = vi.fn(), fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(config));
  await act(async () => root.render(<CloudBootstrap loadApplication={load} fetcher={fetcher}/>));
  expect(read).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('uses a password login when enabled and clears the password before opening the authenticated workspace', async () => {
  const load = vi.fn(async () => ({ default: () => <div>Workspace</div> })); let authenticated = false;
  const fetcher = vi.fn<typeof fetch>(async path => {
    if (String(path).endsWith('/config')) return Response.json({ enabled: true, authenticated, passwordAuth: true, authMethod: 'email_link', ...(authenticated ? { user: { id: 'allowed', email: 'wylgnerbossman@gmail.com' } } : {}) });
    if (String(path).endsWith('/sign-in')) { authenticated = true; return Response.json({ authenticated: true }); }
    return Response.json({ documents: [{ key: 'dynamic_diary-theme', value: 'dark', revision: 1 }], media: [] });
  });
  await act(async () => root.render(<CloudBootstrap loadApplication={load} fetcher={fetcher}/>));
  const password = host.querySelector<HTMLInputElement>('input[autocomplete="current-password"]'); expect(password).not.toBeNull();
  await fill(password!, 'visual-test-password'); await submit();
  const call = fetcher.mock.calls.find(([path]) => path === '/api/auth/password/sign-in')!;
  expect(JSON.parse(call[1]!.body as string)).toEqual({ email: 'wylgnerbossman@gmail.com', password: 'visual-test-password' });
  expect(load).toHaveBeenCalledOnce(); expect(host.textContent).toContain('Workspace'); expect(host.querySelector('input[type="password"]')).toBeNull();
});
it('offers a one-time setup link and clears the password when switching login methods', async () => {
  const load = vi.fn(async () => ({ default: () => <div>Workspace</div> }));
  const fetcher = vi.fn<typeof fetch>(async path => String(path).endsWith('/config') ? Response.json({ enabled: true, authenticated: false, passwordAuth: true, authMethod: 'email_link' }) : Response.json({ sent: true }));
  await act(async () => root.render(<CloudBootstrap loadApplication={load} fetcher={fetcher}/>));
  await fill(host.querySelector<HTMLInputElement>('input[autocomplete="current-password"]')!, 'visual-test-password');
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Criar ou recuperar senha')!.click());
  expect(host.querySelector('input[type="password"]')).toBeNull();
  await submit();
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe('/api/auth/password/setup-link');
  expect(host.textContent).toContain('neste navegador'); expect(load).not.toHaveBeenCalled();
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Voltar para entrar com senha')!.click());
  expect(host.querySelector<HTMLInputElement>('input[autocomplete="current-password"]')!.value).toBe('');
});
it('keeps password sign-in errors generic without opening stores or retaining the submitted secret', async () => {
  const load = vi.fn(async () => ({ default: () => <div>Workspace</div> }));
  const fetcher = vi.fn<typeof fetch>(async path => String(path).endsWith('/config') ? Response.json({ enabled: true, authenticated: false, passwordAuth: true }) : Response.json({ error: 'Account details should not render' }, { status: 401 }));
  await act(async () => root.render(<CloudBootstrap loadApplication={load} fetcher={fetcher}/>));
  await fill(host.querySelector<HTMLInputElement>('input[autocomplete="current-password"]')!, 'visual-test-password'); await submit();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Confira seu e-mail e senha');
  expect(host.textContent).not.toContain('Account details'); expect(load).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLInputElement>('input[autocomplete="current-password"]')!.value).toBe('');
});
it('finishes verified password setup before reading the snapshot or importing application stores', async () => {
  const load = vi.fn(async () => ({ default: () => <div>Workspace</div> })); let passwordSetup = true;
  const fetcher = vi.fn<typeof fetch>(async path => {
    if (String(path).endsWith('/config')) return Response.json({ enabled: true, authenticated: true, passwordAuth: true, passwordSetup, user: { id: 'allowed', email: 'wylgnerbossman@gmail.com' } });
    if (String(path) === '/api/auth/password') { passwordSetup = false; return Response.json({ saved: true }); }
    return Response.json({ documents: [{ key: 'dynamic_diary-theme', value: 'dark', revision: 1 }], media: [] });
  });
  await act(async () => root.render(<CloudBootstrap loadApplication={load} fetcher={fetcher}/>));
  expect(host.textContent).toContain('Criar nova senha'); expect(load).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
  const fields = host.querySelectorAll<HTMLInputElement>('input[autocomplete="new-password"]'); expect(fields.length).toBe(2);
  await fill(fields[0], 'visual-test-password'); await fill(fields[1], 'visual-test-password'); await submit();
  const call = fetcher.mock.calls.find(([path]) => path === '/api/auth/password')!;
  expect(JSON.parse(call[1]!.body as string)).toEqual({ password: 'visual-test-password' });
  expect(load).toHaveBeenCalledOnce(); expect(host.textContent).toContain('Workspace');
});
it('blocks mismatched or short passwords during setup without a remote mutation', async () => {
  const load = vi.fn(async () => ({ default: () => <div>Workspace</div> }));
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ enabled: true, authenticated: true, passwordAuth: true, passwordSetup: true, user: { id: 'allowed', email: 'wylgnerbossman@gmail.com' } }));
  await act(async () => root.render(<CloudBootstrap loadApplication={load} fetcher={fetcher}/>));
  const fields = host.querySelectorAll<HTMLInputElement>('input[autocomplete="new-password"]'); expect(fields.length).toBe(2);
  await fill(fields[0], 'visual-test-password'); await fill(fields[1], 'other-test-password'); await submit();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('As senhas precisam ser iguais'); expect(fetcher).toHaveBeenCalledTimes(1);
  await fill(fields[0], 'short'); await fill(fields[1], 'short'); await submit();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('pelo menos 10'); expect(fetcher).toHaveBeenCalledTimes(1); expect(load).not.toHaveBeenCalled();
});
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
