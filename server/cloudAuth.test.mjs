import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudAuth, CloudError, readCloudConfig, isPublishablePasswordKey } from './cloudAuth.mjs';

const email = 'wylgnerbossman@gmail.com';
const id = '11111111-1111-4111-8111-111111111111';
const url = 'https://wxfootrnfiqpzhmjwgck.supabase.co';
const origin = 'https://cellproject.example';
const config = { enabled: true, origin, supabaseUrl: url, publishableKey: 'public-test-key', allowedEmail: email, allowedUserId: id, sessionLifetime: 28_800_000 };
const jwt = (expiry, sub = id) => `header.${Buffer.from(JSON.stringify({ iss: `${url}/auth/v1`, aud: 'authenticated', sub, exp: expiry })).toString('base64url')}.signature`;
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const user = { id, email, email_confirmed_at: '2026-10-10T00:00:00Z', is_anonymous: false };
const req = (cookie, extra = {}) => ({ method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'cellproject.example', cookie, ...extra } });
const headersResponse = () => {
  const headers = new Map();
  return { setHeader(key, value) { headers.set(key, value); }, getHeader(key) { return headers.get(key); }, cookies() { return [headers.get('set-cookie') ?? []].flat(); } };
};
const linkReq = (cookie, code = 'auth-code-from-email', extra = {}) => ({ ...req(cookie, { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', ...extra }), url: `/api/auth/callback?code=${code}` });

test('production configuration is fail closed and scoped to the P&D project with one account', () => {
  assert.equal(readCloudConfig({}).enabled, false);
  const env = { CELLPROJECT_CLOUD_ENABLED: 'true', APP_ORIGIN: origin, SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic' };
  assert.equal(readCloudConfig(env).allowedEmail, email);
  for (const override of [{ APP_ORIGIN: 'http://evil.test' }, { APP_ORIGIN: `${origin}/path` }, { SUPABASE_URL: 'https://other.supabase.co' }, { SUPABASE_PUBLISHABLE_KEY: '' }, { SUPABASE_ALLOWED_EMAIL: 'attacker@example.com' }]) assert.throws(() => readCloudConfig({ ...env, ...override }), /configuration/i);
  for (const key of ['sb_secret_NEVER_PUBLIC', 'public-but-invalid', 'sb_publishable_', `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`]) assert.throws(() => readCloudConfig({ ...env, SUPABASE_PUBLISHABLE_KEY: key }), /configuration/i);
  const legacy = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ role: 'anon', iss: 'supabase', ref: 'wxfootrnfiqpzhmjwgck' })).toString('base64url')}.synthetic-signature`;
  assert.equal(isPublishablePasswordKey(legacy), true);
  assert.equal(readCloudConfig({ ...env, SUPABASE_PUBLISHABLE_KEY: legacy }).publishableKey, legacy);
});

const providerSession = '33333333-3333-4333-8333-333333333333';
const passwordJwt = (expiry, sessionId = providerSession, sub = id) => `header.${Buffer.from(JSON.stringify({ iss: `${url}/auth/v1`, aud: 'authenticated', role: 'authenticated', sub, exp: expiry, session_id: sessionId, amr: [{ method: 'password', timestamp: expiry - 3600 }] })).toString('base64url')}.signature`;

test('direct password exchange validates the allowed account and matching refresh session without receiving a password', async () => {
  const now = 1_800_000_000_000, calls = [];
  const accessToken = passwordJwt(now / 1000 + 3600);
  const auth = createCloudAuth({ config: { ...config, vaultEnabled: true }, now: () => now, fetchImpl: async (target, init) => {
    calls.push({ target, init });
    if (target.endsWith('grant_type=refresh_token')) return response({ access_token: accessToken, refresh_token: 'ROTATED_REFRESH', user });
    if (target.endsWith('/user')) return response(user);
    if (target.endsWith('/cellproject_authorized')) return response(true);
    throw new Error('Unexpected destination');
  } });
  const result = headersResponse();
  assert.deepEqual(await auth.acceptPasswordSession({ accessToken, refreshToken: 'CLIENT_REFRESH' }, req(), result), { id, email });
  assert.deepEqual(JSON.parse(calls.find(call => call.target.endsWith('grant_type=refresh_token')).init.body), { refresh_token: 'CLIENT_REFRESH' });
  assert.ok(calls.every(call => !call.init.body || !Object.hasOwn(JSON.parse(call.init.body), 'password')));
  const cookie = result.cookies().find(value => value.startsWith('__Host-cellproject_session='));
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  assert.doesNotMatch(cookie, /CLIENT_REFRESH|ROTATED_REFRESH|signature/);
  assert.equal((await auth.authorize(req(cookie.split(';')[0]))).passwordSetup, false);
});

test('direct password exchange rejects foreign identities, mismatched refresh sessions and non-password tokens', async () => {
  const now = 1_800_000_000_000, accessToken = passwordJwt(now / 1000 + 3600);
  for (const kind of ['owner', 'refresh-session', 'method', 'extra-password']) {
    const auth = createCloudAuth({ config, now: () => now, fetchImpl: async target => {
      if (target.endsWith('grant_type=refresh_token')) return response({ access_token: passwordJwt(now / 1000 + 3600, kind === 'refresh-session' ? '44444444-4444-4444-8444-444444444444' : providerSession), refresh_token: 'ROTATED_REFRESH', user });
      if (target.endsWith('/user')) return response(kind === 'owner' ? { ...user, email: 'attacker@example.com' } : user);
      if (target.endsWith('/cellproject_authorized')) return response(true);
      return response({});
    } });
    const result = headersResponse();
    await assert.rejects(auth.acceptPasswordSession({ accessToken: kind === 'method' ? jwt(now / 1000 + 3600) : accessToken, refreshToken: 'CLIENT_REFRESH', ...(kind === 'extra-password' ? { password: 'PRIVATE_PASSWORD' } : {}) }, req(), result));
    assert.ok(!result.cookies().some(value => /^__Host-cellproject_session=[A-Za-z0-9_-]{43};/.test(value)), kind);
  }
});

test('password setup exposes only a short-lived access token to the verified initiating session', async () => {
  const fixture = passwordFixture();
  await assert.rejects(fixture.auth.passwordSetupSession(req()), error => error.status === 401);
  const { cookie } = await fixture.setup();
  const value = await fixture.auth.passwordSetupSession(req(cookie));
  assert.deepEqual(Object.keys(value), ['accessToken']);
  assert.equal(typeof value.accessToken, 'string');
  fixture.advance(900_001);
  await assert.rejects(fixture.auth.passwordSetupSession(req(cookie)), error => error.status === 403);
});

test('direct password exchanges cannot resurrect a logged-out, disconnected or closed session while provider checks are pending', async () => {
  const now = 1_800_000_000_000;
  for (const action of ['logout', 'disconnect', 'close']) {
    let waiting, release, blocked = false;
    const started = new Promise(resolve => { waiting = resolve; });
    const accessToken = passwordJwt(now / 1000 + 3600);
    const auth = createCloudAuth({ config, now: () => now, fetchImpl: async target => {
      if (target.includes('/verify')) return response({ access_token: accessToken, refresh_token: 'OLD_REFRESH', user });
      if (target.endsWith('grant_type=refresh_token')) { if (blocked) await new Promise(resolve => { release = resolve; waiting(); }); return response({ access_token: accessToken, refresh_token: 'ROTATED_REFRESH', user }); }
      if (target.endsWith('/user')) return response(user);
      if (target.endsWith('/cellproject_authorized')) return response(true);
      return response({});
    } });
    const old = headersResponse(); await auth.verifyCode(email, '123456', req(), old);
    const cookie = old.cookies().find(value => value.startsWith('__Host-cellproject_session=')).split(';')[0];
    const input = req(cookie), result = headersResponse(); blocked = true;
    const pending = auth.acceptPasswordSession({ accessToken, refreshToken: 'CLIENT_REFRESH' }, input, result);
    await started;
    if (action === 'logout') await auth.logout(req(cookie), headersResponse());
    else if (action === 'disconnect') input.aborted = true;
    else auth.close();
    release(); await assert.rejects(pending, error => error.status === 401);
    assert.ok(!result.cookies().some(value => /^__Host-cellproject_session=[A-Za-z0-9_-]{43};/.test(value)), action);
  }
});

test('direct password exchanges throttle invalid tokens and refuse malformed or oversized token credentials', async () => {
  let calls = 0;
  const auth = createCloudAuth({ config, fetchImpl: async () => { calls++; return new Response('PRIVATE_PROVIDER_MESSAGE', { status: 401 }); } });
  for (const input of [null, {}, { accessToken: 'x', refreshToken: 'x', password: 'PRIVATE_PASSWORD' }, { accessToken: 'x'.repeat(32769), refreshToken: 'x' }, { accessToken: 'x', refreshToken: 'x'.repeat(16385) }]) await assert.rejects(auth.acceptPasswordSession(input, req(), headersResponse()), error => error.status === 401);
  assert.equal(calls, 0);
  for (let index = 0; index < 5; index++) await assert.rejects(auth.acceptPasswordSession({ accessToken: 'x', refreshToken: 'x' }, req(), headersResponse()), error => error.status === 401 && !/PRIVATE_/.test(String(error)));
  await assert.rejects(auth.acceptPasswordSession({ accessToken: 'x', refreshToken: 'x' }, req(), headersResponse()), error => error.status === 429);
  assert.equal(calls, 5);
});

test('an ordinary login cannot obtain the setup bearer token and vault servers reject legacy raw-password methods', async () => {
  const fixture = passwordFixture(); const result = headersResponse();
  await fixture.auth.signInPassword(email, 'existing password', req(), result);
  const cookie = result.cookies().find(value => value.startsWith('__Host-cellproject_session=')).split(';')[0];
  await assert.rejects(fixture.auth.passwordSetupSession(req(cookie)), error => error.status === 403);
  let calls = 0;
  const auth = createCloudAuth({ config: { ...config, vaultEnabled: true }, fetchImpl: async () => { calls++; return response({}); } });
  await assert.rejects(auth.signInPassword(email, 'PRIVATE_PASSWORD', req(), headersResponse()), error => error.status === 426);
  await assert.rejects(auth.setPassword('PRIVATE_PASSWORD', null), error => error.status === 426);
  assert.equal(calls, 0);
});

test('email OTP is allowlisted before network and a verified session exposes only an opaque strict cookie', async () => {
  let now = 1_800_000_000_000; const calls = [];
  const auth = createCloudAuth({ config, now: () => now, fetchImpl: async (target, init) => {
    calls.push({ target, init });
    if (target.endsWith('/otp')) return response({});
    if (target.endsWith('/verify')) return response({ access_token: jwt(now / 1000 + 3600), refresh_token: 'REFRESH_SECRET', expires_in: 3600, user });
    if (target.endsWith('/user')) return response(user);
    if (target.endsWith('/cellproject_authorized')) return response(true);
    return response({});
  } });
  await assert.rejects(auth.requestCode('other@example.com', req()), error => error instanceof CloudError && error.status === 403);
  assert.equal(calls.length, 0);
  await auth.requestCode(email, req(), headersResponse()); assert.equal(JSON.parse(calls[0].init.body).create_user, true);
  let cookie; const res = { setHeader(_key, value) { cookie = value; } };
  const exposed = await auth.verifyCode(email, '123456', req(), res);
  assert.deepEqual(exposed, { id, email });
  assert.match(cookie, /^__Host-cellproject_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict;/);
  assert.doesNotMatch(cookie, /SECRET|signature|eyJ/);
  const handle = cookie.split(';')[0];
  const session = await auth.authorize(req(handle));
  assert.equal(session.user.id, id);
  assert.ok(calls.some(call => call.target.endsWith('/cellproject_authorized')));
  assert.equal(await auth.authorize(req('__Host-cellproject_session=forged')), null);
  now += config.sessionLifetime + 1;
  assert.equal(await auth.authorize(req(handle)), null);
});

test('account revocation, wrong issuer, unverified email and authorization denial reject before session creation', async () => {
  for (const alteration of [{ user: { ...user, email: 'other@example.com' } }, { user: { ...user, email_confirmed_at: null } }, { user: { ...user, is_anonymous: true } }, { access_token: jwt(Date.now() / 1000 + 3600, 'other-id') }, { access_token: 'forged' }, { denied: true }]) {
    const auth = createCloudAuth({ config, fetchImpl: async target => target.endsWith('/cellproject_authorized') ? response(!alteration.denied) : target.endsWith('/user') ? response(alteration.user ?? user) : response({ access_token: jwt(Date.now() / 1000 + 3600), refresh_token: 'secret', user, ...alteration }) });
    let cookie; await assert.rejects(auth.verifyCode(email, '123456', req(), { setHeader(_key, value) { cookie = value; } }));
    assert.equal(cookie, undefined);
  }
});

test('private API always rechecks server identity and database authorization, refreshes tokens only server side, and logout revokes handle', async () => {
  let now = 1_800_000_000_000; let allowed = true; let refreshes = 0; let remoteChecks = 0;
  const auth = createCloudAuth({ config, now: () => now, fetchImpl: async (target, init) => {
    if (target.endsWith('/token?grant_type=refresh_token')) { refreshes++; assert.deepEqual(JSON.parse(init.body), { refresh_token: 'secret-refresh' }); return response({ access_token: jwt(now / 1000 + 3600), refresh_token: 'secret-refresh' }); }
    if (target.endsWith('/verify')) return response({ access_token: jwt(now / 1000 + 120), refresh_token: 'secret-refresh', user });
    if (target.endsWith('/user')) { remoteChecks++; return response(user); }
    if (target.endsWith('/cellproject_authorized')) return response(allowed);
    return response({});
  } });
  let cookie; const res = { setHeader(_key, value) { cookie = value; } };
  await auth.verifyCode(email, '123456', req(), res); const handle = cookie.split(';')[0];
  now += 80_000; assert.ok(await auth.authorize(req(handle))); assert.equal(refreshes, 1);
  assert.ok(await auth.authorize(req(handle))); assert.ok(remoteChecks >= 3);
  allowed = false; assert.equal(await auth.authorize(req(handle)), null);
  assert.equal(await auth.authorize(req(handle)), null);
  allowed = true; await auth.verifyCode(email, '123456', req(), res); const secondHandle = cookie.split(';')[0];
  await auth.logout(req(secondHandle), res); assert.match(cookie, /Max-Age=0/); assert.equal(await auth.authorize(req(secondHandle)), null);
});

test('request origin, host, fetch metadata and explicit mutation header reject independent attacks', () => {
  const auth = createCloudAuth({ config });
  const valid = { ...req(), method: 'POST', headers: { ...req().headers, origin, 'x-cellproject-request': '1' } };
  assert.equal(auth.sameOrigin(valid), true);
  for (const headers of [{ origin: 'https://evil.test' }, { host: 'evil.test' }, { 'sec-fetch-site': 'cross-site' }, { 'x-cellproject-request': '' }, { origin: undefined }]) assert.equal(auth.sameOrigin({ ...valid, headers: { ...valid.headers, ...headers } }), false);
  assert.equal(auth.sameOrigin(req()), true);
  assert.equal(auth.sameOrigin(req(undefined, { origin: 'null' })), false);
});

test('default email link binds PKCE to an opaque Lax cookie and exchanges only server side before issuing a strict session', async () => {
  const now = 1_800_000_000_000; const calls = [];
  const auth = createCloudAuth({ config, now: () => now, fetchImpl: async (target, init) => {
    calls.push({ target, init });
    if (target.endsWith('/token?grant_type=pkce')) return response({ access_token: jwt(now / 1000 + 3600), refresh_token: 'REFRESH_SECRET', user });
    if (target.endsWith('/user')) return response(user);
    if (target.endsWith('/cellproject_authorized')) return response(true);
    return response({});
  } });
  const start = headersResponse(); await auth.requestCode(email, req(), start);
  assert.equal(new URL(calls[0].target).pathname, '/auth/v1/otp');
  assert.equal(new URL(calls[0].target).searchParams.get('redirect_to'), `${origin}/api/auth/callback`);
  const input = JSON.parse(calls[0].init.body);
  assert.equal(input.email, email); assert.equal(input.create_user, true); assert.equal(input.code_challenge_method, 's256');
  assert.match(input.code_challenge, /^[A-Za-z0-9_-]{43}$/); assert.equal(input.code_verifier, undefined);
  const flow = start.cookies()[0];
  assert.match(flow, /^__Host-cellproject_auth_flow=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=900$/);
  const complete = headersResponse();
  assert.deepEqual(await auth.callback(linkReq(flow.split(';')[0]), complete), { id, email });
  const exchanged = JSON.parse(calls.find(call => call.target.endsWith('/token?grant_type=pkce')).init.body);
  assert.equal(exchanged.auth_code, 'auth-code-from-email'); assert.match(exchanged.code_verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(createHash('sha256').update(exchanged.code_verifier).digest('base64url'), input.code_challenge);
  assert.doesNotMatch(flow, new RegExp(exchanged.code_verifier));
  const cookies = complete.cookies();
  assert.ok(cookies.some(value => /__Host-cellproject_auth_flow=;.*Max-Age=0$/.test(value)));
  const session = cookies.find(value => value.startsWith('__Host-cellproject_session='));
  assert.match(session, /HttpOnly; Secure; SameSite=Strict/); assert.doesNotMatch(session, /SECRET|signature/);
  assert.ok(await auth.authorize(req(session.split(';')[0])));
  assert.ok(calls.some(call => call.target.endsWith('/cellproject_authorized')));
  await assert.rejects(auth.callback(linkReq(flow.split(';')[0]), headersResponse()));
  assert.equal(calls.filter(call => call.target.endsWith('/token?grant_type=pkce')).length, 1);
});

test('email callbacks reject absent, forged, expired, duplicate and superseded flow cookies without an exchange', async () => {
  let now = 1_800_000_000_000; const exchanges = [];
  const auth = createCloudAuth({ config, now: () => now, fetchImpl: async target => { if (target.includes('grant_type=pkce')) exchanges.push(target); return response({}); } });
  const first = headersResponse(); await auth.requestCode(email, req(), first); const older = first.cookies()[0].split(';')[0];
  const second = headersResponse(); await auth.requestCode(email, req(older), second); const current = second.cookies()[0].split(';')[0];
  for (const cookie of [undefined, '__Host-cellproject_auth_flow=forged', `__Host-cellproject_auth_flow=${'A'.repeat(43)}`, `${current}; ${current}`, older]) await assert.rejects(auth.callback(linkReq(cookie), headersResponse()));
  now += 900_001; await assert.rejects(auth.callback(linkReq(current), headersResponse()));
  assert.equal(exchanges.length, 0);
});

test('email callbacks cannot be used as an API login and reject foreign hosts, embedded requests or opaque-session-as-code', async () => {
  let calls = 0;
  const auth = createCloudAuth({ config, fetchImpl: async () => { calls++; return response({}); } });
  const start = headersResponse(); await auth.requestCode(email, req(), start); const cookie = start.cookies()[0].split(';')[0];
  for (const headers of [{ host: 'evil.test' }, { origin: 'https://evil.test' }, { 'sec-fetch-mode': 'cors' }, { 'sec-fetch-dest': 'iframe' }]) await assert.rejects(auth.callback(linkReq(cookie, 'real-code', headers), headersResponse()));
  await assert.rejects(auth.callback({ ...linkReq(cookie), method: 'POST' }, headersResponse()));
  await assert.rejects(auth.callback(linkReq(undefined, 'A'.repeat(43)), headersResponse()));
  await assert.rejects(auth.callback({ ...linkReq(cookie), url: '/api/auth/callback?code=first&code=second' }, headersResponse()));
  assert.equal(calls, 1);
});

test('failed PKCE exchange consumes the flow and never trusts provider user claims before live authorization', async () => {
  const now = 1_800_000_000_000;
  for (const alteration of [{ failed: true }, { user: { ...user, email: 'attacker@example.com' } }, { user: { ...user, email_confirmed_at: null } }, { user: { ...user, is_anonymous: true } }, { access_token: jwt(now / 1000 + 3600, 'other-id') }, { denied: true }, { liveUser: { ...user, id: '22222222-2222-4222-8222-222222222222' } }]) {
    let exchanges = 0;
    const auth = createCloudAuth({ config, now: () => now, fetchImpl: async target => {
      if (target.includes('grant_type=pkce')) { exchanges++; if (alteration.failed) return new Response('PROVIDER_TOKEN_SECRET', { status: 400 }); return response({ access_token: jwt(now / 1000 + 3600), refresh_token: 'REFRESH_SECRET', user, ...alteration }); }
      if (target.endsWith('/user')) return response(alteration.liveUser ?? user);
      if (target.endsWith('/cellproject_authorized')) return response(!alteration.denied);
      return response({});
    } });
    const start = headersResponse(); await auth.requestCode(email, req(), start); const cookie = start.cookies()[0].split(';')[0];
    const completed = headersResponse();
    await assert.rejects(auth.callback(linkReq(cookie), completed), error => { assert.doesNotMatch(String(error), /PROVIDER_TOKEN_SECRET|REFRESH_SECRET|auth-code-from-email/); return true; });
    assert.ok(!completed.cookies().some(value => /^__Host-cellproject_session=[A-Za-z0-9_-]{43};/.test(value)));
    await assert.rejects(auth.callback(linkReq(cookie), headersResponse())); assert.equal(exchanges, 1);
  }
});

test('PKCE callback consumes synchronously before awaiting exchange so parallel callbacks cannot replay', async () => {
  const now = 1_800_000_000_000; let finish; let exchanges = 0;
  const auth = createCloudAuth({ config, now: () => now, fetchImpl: async target => {
    if (target.includes('grant_type=pkce')) { exchanges++; return new Promise(resolve => { finish = () => resolve(response({ access_token: jwt(now / 1000 + 3600), refresh_token: 'REFRESH_SECRET', user })); }); }
    if (target.endsWith('/user')) return response(user);
    if (target.endsWith('/cellproject_authorized')) return response(true);
    return response({});
  } });
  const start = headersResponse(); await auth.requestCode(email, req(), start); const cookie = start.cookies()[0].split(';')[0];
  const first = auth.callback(linkReq(cookie), headersResponse());
  await assert.rejects(auth.callback(linkReq(cookie), headersResponse()));
  assert.equal(exchanges, 1); finish(); await first;
});

test('an attacker email code cannot log another browser in because its verifier belongs to a different initiating flow', async () => {
  const now = 1_800_000_000_000; const challenges = new Map(); let sent = 0; let exchanges = 0;
  const auth = createCloudAuth({ config, now: () => now, fetchImpl: async (target, init) => {
    if (new URL(target).pathname === '/auth/v1/otp') { challenges.set(`auth-code-${++sent}`, JSON.parse(init.body).code_challenge); return response({}); }
    if (target.includes('grant_type=pkce')) {
      exchanges++; const body = JSON.parse(init.body);
      if (createHash('sha256').update(body.code_verifier).digest('base64url') !== challenges.get(body.auth_code)) return new Response('PKCE does not match', { status: 400 });
      return response({ access_token: jwt(now / 1000 + 3600), refresh_token: 'REFRESH_SECRET', user });
    }
    if (target.endsWith('/user')) return response(user);
    if (target.endsWith('/cellproject_authorized')) return response(true);
    return response({});
  } });
  const browserA = headersResponse(); const browserB = headersResponse();
  await auth.requestCode(email, req(), browserA); await auth.requestCode(email, req(), browserB);
  const cookieA = browserA.cookies()[0].split(';')[0]; const cookieB = browserB.cookies()[0].split(';')[0];
  const rejected = headersResponse(); await assert.rejects(auth.callback(linkReq(cookieB, 'auth-code-1'), rejected));
  assert.ok(!rejected.cookies().some(value => value.startsWith('__Host-cellproject_session=')));
  await assert.rejects(auth.callback(linkReq(cookieB, 'auth-code-2'), headersResponse()));
  assert.deepEqual(await auth.callback(linkReq(cookieA, 'auth-code-1'), headersResponse()), { id, email });
  assert.equal(exchanges, 2);
});

test('logout and process shutdown invalidate pending email-link flows', async () => {
  let exchanges = 0;
  const auth = createCloudAuth({ config, fetchImpl: async target => { if (target.includes('grant_type=pkce')) exchanges++; return response({}); } });
  const first = headersResponse(); await auth.requestCode(email, req(), first); const cookie = first.cookies()[0].split(';')[0];
  const loggedOut = headersResponse(); await auth.logout(req(cookie), loggedOut);
  assert.ok(loggedOut.cookies().some(value => /__Host-cellproject_auth_flow=;.*Max-Age=0$/.test(value)));
  await assert.rejects(auth.callback(linkReq(cookie), headersResponse()));
  const second = headersResponse(); await auth.requestCode(email, req(), second); auth.close();
  await assert.rejects(auth.callback(linkReq(second.cookies()[0].split(';')[0]), headersResponse()));
  assert.equal(exchanges, 0);
});

test('logout, replacement flow and shutdown cancel callbacks already awaiting exchange or identity', async () => {
  const now = 1_800_000_000_000;
  for (const phase of ['exchange', 'identity']) for (const action of ['logout', 'replacement', 'close']) {
    let release; let waiting;
    const started = new Promise(resolve => { waiting = resolve; });
    const auth = createCloudAuth({ config, now: () => now, fetchImpl: async target => {
      if (target.includes('grant_type=pkce')) {
        if (phase === 'exchange') await new Promise(resolve => { release = resolve; waiting(); });
        return response({ access_token: jwt(now / 1000 + 3600), refresh_token: 'REFRESH_SECRET', user });
      }
      if (target.endsWith('/user')) {
        if (phase === 'identity') await new Promise(resolve => { release = resolve; waiting(); });
        return response(user);
      }
      if (target.endsWith('/cellproject_authorized')) return response(true);
      return response({});
    } });
    const start = headersResponse(); await auth.requestCode(email, req(), start); const cookie = start.cookies()[0].split(';')[0];
    const completed = headersResponse(); const callback = auth.callback(linkReq(cookie), completed); await started;
    if (action === 'logout') await auth.logout(req(cookie), headersResponse());
    else if (action === 'replacement') await auth.requestCode(email, req(cookie), headersResponse());
    else auth.close();
    release(); await assert.rejects(callback, `${action} during ${phase}`);
    assert.ok(!completed.cookies().some(value => /^__Host-cellproject_session=[A-Za-z0-9_-]{43};/.test(value)), `${action} during ${phase}`);
  }
});

function passwordFixture(overrides = {}) {
  let clock = 1_800_000_000_000; const calls = [];
  const auth = createCloudAuth({ config, now: () => clock, fetchImpl: async (target, init) => {
    calls.push({ target, init });
    const custom = await overrides.fetch?.(target, init); if (custom) return custom;
    if (target.includes('/auth/v1/token?')) return response({ access_token: jwt(clock / 1000 + 3600), refresh_token: 'REFRESH_SECRET', user });
    if (target.endsWith('/user')) return response(user);
    if (target.endsWith('/cellproject_authorized')) return response(true);
    return response({});
  } });
  return { auth, calls, advance(ms) { clock += ms; }, async setup() {
    const start = headersResponse(); await auth.requestPasswordSetup(email, req(), start);
    const completed = headersResponse(); await auth.callback(linkReq(start.cookies()[0].split(';')[0]), completed);
    const cookie = completed.cookies().find(value => value.startsWith('__Host-cellproject_session=')).split(';')[0];
    return { cookie, session: await auth.authorize(req(cookie)) };
  } };
}

test('password sign-in preserves the exact password and issues only the validated opaque session', async () => {
  const { auth, calls } = passwordFixture(); const result = headersResponse();
  assert.deepEqual(await auth.signInPassword(email, '  existing password  ', req(), result), { id, email });
  assert.deepEqual(JSON.parse(calls[0].init.body), { email, password: '  existing password  ' });
  assert.equal(calls[0].target, `${url}/auth/v1/token?grant_type=password`);
  const cookie = result.cookies().find(value => value.startsWith('__Host-cellproject_session='));
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  assert.doesNotMatch(cookie, /existing password|REFRESH_SECRET|signature/);
  assert.equal((await auth.authorize(req(cookie.split(';')[0]))).passwordSetup, false);
});

test('password sign-in rejects non-allowlisted accounts and malformed credentials before any network request', async () => {
  const { auth, calls } = passwordFixture();
  await assert.rejects(auth.signInPassword('other@example.com', 'some password', req(), headersResponse()), error => error.status === 403);
  for (const password of [undefined, null, 12, '', 'x'.repeat(129)]) await assert.rejects(auth.signInPassword(email, password, req(), headersResponse()), error => error.status === 401 && error.code === 'invalid_credentials');
  assert.equal(calls.length, 0);
});

test('password sign-in hides provider errors and throttles repeated rejected credentials', async () => {
  const { auth, calls } = passwordFixture({ fetch: async () => new Response('PRIVATE_PASSWORD PRIVATE_PROVIDER_TOKEN', { status: 400 }) });
  for (let index = 0; index < 10; index++) await assert.rejects(auth.signInPassword(email, 'PRIVATE_PASSWORD', req(), headersResponse()), error => error.status === 401 && error.code === 'invalid_credentials' && !/PRIVATE_/.test(String(error)));
  await assert.rejects(auth.signInPassword(email, 'PRIVATE_PASSWORD', req(), headersResponse()), error => error.status === 429);
  assert.equal(calls.length, 10);
});

test('password sign-in performs live identity and database authorization before setting a session cookie', async () => {
  for (const alteration of [{ user: { ...user, email: 'other@example.com' } }, { user: { ...user, email_confirmed_at: null } }, { access_token: 'forged' }, { denied: true }]) {
    const { auth } = passwordFixture({ fetch: async target => target.includes('grant_type=password') ? response({ access_token: jwt(1_800_003_600), refresh_token: 'REFRESH_SECRET', user, ...alteration }) : target.endsWith('/cellproject_authorized') ? response(!alteration.denied) : undefined });
    const result = headersResponse(); await assert.rejects(auth.signInPassword(email, 'existing password', req(), result), error => error.status === 401);
    assert.ok(!result.cookies().some(value => /^__Host-cellproject_session=[A-Za-z0-9_-]{43};/.test(value)));
  }
});

test('only a dedicated password-setup PKCE flow grants permission to save a password', async () => {
  const fixture = passwordFixture(); const { auth, calls } = fixture;
  const setup = await fixture.setup(); assert.equal(setup.session.passwordSetup, true);
  const otp = calls.find(value => new URL(value.target).pathname === '/auth/v1/recover');
  assert.equal(new URL(otp.target).searchParams.get('redirect_to'), `${origin}/api/auth/callback`);
  assert.equal(JSON.parse(otp.init.body).code_challenge_method, 's256');
  assert.equal(JSON.parse(otp.init.body).password, undefined);
  assert.equal(JSON.parse(otp.init.body).create_user, undefined);
  const ordinary = headersResponse(); await auth.requestCode(email, req(), ordinary);
  const completed = headersResponse(); await auth.callback({ ...linkReq(ordinary.cookies()[0].split(';')[0]), url: '/api/auth/callback?code=auth-code-from-email&purpose=password_setup' }, completed);
  const cookie = completed.cookies().find(value => value.startsWith('__Host-cellproject_session=')).split(';')[0];
  const session = await auth.authorize(req(cookie)); assert.equal(session.passwordSetup, false);
  const before = calls.length;
  await assert.rejects(auth.setPassword('new password!', session), error => error.status === 403 && error.code === 'reauthentication_required');
  assert.equal(calls.length, before);
});

test('password setup checks length without trimming and consumes its one-time permission only after a successful update', async () => {
  const fixture = passwordFixture(); const { auth, calls } = fixture; const { cookie, session } = await fixture.setup();
  const before = calls.length;
  for (const value of [undefined, 12, 'short', 'x'.repeat(129)]) await assert.rejects(auth.setPassword(value, session), error => error.status === 400);
  assert.equal(calls.length, before);
  await auth.setPassword('  new password!  ', session);
  const update = calls.find(value => value.init.method === 'PUT');
  assert.equal(update.target, `${url}/auth/v1/user`);
  assert.deepEqual(JSON.parse(update.init.body), { password: '  new password!  ' });
  assert.match(update.init.headers.authorization, /^Bearer header\./);
  assert.equal((await auth.authorize(req(cookie))).passwordSetup, false);
  await assert.rejects(auth.setPassword('another password', session), error => error.status === 403 && error.code === 'reauthentication_required');
  assert.equal(calls.filter(value => value.init.method === 'PUT').length, 1);
});

test('password setup expires fifteen minutes after confirmation and an ended session cannot update it', async () => {
  for (const action of ['expire', 'logout', 'close']) {
    const fixture = passwordFixture(); const { auth, calls } = fixture; const { cookie, session } = await fixture.setup();
    if (action === 'expire') fixture.advance(900_001);
    else if (action === 'logout') await auth.logout(req(cookie), headersResponse());
    else auth.close();
    const before = calls.length;
    await assert.rejects(auth.setPassword('new password!', session), error => error.status === (action === 'expire' ? 403 : 401));
    assert.equal(calls.length, before);
  }
});

test('a failed password update exposes no provider detail and leaves the verified setup retryable', async () => {
  let fail = true;
  const fixture = passwordFixture({ fetch: async (_target, init) => init.method === 'PUT' && fail ? new Response('PRIVATE_PASSWORD PRIVATE_PROVIDER_TOKEN', { status: 422 }) : undefined });
  const { auth } = fixture; const { cookie, session } = await fixture.setup();
  await assert.rejects(auth.setPassword('PRIVATE_PASSWORD', session), error => !/PRIVATE_/.test(String(error)));
  assert.equal((await auth.authorize(req(cookie))).passwordSetup, true);
  fail = false; await auth.setPassword('new password!', session);
  assert.equal((await auth.authorize(req(cookie))).passwordSetup, false);
});

test('password setup rejects concurrent updates and cannot report success or restore a session after logout', async () => {
  let release; let started; const waiting = new Promise(resolve => { started = resolve; });
  const fixture = passwordFixture({ fetch: async (_target, init) => { if (init.method === 'PUT') { started(); await new Promise(resolve => { release = resolve; }); return response(user); } } });
  const { auth, calls } = fixture; const { cookie, session } = await fixture.setup();
  const update = auth.setPassword('new password!', session); await waiting;
  await assert.rejects(auth.setPassword('another password', session), error => error.status === 409);
  await auth.logout(req(cookie), headersResponse()); release();
  await assert.rejects(update, error => error.status === 401);
  assert.equal(await auth.authorize(req(cookie)), null);
  assert.equal(calls.filter(value => value.init.method === 'PUT').length, 1);
});

test('password sign-in cannot issue a session after disconnect or process shutdown', async () => {
  for (const action of ['abort', 'close']) {
    let release; let started; const waiting = new Promise(resolve => { started = resolve; });
    const fixture = passwordFixture({ fetch: async target => { if (target.includes('grant_type=password')) { started(); await new Promise(resolve => { release = resolve; }); } } });
    const input = req(); const result = headersResponse(); const login = fixture.auth.signInPassword(email, 'existing password', input, result); await waiting;
    if (action === 'abort') input.aborted = true; else fixture.auth.close();
    release(); await assert.rejects(login, error => error.status === 401);
    assert.ok(!result.cookies().some(value => /^__Host-cellproject_session=[A-Za-z0-9_-]{43};/.test(value)));
  }
});

test('new passwords respect Supabase UTF-8 byte limits while counting the minimum in Unicode characters', async () => {
  const fixture = passwordFixture(); const { auth, calls } = fixture; const { session } = await fixture.setup();
  for (const password of ['x'.repeat(73), 'é'.repeat(37), '😀'.repeat(5)]) {
    const before = calls.length; await assert.rejects(auth.setPassword(password, session), error => error.status === 400 && error.code === 'password_invalid');
    assert.equal(calls.length, before);
  }
  await auth.setPassword('é'.repeat(36), session);
  assert.deepEqual(JSON.parse(calls.find(value => value.init.method === 'PUT').init.body), { password: 'é'.repeat(36) });
});

test('password policy errors use safe fixed responses and keep the verified setup retryable', async () => {
  for (const [code, status] of [['weak_password', 400], ['same_password', 400], ['reauthentication_needed', 403], ['reauthentication_not_valid', 403], ['current_password_required', 403], ['current_password_mismatch', 403]]) {
    const fixture = passwordFixture({ fetch: async (_target, init) => init.method === 'PUT' ? new Response(JSON.stringify({ code, message: 'PRIVATE_PASSWORD PRIVATE_PROVIDER_TOKEN' }), { status: 422, headers: { 'content-type': 'application/json' } }) : undefined });
    const { auth } = fixture; const { cookie, session } = await fixture.setup();
    await assert.rejects(auth.setPassword('new password!', session), error => error.status === status && !/PRIVATE_/.test(String(error)));
    assert.equal((await auth.authorize(req(cookie))).passwordSetup, true);
  }
});

test('legacy Supabase password errors normalize error_code instead of the numeric HTTP code', async () => {
  for (const [providerCode, status, applicationCode] of [['reauthentication_needed', 403, 'reauthentication_required'], ['weak_password', 400, 'password_invalid'], ['same_password', 400, 'password_invalid']]) {
    const fixture = passwordFixture({ fetch: async (_target, init) => init.method === 'PUT' ? new Response(JSON.stringify({ code: 400, error_code: providerCode, msg: 'PRIVATE_PASSWORD PRIVATE_PROVIDER_TOKEN' }), { status: 400, headers: { 'content-type': 'application/json' } }) : undefined });
    const { auth } = fixture; const { cookie, session } = await fixture.setup();
    await assert.rejects(auth.setPassword('new password!', session), error => {
      assert.equal(error.status, status); assert.equal(error.code, applicationCode);
      assert.doesNotMatch(String(error), /PRIVATE_/);
      if (providerCode === 'same_password') assert.match(error.message, /diferente/);
      return true;
    });
    assert.equal((await auth.authorize(req(cookie))).passwordSetup, true);
  }
});

test('database revocation prevents a previously authorized setup session from updating a password', async () => {
  let allowed = true;
  const fixture = passwordFixture({ fetch: async target => target.endsWith('/cellproject_authorized') ? response(allowed) : undefined });
  const { auth, calls } = fixture; const { session } = await fixture.setup(); allowed = false;
  await assert.rejects(auth.setPassword('new password!', session), error => error.status === 401);
  assert.equal(calls.filter(value => value.init.method === 'PUT').length, 0);
});

test('token refresh does not extend the fifteen-minute password-setup window exposed in config', async () => {
  const fixture = passwordFixture({ fetch: async target => target.includes('grant_type=pkce') ? response({ access_token: jwt(1_800_000_120), refresh_token: 'REFRESH_SECRET', user }) : undefined });
  const { auth, calls } = fixture; const { cookie, session } = await fixture.setup();
  fixture.advance(850_000); assert.equal((await auth.authorize(req(cookie))).passwordSetup, true);
  assert.equal(calls.filter(value => value.target.includes('grant_type=refresh_token')).length, 1);
  fixture.advance(50_001); assert.equal((await auth.authorize(req(cookie))).passwordSetup, false);
  await assert.rejects(auth.setPassword('new password!', session), error => error.status === 403 && error.code === 'reauthentication_required');
  assert.equal(calls.filter(value => value.init.method === 'PUT').length, 0);
});
