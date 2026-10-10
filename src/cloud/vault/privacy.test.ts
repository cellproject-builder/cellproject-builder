import { beforeEach, expect, it, vi } from 'vitest';
import { authorizeVaultSharing, configureVault } from './privacy';
import type { VaultSession } from './crypto';
import { sessionAwareFetch } from '../runtime';
beforeEach(() => { configureVault(null, false); vi.restoreAllMocks(); });
it('blocks every AI/search/classification POST before fetch until explicit session consent', () => {
  configureVault({} as VaultSession); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  for (const path of ['/api/ai/openrouter/chat/completions', '/api/visuals/search', '/api/visuals/plan-intake', '/api/visuals/decomposition-research']) expect(() => authorizeVaultSharing(path, { method: 'POST' })).toThrow('não autorizado');
  expect(confirm).toHaveBeenCalledTimes(4);
  expect(() => authorizeVaultSharing('/api/cloud/vault', { method: 'PUT' })).not.toThrow();
  expect(() => authorizeVaultSharing('/api/visuals/capabilities')).not.toThrow();
  confirm.mockReturnValue(true); authorizeVaultSharing('/api/ai/openrouter/chat/completions', { method: 'POST' });
  confirm.mockReturnValue(false); expect(() => authorizeVaultSharing('/api/visuals/search', { method: 'POST' })).not.toThrow();
  configureVault({} as VaultSession); expect(() => authorizeVaultSharing('/api/visuals/search', { method: 'POST' })).toThrow();
});
it('guards the shared provider transport before any network request', async () => {
  configureVault({} as VaultSession); vi.spyOn(window, 'confirm').mockReturnValue(false);
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({}));
  await expect(sessionAwareFetch('/api/visuals/search', { method: 'POST' }, fetcher)).rejects.toThrow('não autorizado');
  expect(fetcher).not.toHaveBeenCalled();
});
it('keeps a locked cofre protected instead of silently reverting to unencrypted AI requests', async () => {
  configureVault({} as VaultSession); configureVault(null);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true), fetcher = vi.fn<typeof fetch>();
  await expect(sessionAwareFetch('/api/ai/openrouter/chat/completions', { method: 'POST' }, fetcher)).rejects.toThrow('bloqueado');
  expect(fetcher).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
});

