import { CloudError, invalid, unavailable, remoteJson, boundedResponseBytes, timeoutSignal } from './cloudUtils.mjs';
import { documentKey, operationId, hash } from './cloudValidation.mjs';
export const VAULT_LIMIT = 130 * 1024 * 1024;
export const VAULT_BLOB_LIMIT = 15 * 1024 * 1024;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.sort().join(',');
function bytes(value, max) {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw invalid('Invalid encrypted envelope.');
  const result = Buffer.from(value, 'base64'); if (result.length > max || result.toString('base64') !== value) throw invalid('Invalid encrypted envelope.'); return result;
}
export function validateVaultCipher(value, max = 96 * 1024 * 1024) {
  if (!exact(value, ['v', 'iv', 'data']) || value.v !== 1 || bytes(value.iv, 12).length !== 12 || bytes(value.data, max).length < 16) throw invalid('Invalid encrypted envelope.'); return value;
}
export function validateVaultHeader(value) {
  if (!exact(value, ['format', 'version', 'id', 'kdf', 'password', 'recovery']) || value.format !== 'dynamic-diary-vault' || value.version !== 1 || !/^[a-f0-9-]{36}$/.test(value.id) || !exact(value.kdf, ['name', 'hash', 'iterations', 'salt']) || value.kdf.name !== 'PBKDF2' || value.kdf.hash !== 'SHA-256' || value.kdf.iterations !== 600000 || bytes(value.kdf.salt, 16).length !== 16) throw invalid('Invalid vault header.');
  for (const wrap of [value.password, value.recovery]) if (bytes(validateVaultCipher(wrap, 48).data, 48).length !== 48) throw invalid('Invalid vault key wrap.'); return value;
}
const blobId = value => { if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw invalid(); return value; };
export function createVaultRepository({ config, fetchImpl = fetch } = {}) {
  const request = async (session, path, init = {}, allowExisting = false) => {
    let response;
    try { response = await fetchImpl(`${config.supabaseUrl}${path}`, { ...init, headers: { apikey: config.publishableKey, authorization: `Bearer ${session.accessToken}`, ...init.headers }, redirect: 'error', signal: timeoutSignal(init.signal, 60_000) }); } catch { throw unavailable(); }
    if (response.ok) return response;
    let data = {}; try { data = await remoteJson(response); } catch { /* Untrusted provider errors remain private. */ }
    if (allowExisting && (response.status === 409 || response.status === 400 && (data.statusCode === '409' || /duplicate|already exists/i.test(data.error ?? '')))) return response;
    if (response.status === 409 || /conflict|vault_exists|legacy_media/i.test(data.message ?? '')) throw new CloudError(409, 'vault_conflict', 'Vault state changed or legacy media requires assisted migration.');
    if ([401, 403].includes(response.status)) throw new CloudError(403, 'vault_forbidden', 'Vault access refused.');
    if (response.status === 404) throw new CloudError(404, 'vault_missing', 'Vault object not found.');
    if (response.status === 429) throw new CloudError(429, 'vault_rate_limited', 'Please retry later.'); throw unavailable();
  };
  const rpc = async (session, name, body, limit = VAULT_LIMIT) => remoteJson(await request(session, `/rest/v1/rpc/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), limit);
  const blobPath = (owner, id) => `/storage/v1/object/dynamic-diary-vault/${owner}/${blobId(id)}`;
  return {
    async get(session) {
      const value = await rpc(session, 'dynamic_diary_vault_snapshot', {});
      if (value?.vault === null) return { vault: null };
      if (!value || !Number.isSafeInteger(value.revision) || value.revision < 1) throw unavailable();
      try { validateVaultHeader(value.header); validateVaultCipher(value.manifest); } catch { throw unavailable(); } return { header: value.header, revision: value.revision, manifest: value.manifest };
    },
    async assertLegacy(session) { if ((await this.get(session)).vault !== null) throw new CloudError(409, 'vault_required', 'Unlock the encrypted vault in an updated application.'); },
    async activate(session, input) {
      if (!exact(input, ['header', 'manifest', 'expectedDocuments', 'operationId']) || !Array.isArray(input.expectedDocuments) || input.expectedDocuments.length > 9) throw invalid();
      validateVaultHeader(input.header); validateVaultCipher(input.manifest); operationId(input.operationId);
      const keys = new Set(); for (const doc of input.expectedDocuments) { if (!exact(doc, ['key', 'revision']) || !Number.isSafeInteger(doc.revision) || doc.revision < 1 || keys.has(documentKey(doc.key))) throw invalid(); keys.add(doc.key); }
      return rpc(session, 'dynamic_diary_activate_vault', { p_header: input.header, p_manifest: input.manifest, p_expected_documents: input.expectedDocuments, p_operation_id: input.operationId });
    },
    async write(session, input) {
      if (!exact(input, ['manifest', 'baseRevision', 'operationId']) || !Number.isSafeInteger(input.baseRevision) || input.baseRevision < 1) throw invalid();
      validateVaultCipher(input.manifest); operationId(input.operationId);
      return rpc(session, 'dynamic_diary_write_vault', { p_manifest: input.manifest, p_base_revision: input.baseRevision, p_operation_id: input.operationId });
    },
    async writeBlob(session, input) {
      if (!exact(input, ['id', 'sha256', 'base64'])) throw invalid(); blobId(input.id); const data = bytes(input.base64, VAULT_BLOB_LIMIT);
      if (!data.length || !/^[a-f0-9]{64}$/.test(input.sha256) || hash(data) !== input.sha256) throw invalid();
      let envelope; try { envelope = JSON.parse(data.toString('utf8')); } catch { throw invalid(); } validateVaultCipher(envelope, 10 * 1024 * 1024 + 16);
      const head = await this.get(session); if (head.vault === null) throw new CloudError(409, 'vault_missing', 'Activate a vault first.');
      const path = blobPath(session.user.id, input.id);
      const response = await request(session, path, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-upsert': 'false', 'cache-control': 'private, no-store' }, body: data }, true);
      await response.body?.cancel();
      const check = await boundedResponseBytes(await request(session, path), VAULT_BLOB_LIMIT);
      if (hash(check) !== input.sha256) throw unavailable();
      await rpc(session, 'dynamic_diary_register_vault_blob', { p_id: input.id, p_hash: input.sha256, p_size: data.length });
      return { id: input.id, sha256: input.sha256, size: data.length };
    },
    async readBlob(session, id) { const response = await request(session, blobPath(session.user.id, id)); return boundedResponseBytes(response, VAULT_BLOB_LIMIT); },
  };
}

