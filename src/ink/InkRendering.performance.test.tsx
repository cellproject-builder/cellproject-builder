import { act, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NoteCanvas } from '@/workspace/NoteCanvas';
import { NoteInkOverlay } from '@/workspace/NoteInkOverlay';
import { createNoteCanvas, type NoteCanvasDocument } from '@/workspace/noteCanvasModel';
import { createNoteInk } from '@/workspace/noteInkModel';
import { useWorkspaceStore } from '@/workspace/store';
import { useGraphStore } from '@/store';
import { BoardCanvas } from '@/boards/BoardCanvas';
import { PlannerInkLayer } from './PlannerInkLayer';
import { InkStroke } from './InkStroke';
import type { InkStrokeData } from './model';

// Observe the real stroke component's useId hook; rendering and geometry are
// unchanged. IDs let the counter distinguish saved ink from tools and previews.
const visits = vi.hoisted(() => new Map<string, number>());
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  return { ...actual, useId: () => { const id = actual.useId(); const key = id.replaceAll(':', ''); visits.set(key, (visits.get(key) ?? 0) + 1); return id; } };
});
const live = vi.hoisted(() => ({ preview: vi.fn(), finish: vi.fn(), remote: [] }));
vi.mock('./live', () => ({ useLiveInk: () => live }));
const flow = vi.hoisted(() => ({ viewport: { x: 0, y: 0, zoom: 1 } }));
vi.mock('@xyflow/react', async original => ({
  ...await original<typeof import('@xyflow/react')>(),
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
  ReactFlow: ({ nodes, nodeTypes, children }: { nodes: Array<{ id: string; data: unknown; selected: boolean; width: number; height: number }>; nodeTypes: { board: React.ComponentType<any> }; children: ReactNode }) => <div>{nodes.map(node => { const Item = nodeTypes.board; return <Item key={node.id} {...node} />; })}{children}</div>,
  Handle: () => null, NodeResizer: () => null, NodeToolbar: () => null, Background: () => null,
  useViewport: () => flow.viewport,
  useReactFlow: () => ({ screenToFlowPosition: (point: { x: number; y: number }) => point, getViewport: () => flow.viewport }),
}));
vi.mock('@/boards/BoardComposer', () => ({ BoardComposer: () => null }));

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  visits.clear(); live.preview.mockClear(); live.finish.mockClear();
  useWorkspaceStore.setState({ activeProjectId: null, activeBoardId: null, notes: {}, projects: {}, boards: {} });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
function strokes(count = 100) {
  return Array.from({ length: count }, (_, index) => ({ id: `saved-${index}`, tool: 'pencil' as const, color: '#a78bfa', width: 2, opacity: .65, points: [{ x: 10 + index, y: 10 }, { x: 20 + index, y: 20 }] }));
}
function counters(selector: string) {
  return [...host.querySelectorAll<SVGPathElement>(selector)].map(path => {
    const key = path.getAttribute('filter')!.slice('url(#ink-grain-'.length, -1);
    return [key, visits.get(key)!] as const;
  });
}
function expectUnchanged(before: ReturnType<typeof counters>) {
  expect(before).toHaveLength(100);
  expect(before.map(([key, count]) => (visits.get(key) ?? 0) - count)).toEqual(Array(100).fill(0));
}
function pointer(stage: Element, type: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number) {
  act(() => Simulate[type](stage, { pointerId: 1, button: 0, isPrimary: true, pointerType: 'pen', pressure: .6, clientX: x, clientY: y } as never));
}
function moveSeveral(stage: Element) { for (let index = 0; index < 5; index++) pointer(stage, 'pointerMove', 300 + index * 10, 300 + index * 10); }

it('reuses completed notebook strokes during pointer movement while preview keeps growing', () => {
  let latest: NoteCanvasDocument;
  function Harness() {
    const [doc, setDoc] = useState<NoteCanvasDocument>({ ...createNoteCanvas(), strokes: strokes() }); latest = doc;
    return <NoteCanvas document={doc} onChange={setDoc} drawing onDrawingChange={() => {}} onAddImage={() => {}} onGenerate={() => {}} />;
  }
  act(() => root.render(<Harness />));
  const stage = host.querySelector('[data-note-canvas]')!;
  pointer(stage, 'pointerDown', 250, 250);
  const before = counters('[data-note-stroke^="saved-"]'); moveSeveral(stage);
  expectUnchanged(before);
  expect(host.querySelectorAll('[data-note-stroke]')).toHaveLength(101);
  pointer(stage, 'pointerUp', 360, 360);
  expect(latest!.strokes).toHaveLength(101); expect(latest!.strokes.at(-1)!.points.length).toBeGreaterThan(2);
});

