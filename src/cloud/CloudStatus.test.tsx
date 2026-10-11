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
import * as offlineAuthorization from './offline/repository';
async function settle(assertion: () => void) {
  let last: unknown;
  for (let attempt = 0; attempt < 100; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    try { assertion(); return; } catch (reason) { last = reason; }
  }
  throw last;
}

it('keeps a durable offline draft quiet and distinguishes it from a cloud confirmation', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const persistence = { read: async <T,>() => null as T | null, write: async () => {}, remove: async () => {} };
  const cloud = new CloudRuntime({ documents: [], media: [] }, vi.fn(), undefined, undefined, { persistence, networkReady: () => false });
  await cloud.write('dynamic_diary-theme', 'dark');
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={cloud} userId="owner" email="wylgnerbossman@gmail.com" onLogout={() => {}}/>));
    const indicator = host.querySelector('button')!;
    expect(indicator.getAttribute('aria-label')).toBe('Salvo neste aparelho · aguardando conexão');
    expect(indicator.getAttribute('aria-expanded')).toBe('false');
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
    await act(async () => indicator.click());
    expect(host.textContent).toContain('cópia cifrada');
  } finally { await act(async () => root.unmount()); host.remove(); cloud.dispose(); }
});

it('opens the status when the device cannot save and warns before leaving', async () => {
  const persistence = { read: async <T,>() => null as T | null, write: async () => { throw new Error('Sem espaço no aparelho'); }, remove: async () => {} };
  const cloud = new CloudRuntime({ documents: [], media: [] }, vi.fn(), undefined, undefined, { persistence, networkReady: () => false });
  await cloud.write('dynamic_diary-theme', 'dark');
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={cloud} userId="owner" email="wylgnerbossman@gmail.com" onLogout={() => {}}/>));
    expect(host.textContent).toContain('Sem espaço no aparelho');
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); cloud.dispose(); }
});

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

it('lets the indicator hide a conflict without clearing drafts and keeps it hidden during status updates', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const cloud = new CloudRuntime({ documents: [], media: [] });
  cloud.reportSyncIssue({ kind: 'conflict', key: 'cellproject-workspace', message: 'Conflito de revisão no servidor.' });
  await cloud.write('dynamic_diary-theme', 'unsent-draft');
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={cloud} userId="owner" email="synthetic@example.test" onLogout={() => {}}/>));
    const indicator = host.querySelector<HTMLButtonElement>('.cloud-status-indicator')!;
    expect(indicator.getAttribute('aria-expanded')).toBe('true');
    await act(async () => indicator.click());
    expect(indicator.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('.cloud-status-panel')).toBeNull();
    expect(host.querySelector('.cloud-status.has-error')).not.toBeNull();
    expect(indicator.getAttribute('aria-label')).toBe('Alterações sem salvar');
    expect(cloud.getSnapshot().issue?.kind).toBe('conflict');
    expect(cloud.getSnapshot().pending).toBe(1); expect(cloud.get('dynamic_diary-theme')).toBe('unsent-draft');
    await act(async () => { cloud.notifyNetworkState(); cloud.reportSyncIssue({ kind: 'conflict', key: 'cellproject-workspace', message: 'Conflito de revisão no servidor.' }); });
    expect(host.querySelector('.cloud-status-panel')).toBeNull();
    await act(async () => indicator.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Conflito de revisão');
  } finally { await act(async () => root.unmount()); host.remove(); cloud.dispose(); }
});

it('provides a keyboard-accessible close action and reopens for a different synchronization issue', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const cloud = new CloudRuntime({ documents: [], media: [] }); cloud.notifySessionExpired('/api/live/ink');
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={cloud} userId="owner" email="synthetic@example.test" onLogout={() => {}}/>));
    const indicator = host.querySelector<HTMLButtonElement>('.cloud-status-indicator')!;
    const close = host.querySelector<HTMLButtonElement>('button[aria-label="Fechar aviso de sincronização"]');
    expect(close).not.toBeNull();
    await act(async () => { close!.focus(); close!.click(); });
    expect(indicator.getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(indicator);
    await act(async () => cloud.notifySessionExpired('/api/cloud/snapshot'));
    expect(host.querySelector('.cloud-status-panel')).toBeNull();
    await act(async () => cloud.reportSyncIssue({ kind: 'conflict', key: 'cellproject-workspace', message: 'Conflito de revisão no servidor.' }));
    expect(indicator.getAttribute('aria-expanded')).toBe('true');
    await act(async () => host.querySelector('.cloud-status-panel')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.querySelector('.cloud-status-panel')).toBeNull(); expect(document.activeElement).toBe(indicator);
    expect(cloud.getSnapshot().issue?.kind).toBe('conflict');
  } finally { await act(async () => root.unmount()); host.remove(); cloud.dispose(); }
});

