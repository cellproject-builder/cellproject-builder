import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { get } from 'idb-keyval';
import { useToastStore } from '@/components/ui/Toast';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { initializeWorkspace } from '@/workspace/planner';
import { buildDemoProject } from '@/data/demoProject';
import { getVisualWorkspace, mutateVisualWorkspace } from './domain';
import { useArtifactClipboard } from './useArtifactClipboard';
import type { VisualArtifact } from './types';

let host: HTMLDivElement, root: Root;
function Fixture() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>('original');
  useArtifactClipboard({ containerRef, projectId: 'clipboard-plan', selectedArtifactId: selected, onSelectArtifact: setSelected, english: true });
  return <><div ref={containerRef} data-canvas><span>Object</span><textarea /></div><input aria-label="Chat" /><output>{selected}</output></>;
}
function clipboard() {
  const values: Record<string, string> = {};
  return { values, getData: (key: string) => values[key] ?? '', setData: (key: string, value: string) => { values[key] = value; } };
}
async function event(type: string, target: Element, data = clipboard()) {
  const emitted = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(emitted, 'clipboardData', { value: data });
  await act(async () => target.dispatchEvent(emitted));
  return emitted;
}
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await Promise.all([useGraphStore.persist.rehydrate(), useWorkspaceStore.persist.rehydrate()]);
  useWorkspaceStore.setState({ projects: {}, notes: {}, activeProjectId: null, legacyImported: true });
  useGraphStore.setState({ project: { ...buildDemoProject(), id: 'clipboard-plan' } }); initializeWorkspace();
  const original: VisualArtifact = { id: 'original', label: 'Motor', kind: 'model', x: 0, y: 0, width: 280, height: 220, mediaId: null, source: null,
    scene: { version: 1, label: 'Motor', objects: [{ id: 'body', type: 'box', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#008080' }] },
    revisions: [{ scene: null, mediaId: null, createdAt: 1 }], revisionIndex: 0,
  };
  mutateVisualWorkspace(w => ({ ...w, artifacts: [original] }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Fixture />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('copies the selection through native clipboard events and selects each pasted copy', async () => {
  const canvas = host.querySelector('[data-canvas]')!;
  await event('pointerdown', canvas);
  const data = clipboard();
  expect((await event('copy', canvas, data)).defaultPrevented).toBe(true);
  expect(data.values['text/plain']).toContain('cellproject-visual-artifact:v1');
  expect((await event('paste', document.body, data)).defaultPrevented).toBe(true);
  expect((await event('paste', document.body, data)).defaultPrevented).toBe(true);
  const artifacts = getVisualWorkspace(useGraphStore.getState().project).artifacts;
  expect(artifacts).toHaveLength(3);
  await act(async () => { await vi.waitFor(() => expect(host.querySelector('output')?.textContent).toBe(artifacts[2].id)); });
  expect(artifacts.map(a => a.label)).toEqual(['Motor', 'Motor', 'Motor']);
});

it('leaves text editors, other panels, text selections and external clipboard content alone', async () => {
  const canvas = host.querySelector('[data-canvas]')!, input = host.querySelector('input')!, textarea = host.querySelector('textarea')!;
  await event('pointerdown', canvas);
  const data = clipboard(); await event('copy', canvas, data);
  expect((await event('copy', textarea, data)).defaultPrevented).toBe(false);
  expect((await event('paste', textarea, data)).defaultPrevented).toBe(false);
  expect((await event('paste', canvas, clipboard())).defaultPrevented).toBe(false);
  await event('pointerdown', input);
  expect((await event('copy', document.body, data)).defaultPrevented).toBe(false);
  expect((await event('paste', input, data)).defaultPrevented).toBe(false);
  await event('pointerdown', canvas);
  const selection = window.getSelection()!, range = document.createRange(); range.selectNodeContents(canvas.querySelector('span')!);
  selection.removeAllRanges(); selection.addRange(range);
  expect((await event('copy', canvas, data)).defaultPrevented).toBe(false);
  selection.removeAllRanges();
  expect(getVisualWorkspace(useGraphStore.getState().project).artifacts).toHaveLength(1);
});

it('saves the copy and its undo before reporting the completed action', async () => {
  const canvas = host.querySelector('[data-canvas]')!;
  await event('pointerdown', canvas);
  const data = clipboard(); await event('copy', canvas, data);
  useToastStore.setState({ toasts: [] });
  await event('paste', canvas, data);
  await act(async () => { await vi.waitFor(() => expect(useToastStore.getState().toasts.some(t => t.action?.label === 'Undo')).toBe(true)); });
  const saved = JSON.parse((await get<string>('cellproject-graph'))!);
  expect(getVisualWorkspace(saved.state.project).artifacts).toHaveLength(2);
  const undo = useToastStore.getState().toasts.find(t => t.action?.label === 'Undo')!.action!;
  await act(async () => { await undo.onClick(); });
  await act(async () => { await useGraphStore.persist.rehydrate(); });
  expect(getVisualWorkspace(useGraphStore.getState().project).artifacts.map(a => a.id)).toEqual(['original']);
});
