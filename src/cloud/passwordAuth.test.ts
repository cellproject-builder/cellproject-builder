import { describe, expect, it, vi } from 'vitest';
import { signInPassword, updateAccountPassword } from './passwordAuth';

const provider = { url: 'https://wxfootrnfiqpzhmjwgck.supabase.co', publishableKey: 'sb_publishable_synthetic' };
const credentials = { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' };

describe('direct provider password authentication', () => {
  it('sends the exact password only to Supabase and exchanges only tokens with the app', async () => {
    const fetcher = vi.fn<typeof fetch>(async target => String(target).startsWith(provider.url) ? Response.json(credentials) : Response.json({ authenticated: true }));
    await expect(signInPassword('test@example.com', '  private password  ', provider, fetcher)).resolves.toEqual({ authenticated: true });
    const [directUrl, direct] = fetcher.mock.calls[0];
    expect(directUrl).toBe(`${provider.url}/auth/v1/token?grant_type=password`);
    expect(direct).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
    expect(JSON.parse(direct!.body as string)).toEqual({ email: 'test@example.com', password: '  private password  ' });
    const [ownUrl, own] = fetcher.mock.calls[1];
    expect(ownUrl).toBe('/api/auth/password/session');
    expect(JSON.parse(own!.body as string)).toEqual({ accessToken: credentials.access_token, refreshToken: credentials.refresh_token });
    expect(own!.body).not.toContain('private password');
  });

  it.each(['https://attacker.example', `${provider.url}/other`, 'http://wxfootrnfiqpzhmjwgck.supabase.co'])('rejects an unexpected password destination before fetching (%s)', async url => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(signInPassword('test@example.com', 'secret', { ...provider, url }, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['sb_secret_NEVER_PUBLIC', 'public-but-invalid', 'sb_publishable_', `header.${btoa(JSON.stringify({ role: 'service_role' }))}.signature`])('rejects private or malformed provider keys (%s)', async publishableKey => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(signInPassword('test@example.com', 'secret', { ...provider, publishableKey }, fetcher)).rejects.toThrow('não está configurado');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('hides provider error details and never exchanges a malformed token response', async () => {
    const denied = vi.fn<typeof fetch>(async () => Response.json({ error: 'PRIVATE_PASSWORD provider-secret' }, { status: 400 }));
    await expect(signInPassword('test@example.com', 'secret', provider, denied)).rejects.toThrow('E-mail ou senha incorretos');
    const malformed = vi.fn<typeof fetch>(async () => Response.json({ access_token: 'token-only' }));
    await expect(signInPassword('test@example.com', 'secret', provider, malformed)).rejects.toThrow();
    expect(malformed).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('updates directly, verifies the new password and consumes setup by replacing its cookie (same password retry: %s)', async retry => {
    const fetcher = vi.fn<typeof fetch>(async (target, init) => {
      if (target === '/api/auth/password/setup-session') return Response.json({ accessToken: 'setup-access' });
      if (String(target).endsWith('/auth/v1/user')) return retry ? Response.json({ code: 'same_password', msg: 'PRIVATE_PROVIDER_MESSAGE' }, { status: 422 }) : Response.json({ id: 'owner' });
      if (String(target).includes('grant_type=password')) return Response.json(credentials);
      expect(init!.body).not.toContain('new private password');
      return Response.json({ authenticated: true });
    });
    await expect(updateAccountPassword('test@example.com', 'new private password', provider, fetcher)).resolves.toEqual({ authenticated: true });
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/auth/password/setup-session', `${provider.url}/auth/v1/user`, `${provider.url}/auth/v1/token?grant_type=password`, '/api/auth/password/session']);
    const update = fetcher.mock.calls[1][1]!;
    expect(update.headers).toMatchObject({ authorization: 'Bearer setup-access', apikey: provider.publishableKey });
    expect(update.credentials).toBe('omit');
    expect(JSON.parse(update.body as string)).toEqual({ password: 'new private password' });
  });

  it('does not claim success if verification or cookie exchange fails after the provider updated the password', async () => {
    const fetcher = vi.fn<typeof fetch>(async target => {
      if (target === '/api/auth/password/setup-session') return Response.json({ accessToken: 'setup-access' });
      if (String(target).endsWith('/user')) return Response.json({ id: 'owner' });
      if (String(target).includes('grant_type=password')) return Response.json(credentials);
      return Response.json({}, { status: 502 });
    });
    await expect(updateAccountPassword('test@example.com', 'new private password', provider, fetcher)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('finishes an ambiguous password update through a fresh password login when its old setup session was revoked', async () => {
    const fetcher = vi.fn<typeof fetch>(async target => {
      if (target === '/api/auth/password/setup-session') return Response.json({}, { status: 401 });
      if (String(target).includes('grant_type=password')) return Response.json(credentials);
      return Response.json({ authenticated: true });
    });
    await expect(updateAccountPassword('test@example.com', 'new private password', provider, fetcher)).resolves.toEqual({ authenticated: true });
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/auth/password/setup-session', `${provider.url}/auth/v1/token?grant_type=password`, '/api/auth/password/session']);
  });
});
