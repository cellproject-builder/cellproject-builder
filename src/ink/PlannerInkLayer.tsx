import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { nanoid } from 'nanoid';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { registerDataIngestion } from '@/cloud/activity';
import type { Project } from '@/types';
import { getVisualWorkspace, mutateVisualWorkspace, watchVisualScope } from '@/visuals/domain';
import { InkStroke } from './InkStroke';
import { InkToolbar } from './InkToolbar';
import { InkPalette } from './InkPalette';
import { calculateInkViewport, InkPointerRouter, type InkScreenPoint, type InkViewport } from './pointerGestures';
import { createInkSettings, type InkPoint } from './model';
import { inkStrokeNearPath } from './geometry';
import { canvasInkSchema, positionedInk, rebaseInk, type CanvasInkStroke } from './canvasModel';
import { useLiveInk } from './live';
import './planner-ink.css';

type Operation = { before: CanvasInkStroke[]; after: CanvasInkStroke[] };
type Gesture = { pointer: number; before: CanvasInkStroke[]; points: InkPoint[]; erased: Set<string>; id: string; guard: ReturnType<typeof watchVisualScope>; release(): void; finish(cancelled: boolean): void };
const paths = { pen: 'M4 20l5-1L21 7l-5-5L4 14z M14 4l6 6', eraser: 'M3 15l10-11 8 7-9 10H9z M7 11l8 7', undo: 'M8 5l-5 5 5 5 M3 10h10a6 6 0 0 1 0 12', redo: 'M16 5l5 5-5 5 M21 10H11a6 6 0 0 0 0 12', ruler: 'M3 16L16 3l5 5L8 21z M8 12l3 3 M12 8l3 3', close: 'M6 6l12 12 M6 18L18 6' };
function Icon({ name }: { name: keyof typeof paths }) { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>; }

