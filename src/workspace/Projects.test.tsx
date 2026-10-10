import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { EMPTY_OBJECTIVE_DRAFT, useGraphStore } from '@/store';
import { registerAIAction } from '@/ai/actions';
import { capturePlanner, initializeWorkspace, openPlanner } from './planner';
import { flushWorkspacePersistence, useWorkspaceStore as workspace } from './store';
import { Projects } from './Projects';

let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await Promise.all([workspace.persist.rehydrate(), useGraphStore.persist.rehydrate()]);
  useLocaleStore.setState({ locale: 'en' });
  workspace.setState({ projects: {}, tasks: {}, sprints: {}, notes: {}, folders: {}, comments: {}, activeProjectId: null, surface: 'projects', legacyImported: true });
  useGraphStore.setState({ project: null, archivedProject: null, aiJobs: {}, drafts: {}, pendingSuggestions: null, objectiveDraft: { ...EMPTY_OBJECTIVE_DRAFT } });
  initializeWorkspace();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => { root.unmount(); await flushWorkspacePersistence(); }); host.remove(); });
const render = async () => { await act(async () => { root.render(<Projects />); }); };

describe('starting and reopening a plan', () => {
  it('opens the selected project in its own saved planner draft', async () => {
    const first = workspace.getState().createProject('First');
    const second = workspace.getState().createProject('Second', 'Understand how a motor works');
    openPlanner(second);
    useGraphStore.getState().setObjectiveDraft({ objective: 'Saved investigation', rules: ['Use measurements'] });
    workspace.getState().savePlanner(second, capturePlanner());
    openPlanner(first);
    workspace.getState().navigate('projects');
    await render();
    act(() => Simulate.click([...host.querySelectorAll<HTMLButtonElement>('.ws-project-card')].find((card) => card.textContent?.includes('Second'))!));
    expect(workspace.getState().activeProjectId).toBe(second);
    expect(workspace.getState().surface).toBe('planner');
    expect(useGraphStore.getState().objectiveDraft).toMatchObject({ objective: 'Saved investigation', rules: ['Use measurements'] });
  });

  it('keeps the current project and draft when an AI action blocks switching', async () => {
    const first = workspace.getState().createProject('First');
    workspace.getState().createProject('Second');
    openPlanner(first);
    workspace.getState().selectProject(first);
    useGraphStore.getState().setObjectiveDraft({ objective: 'Work in progress' });
    workspace.getState().navigate('projects');
    await render();
    const finish = registerAIAction();
    try {
      act(() => Simulate.click([...host.querySelectorAll<HTMLButtonElement>('.ws-project-card')].find((card) => card.textContent?.includes('Second'))!));
      expect(workspace.getState().activeProjectId).toBe(first);
      expect(workspace.getState().surface).toBe('projects');
      expect(useGraphStore.getState().objectiveDraft.objective).toBe('Work in progress');
    } finally { finish(); }
  });

  it('starts from an objective without requiring a separate project name', async () => {
    await render();
    act(() => Simulate.click(host.querySelector<HTMLButtonElement>('.ws-page-header-actions button')!));
    const form = document.querySelector<HTMLFormElement>('[role="dialog"] form')!;
    const objective = form.querySelector<HTMLTextAreaElement>('textarea')!;
    act(() => Simulate.change(objective, { target: { value: 'Understand gear ratios' } } as never));
    act(() => Simulate.submit(form));
    const saved = Object.values(workspace.getState().projects);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: 'Understand gear ratios', objective: 'Understand gear ratios' });
    expect(workspace.getState().surface).toBe('planner');
    expect(useGraphStore.getState().objectiveDraft.objective).toBe('Understand gear ratios');
  });

  it('lets the user review the robot study before creating it and carries its constraints into the planner', async () => {
    await render();
    const startStudy = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Prepare the robot study');
    expect(startStudy).toBeTruthy();
    act(() => Simulate.click(startStudy!));
    expect(Object.values(workspace.getState().projects)).toHaveLength(0);
    const form = document.querySelector<HTMLFormElement>('[role="dialog"] form')!;
    expect(form.querySelector<HTMLTextAreaElement>('textarea')!.value).toContain('two-arm robot');
    act(() => Simulate.change(form.querySelector<HTMLInputElement>('input')!, { target: { value: 'Robot investigation' } } as never));
    act(() => Simulate.submit(form));
    expect(Object.values(workspace.getState().projects)).toHaveLength(1);
    expect(workspace.getState().surface).toBe('planner');
    expect(useGraphStore.getState().objectiveDraft.name).toBe('Robot investigation');
    expect(useGraphStore.getState().objectiveDraft.rules).toEqual(expect.arrayContaining([
      expect.stringContaining('measured or documented dimensions'),
      expect.stringContaining('before each trial'),
    ]));
    expect(useGraphStore.getState().project).toBeNull();
  });

  it('does not create a robot study or replace the current draft while another AI action is running', async () => {
    await render();
    const startStudy = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Prepare the robot study');
    expect(startStudy).toBeTruthy();
    act(() => Simulate.click(startStudy!));
    useGraphStore.getState().setObjectiveDraft({ objective: 'Existing draft', rules: ['Keep this rule'] });
    const finish = registerAIAction();
    try {
      act(() => Simulate.submit(document.querySelector<HTMLFormElement>('[role="dialog"] form')!));
      expect(Object.values(workspace.getState().projects)).toHaveLength(0);
      expect(useGraphStore.getState().objectiveDraft).toMatchObject({ objective: 'Existing draft', rules: ['Keep this rule'] });
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    } finally { finish(); }
  });
});
