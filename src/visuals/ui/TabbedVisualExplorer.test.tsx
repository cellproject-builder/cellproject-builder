import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { useGraphStore } from '@/store';
import type { VisualExplorerProps } from './VisualExplorer';
import { TabbedVisualExplorer as VisualExplorer } from './TabbedVisualExplorer';
import { useVisualPopupStore } from './uiStore';
import { useVisualSessionStore } from './sessionStore';
import type { MentionTarget, VisualArtifact, VisualProposal, VisualWorkspace } from '../types';
import { useVisualGenerationStore, useVisualSearchStore } from '../controller';
const proposal = (id: string, text = id): VisualProposal => ({ id, projectId: 'tabs-project', label: text, status: 'ready', scene: { version: 1, label: text, objects: [] }, input: { text, mentions: [], attachments: [] }, contextFingerprint: 'v1', createdAt: 1 });
vi.mock('./DecompositionPanel', () => ({ DecompositionPanel: ({ artifactId }: { artifactId: string }) => <div data-component-inspector={artifactId} /> }));
const artifact = (id: string, kind: 'model' | 'image' = 'model'): VisualArtifact => ({ id, label: id, kind, x: 0, y: 0, width: 200, height: 150, mediaId: null, scene: kind === 'model' ? { version: 1, label: id, objects: [] } : null, source: null, revisions: [], revisionIndex: 0 });
const graphProject = (id: string) => ({ id, name: id, objective: '', createdAt: 1, updatedAt: 1, rootId: '', nodes: {}, edges: {} });

