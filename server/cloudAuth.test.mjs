import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudAuth, CloudError, readCloudConfig } from './cloudAuth.mjs';

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
  const env = { CELLPROJECT_CLOUD_ENABLED: 'true', APP_ORIGIN: origin, SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: 'public' };
  assert.equal(readCloudConfig(env).allowedEmail, email);
  for (const override of [{ APP_ORIGIN: 'http://evil.test' }, { APP_ORIGIN: `${origin}/path` }, { SUPABASE_URL: 'https://other.supabase.co' }, { SUPABASE_PUBLISHABLE_KEY: '' }, { SUPABASE_ALLOWED_EMAIL: 'attacker@example.com' }]) assert.throws(() => readCloudConfig({ ...env, ...override }), /configuration/i);
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
