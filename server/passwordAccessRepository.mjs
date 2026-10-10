import { CloudError, invalid, unavailable, remoteJson, timeoutSignal } from './cloudUtils.mjs';
import { operationId } from './cloudValidation.mjs';
import { validateVaultCipher } from './vaultRepository.mjs';

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.sort().join(',');
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
function salt(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(value)) throw invalid('Invalid password access.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 16 || bytes.toString('base64') !== value) throw invalid('Invalid password access.');
}
/** Only an opaque, password-wrapped recovery capability crosses this boundary. */
export function validatePasswordAccess(value) {
  if (!exact(value, ['format', 'version', 'ownerId', 'vaultId', 'kdf', 'cipher']) || value.format !== 'dynamic-diary-password-access' || value.version !== 1 || typeof value.ownerId !== 'string' || !value.ownerId || value.ownerId.length > 180 || !uuid(value.vaultId) || !exact(value.kdf, ['name', 'hash', 'iterations', 'salt']) || value.kdf.name !== 'PBKDF2' || value.kdf.hash !== 'SHA-256' || value.kdf.iterations !== 600000) throw invalid('Invalid password access.');
  salt(value.kdf.salt); validateVaultCipher(value.cipher, 256); return value;
}
function owner(session) {
  if (!session?.user?.id || typeof session.user.id !== 'string' || typeof session.accessToken !== 'string' || !session.accessToken) throw new CloudError(403, 'password_access_forbidden', 'Password access refused.');
  return session.user.id;
}
export function createPasswordAccessRepository({ config, fetchImpl = fetch } = {}) {
  async function rpc(session, name, body) {
    owner(session);
    let response;
    try {
      response = await fetchImpl(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
        method: 'POST', headers: { apikey: config.publishableKey, authorization: `Bearer ${session.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(body), redirect: 'error', signal: timeoutSignal(undefined, 20_000),
      });
    } catch { throw unavailable(); }
    if (response.ok) return remoteJson(response, 4096);
    let data = {}; try { data = await remoteJson(response, 8192); } catch { /* Never expose provider detail. */ }
    if (response.status === 409 || /conflict/i.test(data.message ?? '')) throw new CloudError(409, 'password_access_conflict', 'Password access changed. Refresh before retrying.');
    if ([401, 403].includes(response.status) || data.code === '42501') throw new CloudError(403, 'password_access_forbidden', 'Password access refused.');
    if (response.status === 400 && data.code === '22023') throw invalid('Invalid password access.');
    if (response.status === 429) throw new CloudError(429, 'password_access_rate_limited', 'Please retry later.');
    throw unavailable();
  }
  return {
    async get(session) {
      const expectedOwner = owner(session), value = await rpc(session, 'dynamic_diary_password_access_snapshot', {});
      if (exact(value, ['access']) && value.access === null) return value;
      try {
        if (!exact(value, ['access', 'revision']) || !Number.isSafeInteger(value.revision) || value.revision < 1 || validatePasswordAccess(value.access).ownerId !== expectedOwner) throw invalid();
      } catch { throw unavailable(); }
      return value;
    },
    async write(session, input) {
      const expectedOwner = owner(session);
      if (!exact(input, ['access', 'baseRevision', 'operationId', 'expectedOwnerId']) || !Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0 || input.baseRevision === Number.MAX_SAFE_INTEGER) throw invalid();
      validatePasswordAccess(input.access); operationId(input.operationId);
      if (input.expectedOwnerId !== expectedOwner || input.access.ownerId !== expectedOwner) throw new CloudError(403, 'password_access_forbidden', 'Password access refused.');
      // The database checks vaultId against the immutable canonical vault while
      // holding the same account lock used by vault writes and activation.
      const value = await rpc(session, 'dynamic_diary_write_password_access', {
        p_access: input.access, p_base_revision: input.baseRevision, p_operation_id: input.operationId, p_expected_owner_id: input.expectedOwnerId,
      });
      if (!exact(value, ['revision']) || value.revision !== input.baseRevision + 1) throw unavailable();
      return value;
    },
  };
}