it('lets the user retry a conflict against the retained draft without reloading or resetting the password', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let remoteValue = 'light';
  const fetcher = vi.fn<typeof fetch>(async (path, init) => {
    if (path !== '/api/cloud/documents/dynamic_diary-theme' || init?.method !== 'PUT') throw new Error('Unexpected request');
    const body = JSON.parse(String(init.body)); expect(body.baseRevision).toBe(1);
    remoteValue = body.value; return Response.json({ revision: 2 });
  });
  const cloud = new CloudRuntime({ documents: [{ key: 'dynamic_diary-theme', value: 'light', revision: 1 }], media: [] }, fetcher, undefined, async () => ({ documents: [{ key: 'dynamic_diary-theme', value: remoteValue, revision: 1 }], media: [] }));
  cloud.reportSyncIssue({ kind: 'conflict', key: 'dynamic_diary-theme', message: 'Conflito de revisão no servidor.' });
  await cloud.write('dynamic_diary-theme', 'retained-draft');
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={cloud} userId="owner" email="synthetic@example.test" onLogout={() => {}}/>));
    const retry = [...host.querySelectorAll('button')].find(button => button.textContent === 'Conciliar alterações');
    expect(retry).toBeDefined();
    await act(async () => retry!.click());
    await settle(() => expect(cloud.getSnapshot()).toMatchObject({ pending: 0, issue: null }));
    expect(remoteValue).toBe('retained-draft'); expect(cloud.get('dynamic_diary-theme')).toBe('retained-draft');
    expect(fetcher).toHaveBeenCalledOnce();
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
it('revokes offline reopening before remote logout and preserves a durable pending checkpoint', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.stubGlobal('crypto', webcrypto); activity.chatRunning = false;
  const vault = await createVault(crypto.randomUUID(), 'synthetic durable-logout phrase'), events: string[] = [];
  const persistence = { read: async <T,>() => null as T | null, write: async () => {}, remove: vi.fn(async () => {}) };
  const cloud = new CloudRuntime({ documents: [], media: [] }, vi.fn(), () => vault.session.dispose(), undefined, { persistence, networkReady: () => false });
  configureCloud(cloud); configureVault(vault.session); await cloud.write('dynamic_diary-theme', 'pending dark');
  vi.spyOn(offlineAuthorization, 'revokeOfflineAuthorization').mockImplementation(async () => { events.push('revoke'); });
  const logout = vi.fn(), fetcher = vi.fn<typeof fetch>(async () => { events.push('logout'); expect(cloud.getSnapshot().pending).toBe(1); return Response.json({ signedOut: true }); });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={cloud} userId={vault.session.ownerId} email="wylgnerbossman@gmail.com" fetcher={fetcher} onLogout={logout}/>));
    await act(async () => host.querySelector('button')!.click());
    const leave = [...host.querySelectorAll('button')].find(button => button.textContent === 'Sair e bloquear')!;
    expect(leave.disabled).toBe(false); await act(async () => leave.click());
    await settle(() => expect(logout).toHaveBeenCalledOnce());
    expect(events).toEqual(['revoke', 'logout']); expect(persistence.remove).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); configureCloud(null); configureVault(null, false); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});
it('keeps the current session open and skips remote logout if local revocation cannot be confirmed', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; activity.chatRunning = false;
  const cloud = new CloudRuntime({ documents: [], media: [] });
  const revoke = vi.spyOn(offlineAuthorization, 'revokeOfflineAuthorization').mockRejectedValue(new Error('Falha ao revogar a abertura offline'));
  const logout = vi.fn(), fetcher = vi.fn<typeof fetch>();
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={cloud} userId="owner" email="wylgnerbossman@gmail.com" fetcher={fetcher} onLogout={logout}/>));
    await act(async () => host.querySelector('button')!.click());
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Sair da conta')!.click());
    await settle(() => expect(host.textContent).toContain('Falha ao revogar'));
    expect(revoke).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled(); expect(logout).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); cloud.dispose(); vi.restoreAllMocks(); }
});
it('allows an explicit encrypted rescue before logout when the device checkpoint cannot be saved', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.stubGlobal('crypto', webcrypto); activity.chatRunning = false;
  const vault = await createVault(crypto.randomUUID(), 'synthetic local-quota rescue phrase');
  const persistence = { read: async <T,>() => null as T | null, write: async () => { throw new Error('Sem espaço no aparelho'); }, remove: async () => {} };
  const cloud = new CloudRuntime({ documents: [], media: [] }, vi.fn(), () => vault.session.dispose(), undefined, { persistence, networkReady: () => false });
  configureCloud(cloud); configureVault(vault.session); await cloud.write('dynamic_diary-theme', 'pending dark');
  vi.spyOn(rescue, 'downloadSessionRescue').mockImplementation(rescue.captureSessionRescue);
  const logout = vi.fn(), fetcher = vi.fn<typeof fetch>(async () => Response.json({ signedOut: true }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={cloud} userId={vault.session.ownerId} email="wylgnerbossman@gmail.com" fetcher={fetcher} onLogout={logout}/>));
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Baixar rascunhos de resgate (.ddvault)')!.click());
    await settle(() => expect([...host.querySelectorAll('button')].find(button => button.textContent === 'Sair após baixar resgate')?.disabled).toBe(false));
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Sair após baixar resgate')!.click());
    await settle(() => expect(logout).toHaveBeenCalledOnce());
  } finally { await act(async () => root.unmount()); host.remove(); configureCloud(null); configureVault(null, false); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});
it('allows logout after an explicit partial rescue with a pending failed write, preserving it if logout fails', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.stubGlobal('crypto', webcrypto); activity.chatRunning = false;
  const vault = await createVault(crypto.randomUUID(), 'synthetic failed-logout phrase');
  await offlineAuthorization.authorizeOffline({ version: 1, ownerId: vault.session.ownerId, email: 'wylgnerbossman@gmail.com', header: vault.header });
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
    expect(host.textContent).toContain('abertura offline deste navegador já foi revogada');
    expect(await offlineAuthorization.readOfflineAuthorization()).toBeNull();
    expect(logout).not.toHaveBeenCalled(); expect(getVaultSession()).toBe(vault.session); expect(cloud.getSnapshot().pending).toBe(1);
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Sair após baixar resgate')!.click());
    await settle(() => expect(logout).toHaveBeenCalledOnce()); expect(fetcher).toHaveBeenCalledTimes(2); expect(getVaultSession()).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); configureCloud(null); configureVault(null, false); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
}, 15000);
