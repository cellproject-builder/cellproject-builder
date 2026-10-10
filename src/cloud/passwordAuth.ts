import { CloudHttpError, cloudJson, mutationHeaders } from './runtime';

export interface PasswordProvider { url: string; publishableKey: string }
export interface PasswordAuthentication { authenticated: boolean }
const PASSWORD_ORIGIN = 'https://wxfootrnfiqpzhmjwgck.supabase.co';

function validateProvider(provider: PasswordProvider) {
  let publicKey = false;
  if (provider && typeof provider.publishableKey === 'string' && provider.publishableKey.length <= 8192) {
    const value = provider.publishableKey;
    publicKey = /^sb_publishable_[A-Za-z0-9_-]{1,256}$/.test(value);
    if (!publicKey && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
      try {
        const decode = (part: string) => JSON.parse(atob(part.replaceAll('-', '+').replaceAll('_', '/')));
        const [header, payload] = value.split('.').slice(0, 2).map(decode);
        publicKey = header?.alg === 'HS256' && payload?.role === 'anon' && payload.iss === 'supabase' && payload.ref === 'wxfootrnfiqpzhmjwgck';
      } catch { /* Only a project-scoped legacy anon JWT is public. */ }
    }
  }
  if (!provider || provider.url !== PASSWORD_ORIGIN || !publicKey) throw new Error('O serviço de acesso não está configurado corretamente.');
}

// Each operation receives its fetcher explicitly; credentials are kept only in this call stack.
async function passwordGrant(email: string, password: string, provider: PasswordProvider, fetcher: typeof fetch) {
  const { response, value } = await request(provider, 'token?grant_type=password', { email, password }, fetcher);
  if (!response.ok) throw new CloudHttpError(response.status === 429 ? 429 : 401, response.status === 429 ? 'Você fez muitas tentativas. Aguarde um pouco e tente novamente.' : 'E-mail ou senha incorretos.');
  if (typeof value.access_token !== 'string' || !value.access_token || value.access_token.length > 32768 || typeof value.refresh_token !== 'string' || !value.refresh_token || value.refresh_token.length > 16384) throw new CloudHttpError(502, 'O serviço de acesso retornou uma sessão inválida. Tente novamente.');
  return { accessToken: value.access_token, refreshToken: value.refresh_token };
}

async function request(provider: PasswordProvider, path: string, body: object, fetcher: typeof fetch, token?: string): Promise<{ response: Response; value: Record<string, unknown> }> {
  validateProvider(provider);
  let response: Response;
  try {
    response = await fetcher(`${provider.url}/auth/v1/${path}`, {
      method: path === 'user' ? 'PUT' : 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
      headers: { 'content-type': 'application/json', apikey: provider.publishableKey, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    });
  } catch { throw new CloudHttpError(503, 'Não foi possível conectar ao serviço de acesso. Tente novamente.'); }
  let value: Record<string, unknown> = {};
  try { const parsed: unknown = await response.json(); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed as Record<string, unknown>; } catch { /* Never surface provider response text. */ }
  return { response, value };
}

/** Only Supabase receives the password; the application receives validated bearer tokens. */
export async function signInPassword(email: string, password: string, provider: PasswordProvider, fetcher: typeof fetch = fetch): Promise<PasswordAuthentication> {
  const tokens = await passwordGrant(email, password, provider, fetcher);
  const result = await cloudJson<PasswordAuthentication>('/api/auth/password/session', { method: 'POST', headers: mutationHeaders, body: JSON.stringify(tokens) }, fetcher);
  if (result.authenticated !== true) throw new CloudHttpError(401, 'Não foi possível concluir o acesso. Tente novamente.');
  return result;
}

/** Call after preparing any vault password wrapper, then commit that wrapper after success. */
export async function updateAccountPassword(email: string, password: string, provider: PasswordProvider, fetcher: typeof fetch = fetch): Promise<PasswordAuthentication> {
  validateProvider(provider);
  let setup: { accessToken: string };
  try { setup = await cloudJson<{ accessToken: string }>('/api/auth/password/setup-session', {}, fetcher); }
  catch (reason) {
    if (!(reason instanceof CloudHttpError) || ![401, 403].includes(reason.status)) throw reason;
    // Updating the password may invalidate the email-link session before its
    // successful response reaches us. The chosen password can still prove the
    // update through a new login; it cannot authorize another password change.
    try { return await signInPassword(email, password, provider, fetcher); }
    catch (verification) { if (verification instanceof CloudHttpError && verification.status === 401) throw reason; throw verification; }
  }
  if (typeof setup.accessToken !== 'string' || !setup.accessToken || setup.accessToken.length > 32768) throw new CloudHttpError(403, 'Solicite um novo link para redefinir sua senha.');
  const { response, value } = await request(provider, 'user', { password }, fetcher, setup.accessToken);
  // A lost successful response may make the retry return same_password. A fresh
  // password grant proves that the chosen password works before replacing the cookie.
  const samePassword = [400, 422].includes(response.status) && (value.code === 'same_password' || value.error_code === 'same_password');
  if (!response.ok && !samePassword) {
    if (response.status === 429) throw new CloudHttpError(429, 'Você fez muitas tentativas. Aguarde um pouco e tente novamente.');
    if ([401, 403].includes(response.status)) throw new CloudHttpError(403, 'Este link de senha expirou. Solicite um novo link para continuar.');
    throw new CloudHttpError(400, 'Esta senha não foi aceita. Escolha outra senha com pelo menos 10 caracteres.');
  }
  return signInPassword(email, password, provider, fetcher);
}
