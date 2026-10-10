import { createHash, randomBytes } from 'node:crypto';
import { CloudError, invalid, unavailable, remoteJson, timeoutSignal } from './cloudUtils.mjs';
export { CloudError } from './cloudUtils.mjs';

const EMAIL = 'wylgnerbossman@gmail.com';
const PROJECT_URL = 'https://wxfootrnfiqpzhmjwgck.supabase.co';
const COOKIE = '__Host-cellproject_session';
const FLOW_COOKIE = '__Host-cellproject_auth_flow';
const FLOW_LIFETIME = 15 * 60_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

// No env reads at import time; credentials are never serialized to public configuration.
export function readCloudConfig(env = process.env) {
  const enabled = env.CELLPROJECT_CLOUD_ENABLED === 'true';
  if (!enabled) return { enabled: false, origin: env.APP_ORIGIN || null };
  const fail = () => { throw new Error('Invalid production cloud configuration.'); };
  let origin;
  try { origin = new URL(env.APP_ORIGIN); } catch { fail(); }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || origin.origin !== env.APP_ORIGIN) fail();
  if (env.SUPABASE_URL !== PROJECT_URL || !env.SUPABASE_PUBLISHABLE_KEY?.trim()) fail();
  if (env.SUPABASE_ALLOWED_EMAIL && env.SUPABASE_ALLOWED_EMAIL !== EMAIL) fail();
  if (env.SUPABASE_ALLOWED_USER_ID && !UUID.test(env.SUPABASE_ALLOWED_USER_ID)) fail();
  const alternateOrigins = (env.APP_ALTERNATE_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  for (const value of alternateOrigins) { let alternate; try { alternate = new URL(value); } catch { fail(); } if (alternate.protocol !== 'https:' || alternate.username || alternate.password || alternate.origin !== value) fail(); }
  return { enabled, origin: origin.origin, alternateOrigins, supabaseUrl: PROJECT_URL, publishableKey: env.SUPABASE_PUBLISHABLE_KEY.trim(), allowedEmail: EMAIL, allowedUserId: env.SUPABASE_ALLOWED_USER_ID || null, sessionLifetime: 8 * 60 * 60_000, bucket: 'cellproject-media' };
}

