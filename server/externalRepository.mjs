import { CloudError, invalid, unavailable, remoteJson, timeoutSignal, boundedResponseBytes } from './cloudUtils.mjs';
import { operationId, stableId, hash } from './cloudValidation.mjs';
import { VAULT_LIMIT, VAULT_BLOB_LIMIT, validateVaultHeader, validateVaultCipher } from './vaultRepository.mjs';

const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...names].sort().join(',');
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
function grants(projects, permissions) {
  if (projects !== '*' && (!Array.isArray(projects) || projects.length < 1 || projects.length > 1000 || new Set(projects).size !== projects.length || projects.some(value => { try { stableId(value); return false; } catch { return true; } }))) throw invalid('Invalid project grants.');
  if (!Array.isArray(permissions) || !permissions.length || permissions.length > 2 || new Set(permissions).size !== permissions.length || permissions.some(value => !['read', 'write'].includes(value))) throw invalid('Invalid credential permissions.');
}
function metadata(value) {
  if (!exact(value, ['id', 'name', 'tokenPrefix', 'projects', 'permissions', 'expiresAt', 'createdAt', 'revokedAt']) || !uuid(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100 || typeof value.tokenPrefix !== 'string' || value.tokenPrefix.length > 32 || !/^[A-Za-z0-9_-]+$/.test(value.tokenPrefix) || !timestamp(value.expiresAt) || !timestamp(value.createdAt) || value.revokedAt !== null && !timestamp(value.revokedAt)) throw unavailable();
  try { grants(value.projects, value.permissions); } catch { throw unavailable(); }
  return { ...value, expiresAt: new Date(value.expiresAt).toISOString(), createdAt: new Date(value.createdAt).toISOString(), revokedAt: value.revokedAt === null ? null : new Date(value.revokedAt).toISOString() };
}
function credentialIdentity(value) { if (!uuid(value?.id) || !uuid(value.ownerId) || !uuid(value.vaultId)) throw invalid('Invalid delegated credential.'); return { p_credential_id: value.id, p_owner_id: value.ownerId, p_vault_id: value.vaultId }; }
function scope(input) {
  operationId(input?.operationId);
  if (!digest(input.fingerprint) || typeof input.accountOperation !== 'boolean' || input.accountOperation && input.projectId !== null || !input.accountOperation && typeof input.projectId !== 'string') throw invalid('Invalid action identity or scope.');
  if (input.projectId !== null) stableId(input.projectId);
  return { p_operation_id: input.operationId, p_fingerprint: input.fingerprint, p_project_id: input.projectId, p_account_operation: input.accountOperation };
}
function confirmation(value, replayOnly = false) {
  if (!exact(value, ['revision', 'replayed', 'receipt']) || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.replayed !== 'boolean' || replayOnly && !value.replayed) throw unavailable();
  try { validateVaultCipher(value.receipt, 2 * 1024 * 1024); } catch { throw unavailable(); }
  return value;
}
function blobScope(input) {
  if (!uuid(input?.id) || typeof input.accountOperation !== 'boolean' || input.accountOperation && input.projectId !== null || !input.accountOperation && typeof input.projectId !== 'string') throw invalid('Invalid media scope.');
  if (input.projectId !== null) stableId(input.projectId);
  return { p_id: input.id, p_project_id: input.projectId, p_account_operation: input.accountOperation };
}
function blobMetadata(value, id) {
  if (!exact(value, ['id', 'sha256', 'size']) || value.id !== id || !digest(value.sha256) || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > VAULT_BLOB_LIMIT) throw unavailable(); return value;
}

/** Dedicated credentials have their own SQL authorization; no browser cookie or refresh token is reused. */
export function createExternalRepository({ config, fetchImpl = fetch } = {}) {
  const serverHeaders = () => {
    if (typeof config?.externalApiKey !== 'string' || !config.externalApiKey) throw new CloudError(503, 'external_not_configured', 'External access is not configured.');
    return { apikey: config.externalApiKey, ...(!config.externalApiKey.startsWith('sb_secret_') && config.externalApiKey.split('.').length === 3 ? { authorization: `Bearer ${config.externalApiKey}` } : {}) };
  };
  async function rpc(name, body, session, limit = 64 * 1024) {
    let headers;
    if (session) {
      if (!uuid(session?.user?.id) || typeof session.accessToken !== 'string' || !session.accessToken) throw new CloudError(401, 'authentication_required', 'Sign in to manage external access.');
      headers = { apikey: config.publishableKey, authorization: `Bearer ${session.accessToken}` };
    } else {
      // New secret keys authenticate through apikey; legacy service-role JWTs also require their Bearer token.
      headers = serverHeaders();
    }
    let response;
    try { response = await fetchImpl(`${config.supabaseUrl}/rest/v1/rpc/${name}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: timeoutSignal(undefined, 60_000) }); }
    catch { throw unavailable(); }
    if (response.ok) return remoteJson(response, limit);
    let data = {}; try { data = await remoteJson(response, 8192); } catch { /* Provider messages never cross the application boundary. */ }
    if (data.message === 'Revision conflict') throw new CloudError(409, 'external_revision_conflict', 'The vault revision changed. Read the current project before retrying.');
    if (data.message === 'Operation conflict') throw new CloudError(409, 'external_operation_conflict', 'The operation ID was already used with different input.');
    if (data.message === 'Credential conflict') throw new CloudError(409, 'external_credential_conflict', 'This credential ID is already registered.');
    if (data.message === 'Blob conflict') throw new CloudError(409, 'external_blob_conflict', 'The private media ID already contains different bytes.');
    if (data.message === 'Vault quota exceeded') throw new CloudError(413, 'external_storage_limit', 'Encrypted storage limit reached.');
    if (data.code === '42501' || [401, 403].includes(response.status)) throw new CloudError(403, 'external_forbidden', 'External access was refused.');
    if (data.code === '22023') throw invalid('Invalid external access request.');
    if (response.status === 429) throw new CloudError(429, 'external_rate_limited', 'Please retry later.');
    throw unavailable();
  }
  async function storage(credential, id, init = {}, duplicate = false) {
    credentialIdentity(credential); if (!uuid(id)) throw invalid('Invalid private media ID.');
    let response;
    try { response = await fetchImpl(`${config.supabaseUrl}/storage/v1/object/dynamic-diary-vault/${credential.ownerId}/${id}`, { ...init, method: init.method ?? 'GET', headers: { ...serverHeaders(), ...init.headers }, redirect: 'error', signal: timeoutSignal(undefined, 60_000) }); }
    catch (error) { if (error instanceof CloudError) throw error; throw unavailable(); }
    if (response.ok) return response;
    let data = {}; try { data = await remoteJson(response, 8192); } catch { /* Storage error bodies remain private. */ }
    if (duplicate && (response.status === 409 || response.status === 400 && (data.statusCode === '409' || /duplicate|already exists/i.test(data.error ?? '')))) return null;
    if ([401, 403].includes(response.status)) throw new CloudError(403, 'external_forbidden', 'External access was refused.');
    if (response.status === 404) throw new CloudError(404, 'media_not_found', 'Private media was not found.');
    if (response.status === 429) throw new CloudError(429, 'external_rate_limited', 'Please retry later.');
    throw unavailable();
  }
  return {
    async enrollment(session, input) {
      if (!exact(input, ['id', 'name', 'tokenHash', 'tokenPrefix', 'projects', 'permissions', 'expiresAt', 'vaultId', 'sealedKey']) || !uuid(input.id) || !uuid(input.vaultId) || !digest(input.tokenHash) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100 || typeof input.tokenPrefix !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(input.tokenPrefix) || typeof input.expiresAt !== 'string' || !Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.now()) throw invalid('Invalid external credential.');
      grants(input.projects, input.permissions); validateVaultCipher(input.sealedKey, 48);
      if (Buffer.from(input.sealedKey.data, 'base64').length !== 48) throw invalid('Invalid delegated key.');
      const value = await rpc('cellproject_external_enroll', { p_id: input.id, p_name: input.name, p_token_hash: input.tokenHash, p_token_prefix: input.tokenPrefix, p_projects: input.projects, p_permissions: input.permissions, p_expires_at: input.expiresAt, p_vault_id: input.vaultId, p_sealed_key: input.sealedKey }, session);
      const result = metadata(value); if (result.id !== input.id) throw unavailable(); return result;
    },
    async list(session) {
      const values = await rpc('cellproject_external_list', {}, session);
      if (!Array.isArray(values) || values.length > 100) throw unavailable(); return values.map(metadata);
    },
    async revoke(session, id) {
      if (!uuid(id)) throw invalid('Invalid credential ID.');
      const value = await rpc('cellproject_external_revoke', { p_id: id }, session);
      if (!exact(value, ['revoked']) || value.revoked !== true) throw unavailable(); return value;
    },
    async authenticate(tokenHash) {
      if (!digest(tokenHash)) throw invalid('Invalid credential token.');
      const value = await rpc('cellproject_external_authenticate', { p_token_hash: tokenHash });
      if (value === null) return null;
      try {
        if (!exact(value, ['id', 'ownerId', 'projects', 'permissions', 'vaultId', 'sealedKey'])) throw invalid(); credentialIdentity(value); grants(value.projects, value.permissions); validateVaultCipher(value.sealedKey, 48);
      } catch { throw unavailable(); }
      return value;
    },
    async snapshot(credential) {
      const value = await rpc('cellproject_external_snapshot', credentialIdentity(credential), undefined, VAULT_LIMIT);
      try { if (!exact(value, ['header', 'revision', 'manifest']) || !Number.isSafeInteger(value.revision) || value.revision < 1 || validateVaultHeader(value.header).id !== credential.vaultId) throw invalid(); validateVaultCipher(value.manifest); }
      catch { throw unavailable(); } return value;
    },
    async replay(credential, input) {
      const value = await rpc('cellproject_external_replay', { ...credentialIdentity(credential), ...scope(input) }, undefined, 3 * 1024 * 1024);
      return value === null ? null : confirmation(value, true);
    },
    async commit(credential, input) {
      const identity = credentialIdentity(credential), target = scope(input);
      if (!exact(input, ['operationId', 'fingerprint', 'baseRevision', 'manifest', 'receipt', 'projectId', 'accountOperation']) || !Number.isSafeInteger(input.baseRevision) || input.baseRevision < 1 || input.baseRevision >= Number.MAX_SAFE_INTEGER) throw invalid('Invalid external commit.');
      validateVaultCipher(input.manifest); validateVaultCipher(input.receipt, 2 * 1024 * 1024);
      return confirmation(await rpc('cellproject_external_commit', { ...identity, ...target, p_base_revision: input.baseRevision, p_manifest: input.manifest, p_receipt: input.receipt }, undefined, 3 * 1024 * 1024));
    },
    async writeBlob(credential, input) {
      if (!exact(input, ['projectId', 'accountOperation', 'id', 'sha256', 'base64']) || !digest(input.sha256) || typeof input.base64 !== 'string' || input.base64.length > Math.ceil(VAULT_BLOB_LIMIT / 3) * 4) throw invalid('Invalid encrypted media.');
      const identity = credentialIdentity(credential), target = blobScope(input), bytes = Buffer.from(input.base64, 'base64');
      if (!bytes.length || bytes.length > VAULT_BLOB_LIMIT || bytes.toString('base64') !== input.base64 || hash(bytes) !== input.sha256) throw invalid('Invalid encrypted media bytes.');
      let envelope; try { envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw invalid('Invalid encrypted media.'); }
      validateVaultCipher(envelope, 10 * 1024 * 1024 + 16);
      const existing = await rpc('cellproject_external_blob_access', { ...identity, ...target, p_write: true });
      if (existing !== null) { const metadata = blobMetadata(existing, input.id); if (metadata.sha256 !== input.sha256 || metadata.size !== bytes.length) throw new CloudError(409, 'external_blob_conflict', 'The private media ID already contains different bytes.'); }
      const response = await storage(credential, input.id, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'cache-control': 'private, no-store', 'x-upsert': 'false' }, body: bytes }, true);
      await response?.body?.cancel();
      const readback = await boundedResponseBytes(await storage(credential, input.id), VAULT_BLOB_LIMIT);
      if (readback.length !== bytes.length || hash(readback) !== input.sha256) throw unavailable();
      const metadata = blobMetadata(await rpc('cellproject_external_blob', { ...identity, ...target, p_hash: input.sha256, p_size: bytes.length }), input.id);
      if (metadata.sha256 !== input.sha256 || metadata.size !== bytes.length) throw unavailable(); return metadata;
    },
    async readBlob(credential, input) {
      if (!exact(input, ['projectId', 'accountOperation', 'id'])) throw invalid('Invalid private media request.');
      const identity = credentialIdentity(credential), target = blobScope(input);
      const check = await rpc('cellproject_external_blob_access', { ...identity, ...target, p_write: false });
      if (check === null) throw new CloudError(404, 'media_not_found', 'Private media was not found.');
      const metadata = blobMetadata(check, input.id), bytes = await boundedResponseBytes(await storage(credential, input.id), VAULT_BLOB_LIMIT);
      if (bytes.length !== metadata.size || hash(bytes) !== metadata.sha256) throw unavailable();
      // Recheck after asynchronous Storage I/O; revoked grants cannot deliver fetched bytes.
      const confirmed = blobMetadata(await rpc('cellproject_external_blob_access', { ...identity, ...target, p_write: false }), input.id);
      if (confirmed.sha256 !== metadata.sha256 || confirmed.size !== metadata.size) throw unavailable(); return bytes;
    },
  };
}
