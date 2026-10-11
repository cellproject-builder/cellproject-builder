import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWorkspaceStore, flushWorkspacePersistence } from '@/workspace/store';
import { BoardCanvas } from './BoardCanvas';
import type { Node, NodeChange } from '@xyflow/react';
import { importNoteImage } from '@/workspace/noteImages';
import { readVisualMedia } from '@/visuals/media';
import { assertDataTransitionIdle, hasActiveDataIngestions, registerDataIngestion } from '@/cloud/activity';
import { configureLiveInk, LiveInkChannel } from '@/ink/live';
import type { VaultSession } from '@/cloud/vault/crypto';
import { applyRemoteCanvasDocuments } from '@/cloud/CloudLiveSync';
import { CloudRuntime, configureCloud } from '@/cloud/runtime';
vi.mock('@/workspace/noteImages',async original=>({...await original<typeof import('@/workspace/noteImages')>(),importNoteImage:vi.fn()}));
vi.mock('@/visuals/media',async original=>({...await original<typeof import('@/visuals/media')>(),readVisualMedia:vi.fn()}));
vi.mock('@/cloud/activity',async original=>{const actual=await original<typeof import('@/cloud/activity')>();return {...actual,registerDataIngestion:vi.fn(actual.registerDataIngestion)};});
const flow=vi.hoisted(()=>({props:null as unknown as {nodes:Node[];onNodesChange(changes:NodeChange[]):void;onNodeDragStop(event:unknown,node:Node,nodes:Node[]):void;onConnect(connection:{source:string;target:string}):void;onNodeClick(event:{target:Element;ctrlKey?:boolean}):void;onMoveEnd(event:MouseEvent|null|undefined,viewport:{x:number;y:number;zoom:number}):void},fitView:vi.fn(),setViewport:vi.fn(),viewport:{x:0,y:0,zoom:1}}));
vi.mock('@xyflow/react',async()=>{const actual=await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react');return {...actual,ReactFlowProvider:({children}:{children:ReactNode})=>children,ReactFlow:(props:typeof flow.props&{children:ReactNode})=>{flow.props=props;return <div data-flow>{props.children}</div>;},Background:()=>null,useViewport:()=>flow.viewport,useReactFlow:()=>({screenToFlowPosition:({x,y}:{x:number;y:number})=>({x:(x-flow.viewport.x)/flow.viewport.zoom,y:(y-flow.viewport.y)/flow.viewport.zoom}),getViewport:()=>flow.viewport,fitView:flow.fitView,zoomIn:vi.fn(),zoomOut:vi.fn(),setViewport:flow.setViewport})};});
vi.mock('./BoardItemNode',()=>({BoardItemNode:()=>null}));
vi.mock('./BoardComposer',()=>({BoardComposer:()=>null}));
vi.mock('@/visuals/rendering/VisualCanvasLayer',()=>({VisualCanvasLayer:()=>null}));
let host:HTMLDivElement,root:Root,id:string;
beforeEach(async()=>{await flushWorkspacePersistence();vi.clearAllMocks();flow.viewport={x:0,y:0,zoom:1};flow.setViewport.mockImplementation(async next=>{flow.viewport=next;return true;});(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;useWorkspaceStore.setState({boards:{},activeBoardId:null,projects:{},notes:{},surface:'boards'});id=useWorkspaceStore.getState().createBoard('Sketch');host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>root.render(<BoardCanvas boardId={id} onBack={vi.fn()}/>));});
afterEach(async()=>{act(()=>root.unmount());await flushWorkspacePersistence();configureLiveInk(null);configureCloud(null);host.remove();});
const openPalette=()=>{const trigger=host.querySelector<HTMLButtonElement>('[data-ink-palette-trigger]');if(trigger?.getAttribute('aria-expanded')==='false')act(()=>trigger.click());};
const click=(label:string)=>{if(!host.querySelector(`[aria-label="${label}"]`))openPalette();act(()=>Simulate.click(host.querySelector(`[aria-label="${label}"]`)!));};
const key=(key:string,options:Record<string,unknown>={})=>act(()=>Simulate.keyDown(host.querySelector('[data-board-canvas]')!,{key,...options}));
const items=()=>useWorkspaceStore.getState().boards[id].document.items;
const pointer=(type:'pointerDown'|'pointerMove'|'pointerUp'|'pointerCancel'|'lostPointerCapture',x:number,y:number,extra:Record<string,unknown>={})=>{const values={pointerId:1,button:0,isPrimary:true,clientX:x,clientY:y,pointerType:'mouse',...extra};act(()=>Simulate[type](host.querySelector('.db-drawing-layer')!,values));};
const cloudBoard=async()=>{
  await flushWorkspacePersistence();
  const state=useWorkspaceStore.persist.getOptions().partialize!(useWorkspaceStore.getState());
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json({revision:2}));
  const runtime=new CloudRuntime({documents:[{key:'cellproject-workspace',value:JSON.stringify({state,version:2}),revision:1}],media:[]},fetcher);
  configureCloud(runtime);return {runtime,fetcher};
};
it('does not write a workspace snapshot when an unchanged title loses focus before navigation',async()=>{
  const {fetcher}=await cloudBoard(),before=useWorkspaceStore.getState().boards[id];
  const input=host.querySelector<HTMLInputElement>('input[aria-label="Nome do quadro"]')!;
  act(()=>Simulate.blur(input));
  act(()=>{input.value=' Sketch ';Simulate.change(input);});
  act(()=>Simulate.blur(input));click('Voltar aos quadros');
  await flushWorkspacePersistence();
  expect(useWorkspaceStore.getState().boards[id]).toBe(before);expect(input.value).toBe('Sketch');
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([null,undefined])('does not write a workspace snapshot for a programmatic viewport callback with event %s',async event=>{
  const {fetcher}=await cloudBoard(),before=useWorkspaceStore.getState().boards[id];
  act(()=>flow.props.onMoveEnd(event,{x:80,y:90,zoom:2}));await flushWorkspacePersistence();
  expect(useWorkspaceStore.getState().boards[id]).toBe(before);expect(fetcher).not.toHaveBeenCalled();
});
it('does not write a workspace snapshot for an unchanged user viewport',async()=>{
  const {fetcher}=await cloudBoard(),before=useWorkspaceStore.getState().boards[id];
  act(()=>flow.props.onMoveEnd(new MouseEvent('mouseup'),{...before.document.viewport}));await flushWorkspacePersistence();
  expect(useWorkspaceStore.getState().boards[id]).toBe(before);expect(fetcher).not.toHaveBeenCalled();
});
it('saves a changed user viewport once and preserves the board contents',async()=>{
  click('Adicionar cartão');const {fetcher}=await cloudBoard(),before=items(),viewport={x:80,y:90,zoom:2};
  act(()=>flow.props.onMoveEnd(new MouseEvent('mouseup'),viewport));await flushWorkspacePersistence();
  expect(useWorkspaceStore.getState().boards[id].document.viewport).toEqual(viewport);expect(items()).toEqual(before);
  expect(fetcher).toHaveBeenCalledOnce();
});
it('pans a 100000 point board without reparsing or replacing its renderable contents',()=>{
  const document=useWorkspaceStore.getState().boards[id].document;
  act(()=>{useWorkspaceStore.getState().updateBoard(id,{document:{...document,items:Array.from({length:25},(_,index)=>({id:`ink-${index}`,kind:'drawing',x:0,y:0,width:100,height:100,points:Array.from({length:4000},(_,point)=>({x:point%100,y:Math.floor(point/100),pressure:.5})),color:'#abcdef',widthStroke:2}))}});});
  const before=useWorkspaceStore.getState().boards[id].document,rendered=flow.props.nodes;
  act(()=>flow.props.onMoveEnd(new MouseEvent('mouseup'),{x:80,y:90,zoom:2}));
  const after=useWorkspaceStore.getState().boards[id].document;
  expect(after.viewport).toEqual({x:80,y:90,zoom:2});expect(after.items===before.items).toBe(true);expect(after.edges===before.edges).toBe(true);
  expect(flow.props.nodes===rendered).toBe(true);
});
it('keeps local undo and redo available after a mouse viewport change without undoing the view',()=>{
  click('Adicionar cartão');const viewport={x:80,y:90,zoom:2};
  act(()=>flow.props.onMoveEnd(new MouseEvent('mouseup'),viewport));
  key('z',{ctrlKey:true});expect(items()).toHaveLength(0);expect(useWorkspaceStore.getState().boards[id].document.viewport).toEqual(viewport);
  key('y',{ctrlKey:true});expect(items()).toHaveLength(1);expect(useWorkspaceStore.getState().boards[id].document.viewport).toEqual(viewport);
});
it('ignores a delayed viewport callback after navigating away from the board',async()=>{
  const {fetcher}=await cloudBoard(),before=useWorkspaceStore.getState().boards[id];
  act(()=>{useWorkspaceStore.setState({activeBoardId:null});});
  act(()=>flow.props.onMoveEnd(new MouseEvent('mouseup'),{x:80,y:90,zoom:2}));await flushWorkspacePersistence();
  expect(useWorkspaceStore.getState().boards[id]).toBe(before);expect(fetcher).not.toHaveBeenCalled();
});
it.each(['Aproximar','Afastar'])('saves an explicitly requested %s without a mouse viewport event',async label=>{
  const {fetcher}=await cloudBoard(),viewport={x:50,y:40,zoom:label==='Aproximar'?1.2:.8};
  flow.viewport=viewport;
  await act(async()=>{Simulate.click(host.querySelector(`[aria-label="${label}"]`)!);});await flushWorkspacePersistence();
  expect(useWorkspaceStore.getState().boards[id].document.viewport).toEqual(viewport);expect(fetcher).toHaveBeenCalledOnce();
});
it('saves an explicitly requested fit after its passive viewport callback without a second write',async()=>{
  const {fetcher}=await cloudBoard(),viewport={x:50,y:40,zoom:.8};
  flow.fitView.mockImplementationOnce(async()=>{flow.viewport=viewport;flow.props.onMoveEnd(undefined,viewport);return true;});
  await act(async()=>{Simulate.click(host.querySelector('[aria-label="Enquadrar objetos"]')!);});await flushWorkspacePersistence();
  expect(useWorkspaceStore.getState().boards[id].document.viewport).toEqual(viewport);expect(fetcher).toHaveBeenCalledOnce();
});
it('offers drawing, stroke erasing, and lasso selection modes',()=>{
  for(const label of ['Desenhar','Borracha de traços','Selecionar com laço']) expect(host.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
});
it('docks one compact palette while drawing and collapsing it keeps drawing active',()=>{
  click('Desenhar');expect(host.querySelector('[data-ink-palette-trigger]')).not.toBeNull();
  expect(host.querySelector('[data-ink-palette-controls]')).toBeNull();expect(host.querySelector('.db-tools')).toBeNull();
  openPalette();expect(host.querySelectorAll('.db-tools')).toHaveLength(1);expect(host.querySelectorAll('.ink-toolbar')).toHaveLength(1);
  click('Recolher ferramentas de desenho');expect(host.querySelector('[data-ink-palette-controls]')).toBeNull();
  pointer('pointerDown',10,20,{pointerType:'pen'});pointer('pointerUp',30,40,{pointerType:'pen'});expect(items()).toHaveLength(1);
});
it('touch pans in drawing mode without ink or a durable write until release, and without adding undo history',()=>{
  click('Adicionar cartão');const card=items()[0];click('Desenhar');const before=useWorkspaceStore.getState().boards[id];
  pointer('pointerDown',10,20,{pointerType:'touch'});expect(hasActiveDataIngestions()).toBe(true);
  pointer('pointerMove',40,50,{pointerType:'touch'});expect(items()).toEqual([card]);expect(flow.viewport).toEqual({x:30,y:30,zoom:1});
  expect(useWorkspaceStore.getState().boards[id]).toBe(before);
  pointer('pointerUp',40,50,{pointerType:'touch'});expect(hasActiveDataIngestions()).toBe(false);
  expect(useWorkspaceStore.getState().boards[id].document.viewport).toEqual({x:30,y:30,zoom:1});
  key('z',{ctrlKey:true});expect(items()).toHaveLength(0);expect(useWorkspaceStore.getState().boards[id].document.viewport).toEqual({x:30,y:30,zoom:1});
});
it('pinches with two non-primary touch contacts and preserves the focal world point',()=>{
  click('Desenhar');pointer('pointerDown',10,20,{pointerId:2,pointerType:'touch',isPrimary:false});
  pointer('pointerDown',30,20,{pointerId:3,pointerType:'touch',isPrimary:false});
  pointer('pointerMove',50,20,{pointerId:3,pointerType:'touch',isPrimary:false});
  expect(flow.viewport).toEqual({x:-10,y:-20,zoom:2});expect(items()).toHaveLength(0);
  pointer('pointerUp',50,20,{pointerId:3,pointerType:'touch',isPrimary:false});pointer('pointerUp',10,20,{pointerId:2,pointerType:'touch',isPrimary:false});
  expect(useWorkspaceStore.getState().boards[id].document.viewport).toEqual(flow.viewport);expect(hasActiveDataIngestions()).toBe(false);
});
it('cancels provisional finger ink for pinch, never saves it, and allows a new finger stroke only after all lift',()=>{
  const channel=new LiveInkChannel({session:{} as VaultSession}),preview=vi.spyOn(channel,'preview').mockImplementation(()=>{}),finish=vi.spyOn(channel,'finish').mockImplementation(()=>{});
  act(()=>configureLiveInk(channel));click('Desenhar');openPalette();
  const finger=host.querySelector<HTMLInputElement>('[aria-label="Desenhar com dedo"]')!;
  expect(finger).not.toBeNull();act(()=>{finger.checked=true;Simulate.change(finger);});
  pointer('pointerDown',10,20,{pointerType:'touch'});pointer('pointerMove',20,20,{pointerType:'touch'});expect(preview).toHaveBeenCalled();
  pointer('pointerDown',40,20,{pointerId:2,pointerType:'touch',isPrimary:false});expect(finish).toHaveBeenCalledWith({surface:'board',documentId:id},expect.any(String),true);
  pointer('pointerMove',60,20,{pointerId:2,pointerType:'touch',isPrimary:false});pointer('pointerUp',60,20,{pointerId:2,pointerType:'touch',isPrimary:false});
  pointer('pointerMove',20,40,{pointerType:'touch'});pointer('pointerUp',20,40,{pointerType:'touch'});expect(items()).toHaveLength(0);
  pointer('pointerDown',10,20,{pointerType:'touch'});pointer('pointerUp',30,40,{pointerType:'touch'});expect(items()).toHaveLength(1);
});
it('ignores a held palm after pen release and keeps coalesced pressure samples on the owned pen',()=>{
  click('Desenhar');pointer('pointerDown',10,20,{pointerType:'pen',pressure:.2});
  pointer('pointerDown',100,100,{pointerId:2,pointerType:'touch',isPrimary:false});
  pointer('pointerMove',40,50,{pointerType:'pen',pressure:.8,nativeEvent:{getCoalescedEvents:()=>[{clientX:20,clientY:30,pointerType:'pen',pressure:.4},{clientX:30,clientY:40,pointerType:'pen',pressure:.6}]}});
  pointer('pointerUp',50,60,{pointerType:'pen',pressure:.9});pointer('pointerMove',200,200,{pointerId:2,pointerType:'touch',isPrimary:false});
  pointer('pointerUp',200,200,{pointerId:2,pointerType:'touch',isPrimary:false});
  expect(flow.setViewport).not.toHaveBeenCalled();expect(items()).toHaveLength(1);
  const stroke=items()[0];if(stroke.kind!=='drawing')throw new Error('missing ink');expect(stroke.points.map(point=>point.pressure)).toEqual([.2,.4,.6,.8,.9]);
});
it('preserves the first touch capture when finger ink becomes pinch and rebases when the second finger lifts',()=>{
  click('Desenhar');openPalette();const finger=host.querySelector<HTMLInputElement>('[aria-label="Desenhar com dedo"]')!;
  act(()=>{finger.checked=true;Simulate.change(finger);});
  const layer=host.querySelector<HTMLDivElement>('.db-drawing-layer')!,captured=new Set<number>();
  layer.setPointerCapture=vi.fn(pointerId=>{captured.add(pointerId);});layer.hasPointerCapture=pointerId=>captured.has(pointerId);
  layer.releasePointerCapture=vi.fn(pointerId=>{captured.delete(pointerId);Simulate.lostPointerCapture(layer,{pointerId,pointerType:'touch',clientX:100,clientY:100} as never);});
  pointer('pointerDown',0,100,{pointerType:'touch'});pointer('pointerMove',100,100,{pointerType:'touch'});
  pointer('pointerDown',200,100,{pointerId:2,pointerType:'touch',isPrimary:false});
  expect(layer.releasePointerCapture).not.toHaveBeenCalled();expect(captured).toEqual(new Set([1,2]));
  pointer('pointerMove',101,100,{pointerType:'touch'});expect(flow.viewport.x).toBeCloseTo(2);expect(flow.viewport.zoom).toBeCloseTo(.99);
  pointer('pointerUp',200,100,{pointerId:2,pointerType:'touch',isPrimary:false});
  const previous={...flow.viewport};pointer('pointerMove',111,110,{pointerType:'touch'});
  expect(flow.viewport).toEqual({x:previous.x+10,y:previous.y+10,zoom:previous.zoom});
  pointer('pointerUp',111,110,{pointerType:'touch'});expect(captured.size).toBe(0);expect(items()).toHaveLength(0);expect(hasActiveDataIngestions()).toBe(false);
});
it('releases navigation on blur and ignores its late pointerup after a board context change',()=>{
  click('Desenhar');pointer('pointerDown',10,20,{pointerType:'touch'});pointer('pointerMove',30,40,{pointerType:'touch'});
  act(()=>window.dispatchEvent(new Event('blur')));expect(hasActiveDataIngestions()).toBe(false);
  pointer('pointerUp',30,40,{pointerType:'touch'});expect(useWorkspaceStore.getState().boards[id].document.viewport).toEqual({x:0,y:0,zoom:1});
  pointer('pointerDown',10,20,{pointerType:'touch'});act(()=>{useWorkspaceStore.setState({activeBoardId:null});});
  expect(hasActiveDataIngestions()).toBe(false);pointer('pointerUp',30,40,{pointerType:'touch'});expect(items()).toHaveLength(0);
});
it('holds remote refresh during drawing and erasing even without an online channel',()=>{
  click('Desenhar');pointer('pointerDown',10,20);expect(hasActiveDataIngestions()).toBe(true);
  pointer('pointerUp',60,80);expect(hasActiveDataIngestions()).toBe(false);
  click('Borracha de traços');pointer('pointerDown',10,20);expect(hasActiveDataIngestions()).toBe(true);
  pointer('pointerCancel',60,80);expect(hasActiveDataIngestions()).toBe(false);
  pointer('pointerDown',10,20);act(()=>root.unmount());expect(hasActiveDataIngestions()).toBe(false);
});
it.each(['pointerCancel','lostPointerCapture'] as const)('ignores secondary %s while the active pen finishes one board stroke',type=>{
  click('Desenhar');pointer('pointerDown',10,20,{pointerType:'pen',pressure:.2});pointer('pointerMove',30,40,{pointerType:'pen',pressure:.4});
  pointer('pointerDown',200,200,{pointerId:2,pointerType:'touch',isPrimary:false});
  pointer(type,200,200,{pointerId:2,pointerType:'touch',isPrimary:false});
  expect(hasActiveDataIngestions()).toBe(true);expect(items()).toHaveLength(0);
  pointer('pointerMove',50,60,{pointerType:'pen',pressure:.6});pointer('pointerUp',70,80,{pointerType:'pen',pressure:.8});pointer('pointerUp',70,80,{pointerType:'pen',pressure:.8});
  expect(items()).toHaveLength(1);
  const drawing=items()[0];if(drawing.kind!=='drawing')throw new Error('missing drawing');
  expect(drawing.points.map(point=>({x:drawing.x+point.x,y:drawing.y+point.y,pressure:point.pressure}))).toEqual([{x:10,y:20,pressure:.2},{x:30,y:40,pressure:.4},{x:50,y:60,pressure:.6},{x:70,y:80,pressure:.8}]);
  expect(hasActiveDataIngestions()).toBe(false);
});
it.each(['pointerCancel','lostPointerCapture'] as const)('discards the active board pen on %s and allows another gesture',type=>{
  click('Desenhar');pointer('pointerDown',10,20,{pointerType:'pen'});pointer('pointerMove',30,40,{pointerType:'pen'});
  expect(hasActiveDataIngestions()).toBe(true);
  pointer(type,30,40);pointer('pointerUp',50,60);
  expect(hasActiveDataIngestions()).toBe(false);expect(items()).toHaveLength(0);
  pointer('pointerDown',70,80,{pointerType:'pen'});pointer('pointerUp',90,100,{pointerType:'pen'});
  expect(items()).toHaveLength(1);expect(hasActiveDataIngestions()).toBe(false);
});
it('holds remote refresh only during an actual object drag and releases on stop, cancellation, or close',()=>{
  click('Adicionar cartão');const first=flow.props.nodes[0];
  expect(hasActiveDataIngestions()).toBe(false);
  act(()=>flow.props.onNodeClick({target:host.querySelector('[data-board-canvas]')!}));
  expect(hasActiveDataIngestions()).toBe(false);
  const drag=()=>act(()=>flow.props.onNodesChange([{type:'position',id:first.id,position:{x:220,y:80},dragging:true}]));
  drag();expect(hasActiveDataIngestions()).toBe(true);
  act(()=>flow.props.onNodeDragStop(null,{...first,position:{x:220,y:80}},[{...first,position:{x:220,y:80}}]));
  expect(hasActiveDataIngestions()).toBe(false);expect(items()[0]).toMatchObject({x:220,y:80});
  drag();act(()=>window.dispatchEvent(new Event('pointercancel')));expect(hasActiveDataIngestions()).toBe(false);
  drag();act(()=>window.dispatchEvent(new Event('blur')));expect(hasActiveDataIngestions()).toBe(false);
  drag();act(()=>window.dispatchEvent(new Event('mouseup')));expect(hasActiveDataIngestions()).toBe(false);
  drag();act(()=>root.unmount());expect(hasActiveDataIngestions()).toBe(false);
});
it('invalidates old undo snapshots when a remote document arrives so undo cannot erase a tablet item',()=>{
  click('Adicionar cartão');const local=items()[0];
  const state=useWorkspaceStore.getState(),board=state.boards[id];
  const incoming={...board,document:{...board.document,items:[...board.document.items,{id:'tablet-item',kind:'text',x:400,y:50,width:240,height:80,text:'Desenhado no tablet',fontSize:20,color:'#ffffff'}]}};
  act(()=>applyRemoteCanvasDocuments([{key:'cellproject-workspace',revision:2,value:JSON.stringify({version:2,state:{...state,boards:{...state.boards,[id]:incoming}}})}]));
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Desfazer"]')!.disabled).toBe(true);
  key('z',{ctrlKey:true});expect(items().map(item=>item.id)).toEqual([local.id,'tablet-item']);
  click('Adicionar texto');key('z',{ctrlKey:true});expect(items().map(item=>item.id)).toEqual([local.id,'tablet-item']);
});
it('renders remote ink while selecting, tracks viewport changes, and hides the ghost once its saved id arrives',()=>{
  const channel=new LiveInkChannel({session:{} as VaultSession});
  vi.spyOn(channel,'getRemote').mockReturnValue([{gestureId:'remote-trace',sender:'tablet',scope:{surface:'board',documentId:id},committed:false,stroke:{id:'remote-trace',x:25,y:30,color:'#abcdef',width:3,points:[{x:0,y:0},{x:20,y:10}]}}]);
  act(()=>configureLiveInk(channel));
  expect(host.querySelector('[data-board-remote-stroke="remote-trace"]')).not.toBeNull();
  flow.viewport={x:80,y:90,zoom:2};act(()=>root.render(<BoardCanvas boardId={id} onBack={vi.fn()}/>));
  expect(host.querySelector('[data-board-live-ink] > g')?.getAttribute('transform')).toBe('translate(80 90) scale(2)');
  act(()=>{useWorkspaceStore.getState().updateBoard(id,{document:{...useWorkspaceStore.getState().boards[id].document,items:[{id:'remote-trace',kind:'drawing',x:25,y:30,width:30,height:20,widthStroke:3,color:'#abcdef',points:[{x:0,y:0},{x:20,y:10}]}]}});});
  expect(host.querySelector('[data-board-remote-stroke="remote-trace"]')).toBeNull();
});
it('publishes a positioned preview and commits once with the exact id saved in the board',()=>{
  const channel=new LiveInkChannel({session:{} as VaultSession}),preview=vi.spyOn(channel,'preview').mockImplementation(()=>{}),finish=vi.spyOn(channel,'finish').mockImplementation(()=>{});
  act(()=>configureLiveInk(channel));click('Desenhar');pointer('pointerDown',-20,10);pointer('pointerMove',60,70);pointer('pointerUp',80,90);
  const item=items()[0];expect(preview).toHaveBeenCalled();expect(preview.mock.calls[0][2]).toMatchObject({x:-20,y:10,points:[{x:0,y:0}]});
  expect(finish).toHaveBeenCalledTimes(1);expect(finish).toHaveBeenCalledWith({surface:'board',documentId:id},item.id,false);
  pointer('pointerDown',10,10);pointer('pointerCancel',30,30);expect(finish).toHaveBeenLastCalledWith({surface:'board',documentId:id},expect.any(String),true);expect(items()).toHaveLength(1);
});
it('cancels and releases a board stroke when its active document changes without applying it elsewhere',()=>{
  const channel=new LiveInkChannel({session:{} as VaultSession}),finish=vi.spyOn(channel,'finish').mockImplementation(()=>{});
  vi.spyOn(channel,'preview').mockImplementation(()=>{});act(()=>configureLiveInk(channel));
  click('Desenhar');pointer('pointerDown',10,20);expect(hasActiveDataIngestions()).toBe(true);
  act(()=>{useWorkspaceStore.getState().createBoard('Another board');});
  expect(hasActiveDataIngestions()).toBe(false);expect(finish).toHaveBeenCalledOnce();expect(finish).toHaveBeenCalledWith({surface:'board',documentId:id},expect.any(String),true);
  pointer('pointerUp',60,80);expect(items()).toHaveLength(0);
});
it('commits a pressure-aware drawing once and cancels a second gesture without a change',()=>{
  click('Desenhar');
  pointer('pointerDown',10,20,{pointerType:'pen',pressure:.2});pointer('pointerMove',60,80,{pointerType:'pen',pressure:.8});
  expect(items()).toHaveLength(0);pointer('pointerUp',80,90,{pointerType:'pen',pressure:.7});
  expect(items()).toHaveLength(1);expect(items()[0]).toMatchObject({kind:'drawing',tool:'pen',opacity:1});
  const drawing=items()[0];if(drawing.kind!=='drawing')throw new Error('missing drawing');
  expect(drawing.points.map(point=>point.pressure)).toEqual([.2,.8,.7]);
  pointer('pointerDown',100,100);pointer('pointerMove',160,180);pointer('pointerCancel',160,180);
  expect(items()).toHaveLength(1);click('Desfazer');expect(items()).toHaveLength(0);click('Refazer');expect(items()).toHaveLength(1);
});
it('erases whole strokes in one undoable gesture and preserves cancelled erasing',()=>{
  click('Desenhar');pointer('pointerDown',100,100);pointer('pointerUp',200,100);
  click('Adicionar cartão');const original=items();
  click('Borracha de traços');pointer('pointerDown',150,40);pointer('pointerMove',150,140);
  expect(items()).toEqual(original);pointer('pointerCancel',150,140);expect(items()).toEqual(original);
  pointer('pointerDown',150,40);pointer('pointerUp',150,140);expect(items()).toHaveLength(1);expect(items()[0].kind).toBe('card');
  click('Desfazer');expect(items()).toEqual(original);click('Refazer');expect(items()).toHaveLength(1);
});
it('selects with a lasso then lets the selected drawing use existing duplicate and delete actions',()=>{
  click('Desenhar');pointer('pointerDown',100,100);pointer('pointerUp',200,100);
  click('Selecionar com laço');pointer('pointerDown',90,90);pointer('pointerMove',210,90);pointer('pointerMove',210,110);pointer('pointerMove',90,110);pointer('pointerUp',90,90);
  expect(flow.props.nodes[0].selected).toBe(true);expect(flow.props.nodes[0].draggable).toBe(true);
  key('d',{ctrlKey:true});expect(items()).toHaveLength(2);key('Delete');expect(items()).toHaveLength(1);
});
it('draws a straight stroke with the ruler and discards an active stroke on Escape',()=>{
  click('Desenhar');click('Régua (linha reta)');pointer('pointerDown',10,20);pointer('pointerMove',40,90);pointer('pointerUp',80,50);
  const drawing=items()[0];if(drawing.kind!=='drawing')throw new Error('missing drawing');
  expect(drawing.points).toHaveLength(2);
  pointer('pointerDown',100,100);pointer('pointerMove',160,180);key('Escape');expect(host.querySelector('.db-drawing-layer')).toBeNull();expect(items()).toHaveLength(1);
});
it('uses native coalesced pen samples and keeps mouse pressure out of stored strokes',()=>{
  click('Desenhar');pointer('pointerDown',10,20,{pointerType:'pen',pressure:.2});
  pointer('pointerMove',60,80,{pointerType:'pen',pressure:.8,nativeEvent:{getCoalescedEvents:()=>[{clientX:30,clientY:40,pointerType:'pen',pressure:.4},{clientX:50,clientY:60,pointerType:'pen',pressure:.6}]}});
  pointer('pointerUp',60,80,{pointerType:'pen',pressure:0});
  const drawing=items()[0];if(drawing.kind!=='drawing')throw new Error('missing drawing');
  expect(drawing.points.map(point=>point.pressure)).toEqual([.2,.4,.6,.8]);
  pointer('pointerDown',100,100,{pressure:.5});pointer('pointerUp',120,120,{pressure:.5});
  const mouse=items()[1];if(mouse.kind!=='drawing')throw new Error('missing drawing');
  expect(mouse.points.every(point=>point.pressure===undefined)).toBe(true);
});
it('keeps drawing and eraser hit testing aligned after viewport pan and zoom',()=>{
  flow.viewport={x:50,y:30,zoom:2};click('Desenhar');pointer('pointerDown',250,230);pointer('pointerUp',450,230);
  const drawing=items()[0];if(drawing.kind!=='drawing')throw new Error('missing drawing');
  expect({x:drawing.x+drawing.points[0].x,y:drawing.y+drawing.points[0].y}).toEqual({x:100,y:100});
  click('Borracha de traços');pointer('pointerDown',350,150);pointer('pointerUp',350,300);expect(items()).toHaveLength(0);
});
it('adds local cards, duplicates independently, and undoes/removes with connected edges',()=>{
  click('Adicionar cartão');expect(items()).toHaveLength(1);const original=items()[0];
  key('d',{ctrlKey:true});expect(items()).toHaveLength(2);expect(items()[1].id).not.toBe(original.id);
  click('Desfazer');expect(items()).toHaveLength(1);
  click('Refazer');expect(items()).toHaveLength(2);
  act(()=>flow.props.onConnect({source:flow.props.nodes[0].id,target:flow.props.nodes[1].id}));
  act(()=>flow.props.onNodesChange([{type:'select',id:flow.props.nodes[1].id,selected:true}]));
  key('Delete');expect(items()).toHaveLength(1);
  expect(useWorkspaceStore.getState().boards[id].document.edges).toEqual([]);
  click('Desfazer');expect(items()).toHaveLength(2);
  expect(useWorkspaceStore.getState().boards[id].document.edges).toHaveLength(1);
  expect(useWorkspaceStore.getState().notes).toEqual({});
});
it('pastes ordinary text as a board text item and leaves typed input alone',()=>{
  const paste=(target:Element)=>{const event=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{items:[],files:[],getData:(type:string)=>type==='text/plain'?'An idea to explore':''}});act(()=>target.dispatchEvent(event));return event;};
  expect(paste(host.querySelector('[data-board-canvas]')!).defaultPrevented).toBe(true);
  expect(items()[0]).toMatchObject({kind:'text',text:'An idea to explore'});
  const input=host.querySelector('input[aria-label="Nome do quadro"]')!;
  expect(paste(input).defaultPrevented).toBe(false);expect(items()).toHaveLength(1);
});
it('persists moved coordinates and preserves edits when another item is added',()=>{
  click('Adicionar cartão');const first=flow.props.nodes[0];
  act(()=>flow.props.onNodesChange([{type:'position',id:first.id,position:{x:200,y:-50},dragging:true}]));
  act(()=>flow.props.onNodeDragStop(null,{...first,position:{x:200,y:-50}},[{...first,position:{x:200,y:-50}}]));
  click('Adicionar texto');expect(items()[0]).toMatchObject({x:200,y:-50});expect(items()).toHaveLength(2);
});
it('preserves measured node dimensions after selection and live resize updates',()=>{
  click('Adicionar cartão');const first=flow.props.nodes[0];
  expect(first.measured).toEqual({width:280,height:190});
  act(()=>flow.props.onNodesChange([{type:'select',id:first.id,selected:false},{type:'dimensions',id:first.id,dimensions:{width:420,height:250},resizing:true}]));
  expect(flow.props.nodes[0].measured).toEqual({width:420,height:250});
  expect(flow.props.nodes[0].style).toMatchObject({width:420,height:250});
});
it('maximizes the board and restores with Escape',()=>{
  const canvas=host.querySelector('[data-board-canvas]');
  click('Maximizar quadro');expect(host.querySelector('.db-canvas-shell')?.classList.contains('is-maximized')).toBe(true);
  expect(host.querySelector('.db-canvas-header')?.closest('[hidden]')).not.toBeNull();
  click('Mostrar controles');
  expect(host.querySelector('.db-canvas-header')?.closest('[hidden]')).toBeNull();
  act(()=>host.querySelector('[aria-label="Mostrar controles"]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
  expect(host.querySelector('.db-canvas-header')?.closest('[hidden]')).not.toBeNull();
  expect(host.querySelector('.db-canvas-shell')?.classList.contains('is-maximized')).toBe(true);
  expect(host.querySelector('[data-board-canvas]')).toBe(canvas);
  key('Escape');expect(host.querySelector('.db-canvas-shell')?.classList.contains('is-maximized')).toBe(false);
});
it('keeps title spaces while typing and commits on blur',()=>{
  const input=host.querySelector<HTMLInputElement>('input[aria-label="Nome do quadro"]')!;
  for(const value of ['Meu','Meu ','Meu quadro livre']){
    act(()=>{input.value=value;Simulate.change(input);});
    expect(input.value).toBe(value);
  }
  expect(useWorkspaceStore.getState().boards[id].title).toBe('Sketch');
  act(()=>Simulate.blur(input));
  expect(useWorkspaceStore.getState().boards[id].title).toBe('Meu quadro livre');
});
it('does not steal focus from text editors or node action buttons',()=>{
  const canvas=host.querySelector<HTMLElement>('[data-board-canvas]')!;
  const editor=document.createElement('textarea'),button=document.createElement('button');
  canvas.append(editor,button);
  editor.focus();act(()=>flow.props.onNodeClick({target:editor}));expect(document.activeElement).toBe(editor);
  button.focus();act(()=>flow.props.onNodeClick({target:button}));expect(document.activeElement).toBe(button);
  act(()=>flow.props.onNodeClick({target:canvas}));expect(document.activeElement).toBe(canvas);
});
const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6cWoAAAAASUVORK5CYII=';
const copiedImage='cellproject-visual-artifact:v1\n'+JSON.stringify({version:1,projectId:'plan',ownerId:null,view:{yaw:0,pitch:0,explosion:0,selectedPart:null},artifact:{id:'image',label:'Board',kind:'image',x:0,y:0,width:280,height:220,linkedNodeId:null,scene:null,mediaId:'media',source:null,revisions:[{scene:null,mediaId:'media',createdAt:1}],revisionIndex:0}});
async function pasteMedia(text:string) {
  const event=new Event('paste',{bubbles:true,cancelable:true});
  Object.defineProperty(event,'clipboardData',{value:{items:[],files:[],getData:()=>text}});
  await act(async()=>{host.querySelector('[data-board-canvas]')!.dispatchEvent(event);});
}
it('blocks data transitions throughout copied-image reading and conversion, releasing one guard after insertion',async()=>{
  let read!:(value:Blob)=>void,convert!:(value:Awaited<ReturnType<typeof importNoteImage>>)=>void;
  vi.mocked(readVisualMedia).mockImplementation(()=>new Promise(resolve=>{read=resolve;}));
  vi.mocked(importNoteImage).mockImplementation(()=>new Promise(resolve=>{convert=resolve;}));
  await pasteMedia(copiedImage);
  expect(hasActiveDataIngestions()).toBe(true);
  expect(()=>assertDataTransitionIdle(false,false)).toThrow('leitura dos anexos');
  expect(registerDataIngestion).toHaveBeenCalledOnce();
  await act(async()=>{read(new Blob(['image'],{type:'image/png'}));});
  expect(importNoteImage).toHaveBeenCalledOnce();
  expect(hasActiveDataIngestions()).toBe(true);
  expect(registerDataIngestion).toHaveBeenCalledOnce();
  await act(async()=>{convert({src:pixel,width:100,height:60,label:'Imagem salva'});});
  expect(items()).toHaveLength(1);expect(items()[0]).toMatchObject({kind:'image',src:pixel});
  expect(hasActiveDataIngestions()).toBe(false);
});
it('releases a failed copied-image read without changing the board',async()=>{
  let fail!:(reason:Error)=>void;
  vi.mocked(readVisualMedia).mockImplementation(()=>new Promise((_resolve,reject)=>{fail=reject;}));
  await pasteMedia(copiedImage);expect(hasActiveDataIngestions()).toBe(true);
  await act(async()=>{fail(new Error('offline'));});
  expect(hasActiveDataIngestions()).toBe(false);
  expect(items()).toEqual([]);
});
it('releases a copied-image read on close and never applies its late result',async()=>{
  let read!:(value:Blob)=>void;
  vi.mocked(readVisualMedia).mockImplementation(()=>new Promise(resolve=>{read=resolve;}));
  await pasteMedia(copiedImage);expect(hasActiveDataIngestions()).toBe(true);
  act(()=>root.unmount());expect(hasActiveDataIngestions()).toBe(false);
  await act(async()=>{read(new Blob(['image'],{type:'image/png'}));});
  expect(importNoteImage).not.toHaveBeenCalled();expect(items()).toEqual([]);
});
