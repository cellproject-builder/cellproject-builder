import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { constants, chmodSync, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { CloudError } from './cloudUtils.mjs';

const MAX_RECORD_BYTES = 96 * 1024, MAX_RECORDS = 20, MAX_TTL = 30 * 24 * 60 * 60_000;
const HANDLE = /^[A-Za-z0-9_-]{43}$/, FILE = /^([a-f0-9]{64})\.json$/, TEMP = /^\.[a-f0-9]{64}\.[a-f0-9]{24}\.tmp$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const unavailable = () => new CloudError(503, 'session_storage_unavailable', 'Session storage is temporarily unavailable.');
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const safe = operation => { try { return operation(); } catch { throw unavailable(); } };
function base64(value, bytes) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 || value.length > MAX_RECORD_BYTES) throw unavailable();
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value || bytes !== undefined && decoded.length !== bytes) throw unavailable();
  return decoded;
}
function payload(value, time, reading = false) {
  if (!record(value) || !record(value.user) || typeof value.user.id !== 'string' || !UUID.test(value.user.id) || typeof value.user.email !== 'string' || value.user.email.length > 254 || !/^[^@\s\x00-\x1f\x7f]+@[^@\s\x00-\x1f\x7f]+$/.test(value.user.email)) throw unavailable();
  if (reading && (!exact(value, ['user', 'accessToken', 'refreshToken', 'expiresAt', 'tokenExpiresAt']) || !exact(value.user, ['id', 'email']))) throw unavailable();
  if (typeof value.accessToken !== 'string' || !value.accessToken.length || value.accessToken.length > 32768 || !/^[\x21-\x7e]+$/.test(value.accessToken) || typeof value.refreshToken !== 'string' || !value.refreshToken.length || value.refreshToken.length > 16384 || !/^[\x21-\x7e]+$/.test(value.refreshToken)) throw unavailable();
  if (!Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0 || value.expiresAt > time + MAX_TTL || !reading && value.expiresAt <= time || !Number.isSafeInteger(value.tokenExpiresAt) || value.tokenExpiresAt <= 0 || value.tokenExpiresAt > time + MAX_TTL) throw unavailable();
  // No spread from the session: promises, password setup rights, vault material
  // and future authorization fields are never part of the durable representation.
  return { user: { id: value.user.id, email: value.user.email }, accessToken: value.accessToken, refreshToken: value.refreshToken, expiresAt: value.expiresAt, tokenExpiresAt: value.tokenExpiresAt };
}

