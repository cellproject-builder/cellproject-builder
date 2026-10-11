import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
const activity = vi.hoisted(() => ({ chatRunning: true }));
vi.mock('@/chat/store', () => ({ useChatStore: { getState: () => ({ running: activity.chatRunning }) }, flushChatPersistence: async () => {} }));
vi.mock('@/workspace/planner', () => ({ plannerBusy: () => false, getPlannerOwnerId: () => null }));
vi.mock('@/store', () => ({ hasPendingGraphPersistence: () => false, flushGraphPersistence: async () => {} }));
vi.mock('@/workspace/store', () => ({ flushWorkspacePersistence: async () => {} }));
import { CloudStatus, saveCurrentBackup } from './CloudStatus';
import { CloudRuntime, configureCloud, getCloudRuntime } from './runtime';
import { registerDataIngestion } from './activity';
import { createVault } from './vault/crypto';
import { rememberDeviceVault, readDeviceVault } from './vault/deviceKeys';
import { configureVault, getVaultSession } from './vault/privacy';
import * as rescue from './rescue';
import * as offlineAuthorization from './offline/repository';
import * as migration from './migration';
import * as graphPersistence from '@/store';
import * as workspacePersistence from '@/workspace/store';
import * as chatPersistence from '@/chat/store';
import { createSelectiveJSONStorage, isDeferredJSONStorage } from '@/data/selectiveJSONStorage';
async function settle(assertion: () => void) {
  let last: unknown;
  for (let attempt = 0; attempt < 100; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    try { assertion(); return; } catch (reason) { last = reason; }
  }
  throw last;
}

