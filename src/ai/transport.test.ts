import { beforeEach, describe, expect, it, vi } from 'vitest';
const mode = vi.hoisted(() => ({ enabled: false }));
vi.mock('@/cloud/runtime', () => ({ isCloudEnabled: () => mode.enabled, sessionAwareFetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init) }));
import { providerTransport } from './transport';

describe('authenticated provider transport', () => {
  beforeEach(() => { mode.enabled = false; vi.restoreAllMocks(); });
  it('preserves local BYOK without replacing its transport', () => {
    expect(providerTransport('openrouter', 'local-key')).toEqual({ apiKey: 'local-key' });
  });
  it('cloud never supplies a local key and uses a same-origin authenticated proxy', async () => {
    mode.enabled = true;
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const transport = providerTransport('openrouter', 'must-stay-local');
    expect(transport.apiKey).toBe('cloud-session');
    expect(transport.baseURL).toBe('/api/ai/openrouter');
    const controller = new AbortController();
    await transport.fetch!('/api/ai/openrouter/chat/completions', {
      method: 'POST', body: '{}', signal: controller.signal,
      headers: { authorization: 'Bearer must-stay-local', 'x-api-key': 'must-stay-local', 'content-type': 'application/json' },
    });
    const request = fetcher.mock.calls[0][1]!;
    expect(request.credentials).toBe('same-origin');
    expect(request.redirect).toBe('error');
    expect(request.signal).toBe(controller.signal);
    const headers = new Headers(request.headers);
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('x-api-key')).toBeNull();
    expect(headers.get('x-cellproject-request')).toBe('1');
  });
  it('rejects an external destination before sending any authenticated request', async () => {
    mode.enabled = true;
    const fetcher = vi.spyOn(globalThis, 'fetch');
    await expect(providerTransport('openai', '').fetch!('https://example.invalid/chat/completions')).rejects.toThrow('Invalid provider endpoint');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
