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