it('exports a complete backup when no deferred writes are pending', async () => {
  vi.stubGlobal('crypto', webcrypto); activity.chatRunning = false;
  const cloud = new CloudRuntime({ documents: [], media: [] }); configureCloud(cloud);
  const download = vi.spyOn(migration, 'downloadBackup').mockResolvedValue();
  try {
    await saveCurrentBackup(cloud);
    expect(download).toHaveBeenCalledOnce();
    expect(download.mock.calls[0][0]).toMatchObject({ format: 'cellproject-global-backup', documents: [] });
  } finally { configureCloud(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

it('refuses to download an old account backup after its owner changes during capture', async () => {
  vi.stubGlobal('crypto', webcrypto); activity.chatRunning = false;
  const original = new CloudRuntime({ documents: [], media: [] }), replacement = new CloudRuntime({ documents: [], media: [] }); configureCloud(original);
  let finish!: (value: Awaited<ReturnType<typeof migration.captureLegacyBackup>>) => void;
  const capture = vi.spyOn(migration, 'captureLegacyBackup').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const download = vi.spyOn(migration, 'downloadBackup').mockResolvedValue();
  const pending = saveCurrentBackup(original);
  try {
    await vi.waitFor(() => expect(capture).toHaveBeenCalledOnce());
    configureCloud(replacement);
    finish({ format: 'cellproject-global-backup', version: 1, exportedAt: '', operationId: 'synthetic', manifestHash: '', documents: [], media: [] });
    await expect(pending).rejects.toThrow('sessão de persistência mudou');
    expect(download).not.toHaveBeenCalled(); expect(getCloudRuntime()).toBe(replacement);
  } finally { configureCloud(null); original.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

it('does not mark a backup complete when a draft changes during the asynchronous download', async () => {
  vi.stubGlobal('crypto', webcrypto); activity.chatRunning = false;
  const cloud = new CloudRuntime({ documents: [], media: [] }); configureCloud(cloud);
  let finish!: () => void;
  const download = vi.spyOn(migration, 'downloadBackup').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = saveCurrentBackup(cloud);
  try {
    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
    cloud.notifySessionExpired('api'); await cloud.write('dynamic_diary-theme', 'newer unsaved draft'); finish();
    await expect(pending).rejects.toThrow('dados mudaram');
    expect(cloud.get('dynamic_diary-theme')).toBe('newer unsaved draft');
  } finally { finish?.(); configureCloud(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

it('retains a nondeferred draft written during the logout request', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  activity.chatRunning = false;
  const cloud = new CloudRuntime({ documents: [], media: [] }); configureCloud(cloud);
  vi.spyOn(offlineAuthorization, 'revokeOfflineAuthorization').mockResolvedValue();
  let finish!: (value: Response) => void;
  const logout = vi.fn(), fetcher = vi.fn<typeof fetch>(() => new Promise(resolve => { finish = resolve; }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={cloud} userId="owner" email="synthetic@example.test" fetcher={fetcher} onLogout={logout}/>));
    await act(async () => host.querySelector('button')!.click());
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Sair da conta')!.click());
    await settle(() => expect(fetcher).toHaveBeenCalledOnce());
    await act(async () => { cloud.notifySessionExpired('api'); await cloud.write('dynamic_diary-theme', 'typed during logout'); finish(Response.json({ signedOut: true })); });
    await settle(() => expect(host.textContent).toContain('dados mudaram'));
    expect(logout).not.toHaveBeenCalled(); expect(cloud.get('dynamic_diary-theme')).toBe('typed during logout');
  } finally { await act(async () => root.unmount()); host.remove(); configureCloud(null); vi.restoreAllMocks(); }
});

it.each(['backup', 'rescue'] as const)('blocks %s when a retained graph draft has not reached the runtime', async action => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('crypto', webcrypto); activity.chatRunning = false;
  const cloud = new CloudRuntime({ documents: [], media: [] }); configureCloud(cloud); cloud.notifySessionExpired('api');
  vi.spyOn(graphPersistence, 'flushGraphPersistence').mockRejectedValue(new Error('Previous persistence owner'));
  vi.spyOn(graphPersistence, 'hasPendingGraphPersistence').mockReturnValue(true);
  const backup = vi.spyOn(migration, 'downloadBackup').mockResolvedValue();
  const rescueDownload = vi.spyOn(rescue, 'downloadSessionRescue').mockImplementation(rescue.captureSessionRescue);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    if (action === 'backup') await expect(saveCurrentBackup(cloud)).rejects.toThrow('alterações do plano');
    else {
      await act(async () => root.render(<CloudStatus runtime={cloud} userId="owner" email="synthetic@example.test" onLogout={() => {}}/>));
      await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Baixar rascunhos de resgate (.json)')!.click());
      await settle(() => expect(host.textContent).toContain('alterações do plano'));
    }
    expect(backup).not.toHaveBeenCalled(); expect(rescueDownload).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); configureCloud(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

it('refuses rescue logout if a new graph draft is queued after the rescue download', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('crypto', webcrypto); activity.chatRunning = false;
  const vault = await createVault(crypto.randomUUID(), 'synthetic graph-rescue logout phrase');
  const cloud = new CloudRuntime({ documents: [], media: [] }, vi.fn(), () => vault.session.dispose()); configureCloud(cloud); configureVault(vault.session); cloud.notifySessionExpired('api');
  const pending = vi.spyOn(graphPersistence, 'hasPendingGraphPersistence').mockReturnValue(false);
  vi.spyOn(rescue, 'downloadSessionRescue').mockImplementation(rescue.captureSessionRescue);
  const revoke = vi.spyOn(offlineAuthorization, 'revokeOfflineAuthorization').mockResolvedValue();
  const logout = vi.fn(), fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ signedOut: true }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={cloud} userId={vault.session.ownerId} email="synthetic@example.test" fetcher={fetcher} onLogout={logout}/>));
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Baixar rascunhos de resgate (.ddvault)')!.click());
    await settle(() => expect([...host.querySelectorAll('button')].find(button => button.textContent === 'Sair após baixar resgate')?.disabled).toBe(false));
    pending.mockReturnValue(true);
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Sair após baixar resgate')!.click());
    await settle(() => expect(host.textContent).toContain('alterações do plano'));
    expect(revoke).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled(); expect(logout).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); configureCloud(null); configureVault(null, false); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

it('does not log out a replacement account when the owner changes during local revocation', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  activity.chatRunning = false;
  const original = new CloudRuntime({ documents: [], media: [] }), replacement = new CloudRuntime({ documents: [], media: [] }); configureCloud(original);
  let finish!: () => void;
  const revoke = vi.spyOn(offlineAuthorization, 'revokeOfflineAuthorization').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const logout = vi.fn(), fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ signedOut: true }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={original} userId="original" email="synthetic@example.test" fetcher={fetcher} onLogout={logout}/>));
    await act(async () => host.querySelector('button')!.click());
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Sair da conta')!.click());
    await settle(() => expect(revoke).toHaveBeenCalledOnce());
    await act(async () => { configureCloud(replacement); finish(); });
    await settle(() => expect(host.textContent).toContain('sessão de persistência mudou'));
    expect(fetcher).not.toHaveBeenCalled(); expect(logout).not.toHaveBeenCalled(); expect(getCloudRuntime()).toBe(replacement);
  } finally { finish?.(); await act(async () => root.unmount()); host.remove(); configureCloud(null); original.dispose(); vi.restoreAllMocks(); }
});

it('drains graph and chat into the rescue even if deferred workspace persistence fails', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  activity.chatRunning = false;
  const cloud = new CloudRuntime({ documents: [], media: [] }); configureCloud(cloud); cloud.notifySessionExpired('api');
  const save = vi.fn(async (key: string, value: string): Promise<void> => { await cloud.write(key, value); throw new Error('Checkpoint unavailable'); });
  const storage = createSelectiveJSONStorage(() => ({ getItem: () => null, setItem: save, removeItem: () => {} }), { deferMs: 200, scope: () => cloud })!;
  if (!isDeferredJSONStorage(storage)) throw new Error('deferred adapter missing');
  const pending = storage.setItem('cellproject-workspace', { state: { notes: [] }, version: 2 });
  await expect(storage.flush()).rejects.toThrow('Checkpoint unavailable'); await expect(pending).rejects.toThrow();
  const graph = JSON.stringify({ state: { projects: [{ id: 'latest-graph' }] }, version: 1 });
  const chat = JSON.stringify({ state: { messages: [{ text: 'latest-chat' }] }, version: 1 });
  const graphFlush = vi.spyOn(graphPersistence, 'flushGraphPersistence').mockImplementation(() => cloud.write('cellproject-graph', graph));
  const chatFlush = vi.spyOn(chatPersistence, 'flushChatPersistence').mockImplementation(() => cloud.write('dynamic_diary-chat', chat));
  vi.spyOn(workspacePersistence, 'flushWorkspacePersistence').mockImplementation(() => storage.flush());
  const download = vi.spyOn(rescue, 'downloadSessionRescue').mockImplementation(rescue.captureSessionRescue);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={cloud} userId="owner" email="synthetic@example.test" onLogout={() => {}}/>));
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Baixar rascunhos de resgate (.json)')!.click());
    await settle(() => expect(graphFlush).toHaveBeenCalledOnce());
    expect(chatFlush).toHaveBeenCalledOnce(); expect(download).toHaveBeenCalledOnce();
    const exported = await download.mock.results[0].value;
    expect(exported.documents).toEqual(expect.arrayContaining([{ key: 'cellproject-graph', value: graph }, { key: 'dynamic_diary-chat', value: chat }]));
    expect(storage.hasPending()).toBe(true);
  } finally {
    save.mockResolvedValue(undefined); await act(async () => { await storage.flush(); root.unmount(); });
    host.remove(); configureCloud(null); vi.restoreAllMocks();
  }
});

