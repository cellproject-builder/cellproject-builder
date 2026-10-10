import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PasswordSetup } from './PasswordSetup';
let host: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function fillPasswords() {
  for (const field of host.querySelectorAll('input')) await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'visual-test-password'); field.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function submit() { await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
it.each(['a'.repeat(73), '🌙'.repeat(19)])('enforces the provider byte limit before sending the password', async password => {
  const onSaved = vi.fn(async () => {}), fetcher = vi.fn<typeof fetch>();
  await act(async () => root.render(<PasswordSetup email="conta de teste" onSaved={onSaved} fetcher={fetcher}/>));
  for (const field of host.querySelectorAll('input')) await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, password); field.dispatchEvent(new Event('input', { bubbles: true })); });
  await submit(); expect(fetcher).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toContain('reduza o tamanho');
});
it.each([400, 422])('explains a rejected password without claiming its verified link expired (%s)', async status => {
  const onSaved = vi.fn(async () => {}), fetcher = vi.fn<typeof fetch>(async () => Response.json({ error: 'private provider message' }, { status }));
  await act(async () => root.render(<PasswordSetup email="conta de teste" onSaved={onSaved} fetcher={fetcher}/>));
  await fillPasswords(); await submit();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Escolha outra senha');
  expect(host.textContent).not.toContain('private provider'); expect(host.textContent).not.toContain('link pode ter expirado'); expect(onSaved).not.toHaveBeenCalled();
});
it('offers a fresh verified link after setup authorization expires without retaining the password', async () => {
  const onSaved = vi.fn(async () => {}), fetcher = vi.fn<typeof fetch>(async path => String(path) === '/api/auth/password' ? Response.json({}, { status: 403 }) : Response.json({ sent: true }));
  await act(async () => root.render(<PasswordSetup email="conta de teste" onSaved={onSaved} fetcher={fetcher}/>));
  await fillPasswords(); await submit();
  expect([...host.querySelectorAll('input')].every(input => input.value === '')).toBe(true);
  const renew = [...host.querySelectorAll('button')].find(button => button.textContent === 'Enviar novo link de senha'); expect(renew).toBeDefined();
  await act(async () => renew!.click());
  expect(fetcher.mock.calls[1][0]).toBe('/api/auth/password/setup-link'); expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({ email: 'conta de teste' });
  expect(host.querySelector('[role="status"]')?.textContent).toContain('neste navegador'); expect(onSaved).not.toHaveBeenCalled();
});

const provider = { url: 'https://wxfootrnfiqpzhmjwgck.supabase.co', publishableKey: 'sb_publishable_synthetic' };
const setupFetcher = () => vi.fn<typeof fetch>(async target => {
  if (target === '/api/auth/password/setup-session') return Response.json({ accessToken: 'synthetic-setup-access' });
  if (String(target).endsWith('/auth/v1/user')) return Response.json({ id: 'owner' });
  if (String(target).includes('grant_type=password')) return Response.json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' });
  if (target === '/api/auth/password/session') return Response.json({ authenticated: true });
  throw new Error('Unexpected route');
});

it('checks private-data access before changing the account password and blocks Auth when that preflight fails', async () => {
  const fetcher = setupFetcher(), onSaved = vi.fn(async () => {}), prepareProtection = vi.fn(async () => { throw new Error('Use um aparelho autorizado para preservar seus dados.'); });
  await act(async () => root.render(<PasswordSetup email="conta de teste" provider={provider} onSaved={onSaved} fetcher={fetcher} prepareProtection={prepareProtection}/>));
  await fillPasswords(); await submit();
  expect(prepareProtection).toHaveBeenCalledWith('visual-test-password'); expect(fetcher).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('aparelho autorizado');
});

it('clears password fields after Auth succeeds and retries only the existing protection commit after a 502', async () => {
  const fetcher = setupFetcher(), onSaved = vi.fn(async () => {}), commit = vi.fn().mockRejectedValueOnce(new Error('502')).mockResolvedValue(undefined), dispose = vi.fn();
  const prepareProtection = vi.fn(async () => ({ commit, dispose }));
  await act(async () => root.render(<PasswordSetup email="conta de teste" provider={provider} onSaved={onSaved} fetcher={fetcher} prepareProtection={prepareProtection}/>));
  await fillPasswords(); await submit();
  expect(fetcher).toHaveBeenCalledTimes(4); expect(prepareProtection).toHaveBeenCalledOnce(); expect(commit).toHaveBeenCalledOnce(); expect(onSaved).not.toHaveBeenCalled();
  expect(host.querySelectorAll('input[type=password]')).toHaveLength(0); expect(host.textContent).toContain('Sua senha foi atualizada');
  const finish = [...host.querySelectorAll('button')].find(button => button.textContent === 'Concluir proteção e continuar'); expect(finish).toBeDefined();
  await act(async () => finish!.click());
  expect(commit).toHaveBeenCalledTimes(2); expect(fetcher).toHaveBeenCalledTimes(4); expect(prepareProtection).toHaveBeenCalledOnce(); expect(dispose).toHaveBeenCalledOnce(); expect(onSaved).toHaveBeenCalledOnce();
});

it('cancels deferred private-data preflight after unmount without issuing any auth mutation', async () => {
  let resolve!: (value: { commit: () => Promise<void>; dispose: () => void }) => void;
  const pending = new Promise<{ commit: () => Promise<void>; dispose: () => void }>(ready => { resolve = ready; });
  const fetcher = setupFetcher(), onSaved = vi.fn(async () => {}), commit = vi.fn(async () => {}), dispose = vi.fn(), prepareProtection = vi.fn(() => pending);
  await act(async () => root.render(<PasswordSetup email="conta de teste" provider={provider} onSaved={onSaved} fetcher={fetcher} prepareProtection={prepareProtection}/>));
  await fillPasswords(); await submit(); await act(async () => root.unmount());
  await act(async () => { resolve({ commit, dispose }); await pending; });
  expect(fetcher).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled(); expect(onSaved).not.toHaveBeenCalled(); expect(dispose).toHaveBeenCalledOnce();
});
