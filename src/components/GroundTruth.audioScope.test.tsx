import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioRecording, type AudioRecording } from '@/audio/recording';
import { DEFAULT_AUDIO_MODEL, transcribeAudio } from '@/audio/transcription';
import { hasActiveDataIngestions } from '@/cloud/activity';
import { t, useLocaleStore } from '@/i18n';
import { useGraphStore } from '@/store';
import type { ConceptNodeData, Project } from '@/types';
import { DetailPanel } from './DetailPanel';
import { FailureSection, GroundTruthInlineTutor, GroundTruthRefsList } from './GroundTruth';

// Exercise the real fields, dictation, React events and store with synthetic capture/STT.
vi.mock('@/audio/recording', () => ({ createAudioRecording: vi.fn() }));
vi.mock('@/audio/transcription', async () => ({
  ...await vi.importActual('@/audio/limits'), transcribeAudio: vi.fn(),
}));

let host: HTMLDivElement, root: Root, project: Project, node: ConceptNodeData;
let recording: AudioRecording;
const transcript = 'Text dictated in project A.';
const clip = () => new Blob(['RIFF0000WAVEdata'], { type: 'audio/wav' });
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ locale: 'en' });
  recording = { mimeType: 'audio/wav', stop: vi.fn(async () => [clip()]), cancel: vi.fn() };
  vi.mocked(createAudioRecording).mockReset().mockResolvedValue(recording);
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
async function startDictation(field: HTMLInputElement | HTMLTextAreaElement) {
  const mic = field.closest('.audio-field')!.querySelector<HTMLButtonElement>('.audio-field-mic')!;
  expect(mic.getAttribute('aria-label')).toBe('Dictate text');
  await act(async () => mic.click());
  expect(createAudioRecording).toHaveBeenCalledOnce();
  expect(hasActiveDataIngestions()).toBe(true);
}
async function confirmDictation() { await act(async () => button('Confirm dictation').click()); }
function expectDiscarded() {
  expect(host.querySelector('.audio-field-popup')).toBeNull();
  expect(hasActiveDataIngestions()).toBe(false);
  expect(useGraphStore.getState().drafts).toEqual({});
  expect(useGraphStore.getState().project?.id).toBe('project-B');
}

describe('GroundTruth audio project identity', () => {
  it.each(['criterion', 'failure', 'proof-label', 'proof-observation'] as const)(
    'cancels unconfirmed %s dictation when projects reuse node/proof IDs and an empty baseline', async kind => {
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
      await startDictation(field);
      expect(transcribeAudio).not.toHaveBeenCalled();
      switchProject(); render();
      expectDiscarded();
      expect(recording.cancel).toHaveBeenCalledOnce();
      expect(recording.stop).not.toHaveBeenCalled();
      expect(transcribeAudio).not.toHaveBeenCalled();
    },
  );

  it('cancels a pending microphone request and its late recorder after switching projects', async () => {
    let resolve!: (value: AudioRecording) => void;
    vi.mocked(createAudioRecording).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const render = () => act(() => root.render(<GroundTruthInlineTutor node={node} project={project} />));
    render(); await startDictation(host.querySelector<HTMLTextAreaElement>('[name=user-criterion]')!);
    const signal = vi.mocked(createAudioRecording).mock.calls[0][0].signal;
    switchProject(); render();
    expect(signal?.aborted).toBe(true);
    expectDiscarded();
    await act(async () => resolve(recording));
    expect(recording.cancel).toHaveBeenCalledOnce();
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLTextAreaElement>('[name=user-criterion]')?.value).toBe('');
  });

  it('discards a late recording stop before it can transcribe in another project', async () => {
    let resolve!: (value: Blob[]) => void;
    vi.mocked(recording.stop).mockImplementationOnce(() => new Promise<Blob[]>(done => { resolve = done; }));
    const render = () => act(() => root.render(<GroundTruthInlineTutor node={node} project={project} />));
    render(); await startDictation(host.querySelector<HTMLTextAreaElement>('[name=user-criterion]')!);
    await confirmDictation();
    expect(recording.stop).toHaveBeenCalledOnce();
    expect(transcribeAudio).not.toHaveBeenCalled();
    switchProject(); render();
    expectDiscarded();
    await act(async () => resolve([clip()]));
    expect(transcribeAudio).not.toHaveBeenCalled();
    expectDiscarded();
    expect(host.querySelector<HTMLTextAreaElement>('[name=user-criterion]')?.value).toBe('');
  });

  it('aborts an in-flight criterion transcription and ignores its late response after switching projects', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof transcribeAudio>>) => void;
    vi.mocked(transcribeAudio).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const render = () => act(() => root.render(<GroundTruthInlineTutor node={node} project={project} />));
    render(); await startDictation(host.querySelector<HTMLTextAreaElement>('[name=user-criterion]')!);
    await confirmDictation();
    expect(transcribeAudio).toHaveBeenCalledOnce();
    const signal = vi.mocked(transcribeAudio).mock.calls[0][1]?.signal;
    switchProject(); render();
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve({ text: transcript, model: DEFAULT_AUDIO_MODEL }));
    expectDiscarded();
    expect(host.querySelector<HTMLTextAreaElement>('[name=user-criterion]')?.value).toBe('');
  });
});

describe('DetailPanel audio project identity', () => {
  it.each(['name', 'notes'] as const)('cancels unconfirmed %s dictation when the selected ID and value are unchanged in another project', async kind => {
    act(() => root.render(<DetailPanel />));
    const selector = kind === 'name' ? `input[aria-label="${t().detail.nameAria}"]` : '[name=node-text]';
    const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    await startDictation(field);
    expect(transcribeAudio).not.toHaveBeenCalled();
    switchProject();
    expectDiscarded();
    expect(recording.cancel).toHaveBeenCalledOnce();
    expect(recording.stop).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)?.value).toBe(kind === 'name' ? node.name : '');
  });

  it.each(['rule', 'decision-note'] as const)('does not carry an inserted but unsubmitted %s draft into another project', async kind => {
    if (kind === 'rule') {
      node = { ...node, id: 'root', parentId: null, kind: 'root' }; project = makeProject('project-A');
      useGraphStore.setState({ project, selectedNodeId: node.id });
    }
    act(() => root.render(<DetailPanel />));
    const selector = `[name=${kind}]`;
    await startDictation(host.querySelector<HTMLInputElement>(selector)!); await confirmDictation();
    expect(host.querySelector<HTMLInputElement>(selector)?.value).toBe(transcript);
    expect(host.querySelector('.audio-field-popup')).toBeNull();
    expect(hasActiveDataIngestions()).toBe(false);
    switchProject();
    expect(host.querySelector<HTMLInputElement>(selector)?.value).toBe('');
    expect(useGraphStore.getState().project?.rules).toEqual([]);
    expect(useGraphStore.getState().project?.nodes[node.id].history).toEqual([]);
  });
});