let host: HTMLDivElement, root: Root, props: VisualExplorerProps;
const workspace = (): VisualWorkspace => ({ version: 1, mode: 'approval', artifacts: [], proposals: [], drafts: { search: { text: '', mentions: [], attachments: [] }, model: { text: '', mentions: [], attachments: [] } } });
const visible = () => [...host.querySelectorAll<HTMLElement>('[data-visual-popup]')].filter(el => !el.hidden);
const named = (panel: Element, name: string) => [...panel.querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('aria-label') === name || b.getAttribute('aria-label')?.startsWith(`${name}: `) || b.textContent?.trim() === name)!;
async function click(panel: Element, name: string) { await act(async () => named(panel, name).click()); }
async function write(panel: Element, value: string) {
  const input = panel.querySelector('textarea')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await useLocaleStore.persist.rehydrate(); useLocaleStore.setState({ locale: 'en' });
  useGraphStore.setState({ project: null });
  useVisualPopupStore.setState({ request: null, searchOpen: false, modelOpen: true, searchMinimized: false, modelMinimized: false, modelBase: null, inspectedArtifactId: null });
  useVisualGenerationStore.setState({ generation: null });
  useVisualSearchStore.setState({ search: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  props = { projectId: 'tabs-project', workspace: workspace(), listMentions: () => [], onDraft: vi.fn(), onAttach: vi.fn(), onSearch: vi.fn(), onGenerate: vi.fn(), onAdd: vi.fn(), onApply: vi.fn(), onReject: vi.fn(), onMode: vi.fn(), onMedia: vi.fn(async () => null) };
  await act(async () => root.render(<VisualExplorer {...props} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('independent visual studio tabs', () => {
  it('preselects the captured canvas node and can search it without text', async () => {
    const node: MentionTarget = { id: 'electronics', kind: 'node', label: 'ESP32, PCA9685 e USB serial', detail: 'Recurso', fingerprint: 'v1' };
    props.onSearch = vi.fn(async () => []);
    await act(async () => { root.render(<VisualExplorer {...props} />); useVisualPopupStore.getState().open('search', { text: '', mentions: [node], attachments: [] }); });
    const panel = visible().find(panel => panel.dataset.visualPopup === 'search')!;
    expect(panel.querySelector('.visual-chip')?.textContent).toContain(node.label);
    expect(named(panel, 'Search').disabled).toBe(false);
    await click(panel, 'Search');
    expect(props.onSearch).toHaveBeenCalledWith(expect.objectContaining({ text: '', mentions: [node] }), expect.any(AbortSignal), expect.any(Function));
  });

  it('opens an unlinked search after deselection while preserving the previous draft in its tab', async () => {
    const node: MentionTarget = { id: 'electronics', kind: 'node', label: 'Electronics', detail: 'Resource', fingerprint: 'v1' };
    await act(async () => useVisualPopupStore.getState().open('search', { text: '', mentions: [node], attachments: [] }));
    const first = visible().find(panel => panel.dataset.visualPopup === 'search')!;
    await write(first, 'Keep this draft');
    await click(first, 'Close image search');
    await act(async () => useVisualPopupStore.getState().open('search', { text: '', mentions: [], attachments: [] }));
    const panel = visible().find(panel => panel.dataset.visualPopup === 'search')!;
    expect(panel.querySelector('.visual-chip')).toBeNull();
    expect(named(panel, 'Search').disabled).toBe(true);
    await act(async () => panel.querySelectorAll<HTMLButtonElement>('[role="tab"]')[0].click());
    expect(visible().find(panel => panel.dataset.visualPopup === 'search')!.querySelector('textarea')?.value).toBe('Keep this draft');
  });

  it('uses current selection only for new search tabs and never rewrites a tab being edited', async () => {
    const node: MentionTarget = { id: 'a', kind: 'node', label: 'Node A', detail: 'Resource', fingerprint: 'v1' };
    props.selectedNode = node;
    await act(async () => { root.render(<VisualExplorer {...props} />); useVisualPopupStore.getState().open('search', { text: '', mentions: [node], attachments: [] }); });
    let panel = visible().find(panel => panel.dataset.visualPopup === 'search')!;
    await write(panel, 'My draft');
    props.selectedNode = { ...node, id: 'b', label: 'Node B' };
    await act(async () => root.render(<VisualExplorer {...props} />));
    expect(panel.querySelector('.visual-chip')?.textContent).toContain('Node A');
    await click(panel, 'New tab');
    panel = visible().find(panel => panel.dataset.visualPopup === 'search')!;
    expect(panel.querySelector('.visual-chip')?.textContent).toContain('Node B');
    expect(panel.querySelector('textarea')?.value).toBe('');
  });

  it('opens a captured selection requested before mount in exactly one search tab', async () => {
    const node: MentionTarget = { id: 'selected', kind: 'node', label: 'Selected component', detail: 'Resource', fingerprint: 'v1' };
    await act(async () => {
      useGraphStore.setState({ project: graphProject('next-project') });
      useVisualPopupStore.getState().open('search', { text: '', mentions: [node], attachments: [] });
      root.render(<VisualExplorer {...props} projectId="next-project" workspace={workspace()} />);
    });
    const panel = visible().find(panel => panel.dataset.visualPopup === 'search')!;
    expect(panel.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(panel.querySelector('.visual-chip')?.textContent).toContain(node.label);
  });

  it('offers integrated tabs and starts a fresh request without overwriting the first', async () => {
    const first = visible()[0];
    expect(first.querySelector('[role="tablist"]')).not.toBeNull();
    await write(first, 'Arduino board');
    await click(first, 'New tab');
    expect(visible()).toHaveLength(1);
    expect(visible()[0].querySelector('textarea')?.value).toBe('');
    await write(visible()[0], 'MG90S servo');
    const tabs = visible()[0].querySelectorAll<HTMLButtonElement>('[role="tab"]');
    await act(async () => tabs[0].click());
    expect(visible()[0].querySelector('textarea')?.value).toBe('Arduino board');
  });

  it('keeps three requests alive and routes out-of-order results to their own tabs', async () => {
    const jobs: Array<{ text: string; signal: AbortSignal; finish: (value: VisualProposal) => void }> = [];
    props.onGenerate = vi.fn((input, signal) => new Promise<VisualProposal>(resolve => jobs.push({ text: input.text, signal, finish: resolve })));
    await act(async () => root.render(<VisualExplorer {...props} />));
    for (const [i, text] of ['Board', 'Servo', 'Joint'].entries()) {
      if (i) await click(visible()[0], 'New tab');
      await write(visible()[0], text); await click(visible()[0], 'Generate model');
    }
    expect(jobs).toHaveLength(3); expect(jobs.every(job => !job.signal.aborted)).toBe(true);
    for (const index of [1, 2, 0]) await act(async () => jobs[index].finish({ id: `result-${index}`, projectId: props.projectId, label: `Finished ${jobs[index].text}`, scene: { version: 1, label: jobs[index].text, objects: [] }, status: 'ready', input: { text: jobs[index].text, mentions: [], attachments: [] }, contextFingerprint: 'v1', createdAt: index }));
    for (let i = 0; i < 3; i++) {
      await act(async () => visible()[0].querySelectorAll<HTMLButtonElement>('[role="tab"]')[i].click());
      expect(visible()[0].querySelector('.visual-proposals')?.textContent).toContain(`Finished ${jobs[i].text}`);
      expect(visible()[0].querySelectorAll('.visual-proposal')).toHaveLength(1);
    }
  });

  it('detaches and rejoins a running tab without remounting or cancelling its request', async () => {
    let signal!: AbortSignal;
    props.onGenerate = vi.fn((_input, value) => { signal = value; return new Promise<VisualProposal>(() => {}); });
    await act(async () => root.render(<VisualExplorer {...props} />));
    await write(visible()[0], 'A servo'); await click(visible()[0], 'Generate model');
    const originalInput = visible()[0].querySelector('textarea');
    await click(visible()[0], 'New tab');
    await act(async () => visible()[0].querySelectorAll<HTMLButtonElement>('[role="tab"]')[0].click());
    await click(visible()[0], 'Detach tab');
    expect(visible()).toHaveLength(2); expect(signal.aborted).toBe(false);
    expect([...host.querySelectorAll('textarea')]).toContain(originalInput);
    expect(props.onGenerate).toHaveBeenCalledOnce();
    const detached = visible().find(panel => panel.contains(originalInput))!;
    const destination = visible().find(panel => panel !== detached)!.querySelector<HTMLElement>('.visual-popup-tabs')!;
    const previousHit = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => destination });
    const pointer = (target: EventTarget, type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
      Object.defineProperty(event, 'pointerId', { value: 1 }); target.dispatchEvent(event);
    };
    await act(async () => pointer(detached.querySelector('[role="tab"]')!, 'pointerdown', 10, 10));
    await act(async () => pointer(window, 'pointermove', 200, 200));
    await act(async () => pointer(window, 'pointerup', 200, 200));
    if (previousHit) Object.defineProperty(document, 'elementFromPoint', previousHit); else delete (document as Partial<Document>).elementFromPoint;
    expect(visible()).toHaveLength(1); expect(visible()[0].querySelector('textarea')).toBe(originalInput);
    expect(signal.aborted).toBe(false); expect(props.onGenerate).toHaveBeenCalledOnce();
  });

  it('preserves work when its window is closed and cancels only the explicit stop action', async () => {
    let signal!: AbortSignal;
    props.onGenerate = vi.fn((_input, value) => { signal = value; return new Promise<VisualProposal>(() => {}); });
    await act(async () => root.render(<VisualExplorer {...props} />));
    await write(visible()[0], 'A motor'); await click(visible()[0], 'Generate model');
    await click(visible()[0], 'Close 3D studio');
    expect(visible()).toHaveLength(0); expect(signal.aborted).toBe(false);
    await click(host, 'Restore 3D studio'); await click(visible()[0], 'Cancel');
    expect(signal.aborted).toBe(true);
  });

  it('shows saved project proposals when the studio is opened after starting closed', async () => {
    await act(async () => useVisualPopupStore.getState().close('model'));
    const saved = proposal('saved', 'Saved board'); saved.projectId = 'reopened-project';
    await act(async () => root.render(<VisualExplorer {...props} projectId="reopened-project" workspace={{ ...workspace(), proposals: [saved] }} />));
    expect(visible()).toHaveLength(0);
    await act(async () => useVisualPopupStore.getState().open('model'));
    expect(visible()[0].querySelector('.visual-proposals')?.textContent).toContain('Saved board');
  });

  it('retains earlier proposals from another generation in the same tab', async () => {
    props.onGenerate = vi.fn(async input => proposal(input.text, `Finished ${input.text}`));
    await act(async () => root.render(<VisualExplorer {...props} />));
    await write(visible()[0], 'Board'); await click(visible()[0], 'Generate model');
    await write(visible()[0], 'Servo'); await click(visible()[0], 'Generate model');
    expect(visible()[0].querySelectorAll('.visual-proposal')).toHaveLength(2);
    expect(visible()[0].querySelector('.visual-proposals')?.textContent).toContain('Finished Board');
  });

  it('opens a chat-generated proposal in its own tab without replacing a running request', async () => {
    let signal!: AbortSignal;
    props.onGenerate = vi.fn((_input, value) => { signal = value; return new Promise<VisualProposal>(() => {}); });
    await act(async () => root.render(<VisualExplorer {...props} />));
    await write(visible()[0], 'My ongoing board'); await click(visible()[0], 'Generate model');
    const fromChat = proposal('from-chat', 'Chat servo');
    props.workspace = { ...props.workspace, proposals: [fromChat] };
    await act(async () => {
      root.render(<VisualExplorer {...props} />);
      useVisualGenerationStore.setState({ generation: { id: 'handoff', proposal: fromChat } });
    });
    expect(visible()[0].querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(visible()[0].querySelector('.visual-proposals')?.textContent).toContain('Chat servo');
    expect(signal.aborted).toBe(false);
    await act(async () => visible()[0].querySelectorAll<HTMLButtonElement>('[role="tab"]')[0].click());
    expect(visible()[0].querySelector('textarea')?.value).toBe('My ongoing board');
  });

  it('keeps image searches independent and preserves the results behind another search tab', async () => {
    await act(async () => { useVisualPopupStore.getState().close('model'); useVisualPopupStore.getState().open('search'); });
    const jobs: Array<{ text: string; signal: AbortSignal; finish: (value: import('../types').ImageReference[]) => void }> = [];
    props.onSearch = vi.fn((input, signal) => new Promise<import('../types').ImageReference[]>(resolve => jobs.push({ text: input.text, signal, finish: resolve })));
    await act(async () => root.render(<VisualExplorer {...props} />));
    for (const [i, text] of ['Arduino', 'Servo', 'USB cable'].entries()) {
      if (i) await click(visible()[0], 'New tab');
      await write(visible()[0], text); await click(visible()[0], 'Search');
    }
    expect(jobs).toHaveLength(3); expect(jobs.every(job => !job.signal.aborted)).toBe(true);
    for (const index of [2, 0, 1]) await act(async () => jobs[index].finish([{ id: `${index}`, title: `Photo ${jobs[index].text}`, imageUrl: `https://example.com/${index}.png`, sourcePageUrl: 'https://example.com/', description: '', credit: null, license: null, width: 200, height: 200 }]));
    for (let i = 0; i < 3; i++) {
      await act(async () => visible()[0].querySelectorAll<HTMLButtonElement>('[role="tab"]')[i].click());
      expect(visible()[0].querySelector('.visual-gallery')?.textContent ?? visible()[0].textContent).toContain(`Photo ${jobs[i].text}`);
    }
  });

  it('preserves every chat generation when results arrive in the same render batch', async () => {
    const first = proposal('chat-first', 'First chat model');
    const second = proposal('chat-second', 'Second chat model');
    props.workspace = { ...props.workspace, proposals: [first, second] };
    await act(async () => {
      root.render(<VisualExplorer {...props} />);
      useVisualGenerationStore.setState({ generation: { id: 'handoff-first', proposal: first } });
      useVisualGenerationStore.setState({ generation: { id: 'handoff-second', proposal: second } });
    });
    const tabs = visible()[0].querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs).toHaveLength(3);
    expect([...tabs].map(tab => tab.getAttribute('aria-label')?.split(' · ')[0])).toEqual(['New model', 'First chat model', 'Second chat model']);
  });

  it('preserves every chat image search when results arrive in the same render batch', async () => {
    await act(async () => {
      for (const [i, text] of ['Arduino', 'Servo'].entries()) {
        useVisualSearchStore.setState({ search: { id: `chat-search-${i}`, projectId: props.projectId, input: { text, mentions: [], attachments: [] }, results: [] } });
      }
      props.externalSearch = useVisualSearchStore.getState().search;
      root.render(<VisualExplorer {...props} />);
    });
    const search = visible().find(panel => panel.getAttribute('data-visual-popup') === 'search')!;
    expect(search).toBeDefined();
    expect([...search.querySelectorAll('[role="tab"]')].map(tab => tab.getAttribute('aria-label')?.split(' · ')[0])).toEqual(['Arduino', 'Servo']);
  });

  it('does not replay a consumed chat generation after closing and remounting the canvas', async () => {
    const fromChat = proposal('remount-generated', 'Previous model');
    await act(async () => useVisualGenerationStore.setState({ generation: { id: 'remount-generated-publication', proposal: fromChat } }));
    await act(async () => useVisualPopupStore.getState().close('model'));
    expect(visible()).toHaveLength(0);
    await act(async () => root.render(null));
    await act(async () => root.render(<VisualExplorer {...props} />));
    expect(visible()).toHaveLength(0);
    await act(async () => useVisualGenerationStore.setState({ generation: { id: 'fresh-generated-publication', proposal: proposal('fresh-model') } }));
    expect(visible()).toHaveLength(1);
    expect(visible()[0].querySelectorAll('[role="tab"]')).toHaveLength(1);
  });

  it('does not replay a consumed image search through either its store or props after returning', async () => {
    const search = { id: 'remount-search-publication', projectId: props.projectId, input: { text: 'Previous image', mentions: [], attachments: [] }, results: [] };
    await act(async () => {
      useVisualSearchStore.setState({ search });
      props.externalSearch = search;
      root.render(<VisualExplorer {...props} />);
    });
    await act(async () => { useVisualPopupStore.getState().close('model'); useVisualPopupStore.getState().close('search'); });
    await act(async () => root.render(null));
    await act(async () => root.render(<VisualExplorer {...props} />));
    expect(visible()).toHaveLength(0);
    await act(async () => useVisualSearchStore.setState({ search: { ...search, id: 'fresh-search-publication', input: { ...search.input, text: 'Fresh image' } } }));
    expect(visible()).toHaveLength(1);
    expect(visible()[0].querySelectorAll('[role="tab"]')).toHaveLength(1);
  });

  it('opens an inspector requested before the canvas mounts, exactly once', async () => {
    await act(async () => root.render(null));
    props.workspace.artifacts = [artifact('pending-inspector')];
    useGraphStore.setState({ project: graphProject(props.projectId) });
    useVisualPopupStore.getState().inspectArtifact('pending-inspector');
    await act(async () => root.render(<VisualExplorer {...props} />));
    expect(Object.values(useVisualSessionStore.getState().tabs).map(tab => tab.inspectedArtifactId)).toEqual(['pending-inspector']);
    await act(async () => root.render(<VisualExplorer {...props} />));
    expect(Object.values(useVisualSessionStore.getState().tabs)).toHaveLength(1);
  });

  it('persists an image handoff so its reference survives leaving and reopening the canvas', async () => {
    await act(async () => root.render(null));
    const image = artifact('pending-base', 'image');
    const target: MentionTarget = { id: image.id, kind: 'image', label: 'ESP32 reference', detail: '', fingerprint: 'v1' };
    props.workspace.artifacts = [image]; props.listMentions = () => [target];
    props.onDraft = vi.fn<VisualExplorerProps['onDraft']>((kind, input) => { props.workspace.drafts[kind] = input; });
    useGraphStore.setState({ project: graphProject(props.projectId) });
    useVisualPopupStore.getState().useAsBase(target);
    await act(async () => root.render(<VisualExplorer {...props} />));
    expect(Object.values(useVisualSessionStore.getState().tabs).map(tab => tab.draft.mentions)).toEqual([[target]]);
    expect(visible()[0].textContent).toContain('ESP32 reference');
    expect(props.onDraft).toHaveBeenCalledExactlyOnceWith('model', { text: '', mentions: [target], attachments: [] });
    await act(async () => root.render(null));
    await act(async () => root.render(<VisualExplorer {...props} />));
    expect(Object.values(useVisualSessionStore.getState().tabs).map(tab => tab.draft.mentions)).toEqual([[target]]);
    expect(visible()[0].textContent).toContain('ESP32 reference');
  });

  it('holds a pending inspector for its project instead of applying it to another project', async () => {
    await act(async () => root.render(null));
    const source = { ...props, projectId: 'pending-source-project', workspace: { ...workspace(), artifacts: [artifact('shared-artifact-id')] } };
    const other = { ...props, projectId: 'pending-other-project', workspace: { ...workspace(), artifacts: [artifact('shared-artifact-id')] } };
    useGraphStore.setState({ project: graphProject(source.projectId) });
    useVisualPopupStore.getState().inspectArtifact('shared-artifact-id');
    useGraphStore.setState({ project: graphProject(other.projectId) });
    await act(async () => root.render(<VisualExplorer {...other} />));
    expect(Object.values(useVisualSessionStore.getState().tabs).every(tab => !tab.inspectedArtifactId)).toBe(true);
    useGraphStore.setState({ project: graphProject(source.projectId) });
    await act(async () => root.render(<VisualExplorer {...source} />));
    expect(Object.values(useVisualSessionStore.getState().tabs).map(tab => tab.inspectedArtifactId)).toEqual(['shared-artifact-id']);
    await act(async () => useVisualPopupStore.getState().close('model'));
    await act(async () => root.render(<VisualExplorer {...other} />));
    await act(async () => root.render(<VisualExplorer {...source} />));
    expect(visible()).toHaveLength(0);
  });

  it('consumes a pre-mount generation only in its project and remembers consumption across project switches', async () => {
    await act(async () => root.render(null));
    useVisualPopupStore.setState({ request: null, modelOpen: false });
    const fromChat = { ...proposal('pending-project-generation'), projectId: 'generation-source-project' };
    useVisualGenerationStore.setState({ generation: { id: 'pending-project-publication', proposal: fromChat } });
    const other = { ...props, projectId: 'generation-other-project', workspace: workspace() };
    const source = { ...props, projectId: fromChat.projectId, workspace: { ...workspace(), proposals: [fromChat] } };
    await act(async () => root.render(<VisualExplorer {...other} />));
    expect(visible()).toHaveLength(0);
    await act(async () => root.render(<VisualExplorer {...source} />));
    expect(visible()).toHaveLength(1);
    await act(async () => useVisualPopupStore.getState().close('model'));
    await act(async () => root.render(<VisualExplorer {...other} />));
    await act(async () => root.render(<VisualExplorer {...source} />));
    expect(visible()).toHaveLength(0);
  });

  it.each(['inspect', 'base', 'generation'] as const)('retains a pending %s handoff through StrictMode effect replay', async kind => {
    await act(async () => root.render(null));
    useGraphStore.setState({ project: graphProject(props.projectId) });
    useVisualPopupStore.setState({ request: null, modelOpen: false });
    const id = `strict-pending-${kind}`;
    if (kind === 'generation') {
      const result = proposal(id, 'Strict pending model');
      props.workspace.proposals = [result];
      useVisualGenerationStore.setState({ generation: { id, proposal: result } });
    } else if (kind === 'inspect') {
      props.workspace.artifacts = [artifact(id)];
      useVisualPopupStore.getState().inspectArtifact(id);
    } else {
      const target: MentionTarget = { id, kind: 'image', label: 'Strict pending image', detail: '', fingerprint: 'v1' };
      props.workspace.artifacts = [artifact(id, 'image')]; props.listMentions = () => [target];
      useVisualPopupStore.getState().useAsBase(target);
    }
    await act(async () => root.render(<StrictMode><VisualExplorer {...props} /></StrictMode>));
    const tabs = Object.values(useVisualSessionStore.getState().tabs);
    expect(tabs).toHaveLength(1);
    if (kind === 'inspect') expect(tabs[0].inspectedArtifactId).toBe(id);
    else if (kind === 'base') expect(tabs[0].draft.mentions[0]?.id).toBe(id);
    else {
      expect(tabs[0].draft.text).toBe('Strict pending model');
      expect(visible()[0].querySelector('.visual-proposals')?.textContent).toContain('Strict pending model');
    }
    await act(async () => useVisualPopupStore.getState().close('model'));
    await act(async () => root.render(null));
    await act(async () => root.render(<StrictMode><VisualExplorer {...props} /></StrictMode>));
    expect(visible()).toHaveLength(0);
  });
});
