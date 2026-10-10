import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { replanFromFailure } from '@/ai/service';
import { useLocaleStore } from '@/i18n';
import { useKBStore } from '@/kb/store';
import { useGraphStore } from '@/store';
import type { ConceptNodeData, Project } from '@/types';
import { FailureSection } from './GroundTruth';

vi.mock('@/ai/service', async importOriginal => ({
  ...await importOriginal<typeof import('@/ai/service')>(),
  replanFromFailure: vi.fn(),
}));
vi.mock('@/ai/availability', () => ({ requireAI: vi.fn(() => true) }));

const diagnosis = 'Cause is undetermined. Measure the loaded supply voltage before choosing a remedy.';
const proposedPart = {
  tempId: 'new-measurement', name: 'Measure supply under load', kind: 'passo' as const,
  fx: '', problem: '', confidence: 50, confidenceReason: 'Synthetic unknown cause', pros: [], cons: [], oQue: 'Measure loaded supply voltage',
  porQue: 'Distinguish supply failure from actuator failure', comoConfirmar: 'Record voltage while the actuator stops',
};
const originalStageSuggestions = useGraphStore.getState().stageSuggestions;
let host: HTMLDivElement, root: Root, sequence = 0;
let project: Project, part: ConceptNodeData;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ locale: 'en' });
  const id = `failed-${sequence++}`;
  part = {
    id, parentId: 'root', order: 0, kind: 'passo', name: 'Test actuator under load',
    fx: '', problem: '', confidence: 50, pros: [], cons: [], oQue: 'Test the actuator',
    porQue: '', comoConfirmar: '', confirmado: false, state: 'concept', notes: '', history: [],
    aiSuggested: false, position: { x: 0, y: 0 }, failureContext: 'The actuator stopped under load.',
  };
  project = {
    id: `project-${id}`, rootId: 'root', name: 'Synthetic failure test', objective: 'Investigate a failed observation',
    archetype: 'construir', createdAt: 0, updatedAt: 0, edges: {},
    nodes: { root: { ...part, id: 'root', parentId: null, kind: 'root', failureContext: undefined }, [id]: part },
  };
  useGraphStore.setState({ project, pendingSuggestions: null, parkedSuggestions: {}, drafts: {}, aiJobs: {} });
  vi.spyOn(useKBStore.getState(), 'getContextFor').mockResolvedValue([]);
  vi.mocked(replanFromFailure).mockReset().mockResolvedValue({ diagnosis, nodes: [], edges: [] });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.restoreAllMocks();
  useGraphStore.setState({ stageSuggestions: originalStageSuggestions });
});

const render = () => act(() => root.render(<FailureSection node={part} project={project} />));
const renderCurrent = () => {
  project = useGraphStore.getState().project!;
  part = project.nodes[part.id];
  render();
};
const replanButton = () => Array.from(host.querySelectorAll('button'))
  .find(button => button.textContent?.includes('Replan knowing what failed'));
const clickReplan = async () => {
  const button = replanButton();
  expect(button).toBeDefined();
  await act(async () => { button!.click(); });
};

it('shows and preserves a diagnosis with no proposed parts while allowing another replan', async () => {
  const stage = vi.spyOn(useGraphStore.getState(), 'stageSuggestions');
  render(); await clickReplan();
  expect(stage).not.toHaveBeenCalled();
  expect(useGraphStore.getState().pendingSuggestions).toBeNull();
  expect(host.textContent).toContain(diagnosis);
  expect(replanButton()).toBeDefined();
  expect(useGraphStore.getState().project?.nodes[part.id].failureContext).toBe(part.failureContext);
  expect(useGraphStore.getState().project?.nodes[part.id].confirmado).toBe(false);
  act(() => root.render(null)); render();
  expect(host.textContent).toContain(diagnosis);
  await clickReplan();
  expect(replanFromFailure).toHaveBeenCalledTimes(2);
});

it('allows a new diagnosis when a legacy empty review batch belongs to the failed part', async () => {
  useGraphStore.setState({ pendingSuggestions: { parentId: part.id, nodes: [], edges: [], originalCount: 0 } });
  render(); await clickReplan();
  expect(replanFromFailure).toHaveBeenCalledOnce();
  expect(host.textContent).toContain(diagnosis);
  expect(replanButton()).toBeDefined();
});

it('keeps another part review unchanged when the diagnosis proposes no replacement parts', async () => {
  const suggestion = { ...part, tempId: 'review-existing' };
  const pending = { parentId: 'root', nodes: [{ tempId: suggestion.tempId, data: suggestion }], edges: [], originalCount: 1 };
  useGraphStore.setState({ pendingSuggestions: pending });
  render(); await clickReplan();
  expect(useGraphStore.getState().pendingSuggestions).toBe(pending);
  expect(useGraphStore.getState().parkedSuggestions).toEqual({});
  expect(host.textContent).toContain(diagnosis);
});

