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
vi.mock('@xyflow/react', () => ({ useViewport: () => ({ x: 0, y: 0, zoom: 1 }), useReactFlow: () => ({ screenToFlowPosition: (point: { x: number; y: number }) => point }) }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useWorkspaceStore.setState({ activeProjectId: null });
  useGraphStore.getState().loadDemoProject();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  function Harness() { const ref = useRef<HTMLDivElement>(null), project = useGraphStore(state => state.project)!; return <div ref={ref}><PlannerInkLayer project={project} containerRef={ref} /></div>; }
  act(() => root.render(<Harness />));
});
afterEach(() => { act(() => root.unmount()); configureLiveInk(null); host.remove(); vi.restoreAllMocks(); });
const click = (name: string) => act(() => Simulate.click(host.querySelector(`[aria-label="${name}"]`)!));
function pointer(type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel', x: number, y: number) {
  act(() => Simulate[type](host.querySelector('[data-planner-ink]')!, { pointerId: 1, clientX: x, clientY: y, button: 0, pressure: .7, pointerType: 'pen' } as never));
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
it('cancels partial strokes and restores map interaction when the palette closes', () => {
  click('Desenhar no plano');
  pointer('pointerDown', 20, 20); pointer('pointerMove', 70, 50); pointer('pointerCancel', 70, 50);
  expect(useGraphStore.getState().project!.visuals?.ink).toBeUndefined();
  click('Voltar ao mapa');
  expect(host.querySelector<HTMLElement>('[data-planner-ink]')!.style.pointerEvents).toBe('none');
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
