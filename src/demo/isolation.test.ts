import { clear, get, set } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let resetCloud = () => {};
beforeEach(() => { history.replaceState({}, '', '/'); vi.resetModules(); });
afterEach(async () => {
  resetCloud(); resetCloud = () => {};
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState({}, '', '/');
  await clear();
  localStorage.clear();
  vi.resetModules();
});

describe('public demo persistence boundary', () => {
  it('keeps normal workspace storage durable outside the demo', async () => {
    const { selectedStorage, readPreference, writePreference } = await import('@/cloud/storage');
    const { IndexedDbWorkspaceRepository } = await import('@/data/workspaceRepository');
    const repository = new IndexedDbWorkspaceRepository();
    await selectedStorage.setItem('normal-store', 'normal edit');
    await repository.save('normal-workspace', 'normal project');
    writePreference('normal-preference', 'dark');
    expect(await get('normal-store')).toBe('normal edit');
    expect(await repository.load('normal-workspace')).toBe('normal project');
    expect(await get('normal-workspace')).toBe('normal project');
    expect(readPreference('normal-preference')).toBe('dark');
    expect(localStorage.getItem('normal-preference')).toBe('dark');
    await repository.remove('normal-workspace');
    expect(await get('normal-workspace')).toBeUndefined();
  });

  it('never reads or changes real browser data when editing and removing demo values', async () => {
    await set('cellproject-workspace', 'private project');
    await set('cellproject-config', 'private config');
    localStorage.setItem('dynamic_diary-theme', 'private theme');
    history.replaceState({}, '', '/demo');
    const { selectedStorage, readPreference, writePreference } = await import('@/cloud/storage');
    const { IndexedDbWorkspaceRepository, createWorkspaceStorage } = await import('@/data/workspaceRepository');
    const repository = createWorkspaceStorage(new IndexedDbWorkspaceRepository());
    expect(await selectedStorage.getItem('cellproject-config')).toBeNull();
    expect(await repository.getItem('cellproject-workspace')).toBeNull();
    expect(readPreference('dynamic_diary-theme')).toBeNull();
    await selectedStorage.setItem('cellproject-config', 'example config');
    await repository.setItem('cellproject-workspace', 'example project');
    writePreference('dynamic_diary-theme', 'example theme');
    expect(await selectedStorage.getItem('cellproject-config')).toBe('example config');
    expect(await repository.getItem('cellproject-workspace')).toBe('example project');
    expect(readPreference('dynamic_diary-theme')).toBe('example theme');
    await selectedStorage.removeItem('cellproject-config');
    await repository.removeItem('cellproject-workspace');
    expect(await selectedStorage.getItem('cellproject-config')).toBeNull();
    expect(await repository.getItem('cellproject-workspace')).toBeNull();
    expect(await get('cellproject-workspace')).toBe('private project');
    expect(await get('cellproject-config')).toBe('private config');
    expect(localStorage.getItem('dynamic_diary-theme')).toBe('private theme');
  });

  it('keeps demo storage ahead of an accidentally configured authenticated runtime', async () => {
    history.replaceState({}, '', '/demo');
    const { CloudRuntime, configureCloud } = await import('@/cloud/runtime');
    const { selectedStorage, readPreference, writePreference } = await import('@/cloud/storage');
    const network = vi.fn(async () => Response.json({ revision: 2 }));
    const remoteProject = '{"state":{"projects":{"private":{"title":"Private project"}}},"version":1}';
    const cloud = new CloudRuntime({ documents: [{ key: 'cellproject-workspace', value: remoteProject, revision: 1 }, { key: 'dynamic_diary-theme', value: 'private remote theme', revision: 1 }], media: [] }, network);
    configureCloud(cloud);
    resetCloud = () => configureCloud(null);
    expect(await selectedStorage.getItem('cellproject-workspace')).toBeNull();
    expect(readPreference('dynamic_diary-theme')).toBeNull();
    await selectedStorage.setItem('cellproject-workspace', 'example project');
    writePreference('dynamic_diary-theme', 'example theme');
    await selectedStorage.removeItem('cellproject-workspace');
    expect(cloud.get('cellproject-workspace')).toBe(remoteProject);
    expect(cloud.get('dynamic_diary-theme')).toBe('private remote theme');
    expect(network).not.toHaveBeenCalled();
  });

  it('keeps real workspace hydration and deferred edits in memory even after attempted cloud activation', async () => {
    const privateWorkspace = '{"state":{"projects":{"private":{"id":"private","name":"Private project"}},"tasks":{},"notes":{},"boards":{}},"version":1}';
    await set('cellproject-workspace', privateWorkspace);
    history.replaceState({}, '', '/demo');
    const { CloudRuntime, configureCloud, getCloudRuntime, isCloudEnabled } = await import('@/cloud/runtime');
    const network = vi.fn(async () => Response.json({ revision: 2 }));
    const cloud = new CloudRuntime({ documents: [{ key: 'cellproject-workspace', value: privateWorkspace, revision: 1 }], media: [] }, network);
    configureCloud(cloud, { openrouter: true });
    resetCloud = () => { configureCloud(null); cloud.dispose(); };
    const { useWorkspaceStore, flushWorkspacePersistence } = await import('@/workspace/store');
    await useWorkspaceStore.persist.rehydrate();
    expect(useWorkspaceStore.getState().projects.private).toBeUndefined();
    const projectId = useWorkspaceStore.getState().createProject('Example project');
    const noteId = useWorkspaceStore.getState().createNote({ projectId, title: 'Example note' });
    await flushWorkspacePersistence();
    const { demoStorage } = await import('./session');
    const saved = JSON.parse(demoStorage.getItem('cellproject-workspace')!);
    expect(saved.state.projects[projectId].name).toBe('Example project');
    expect(saved.state.notes[noteId].title).toBe('Example note');
    expect(await get('cellproject-workspace')).toBe(privateWorkspace);
    expect(cloud.get('cellproject-workspace')).toBe(privateWorkspace);
    expect(getCloudRuntime()).toBeNull();
    expect(isCloudEnabled()).toBe(false);
    expect(network).not.toHaveBeenCalled();
  });

  it('lets visitors reload immediately without a durable-save confirmation', async () => {
    history.replaceState({}, '', '/demo');
    const { useWorkspaceStore, flushWorkspacePersistence } = await import('@/workspace/store');
    await useWorkspaceStore.persist.rehydrate();
    useWorkspaceStore.getState().createProject('Temporary example');
    const event = new Event('beforeunload', { cancelable: true });
    try {
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    } finally { await flushWorkspacePersistence(); }
  });
});