/** Annotation overlay uses the same world transform as plan nodes; it never edits their topology. */
export function PlannerInkLayer({ project, containerRef, english = false }: { project: Project; containerRef: RefObject<HTMLDivElement>; english?: boolean }) {
  const api = useReactFlow(), viewport = useViewport();
  const liveInk = useLiveInk({ surface: 'planner', documentId: project.id });
  const [active, setActive] = useState(false), [eraser, setEraser] = useState(false), [ruler, setRuler] = useState(false);
  const [fingerDrawing, setFingerDrawing] = useState(false), fingerRef = useRef(false); fingerRef.current = fingerDrawing;
  const pointers = useRef(new InkPointerRouter(() => fingerRef.current)), captures = useRef(new Set<number>());
  const navigation = useRef<{ viewport: InkViewport; points: InkScreenPoint[]; latest: InkViewport } | null>(null);
  const [settings, setSettings] = useState(createInkSettings), [preview, setPreview] = useState<CanvasInkStroke | null>(null), [erased, setErased] = useState(new Set<string>()), [error, setError] = useState('');
  const [, refresh] = useState(0), stage = useRef<HTMLDivElement>(null), gesture = useRef<Gesture | null>(null);
  const history = useRef<{ past: Operation[]; future: Operation[] }>({ past: [], future: [] });
  const t = (pt: string, en: string) => english ? en : pt;
  const saved = getVisualWorkspace(project).ink?.strokes ?? [];
  const cancel = (cancelled = true) => {
    const action = gesture.current; gesture.current = null; action?.guard.dispose(); action?.finish(cancelled); action?.release();
    if (action && !pointers.current.hasPointer(action.pointer) && stage.current?.hasPointerCapture?.(action.pointer)) stage.current.releasePointerCapture(action.pointer);
    setPreview(null); setErased(new Set());
  };
  const reset = () => {
    pointers.current.reset(); navigation.current = null; cancel();
    for (const id of captures.current) try { if (stage.current?.hasPointerCapture?.(id)) stage.current.releasePointerCapture(id); } catch { /* Already released. */ }
    captures.current.clear();
  };
  useEffect(() => { reset(); history.current = { past: [], future: [] }; setActive(false); }, [project.id]);
  useEffect(() => {
    const check = () => { const action = gesture.current; if (action) try { action.guard.assert(); } catch { reset(); } };
    const offGraph = useGraphStore.subscribe(check), offWorkspace = useWorkspaceStore.subscribe(check);
    const blur = () => reset(); window.addEventListener('blur', blur);
    return () => { offGraph(); offWorkspace(); window.removeEventListener('blur', blur); pointers.current.reset(); navigation.current = null; const action = gesture.current; gesture.current = null; action?.guard.dispose(); action?.finish(true); action?.release(); };
  }, []);
  const latest = () => {
    const current = useGraphStore.getState().project;
    if (!current || current.id !== project.id) throw new Error('canvasInkContextChanged');
    return getVisualWorkspace(current).ink?.strokes ?? [];
  };
  const apply = (strokes: CanvasInkStroke[]) => {
    const ink = canvasInkSchema.parse({ version: 1, strokes });
    latest(); mutateVisualWorkspace(workspace => ({ ...workspace, ink })); setError('');
  };
  const commit = (before: CanvasInkStroke[], after: CanvasInkStroke[]) => {
    try {
      const current = latest(), next = rebaseInk(before, after, current);
      apply(next); history.current.past.push({ before: current, after: next }); history.current.past = history.current.past.slice(-50); history.current.future = []; refresh(value => value + 1); return true;
    } catch { setError(t('Não foi possível salvar este traço. Confira o limite do desenho.', 'Could not save this stroke. Check the drawing limit.')); return false; }
  };
  const travel = (direction: 'past' | 'future') => {
    const operation = history.current[direction].at(-1); if (!operation || gesture.current) return;
    try {
      apply(rebaseInk(direction === 'past' ? operation.after : operation.before, direction === 'past' ? operation.before : operation.after, latest()));
      history.current[direction].pop(); history.current[direction === 'past' ? 'future' : 'past'].push(operation); refresh(value => value + 1);
    } catch { setError(t('Não foi possível restaurar esta alteração.', 'This change could not be restored.')); }
  };
  const point = (event: { clientX: number; clientY: number; pointerType?: string; pressure?: number }): InkPoint => {
    const position = api.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    return { x: Math.max(-100000, Math.min(100000, position.x)), y: Math.max(-100000, Math.min(100000, position.y)), ...(event.pointerType === 'pen' && Number.isFinite(event.pressure) ? { pressure: Math.max(0, Math.min(1, event.pressure!)) } : {}) };
  };
  const erase = (action: Gesture, path: InkPoint[]) => {
    for (const stroke of action.before) if (!action.erased.has(stroke.id) && inkStrokeNearPath(stroke, path.map(point => ({ x: point.x - stroke.x, y: point.y - stroke.y })), 10 / viewport.zoom)) action.erased.add(stroke.id);
    setErased(new Set(action.erased));
  };
  const begin = (event: PointerEvent<HTMLDivElement>) => {
    if (!active || event.button !== 0 || gesture.current) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true });
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Synthetic events have no active pointer. */ }
    try {
      const id = nanoid(12), action: Gesture = { pointer: event.pointerId, before: latest(), points: [point(event)], erased: new Set<string>(), id, guard: watchVisualScope(), release: registerDataIngestion(), finish: cancelled => { if (!eraser) liveInk.finish(id, cancelled); } };
      gesture.current = action;
      if (eraser) erase(action, [action.points[0]]);
      else { const stroke = positionedInk(action.points, settings, action.id); setPreview(stroke); liveInk.preview(action.id, stroke); }
    } catch { cancel(); setError(t('Não foi possível iniciar o traço neste contexto.', 'Could not start a stroke in this context.')); }
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const action = gesture.current; if (!action || action.pointer !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    try { action.guard.assert(); } catch { reset(); return; }
    const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const sample of [...coalesced, event]) {
      const where = point(sample);
      if (eraser) { erase(action, [action.points[0], where]); action.points = [where]; continue; }
      const previous = action.points.at(-1)!;
      if (ruler) action.points = [action.points[0], where];
      else if (action.points.length < 4096 && Math.hypot(where.x - previous.x, where.y - previous.y) >= .35) action.points.push(where);
    }
    if (!eraser) { try { const stroke = positionedInk(action.points, settings, action.id); setPreview(stroke); liveInk.preview(action.id, stroke); } catch { cancel(); setError(t('O traço atingiu o limite de tamanho.', 'The stroke reached the size limit.')); } }
  };
  const route = (event: PointerEvent<HTMLDivElement>, phase: 'down' | 'move' | 'up', cancelled = false) => {
    if (!active) return;
    const result = phase === 'down' ? pointers.current.down(event) : phase === 'move' ? pointers.current.move(event) : pointers.current.up(event, cancelled);
    if (!result.handled) return;
    event.preventDefault(); event.stopPropagation();
    if (phase === 'down') { captures.current.add(event.pointerId); try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Synthetic pointer. */ } }
    for (const action of result.actions) {
      if (action.kind === 'draw-start') begin(event);
      else if (action.kind === 'draw-move') move(event);
      else if (action.kind === 'draw-end') finish(event);
      else if (action.kind === 'draw-cancel') cancel();
      else if (action.kind === 'navigate-start') {
        const view = navigation.current?.latest ?? api.getViewport(); navigation.current = { viewport: { ...view }, latest: { ...view }, points: action.points };
      } else if (action.kind === 'navigate-move' && navigation.current) {
        const nav = navigation.current, bounds = containerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
        nav.latest = calculateInkViewport(nav.viewport, nav.points, action.points, bounds, { minZoom: .05, maxZoom: 2 });
        void api.setViewport(nav.latest, { duration: 0 });
      } else if (action.kind === 'navigate-end') navigation.current = null;
    }
    if (phase === 'up') { captures.current.delete(event.pointerId); try { if (stage.current?.hasPointerCapture?.(event.pointerId)) stage.current.releasePointerCapture(event.pointerId); } catch { /* Already released. */ } }
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const action = gesture.current; if (!action || action.pointer !== event.pointerId) return;
    move(event); if (gesture.current !== action) return;
    let committed = false;
    try {
      action.guard.assert();
      const after = eraser ? action.before.filter(stroke => !action.erased.has(stroke.id)) : [...action.before, positionedInk(action.points, settings, action.id)];
      if (!eraser || action.erased.size) committed = commit(action.before, after);
      else committed = true;
    } catch { setError(t('Não foi possível salvar este traço neste contexto.', 'Could not save this stroke in this context.')); }
    finally { cancel(!committed); }
  };
  const button = (name: keyof typeof paths, label: string, action: () => void, pressed?: boolean, disabled = false) => <button type="button" aria-label={label} title={label} onClick={action} aria-pressed={pressed} disabled={disabled}><Icon name={name} /></button>;
  return <>
    <svg className="planner-ink-svg" aria-hidden="true"><g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
      {saved.filter(stroke => !erased.has(stroke.id)).map(stroke => <g key={stroke.id} transform={`translate(${stroke.x} ${stroke.y})`}><InkStroke stroke={stroke} data-planner-stroke={stroke.id} /></g>)}
      {liveInk.remote.filter(value => !saved.some(stroke => stroke.id === (value.stroke.id ?? value.gestureId))).map(value => <g key={`${value.sender}:${value.gestureId}`} transform={`translate(${value.stroke.x ?? 0} ${value.stroke.y ?? 0})`}><InkStroke stroke={value.stroke} data-planner-remote-stroke={value.gestureId} /></g>)}
      {preview && <g transform={`translate(${preview.x} ${preview.y})`}><InkStroke stroke={preview} /></g>}
    </g></svg>
    <div ref={stage} data-planner-ink className="planner-ink-input" style={{ pointerEvents: active ? 'auto' : 'none' }} tabIndex={active ? 0 : -1} role="group" aria-label={t('Desenho livre no plano', 'Free drawing on plan')} onPointerDown={event => route(event, 'down')} onPointerMove={event => route(event, 'move')} onPointerUp={event => route(event, 'up')} onPointerCancel={event => route(event, 'up', true)} onLostPointerCapture={event => { if (pointers.current.hasPointer(event.pointerId)) route(event, 'up', true); }} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); reset(); setActive(false); }
      else if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopPropagation(); travel(event.key === 'y' || event.shiftKey ? 'future' : 'past'); }
    }} />
    {!active ? <div className="planner-ink-tools">{button('pen', t('Desenhar no plano', 'Draw on plan'), () => { setActive(true); setEraser(false); containerRef.current?.querySelector<HTMLElement>('[data-planner-ink]')?.focus({ preventScroll: true }); })}</div> : <InkPalette label={t('Ferramentas do plano', 'Plan drawing tools')} english={english} className="planner-ink-palette">
        <InkToolbar value={settings} onChange={value => { reset(); setSettings(value); setEraser(false); }} english={english} />
        <div className="planner-ink-actions" role="toolbar" aria-label={t('Ações do desenho', 'Drawing actions')}>
          {button('eraser', t('Borracha', 'Eraser'), () => { reset(); setEraser(!eraser); }, eraser)}
          {button('ruler', t('Régua — traço reto', 'Ruler — straight line'), () => { reset(); setRuler(!ruler); }, ruler)}
          {button('undo', t('Desfazer tinta', 'Undo ink'), () => travel('past'), undefined, !history.current.past.length)}
          {button('redo', t('Refazer tinta', 'Redo ink'), () => travel('future'), undefined, !history.current.future.length)}
          {button('close', t('Voltar ao mapa', 'Back to map'), () => { reset(); setActive(false); })}
        </div>
        <label className="ink-finger-option"><input type="checkbox" aria-label={t('Desenhar com dedo', 'Draw with finger')} checked={fingerDrawing} onChange={event => { reset(); setFingerDrawing(event.target.checked); }} />{t('Desenhar com dedo', 'Draw with finger')}</label>
      {error && <span role="status">{error}</span>}
    </InkPalette>}
  </>;
}
