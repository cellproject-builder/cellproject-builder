import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CloudSessionRecovery } from './CloudSessionRecovery';
import { CloudRuntime, configureCloud, getCloudRuntime } from './runtime';

const provider = { url: 'https://wxfootrnfiqpzhmjwgck.supabase.co', publishableKey: 'sb_publishable_synthetic' };
let host: HTMLDivElement, root: Root, runtime: CloudRuntime;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); configureCloud(null); vi.restoreAllMocks(); });
const account = (id = 'owner') => Response.json({ enabled: true, authenticated: true, user: { id, email: 'synthetic@example.test' } });
async function mount(fetcher: typeof fetch, useProvider = true) {
  runtime = new CloudRuntime({ documents: [{ key: 'dynamic_diary-theme', value: 'dark', revision: 1 }], media: [] }, fetcher);
  configureCloud(runtime); runtime.notifySessionExpired('/api/live/ink');
  await act(async () => root.render(<CloudSessionRecovery runtime={runtime} userId="owner" email="synthetic@example.test" provider={useProvider ? provider : undefined} fetcher={fetcher}/>));
}
async function submit(secret: string) {
  const field = host.querySelector<HTMLInputElement>('input[type="password"]')!;
  await act(async () => { field.value = secret; host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  return field;
}

it('signs in inside the current tab, sends the password only to Supabase and resumes the original runtime with its draft', async () => {
  let authenticated = false;
  const fetcher = vi.fn<typeof fetch>(async (path, init) => {
    if (String(path).startsWith(provider.url)) return Response.json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' });
    if (String(path).endsWith('/password/session')) { authenticated = true; return Response.json({ authenticated: true }); }
    if (String(path).endsWith('/config')) return account();
    if (String(path).includes('/documents/')) return authenticated ? Response.json({ revision: 2 }) : new Response(null, { status: 401 });
    throw new Error(`Unexpected synthetic path ${path} ${init?.method}`);
  });
  await mount(fetcher);
  await act(async () => { await runtime.write('dynamic_diary-theme', 'draft-not-yet-saved'); });
  expect(runtime.getSnapshot().pending).toBe(1); expect(runtime.get('dynamic_diary-theme')).toBe('draft-not-yet-saved');
  const field = await submit('synthetic-private-password');
  expect(getCloudRuntime()).toBe(runtime); expect(runtime.getSnapshot().issue).toBeNull(); expect(runtime.getSnapshot().pending).toBe(0);
  expect(runtime.get('dynamic_diary-theme')).toBe('draft-not-yet-saved'); expect(field.value).toBe('');
  expect(fetcher.mock.calls.filter(call => String(call[1]?.body).includes('synthetic-private-password'))).toHaveLength(1);
  const passwordRequest = fetcher.mock.calls.find(call => String(call[1]?.body).includes('synthetic-private-password'))!;
  expect(String(passwordRequest[0])).toBe(`${provider.url}/auth/v1/token?grant_type=password`); expect(passwordRequest[1]?.credentials).toBe('omit');
  expect(host.querySelector('a[target="_blank"]')).toBeNull();
});

it('clears a refused password and leaves the draft untouched without attempting session recovery', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 401 }));
  await mount(fetcher);
  const resume = vi.spyOn(runtime, 'resumeAfterAuthentication'), field = await submit('synthetic-wrong-password');
  expect(resume).not.toHaveBeenCalled(); expect(runtime.getSnapshot().issue?.kind).toBe('session'); expect(field.value).toBe('');
  expect(host.textContent).toContain('senha'); expect(fetcher).toHaveBeenCalledOnce();
});

it('checks the same owner automatically on window focus and deduplicates an in-flight visibility check', async () => {
  let release!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>(() => new Promise(resolve => { release = resolve; }));
  await mount(fetcher);
  await act(async () => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
  expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][0]).toBe('/api/cloud/config');
  await act(async () => { release(account()); });
  expect(runtime.getSnapshot().issue).toBeNull(); expect(getCloudRuntime()).toBe(runtime);
});

it('does not resume another account after automatic focus validation', async () => {
  await mount(vi.fn<typeof fetch>(async () => account('different-owner')));
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(runtime.getSnapshot().issue?.kind).toBe('session'); expect(host.querySelector('input[type="password"]')).not.toBeNull();
});

it('clears the native password field and aborts its authentication request when the recovery component unmounts', async () => {
  let signal: AbortSignal | undefined;
  const fetcher = vi.fn<typeof fetch>(async (_path, init) => { signal = init?.signal as AbortSignal; return new Promise<Response>(() => {}); });
  await mount(fetcher);
  const field = host.querySelector<HTMLInputElement>('input[type="password"]')!; field.value = 'synthetic-pending-password';
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await act(async () => root.render(null));
  expect(field.value).toBe(''); expect(signal?.aborted).toBe(true);
});

it('keeps the existing separate-tab fallback when no password provider is configured', async () => {
  await mount(vi.fn<typeof fetch>(async () => account()), false);
  expect(host.querySelector('input[type="password"]')).toBeNull();
  expect(host.querySelector('a[target="_blank"]')?.getAttribute('rel')).toContain('noopener');
  expect(host.textContent).toContain('Retomar salvamento nesta aba');
});
