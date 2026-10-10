import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import App from './App';
import { useLocaleStore } from '@/i18n';
import { useConfigStore } from '@/config/store';
import { EMPTY_OBJECTIVE_DRAFT, useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { initializeWorkspace, openPlanner } from '@/workspace/planner';

it('lets a user describe the objective before configuring an AI provider', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await Promise.all([useGraphStore.persist.rehydrate(), useConfigStore.persist.rehydrate(), useLocaleStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  useLocaleStore.setState({ locale: 'en' });
  useConfigStore.setState({ activeProvider: null, providers: {} });
  useGraphStore.setState({ project: null, archivedProject: null, aiJobs: {}, objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT } });
  useWorkspaceStore.setState({ projects: {}, activeProjectId: null, surface: 'projects', legacyImported: true });
  initializeWorkspace();
  const id = useWorkspaceStore.getState().createProject('Mechanism', 'Understand electric motors');
  openPlanner(id);
  useWorkspaceStore.getState().navigate('planner');
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => { root.render(<App />); });
    const objective = host.querySelector<HTMLTextAreaElement>('.ws-content textarea');
    expect(objective?.value).toBe('Understand electric motors');
    expect(objective?.disabled).toBe(false);
    expect(document.querySelector('input[type="password"]')).toBeNull();
  } finally {
    await act(async () => { root.unmount(); }); host.remove();
  }
});
