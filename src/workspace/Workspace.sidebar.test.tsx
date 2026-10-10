import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { useThemeStore, type Theme } from '@/theme';
import { useWorkspaceStore, flushWorkspacePersistence } from './store';
import { useSidebarStore } from './sidebarPreference';
import { Workspace } from './Workspace';

vi.mock('./planner', () => ({ initializeWorkspace: vi.fn(), connectPlanner: () => () => {}, openPlanner: vi.fn() }));
vi.mock('@/chat/AssistantChat', () => ({ AssistantChat: () => null }));
vi.mock('./Notes', () => ({ Notes: () => <div>Notebook</div> }));

let root: Root;
let host: HTMLDivElement;
let originalTheme: Theme;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ locale: 'en' });
  useSidebarStore.setState({ collapsed: false });
  originalTheme = useThemeStore.getState().theme;
  await useWorkspaceStore.persist.rehydrate();
  useWorkspaceStore.setState({ projects: {}, tasks: {}, sprints: {}, notes: {}, folders: {}, comments: {}, activeProjectId: null, surface: 'projects' });
  useWorkspaceStore.getState().createProject('Sample');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<Workspace planner={null} />); await flushWorkspacePersistence(); });
});
afterEach(() => { act(() => { root.unmount(); useThemeStore.getState().setTheme(originalTheme); }); host.remove(); });

describe('sidebar rail navigation', () => {
  it('opens appearance and AI options from one settings button and keeps the chosen theme', () => {
    const trigger = host.querySelector<HTMLButtonElement>('aside [aria-label="Settings"]')!;
    expect(host.querySelector('aside select')).toBeNull();
    trigger.focus();
    act(() => Simulate.click(trigger));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain('AI settings');
    const appearance = dialog.querySelector<HTMLSelectElement>('select')!;
    expect(appearance.closest('label')?.textContent).toContain('Appearance');
    act(() => { Simulate.change(appearance, { target: { value: 'light' } } as never); });
    expect(useThemeStore.getState().theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    act(() => Simulate.click(trigger));
    expect(document.querySelector<HTMLSelectElement>('[role="dialog"] select')?.value).toBe('light');
  });

  it('keeps labeled project and personal navigation working while collapsed', () => {
    const collapse = host.querySelector<HTMLButtonElement>('[aria-label="Collapse sidebar"]')!;
    act(() => Simulate.click(collapse));
    expect(host.querySelector('aside')?.classList.contains('is-collapsed')).toBe(true);
    expect(host.querySelector('[aria-label="Expand sidebar"]')?.getAttribute('aria-expanded')).toBe('false');
    const kanban = host.querySelector<HTMLButtonElement>('aside [aria-label="Kanban"]')!;
    expect(kanban.title).toContain('Sample');
    act(() => Simulate.click(kanban));
    expect(useWorkspaceStore.getState().surface).toBe('kanban');
    act(() => Simulate.click(host.querySelector('[aria-label="My notes"]')!));
    expect(useWorkspaceStore.getState().surface).toBe('notes');
    expect(host.textContent).toContain('Notebook');
    act(() => Simulate.click(host.querySelector('[aria-label="My projects"]')!));
    expect(useWorkspaceStore.getState().surface).toBe('projects');
    expect(useSidebarStore.getState().collapsed).toBe(true);
    act(() => Simulate.click(host.querySelector('[aria-label="Expand sidebar"]')!));
    expect(host.querySelector('aside')?.classList.contains('is-collapsed')).toBe(false);
  });
});