it('marks deferred edits as unsaved and drains them before logout', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  activity.chatRunning = false;
  const events: string[] = [];
  let finish!: () => void;
  const save = vi.fn(() => new Promise<void>(resolve => { events.push('write'); finish = resolve; }));
  const storage = createSelectiveJSONStorage(() => ({ getItem: () => null, setItem: save, removeItem: () => {} }), { deferMs: 200 })!;
  if (!isDeferredJSONStorage(storage)) throw new Error('deferred adapter missing');
  vi.spyOn(workspacePersistence, 'flushWorkspacePersistence').mockImplementation(() => storage.flush());
  const cloud = new CloudRuntime({ documents: [], media: [] }); configureCloud(cloud);
  const logout = vi.fn(), fetcher = vi.fn<typeof fetch>(async () => { events.push('logout'); return Response.json({ signedOut: true }); });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={cloud} userId="owner" email="synthetic@example.test" fetcher={fetcher} onLogout={logout}/>));
    act(() => { storage.setItem('cellproject-workspace', { state: { text: 'unsent' }, version: 2 }); });
    expect(host.querySelector('.cloud-status-indicator')?.getAttribute('aria-label')).toContain('Salvando');
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await act(async () => host.querySelector<HTMLButtonElement>('.cloud-status-indicator')!.click());
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Sair da conta')!.click());
    await settle(() => expect(events).toEqual(['write']));
    expect(logout).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    await settle(() => expect(logout).toHaveBeenCalledOnce());
    expect(events).toEqual(['write', 'logout']);
  } finally {
    save.mockImplementation(() => Promise.resolve()); finish?.(); await act(async () => { await storage.flush(); root.unmount(); });
    host.remove(); configureCloud(null); vi.restoreAllMocks();
  }
});

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
  activity.chatRunning = true;
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
  const cloud = new CloudRuntime({ documents: [], media: [] }); configureCloud(cloud);
  const revoke = vi.spyOn(offlineAuthorization, 'revokeOfflineAuthorization').mockRejectedValue(new Error('Falha ao revogar a abertura offline'));
  const logout = vi.fn(), fetcher = vi.fn<typeof fetch>();
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={cloud} userId="owner" email="wylgnerbossman@gmail.com" fetcher={fetcher} onLogout={logout}/>));
    await act(async () => host.querySelector('button')!.click());
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Sair da conta')!.click());
    await settle(() => expect(host.textContent).toContain('Falha ao revogar'));
    expect(revoke).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled(); expect(logout).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); configureCloud(null); vi.restoreAllMocks(); }
});
it('allows an explicit encrypted rescue before logout when the device checkpoint cannot be saved', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.stubGlobal('crypto', webcrypto); activity.chatRunning = false;
  const vault = await createVault(crypto.randomUUID(), 'synthetic local-quota rescue phrase');
  const persistence = { read: async <T,>() => null as T | null, write: async () => { throw new Error('Sem espaço no aparelho'); }, remove: async () => {} };
  const cloud = new CloudRuntime({ documents: [], media: [] }, vi.fn(), () => vault.session.dispose(), undefined, { persistence, networkReady: () => false });
  configureCloud(cloud); configureVault(vault.session); await cloud.write('dynamic_diary-theme', 'pending dark');
  const save = vi.fn(async (key: string, value: string) => { await cloud.write(key, value); await cloud.flush(); });
  const storage = createSelectiveJSONStorage(() => ({ getItem: () => null, setItem: save, removeItem: () => {} }), { deferMs: 200, scope: () => cloud, captureStorage: () => ({ getItem: () => null, setItem: save, removeItem: () => {} }) })!;
  if (!isDeferredJSONStorage(storage)) throw new Error('deferred adapter missing');
  const pending = storage.setItem('cellproject-workspace', { state: { text: 'Preservar no resgate' }, version: 2 });
  await expect(storage.flush()).rejects.toThrow(); await expect(pending).rejects.toThrow();
  vi.spyOn(rescue, 'downloadSessionRescue').mockImplementation(rescue.captureSessionRescue);
  const logout = vi.fn(), fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('logout offline')).mockResolvedValue(Response.json({ signedOut: true }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<CloudStatus runtime={cloud} userId={vault.session.ownerId} email="wylgnerbossman@gmail.com" fetcher={fetcher} onLogout={logout}/>));
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Baixar rascunhos de resgate (.ddvault)')!.click());
    await settle(() => expect([...host.querySelectorAll('button')].find(button => button.textContent === 'Sair após baixar resgate')?.disabled).toBe(false));
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Sair após baixar resgate')!.click());
    await settle(() => expect(host.textContent).toContain('logout offline'));
    expect(storage.hasPending()).toBe(true); expect(logout).not.toHaveBeenCalled();
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Sair após baixar resgate')!.click());
    await settle(() => expect(logout).toHaveBeenCalledOnce());
    expect(storage.hasPending()).toBe(false);
  } finally {
    save.mockResolvedValue();
    await act(async () => { await storage.flush(); root.unmount(); });
    host.remove(); configureCloud(null); configureVault(null, false); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
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
