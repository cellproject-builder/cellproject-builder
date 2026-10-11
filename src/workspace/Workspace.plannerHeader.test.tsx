import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { useGraphStore } from '@/store';
import { buildDemoProject } from '@/data/demoProject';
import { useChatStore } from '@/chat/store';
import { useChatPresentation } from '@/chat/presentation';
import { TopBar } from '@/components/TopBar';
import { useWorkspaceStore } from './store';
import { Workspace } from './Workspace';

vi.mock('./planner', () => ({ initializeWorkspace: vi.fn(), connectPlanner: () => () => {}, openPlanner: vi.fn() }));
vi.mock('@/chat/AssistantChat', () => ({ AssistantChat: () => null }));
vi.mock('@/components/KnowledgeRepo', () => ({ KnowledgeRepo: () => null }));

let host: HTMLDivElement, root: Root;
const planner = <div className="h-full flex flex-col"><div className="planner-chrome"><TopBar/></div><div className="planner-work-area"/></div>;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useLocaleStore.setState({ locale: 'en' });
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, tasks: {}, sprints: {}, notes: {}, folders: {}, comments: {}, activeProjectId: null });
  useWorkspaceStore.getState().createProject('Synthetic project');
  useWorkspaceStore.getState().navigate('planner');
  useGraphStore.setState({ project: { ...buildDemoProject(), name: 'A separate plan name' }, viewMode: 'graph', lens: 'structure' });
  useChatStore.setState({ open: false }); useChatPresentation.setState({ expanded: false });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Workspace planner={planner}/>));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe('combined planner header', () => {
  it('keeps project navigation and plan controls in one header', () => {
    const header = host.querySelector('.planner-topbar')!;
    expect(header.querySelector('button[title="Synthetic project"]')).not.toBeNull();
    expect(header.querySelector('[aria-label="Navigation"]')).not.toBeNull();
    expect(header.querySelector('[aria-label="More actions"]')).not.toBeNull();
    expect(host.querySelector('.ws-main > .ws-header')).toBeNull();
    expect(header.textContent).not.toContain('A separate plan name');
  });

  it('preserves access to project overview and mobile navigation from the same bar', () => {
    const header = host.querySelector('.planner-topbar')!;
    const menu = header.querySelector<HTMLButtonElement>('[aria-label="Navigation"]')!;
    expect(menu).not.toBeNull();
    act(() => menu.click());
    expect(host.querySelector('#workspace-sidebar')?.classList.contains('is-open')).toBe(true);
    const project = header.querySelector<HTMLButtonElement>('button[title="Synthetic project"]')!;
    act(() => project.click());
    expect(useWorkspaceStore.getState().surface).toBe('overview');
  });

  it('keeps lens selection usable through the compact actions menu', () => {
    act(() => host.querySelector<HTMLButtonElement>('.planner-topbar [aria-label="More actions"]')!.click());
    const flow = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(button => button.textContent?.includes('Flow'))!;
    expect(flow.getAttribute('aria-checked')).toBe('false');
    act(() => flow.click());
    expect(useGraphStore.getState().lens).toBe('flow');
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it('retains navigation before a project has generated its first plan', () => {
    act(() => { useGraphStore.setState({ project: null }); root.render(<Workspace planner={<div>Objective editor</div>}/>); });
    const header = host.querySelector('.ws-main > .ws-header')!;
    expect(header.textContent).toContain('Synthetic project');
    expect(header.querySelector('[aria-label="Navigation"]')).not.toBeNull();
    expect(host.textContent).toContain('Objective editor');
    expect(host.querySelector('.planner-topbar')).toBeNull();
  });
});