it('still stages proposed parts and holds further replanning until their review finishes', async () => {
  vi.mocked(replanFromFailure).mockResolvedValue({ diagnosis, nodes: [proposedPart], edges: [] });
  render(); await clickReplan();
  expect(useGraphStore.getState().pendingSuggestions?.nodes).toHaveLength(1);
  expect(useGraphStore.getState().pendingSuggestions?.parentId).toBe(part.id);
  expect(host.textContent).toContain(diagnosis);
  expect(replanButton()).toBeUndefined();
});

it('forgets the old diagnosis when the user clears the failure report', async () => {
  render(); await clickReplan();
  const clear = Array.from(host.querySelectorAll('button'))
    .find(button => button.textContent?.includes('Resolved — clear failure'))!;
  act(() => clear.click());
  part = { ...useGraphStore.getState().project!.nodes[part.id], failureContext: 'A different observation failed.' };
  project = { ...useGraphStore.getState().project!, nodes: { ...project.nodes, [part.id]: part } };
  act(() => useGraphStore.setState({ project, pendingSuggestions: null }));
  act(() => root.render(null)); render();
  expect(host.textContent).not.toContain(diagnosis);
  expect(replanButton()).toBeDefined();
});

it('hides the prior diagnosis when failure actions bypass the UI clear button', async () => {
  render(); await clickReplan();
  act(() => {
    useGraphStore.getState().clearFailure(part.id);
    useGraphStore.getState().reportFailure(part.id, 'A different observation failed.');
  });
  renderCurrent();
  expect(host.textContent).not.toContain(diagnosis);
  act(() => root.render(null)); renderCurrent();
  expect(host.textContent).not.toContain(diagnosis);
  expect(replanButton()).toBeDefined();
});

it('distinguishes repeated reports with the same text and timestamp', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(123);
  act(() => useGraphStore.getState().reportFailure(part.id, part.failureContext!));
  renderCurrent(); await clickReplan();
  expect(host.textContent).toContain(diagnosis);
  act(() => useGraphStore.getState().reportFailure(part.id, part.failureContext!));
  renderCurrent();
  expect(host.textContent).not.toContain(diagnosis);
});

it('keeps diagnostics separate for projects that reuse the same node ID', async () => {
  render(); await clickReplan();
  const previousProject = project;
  act(() => useGraphStore.setState({ project: { ...project, id: 'other-project' } }));
  renderCurrent();
  expect(host.textContent).not.toContain(diagnosis);
  act(() => useGraphStore.setState({ project: previousProject }));
  renderCurrent();
  expect(host.textContent).toContain(diagnosis);
});

it.each(['clear', 'replace', 'switch-project'] as const)('discards a late replan response after %s', async action => {
  let resolve!: (reply: Awaited<ReturnType<typeof replanFromFailure>>) => void;
  vi.mocked(replanFromFailure).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const stage = vi.spyOn(useGraphStore.getState(), 'stageSuggestions');
  const originalProject = project;
  render(); await clickReplan();
  await vi.waitFor(() => expect(replanFromFailure).toHaveBeenCalledOnce());
  act(() => {
    if (action === 'clear') useGraphStore.getState().clearFailure(part.id);
    else if (action === 'replace') useGraphStore.getState().reportFailure(part.id, 'A new failure needs a different investigation.');
    else useGraphStore.setState({ project: { ...project, id: 'new-active-project' } });
  });
  renderCurrent();
  await act(async () => resolve({ diagnosis, nodes: [proposedPart], edges: [] }));
  expect(stage).not.toHaveBeenCalled();
  expect(useGraphStore.getState().pendingSuggestions).toBeNull();
  expect(host.textContent).not.toContain(diagnosis);
  act(() => root.render(null)); renderCurrent();
  expect(host.textContent).not.toContain(diagnosis);
  act(() => useGraphStore.setState({ project: originalProject, pendingSuggestions: null }));
  renderCurrent();
  expect(host.textContent).not.toContain(diagnosis);
});

it('does not start a request from a stale card after the active project changed', async () => {
  render();
  act(() => useGraphStore.setState({ project: { ...project, id: 'another-active-project' } }));
  await clickReplan();
  expect(replanFromFailure).not.toHaveBeenCalled();
  expect(useGraphStore.getState().pendingSuggestions).toBeNull();
});

it('still records a fresh failure and replans it in the same interaction', async () => {
  const failure = part.failureContext!;
  part = { ...part, failureContext: undefined };
  project = { ...project, nodes: { ...project.nodes, [part.id]: part } };
  useGraphStore.setState({ project, drafts: { [part.id]: { failure } } });
  render();
  const record = Array.from(host.querySelectorAll('button'))
    .find(button => button.textContent?.includes('Record and replan'))!;
  await act(async () => record.click());
  renderCurrent();
  expect(replanFromFailure).toHaveBeenCalledOnce();
  expect(host.textContent).toContain(diagnosis);
  expect(useGraphStore.getState().project?.nodes[part.id].failureContext).toBe(failure);
});
