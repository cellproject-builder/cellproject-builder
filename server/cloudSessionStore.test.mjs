import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, statSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createCloudSessionStore } from './cloudSessionStore.mjs';
import { CloudError } from './cloudUtils.mjs';

const origin = 'https://diary.example', key = Buffer.alloc(32, 41).toString('base64');
const clock = 1_800_000_000_000;
const THIRTY_DAYS = 30 * 24 * 60 * 60_000;
const session = (extra = {}) => ({ user: { id: '11111111-1111-4111-8111-111111111111', email: 'synthetic@example.test' }, accessToken: 'SYNTHETIC_PRIVATE_ACCESS', refreshToken: 'SYNTHETIC_PRIVATE_REFRESH', expiresAt: clock + 28_800_000, tokenExpiresAt: clock + 3_600_000, ...extra });
const handle = () => randomBytes(32).toString('base64url');
const file = (directory, value) => join(directory, `${createHash('sha256').update(value).digest('hex')}.json`);
const unavailable = error => error instanceof CloudError && error.status === 503 && error.code === 'session_storage_unavailable' && error.message === 'Session storage is temporarily unavailable.';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dynamic-diary-session-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'sessions'); let time = clock;
  const options = { directory, encryptionKey: key, origin, now: () => time };
  return { root, directory, options, store: () => createCloudSessionStore(options), advance: duration => { time += duration; } };
}

test('restores the same opaque handle after restarting with another store instance', t => {
  const f = fixture(t), id = handle(), original = session();
  assert.equal(f.store().write(id, original), true);
  assert.deepEqual(f.store().read(id), original);
  assert.deepEqual(readdirSync(f.directory), [createHash('sha256').update(id).digest('hex') + '.json']);
});

test('encrypts account and tokens, uses a fresh nonce on update and never persists privileged or vault fields', t => {
  const f = fixture(t), id = handle(), store = f.store();
  store.write(id, session({ passwordSetup: true, passwordConfirmedAt: clock, passwordUpdate: true, refresh: Promise.resolve(), password: 'NEVER_PERSIST_PASSWORD', vault: 'NEVER_PERSIST_VAULT', user: { ...session().user, role: 'root', admin: true } }));
  const first = readFileSync(file(f.directory, id), 'utf8');
  for (const secret of [id, session().user.email, session().user.id, session().accessToken, session().refreshToken, 'passwordSetup', 'NEVER_PERSIST_PASSWORD', 'NEVER_PERSIST_VAULT']) assert.ok(!first.includes(secret));
  assert.deepEqual(store.read(id), session());
  assert.equal(store.write(id, session(), { create: false }), true);
  const second = readFileSync(file(f.directory, id), 'utf8'); assert.notEqual(first, second);
  assert.deepEqual(store.read(id), session()); assert.equal(readdirSync(f.directory).length, 1);
  if (process.platform !== 'win32') { assert.equal(statSync(f.directory).mode & 0o777, 0o700); assert.equal(statSync(file(f.directory, id)).mode & 0o777, 0o600); }
});

test('authenticates ciphertext against the key, origin and exact handle filename without erasing corrupt records', t => {
  const f = fixture(t), id = handle(), other = handle(), store = f.store(); store.write(id, session());
  const path = file(f.directory, id), original = readFileSync(path);
  assert.throws(() => createCloudSessionStore({ ...f.options, encryptionKey: Buffer.alloc(32, 42).toString('base64') }).read(id), unavailable);
  assert.throws(() => createCloudSessionStore({ ...f.options, origin: 'https://another.example' }).read(id), unavailable);
  writeFileSync(file(f.directory, other), original);
  assert.throws(() => store.read(other), unavailable);
  const encrypted = JSON.parse(original); encrypted.tag = Buffer.alloc(16, 8).toString('base64'); writeFileSync(path, JSON.stringify(encrypted));
  assert.throws(() => store.read(id), unavailable); assert.equal(readdirSync(f.directory).length, 2);
});

test('returns null for missing and expired sessions and never revives a removed handle during refresh', t => {
  const f = fixture(t), id = handle(), store = f.store(); assert.equal(store.read(id), null);
  assert.equal(store.write(id, session(), { create: false }), false);
  store.write(id, session({ expiresAt: clock + 1000 })); f.advance(1001);
  assert.equal(store.read(id), null);
  assert.equal(store.write(id, session(), { create: false }), false);
  store.remove(id); store.remove(id); assert.equal(f.store().read(id), null);
});

test('logout removal is durable across restart and refuses to overwrite an existing handle through create', t => {
  const f = fixture(t), id = handle(), store = f.store(); store.write(id, session());
  assert.throws(() => store.write(id, session({ refreshToken: 'OTHER_TOKEN' })), unavailable);
  assert.deepEqual(store.read(id), session()); store.remove(id);
  assert.equal(f.store().read(id), null); assert.deepEqual(readdirSync(f.directory), []);
  assert.equal(store.write(id, session(), { create: false }), false);
});