it('reuses completed document overlay strokes during pointer movement', () => {
  const id = useWorkspaceStore.getState().createNote({ title: 'Ink performance' });
  useWorkspaceStore.getState().updateNote(id, { ink: { ...createNoteInk(), strokes: strokes() } });
  function Harness() {
    const note = useWorkspaceStore(state => state.notes[id]), bodyRef = useRef<HTMLDivElement>(null), toolsRef = useRef<HTMLDivElement>(null);
    return <div className="ws-note-editor"><div ref={toolsRef} /><div className="ws-note-paper"><div className="ws-note-document" ref={bodyRef}><NoteInkOverlay note={note} bodyRef={bodyRef} toolsRef={toolsRef} drawing onDrawingChange={() => {}} /></div></div></div>;
  }
  act(() => root.render(<Harness />));
  const stage = host.querySelector('[data-note-ink]')!;
  pointer(stage, 'pointerDown', 250, 250);
  const before = counters('[data-note-ink-stroke^="saved-"]'); moveSeveral(stage);
  expectUnchanged(before);
  pointer(stage, 'pointerUp', 360, 360);
  expect(useWorkspaceStore.getState().notes[id].ink!.strokes).toHaveLength(101);
});

it('reuses completed planner strokes during pointer movement without touching nodes', () => {
  useGraphStore.getState().loadDemoProject();
  useGraphStore.setState(state => ({ project: { ...state.project!, visuals: { ...state.project!.visuals!, ink: { version: 1, strokes: strokes().map(stroke => ({ ...stroke, x: 0, y: 0 })) } } } }));
  const nodes = useGraphStore.getState().project!.nodes;
  function Harness() { const project = useGraphStore(state => state.project)!, containerRef = useRef<HTMLDivElement>(null); return <div ref={containerRef}><PlannerInkLayer project={project} containerRef={containerRef} /></div>; }
  act(() => root.render(<Harness />));
  act(() => Simulate.click(host.querySelector('[aria-label="Desenhar no plano"]')!));
  const stage = host.querySelector('[data-planner-ink]')!;
  pointer(stage, 'pointerDown', 250, 250);
  const before = counters('[data-planner-stroke^="saved-"]'); moveSeveral(stage);
  expectUnchanged(before);
  pointer(stage, 'pointerUp', 360, 360);
  expect(useGraphStore.getState().project!.visuals!.ink!.strokes).toHaveLength(101);
  expect(useGraphStore.getState().project!.nodes).toBe(nodes);
});

it('keeps completed board items mounted and reuses their strokes during drawing', () => {
  const id = useWorkspaceStore.getState().createBoard('Ink performance');
  const items = strokes().map(stroke => ({ ...stroke, kind: 'drawing' as const, x: 0, y: 0, width: 200, height: 100, widthStroke: stroke.width }));
  useWorkspaceStore.getState().updateBoard(id, { document: { version: 1, items, edges: [], viewport: { x: 0, y: 0, zoom: 1 } } });
  act(() => root.render(<BoardCanvas boardId={id} onBack={() => {}} />));
  act(() => Simulate.click(host.querySelector('[aria-label="Desenhar"]')!));
  const stage = host.querySelector('.db-drawing-layer')!;
  pointer(stage, 'pointerDown', 250, 250);
  const paths = [...host.querySelectorAll('[data-board-stroke]')], before = counters('[data-board-stroke]'); moveSeveral(stage);
  expectUnchanged(before); expect([...host.querySelectorAll('[data-board-stroke]')]).toEqual(paths);
  pointer(stage, 'pointerUp', 360, 360);
  expect(useWorkspaceStore.getState().boards[id].document.items).toHaveLength(101);
});

