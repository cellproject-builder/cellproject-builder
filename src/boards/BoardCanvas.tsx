import { AudioTextInput } from '@/audio/AudioField';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, useReactFlow, useViewport, type NodeChange, type Node, type Connection } from '@xyflow/react';
import { nanoid } from 'nanoid';
import { ArrowLeftIcon, CursorArrowIcon, Pencil1Icon, TextIcon, CardStackIcon, ImageIcon, CubeIcon, Share2Icon, CornersIcon, ExitFullScreenIcon, ResetIcon, ArrowRightIcon, PlusIcon, MinusIcon, UploadIcon, EraserIcon, LoopIcon, RulerHorizontalIcon } from '@/components/ui/SoftIcons';
import { useWorkspaceStore } from '@/workspace/store';
import { PageHeaderContext } from '@/workspace/PageHeader';
import { useContext } from 'react';
import { ExpandedChrome } from '@/components/ui/ExpandedChrome';
import { importNoteImage } from '@/workspace/noteImages';
import { parseArtifactClipboard, ARTIFACT_CLIPBOARD_TYPE } from '@/visuals/artifactClipboard';
import { readVisualMedia } from '@/visuals/media';
import { registerDataIngestion } from '@/cloud/activity';
import type { VisualArtifact } from '@/visuals/types';
import { InkToolbar } from '@/ink/InkToolbar';
import { InkStroke } from '@/ink/InkStroke';
import { createInkSettings, type InkSettings, type InkPoint } from '@/ink/model';
import { sampleInkPoint } from '@/ink/geometry';
import { positionedInk } from '@/ink/canvasModel';
import { useLiveInk } from '@/ink/live';
import { BoardItemNode, type BoardNodeData } from './BoardItemNode';
import { BoardComposer } from './BoardComposer';
import { drawingItem, boardClipboard, parseBoardClipboard, pasteBoardItems, removeBoardItems, boardDrawingIdsNearPath, selectBoardItemsInLasso } from './operations';
import type { BoardDocument, BoardItem } from './model';
import '@xyflow/react/dist/style.css';
import './boards.css';

