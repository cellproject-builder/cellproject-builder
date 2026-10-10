import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge, Node, NodeChange } from '@xyflow/react';
import type { ConceptNodeData, Project } from '@/types';
import { useGraphStore } from '@/store';
import { DEFAULT_NODE_DIMENSIONS } from '@/graph/autoLayout';
import { GraphCanvas } from './GraphCanvas';
import { setVisualArtifactLink } from '@/visuals/domain';
import { useLocaleStore } from '@/i18n';
import { useVisualPopupStore } from '@/visuals/ui/uiStore';

interface FlowProps {
  nodes: Node[];
  edges: Edge[];
  children?: ReactNode;
  onNodeDragStart: (event?: React.MouseEvent, node?: Node) => void;
  onNodesChange: (changes: NodeChange[]) => void;
}
const flow = vi.hoisted(() => ({
  props: null as FlowProps | null,
  setViewport: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  initialized: true,
  mobile: false,
  measured: {} as Record<string, { width: number; height: number }>,
}));

vi.mock('@xyflow/react', async () => {
  const { forwardRef, createElement } = await import('react');
  const { DEFAULT_NODE_DIMENSIONS: fallback } = await import('@/graph/autoLayout');
  const sizeOf = (id: string) => flow.measured[id] ?? fallback;
  const getNodes = () => (flow.props?.nodes ?? []).map((node) => ({ ...node, measured: sizeOf(node.id) }));
  const getNode = (id: string) => getNodes().find((node) => node.id === id);
  const getNodesBounds = (ids: string[]) => {
    const nodes = ids.map(getNode).filter((node): node is NonNullable<typeof node> => !!node);
    const x = Math.min(...nodes.map((node) => node.position.x));
    const y = Math.min(...nodes.map((node) => node.position.y));
    return {
      x, y,
      width: Math.max(...nodes.map((node) => node.position.x + sizeOf(node.id).width)) - x,
      height: Math.max(...nodes.map((node) => node.position.y + sizeOf(node.id).height)) - y,
    };
  };
  const api = { getNodes, getNode, getNodesBounds, setViewport: flow.setViewport, zoomIn: flow.zoomIn, zoomOut: flow.zoomOut };
  return {
    ReactFlow: (props: FlowProps) => { flow.props = props; return createElement('div', { 'data-react-flow': true }, props.children); },
    Panel: forwardRef<HTMLDivElement, { children?: ReactNode; className?: string }>(({ children, className }, ref) => createElement('div', { ref, className }, children)),
    Controls: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
    ControlButton: ({ children }: { children?: ReactNode }) => createElement('button', null, children),
    Background: () => null,
    BackgroundVariant: { Dots: 'dots' },
    MiniMap: () => null,
    useReactFlow: () => api,
    useNodesInitialized: () => flow.initialized,
    applyNodeChanges: (changes: NodeChange[], nodes: Node[]) => nodes.map((node) => {
      const change = changes.find((item) => (item.type === 'position' || item.type === 'dimensions' || item.type === 'select') && item.id === node.id);
      if (change?.type === 'select') return { ...node, selected: change.selected };
      if (change?.type === 'dimensions' && change.dimensions) {
        flow.measured[node.id] = change.dimensions;
        return { ...node, measured: change.dimensions, resizing: change.resizing,
          ...(change.setAttributes ? change.dimensions : {}) };
      }
      return change?.type === 'position' && change.position ? { ...node, position: change.position, dragging: change.dragging } : node;
    }),
  };
});
vi.mock('./ConceptNode', () => ({ ConceptNode: () => null, SIDE_HANDLE: { sourceLeft: 'sl', sourceRight: 'sr', targetLeft: 'tl', targetRight: 'tr' } }));
vi.mock('@/hooks/useMediaQuery', () => ({ useIsMobile: () => flow.mobile }));
vi.mock('./suggestionActions', () => ({ discardSuggestionsWithUndo: vi.fn(), acceptSuggestionsWithUndo: vi.fn() }));
vi.mock('@/visuals/VisualWorkspaceBridge', () => ({ VisualWorkspaceBridge: () => null }));
vi.mock('@/ink/PlannerInkLayer', () => ({ PlannerInkLayer: () => null }));
vi.mock('@/visuals/rendering/VisualArtifactNode', () => ({ VisualArtifactNode: () => null }));

