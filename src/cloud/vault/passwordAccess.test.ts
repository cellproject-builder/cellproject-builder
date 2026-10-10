import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createVault } from './crypto';
import { rememberDeviceVault } from './deviceKeys';
import { commitPasswordAccess, openPasswordAccess, preparePasswordAccess, sealPasswordAccess } from './passwordAccess';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
it('opens unchanged vault data with a valid ten-character login password on a new device', async () => {
  const vault = await createVault(crypto.randomUUID(), 'synthetic legacy secret'), original = JSON.stringify(vault.header);
  const data = await vault.session.seal('private project', 'test');
  const access = await sealPasswordAccess(vault.session, vault.recoveryKey, '1234567890');
  const opened = await openPasswordAccess(vault.session.ownerId, vault.header, access, '1234567890');
  expect(await opened.session.openText(data, 'test')).toBe('private project');
  expect(JSON.stringify(vault.header)).toBe(original);
  expect(JSON.stringify(access)).not.toContain(vault.recoveryKey);
  opened.session.dispose(); vault.session.dispose();
});
it('rejects a wrong password, tampered ciphertext, and transplanted account or vault', async () => {
  const vault = await createVault(crypto.randomUUID(), 'synthetic legacy secret');
  const access = await sealPasswordAccess(vault.session, vault.recoveryKey, 'password-synthetic');
  await expect(openPasswordAccess(vault.session.ownerId, vault.header, access, 'different-password')).rejects.toThrow('senha');
  await expect(openPasswordAccess('another-owner', vault.header, access, 'password-synthetic')).rejects.toThrow();
  await expect(openPasswordAccess(vault.session.ownerId, { ...vault.header, id: crypto.randomUUID() }, access, 'password-synthetic')).rejects.toThrow();
  await expect(openPasswordAccess(vault.session.ownerId, vault.header, { ...access, cipher: { ...access.cipher, iv: 'AAAAAAAAAAAAAAAA' } }, 'password-synthetic')).rejects.toThrow();
  vault.session.dispose();
});
it('rebinds the same data key after password recovery on a trusted device, without remote plaintext', async () => {
  const vault = await createVault(crypto.randomUUID(), 'synthetic legacy secret');
  await rememberDeviceVault(vault.session, { recoveryKey: vault.recoveryKey });
  const old = await sealPasswordAccess(vault.session, vault.recoveryKey, 'old-password-only');
  const prepared = await preparePasswordAccess(vault.session, 'new-password-only', vi.fn(), { access: old, revision: 3 });
  expect(prepared?.baseRevision).toBe(3);
  const fetcher = vi.fn<typeof fetch>(async (_path, init) => init?.method === 'PUT' ? Response.json({ revision: 4 }) : Response.json({ access: prepared!.access, revision: 4 }));
  await commitPasswordAccess(prepared, fetcher);
  const network = JSON.stringify(fetcher.mock.calls);
  expect(network).not.toContain('new-password-only'); expect(network).not.toContain(vault.recoveryKey);
  const opened = await openPasswordAccess(vault.session.ownerId, vault.header, prepared!.access, 'new-password-only');
  expect(await opened.session.openText(await vault.session.seal('same content', 'test'), 'test')).toBe('same content');
  opened.session.dispose(); vault.session.dispose();
});
it('does not replace a wrapper already opened by this password or invent recovery for legacy keys', async () => {
  const vault = await createVault(crypto.randomUUID(), 'synthetic legacy secret');
  const access = await sealPasswordAccess(vault.session, vault.recoveryKey, 'password-synthetic');
  expect(await preparePasswordAccess(vault.session, 'password-synthetic', vi.fn(), { access, revision: 1 })).toBeNull();
  await expect(preparePasswordAccess(vault.session, 'new-password-only', vi.fn(), { access: null })).rejects.toThrow('proteção antiga');
  vault.session.dispose();
});
