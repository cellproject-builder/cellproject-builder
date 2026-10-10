import { cloudJson } from '../runtime';
import { readDeviceVault } from './deviceKeys';
import { commitPasswordAccess, preparePasswordAccess } from './passwordAccess';
import { VaultTransport, type VaultHead } from './transport';
export interface PasswordProtectionUpdate { commit: () => Promise<void>; dispose: () => void }
/** Preflight happens before changing Auth, so forgotten-password recovery cannot strand existing data. */
export async function preparePasswordProtection(ownerId: string, password: string, fetcher: typeof fetch = fetch): Promise<PasswordProtectionUpdate> {
  const head = await cloudJson<VaultHead | { vault: null }>('/api/cloud/vault', {}, fetcher);
  if ('vault' in head && head.vault === null) return { commit: async () => {}, dispose: () => {} };
  const current = head as VaultHead, session = await readDeviceVault(ownerId, current.header);
  if (!session) throw new Error('Para redefinir a senha e preservar seus dados privados, abra este link em um aparelho onde seus projetos já aparecem.');
  try {
    const vault = await VaultTransport.open(session, current, fetcher);
    // Validate the canonical manifest before linking a new password. No content is sent here.
    vault.snapshot();
    const prepared = await preparePasswordAccess(session, password, fetcher);
    return { commit: () => commitPasswordAccess(prepared, fetcher), dispose: () => vault.dispose() };
  } catch (reason) { session.dispose(); throw reason; }
}