it('updates edited geometry, selection, visibility and the latest pointer callback', () => {
  const initial = strokes(1)[0], first = vi.fn(), second = vi.fn();
  const render = (stroke: InkStrokeData, selected = false, shown = true, callback = first) => act(() => root.render(<svg>{shown && <InkStroke stroke={stroke} data-note-stroke="saved-0" selected={selected} onPointerDown={callback} />}</svg>));
  render(initial); const path = host.querySelector('path')!, original = path.getAttribute('d'), before = counters('[data-note-stroke]')[0];
  render(initial); expect(visits.get(before[0])).toBe(before[1]);
  render({ ...initial, points: [{ x: 100, y: 100 }, { x: 110, y: 110 }] }); expect(path.getAttribute('d')).not.toBe(original);
  render(initial, true, true, second); expect(path.classList.contains('is-selected')).toBe(true);
  act(() => Simulate.pointerDown(path)); expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledOnce();
  render(initial, false, false); expect(host.querySelector('path')).toBeNull();
});

it('selects a reused notebook path and deletes/restores that stroke after switching tools', () => {
  let latest: NoteCanvasDocument;
  function Harness() {
    const [doc, setDoc] = useState<NoteCanvasDocument>({ ...createNoteCanvas(), strokes: strokes(1) }); latest = doc;
    return <NoteCanvas document={doc} onChange={setDoc} drawing onDrawingChange={() => {}} onAddImage={() => {}} onGenerate={() => {}} />;
  }
  act(() => root.render(<Harness />));
  act(() => Simulate.click(host.querySelector('[data-ink-palette-trigger]')!));
  act(() => Simulate.click(host.querySelector('[aria-label="Selecionar"]')!));
  const stage = host.querySelector('[data-note-canvas]')!, path = host.querySelector('[data-note-stroke]')!;
  pointer(path, 'pointerDown', 10, 10); expect(path.classList.contains('is-selected')).toBe(true);
  act(() => Simulate.keyDown(stage, { key: 'Delete' })); expect(latest!.strokes).toHaveLength(0);
  act(() => Simulate.keyDown(stage, { key: 'z', ctrlKey: true })); expect(latest!.strokes).toHaveLength(1);
});

it('selects, moves and deletes a reused document stroke with reversible geometry', () => {
  const id = useWorkspaceStore.getState().createNote({ title: 'Move saved ink' }), original = strokes(1)[0];
  useWorkspaceStore.getState().updateNote(id, { ink: { ...createNoteInk(), strokes: [original] } });
  function Harness() {
    const note = useWorkspaceStore(state => state.notes[id]), bodyRef = useRef<HTMLDivElement>(null), toolsRef = useRef<HTMLDivElement>(null);
    return <div className="ws-note-editor"><div ref={toolsRef} /><div className="ws-note-paper"><div className="ws-note-document" ref={bodyRef}><NoteInkOverlay note={note} bodyRef={bodyRef} toolsRef={toolsRef} drawing onDrawingChange={() => {}} /></div></div></div>;
  }
  act(() => root.render(<Harness />));
  act(() => Simulate.click(host.querySelector('[data-ink-palette-trigger]')!));
  act(() => Simulate.click(host.querySelector('[aria-label="Laço de seleção na nota"]')!));
  const stage = host.querySelector('[data-note-ink]')!, path = host.querySelector('[data-note-ink-stroke]')!, before = path.getAttribute('d');
  pointer(path, 'pointerDown', 10, 10); expect(path.classList.contains('is-selected')).toBe(true);
  pointer(stage, 'pointerMove', 40, 30); pointer(stage, 'pointerUp', 40, 30);
  expect(useWorkspaceStore.getState().notes[id].ink!.strokes[0].points).toEqual([{ x: 40, y: 30 }, { x: 50, y: 40 }]);
  expect(path.getAttribute('d')).not.toBe(before);
  act(() => Simulate.keyDown(stage, { key: 'Delete' })); expect(useWorkspaceStore.getState().notes[id].ink!.strokes).toHaveLength(0);
  act(() => Simulate.keyDown(stage, { key: 'z', ctrlKey: true })); expect(useWorkspaceStore.getState().notes[id].ink!.strokes).toHaveLength(1);
  act(() => Simulate.keyDown(stage, { key: 'z', ctrlKey: true })); expect(useWorkspaceStore.getState().notes[id].ink!.strokes[0].points).toEqual(original.points);
});
