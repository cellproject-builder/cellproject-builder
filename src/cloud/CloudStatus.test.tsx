import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
const activity = vi.hoisted(() => ({ chatRunning: true }));
vi.mock('@/chat/store', () => ({ useChatStore: { getState: () => ({ running: activity.chatRunning }) }, flushChatPersistence: async () => {} }));
vi.mock('@/workspace/planner', () => ({ plannerBusy: () => false, getPlannerOwnerId: () => null }));
vi.mock('@/store', () => ({ hasPendingGraphPersistence: () => false, flushGraphPersistence: async () => {} }));
vi.mock('@/workspace/store', () => ({ flushWorkspacePersistence: async () => {} }));
import { CloudStatus } from './CloudStatus';
import { CloudRuntime, configureCloud } from './runtime';
import { registerDataIngestion } from './activity';
import { createVault } from './vault/crypto';
import { rememberDeviceVault, readDeviceVault } from './vault/deviceKeys';
import { configureVault, getVaultSession } from './vault/privacy';
import * as rescue from './rescue';
async function settle(assertion: () => void) {
  let last: unknown;
  for (let attempt = 0; attempt < 100; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    try { assertion(); return; } catch (reason) { last = reason; }
  }
  throw last;
}

it('keeps the saved indicator quiet while its button still opens synchronization details', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const cloud = new CloudRuntime({ documents: [], media: [] });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={cloud} userId="original-user" email="wylgnerbossman@gmail.com" onLogout={() => {}}/>));
    const indicator = host.querySelector('button')!;
    expect(indicator.textContent).toBe('');
    expect(indicator.getAttribute('aria-label')).toBe('Salvo na nuvem');
    expect(indicator.getAttribute('aria-expanded')).toBe('false');
    expect(host.textContent).not.toContain('wylgnerbossman@gmail.com');
    await act(async () => indicator.click());
    expect(indicator.getAttribute('aria-expanded')).toBe('true');
    expect(host.textContent).toContain('wylgnerbossman@gmail.com');
    expect(host.textContent).toContain('Baixar cópia completa desta sessão');
    await act(async () => indicator.click());
    expect(host.textContent).not.toContain('wylgnerbossman@gmail.com');
  } finally { await act(async () => root.unmount()); host.remove(); cloud.dispose(); }
});

it('requests a verified password setup link for the signed-in identity from the cloud menu', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const cloud = new CloudRuntime({ documents: [], media: [] });
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ sent: true }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={cloud} userId="original-user" email="wylgnerbossman@gmail.com" onLogout={() => {}}/>));
    await act(async () => host.querySelector('button')!.click());
    const button = [...host.querySelectorAll('button')].find(button => button.textContent === 'Criar ou alterar senha'); expect(button).toBeDefined();
    await act(async () => button!.click());
    await settle(() => { expect(host.querySelector('[role="status"]')?.textContent).toContain('neste navegador'); expect(button!.disabled).toBe(false); });
    expect(fetcher.mock.calls[0][0]).toBe('/api/auth/password/setup-link');
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({ email: 'wylgnerbossman@gmail.com' });
    expect(host.querySelector('[role="status"]')?.textContent).toContain('neste navegador');
    expect(host.querySelector('.cloud-status-indicator')?.textContent).toBe('');
  } finally { await act(async () => root.unmount()); host.remove(); cloud.dispose(); vi.restoreAllMocks(); }
});

it('exposes an expired-session warning and its recovery actions without needing to open the indicator', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const cloud = new CloudRuntime({ documents: [], media: [] }); cloud.notifySessionExpired('api');
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={cloud} userId="original-user" email="wylgnerbossman@gmail.com" onLogout={() => {}}/>));
    const indicator = host.querySelector('button')!;
    expect(indicator.getAttribute('aria-label')).toBe('Alterações sem salvar');
    expect(indicator.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).toContain('Retomar salvamento nesta aba');
  } finally { await act(async () => root.unmount()); host.remove(); cloud.dispose(); }
});

