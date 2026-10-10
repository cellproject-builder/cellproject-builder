import { afterEach, expect, it, vi } from 'vitest';
import { CloudRuntime, cloudJson, cloudProviderAvailable, configureCloud, isCloudEnabled, sessionAwareFetch } from './runtime';
import { providerTransport } from '@/ai/transport';
import { configureVault } from './vault/privacy';
import type { VaultSession } from './vault/crypto';

afterEach(() => { configureCloud(null); configureVault(null, false); vi.restoreAllMocks(); });
const checkpoints = { read: async <T,>() => null as T | null, write: async () => {}, remove: async () => {} };
it.each([false, true])('blocks every content-sharing gateway POST before consent or fetch when browser online=%s but the offline owner/head are unverified', async online => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
  const runtime = new CloudRuntime({ documents: [], media: [] }, vi.fn(), undefined, undefined, { persistence: checkpoints, networkReady: () => false });
  configureCloud(runtime, { openai: true, openrouter: true, anthropic: true }); configureVault({} as VaultSession);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true), fetcher = vi.fn<typeof fetch>(async () => Response.json({}));
  for (const path of ['/api/ai/openai/responses', '/api/ai/openrouter/chat/completions', '/api/ai/anthropic/messages', '/api/visuals/search', '/api/visuals/plan-intake', '/api/visuals/reference-sessions', '/api/visuals/specifications', '/api/visuals/decomposition-research']) {
    await expect(sessionAwareFetch(path, { method: 'POST', body: '{"text":"private offline draft"}' }, fetcher)).rejects.toThrow(/conexão.*conta.*cofre/i);
  }
  const request = new Request(new URL('/api/visuals/review', window.location.href), { method: 'POST', body: 'private selection' });
  await expect(sessionAwareFetch(request, undefined, fetcher)).rejects.toThrow(/conexão.*conta.*cofre/i);
  expect(fetcher).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
  expect(cloudProviderAvailable('openai')).toBe(false); expect(isCloudEnabled()).toBe(true);
});
it.each(['openai', 'anthropic', 'openrouter'] as const)('keeps direct %s cloud provider calls gated without selecting a local credential', async provider => {
  const runtime = new CloudRuntime({ documents: [], media: [] }, vi.fn(), undefined, undefined, { persistence: checkpoints, networkReady: () => false });
  configureCloud(runtime, { [provider]: true }); configureVault({} as VaultSession);
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({})), confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  const transport = providerTransport(provider, 'synthetic-must-not-fallback');
  expect(transport.apiKey).toBe('cloud-session');
  const endpoint = provider === 'openai' ? 'responses' : provider === 'anthropic' ? 'messages' : 'chat/completions';
  await expect(transport.fetch!(`/api/ai/${provider}/${endpoint}`, { method: 'POST', body: 'private offline context' })).rejects.toThrow(/conexão.*conta.*cofre/i);
  await expect(transport.fetch!('https://api.openai.com/v1/responses', { method: 'POST', body: 'private offline context' })).rejects.toThrow('Invalid provider endpoint');
  expect(fetcher).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
});
it('leaves config, encrypted-head reads and authentication recovery available while sharing is blocked', async () => {
  const runtime = new CloudRuntime({ documents: [], media: [] }, vi.fn(), undefined, undefined, { persistence: checkpoints, networkReady: () => false }); configureCloud(runtime); configureVault({} as VaultSession);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false), fetcher = vi.fn<typeof fetch>(async () => Response.json({}));
  await sessionAwareFetch('/api/cloud/config', {}, fetcher);
  await sessionAwareFetch('/api/cloud/vault', {}, fetcher);
  await sessionAwareFetch('/api/auth/password/session', { method: 'POST', body: '{"accessToken":"synthetic"}' }, fetcher);
  await sessionAwareFetch('/api/visuals/capabilities', {}, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(4); expect(confirm).not.toHaveBeenCalled(); expect(runtime.getSnapshot().offline).toBe(true);
});
it('allows sharing only after the verified reconnect gate opens and retains explicit privacy consent', async () => {
  let verified = false;
  const runtime = new CloudRuntime({ documents: [], media: [] }, vi.fn(), undefined, undefined, { persistence: checkpoints, networkReady: () => verified });
  configureCloud(runtime, { openai: true }); configureVault({} as VaultSession);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false), fetcher = vi.fn<typeof fetch>(async () => Response.json({}));
  await expect(sessionAwareFetch('/api/ai/openai/responses', { method: 'POST' }, fetcher)).rejects.toThrow(/conexão.*conta.*cofre/i);
  expect(confirm).not.toHaveBeenCalled(); expect(cloudProviderAvailable('openai')).toBe(false);
  verified = true; runtime.notifyNetworkState();
  expect(cloudProviderAvailable('openai')).toBe(true);
  await expect(sessionAwareFetch('/api/ai/openai/responses', { method: 'POST' }, fetcher)).rejects.toThrow('não autorizado');
  expect(fetcher).not.toHaveBeenCalled(); expect(confirm).toHaveBeenCalledOnce();
  confirm.mockReturnValue(true);
  await sessionAwareFetch('/api/ai/openai/responses', { method: 'POST' }, fetcher);
  await sessionAwareFetch('/api/visuals/specifications', { method: 'POST' }, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(2); expect(confirm).toHaveBeenCalledTimes(2);
  verified = false; runtime.notifyNetworkState();
  await expect(sessionAwareFetch('/api/visuals/specifications', { method: 'POST' }, fetcher)).rejects.toThrow(/conexão.*conta.*cofre/i);
  expect(fetcher).toHaveBeenCalledTimes(2); expect(confirm).toHaveBeenCalledTimes(2);
});
it('notifies an AI-only expired session without retrying the paid request or selecting local BYOK', async () => {
  const runtime = new CloudRuntime({ documents: [{ key: 'cellproject-workspace', value: '{"state":{"notes":{"n":"keep"}},"version":2}', revision: 1 }], media: [] }); configureCloud(runtime, { openrouter: true });
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
  const result = await providerTransport('openrouter', 'must-remain-local').fetch!('/api/ai/openrouter/chat/completions', { method: 'POST', body: '{}' });
  expect(result.status).toBe(401); expect(fetcher).toHaveBeenCalledOnce(); expect(isCloudEnabled()).toBe(true);
  expect(runtime.getSnapshot().issue).toMatchObject({ kind: 'session', key: '/api/ai/openrouter/chat/completions' });
  expect(runtime.get('cellproject-workspace')).toContain('keep');
});
it.each([401, 403])('notifies search and cloud failures (%s), preserving current drafts and excluding query data from status', async status => {
  const runtime = new CloudRuntime({ documents: [], media: [] }, vi.fn(async () => { throw new Error('response lost'); })); configureCloud(runtime);
  await runtime.write('cellproject-graph', '{"state":{"drafts":{"n":"unsaved"}},"version":0}');
  const fetcher = vi.fn<typeof fetch>(async () => new Response('{}', { status }));
  await sessionAwareFetch('/api/visuals/search?private=not-for-status', {}, fetcher);
  expect(fetcher).toHaveBeenCalledOnce(); expect(runtime.getSnapshot().issue).toMatchObject({ kind: 'session', key: '/api/visuals/search' });
  expect(runtime.getSnapshot().pending).toBe(1); expect(runtime.get('cellproject-graph')).toContain('unsaved');
  await expect(cloudJson('/api/cloud/snapshot', {}, fetcher)).rejects.toThrow('Sessão'); expect(fetcher).toHaveBeenCalledTimes(2);
});