test('persists a thirty-day absolute session while allowing access token refresh without extending its deadline', t => {
  const f = fixture(t), id = handle(), store = f.store(), original = session({ expiresAt: clock + THIRTY_DAYS });
  store.write(id, original); f.advance(2 * 24 * 60 * 60_000);
  assert.deepEqual(f.store().read(id), original);
  const rotated = { ...original, accessToken: 'ROTATED_ACCESS', refreshToken: 'ROTATED_REFRESH', tokenExpiresAt: clock + 2 * 24 * 60 * 60_000 + 3_600_000 };
  assert.equal(store.write(id, rotated, { create: false }), true);
  assert.throws(() => store.write(id, { ...rotated, expiresAt: original.expiresAt + 1 }, { create: false }), unavailable);
  assert.throws(() => store.write(id, { ...rotated, user: { ...rotated.user, email: 'another@example.test' } }, { create: false }), unavailable);
  assert.deepEqual(store.read(id), rotated);
  f.advance(28 * 24 * 60 * 60_000); assert.equal(f.store().read(id), null);
});

test('refuses invalid handles, malformed sessions and oversized records with fixed errors', t => {
  const f = fixture(t), store = f.store();
  for (const id of ['../outside', 'a'.repeat(42), 'a'.repeat(44), '/'.repeat(43), '__proto__']) {
    assert.throws(() => store.read(id), unavailable); assert.throws(() => store.write(id, session()), unavailable); assert.throws(() => store.remove(id), unavailable);
  }
  for (const data of [null, session({ expiresAt: clock - 1 }), session({ expiresAt: clock + THIRTY_DAYS + 1 }), session({ tokenExpiresAt: NaN }), session({ accessToken: 'x'.repeat(32769) }), session({ refreshToken: 'x'.repeat(16385) }), session({ user: { id: 'not-uuid', email: 'x' } }), session({ user: { id: { toString: () => session().user.id }, email: session().user.email } })]) assert.throws(() => store.write(handle(), data), unavailable);
  assert.throws(() => store.write(handle(), session(), null), unavailable);
  assert.throws(() => store.write(handle(), session(), { create: 'yes' }), unavailable);
  const id = handle(); writeFileSync(file(f.directory, id), Buffer.alloc(96 * 1024 + 1)); assert.throws(() => store.read(id), unavailable);
});

test('caps active records at twenty and prunes only authenticated expired records before another creation', t => {
  const f = fixture(t), store = f.store();
  for (let i = 0; i < 20; i++) store.write(handle(), session({ expiresAt: clock + 1000 }));
  assert.throws(() => store.write(handle(), session()), unavailable); assert.equal(readdirSync(f.directory).length, 20);
  f.advance(1001); assert.equal(store.write(handle(), session()), true); assert.equal(readdirSync(f.directory).length, 1);
});

test('validates the key, origin and directory before use and never exposes configuration in its error', t => {
  const f = fixture(t);
  assert.throws(() => createCloudSessionStore(null), unavailable);
  for (const override of [{ encryptionKey: 'not-a-key' }, { encryptionKey: Buffer.alloc(31).toString('base64') }, { encryptionKey: key + '\n' }, { origin: 'https://diary.example/path' }, { origin: 'http://diary.example' }, { directory: 'relative' }]) assert.throws(() => createCloudSessionStore({ ...f.options, ...override }), unavailable);
  const path = join(f.root, 'ordinary-file'); writeFileSync(path, 'private directory marker');
  assert.throws(() => createCloudSessionStore({ ...f.options, directory: path }), unavailable);
});

test('removes only abandoned atomic-write names and preserves unrelated files during restart', t => {
  const f = fixture(t), store = f.store(), id = handle(), hash = createHash('sha256').update(id).digest('hex');
  store.write(id, session());
  writeFileSync(join(f.directory, `.${hash}.${'a'.repeat(24)}.tmp`), 'INCOMPLETE_CIPHERTEXT');
  writeFileSync(join(f.directory, 'unrelated.tmp'), 'SYNTHETIC_UNRELATED');
  assert.deepEqual(f.store().read(id), session());
  assert.deepEqual(readdirSync(f.directory).sort(), [`${hash}.json`, 'unrelated.tmp'].sort());
  assert.equal(readFileSync(join(f.directory, 'unrelated.tmp'), 'utf8'), 'SYNTHETIC_UNRELATED');
});

test('refuses symlink records and directories instead of reading or writing an outside path', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t), store = f.store(), id = handle(), outside = join(f.root, 'outside'); writeFileSync(outside, 'SYNTHETIC_OUTSIDE');
  symlinkSync(outside, file(f.directory, id)); assert.throws(() => store.read(id), unavailable); assert.throws(() => store.write(id, session(), { create: false }), unavailable); assert.equal(readFileSync(outside, 'utf8'), 'SYNTHETIC_OUTSIDE');
  const actual = join(f.root, 'actual'); mkdirSync(actual); const linked = join(f.root, 'linked'); symlinkSync(actual, linked, 'dir');
  assert.throws(() => createCloudSessionStore({ ...f.options, directory: linked }), unavailable);
});