const nodeTypes={board:BoardItemNode};
const VisualCanvasLayer = lazy(() => import('@/visuals/rendering/VisualCanvasLayer').then(module => ({ default: module.VisualCanvasLayer })));
const editable=(target:EventTarget|null)=>target instanceof Element&&!!target.closest('input,textarea,select,[contenteditable="true"]');
type Props={boardId:string;onBack():void;english?:boolean;onMaximizedChange?(value:boolean):void};
type Rect=Partial<Pick<BoardItem,'x'|'y'|'width'|'height'>>;
type InkMode='select'|'draw'|'eraser'|'lasso';
type InkGesture={pointer:number;boardId:string;id:string;mode:Exclude<InkMode,'select'>;points:InkPoint[];settings:InkSettings;straight:boolean;erased:Set<string>;release():void;finish(cancelled:boolean):void};
function Canvas({boardId,onBack,english=false,onMaximizedChange}:Props) {
  const board=useWorkspaceStore(state=>state.boards[boardId]);
  const api=useReactFlow(),viewport=useViewport(),shell=useContext(PageHeaderContext),liveInk=useLiveInk({surface:'board',documentId:boardId});
  const [selected,setSelected]=useState<string[]>([]),[live,setLive]=useState<Record<string,Rect>>({});
  const [mode,setMode]=useState<InkMode>('select'),[settings,setSettings]=useState<InkSettings>(()=>createInkSettings()),[straight,setStraight]=useState(false);
  const [ink,setInk]=useState<InkPoint[]>([]),[erased,setErased]=useState<string[]>([]),[eraserPoint,setEraserPoint]=useState<InkPoint|null>(null);
  const [maximized,setMaximized]=useState(false),[error,setError]=useState('');
  const [composer,setComposer]=useState<{kind:'diagram'|'model'|'image'|'refine';itemId?:string}|null>(null);
  const [webglAvailable,setWebglAvailable]=useState(true),[importing,setImporting]=useState(false);
  const [title,setTitle]=useState(board?.title??'');
  const [,refresh]=useState(0);
  const history=useRef<{past:BoardDocument[];future:BoardDocument[]}>({past:[],future:[]});
  const ownedDocument=useRef(board?.document),dragRelease=useRef<(() => void)|null>(null);
  const canvas=useRef<HTMLDivElement>(null),drawingLayer=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null),alive=useRef(true),imports=useRef(new Set<AbortController>());
  const gesture=useRef<InkGesture|null>(null);
  const t=(pt:string,en:string)=>english?en:pt;
  const current=()=>useWorkspaceStore.getState().boards[boardId];
  const releaseDrag=useCallback(()=>{dragRelease.current?.();dragRelease.current=null;},[]);
  const holdDrag=()=>{if(!dragRelease.current)dragRelease.current=registerDataIngestion();};
  const cancelGesture=(cancelled=true)=>{
    const action=gesture.current;gesture.current=null;setInk([]);setErased([]);setEraserPoint(null);
    action?.finish(cancelled);action?.release();
    if(action&&drawingLayer.current?.hasPointerCapture?.(action.pointer))drawingLayer.current.releasePointerCapture(action.pointer);
  };
  const selectMode=(value:InkMode)=>{cancelGesture();setMode(value);canvas.current?.focus({preventScroll:true});};
  const save=useCallback((document:BoardDocument,record=true)=>{
    const latest=useWorkspaceStore.getState().boards[boardId];
    if(!latest||latest.archived||!alive.current)throw new Error('boardContextChanged');
    useWorkspaceStore.getState().updateBoard(boardId,{document});
    ownedDocument.current=useWorkspaceStore.getState().boards[boardId]?.document;
    if(record){history.current.past.push(latest.document);history.current.past=history.current.past.slice(-30);history.current.future=[];}
    setError('');setLive({});refresh(value=>value+1);
  },[boardId]);
  const safely=(action:()=>void)=>{try{action();}catch{setError(t('Não foi possível aplicar. Confira o tamanho ou conteúdo do quadro.','Could not apply. Check the size or content of this board.'));}};
  const saveViewport=(viewport:BoardDocument['viewport'])=>{
    const latest=current();if(!alive.current||!latest||latest.archived||useWorkspaceStore.getState().activeBoardId!==boardId)return;
    const previous=latest.document.viewport;
    if(previous.x===viewport.x&&previous.y===viewport.y&&previous.zoom===viewport.zoom)return;
    safely(()=>save({...latest.document,viewport},false));
  };
  const changeView=async(action:()=>Promise<unknown>)=>{
    try{await action();saveViewport(api.getViewport());}
    catch{if(alive.current)setError(t('Não foi possível ajustar a vista.','Could not adjust the view.'));}
  };
  const center=()=>{
    const rect=canvas.current?.getBoundingClientRect();
    return api.screenToFlowPosition({x:(rect?.left??0)+(rect?.width??800)/2,y:(rect?.top??0)+(rect?.height??600)/2});
  };
  const update=useCallback((item:BoardItem)=>{
    const latest=useWorkspaceStore.getState().boards[boardId];if(!latest||!latest.document.items.some(value=>value.id===item.id))return;
    try{save({...latest.document,items:latest.document.items.map(value=>value.id===item.id?item:value)});}catch{setError(english?'Could not update this object.':'Não foi possível atualizar este objeto.');}
  },[boardId,save,english]);
  const remove=useCallback((id:string)=>{
    const latest=useWorkspaceStore.getState().boards[boardId];if(!latest)return;
    try{save(removeBoardItems(latest.document,[id]));setSelected(values=>values.filter(value=>value!==id));}catch{setError(english?'Could not remove this object.':'Não foi possível remover este objeto.');}
  },[boardId,save,english]);
  const refine=useCallback((id:string)=>setComposer({kind:'refine',itemId:id}),[]);
  const insert=(item:BoardItem)=>{
    const latest=current();if(!latest||latest.archived)throw new Error('boardContextChanged');
    const exists=latest.document.items.some(value=>value.id===item.id);
    const point=center(),placed=exists?item:{...item,x:point.x-item.width/2,y:point.y-item.height/2};
    save({...latest.document,items:exists?latest.document.items.map(value=>value.id===item.id?item:value):[...latest.document.items,placed]});
    setSelected([item.id]);selectMode('select');
  };
  const add=(kind:'card'|'text')=>safely(()=>{insert({id:nanoid(12),kind,text:'',color:'#94a3b8',fontSize:kind==='text'?24:16,x:0,y:0,width:kind==='card'?280:340,height:kind==='card'?190:140});canvas.current?.focus();});
  const travel=(direction:'past'|'future')=>safely(()=>{
    cancelGesture();
    const next=history.current[direction].at(-1);if(!next)return;
    const latest=current();if(!latest)return;
    save({...next,viewport:latest.document.viewport},false);
    history.current[direction].pop();history.current[direction==='past'?'future':'past'].push(latest.document);setSelected([]);
  });
  const maximize=(value:boolean)=>{setMaximized(value);onMaximizedChange?.(value);};
  const rename=()=>{const value=title.trim(),latest=current();if(!value||value===latest?.title){setTitle(latest?.title??'');return;}safely(()=>{useWorkspaceStore.getState().updateBoard(boardId,{title:value});ownedDocument.current=current()?.document;});};
  useEffect(()=>{
    const cancel=()=>{releaseDrag();setLive({});};
    // React Flow uses d3 mouse/touch end events. Capture also covers a no-op
    // release whose d3 handler may stop propagation without calling our stop.
    window.addEventListener('mouseup',releaseDrag,true);window.addEventListener('touchend',releaseDrag,true);window.addEventListener('pointercancel',cancel);window.addEventListener('touchcancel',cancel,true);window.addEventListener('blur',cancel);
    return()=>{window.removeEventListener('mouseup',releaseDrag,true);window.removeEventListener('touchend',releaseDrag,true);window.removeEventListener('pointercancel',cancel);window.removeEventListener('touchcancel',cancel,true);window.removeEventListener('blur',cancel);releaseDrag();};
  },[boardId,releaseDrag]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;for(const controller of imports.current)controller.abort();onMaximizedChange?.(false);};},[onMaximizedChange]);
  useEffect(()=>{
    cancelGesture();history.current={past:[],future:[]};setSelected([]);
    const off=useWorkspaceStore.subscribe(state=>{const action=gesture.current;if(action&&(!state.boards[action.boardId]||state.boards[action.boardId].archived||state.activeBoardId!==action.boardId))cancelGesture();});
    return()=>{off();const action=gesture.current;gesture.current=null;action?.finish(true);action?.release();};
  },[boardId]);
  useEffect(()=>{
    // Whole-document undo snapshots cannot safely cross a remote replacement.
    if(board?.document!==ownedDocument.current){history.current={past:[],future:[]};ownedDocument.current=board?.document;refresh(value=>value+1);}
    setLive({});
  },[board?.document]);
  useEffect(()=>{setTitle(board?.title??'');},[board?.title]);
  const nodes=useMemo<Node<BoardNodeData>[]>(()=>board?.document.items.map(item=>{
    const shown={...item,...live[item.id]};
    return {id:`visual:${item.id}`,type:'board',position:{x:shown.x,y:shown.y},style:{width:shown.width,height:shown.height,opacity:erased.includes(item.id)?.08:undefined},width:shown.width,height:shown.height,measured:{width:shown.width,height:shown.height},selected:selected.includes(item.id),data:{item:shown,boardId,english,onUpdate:update,onRemove:remove,onRefine:refine,webglAvailable},draggable:mode==='select'};
  })??[],[board?.document.items,boardId,live,selected,english,update,remove,refine,webglAvailable,mode,erased]);
  const artifacts=useMemo<VisualArtifact[]>(()=>board?.document.items.filter(item=>item.kind==='model').map(item=>({id:item.id,label:item.kind==='model'?item.scene.label:'',kind:'model',x:item.x,y:item.y,width:item.width,height:item.height,mediaId:null,scene:item.kind==='model'?item.scene:null,source:null,revisions:[],revisionIndex:0}))??[],[board?.document.items]);
  const edges=useMemo(()=>board?.document.edges.map(edge=>({id:edge.id,source:`visual:${edge.source}`,target:`visual:${edge.target}`,sourceHandle:'out',targetHandle:'in',type:'default',style:{stroke:'rgb(var(--ai-accent) / .35)',strokeWidth:1.2},selected:selected.includes(`edge:${edge.id}`)}))??[],[board?.document.edges,selected]);
  const changes=(changes:NodeChange[])=>{
    if(changes.some(change=>change.type==='position'&&change.dragging===true))holdDrag();
    setLive(previous=>{const next={...previous};for(const change of changes){const id='id'in change?change.id.replace(/^visual:/,''):'';if(change.type==='position'&&change.position)next[id]={...next[id],x:change.position.x,y:change.position.y};if(change.type==='dimensions'&&change.dimensions)next[id]={...next[id],width:change.dimensions.width,height:change.dimensions.height};}return next;});
    setSelected(previous=>{let next=[...previous];for(const change of changes)if(change.type==='select'){const id=change.id.replace(/^visual:/,'');next=change.selected?[...new Set([...next,id])]:next.filter(value=>value!==id);}return next;});
  };
  const stopDrag=(_event:unknown,_node:Node,moved:Node[])=>{
    try{safely(()=>{const latest=current();if(!latest)return;const positions=new Map(moved.map(node=>[node.id.replace(/^visual:/,''),node.position]));save({...latest.document,items:latest.document.items.map(item=>positions.has(item.id)?{...item,...positions.get(item.id)!}:item)});});}
    finally{releaseDrag();}
  };
  const ingestImages=async(loadFiles:(signal:AbortSignal)=>Promise<File[]>)=>{
    const initial=current();if(!alive.current||!initial||initial.archived||useWorkspaceStore.getState().activeBoardId!==boardId)return;
    const release=registerDataIngestion(),controller=new AbortController();
    const finish=()=>{release();imports.current.delete(controller);if(alive.current)setImporting(imports.current.size>0);};
    imports.current.add(controller);controller.signal.addEventListener('abort',finish,{once:true});setImporting(true);
    try{
      const files=await loadFiles(controller.signal);controller.signal.throwIfAborted();
      const images=[];for(const file of files)images.push(await importNoteImage(file,controller.signal));
      controller.signal.throwIfAborted();const latest=current();if(!alive.current||!latest||latest.archived||useWorkspaceStore.getState().activeBoardId!==boardId)return;
      const point=center();
      const added:BoardItem[]=images.map((image,index)=>{const factor=Math.min(1,420/Math.max(image.width,image.height)),width=image.width*factor,height=image.height*factor;return {id:nanoid(12),kind:'image',src:image.src,label:image.label,width,height,x:point.x-width/2+index*24,y:point.y-height/2+index*24};});
      save({...latest.document,items:[...latest.document.items,...added]});setSelected(added.map(item=>item.id));
    }catch(reason){if(alive.current&&!controller.signal.aborted)setError(reason instanceof Error&&reason.message==='boardImageMissing'?t('Imagem indisponível.','Image unavailable.'):t('Use PNG, JPEG ou WebP até 10 MB. Confira também o limite do quadro.','Use PNG, JPEG or WebP up to 10 MB. Check the board limit as well.'));}
    finally{controller.signal.removeEventListener('abort',finish);finish();}
  };
  const addImages=async(files:File[])=>{
    if(!files.length)return;if(files.length>8){setError(t('Adicione até 8 imagens por vez.','Add up to 8 images at once.'));return;}
    await ingestImages(async()=>files);
  };
  const pasteCanvasImage=(mediaId:string,label:string)=>ingestImages(async signal=>{
    const blob=await readVisualMedia(mediaId).catch(reason=>{throw new Error('boardImageMissing',{cause:reason});});
    signal.throwIfAborted();if(!blob)throw new Error('boardImageMissing');
    return [new File([blob],label||'Image',{type:blob.type})];
  });
  const clipboardActions=useRef({selected,addImages,pasteCanvasImage,insert,save,center});clipboardActions.current={selected,addImages,pasteCanvasImage,insert,save,center};
  useEffect(()=>{
    const target=canvas.current;if(!target)return;
    const copy=(event:ClipboardEvent)=>{
      const actions=clipboardActions.current;if(editable(event.target)||!actions.selected.length||!event.clipboardData)return;
      const latest=current();if(!latest)return;
      try{const text=boardClipboard(latest.document,actions.selected);event.clipboardData.setData('text/plain',text);event.preventDefault();}catch{setError(english?'Could not copy this selection.':'Não foi possível copiar esta seleção.');}
    };
    const paste=(event:ClipboardEvent)=>{
      if(editable(event.target)||!event.clipboardData)return;const data=event.clipboardData,actions=clipboardActions.current;
      const files=Array.from(data.items??[]).filter(value=>value.kind==='file'&&value.type.startsWith('image/')).map(value=>value.getAsFile()).filter((value):value is File=>!!value);
      if(!files.length)files.push(...Array.from(data.files??[]).filter(file=>file.type.startsWith('image/')));
      if(files.length){event.preventDefault();void actions.addImages(files);return;}
      const text=data.getData(ARTIFACT_CLIPBOARD_TYPE)||data.getData('text/plain');if(!text)return;
      event.preventDefault();
      try{
        const latest=current();if(!latest)return;
        const snapshot=parseBoardClipboard(text);
        if(snapshot){const next=pasteBoardItems(latest.document,snapshot,actions.center());actions.save(next);setSelected(next.items.slice(latest.document.items.length).map(item=>item.id));return;}
        const source=parseArtifactClipboard(text)?.artifact;
        if(source){
          const base={id:nanoid(12),x:0,y:0,width:source.width,height:source.height};
          if(source.kind==='model'&&source.scene)actions.insert({...base,kind:'model',scene:source.scene});
          else if(source.kind==='diagram'&&source.diagram)actions.insert({...base,kind:'diagram',diagram:{...source.diagram,elements:source.diagram.elements.map(element=>({...element,nodeId:null}))},values:source.diagramValues??{}});
          else if(source.kind==='image'&&source.mediaId)void actions.pasteCanvasImage(source.mediaId,source.label);
          return;
        }
        actions.insert({id:nanoid(12),kind:'text',x:0,y:0,width:340,height:180,text:text.slice(0,20000),color:'#94a3b8',fontSize:20});
      }catch{setError(english?'Invalid or oversized clipboard content.':'Conteúdo da área de transferência inválido ou grande demais.');}
    };
    target.addEventListener('copy',copy);target.addEventListener('paste',paste);
    return()=>{target.removeEventListener('copy',copy);target.removeEventListener('paste',paste);};
  },[boardId,english]);
  const keyboard=(event:React.KeyboardEvent)=>{
    if(editable(event.target))return;
    if(event.key==='Escape'){selectMode('select');setSelected([]);maximize(false);return;}
    const mod=event.ctrlKey||event.metaKey;
    if(mod&&['z','y'].includes(event.key.toLowerCase())){event.preventDefault();travel(event.key.toLowerCase()==='y'||event.shiftKey?'future':'past');}
    else if(mod&&event.key.toLowerCase()==='d'){event.preventDefault();safely(()=>{const latest=current();if(!latest||!selected.length)return;const snapshot=parseBoardClipboard(boardClipboard(latest.document,selected))!;const next=pasteBoardItems(latest.document,snapshot);save(next);setSelected(next.items.slice(latest.document.items.length).map(item=>item.id));});}
    else if(['Delete','Backspace'].includes(event.key)&&selected.length){event.preventDefault();safely(()=>{const latest=current();if(!latest)return;save({...removeBoardItems(latest.document,selected),edges:latest.document.edges.filter(edge=>!selected.includes(edge.source)&&!selected.includes(edge.target)&&!selected.includes(`edge:${edge.id}`))});setSelected([]);});}
  };
  const eventPoint=(event:{clientX:number;clientY:number;pressure?:number;pointerType?:string})=>sampleInkPoint({...api.screenToFlowPosition({x:event.clientX,y:event.clientY}),pressure:event.pressure,pointerType:event.pointerType});
  const eraseAt=(action:InkGesture,path:InkPoint[])=>{
    const latest=current();if(!latest)return;
    for(const id of boardDrawingIdsNearPath(latest.document,path,12/api.getViewport().zoom))action.erased.add(id);
    setErased([...action.erased]);
  };
  const drawStart=(event:PointerEvent<HTMLDivElement>)=>{
    const latest=current();
    if(event.button!==0||event.isPrimary===false||gesture.current||mode==='select'||!latest||latest.archived||useWorkspaceStore.getState().activeBoardId!==boardId)return;event.preventDefault();event.stopPropagation();canvas.current?.focus({preventScroll:true});
    const point=eventPoint(event),id=nanoid(12),action:InkGesture={pointer:event.pointerId,boardId,id,mode,points:[point],settings:{...settings},straight,erased:new Set(),release:registerDataIngestion(),finish:cancelled=>{if(mode==='draw')liveInk.finish(id,cancelled);}};
    gesture.current=action;setInk([point]);try{event.currentTarget.setPointerCapture?.(event.pointerId);}catch{/* A synthetic event may have no active pointer. */}
    if(mode==='eraser'){setEraserPoint(point);eraseAt(action,[point]);}
    else if(mode==='draw')try{liveInk.preview(id,positionedInk(action.points,action.settings,id));}catch{cancelGesture();setError(t('O traço atingiu o limite de tamanho.','The stroke reached the size limit.'));}
  };
  const appendPoints=(event:PointerEvent<HTMLDivElement>,includeEnd=false)=>{
    const action=gesture.current;if(!action||event.pointerId!==action.pointer)return;
    const coalesced=event.nativeEvent?.getCoalescedEvents?.()??[];
    const events=coalesced.length?[...coalesced,event]:[event];
    for(const sample of events){
      const point=eventPoint(sample),last=action.points.at(-1)!;
      if(action.mode==='eraser'){eraseAt(action,[last,point]);setEraserPoint(point);action.points=[point];continue;}
      if(action.points.length>=4096)break;
      const distance=Math.hypot(point.x-last.x,point.y-last.y);
      if(distance<(includeEnd ? .01 : .5/api.getViewport().zoom))continue;
      if(action.mode==='draw'&&action.straight)action.points=[action.points[0],point];else action.points.push(point);
    }
    setInk([...action.points]);
    if(action.mode==='draw')try{liveInk.preview(action.id,positionedInk(action.points,action.settings,action.id));}catch{cancelGesture();setError(t('O traço atingiu o limite de tamanho.','The stroke reached the size limit.'));}
  };
  const drawMove=(event:PointerEvent<HTMLDivElement>)=>{
    if(mode==='eraser')setEraserPoint(eventPoint(event));appendPoints(event);
  };
  const drawEnd=(event:PointerEvent<HTMLDivElement>,cancel=false)=>{
    const action=gesture.current;if(!action||event.pointerId!==action.pointer)return;
    if(!cancel)appendPoints(event,true);
    if(gesture.current!==action)return;
    if(cancel||action.boardId!==boardId){cancelGesture();return;}
    let committed=false;
    try{
      const latest=current();if(!latest)return;
      if(action.mode==='draw')save({...latest.document,items:[...latest.document.items,{...drawingItem(action.points,action.settings.color,action.settings.width,action.settings),id:action.id}]});
      else if(action.mode==='eraser'&&action.erased.size){save(removeBoardItems(latest.document,[...action.erased]));setSelected(values=>values.filter(id=>!action.erased.has(id)));}
      else if(action.mode==='lasso'){setSelected(selectBoardItemsInLasso(latest.document,action.points));setMode('select');}
      committed=true;
    }catch{setError(t('Não foi possível aplicar. Confira o tamanho ou conteúdo do quadro.','Could not apply. Check the size or content of this board.'));}
    finally{cancelGesture(!committed);}
  };
  const tool=(Icon:typeof Pencil1Icon,label:string,action:()=>void,pressed?:boolean,disabled=false)=><button type="button" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={action}><Icon width={17} height={17}/></button>;
  if(!board)return null;
  return <section className={`db-canvas-shell ${maximized?'is-maximized':''}`}>
    <ExpandedChrome expanded={maximized} label={board.title} english={english} onRestore={()=>maximize(false)}>
    <header className="db-canvas-header">{!maximized&&shell?.navigation}<button className="ws-icon-button" aria-label={t('Voltar aos quadros','Back to boards')} title={t('Voltar aos quadros','Back to boards')} onClick={()=>{maximize(false);onBack();}}><ArrowLeftIcon/></button><span className="db-header-brand">Dynamic Board<span>/</span></span><AudioTextInput audioScope={`board:${boardId}:title`} audioLanguage={english ? 'en' : 'pt'} audioWrapperClassName="db-title-audio-field" aria-label={t('Nome do quadro','Board name')} value={title} maxLength={240} onChange={event=>setTitle(event.target.value)} onBlur={rename} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setTitle(board.title);}}}/><button className="ws-icon-button" aria-label={maximized?t('Restaurar quadro','Restore board view'):t('Maximizar quadro','Maximize board')} aria-pressed={maximized} title={maximized?t('Restaurar quadro','Restore board view'):t('Maximizar quadro','Maximize board')} onClick={()=>maximize(!maximized)}>{maximized?<ExitFullScreenIcon/>:<CornersIcon/>}</button></header>
    </ExpandedChrome>
    <div className="db-canvas" ref={canvas} data-board-canvas tabIndex={0} role="region" aria-label={t('Canvas livre','Free canvas')} onKeyDown={keyboard} onDragOver={event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();}} onDrop={event=>{if(event.dataTransfer.files.length){event.preventDefault();void addImages(Array.from(event.dataTransfer.files));}}}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={changes} defaultViewport={board.document.viewport} minZoom={.05} maxZoom={4} deleteKeyCode={null} selectionKeyCode="Shift" multiSelectionKeyCode="Shift" panOnScroll zoomOnScroll={false} zoomOnPinch panOnDrag={mode==='select'} selectionOnDrag={false} onPaneClick={()=>setSelected([])} onNodeClick={event=>{if(!(event as {ctrlKey?:boolean}).ctrlKey&&!editable(event.target)&&!(event.target instanceof Element&&event.target.closest('button,.nodrag,.board-text-editor')))canvas.current?.focus({preventScroll:true});}} onNodeDragStart={holdDrag} onNodeDragStop={stopDrag} onMoveEnd={(event,viewport)=>{if(event)saveViewport(viewport);}} onConnect={(connection:Connection)=>safely(()=>{const latest=current();if(!latest||!connection.source||!connection.target)return;const source=connection.source.replace(/^visual:/,''),target=connection.target.replace(/^visual:/,'');if(source===target||latest.document.edges.some(edge=>edge.source===source&&edge.target===target))return;save({...latest.document,edges:[...latest.document.edges,{id:nanoid(12),source,target}]});})} onEdgesChange={changes=>setSelected(previous=>{let next=[...previous];for(const change of changes)if(change.type==='select')next=change.selected?[...new Set([...next,`edge:${change.id}`])]:next.filter(value=>value!==`edge:${change.id}`);return next;})} proOptions={{hideAttribution:true}}>
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgb(var(--text-faint) / .32)"/>
        {artifacts.length > 0 && <Suspense fallback={null}><VisualCanvasLayer artifacts={artifacts} onAvailability={setWebglAvailable}/></Suspense>}
      </ReactFlow>
      {!board.document.items.length&&<div className="db-canvas-empty" aria-hidden="true"><span>+</span><p>{t('Comece com uma ideia','Start with an idea')}</p><small>{t('Escreva, desenhe ou peça um diagrama.','Write, draw or ask for a diagram.')}</small></div>}
      <svg data-board-live-ink className="db-live-ink" aria-hidden="true"><g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
        {liveInk.remote.filter(value=>!board.document.items.some(item=>item.id===(value.stroke.id??value.gestureId))).map(value=><g key={`${value.sender}:${value.gestureId}`} transform={`translate(${value.stroke.x??0} ${value.stroke.y??0})`}><InkStroke stroke={value.stroke} data-board-remote-stroke={value.gestureId}/></g>)}
      </g></svg>
      <div className="db-tools" role="toolbar" aria-label={t('Ferramentas do quadro','Board tools')}>
        {tool(CursorArrowIcon,t('Selecionar e mover','Select and move'),()=>selectMode('select'),mode==='select')}{tool(Pencil1Icon,t('Desenhar','Draw'),()=>selectMode(mode==='draw'?'select':'draw'),mode==='draw')}{tool(EraserIcon,t('Borracha de traços','Stroke eraser'),()=>selectMode(mode==='eraser'?'select':'eraser'),mode==='eraser')}{tool(LoopIcon,t('Selecionar com laço','Lasso select'),()=>selectMode(mode==='lasso'?'select':'lasso'),mode==='lasso')}<i/>
        {tool(CardStackIcon,t('Adicionar cartão','Add card'),()=>add('card'))}{tool(TextIcon,t('Adicionar texto','Add text'),()=>add('text'))}{tool(UploadIcon,t('Adicionar imagem','Add image'),()=>input.current?.click())}<i/>
        {tool(Share2Icon,t('Gerar diagrama','Generate diagram'),()=>setComposer({kind:'diagram'}))}{tool(CubeIcon,t('Gerar 3D','Generate 3D'),()=>setComposer({kind:'model'}))}{tool(ImageIcon,t('Buscar imagens','Search images'),()=>setComposer({kind:'image'}))}<i/>
        {tool(ResetIcon,t('Desfazer','Undo'),()=>travel('past'),undefined,!history.current.past.length)}{tool(ArrowRightIcon,t('Refazer','Redo'),()=>travel('future'),undefined,!history.current.future.length)}
      </div>
      {mode==='draw'&&<div className="db-pen-options"><InkToolbar value={settings} onChange={setSettings} english={english} disabled={!!gesture.current}/><button type="button" className="db-ruler-toggle" aria-label={t('Régua (linha reta)','Ruler (straight line)')} title={t('Régua (linha reta)','Ruler (straight line)')} aria-pressed={straight} disabled={!!gesture.current} onClick={()=>setStraight(value=>!value)}><RulerHorizontalIcon/></button></div>}
      {(mode==='eraser'||mode==='lasso'||mode==='draw'&&straight)&&<div className="db-ink-hint" role="status">{mode==='eraser'?t('Arraste para apagar traços inteiros','Drag to erase whole strokes'):mode==='lasso'?t('Contorne objetos para selecionar','Draw around objects to select'):t('Régua · arraste para traçar uma linha reta','Ruler · drag to draw a straight line')}</div>}
      {mode!=='select'&&<div ref={drawingLayer} className={`db-drawing-layer is-${mode}`} onPointerDown={drawStart} onPointerMove={drawMove} onPointerUp={event=>drawEnd(event)} onPointerCancel={event=>drawEnd(event,true)} onLostPointerCapture={event=>{if(gesture.current?.pointer===event.pointerId)cancelGesture();}} onPointerLeave={()=>{if(!gesture.current)setEraserPoint(null);}}><svg><g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
        {mode==='draw'&&ink.length>0&&<InkStroke stroke={{...settings,points:ink}} legacyMode="board"/>}
        {mode==='lasso'&&ink.length>0&&<polyline className="db-lasso-path" points={ink.map(point=>`${point.x},${point.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth={1.5/viewport.zoom} strokeDasharray={`${5/viewport.zoom} ${4/viewport.zoom}`}/>}
        {mode==='eraser'&&eraserPoint&&<circle className="db-eraser-cursor" cx={eraserPoint.x} cy={eraserPoint.y} r={12/viewport.zoom} strokeWidth={1/viewport.zoom}/>}
      </g></svg></div>}
      <div className="db-view-tools" role="toolbar" aria-label={t('Vista do quadro','Board view')}>{tool(MinusIcon,t('Afastar','Zoom out'),()=>void changeView(()=>api.zoomOut()))}{tool(PlusIcon,t('Aproximar','Zoom in'),()=>void changeView(()=>api.zoomIn()))}{tool(CornersIcon,t('Enquadrar objetos','Fit objects'),()=>void changeView(()=>api.fitView({padding:.2,maxZoom:1})))}</div>
      {(error||importing)&&<div className="db-status" role="status">{error||t('Adicionando imagem…','Adding image…')}{error&&<button aria-label={t('Fechar aviso','Dismiss message')} onClick={()=>setError('')}>×</button>}</div>}
      <span className="db-object-count">{board.document.items.length} {t('objetos','objects')}</span>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden aria-label={t('Escolher imagens','Choose images')} onChange={event=>{const files=Array.from(event.target.files??[]);event.target.value='';void addImages(files);}}/>
      {composer&&<BoardComposer key={`${composer.kind}:${composer.itemId??''}`} boardId={boardId} kind={composer.kind} itemId={composer.itemId} english={english} onInsert={insert} onClose={()=>setComposer(null)}/>}
    </div>
  </section>;
}
export function BoardCanvas(props:Props){return <ReactFlowProvider><Canvas {...props}/></ReactFlowProvider>;}
