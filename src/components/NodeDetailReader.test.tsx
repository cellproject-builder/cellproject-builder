import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGraphStore } from '@/store';
import { buildDemoProject } from '@/data/demoProject';
import { useLocaleStore } from '@/i18n';
import { NodeDetailReader, type NodeDetailRequest } from './NodeDetailReader';

let host: HTMLDivElement, root: Root, request: NodeDetailRequest;
const close = vi.fn();

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useLocaleStore.setState({ locale: 'en' });
  const project = buildDemoProject();
  const node = Object.values(project.nodes).find(part => part.kind === 'recurso')!;
  project.nodes[node.id] = { ...node, name: 'Servo to investigate', oQue: 'A bounded mechanical resource.',
    porQue: 'This joint needs controlled motion.', explicacao: '## Torque\nCheck the measured load.',
    notes: 'Measure the actual bracket first.', comoConfirmar: 'Hidden AI acceptance criterion.',
    comoConfirmarUsuario: undefined, comoConfirmarUsuarioAt: undefined, confirmado: false, takenAsKnown: false };
  useGraphStore.setState({ project, selectedNodeId: node.id, detailPanelOpen: false });
  request = { planId: project.id, nodeId: node.id };
  close.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

it('opens compact read-only details outside the hidden fullscreen inspector and keeps the inspector mounted', () => {
  act(() => root.render(<div className="ws-app is-canvas-maximized"><aside className="planner-detail-panel"><input defaultValue="Existing inspector draft" /></aside><NodeDetailReader request={request} onClose={close} /></div>));
  const inspector = host.querySelector('aside')!;
  const dialog = document.body.querySelector<HTMLElement>('[role=dialog]')!;
  expect(dialog).not.toBeNull();
  expect(host.contains(dialog)).toBe(false);
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(dialog.classList.contains('is-compact-reading')).toBe(true);
  expect(dialog.textContent).toContain('Servo to investigate');
  expect(dialog.textContent).toContain('A bounded mechanical resource.');
  expect(dialog.textContent).toContain('This joint needs controlled motion.');
  expect(dialog.textContent).toContain('Check the measured load.');
  expect(dialog.textContent).toContain('Measure the actual bracket first.');
  expect(dialog.textContent).not.toContain('Hidden AI acceptance criterion.');
  expect(dialog.querySelector('input,textarea')).toBeNull();
  expect(host.querySelector('aside')).toBe(inspector);
  expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('Existing inspector draft');
  expect(useGraphStore.getState().detailPanelOpen).toBe(false);
});

it('closes on Escape without clearing graph selection and restores focus to the opener', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Read node</button><NodeDetailReader request={open ? request : null} onClose={() => setOpen(false)} /></>;
  }
  const otherEscape = vi.fn(); document.addEventListener('keydown', otherEscape);
  try {
    act(() => root.render(<Harness />));
    const opener = host.querySelector<HTMLButtonElement>('button')!;
    act(() => { opener.focus(); Simulate.click(opener); });
    const dialog = document.body.querySelector<HTMLElement>('[role=dialog]')!;
    expect(dialog.contains(document.activeElement)).toBe(true);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(document.body.querySelector('[role=dialog]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(useGraphStore.getState().selectedNodeId).toBe(request.nodeId);
    expect(otherEscape).not.toHaveBeenCalled();
  } finally { document.removeEventListener('keydown', otherEscape); }
});

it('closes when the plan changes even when the replacement reuses a node id', () => {
  act(() => root.render(<NodeDetailReader request={request} onClose={close} />));
  const project = useGraphStore.getState().project!;
  act(() => useGraphStore.setState({ project: { ...project, id: 'replacement-plan' } }));
  expect(document.body.querySelector('[role=dialog]')).toBeNull();
  expect(close).toHaveBeenCalledTimes(1);
});

it('dismisses by its backdrop and does not dismiss while selecting text inside the reader', () => {
  act(() => root.render(<NodeDetailReader request={request} onClose={close} />));
  const dialog = document.body.querySelector<HTMLElement>('[role=dialog]')!;
  act(() => Simulate.pointerDown(dialog));
  expect(close).not.toHaveBeenCalled();
  act(() => Simulate.pointerDown(dialog.parentElement!));
  expect(close).toHaveBeenCalledTimes(1);
});