/** One-process Railway volume storage. Browser cookies remain opaque handles. */
export function createCloudSessionStore(options = {}) {
  return safe(() => {
    if (!record(options)) throw unavailable();
    const { directory, encryptionKey, origin, now = Date.now } = options;
    const key = base64(encryptionKey, 32);
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.username || url.password || url.origin !== origin || typeof directory !== 'string' || !isAbsolute(directory) || typeof now !== 'function') throw unavailable();
    const target = resolve(directory); if (target === parse(target).root) throw unavailable();
    try { const info = lstatSync(target); if (!info.isDirectory() || info.isSymbolicLink()) throw unavailable(); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    mkdirSync(target, { recursive: true, mode: 0o700 });
    if (lstatSync(target).isSymbolicLink()) throw unavailable();
    const root = realpathSync(target); chmodSync(root, 0o700);
    const syncDirectory = (path = root) => {
      if (process.platform !== 'linux') return;
      const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY);
      try { fsyncSync(fd); } finally { closeSync(fd); }
    };
    const checkDirectory = () => { const info = lstatSync(root); if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(root) !== root) throw unavailable(); };
    const time = () => { const value = now(); if (!Number.isSafeInteger(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER - MAX_TTL) throw unavailable(); return value; };
    const digest = handle => { if (typeof handle !== 'string' || !HANDLE.test(handle)) throw unavailable(); return createHash('sha256').update(handle).digest('hex'); };
    const pathOf = hash => join(root, `${hash}.json`);
    const aad = hash => Buffer.from(JSON.stringify(['dynamic-diary-cloud-session', 1, origin, hash]));
    const stat = hash => { try { return lstatSync(pathOf(hash)); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; } };
    const readHash = (hash, at) => {
      const info = stat(hash); if (!info) return null;
      if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > MAX_RECORD_BYTES) throw unavailable();
      const fd = openSync(pathOf(hash), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let raw;
      try {
        const actual = fstatSync(fd); if (!actual.isFile() || actual.size < 1 || actual.size > MAX_RECORD_BYTES) throw unavailable();
        const buffer = Buffer.alloc(MAX_RECORD_BYTES + 1); let size = 0, count;
        while (size < buffer.length && (count = readSync(fd, buffer, size, buffer.length - size, null))) size += count;
        if (size > MAX_RECORD_BYTES) throw unavailable();
        raw = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
      } finally { closeSync(fd); }
      const value = JSON.parse(raw);
      if (!exact(value, ['version', 'iv', 'tag', 'ciphertext']) || value.version !== 1) throw unavailable();
      const iv = base64(value.iv, 12), tag = base64(value.tag, 16), ciphertext = base64(value.ciphertext);
      if (!ciphertext.length || ciphertext.length > MAX_RECORD_BYTES) throw unavailable();
      const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAAD(aad(hash)); decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      try { return payload(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)), at, true); }
      finally { plain.fill(0); }
    };
    const removeHash = hash => { try { unlinkSync(pathOf(hash)); } catch (error) { if (error?.code !== 'ENOENT') throw error; } };
    const ensureCapacity = at => {
      const files = readdirSync(root).filter(name => FILE.test(name));
      if (files.length < MAX_RECORDS) return;
      let removed = false, active = 0;
      for (const name of files) {
        const hash = FILE.exec(name)[1], current = readHash(hash, at);
        if (current && current.expiresAt <= at) { removeHash(hash); removed = true; } else active++;
      }
      if (removed) syncDirectory(); if (active >= MAX_RECORDS) throw unavailable();
    };
    // Discard only our abandoned atomic-write names, never unrelated files.
    for (const name of readdirSync(root)) if (TEMP.test(name)) unlinkSync(join(root, name));
    syncDirectory(); syncDirectory(dirname(root)); time();
    return {
      read(handle) { return safe(() => { checkDirectory(); const at = time(), current = readHash(digest(handle), at); return current && current.expiresAt > at ? current : null; }); },
      write(handle, session, options = {}) {
        return safe(() => {
          if (!record(options)) throw unavailable();
          const { create = true } = options;
          checkDirectory(); if (typeof create !== 'boolean') throw unavailable();
          const hash = digest(handle), at = time(), value = payload(session, at);
          if (create) { if (stat(hash)) throw unavailable(); ensureCapacity(at); }
          else {
            const previous = readHash(hash, at); if (!previous || previous.expiresAt <= at) return false;
            if (previous.user.id !== value.user.id || previous.user.email !== value.user.email || previous.expiresAt !== value.expiresAt) throw unavailable();
          }
          const plain = Buffer.from(JSON.stringify(value)), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad(hash));
          let ciphertext; try { ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]); } finally { plain.fill(0); }
          const body = Buffer.from(JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }));
          if (body.length > MAX_RECORD_BYTES) throw unavailable();
          const temporary = join(root, `.${hash}.${randomBytes(12).toString('hex')}.tmp`); let fd;
          try {
            fd = openSync(temporary, 'wx', 0o600); writeFileSync(fd, body); fsyncSync(fd); closeSync(fd); fd = undefined;
            renameSync(temporary, pathOf(hash)); syncDirectory(); return true;
          } finally {
            if (fd !== undefined) closeSync(fd);
            try { unlinkSync(temporary); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
          }
        });
      },
      remove(handle) { return safe(() => { checkDirectory(); removeHash(digest(handle)); syncDirectory(); }); },
    };
  });
}
