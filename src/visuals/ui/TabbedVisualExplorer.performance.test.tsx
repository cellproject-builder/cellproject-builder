import { act, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { useGraphStore } from '@/store';
import type { VisualExplorerProps } from './VisualExplorer';
import { TabbedVisualExplorer } from './TabbedVisualExplorer';
import { useVisualPopupStore } from './uiStore';
import { useVisualSessionStore } from './sessionStore';
import { useVisualGenerationStore, useVisualSearchStore } from '../controller';
import type { VisualPromptInput, VisualProposal, VisualWorkspace } from '../types';

const profiles = vi.hoisted(() => ({ commits: new Map<string, number>() }));
// The real studio remains mounted; the profiler observes commits without
// replacing its state, effects, composer or request lifecycle with a double.
vi.mock('./VisualExplorer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./VisualExplorer')>();
  return { ...actual, VisualExplorer: (props: VisualExplorerProps) => <Profiler id={props.session!.id} onRender={id => profiles.commits.set(id, (profiles.commits.get(id) ?? 0) + 1)}><actual.VisualExplorer {...props} /></Profiler> };
});

const input = (text: string): VisualPromptInput => ({ text, mentions: [], attachments: [] });
const workspace = (): VisualWorkspace => ({ version: 1, mode: 'approval', artifacts: [], proposals: [], drafts: { search: input(''), model: input('Initial model') } });
const state = () => useVisualSessionStore.getState();
let host: HTMLDivElement;
let root: Root;
let props: VisualExplorerProps;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await useLocaleStore.persist.rehydrate(); useLocaleStore.setState({ locale: 'en' });
  useGraphStore.setState({ project: null });
  state().reset();
  useVisualPopupStore.setState({ request: null, searchOpen: false, modelOpen: true, searchMinimized: false, modelMinimized: false, modelBase: null, inspectedArtifactId: null });
  useVisualGenerationStore.setState({ generation: null }); useVisualSearchStore.setState({ search: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  props = { projectId: 'performance-project', workspace: workspace(), listMentions: () => [], onDraft: vi.fn(), onAttach: vi.fn(), onSearch: vi.fn(), onGenerate: vi.fn(), onAdd: vi.fn(), onApply: vi.fn(), onReject: vi.fn(), onMode: vi.fn(), onMedia: vi.fn(async () => null) };
  await act(async () => root.render(<TabbedVisualExplorer {...props} />));
  profiles.commits.clear();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('visual session rendering isolation', () => {
  it('does not commit inactive studios while typing in another tab', async () => {
    const first = state().windows[0].activeTabId;
    let second!: string;
    let third!: string;
    await act(async () => { second = state().newTab('model', { input: input('Second model') }); third = state().newTab('model', { input: input('Third model') }); });
    const firstComposer = host.querySelector(`[data-visual-tab="${first}"] textarea`);
    profiles.commits.clear();
    await act(async () => state().updateDraft(third, input('Only this request changed')));
    expect(profiles.commits.get(first) ?? 0).toBe(0);
    expect(profiles.commits.get(second) ?? 0).toBe(0);
    expect(profiles.commits.get(third) ?? 0).toBeGreaterThan(0);
    expect(host.querySelector(`[data-visual-tab="${first}"] textarea`)).toBe(firstComposer);
    expect(host.querySelector<HTMLTextAreaElement>(`[data-visual-tab="${third}"] textarea`)!.value).toBe('Only this request changed');
  });

  it('does not commit another visible window when one detached studio changes draft or activity', async () => {
    const first = state().windows[0].activeTabId;
    let second!: string;
    await act(async () => { second = state().newTab('model', { input: input('Detached model') }); state().detach(second); });
    expect([...host.querySelectorAll<HTMLElement>('[data-visual-popup]')].filter(panel => !panel.hidden)).toHaveLength(2);
    profiles.commits.clear();
    await act(async () => state().updateDraft(second, input('Updated detached model')));
    expect(profiles.commits.get(first) ?? 0).toBe(0);
    expect(profiles.commits.get(second) ?? 0).toBeGreaterThan(0);
    profiles.commits.clear();
    await act(async () => state().setActivity(second, { state: 'running', label: 'Building module 2' }));
    expect(profiles.commits.get(first) ?? 0).toBe(0);
  });

  it('does not reinstall studio drafts when only the saved project draft changes', async () => {
    const first = state().windows[0].activeTabId;
    let second!: string;
    await act(async () => { second = state().newTab('model', { input: input('Independent request') }); });
    profiles.commits.clear();
    props.workspace = { ...props.workspace, drafts: { ...props.workspace.drafts, model: input('A saved draft from another tab') } };
    await act(async () => root.render(<TabbedVisualExplorer {...props} />));
    expect(profiles.commits.get(first) ?? 0).toBe(0);
    expect(profiles.commits.get(second) ?? 0).toBe(0);
    expect(host.querySelector<HTMLTextAreaElement>(`[data-visual-tab="${first}"] textarea`)!.value).toBe('Initial model');
    expect(host.querySelector<HTMLTextAreaElement>(`[data-visual-tab="${second}"] textarea`)!.value).toBe('Independent request');
  });

  it('keeps a hidden studio request alive and resumes its result after unrelated tab updates', async () => {
    let finish!: (proposal: VisualProposal) => void;
    let signal!: AbortSignal;
    props.onGenerate = vi.fn((_input, value) => { signal = value; return new Promise<VisualProposal>(resolve => { finish = resolve; }); });
    await act(async () => root.render(<TabbedVisualExplorer {...props} />));
    const first = state().windows[0].activeTabId;
    const firstPanel = host.querySelector<HTMLElement>(`[data-visual-tab="${first}"]`)!;
    const composer = firstPanel.querySelector('textarea');
    await act(async () => firstPanel.querySelector<HTMLButtonElement>('button[aria-label="Generate model"]')!.click());
    let second!: string;
    await act(async () => { second = state().newTab('model', { input: input('Other work') }); });
    await act(async () => state().updateDraft(second, input('Other work changed')));
    expect(firstPanel.hidden).toBe(true); expect(signal.aborted).toBe(false);
    await act(async () => finish({ id: 'background-result', projectId: props.projectId, label: 'Finished initial model', status: 'ready', scene: { version: 1, label: 'Initial model', objects: [] }, input: input('Initial model'), contextFingerprint: 'v1', createdAt: 1 }));
    await act(async () => state().activate(first));
    expect(firstPanel.querySelector('textarea')).toBe(composer);
    expect(firstPanel.textContent).toContain('Finished initial model');
    expect(signal.aborted).toBe(false); expect(props.onGenerate).toHaveBeenCalledOnce();
  });
});
