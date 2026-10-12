import { isCloudEnabled, sessionAwareFetch } from '@/cloud/runtime';
import { isPublicDemo, PUBLIC_DEMO_AI_MESSAGE } from '@/demo/session';

type ProviderName = 'openai' | 'anthropic' | 'openrouter';
interface ProviderTransport { apiKey: string; baseURL?: string; fetch?: typeof fetch }

/** Cloud SDKs serialize requests normally, but only our authenticated server owns keys. */
export function providerTransport(provider: ProviderName, localKey: string): ProviderTransport {
  if (isPublicDemo()) throw new Error(PUBLIC_DEMO_AI_MESSAGE);
  if (!isCloudEnabled()) return { apiKey: localKey };
  const baseURL = `/api/ai/${provider}`;
  return {
    apiKey: 'cloud-session', baseURL,
    fetch: async (input, init) => {
      const origin = window.location.origin;
      const url = new URL(input instanceof Request ? input.url : String(input), origin);
      if (url.origin !== origin || !url.pathname.startsWith(`${baseURL}/`)) throw new Error('Invalid provider endpoint');
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
      headers.delete('authorization'); headers.delete('x-api-key');
      headers.delete('anthropic-dangerous-direct-browser-access');
      headers.set('X-Cellproject-Request', '1');
      return sessionAwareFetch(input, { ...init, headers, credentials: 'same-origin', redirect: 'error' });
    },
  };
}
