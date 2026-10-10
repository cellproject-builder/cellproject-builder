import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AUDIO_MODEL, transcribeAudio } from '@/audio/transcription';
import { hasActiveDataIngestions } from '@/cloud/activity';
import { t, useLocaleStore } from '@/i18n';
import { useGraphStore } from '@/store';
import type { ConceptNodeData, Project } from '@/types';
import { DetailPanel } from './DetailPanel';
import { FailureSection, GroundTruthInlineTutor, GroundTruthRefsList } from './GroundTruth';

// Exercise the real fields, popup, React events and store. Only paid STT is replaced.
vi.mock('@/audio/transcription', async () => ({
  ...await vi.importActual('@/audio/limits'), transcribeAudio: vi.fn(),
}));

let host: HTMLDivElement, root: Root, project: Project, node: ConceptNodeData;
const transcript = 'Text dictated in project A.';
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ locale: 'en' });
  const NativeURL = URL;
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = vi.fn(() => 'blob:project-a-audio');
    static revokeObjectURL = vi.fn();
  });
  vi.mocked(transcribeAudio).mockReset().mockResolvedValue({ text: transcript, model: DEFAULT_AUDIO_MODEL });
  node = {
    id: 'shared-node', parentId: 'root', order: 0, kind: 'passo', name: 'Same task',
    fx: '', problem: '', confidence: 50, pros: [], cons: [], oQue: '', porQue: '',
    comoConfirmar: '', confirmado: false, state: 'concept', notes: '', history: [],
    aiSuggested: false, position: { x: 0, y: 0 },
    groundTruthRefs: [{ id: 'shared-proof', kind: 'spec', label: 'Same proof', value: 'Same specification', verificado: false, addedAt: 1, addedByAI: false }],
  };
  project = makeProject('project-A');
  useGraphStore.setState({ project, selectedNodeId: node.id, detailPanelOpen: true, drafts: {}, pendingSuggestions: null, parkedSuggestions: {}, aiJobs: {}, lastAction: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  expect(hasActiveDataIngestions()).toBe(false);
});

function makeProject(id: string): Project {
  return {
    id, rootId: 'root', name: id, objective: 'Synthetic objective', archetype: 'construir',
    createdAt: 0, updatedAt: 0, edges: {}, rules: [],
    nodes: { root: { ...node, id: 'root', parentId: null, kind: 'root' }, [node.id]: node },
  };
}
function switchProject() {
  project = makeProject('project-B');
  act(() => useGraphStore.setState({ project, selectedNodeId: node.id, drafts: {}, pendingSuggestions: null, aiJobs: {} }));
}
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
async function importAudio(field: HTMLInputElement | HTMLTextAreaElement) {
  act(() => field.closest('.audio-field')!.querySelector<HTMLButtonElement>('.audio-field-mic')!.click());
  const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
  const file = new File(['RIFF0000WAVEdata'], 'synthetic.wav', { type: 'audio/wav' });
  act(() => { Object.defineProperty(input, 'files', { value: [file], configurable: true }); input.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function transcribe() { await act(async () => button('Transcribe audio').click()); }
function expectDiscarded() {
  expect(host.querySelector('[role=dialog]')).toBeNull();
  expect(hasActiveDataIngestions()).toBe(false);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:project-a-audio');
  expect(useGraphStore.getState().drafts).toEqual({});
  expect(useGraphStore.getState().project?.id).toBe('project-B');
}

describe('GroundTruth audio project identity', () => {
  it.each(['criterion', 'failure', 'proof-label', 'proof-observation'] as const)(
    'discards prepared %s audio when projects reuse node/proof IDs and an empty baseline', async kind => {
      const render = () => act(() => root.render(kind === 'criterion'
        ? <GroundTruthInlineTutor node={node} project={project} />
        : kind === 'failure' ? <FailureSection node={node} project={project} />
          : <GroundTruthRefsList node={node} project={project} />));
      render();
      if (kind === 'failure') act(() => host.querySelector<HTMLButtonElement>('section button')!.click());
      if (kind === 'proof-label') act(() => [...host.querySelectorAll('button')].find(item => item.textContent?.includes(t().groundTruth.addAnchor))!.click());
      if (kind === 'proof-observation') act(() => host.querySelector<HTMLButtonElement>('[role=checkbox]')!.click());
      const selector = kind === 'criterion' ? '[name=user-criterion]' : kind === 'failure' ? '[name=failure-context]'
        : kind === 'proof-label' ? '[name=proof-label]' : '#gt-verify-shared-proof';
      const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
      expect(field.value).toBe('');
      await importAudio(field); await transcribe();
      expect(host.querySelector<HTMLTextAreaElement>('[data-audio-result]')?.value).toBe(transcript);
      switchProject(); render();
      expectDiscarded();
    },
  );

  it('aborts an in-flight criterion transcription and ignores its late response after switching projects', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof transcribeAudio>>) => void;
    vi.mocked(transcribeAudio).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const render = () => act(() => root.render(<GroundTruthInlineTutor node={node} project={project} />));
    render(); await importAudio(host.querySelector<HTMLTextAreaElement>('[name=user-criterion]')!);
    act(() => button('Transcribe audio').click());
    const signal = vi.mocked(transcribeAudio).mock.calls[0][1]?.signal;
    switchProject(); render();
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve({ text: transcript, model: DEFAULT_AUDIO_MODEL }));
    expectDiscarded();
    expect(host.querySelector<HTMLTextAreaElement>('[name=user-criterion]')?.value).toBe('');
  });
});

describe('DetailPanel audio project identity', () => {
  it.each(['name', 'notes'] as const)('discards prepared %s audio when the selected ID and value are unchanged in another project', async kind => {
    act(() => root.render(<DetailPanel />));
    const selector = kind === 'name' ? `input[aria-label="${t().detail.nameAria}"]` : '[name=node-text]';
    const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    await importAudio(field); await transcribe();
    switchProject();
    expectDiscarded();
    expect(host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)?.value).toBe(kind === 'name' ? node.name : '');
  });

  it.each(['rule', 'decision-note'] as const)('does not carry an inserted but unsubmitted %s draft into another project', async kind => {
    if (kind === 'rule') {
      node = { ...node, id: 'root', parentId: null, kind: 'root' }; project = makeProject('project-A');
      useGraphStore.setState({ project, selectedNodeId: node.id });
    }
    act(() => root.render(<DetailPanel />));
    const selector = `[name=${kind}]`;
    await importAudio(host.querySelector<HTMLInputElement>(selector)!); await transcribe();
    act(() => button('Insert text').click());
    expect(host.querySelector<HTMLInputElement>(selector)?.value).toBe(transcript);
    switchProject();
    expect(host.querySelector<HTMLInputElement>(selector)?.value).toBe('');
    expect(useGraphStore.getState().project?.rules).toEqual([]);
    expect(useGraphStore.getState().project?.nodes[node.id].history).toEqual([]);
  });
});