export function createCloudAuth({ config, fetchImpl = fetch, now = Date.now } = {}) {
  const sessions = new Map(); const attempts = new Map(); const flows = new Map(); const inFlightFlows = new Map(); let closed = false;
  const prune = () => { for (const [key, session] of sessions) if (session.expiresAt <= now()) sessions.delete(key); for (const [key, value] of attempts) if (value.until <= now()) attempts.delete(key); for (const [key, flow] of flows) if (flow.expiresAt <= now()) flows.delete(key); };
  const deny = () => new CloudError(401, 'authentication_required', 'Sign in to continue.');
  const sameOrigin = req => {
    if (!config?.enabled || !config.origin) return false;
    let canonical;
    try { canonical = new URL(config.origin); } catch { return false; }
    if (req.headers.host !== canonical.host) return false;
    if (req.headers.origin !== undefined && req.headers.origin !== canonical.origin) return false;
    if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return false;
    if (!['GET', 'HEAD'].includes(req.method) && (req.headers.origin !== canonical.origin || req.headers['x-cellproject-request'] !== '1')) return false;
    return true;
  };
  const handle = (req, name = COOKIE) => {
    const values = (req.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
    if (values.length !== 1) return null;
    const id = values[0].slice(name.length + 1); return /^[A-Za-z0-9_-]{43}$/.test(id) ? id : null;
  };
  const setCookie = (res, value, seconds, name = COOKIE, sameSite = 'Strict') => {
    const cookie = `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${seconds}`;
    const prior = res.getHeader?.('set-cookie');
    const retained = prior ? (Array.isArray(prior) ? prior : [prior]).filter(value => !value.startsWith(`${name}=`)) : [];
    res.setHeader('set-cookie', retained.length ? [...retained, cookie] : cookie);
  };
  const invalidateFlow = id => {
    const flow = flows.get(id) ?? inFlightFlows.get(id); if (flow) flow.cancelled = true;
    flows.delete(id);
  };
  const clearFlow = (req, res, force = false) => {
    const id = handle(req, FLOW_COOKIE); invalidateFlow(id);
    if (id || force) setCookie(res, '', 0, FLOW_COOKIE, 'Lax');
  };
  const throttle = (kind, req, max) => {
    prune();
    const keys = [`${kind}:global`, `${kind}:${req.socket?.remoteAddress ?? 'unknown'}`];
    for (const key of keys) if ((attempts.get(key)?.count ?? 0) >= max) throw new CloudError(429, 'auth_rate_limited', 'Too many sign-in attempts. Please wait before trying again.');
    if (attempts.size > 1000) throw new CloudError(429, 'auth_rate_limited', 'Too many sign-in attempts. Please wait before trying again.');
    for (const key of keys) { const window = attempts.get(key) ?? { count: 0, until: now() + 15 * 60_000 }; window.count++; attempts.set(key, window); }
  };
  const emailInput = value => {
    if (typeof value !== 'string' || value.length > 254 || value.trim().toLowerCase() !== config.allowedEmail) throw new CloudError(403, 'account_not_allowed', 'This account is not permitted.');
    return config.allowedEmail;
  };
  const call = async (path, { token, body, method = body ? 'POST' : 'GET', signal } = {}) => {
    let result;
    try { result = await fetchImpl(`${config.supabaseUrl}${path}`, { method, headers: { apikey: config.publishableKey, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: timeoutSignal(signal) }); }
    catch { throw unavailable(); }
    if (!result.ok) { await result.body?.cancel(); if ([400, 401, 403, 422].includes(result.status)) throw deny(); if (result.status === 429) throw new CloudError(429, 'auth_rate_limited', 'Too many sign-in attempts. Please wait before trying again.'); throw unavailable(); }
    if (result.status === 204) return null;
    return remoteJson(result);
  };
  const validateUser = user => {
    if (!user || !UUID.test(user.id) || user.email?.toLowerCase() !== config.allowedEmail || !user.email_confirmed_at || user.is_anonymous === true || (config.allowedUserId && user.id !== config.allowedUserId)) throw deny();
    if (user.banned_until && Date.parse(user.banned_until) > now()) throw deny();
    return { id: user.id, email: config.allowedEmail };
  };
  const validateToken = (token, userId) => {
    let claim;
    try { if (typeof token !== 'string' || token.length > 32_768 || token.split('.').length !== 3) throw new Error(); claim = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch { throw deny(); }
    // Signature/account are validated by GET /auth/v1/user on the same fixed project,
    // then the SQL helper verifies the active auth.sessions row and server-owned allowlist.
    if (claim.iss !== `${config.supabaseUrl}/auth/v1` || claim.sub !== userId || !(claim.aud === 'authenticated' || Array.isArray(claim.aud) && claim.aud.includes('authenticated')) || !Number.isFinite(claim.exp) || claim.exp * 1000 <= now()) throw deny();
    return claim.exp * 1000;
  };
  const identity = async token => {
    const user = validateUser(await call('/auth/v1/user', { token }));
    const tokenExpiresAt = validateToken(token, user.id);
    if (await call('/rest/v1/rpc/cellproject_authorized', { token, body: {} }) !== true) throw deny();
    return { user, tokenExpiresAt };
  };
  const issueSession = async (issued, req, res, assertActive = () => {}) => {
    const user = validateUser(issued?.user); validateToken(issued?.access_token, user.id);
    if (typeof issued.refresh_token !== 'string' || !issued.refresh_token || issued.refresh_token.length > 16_384) throw deny();
    const checked = await identity(issued.access_token);
    // A cancelled login must not recreate a session after logout or shutdown.
    if (closed) throw deny(); assertActive();
    prune(); if (sessions.size >= 20) throw new CloudError(429, 'session_limit', 'Too many active sessions. Sign out of another session.');
    const prior = handle(req); if (prior) sessions.delete(prior);
    const sessionId = randomBytes(32).toString('base64url');
    sessions.set(sessionId, { ...checked, accessToken: issued.access_token, refreshToken: issued.refresh_token, expiresAt: now() + (config.sessionLifetime ?? 28_800_000), refresh: null });
    clearFlow(req, res);
    setCookie(res, sessionId, Math.floor((config.sessionLifetime ?? 28_800_000) / 1000));
    return checked.user;
  };
  const api = {
    sameOrigin,
    async requestCode(email, req, res) {
      throttle('request', req, 3); email = emailInput(email);
      if (closed) throw deny();
      if (!res?.setHeader) throw invalid('The sign-in response is unavailable.');
      if (flows.size >= 100) throw new CloudError(429, 'auth_rate_limited', 'Too many sign-in attempts. Please wait before trying again.');
      const flowId = randomBytes(32).toString('base64url'); const verifier = randomBytes(32).toString('base64url');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const flow = { verifier, email, expiresAt: now() + FLOW_LIFETIME, cancelled: false }; flows.set(flowId, flow);
      try {
        // auth-js uses redirect_to in the OTP URL and the lower-case s256 method.
        // The verifier and provider tokens never leave this server.
        await call(`/auth/v1/otp?redirect_to=${encodeURIComponent(`${config.origin}/api/auth/callback`)}`, { body: { email, create_user: true, code_challenge: challenge, code_challenge_method: 's256' } });
      } catch (error) { flows.delete(flowId); throw error; }
      if (closed || flow.cancelled || flows.get(flowId) !== flow) throw deny();
      const prior = handle(req, FLOW_COOKIE); if (prior) invalidateFlow(prior);
      setCookie(res, flowId, FLOW_LIFETIME / 1000, FLOW_COOKIE, 'Lax');
    },
    async callback(req, res) {
      // Only this top-level email-return navigation may arrive cross-site.
      // Mutating API routes still require exact Origin and the explicit header.
      if (req.method !== 'GET' || req.headers.host !== new URL(config.origin).host || (req.headers.origin !== undefined && req.headers.origin !== config.origin) || (req.headers['sec-fetch-mode'] && req.headers['sec-fetch-mode'] !== 'navigate') || (req.headers['sec-fetch-dest'] && req.headers['sec-fetch-dest'] !== 'document')) throw deny();
      prune(); const id = handle(req, FLOW_COOKIE); const flow = flows.get(id);
      if (!flow || closed) throw deny();
      // Consume before any await, including failures, to prevent callback races.
      flows.delete(id); inFlightFlows.set(id, flow); setCookie(res, '', 0, FLOW_COOKIE, 'Lax');
      const assertActive = () => { if (closed || flow.cancelled || flow.expiresAt <= now() || inFlightFlows.get(id) !== flow) throw deny(); };
      try {
        let target; try { if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw new Error(); target = new URL(req.url, config.origin); } catch { throw deny(); }
        const codes = target.searchParams.getAll('code');
        if (target.pathname !== '/api/auth/callback' || codes.length !== 1 || !/^[A-Za-z0-9._~-]{8,2048}$/.test(codes[0])) throw deny();
        const issued = await call('/auth/v1/token?grant_type=pkce', { body: { auth_code: codes[0], code_verifier: flow.verifier } });
        assertActive(); if (issued?.user?.email?.toLowerCase() !== flow.email) throw deny();
        return await issueSession(issued, req, res, assertActive);
      } finally { inFlightFlows.delete(id); }
    },
    async verifyCode(email, token, req, res) {
      throttle('verify', req, 10); email = emailInput(email);
      if (typeof token !== 'string' || !/^\d{6,8}$/.test(token)) throw invalid('Enter the email verification code.');
      const issued = await call('/auth/v1/verify', { body: { email, token, type: 'email' } });
      return issueSession(issued, req, res);
    },
    async authorize(req) {
      if (!sameOrigin(req)) return null;
      prune(); const id = handle(req); const session = sessions.get(id); if (!session) return null;
      try {
        if (session.tokenExpiresAt <= now() + 60_000) {
          session.refresh ??= (async () => {
            const issued = await call('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: session.refreshToken } });
            const tokenExpiresAt = validateToken(issued?.access_token, session.user.id);
            if (typeof issued.refresh_token !== 'string' || !issued.refresh_token || issued.refresh_token.length > 16_384) throw deny();
            session.accessToken = issued.access_token; session.refreshToken = issued.refresh_token; session.tokenExpiresAt = tokenExpiresAt;
          })().finally(() => { session.refresh = null; });
          await session.refresh;
        }
        const checked = await identity(session.accessToken);
        if (checked.user.id !== session.user.id || sessions.get(id) !== session || session.expiresAt <= now()) throw deny();
        return { id, user: checked.user, accessToken: session.accessToken };
      } catch (error) { sessions.delete(id); if (error instanceof CloudError && error.status >= 500) throw error; return null; }
    },
    async logout(req, res) {
      const id = handle(req); const session = sessions.get(id); sessions.delete(id); clearFlow(req, res); setCookie(res, '', 0);
      if (session) { try { await call('/auth/v1/logout?scope=local', { token: session.accessToken, method: 'POST' }); } catch { /* Local handle is invalidated even if remote logout is unavailable. */ } }
    },
    close() { closed = true; for (const flow of inFlightFlows.values()) flow.cancelled = true; sessions.clear(); attempts.clear(); flows.clear(); },
  };
  return api;
}
