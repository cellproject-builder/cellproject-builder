import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useGraphStore } from '@/store';
import { t, useLocaleStore } from '@/i18n';
import { buildDemoProject } from '@/data/demoProject';
import { hasPendingPlannerEdits } from '@/chat/plannerEdits';
import { DetailPanel } from './DetailPanel';

let host: HTMLDivElement, root: Root, planId: string, nodeId: string;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ locale: 'en' });
  const project = buildDemoProject(); planId = project.id; nodeId = project.rootId;
  useGraphStore.setState({ project, selectedNodeId: nodeId, detailPanelOpen: true, drafts: {}, pendingSuggestions: null, parkedSuggestions: {}, aiJobs: {}, lastAction: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(<DetailPanel />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); expect(hasPendingPlannerEdits(planId)).toBe(false); });

it.each(['name', 'notes', 'what', 'why'] as const)('protects the uncommitted %s field and releases it after committing', kind => {
  if (kind === 'what' || kind === 'why') {
    const label = kind === 'what' ? t().detail.whatIs : t().detail.whyNeeded;
    const edit = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === t().detail.editField(label))!;
    act(() => Simulate.click(edit));
  }
  const selector = kind === 'name' ? '[name=node-name]' : kind === 'notes' ? '[name=node-text]' : '[name=node-field]';
  const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  expect(hasPendingPlannerEdits(planId)).toBe(false);
  act(() => { Simulate.focus(field); Simulate.change(field, { target: { value: 'Uncommitted human edit' } } as never); });
  expect(hasPendingPlannerEdits(planId)).toBe(true);
  const key = kind === 'what' ? 'oQue' : kind === 'why' ? 'porQue' : kind;
  expect(useGraphStore.getState().project!.nodes[nodeId][key]).not.toBe('Uncommitted human edit');
  act(() => Simulate.blur(field));
  expect(hasPendingPlannerEdits(planId)).toBe(false);
  expect(useGraphStore.getState().project!.nodes[nodeId][key]).toBe('Uncommitted human edit');
});

it('clears an abandoned dirty editor when selecting another node', () => {
  const field = host.querySelector<HTMLInputElement>('[name=node-name]')!;
  act(() => { Simulate.focus(field); Simulate.change(field, { target: { value: 'Abandoned name' } } as never); });
  expect(hasPendingPlannerEdits(planId)).toBe(true);
  const other = Object.keys(useGraphStore.getState().project!.nodes).find(id => id !== nodeId)!;
  act(() => useGraphStore.getState().selectNode(other));
  expect(hasPendingPlannerEdits(planId)).toBe(false);
  expect(useGraphStore.getState().project!.nodes[nodeId].name).not.toBe('Abandoned name');
});

it('allows a reverted draft and clears dirty ownership on unmount', () => {
  const field = host.querySelector<HTMLInputElement>('[name=node-name]')!;
  const original = field.value;
  act(() => { Simulate.focus(field); Simulate.change(field, { target: { value: 'Changed' } } as never); });
  expect(hasPendingPlannerEdits(planId)).toBe(true);
  act(() => Simulate.change(field, { target: { value: original } } as never));
  expect(hasPendingPlannerEdits(planId)).toBe(false);
  act(() => Simulate.change(field, { target: { value: 'Changed again' } } as never));
  expect(hasPendingPlannerEdits(planId)).toBe(true);
  act(() => root.render(null));
  expect(hasPendingPlannerEdits(planId)).toBe(false);
});

it.each(['rule', 'decision-note'] as const)('keeps an unsubmitted %s draft protected until the user records it', kind => {
  const field = host.querySelector<HTMLInputElement>(`[name=${kind}]`)!;
  act(() => Simulate.change(field, { target: { value: 'Preserve this human draft' } } as never));
  expect(hasPendingPlannerEdits(planId)).toBe(true);
  act(() => Simulate.blur(field));
  expect(hasPendingPlannerEdits(planId)).toBe(true);
  act(() => Simulate.keyDown(field, { key: 'Enter' }));
  expect(hasPendingPlannerEdits(planId)).toBe(false);
  if (kind === 'rule') expect(useGraphStore.getState().project!.rules).toContain('Preserve this human draft');
  else expect(useGraphStore.getState().project!.nodes[nodeId].history.at(-1)?.message).toBe('Preserve this human draft');
});

it('keeps a retained decision draft protected across selection changes and clears it when replacing the plan', () => {
  const field = host.querySelector<HTMLInputElement>('[name=decision-note]')!;
  act(() => Simulate.change(field, { target: { value: 'Still unsubmitted' } } as never));
  const other = Object.keys(useGraphStore.getState().project!.nodes).find(id => id !== nodeId)!;
  act(() => useGraphStore.getState().selectNode(other));
  expect(host.querySelector<HTMLInputElement>('[name=decision-note]')?.value).toBe('Still unsubmitted');
  expect(hasPendingPlannerEdits(planId)).toBe(true);
  act(() => useGraphStore.setState({ project: { ...buildDemoProject(), id: 'replacement-plan' }, selectedNodeId: nodeId }));
  expect(hasPendingPlannerEdits(planId)).toBe(false);
  expect(hasPendingPlannerEdits('replacement-plan')).toBe(false);
  expect(host.querySelector<HTMLInputElement>('[name=decision-note]')?.value).toBe('');
});
