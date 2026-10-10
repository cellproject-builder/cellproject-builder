import { memo, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Handle, NodeResizer, NodeToolbar, Position, type Node, type NodeProps } from '@xyflow/react';
import { Pencil1Icon, TrashIcon, MagicWandIcon, ResetIcon } from '@/components/ui/SoftIcons';
import { DiagramView } from '@/visuals/diagram/DiagramView';
import { useVisualViewStore } from '@/visuals/rendering/viewStore';
import type { BoardItem } from './model';
import { InkStroke } from '@/ink/InkStroke';
import { registerDataIngestion } from '@/cloud/activity';
import { BoardRichText, BoardTextEditor } from './BoardText';
import './board-item.css';

export type BoardNodeData = {
  item: BoardItem; english: boolean; webglAvailable: boolean;
  onUpdate(item: BoardItem): void; onRemove(id: string): void; onRefine(id: string): void;
} & Record<string, unknown>;

export const BoardItemNode = memo(function BoardItemNode({ data, selected, dragging, width, height }: NodeProps<Node<BoardNodeData>>) {
  const { item, english: en, onUpdate, onRemove, onRefine, webglAvailable } = data;
  const [editing, setEditing] = useState(false), [rotating, setRotating] = useState(false), [controlHeld, setControlHeld] = useState(false), [resizing, setResizing] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ pointerId: number; x: number; y: number; shortcut: boolean } | null>(null);
  const drawingResize = useRef<Pick<Extract<BoardItem, { kind: 'drawing' }>, 'id' | 'width' | 'height' | 'points'> | null>(null);
  const resizeRelease=useRef<(() => void)|null>(null);
  const releaseResize=()=>{resizeRelease.current?.();resizeRelease.current=null;};
  const suppressClick = useRef(false);
  const isText = item.kind === 'card' || item.kind === 'text';
  const quickOrbit = item.kind === 'model' && controlHeld, orbitActive = item.kind === 'model' && rotating && selected;
  const release = () => {
    const current = gesture.current; gesture.current = null;
    if (current && surface.current?.hasPointerCapture?.(current.pointerId)) surface.current.releasePointerCapture(current.pointerId);
  };
  useEffect(() => { setEditing(false); setRotating(false); drawingResize.current = null; }, [item.id]);
  useEffect(()=>{
    const cancel=()=>{releaseResize();drawingResize.current=null;setResizing(false);};
    window.addEventListener('mouseup',releaseResize,true);window.addEventListener('touchend',releaseResize,true);window.addEventListener('pointercancel',cancel);window.addEventListener('touchcancel',cancel,true);window.addEventListener('blur',cancel);
    return()=>{window.removeEventListener('mouseup',releaseResize,true);window.removeEventListener('touchend',releaseResize,true);window.removeEventListener('pointercancel',cancel);window.removeEventListener('touchcancel',cancel,true);window.removeEventListener('blur',cancel);releaseResize();};
  },[item.id]);
  useEffect(() => { if (!selected) setRotating(false); }, [selected]);
  useEffect(() => {
    if (item.kind !== 'model') return;
    const key = (event: globalThis.KeyboardEvent) => {
      const held = event.key === 'Control' ? event.type === 'keydown' : event.ctrlKey;
      setControlHeld(held); if (!held && gesture.current?.shortcut) release();
    };
    const blur = () => { setControlHeld(false); release(); };
    window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', blur); release(); };
  }, [item.id, item.kind]);
  useEffect(() => {
    const target = surface.current; if (!target || item.kind !== 'model') return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
      event.preventDefault(); event.stopPropagation();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? target.clientHeight || 240 : 1);
      useVisualViewStore.getState().zoomBy(item.id, delta);
    };
    target.addEventListener('wheel', wheel, { capture: true, passive: false });
    return () => target.removeEventListener('wheel', wheel, true);
  }, [item.id, item.kind]);
  useEffect(() => { if (orbitActive) surface.current?.focus({ preventScroll: true }); else release(); }, [orbitActive]);

  const startOrbit = (event: PointerEvent<HTMLDivElement>) => {
    const shortcut = item.kind === 'model' && event.ctrlKey;
    if (event.button !== 0 || event.isPrimary === false || gesture.current) return;
    suppressClick.current = false;
    if (!orbitActive && !shortcut) return;
    event.preventDefault(); event.stopPropagation(); suppressClick.current = true;
    if (shortcut) setControlHeld(true);
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, shortcut };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveOrbit = (event: PointerEvent<HTMLDivElement>) => {
    if (item.kind === 'model') setControlHeld(event.ctrlKey);
    const current = gesture.current; if (!current || current.pointerId !== event.pointerId) return;
    if (current.shortcut ? !event.ctrlKey : !orbitActive) { release(); return; }
    event.preventDefault(); event.stopPropagation();
    useVisualViewStore.getState().orbit(item.id, (event.clientX - current.x) * .012, (event.clientY - current.y) * .012);
    gesture.current = { ...current, x: event.clientX, y: event.clientY };
  };
  const endOrbit = (event: PointerEvent<HTMLDivElement>) => { if (gesture.current?.pointerId === event.pointerId) { event.stopPropagation(); release(); } };
  const orbitKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!orbitActive) return;
    const step = Math.PI / 24, direction = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!direction && !['Home', 'Escape'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') setRotating(false);
    else if (event.key === 'Home') useVisualViewStore.getState().reset(item.id);
    else useVisualViewStore.getState().orbit(item.id, direction![0], direction![1]);
  };
  const label = isText ? (item.text.trim().split('\n')[0].slice(0, 100) || (en ? 'Untitled text' : 'Texto sem título'))
    : item.kind === 'image' ? item.label : item.kind === 'model' ? item.scene.label : item.kind === 'diagram' ? item.diagram.title : (en ? 'Drawing' : 'Desenho');
  const editLabel = en ? 'Edit text' : 'Editar texto';
  const background = item.kind === 'card' ? { '--board-tone': item.color } as CSSProperties : undefined;
  const originalDrawing = drawingResize.current?.id === item.id ? drawingResize.current : null;
  const onResize = (params: { x: number; y: number; width: number; height: number }) => {
    try {
    const rectangle = { x: params.x, y: params.y, width: params.width, height: params.height };
    const original = originalDrawing ?? item;
    drawingResize.current = null;
    if (item.kind === 'drawing' && 'points' in original) onUpdate({ ...item, ...rectangle, points: original.points.map(point => ({ ...point, x: Math.min(params.width, point.x * params.width / original.width), y: Math.min(params.height, point.y * params.height / original.height) })) });
    else onUpdate({ ...item, ...rectangle });
    } finally {releaseResize();setResizing(false);}
  };
  return <div className={`board-item board-item-${item.kind}${selected && !quickOrbit ? ' is-selected' : ''}${quickOrbit ? ' is-quick-orbit' : ''}${orbitActive ? ' is-orbiting' : ''}${editing ? ' is-editing' : ''}`}
    data-board-item-kind={item.kind} style={{ width: width ?? item.width, height: height ?? item.height, ...background }}>
    <Handle type="target" id="in" position={Position.Left} className="board-item-handle" />
    <Handle type="source" id="out" position={Position.Right} className="board-item-handle" />
    <NodeResizer isVisible={selected && !quickOrbit && !editing} minWidth={item.kind === 'diagram' ? 240 : 80} minHeight={item.kind === 'diagram' ? 160 : 60} maxWidth={10000} maxHeight={10000} keepAspectRatio={item.kind === 'image'}
      onResizeStart={() => {
        if(!resizeRelease.current)resizeRelease.current=registerDataIngestion();
        drawingResize.current = item.kind === 'drawing' ? { id: item.id, width: item.width, height: item.height, points: item.points.map(point => ({ ...point })) } : null;
        setResizing(true);
      }} onResizeEnd={(_event, params) => onResize(params)} />
    <div ref={surface} className={`board-item-surface${orbitActive || quickOrbit ? ' nodrag nopan nowheel' : ''}`} role="group" aria-label={label}
      tabIndex={orbitActive ? 0 : undefined} title={item.kind === 'model' ? (en ? 'Ctrl + drag to rotate · Ctrl + scroll to zoom' : 'Ctrl + arrastar para girar · Ctrl + rolar para aproximar') : undefined}
      onPointerDown={startOrbit} onPointerMove={moveOrbit} onPointerUp={endOrbit} onPointerCancel={endOrbit} onKeyDown={orbitKeys}
      onLostPointerCapture={() => { gesture.current = null; }} onPointerEnter={event => { if (item.kind === 'model') setControlHeld(event.ctrlKey); }}
      onMouseDownCapture={event => { if (event.button === 0 && (orbitActive || gesture.current || item.kind === 'model' && event.ctrlKey)) { event.preventDefault(); event.stopPropagation(); } }}
      onClickCapture={event => { if (suppressClick.current || orbitActive || item.kind === 'model' && event.ctrlKey) { event.preventDefault(); event.stopPropagation(); } }}
      onDoubleClickCapture={event => { if (suppressClick.current || orbitActive || item.kind === 'model' && event.ctrlKey) { event.preventDefault(); event.stopPropagation(); } }}
      onDoubleClick={event => { if (isText) { event.stopPropagation(); setEditing(true); } }}
      onTouchStart={orbitActive ? event => event.stopPropagation() : undefined}>
      {isText && (editing ? <BoardTextEditor key={item.id} text={item.text} color={item.color} fontSize={item.fontSize} english={en}
        onCancel={() => setEditing(false)} onCommit={value => { onUpdate({ ...item, ...value }); setEditing(false); }} />
        : <div className="board-text-preview" style={{ color: item.kind === 'text' ? item.color : undefined, fontSize: item.fontSize }}>
          {item.text ? <BoardRichText text={item.text} /> : <span className="board-text-placeholder">{en ? 'Double-click to write…' : 'Dois cliques para escrever…'}</span>}
        </div>)}
      {item.kind === 'image' && <img src={item.src} alt={item.label} draggable={false} className="board-item-image" />}
      {item.kind === 'drawing' && <svg className="board-item-drawing" viewBox={`0 0 ${originalDrawing?.width ?? item.width} ${originalDrawing?.height ?? item.height}`} preserveAspectRatio="none" aria-label={label} role="img">
        <InkStroke stroke={{...item,width:item.widthStroke}} legacyMode="board" data-board-stroke={item.id} />
      </svg>}
      {item.kind === 'diagram' && <DiagramView diagram={item.diagram} values={item.values} english={en} onParameter={(id, value) => onUpdate({ ...item, values: { ...item.values, [id]: value } })} />}
      {item.kind === 'model' && !webglAvailable && <span className="board-model-fallback">{en ? '3D preview needs WebGL 2' : 'Prévia 3D precisa de WebGL 2'}</span>}
    </div>
    <NodeToolbar isVisible={selected && !quickOrbit && !dragging && !resizing && !editing} position={Position.Bottom} offset={7}>
      <div className="board-item-actions nodrag nopan nowheel" role="group" aria-label={en ? 'Item actions' : 'Ações do item'}>
        {isText && <button type="button" title={editLabel} aria-label={editLabel} onClick={() => setEditing(true)}><Pencil1Icon /></button>}
        {item.kind === 'model' && <button type="button" aria-pressed={orbitActive} title={en ? 'Rotate 3D' : 'Girar 3D'} aria-label={en ? 'Rotate 3D' : 'Girar 3D'} onClick={() => setRotating(value => !value)}><ResetIcon /></button>}
        {isText && <button type="button" title={en ? 'Refine with AI' : 'Aprimorar com IA'} aria-label={en ? 'Refine with AI' : 'Aprimorar com IA'} onClick={() => onRefine(item.id)}><MagicWandIcon /></button>}
        <button type="button" title={en ? 'Remove from board' : 'Remover do quadro'} aria-label={en ? 'Remove from board' : 'Remover do quadro'} onClick={() => onRemove(item.id)}><TrashIcon /></button>
      </div>
    </NodeToolbar>
  </div>;
});
