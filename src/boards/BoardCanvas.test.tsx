import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '@/workspace/store';
import { BoardCanvas } from './BoardCanvas';
import type { Node, NodeChange } from '@xyflow/react';
import { importNoteImage } from '@/workspace/noteImages';
import { readVisualMedia } from '@/visuals/media';
import { assertDataTransitionIdle, hasActiveDataIngestions, registerDataIngestion } from '@/cloud/activity';
import { configureLiveInk, LiveInkChannel } from '@/ink/live';
import type { VaultSession } from '@/cloud/vault/crypto';
import { applyRemoteCanvasDocuments } from '@/cloud/CloudLiveSync';
vi.mock('@/workspace/noteImages',async original=>({...await original<typeof import('@/workspace/noteImages')>(),importNoteImage:vi.fn()}));
vi.mock('@/visuals/media',async original=>({...await original<typeof import('@/visuals/media')>(),readVisualMedia:vi.fn()}));
vi.mock('@/cloud/activity',async original=>{const actual=await original<typeof import('@/cloud/activity')>();return {...actual,registerDataIngestion:vi.fn(actual.registerDataIngestion)};});
const flow=vi.hoisted(()=>({props:null as unknown as {nodes:Node[];onNodesChange(changes:NodeChange[]):void;onNodeDragStop(event:unknown,node:Node,nodes:Node[]):void;onConnect(connection:{source:string;target:string}):void;onNodeClick(event:{target:Element;ctrlKey?:boolean}):void},fitView:vi.fn(),viewport:{x:0,y:0,zoom:1}}));
vi.mock('@xyflow/react',async()=>{const actual=await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react');return {...actual,ReactFlowProvider:({children}:{children:ReactNode})=>children,ReactFlow:(props:typeof flow.props&{children:ReactNode})=>{flow.props=props;return <div data-flow>{props.children}</div>;},Background:()=>null,useViewport:()=>flow.viewport,useReactFlow:()=>({screenToFlowPosition:({x,y}:{x:number;y:number})=>({x:(x-flow.viewport.x)/flow.viewport.zoom,y:(y-flow.viewport.y)/flow.viewport.zoom}),getViewport:()=>flow.viewport,fitView:flow.fitView,zoomIn:vi.fn(),zoomOut:vi.fn(),setViewport:vi.fn()})};});
vi.mock('./BoardItemNode',()=>({BoardItemNode:()=>null}));
vi.mock('./BoardComposer',()=>({BoardComposer:()=>null}));
vi.mock('@/visuals/rendering/VisualCanvasLayer',()=>({VisualCanvasLayer:()=>null}));
let host:HTMLDivElement,root:Root,id:string;
beforeEach(()=>{vi.clearAllMocks();flow.viewport={x:0,y:0,zoom:1};(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;useWorkspaceStore.setState({boards:{},activeBoardId:null,projects:{},notes:{},surface:'boards'});id=useWorkspaceStore.getState().createBoard('Sketch');host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>root.render(<BoardCanvas boardId={id} onBack={vi.fn()}/>));});
afterEach(()=>{act(()=>root.unmount());configureLiveInk(null);host.remove();});
const click=(label:string)=>act(()=>Simulate.click(host.querySelector(`[aria-label="${label}"]`)!));
const key=(key:string,options:Record<string,unknown>={})=>act(()=>Simulate.keyDown(host.querySelector('[data-board-canvas]')!,{key,...options}));
const items=()=>useWorkspaceStore.getState().boards[id].document.items;
const pointer=(type:'pointerDown'|'pointerMove'|'pointerUp'|'pointerCancel',x:number,y:number,extra:Record<string,unknown>={})=>{const values={pointerId:1,button:0,isPrimary:true,clientX:x,clientY:y,pointerType:'mouse',...extra};act(()=>Simulate[type](host.querySelector('.db-drawing-layer')!,values));};
it('offers drawing, stroke erasing, and lasso selection modes',()=>{
  for(const label of ['Desenhar','Borracha de traços','Selecionar com laço']) expect(host.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
});
it('holds remote refresh during drawing and erasing even without an online channel',()=>{
  click('Desenhar');pointer('pointerDown',10,20);expect(hasActiveDataIngestions()).toBe(true);
  pointer('pointerUp',60,80);expect(hasActiveDataIngestions()).toBe(false);
  click('Borracha de traços');pointer('pointerDown',10,20);expect(hasActiveDataIngestions()).toBe(true);
  pointer('pointerCancel',60,80);expect(hasActiveDataIngestions()).toBe(false);
  pointer('pointerDown',10,20);act(()=>root.unmount());expect(hasActiveDataIngestions()).toBe(false);
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
