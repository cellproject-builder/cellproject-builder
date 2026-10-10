import { afterEach, expect, it, vi } from 'vitest';
import { CloudRuntime, cloudJson, configureCloud, isCloudEnabled, sessionAwareFetch } from './runtime';
import { providerTransport } from '@/ai/transport';

afterEach(() => { configureCloud(null); vi.restoreAllMocks(); });
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
