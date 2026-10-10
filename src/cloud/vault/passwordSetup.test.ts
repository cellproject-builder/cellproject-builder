import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createVault } from './crypto';
import { rememberDeviceVault } from './deviceKeys';
import { openPasswordAccess, type PasswordAccess } from './passwordAccess';
import { preparePasswordProtection } from './passwordSetup';
import type { VaultHead } from './transport';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
const password = 'new synthetic password';
const snapshot = { documents: [{ key: 'dynamic_diary-chat', value: '{"version":1,"state":{"private":"preserved conversation"}}', revision: 1 }], media: [] };
async function fixture() {
  const vault = await createVault(crypto.randomUUID(), 'legacy synthetic vault phrase');
  const head: VaultHead = { header: vault.header, revision: 1, manifest: await vault.session.seal(JSON.stringify({ snapshot, files: {} }), 'manifest:1') };
  return { vault, head };
}

it('blocks password-reset preflight on an untrusted device before any auth or data mutation', async () => {
  const { vault, head } = await fixture(), canonical = JSON.stringify(head);
  const fetcher = vi.fn<typeof fetch>(async target => { expect(target).toBe('/api/cloud/vault'); return Response.json(head); });
  await expect(preparePasswordProtection(vault.session.ownerId, password, fetcher)).rejects.toThrow('aparelho');
  expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][1]?.method).toBeUndefined(); expect(JSON.stringify(head)).toBe(canonical); vault.session.dispose();
}, 15000);

it('prepares locally from a trusted key and retries exactly the same encrypted wrapper after a 502', async () => {
  const { vault, head } = await fixture(), canonical = JSON.stringify(head), bodies: string[] = [];
  await rememberDeviceVault(vault.session, { recoveryKey: vault.recoveryKey });
  let access: PasswordAccess | null = null;
  const fetcher = vi.fn<typeof fetch>(async (target, init) => {
    if (target === '/api/cloud/vault') return Response.json(head);
    expect(target).toBe('/api/cloud/vault/password-access');
    if (init?.method === 'PUT') {
      bodies.push(String(init.body)); if (bodies.length === 1) return Response.json({}, { status: 502 });
      access = JSON.parse(String(init.body)).access; return Response.json({ revision: 1 });
    }
    return Response.json(access ? { access, revision: 1 } : { access: null });
  });
  const prepared = await preparePasswordProtection(vault.session.ownerId, password, fetcher);
  expect(bodies).toHaveLength(0); expect(fetcher.mock.calls.every(call => !call[1]?.method || call[1].method === 'GET')).toBe(true);
  await expect(prepared.commit()).rejects.toThrow('502'); await prepared.commit();
  expect(bodies).toHaveLength(2); expect(bodies[0]).toBe(bodies[1]); expect(bodies[0]).not.toContain(password); expect(bodies[0]).not.toContain(vault.recoveryKey);
  expect(JSON.stringify(head)).toBe(canonical);
  const opened = await openPasswordAccess(vault.session.ownerId, vault.header, access, password);
  expect(await opened.session.openText(head.manifest, 'manifest:1')).toBe(JSON.stringify({ snapshot, files: {} }));
  opened.session.dispose(); prepared.dispose(); vault.session.dispose();
}, 15000);

it('keeps first-account password setup free of vault mutations when no vault exists', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ vault: null }));
  const prepared = await preparePasswordProtection(crypto.randomUUID(), password, fetcher);
  await prepared.commit(); prepared.dispose(); expect(fetcher).toHaveBeenCalledTimes(1);
});
