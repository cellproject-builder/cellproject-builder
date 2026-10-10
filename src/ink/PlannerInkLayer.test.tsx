import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { PlannerInkLayer } from './PlannerInkLayer';
import { configureLiveInk, LiveInkChannel } from './live';
import type { VaultSession } from '@/cloud/vault/crypto';
import { hasActiveDataIngestions } from '@/cloud/activity';
const flow = vi.hoisted(() => ({ viewport: { x: 0, y: 0, zoom: 1 }, setViewport: vi.fn() }));
vi.mock('@xyflow/react', () => ({ useViewport: () => flow.viewport, useReactFlow: () => ({ screenToFlowPosition: (point: { x: number; y: number }) => ({ x: (point.x - flow.viewport.x) / flow.viewport.zoom, y: (point.y - flow.viewport.y) / flow.viewport.zoom }), getViewport: () => ({ ...flow.viewport }), setViewport: flow.setViewport }) }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  flow.viewport = { x: 0, y: 0, zoom: 1 }; flow.setViewport.mockReset(); flow.setViewport.mockImplementation(value => { flow.viewport = value; return Promise.resolve(true); });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useWorkspaceStore.setState({ activeProjectId: null });
  useGraphStore.getState().loadDemoProject();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  function Harness() { const ref = useRef<HTMLDivElement>(null), project = useGraphStore(state => state.project)!; return <div ref={ref}><PlannerInkLayer project={project} containerRef={ref} /></div>; }
  act(() => root.render(<Harness />));
});
afterEach(() => { act(() => root.unmount()); configureLiveInk(null); host.remove(); vi.restoreAllMocks(); });
const click = (name: string) => { if (!host.querySelector(`button[aria-label="${name}"]`) && host.querySelector('[data-ink-palette-trigger]')) act(() => Simulate.click(host.querySelector('[data-ink-palette-trigger]')!)); act(() => Simulate.click(host.querySelector(`button[aria-label="${name}"]`)!)); };
function pointer(type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel' | 'lostPointerCapture', x: number, y: number, extra: Record<string, unknown> = {}) {
  act(() => Simulate[type](host.querySelector('[data-planner-ink]')!, { pointerId: 1, clientX: x, clientY: y, button: 0, pressure: .7, pointerType: 'pen', isPrimary: true, ...extra } as never));
}
it('adds reversible free ink in plan world coordinates without moving or changing plan nodes', () => {
  const nodes = useGraphStore.getState().project!.nodes;
  click('Desenhar no plano'); click('Marca-texto');
  pointer('pointerDown', -30, 10); pointer('pointerMove', 70, 50);
  expect(useGraphStore.getState().project!.visuals?.ink).toBeUndefined();
  pointer('pointerUp', 70, 50);
  expect(useGraphStore.getState().project!.visuals!.ink!.strokes[0]).toMatchObject({ x: -30, y: 10, tool: 'highlighter', opacity: .28 });
  expect(useGraphStore.getState().project!.nodes).toBe(nodes);
  click('Desfazer tinta'); expect(useGraphStore.getState().project!.visuals!.ink!.strokes).toHaveLength(0);
  click('Refazer tinta'); expect(useGraphStore.getState().project!.visuals!.ink!.strokes).toHaveLength(1);
});
it('pans and pinches with touch in drawing mode without editing nodes or holding refresh', () => {
  const project = useGraphStore.getState().project!;
  click('Desenhar no plano');
  pointer('pointerDown', 100, 100, { pointerType: 'touch' });
  pointer('pointerMove', 130, 120, { pointerType: 'touch' });
  expect(flow.viewport).toEqual({ x: 30, y: 20, zoom: 1 });
  pointer('pointerDown', 230, 120, { pointerId: 2, pointerType: 'touch', isPrimary: false });
  pointer('pointerMove', 330, 120, { pointerId: 2, pointerType: 'touch', isPrimary: false });
  expect(flow.viewport.zoom).toBe(2);
  pointer('pointerUp', 130, 120, { pointerType: 'touch' }); pointer('pointerUp', 330, 120, { pointerId: 2, pointerType: 'touch' });
  expect(useGraphStore.getState().project).toBe(project); expect(hasActiveDataIngestions()).toBe(false);
});
it('opts into finger ink and atomically cancels it for pinch until every finger lifts', () => {
  click('Desenhar no plano');
  click('Ferramentas do plano');
  const checkbox = host.querySelector<HTMLInputElement>('[aria-label="Desenhar com dedo"]'); expect(checkbox).not.toBeNull();
  act(() => Simulate.change(checkbox!, { target: { checked: true } } as never));
  pointer('pointerDown', 10, 10, { pointerType: 'touch' }); pointer('pointerMove', 40, 40, { pointerType: 'touch' });
  expect(hasActiveDataIngestions()).toBe(true);
  pointer('pointerDown', 80, 40, { pointerId: 2, pointerType: 'touch', isPrimary: false });
  expect(hasActiveDataIngestions()).toBe(false);
  pointer('pointerMove', 120, 40, { pointerId: 2, pointerType: 'touch' });
  pointer('pointerUp', 120, 40, { pointerId: 2, pointerType: 'touch' }); pointer('pointerMove', 60, 40, { pointerType: 'touch' }); pointer('pointerUp', 60, 40, { pointerType: 'touch' });
  expect(useGraphStore.getState().project!.visuals?.ink).toBeUndefined(); expect(flow.setViewport).toHaveBeenCalled();
  pointer('pointerDown', 20, 20, { pointerType: 'touch' }); pointer('pointerUp', 40, 30, { pointerType: 'touch' });
  expect(useGraphStore.getState().project!.visuals!.ink!.strokes).toHaveLength(1);
});
it('preserves the first touch capture when finger ink becomes pinch, and cancels real capture loss', () => {
  click('Desenhar no plano'); click('Ferramentas do plano');
  act(() => Simulate.change(host.querySelector('[aria-label="Desenhar com dedo"]')!, { target: { checked: true } } as never));
  const stage = host.querySelector<HTMLElement>('[data-planner-ink]')!, owned = new Set<number>();
  const release = vi.fn((id: number) => { owned.delete(id); pointer('lostPointerCapture', 0, 0, { pointerId: id, pointerType: 'touch' }); });
  Object.assign(stage, { setPointerCapture: (id: number) => owned.add(id), hasPointerCapture: (id: number) => owned.has(id), releasePointerCapture: release });
  pointer('pointerDown', 10, 10, { pointerType: 'touch' }); pointer('pointerMove', 40, 40, { pointerType: 'touch' });
  pointer('pointerDown', 80, 40, { pointerId: 2, pointerType: 'touch', isPrimary: false }); expect(release).not.toHaveBeenCalled();
  pointer('pointerMove', 120, 40, { pointerId: 2, pointerType: 'touch' }); expect(flow.viewport.zoom).toBe(2);
  pointer('lostPointerCapture', 40, 40, { pointerType: 'touch' }); const calls = flow.setViewport.mock.calls.length;
  pointer('pointerMove', 140, 40, { pointerId: 2, pointerType: 'touch' }); expect(flow.setViewport).toHaveBeenCalledTimes(calls);
  expect(useGraphStore.getState().project!.visuals?.ink).toBeUndefined();
});
it('keeps pen palm movement out of the viewport and cancels ownership on blur', () => {
  click('Desenhar no plano'); pointer('pointerDown', 20, 20);
  pointer('pointerDown', 100, 100, { pointerId: 2, pointerType: 'touch' }); pointer('pointerMove', 200, 200, { pointerId: 2, pointerType: 'touch' });
  expect(flow.setViewport).not.toHaveBeenCalled();
  act(() => window.dispatchEvent(new Event('blur'))); pointer('pointerUp', 40, 30);
  expect(hasActiveDataIngestions()).toBe(false); expect(useGraphStore.getState().project!.visuals?.ink).toBeUndefined();
});
it('cancels partial strokes and restores map interaction when the palette closes', () => {
  click('Desenhar no plano');
  pointer('pointerDown', 20, 20); pointer('pointerMove', 70, 50); pointer('pointerCancel', 70, 50);
  expect(useGraphStore.getState().project!.visuals?.ink).toBeUndefined();
  click('Voltar ao mapa');
  expect(host.querySelector<HTMLElement>('[data-planner-ink]')!.style.pointerEvents).toBe('none');
});
it.each(['pointerCancel', 'lostPointerCapture'] as const)('ignores secondary %s while the active pen finishes one stroke', type => {
  click('Desenhar no plano');
  pointer('pointerDown', 20, 20); pointer('pointerMove', 40, 30);
  pointer('pointerDown', 200, 200, { pointerId: 2, pointerType: 'touch', isPrimary: false });
  pointer(type, 200, 200, { pointerId: 2, pointerType: 'touch', isPrimary: false });
  expect(hasActiveDataIngestions()).toBe(true);
  expect(useGraphStore.getState().project!.visuals?.ink).toBeUndefined();
  pointer('pointerMove', 60, 40); pointer('pointerUp', 80, 50); pointer('pointerUp', 80, 50);
  const strokes = useGraphStore.getState().project!.visuals!.ink!.strokes;
  expect(strokes).toHaveLength(1);
  expect(strokes[0]).toMatchObject({ x: 20, y: 20, points: [{ x: 0, y: 0, pressure: .7 }, { x: 20, y: 10, pressure: .7 }, { x: 40, y: 20, pressure: .7 }, { x: 60, y: 30, pressure: .7 }] });
  expect(hasActiveDataIngestions()).toBe(false);
});
it.each(['pointerCancel', 'lostPointerCapture'] as const)('discards the active pen on %s and allows another gesture', type => {
  click('Desenhar no plano'); pointer('pointerDown', 20, 20); pointer('pointerMove', 40, 30);
  expect(hasActiveDataIngestions()).toBe(true);
  pointer(type, 40, 30); pointer('pointerUp', 60, 40);
  expect(hasActiveDataIngestions()).toBe(false);
  expect(useGraphStore.getState().project!.visuals?.ink).toBeUndefined();
  pointer('pointerDown', 80, 50); pointer('pointerUp', 100, 60);
  expect(useGraphStore.getState().project!.visuals!.ink!.strokes).toHaveLength(1);
  expect(hasActiveDataIngestions()).toBe(false);
});
it('ignores nonprimary starts without holding refresh or blocking the next pen stroke', () => {
  click('Desenhar no plano');
  pointer('pointerDown', 200, 200, { pointerId: 2, pointerType: 'touch', isPrimary: false });
  expect(hasActiveDataIngestions()).toBe(false);
  pointer('pointerMove', 220, 220, { pointerId: 2, pointerType: 'touch', isPrimary: false });
  pointer('pointerUp', 240, 240, { pointerId: 2, pointerType: 'touch', isPrimary: false });
  expect(useGraphStore.getState().project!.visuals?.ink).toBeUndefined();
  pointer('pointerDown', 20, 20); pointer('pointerUp', 40, 30);
  expect(useGraphStore.getState().project!.visuals!.ink!.strokes).toHaveLength(1);
});
it('erases only ink and leaves plan topology unchanged', () => {
  const edges = useGraphStore.getState().project!.edges;
  click('Desenhar no plano'); pointer('pointerDown', 20, 20); pointer('pointerUp', 70, 50);
  click('Borracha'); pointer('pointerDown', 40, 32); pointer('pointerUp', 40, 32);
  expect(useGraphStore.getState().project!.visuals!.ink!.strokes).toHaveLength(0);
  expect(useGraphStore.getState().project!.edges).toBe(edges);
  click('Desfazer tinta'); expect(useGraphStore.getState().project!.visuals!.ink!.strokes).toHaveLength(1);
});
it('erases ink crossed between sparse and coalesced eraser samples without touching the plan', () => {
  const nodes = useGraphStore.getState().project!.nodes;
  click('Desenhar no plano'); pointer('pointerDown', 50, 10); pointer('pointerUp', 50, 30);
  click('Borracha'); pointer('pointerDown', 0, 20); pointer('pointerMove', 100, 20); pointer('pointerUp', 100, 20);
  expect(useGraphStore.getState().project!.visuals!.ink!.strokes).toHaveLength(0);
  click('Desfazer tinta'); expect(useGraphStore.getState().project!.visuals!.ink!.strokes).toHaveLength(1);
  pointer('pointerDown', 0, 20);
  act(() => Simulate.pointerMove(host.querySelector('[data-planner-ink]')!, { pointerId: 1, clientX: 0, clientY: 80, button: 0, pointerType: 'pen', nativeEvent: { getCoalescedEvents: () => [{ clientX: 100, clientY: 20, pointerType: 'pen' }] } } as never));
  pointer('pointerUp', 0, 80);
  expect(useGraphStore.getState().project!.visuals!.ink!.strokes).toHaveLength(0);
  expect(useGraphStore.getState().project!.nodes).toBe(nodes);
  expect(hasActiveDataIngestions()).toBe(false);
});
it('holds refresh until drawing or erasing ends and releases cancelled and unmounted gestures', () => {
  click('Desenhar no plano'); pointer('pointerDown',20,20); expect(hasActiveDataIngestions()).toBe(true);
  pointer('pointerUp',70,50); expect(hasActiveDataIngestions()).toBe(false);
  click('Borracha'); pointer('pointerDown',40,32); expect(hasActiveDataIngestions()).toBe(true);
  pointer('pointerCancel',40,32); expect(hasActiveDataIngestions()).toBe(false);
  pointer('pointerDown',40,32); act(()=>root.unmount()); expect(hasActiveDataIngestions()).toBe(false);
});
it('shows scoped remote ink before the palette opens and drops a ghost when its canonical stroke is saved', () => {
  const project=useGraphStore.getState().project!,channel=new LiveInkChannel({session:{} as VaultSession});
  vi.spyOn(channel,'getRemote').mockReturnValue([{gestureId:'remote-trace',sender:'tablet',scope:{surface:'planner',documentId:project.id},committed:false,stroke:{id:'remote-trace',x:-20,y:30,color:'#abcdef',width:3,points:[{x:0,y:0},{x:20,y:10}]}}]);
  act(()=>configureLiveInk(channel));expect(host.querySelector('[data-planner-remote-stroke="remote-trace"]')).not.toBeNull();
  act(()=>useGraphStore.setState({project:{...project,visuals:{...project.visuals!,ink:{version:1,strokes:[{id:'remote-trace',x:-20,y:30,color:'#abcdef',width:3,points:[{x:0,y:0},{x:20,y:10}]}]}}}}));
  expect(host.querySelector('[data-planner-remote-stroke="remote-trace"]')).toBeNull();
});
it('publishes one committed stroke using its persisted id and cancels a gesture when project context changes', () => {
  const project=useGraphStore.getState().project!,channel=new LiveInkChannel({session:{} as VaultSession}),preview=vi.spyOn(channel,'preview').mockImplementation(()=>{}),finish=vi.spyOn(channel,'finish').mockImplementation(()=>{});
  act(()=>configureLiveInk(channel));click('Desenhar no plano');pointer('pointerDown',-20,10);pointer('pointerUp',60,70);
  const stroke=useGraphStore.getState().project!.visuals!.ink!.strokes[0];expect(preview).toHaveBeenCalled();expect(finish).toHaveBeenCalledTimes(1);expect(finish).toHaveBeenCalledWith({surface:'planner',documentId:project.id},stroke.id,false);
  pointer('pointerDown',10,20);act(()=>useGraphStore.setState({project:{...useGraphStore.getState().project!,id:'different-plan'}}));
  expect(finish).toHaveBeenLastCalledWith({surface:'planner',documentId:project.id},expect.any(String),true);expect(hasActiveDataIngestions()).toBe(false);
});