it('blocks complete backup, rescue and logout while chat or a file ingestion is running', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const cloud = new CloudRuntime({ documents: [], media: [] }); configureCloud(cloud); cloud.notifySessionExpired('api');
  const logout = vi.fn(), fetcher = vi.spyOn(globalThis, 'fetch');
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={cloud} userId="original-user" email="wylgnerbossman@gmail.com" onLogout={logout}/>));
    expect(host.querySelector('a[target="_blank"]')?.getAttribute('rel')).toContain('noopener');
    for (const label of ['Baixar cópia completa desta sessão', 'Baixar rascunhos de resgate (.json)', 'Sair da conta']) {
      await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === label)!.click(); });
      await settle(() => expect([...host.querySelectorAll('button')].find(button => button.textContent === label)!.disabled).toBe(false));
      expect(host.textContent).toContain('Aguarde o chat');
    }
    activity.chatRunning = false; const finish = registerDataIngestion();
    try { await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'Baixar rascunhos de resgate (.json)')!.click(); }); await settle(() => expect([...host.querySelectorAll('button')].find(button => button.textContent === 'Baixar rascunhos de resgate (.json)')!.disabled).toBe(false)); expect(host.textContent).toContain('leitura dos anexos'); }
    finally { finish(); }
    expect(logout).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); configureCloud(null); vi.restoreAllMocks(); }
});
it('logs out before closing a protected session and retains its remembered browser key', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.stubGlobal('crypto', webcrypto); activity.chatRunning = false;
  const vault = await createVault(crypto.randomUUID(), 'synthetic logout-device phrase'); await rememberDeviceVault(vault.session, { recoveryKey: vault.recoveryKey });
  const cloud = new CloudRuntime({ documents: [], media: [] }, fetch, () => vault.session.dispose()); configureCloud(cloud); configureVault(vault.session);
  const logout = vi.fn(), fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ signedOut: true }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={cloud} userId={vault.session.ownerId} email="wylgnerbossman@gmail.com" onLogout={logout}/>));
    await act(async () => host.querySelector('button')!.click());
    expect(host.textContent).not.toContain('Baixar chave de recuperação'); expect(host.textContent).toContain('Use sua senha para entrar'); expect(host.textContent).not.toContain('Bloquear cofre');
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Sair e bloquear')!.click());
    await settle(() => expect(logout).toHaveBeenCalledOnce());
    expect(fetcher).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' })); expect(getVaultSession()).toBeNull();
    await expect(vault.session.seal('locked', 'test')).rejects.toThrow('bloqueado');
    const remembered = await readDeviceVault(vault.session.ownerId, vault.header); expect(remembered).not.toBeNull(); remembered!.dispose();
  } finally { await act(async () => root.unmount()); host.remove(); configureCloud(null); configureVault(null, false); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
}, 15000);
it('allows logout after an explicit partial rescue with a pending failed write, preserving it if logout fails', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.stubGlobal('crypto', webcrypto); activity.chatRunning = false;
  const vault = await createVault(crypto.randomUUID(), 'synthetic failed-logout phrase');
  const cloud = new CloudRuntime({ documents: [], media: [] }, async () => { throw new Error('write offline'); }, () => vault.session.dispose()); configureCloud(cloud); configureVault(vault.session);
  await cloud.write('dynamic_diary-theme', 'dark'); expect(cloud.getSnapshot().pending).toBe(1);
  vi.spyOn(rescue, 'downloadSessionRescue').mockImplementation(rescue.captureSessionRescue);
  const logout = vi.fn(), fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('logout offline')).mockResolvedValueOnce(Response.json({ signedOut: true }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={cloud} userId={vault.session.ownerId} email="wylgnerbossman@gmail.com" onLogout={logout}/>));
    expect([...host.querySelectorAll('button')].find(button => button.textContent === 'Sair e bloquear')!.disabled).toBe(true);
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Baixar rascunhos de resgate (.ddvault)')!.click());
    await settle(() => expect([...host.querySelectorAll('button')].find(button => button.textContent === 'Sair após baixar resgate')?.disabled).toBe(false));
    expect(host.textContent).toContain('pacote é parcial');
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Sair após baixar resgate')!.click());
    await settle(() => expect(host.textContent).toContain('logout offline'));
    expect(logout).not.toHaveBeenCalled(); expect(getVaultSession()).toBe(vault.session); expect(cloud.getSnapshot().pending).toBe(1);
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Sair após baixar resgate')!.click());
    await settle(() => expect(logout).toHaveBeenCalledOnce()); expect(fetcher).toHaveBeenCalledTimes(2); expect(getVaultSession()).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); configureCloud(null); configureVault(null, false); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
}, 15000);
