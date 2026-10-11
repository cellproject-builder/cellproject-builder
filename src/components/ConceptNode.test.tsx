import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { buildDemoProject } from '@/data/demoProject';
import { useGraphStore } from '@/store';
import type { ConceptNodeData } from '@/types';
import { ConceptNode, type NodeExtras } from './ConceptNode';

let host: HTMLDivElement, root: Root;
let flow: ReturnType<typeof useStoreApi>;
let node: ConceptNodeData & NodeExtras & Record<string, unknown>;
function Viewport() { flow = useStoreApi(); return null; }
function renderNode() {
  root.render(<ReactFlowProvider><Viewport/><ConceptNode id={node.id} type="concept" data={node}
    selected={false} dragging={false} draggable selectable deletable isConnectable={false}
    positionAbsoluteX={0} positionAbsoluteY={0} zIndex={0}/></ReactFlowProvider>);
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useLocaleStore.setState({ locale: 'en' });
  const project = buildDemoProject();
  const resource = Object.values(project.nodes).find(part => part.kind === 'recurso')!;
  node = { ...resource, name: 'Synthetic servo', oQue: 'A short mechanical resource description.',
    porQue: 'Long inspection reasoning belongs in the detail panel.', comoConfirmar: 'An inspection-only criterion.',
    confirmado: false, state: 'concept', childCount: 0, edgeCount: 0, canConclude: false };
  useGraphStore.setState({ project: { ...project, nodes: { ...project.nodes, [node.id]: node } } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => renderNode());
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('standard canvas cards', () => {
  it('keeps the type, title and short description when zooming out', () => {
    act(() => flow.setState({ transform: [0, 0, .9] }));
    expect(host.textContent).toContain('Resource');
    expect(host.textContent).toContain('Synthetic servo');
    expect(host.textContent).toContain('A short mechanical resource description.');
    act(() => flow.setState({ transform: [100, 50, .15] }));
    expect(host.textContent).toContain('Resource');
    expect(host.textContent).toContain('Synthetic servo');
    expect(host.textContent).toContain('A short mechanical resource description.');
  });

  it('keeps the brief card when zooming in instead of opening inspection details', () => {
    act(() => flow.setState({ transform: [0, 0, 1.8] }));
    expect(host.textContent).toContain('A short mechanical resource description.');
    expect(host.textContent).not.toContain('Long inspection reasoning belongs in the detail panel.');
    expect(host.textContent).not.toContain('An inspection-only criterion.');
  });

  it('preserves the quick confirmation gate at a distant zoom', () => {
    node = { ...node, canConclude: true };
    act(() => renderNode());
    act(() => flow.setState({ transform: [0, 0, .2] }));
    expect(host.querySelector('button')).not.toBeNull();
    node = { ...node, blocked: true };
    act(() => renderNode());
    expect(host.querySelector('button')).toBeNull();
  });
});