function fixture(): Project {
  const specs = [
    { id: 'root', parentId: null, order: 0 },
    { id: 'first', parentId: 'root', order: 0 },
    { id: 'second', parentId: 'root', order: 1 },
  ];
  const nodes = Object.fromEntries(specs.map((spec, index): [string, ConceptNodeData] => [spec.id, {
    ...spec, name: spec.id, kind: spec.parentId ? 'passo' : 'root',
    fx: '', problem: '', confidence: 75, pros: [], cons: [], oQue: '', porQue: '', comoConfirmar: '',
    confirmado: false, state: 'concept', notes: '', history: [], aiSuggested: false,
    position: { x: 37 + index * 550, y: 81 + index * 450 },
  }]));
  return {
    id: 'auto-layout-integration', name: 'Auto layout', objective: '', createdAt: 1, updatedAt: 123,
    rootId: 'root', nodes, edges: {
      first: { id: 'edge-first', source: 'root', target: 'first', kind: 'direct' },
      second: { id: 'edge-second', source: 'root', target: 'second', kind: 'direct' },
    },
  };
}

let width: number, height: number, notifyResize: () => void;
let host: HTMLDivElement, root: Root;
const positions = () => Object.fromEntries(flow.props!.nodes.map((node) => [node.id, { ...node.position }]));
const edgeRoutes = () => flow.props!.edges.map(({ id, sourceHandle, targetHandle, type }) => ({ id, sourceHandle, targetHandle, type }));
const savedPositions = () => Object.fromEntries(Object.values(useGraphStore.getState().project!.nodes).map((node) => [node.id, node.position]));
const canvas = () => host.querySelector<HTMLElement>('[data-layout-mode]')!;
const advance = () => act(() => { vi.advanceTimersByTime(250); });
function resize(nextWidth: number, nextHeight: number) {
  act(() => { width = nextWidth; height = nextHeight; notifyResize(); });
  advance();
}
function choose(mode: string) {
  const select = host.querySelector<HTMLSelectElement>('select[name="graph-layout"]')!;
  act(() => { select.value = mode; Simulate.change(select); });
  advance();
}
function expectGraphInsideCanvas() {
  const viewport = flow.setViewport.mock.calls.at(-1)![0] as { x: number; y: number; zoom: number };
  for (const node of flow.props!.nodes) {
    const size = flow.measured[node.id] ?? DEFAULT_NODE_DIMENSIONS;
    expect(node.position.x * viewport.zoom + viewport.x).toBeGreaterThanOrEqual(0);
    expect(node.position.y * viewport.zoom + viewport.y).toBeGreaterThanOrEqual(0);
    expect((node.position.x + size.width) * viewport.zoom + viewport.x).toBeLessThanOrEqual(width);
    expect((node.position.y + size.height) * viewport.zoom + viewport.y).toBeLessThanOrEqual(height);
  }
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  width = 1100; height = 650;
  flow.props = null; flow.measured = {}; flow.initialized = true; flow.setViewport.mockClear();
  flow.mobile = false;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { notifyResize = callback; }
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.hasAttribute('data-layout-mode') ? width : 0; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.hasAttribute('data-layout-mode') ? height : 0; });
  useGraphStore.setState({
    project: fixture(), lens: 'structure', viewMode: 'graph', selectedNodeId: null, selectionVersion: 0,
    focusedParentId: null, focusVersion: 0, centerRequest: null, pendingSuggestions: null, parkedSuggestions: {}, mobileSheetOpen: false,
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(<GraphCanvas />));
  advance();
});
afterEach(() => {
  act(() => root.unmount()); host.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('GraphCanvas automatic layout integration', () => {
  function maximizableCanvas() {
    useLocaleStore.setState({ locale: 'en' });
    function Harness() {
      const [maximized, setMaximized] = useState(false);
      return <GraphCanvas maximized={maximized} onToggleMaximized={() => setMaximized(value => !value)} />;
    }
    act(() => root.render(<Harness />));
    advance();
  }

  it('maximizes and restores the same canvas without losing manual positions or selection', () => {
    maximizableCanvas();
    choose('manual');
    act(() => useGraphStore.getState().selectNode('first'));
    advance();
    const element = canvas(), original = savedPositions();
    const maximize = host.querySelector<HTMLButtonElement>('button[aria-label="Maximize canvas"]');
    expect(maximize).not.toBeNull();
    act(() => maximize!.click());
    resize(1600, 1000);
    expect(canvas()).toBe(element);
    expect(canvas().dataset.canvasMaximized).toBe('true');
    expect(host.querySelector('.planner-canvas-toolbar')?.closest('[hidden]')).not.toBeNull();
    const controls = host.querySelector<HTMLButtonElement>('[aria-label="Show controls"]');
    expect(controls).not.toBeNull();
    act(() => controls!.click());
    expect(host.querySelector('.planner-canvas-toolbar')?.closest('[hidden]')).toBeNull();
    act(() => controls!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(canvas().dataset.canvasMaximized).toBe('true');
    expect(host.querySelector('.planner-canvas-toolbar')?.closest('[hidden]')).not.toBeNull();
    expect(savedPositions()).toEqual(original);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })));
    expect(canvas()).toBe(element);
    expect(canvas().dataset.canvasMaximized).toBe('false');
    expect(useGraphStore.getState().selectedNodeId).toBe('first');
    expect(savedPositions()).toEqual(original);
  });

  it('lets open dialogs and visual popups handle Escape before restoring the canvas', () => {
    maximizableCanvas();
    const maximize = host.querySelector<HTMLButtonElement>('button[aria-label="Maximize canvas"]');
    expect(maximize).not.toBeNull();
    act(() => maximize!.click());
    const overlay = document.createElement('section');
    document.body.append(overlay);
    try {
      for (const attribute of ['aria-modal', 'data-visual-popup']) {
        overlay.setAttribute(attribute, 'true');
        act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })));
        expect(canvas().dataset.canvasMaximized).toBe('true');
        overlay.removeAttribute(attribute);
      }
      const handled = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      handled.preventDefault();
      act(() => window.dispatchEvent(handled));
      expect(canvas().dataset.canvasMaximized).toBe('true');
    } finally { overlay.remove(); }
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })));
    expect(canvas().dataset.canvasMaximized).toBe('false');
  });

  it('closes a visual popup first even when Escape comes from outside the popup', () => {
    maximizableCanvas();
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Maximize canvas"]')!.click());
    const popup = document.createElement('section');
    popup.dataset.visualPopup = 'search'; document.body.append(popup);
    useVisualPopupStore.getState().open('search');
    try {
      act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })));
      expect(useVisualPopupStore.getState().searchOpen).toBe(false);
      expect(canvas().dataset.canvasMaximized).toBe('true');
    } finally {
      popup.remove(); useVisualPopupStore.getState().close('search');
    }
  });

  it('keeps visual artifacts outside concept layout and routes their position changes separately', () => {
    const before = savedPositions();
    flow.setViewport.mockClear();
    flow.initialized = false;
    act(() => useGraphStore.setState(state => ({ project: { ...state.project!, visuals: {
      version: 1, mode: 'approval', proposals: [], drafts: { search: { text: '', mentions: [], attachments: [] }, model: { text: '', mentions: [], attachments: [] } },
      artifacts: [{ id: 'photo', label: 'ESP32', kind: 'image', x: 900, y: 600, width: 280, height: 220, mediaId: 'test-photo', source: null, scene: null, revisions: [{ scene: null, mediaId: 'test-photo', createdAt: 1 }], revisionIndex: 0 }],
    } } })));
    flow.initialized = true;
    act(() => useGraphStore.setState(state => ({ project: { ...state.project!, name: 'Photo measured' } })));
    advance();
    expect(flow.setViewport).not.toHaveBeenCalled();
    const visual = flow.props!.nodes.find(node => node.id === 'visual:photo');
    expect(visual?.type).toBe('visual');
    expect(visual?.dragHandle).toBe('.visual-drag-surface');
    // React Flow adds 1000 for a selected node. Concepts stay clickable above images.
    expect(visual!.zIndex! + 1000).toBeLessThan(0);
    act(() => flow.props!.onNodesChange([{ id: 'visual:photo', type: 'select', selected: true }]));
    act(() => flow.props!.onNodeDragStart(undefined, visual));
    expect(canvas().dataset.layoutMode).toBe('auto');
    flow.setViewport.mockClear();
    act(() => flow.props!.onNodesChange([{ id: 'visual:photo', type: 'position', position: { x: 860, y: 580 }, dragging: true }]));
    expect(flow.props!.nodes.find(node => node.id === 'visual:photo')!.position).toEqual({ x: 860, y: 580 });
    expect(useGraphStore.getState().project!.visuals!.artifacts[0].x).toBe(900);
    act(() => flow.props!.onNodesChange([{ id: 'visual:photo', type: 'position', position: { x: 840, y: 570 }, dragging: false }]));
    advance();
    expect(useGraphStore.getState().project!.visuals!.artifacts[0].x).toBe(840);
    expect(savedPositions()).toEqual(before);
    expect(flow.props!.nodes.find(node => node.id === 'visual:photo')!.selected).toBe(true);
    expect(flow.setViewport).not.toHaveBeenCalled();
    act(() => flow.props!.onNodesChange([{ id: 'visual:photo', type: 'dimensions', dimensions: { width: 320, height: 260 }, setAttributes: true, resizing: true }]));
    act(() => useGraphStore.setState(state => ({ project: { ...state.project!, name: 'Edited during resize' } })));
    expect(flow.props!.nodes.find(node => node.id === 'visual:photo')).toMatchObject({ width: 320, height: 260, resizing: true, selected: true });
  });
  it('uses the measured canvas orientation and fits the graph without writing project coordinates', () => {
    const original = fixture();
    expect(canvas().dataset.layoutMode).toBe('auto');
    expect(canvas().dataset.orientation).toBe('horizontal');
    expect(positions().first.x).toBeGreaterThan(positions().root.x);
    expect(positions().first.y).toBeLessThan(positions().second.y);
    expectGraphInsideCanvas();

    flow.setViewport.mockClear();
    resize(480, 850);
    expect(canvas().dataset.orientation).toBe('vertical');
    expect(positions().first.y).toBeGreaterThan(positions().root.y);
    expect(positions().first.x).toBeLessThan(positions().second.x);
    expect(flow.setViewport).toHaveBeenCalled();
    expectGraphInsideCanvas();
    expect(useGraphStore.getState().project).toEqual(original);
  });

  it('keeps a visual selection exclusive after edits and releases it when selecting a concept', () => {
    act(() => useGraphStore.setState(state => ({ project: { ...state.project!, visuals: {
      version: 1, mode: 'approval', proposals: [], drafts: { search: { text: '', mentions: [], attachments: [] }, model: { text: '', mentions: [], attachments: [] } },
      artifacts: [{ id: 'photo', label: 'ESP32', kind: 'image', linkedNodeId: 'first', x: 900, y: 600, width: 280, height: 220, mediaId: 'test-photo', source: null, scene: null, revisions: [{ scene: null, mediaId: 'test-photo', createdAt: 1 }], revisionIndex: 0 }],
    } }, selectedNodeId: 'first' })));
    act(() => flow.props!.onNodesChange([{ id: 'first', type: 'select', selected: false }, { id: 'visual:photo', type: 'select', selected: true }]));
    act(() => useGraphStore.setState(state => ({ project: { ...state.project!, name: 'Edited with image selected' } })));
    expect(flow.props!.nodes.filter(node => node.selected).map(node => node.id)).toEqual(['visual:photo']);
    act(() => flow.props!.onNodesChange([{ id: 'first', type: 'select', selected: true }]));
    expect(flow.props!.nodes.filter(node => node.selected).map(node => node.id)).toEqual(['first']);
    const imagePosition = positions()['visual:photo'];
    act(() => flow.props!.onNodeDragStart(undefined, flow.props!.nodes.find(node => node.id === 'first')));
    act(() => flow.props!.onNodesChange([{ id: 'first', type: 'position', position: { x: 200, y: 180 }, dragging: false }]));
    expect(positions()['visual:photo']).toEqual(imagePosition);
    expect(useGraphStore.getState().project!.visuals!.artifacts[0]).toMatchObject({ x: 900, y: 600, linkedNodeId: 'first' });
    act(() => flow.props!.onNodesChange([{ id: 'first', type: 'select', selected: false }, { id: 'visual:photo', type: 'select', selected: true }]));
    act(() => flow.props!.onNodeDragStart(undefined, flow.props!.nodes.find(node => node.id === 'second')));
    expect(useGraphStore.getState().selectedNodeId).toBe('second');
    expect(flow.props!.nodes.filter(node => node.selected).map(node => node.id)).toEqual(['second']);
  });

  it('renders an optional dashed reference link without adding a plan dependency or moving objects', () => {
    act(() => useGraphStore.setState(state => ({ project: { ...state.project!, visuals: {
      version: 1, mode: 'approval', proposals: [], drafts: { search: { text: '', mentions: [], attachments: [] }, model: { text: '', mentions: [], attachments: [] } },
      artifacts: [{ id: 'photo', label: 'ESP32', kind: 'image', linkedNodeId: 'first', x: 900, y: 600, width: 280, height: 220, mediaId: 'test-photo', source: null, scene: null, revisions: [{ scene: null, mediaId: 'test-photo', createdAt: 1 }], revisionIndex: 0 }],
    } } })));
    expect(flow.props!.edges.find(edge => edge.id === 'visual-link:photo')).toMatchObject({ source: 'first', target: 'visual:photo', type: 'visualLink', style: { strokeDasharray: '6 5' }, selectable: false, deletable: false });
    const before = positions();
    const dependencies = useGraphStore.getState().project!.edges;
    act(() => setVisualArtifactLink('photo', null));
    expect(flow.props!.edges.some(edge => edge.id === 'visual-link:photo')).toBe(false);
    expect(positions()).toEqual(before);
    expect(useGraphStore.getState().project!.edges).toEqual(dependencies);
  });

  it('connects a decomposed model to its original without a redundant concept triangle', () => {
    const photo = { id: 'photo', label: 'Arduino', kind: 'image' as const, linkedNodeId: 'first', x: 900, y: 600, width: 280, height: 220, mediaId: 'test-photo', source: null, scene: null, revisions: [{ scene: null, mediaId: 'test-photo', createdAt: 1 }], revisionIndex: 0 };
    const component = { ...photo, id: 'parts', label: 'Arduino parts', sourceArtifactId: photo.id, x: 1250 };
    act(() => useGraphStore.setState(state => ({ project: { ...state.project!, visuals: {
      version: 1, mode: 'approval', proposals: [], drafts: { search: { text: '', mentions: [], attachments: [] }, model: { text: '', mentions: [], attachments: [] } },
      artifacts: [photo, component],
    } } })));
    const dependencies = useGraphStore.getState().project!.edges;
    expect(flow.props!.edges.filter(edge => edge.type === 'visualLink')).toHaveLength(2);
    expect(flow.props!.edges.find(edge => edge.id === 'visual-link:photo')).toMatchObject({ source: 'first', target: 'visual:photo' });
    expect(flow.props!.edges.find(edge => edge.id === 'visual-link:parts')).toMatchObject({
      source: 'visual:photo', target: 'visual:parts', sourceHandle: 'visual-origin', targetHandle: 'visual-link', type: 'visualLink',
      selectable: false, deletable: false, style: { strokeDasharray: '6 5' },
    });
    expect(flow.props!.edges.some(edge => edge.source === 'first' && edge.target === 'visual:parts')).toBe(false);
    expect(useGraphStore.getState().project!.edges).toEqual(dependencies);
    act(() => useGraphStore.setState(state => ({ project: { ...state.project!, visuals: { ...state.project!.visuals!, artifacts: [component] } } })));
    expect(flow.props!.edges.find(edge => edge.id === 'visual-link:parts')).toMatchObject({ source: 'first', target: 'visual:parts' });
    expect(flow.props!.nodes.find(node => node.id === 'visual:parts')?.position).toEqual({ x: 1250, y: 600 });
  });

  it('does not recenter a mobile canvas while selecting another concept through a drag', () => {
    flow.mobile = true;
    resize(480, 850);
    choose('manual');
    flow.setViewport.mockClear();
    act(() => flow.props!.onNodeDragStart(undefined, flow.props!.nodes.find(node => node.id === 'second')));
    advance();
    expect(useGraphStore.getState().selectedNodeId).toBe('second');
    expect(flow.setViewport).not.toHaveBeenCalled();
  });

  it('keeps a forced orientation while continuing to fit a resized canvas', () => {
    choose('horizontal');
    const horizontal = positions();
    flow.setViewport.mockClear();
    resize(480, 850);
    expect(canvas().dataset.layoutMode).toBe('horizontal');
    expect(canvas().dataset.orientation).toBe('horizontal');
    expect(positions()).toEqual(horizontal);
    expect(flow.setViewport).toHaveBeenCalled();
    expectGraphInsideCanvas();
  });

  it('freezes displayed positions and edge orientation when selecting Manual, then leaves the camera alone on resize', () => {
    const displayed = positions();
    const routes = edgeRoutes();
    choose('manual');
    const manual = positions();
    const savedAt = useGraphStore.getState().project!.updatedAt;
    expect(manual).toEqual(displayed);
    expect(manual).toEqual(savedPositions());
    expect(useGraphStore.getState().project!.manualLayout).toBe(true);
    expect(edgeRoutes()).toEqual(routes);
    flow.setViewport.mockClear();
    resize(480, 850);
    expect(canvas().dataset.layoutMode).toBe('manual');
    expect(positions()).toEqual(manual);
    expect(edgeRoutes()).toEqual(routes);
    expect(flow.setViewport).not.toHaveBeenCalled();
    expect(useGraphStore.getState().project!.updatedAt).toBe(savedAt);
  });

  it('cancels a queued resize fit when dragging switches into Manual before its timer runs', () => {
    flow.setViewport.mockClear();
    act(() => { width = 480; height = 850; notifyResize(); });
    act(() => flow.props!.onNodeDragStart());
    advance();
    expect(canvas().dataset.layoutMode).toBe('manual');
    expect(flow.setViewport).not.toHaveBeenCalled();
  });

  it('reserves room for larger measured cards and retains that envelope after smaller semantic zoom measurements', () => {
    const original = fixture();
    const initial = positions();
    act(() => flow.props!.onNodesChange([
      { type: 'dimensions', id: 'root', dimensions: { width: 600, height: 160 } },
      { type: 'dimensions', id: 'first', dimensions: { width: 300, height: 420 } },
      { type: 'dimensions', id: 'second', dimensions: { width: 300, height: 500 } },
    ]));
    advance();
    const enlarged = positions();
    expect(enlarged.first.x).toBeGreaterThan(initial.first.x);
    expect(enlarged.second.y - enlarged.first.y).toBeGreaterThanOrEqual(420);
    for (const [index, node] of flow.props!.nodes.entries()) {
      for (const other of flow.props!.nodes.slice(index + 1)) {
        const size = flow.measured[node.id] ?? DEFAULT_NODE_DIMENSIONS;
        const otherSize = flow.measured[other.id] ?? DEFAULT_NODE_DIMENSIONS;
        const separated = node.position.x + size.width <= other.position.x || other.position.x + otherSize.width <= node.position.x
          || node.position.y + size.height <= other.position.y || other.position.y + otherSize.height <= node.position.y;
        expect(separated).toBe(true);
      }
    }
    expect(useGraphStore.getState().project).toEqual(original);

    act(() => flow.props!.onNodesChange([
      { type: 'dimensions', id: 'root', dimensions: { width: 250, height: 120 } },
      { type: 'dimensions', id: 'first', dimensions: { width: 250, height: 120 } },
      { type: 'dimensions', id: 'second', dimensions: { width: 250, height: 120 } },
    ]));
    advance();
    expect(positions()).toEqual(enlarged);
    expect(useGraphStore.getState().project).toEqual(original);
  });

  it('freezes every displayed coordinate on drag before persisting the moved card', () => {
    const beforeDrag = positions();
    expect(beforeDrag).not.toEqual(savedPositions());
    act(() => flow.props!.onNodeDragStart());
    expect(canvas().dataset.layoutMode).toBe('manual');
    expect(positions()).toEqual(beforeDrag);
    expect(savedPositions()).toEqual(beforeDrag);

    const moved = { x: beforeDrag.first.x + 95, y: beforeDrag.first.y + 32 };
    act(() => flow.props!.onNodesChange([{ type: 'position', id: 'first', position: moved, dragging: false }]));
    expect(savedPositions()).toEqual({ ...beforeDrag, first: moved });
    expect(positions()).toEqual({ ...beforeDrag, first: moved });
    expect(useGraphStore.getState().project!.manualLayout).toBe(true);
    flow.setViewport.mockClear();
    resize(480, 850);
    expect(positions()).toEqual({ ...beforeDrag, first: moved });
    expect(flow.setViewport).not.toHaveBeenCalled();
  });
});