describe('public demo AI and network boundary', () => {
  it('blocks AI for a new project even after a visitor enters a provider key', async () => {
    history.replaceState({}, '', '/demo');
    const { useConfigStore, getActiveConfig, assertAIReady, PROVIDER_DEFAULTS } = await import('@/config/store');
    const { useGraphStore } = await import('@/store');
    await Promise.all([useConfigStore.persist.rehydrate(), useGraphStore.persist.rehydrate()]);
    useGraphStore.getState().resetProject();
    useConfigStore.getState().saveProviderConfig('openrouter', { apiKey: 'example-key', ...PROVIDER_DEFAULTS.openrouter });
    const { aiBlockReason, checkAI } = await import('@/ai/availability');
    const { providerTransport } = await import('@/ai/transport');
    expect(getActiveConfig()).toBeNull();
    expect(aiBlockReason()).toBe('demo');
    expect(checkAI()?.reason).toBe('demo');
    expect(() => assertAIReady()).toThrow(/demonstração/i);
    expect(() => providerTransport('openrouter', 'example-key')).toThrow(/demonstração/i);
  });

  it.each(['/api/cloud/config', '/api/cloud/documents', '/api/ai/openrouter/chat/completions', 'https://example.invalid/'])('rejects %s before invoking fetch', async (url) => {
    history.replaceState({}, '', '/demo');
    const { sessionAwareFetch } = await import('@/cloud/runtime');
    const network = vi.fn(async () => new Response('{}'));
    await expect(sessionAwareFetch(url, { method: 'POST' }, network)).rejects.toThrow(/demonstração/i);
    expect(network).not.toHaveBeenCalled();
  });
});
