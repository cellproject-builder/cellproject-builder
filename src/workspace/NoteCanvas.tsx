import { AudioTextarea } from '@/audio/AudioField';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type KeyboardEvent, type RefObject } from 'react';
import { nanoid } from 'nanoid';
import { DiagramView } from '@/visuals/diagram/DiagramView';
import { InkStroke } from '@/ink/InkStroke';
import { InkToolbar } from '@/ink/InkToolbar';
import { InkPalette } from '@/ink/InkPalette';
import { calculateInkViewport, InkPointerRouter, type InkScreenPoint, type InkViewport } from '@/ink/pointerGestures';
import { useLiveInk } from '@/ink/live';
import { registerDataIngestion } from '@/cloud/activity';
import { CursorArrowIcon, Pencil1Icon, EraserIcon, TextIcon, ImageIcon, MagicWandIcon, ResetIcon, RedoIcon, OptionsIcon, RulerHorizontalIcon, MoveIcon, ResizeIcon, CloseIcon, PlusIcon, MinusIcon } from '@/components/ui/SoftIcons';
import { createInkSettings } from '@/ink/model';
import { inkStrokeNearPath } from '@/ink/geometry';
import { noteCanvasSchema, type NoteCanvasDocument, type NoteCanvasItem, type NotePoint, type NoteStroke } from './noteCanvasModel';
import './NoteCanvas.css';
export interface NoteCanvasProps { document: NoteCanvasDocument; onChange(document: NoteCanvasDocument): void; readOnly?: boolean; drawing: boolean; onDrawingChange(drawing: boolean): void; onAddImage(): void; onGenerate(): void; english?: boolean; toolsRef?: RefObject<HTMLDivElement>; toolsVisible?: boolean; liveDocumentId?: string }
type Tool = 'select' | 'pen' | 'eraser' | 'text';
type Selection = { kind: 'item' | 'stroke'; id: string } | null;
type Gesture = { pointer: number; start: NotePoint; base: NoteCanvasDocument; preview: NoteCanvasDocument } & (
  { kind: 'pen'; stroke: NoteStroke; finish(cancelled: boolean): void } | { kind: 'eraser'; last: NotePoint } | { kind: 'move' | 'resize'; item: NoteCanvasItem }
);
const paths = { select: CursorArrowIcon, pen: Pencil1Icon, eraser: EraserIcon, text: TextIcon, image: ImageIcon, ai: MagicWandIcon, undo: ResetIcon, redo: RedoIcon, options: OptionsIcon, ruler: RulerHorizontalIcon, move: MoveIcon, resize: ResizeIcon, remove: CloseIcon, zoomIn: PlusIcon, zoomOut: MinusIcon };
function Glyph({ name }: { name: keyof typeof paths }) { const Icon = paths[name]; return <Icon width={17} height={17} />; }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
/** Apply only fields touched by this operation, retaining media inserted by another workflow. */
function rebaseDocument(from: NoteCanvasDocument, to: NoteCanvasDocument, latest: NoteCanvasDocument): NoteCanvasDocument {
  const collection = <T extends { id: string }>(before: T[], after: T[], current: T[]): T[] => {
    const old = new Map(before.map(item => [item.id, item])), next = new Map(after.map(item => [item.id, item]));
    const merged = current.filter(item => !old.has(item.id) || next.has(item.id)).map(item => {
      const source = old.get(item.id), target = next.get(item.id);
      if (!source || !target || source === target) return item;
      const patch = Object.fromEntries(Object.keys(target).filter(key => source[key as keyof T] !== target[key as keyof T]).map(key => [key, target[key as keyof T]]));
      return { ...item, ...patch };
    });
    for (const item of after) if (!old.has(item.id) && !merged.some(value => value.id === item.id)) merged.push(item);
    return merged;
  };
  return { ...latest, ...(from.paper !== to.paper ? { paper: to.paper } : {}), strokes: collection(from.strokes, to.strokes, latest.strokes), items: collection(from.items, to.items, latest.items) };
}
function EditableText({ item, scale, readOnly, onCommit, onEnd, audioScope, english }: { audioScope: string; english: boolean; item: Extract<NoteCanvasItem, { kind: 'text' }>; scale: number; readOnly: boolean; onCommit(text: string): void; onEnd(): void }) {
  const [value, setValue] = useState(item.text);
  useEffect(() => setValue(item.text), [item.text]);
  return <AudioTextarea audioScope={audioScope} audioLanguage={english ? 'en' : 'pt'} audioWrapperClassName="note-canvas-audio-text" autoFocus aria-label={english ? 'Object text' : 'Texto do objeto'} value={value} readOnly={readOnly} maxLength={20000} onChange={event => { setValue(event.target.value); onCommit(event.target.value); }} onBlur={onEnd} onPointerDown={event => event.stopPropagation()} style={{ color: item.color, fontSize: Math.max(10, item.fontSize * scale) }} />;
}

/** Logical notebook coordinates stay stable as the editor resizes or enters fullscreen. */
export function NoteCanvas({ document: doc, onChange, drawing, onDrawingChange, readOnly = false, onAddImage, onGenerate, english = false, toolsVisible = true, liveDocumentId }: NoteCanvasProps) {
  const live = useLiveInk({ surface: 'notebook', documentId: liveDocumentId ?? 'unbound-notebook' });
  const releaseActivity = useRef<(() => void) | null>(null);
  const stage = useRef<HTMLDivElement>(null), current = useRef(doc), gesture = useRef<Gesture | null>(null);
  const viewport = useRef<HTMLDivElement>(null), [fingerDrawing, setFingerDrawing] = useState(false), fingerRef = useRef(false), readOnlyRef = useRef(readOnly); fingerRef.current = fingerDrawing; readOnlyRef.current = readOnly;
  const pointers = useRef(new InkPointerRouter(() => fingerRef.current && !readOnlyRef.current)), captures = useRef(new Set<number>());
  const navigation = useRef<{ viewport: InkViewport; points: InkScreenPoint[]; latest: InkViewport } | null>(null), pendingScroll = useRef<InkViewport | null>(null);
  const history = useRef<{ past: Array<{ before: NoteCanvasDocument; after: NoteCanvasDocument }>; future: Array<{ before: NoteCanvasDocument; after: NoteCanvasDocument }>; group: string | null }>({ past: [], future: [], group: null });
  const [historyVersion, setHistoryVersion] = useState(0), [preview, setPreview] = useState<NoteCanvasDocument | null>(null);
  const [tool, setTool] = useState<Tool>(drawing ? 'pen' : 'select'), [selected, setSelected] = useState<Selection>(null);
  const [options, setOptions] = useState(false), [ruler, setRuler] = useState(false);
  const [ink, setInk] = useState(createInkSettings);
  const [scale, setScale] = useState(1), [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  current.current = doc;
  const cancelInk = () => {
    const action = gesture.current; gesture.current = null; if (action?.kind === 'pen') action.finish(true);
    releaseActivity.current?.(); releaseActivity.current = null; setPreview(null);
    if (action && !pointers.current.hasPointer(action.pointer)) try { if (stage.current?.hasPointerCapture?.(action.pointer)) stage.current.releasePointerCapture(action.pointer); } catch { /* Already released. */ }
  };
  const cancel = () => {
    pointers.current.reset(); navigation.current = null; pendingScroll.current = null; cancelInk();
    for (const id of captures.current) try { if (stage.current?.hasPointerCapture?.(id)) stage.current.releasePointerCapture(id); } catch { /* Already released. */ }
    captures.current.clear();
  };
  useEffect(() => {
    const blur = () => cancel(); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('blur', blur); pointers.current.reset(); navigation.current = null; const action = gesture.current; gesture.current = null; if (action?.kind === 'pen') action.finish(true); releaseActivity.current?.(); releaseActivity.current = null; };
  }, []);
  useEffect(() => { cancel(); history.current = { past: [], future: [], group: null }; setSelected(null); }, [liveDocumentId]);
  useLayoutEffect(() => {
    const next = pendingScroll.current, element = viewport.current; if (!next || !element) return;
    pendingScroll.current = null; element.scrollLeft = Math.max(0, -next.x); element.scrollTop = Math.max(0, -next.y);
    if (navigation.current) navigation.current.latest = { x: -element.scrollLeft, y: -element.scrollTop, zoom };
  }, [zoom]);
  const t = (pt: string, en: string) => english ? en : pt;
  useEffect(() => { if (!drawing) cancel(); setTool(previous => drawing ? previous === 'select' ? 'pen' : previous : 'select'); }, [drawing]);
  useEffect(() => {
    if (!stage.current) return;
    const channels = getComputedStyle(stage.current).color.match(/^rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/);
    if (channels) setInk(value => ({ ...value, color: `#${channels.slice(1, 4).map(channel => Number(channel).toString(16).padStart(2, '0')).join('')}` }));
  }, []);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const update = () => setScale((element.getBoundingClientRect().width || doc.width) / doc.width);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update); observer.observe(element); return () => observer.disconnect();
  }, [doc.width, zoom]);
  useEffect(() => { if (readOnly || !toolsVisible) { cancel(); setSelected(null); } }, [readOnly, toolsVisible]);
  const commit = (next: NoteCanvasDocument, before = current.current, group?: string) => {
    if (readOnly || next === before) return false;
    const parsed = noteCanvasSchema.safeParse(next);
    if (!parsed.success) { setError(t('Limite do caderno atingido.', 'Notebook limit reached.')); return false; }
    const previous = history.current.past.at(-1);
    if (group && history.current.group === group && previous) previous.after = rebaseDocument(before, next, previous.after);
    else { history.current.past.push({ before, after: next }); if (history.current.past.length > 50) history.current.past.shift(); }
    history.current.group = group ?? null;
    history.current.future = []; setHistoryVersion(historyVersion + 1); setError(''); current.current = next; onChange(next); return true;
  };
  const navigate = (direction: 'past' | 'future') => {
    if (readOnly || gesture.current) return;
    history.current.group = null;
    const operation = history.current[direction].at(-1); if (!operation) return;
    const next = rebaseDocument(direction === 'past' ? operation.after : operation.before, direction === 'past' ? operation.before : operation.after, current.current);
    if (!noteCanvasSchema.safeParse(next).success) { setError(t('Não foi possível restaurar esta alteração.', 'This change could not be restored.')); return; }
    history.current[direction].pop(); history.current[direction === 'past' ? 'future' : 'past'].push(operation);
    onChange(next); setSelected(null); setHistoryVersion(value => value + 1);
  };
  const selectTool = (next: Tool) => { cancel(); setTool(next); setSelected(null); if (next !== 'select') onDrawingChange(true); };
  const point = (event: { clientX: number; clientY: number; pressure?: number; pointerType?: string }): NotePoint => {
    const bounds = stage.current!.getBoundingClientRect();
    return { x: clamp((event.clientX - bounds.left) * doc.width / (bounds.width || doc.width), 0, doc.width), y: clamp((event.clientY - bounds.top) * doc.height / (bounds.height || doc.height), 0, doc.height), ...(event.pointerType === 'pen' && Number.isFinite(event.pressure) ? { pressure: clamp(event.pressure!, 0, 1) } : {}) };
  };
  const capture = (event: PointerEvent) => {
    stage.current?.focus({ preventScroll: true });
    try { stage.current?.setPointerCapture(event.pointerId); } catch { /* A synthetic event has no active pointer. */ }
  };
  const eraseAt = (base: NoteCanvasDocument, path: NotePoint[]) => ({ ...base, strokes: base.strokes.filter(stroke => !inkStrokeNearPath(stroke, path, 10 / Math.max(scale, .2), 'note')) });
  const begin = (event: PointerEvent<HTMLDivElement>) => {
    if (readOnly || !toolsVisible || event.button !== 0 || gesture.current || (event.target as Element).closest('button,input,textarea,select,summary')) return;
    if (tool === 'select') { setSelected(null); stage.current?.focus({ preventScroll: true }); return; }
    event.preventDefault(); capture(event); setSelected(null);
    const start = point(event), base = current.current;
    if (tool === 'text') {
      const item: NoteCanvasItem = { id: nanoid(12), kind: 'text', x: Math.min(start.x, doc.width - 240), y: Math.min(start.y, doc.height - 96), width: 240, height: 96, text: '', color: ink.color, fontSize: 24 };
      commit({ ...base, items: [...base.items, item] }); selectTool('select'); setSelected({ kind: 'item', id: item.id }); return;
    }
    releaseActivity.current = registerDataIngestion();
    if (tool === 'eraser') { const next = eraseAt(base, [start]); gesture.current = { kind: 'eraser', pointer: event.pointerId, start, last: start, base, preview: next }; setPreview(next); return; }
    const stroke: NoteStroke = { id: nanoid(12), ...ink, points: [start] };
    const next = { ...base, strokes: [...base.strokes, stroke] };
    gesture.current = { kind: 'pen', pointer: event.pointerId, start, base, preview: next, stroke, finish: cancelled => { if (liveDocumentId) live.finish(stroke.id, cancelled); } }; setPreview(next); if (liveDocumentId) live.preview(stroke.id, stroke);
  };
  const beginItem = (event: PointerEvent, item: NoteCanvasItem, kind: 'move' | 'resize' = 'move') => {
    if (readOnly || !toolsVisible || tool !== 'select' || event.button !== 0 || event.isPrimary === false || gesture.current || (event.target as Element).closest('textarea,input,select,summary,a,.audio-field')) return;
    event.preventDefault(); event.stopPropagation(); capture(event); setSelected({ kind: 'item', id: item.id });
    const base = current.current;
    releaseActivity.current = registerDataIngestion(); gesture.current = { kind, pointer: event.pointerId, start: point(event), item, base, preview: base };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const action = gesture.current; if (!action || action.pointer !== event.pointerId) return;
    event.preventDefault(); const where = point(event);
    if (action.kind === 'pen') {
      if (ruler) action.stroke = { ...action.stroke, points: [action.start, where] };
      else {
        const points = [...action.stroke.points], budget = Math.min(4096, 100000 - action.base.strokes.reduce((count, stroke) => count + stroke.points.length, 0));
        for (const sample of [...(event.nativeEvent?.getCoalescedEvents?.() ?? []), event]) {
          const next = point(sample), previous = points.at(-1)!;
          if (points.length >= budget) break;
          if (Math.hypot(next.x - previous.x, next.y - previous.y) >= .5) points.push(next);
        }
        action.stroke = { ...action.stroke, points };
      }
      action.preview = { ...action.base, strokes: [...action.base.strokes, action.stroke] };
      if (liveDocumentId) live.preview(action.stroke.id, action.stroke);
    } else if (action.kind === 'eraser') {
      const path = [action.last, ...(event.nativeEvent?.getCoalescedEvents?.() ?? []).map(sample => point(sample)), where];
      action.preview = eraseAt(action.preview, path); action.last = where;
    }
    else {
      const dx = where.x - action.start.x, dy = where.y - action.start.y, original = action.item;
      let patch: Partial<Pick<NoteCanvasItem, 'x' | 'y' | 'width' | 'height'>>;
      if (action.kind === 'move') patch = { x: clamp(original.x + dx, 0, doc.width - original.width), y: clamp(original.y + dy, 0, doc.height - original.height) };
      else if (original.kind === 'image') {
        const ratio = original.width / original.height, desired = Math.max(original.width + dx, (original.height + dy) * ratio);
        const nextWidth = clamp(desired, Math.max(24, 24 * ratio), Math.min(doc.width - original.x, (doc.height - original.y) * ratio));
        patch = { width: nextWidth, height: nextWidth / ratio };
      } else patch = { width: clamp(original.width + dx, 24, doc.width - original.x), height: clamp(original.height + dy, 24, doc.height - original.y) };
      action.preview = { ...action.base, items: action.base.items.map(item => item.id === original.id ? { ...item, ...patch } : item) };
    }
    setPreview(action.preview);
  };
  const finish = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const action = gesture.current; if (!action || action.pointer !== event.pointerId) return;
    if (!cancelled) move(event);
    gesture.current = null; setPreview(null);
    try { if (stage.current?.hasPointerCapture(event.pointerId)) stage.current.releasePointerCapture(event.pointerId); } catch { /* Pointer already released by the browser. */ }
    let saved = false;
    try {
    if (cancelled || (action.kind === 'eraser' && action.preview.strokes.length === action.base.strokes.length)) return;
    if (action.kind === 'move' || action.kind === 'resize') {
      const item = action.preview.items.find(value => value.id === action.item.id)!;
      if (item.x === action.item.x && item.y === action.item.y && item.width === action.item.width && item.height === action.item.height) return;
    }
    saved = commit(rebaseDocument(action.base, action.preview, current.current));
    } finally { if (action.kind === 'pen') action.finish(!saved); releaseActivity.current?.(); releaseActivity.current = null; }
  };
  const route = (event: PointerEvent<HTMLDivElement>, phase: 'down' | 'move' | 'up', cancelled = false) => {
    if (phase === 'down' && ((readOnly && event.pointerType !== 'touch') || !toolsVisible || (event.target as Element).closest('button,input,textarea,select,summary,.audio-field'))) return;
    const result = phase === 'down' ? pointers.current.down(event) : phase === 'move' ? pointers.current.move(event) : pointers.current.up(event, cancelled);
    if (!result.handled) return;
    event.preventDefault(); event.stopPropagation();
    if (phase === 'down') { captures.current.add(event.pointerId); capture(event); }
    for (const action of result.actions) {
      if (action.kind === 'draw-start') begin(event);
      else if (action.kind === 'draw-move') move(event);
      else if (action.kind === 'draw-end') finish(event);
      else if (action.kind === 'draw-cancel') cancelInk();
      else if (action.kind === 'navigate-start' && viewport.current) {
        const view = navigation.current?.latest ?? { x: -viewport.current.scrollLeft, y: -viewport.current.scrollTop, zoom: zoomRef.current };
        navigation.current = { viewport: { ...view }, latest: { ...view }, points: action.points };
      } else if (action.kind === 'navigate-move' && navigation.current && viewport.current) {
        const nav = navigation.current, element = viewport.current;
        const next = calculateInkViewport(nav.viewport, nav.points, action.points, element.getBoundingClientRect(), { minZoom: 1, maxZoom: 3 });
        nav.latest = next;
        if (next.zoom !== zoomRef.current) { pendingScroll.current = next; zoomRef.current = next.zoom; setZoom(next.zoom); }
        else { element.scrollLeft = Math.max(0, -next.x); element.scrollTop = Math.max(0, -next.y); nav.latest = { ...next, x: -element.scrollLeft, y: -element.scrollTop }; }
      } else if (action.kind === 'navigate-end') navigation.current = null;
    }
    if (phase === 'up') { captures.current.delete(event.pointerId); try { if (stage.current?.hasPointerCapture?.(event.pointerId)) stage.current.releasePointerCapture(event.pointerId); } catch { /* Already released. */ } }
  };
  const remove = () => {
    if (!selected) return;
    commit({ ...doc, ...(selected.kind === 'item' ? { items: doc.items.filter(item => item.id !== selected.id) } : { strokes: doc.strokes.filter(stroke => stroke.id !== selected.id) }) }); setSelected(null);
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (readOnly || (event.target as Element).closest('input,textarea,select,[contenteditable="true"],.audio-field')) return;
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) { event.preventDefault(); navigate(event.key.toLowerCase() === 'y' || event.shiftKey ? 'future' : 'past'); }
    else if (['Backspace', 'Delete'].includes(event.key) && selected) { event.preventDefault(); remove(); }
    else if (event.key === 'Escape') { cancel(); setSelected(null); selectTool('select'); }
    else if (selected?.kind === 'item' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); const item = doc.items.find(value => value.id === selected.id); if (!item) return;
      const amount = event.shiftKey ? 10 : 1, dx = event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0, dy = event.key === 'ArrowDown' ? amount : event.key === 'ArrowUp' ? -amount : 0;
      commit({ ...doc, items: doc.items.map(value => value.id === item.id ? { ...value, x: clamp(value.x + dx, 0, doc.width - value.width), y: clamp(value.y + dy, 0, doc.height - value.height) } : value) });
    }
  };
  const view = preview && gesture.current ? rebaseDocument(gesture.current.base, preview, doc) : doc;
  const selectStroke = useCallback((event: PointerEvent<SVGSVGElement>) => {
    if (readOnly || tool !== 'select' || !(event.target instanceof Element)) return;
    const id = event.target.closest('[data-note-stroke]')?.getAttribute('data-note-stroke');
    if (!id) return;
    event.stopPropagation(); setSelected({ kind: 'stroke', id }); stage.current?.focus({ preventScroll: true });
  }, [readOnly, tool]);
  const changeZoom = (delta: number) => { cancel(); setZoom(value => clamp(value + delta, 1, 3)); };
  const button = (icon: keyof typeof paths, label: string, onClick: () => void, active?: boolean, disabled = false) => <button type="button" aria-label={label} title={label} aria-pressed={active} disabled={disabled} onClick={onClick}><Glyph name={icon} /></button>;
  const tools = toolsVisible && <InkPalette label={t('Ferramentas do caderno', 'Notebook tools')} english={english} className="note-canvas-palette" preview={<Glyph name={tool === 'select' ? 'select' : tool === 'eraser' ? 'eraser' : tool === 'text' ? 'text' : 'pen'} />}>
    <div className="note-canvas-tools" role="toolbar" aria-label={t('Ferramentas do caderno', 'Notebook tools')}>
      {!readOnly && <>
      {button('select', t('Selecionar', 'Select'), () => selectTool('select'), tool === 'select')}
      {button('remove', t('Sair do desenho', 'Leave drawing'), () => { selectTool('select'); onDrawingChange(false); })}
      {button('pen', t('Instrumentos de tinta', 'Ink tools'), () => selectTool('pen'), tool === 'pen')}
      {button('eraser', t('Borracha', 'Eraser'), () => selectTool('eraser'), tool === 'eraser')}
      {button('text', t('Adicionar texto', 'Add text'), () => selectTool('text'), tool === 'text')}
      <span className="note-canvas-divider" />
      {button('image', t('Adicionar imagem', 'Add image'), onAddImage)}
      {button('ai', t('Criar diagrama com IA', 'Create AI diagram'), onGenerate)}
      {button('undo', t('Desfazer', 'Undo'), () => navigate('past'), undefined, !history.current.past.length)}
      {button('redo', t('Refazer', 'Redo'), () => navigate('future'), undefined, !history.current.future.length)}
      {button('options', t('Opções de desenho', 'Drawing options'), () => setOptions(!options), options)}
      <span className="note-canvas-divider" />
      </>}
      {button('zoomOut', t('Reduzir caderno', 'Zoom out notebook'), () => changeZoom(-.5), undefined, zoom <= 1)}
      {button('zoomIn', t('Ampliar caderno', 'Zoom in notebook'), () => changeZoom(.5), undefined, zoom >= 3)}
    </div>
    {!readOnly && tool === 'pen' && <InkToolbar value={ink} onChange={value => { setInk(value); selectTool('pen'); }} english={english} disabled={!!gesture.current} className="note-canvas-ink-tools" />}
    {!readOnly && <label className="ink-finger-option"><input type="checkbox" aria-label={t('Desenhar com dedo', 'Draw with finger')} checked={fingerDrawing} onChange={event => { cancel(); setFingerDrawing(event.target.checked); }} />{t('Desenhar com dedo', 'Draw with finger')}</label>}
    {options && !readOnly && <div className="note-canvas-options">
      {button('ruler', t('Régua — traço reto', 'Ruler — straight line'), () => setRuler(!ruler), ruler)}
      <select aria-label={t('Fundo do caderno', 'Notebook paper')} value={doc.paper} onChange={event => commit({ ...doc, paper: event.target.value as NoteCanvasDocument['paper'] })}>
        <option value="plain">{t('Liso', 'Plain')}</option><option value="dots">{t('Pontos', 'Dots')}</option><option value="grid">{t('Quadriculado', 'Grid')}</option><option value="lines">{t('Pautado', 'Ruled')}</option>
      </select>
    </div>}
    </InkPalette>;
  return <section className={`note-canvas ${drawing ? 'is-drawing' : ''} ${readOnly ? 'is-readonly' : ''}`}>
    {tools}
    {error && <span role="status" className="note-canvas-error">{error}</span>}
    <div ref={viewport} className="note-canvas-viewport">
    <div className={`note-canvas-stage paper-${view.paper} tool-${tool}`} data-note-canvas ref={stage} tabIndex={0} role="group" aria-label={t('Área livre da nota', 'Free notebook area')} style={{ width: `${zoom * 100}%`, aspectRatio: `${doc.width} / ${doc.height}`, '--note-grid': `${24 * scale}px` } as CSSProperties}
      onPointerDown={event => tool === 'select' ? begin(event) : route(event, 'down')} onPointerMove={event => pointers.current.hasPointer(event.pointerId) ? route(event, 'move') : move(event)} onPointerUp={event => pointers.current.hasPointer(event.pointerId) ? route(event, 'up') : finish(event)} onPointerCancel={event => pointers.current.hasPointer(event.pointerId) ? route(event, 'up', true) : finish(event, true)} onLostPointerCapture={event => { if (pointers.current.hasPointer(event.pointerId)) route(event, 'up', true); else if (gesture.current?.pointer === event.pointerId) cancel(); }} onKeyDown={keyboard}>
      <svg className="note-canvas-ink" viewBox={`0 0 ${doc.width} ${doc.height}`} aria-hidden="true" onPointerDown={selectStroke}>{view.strokes.map(stroke => <InkStroke key={stroke.id} data-note-stroke={stroke.id} stroke={stroke} legacyMode="note" selected={selected?.id === stroke.id} />)}{liveDocumentId && live.remote.filter(value => !view.strokes.some(stroke => stroke.id === (value.stroke.id ?? value.gestureId))).map(value => <InkStroke key={`${value.sender}:${value.gestureId}`} data-remote-ink={value.gestureId} stroke={value.stroke} legacyMode="note" />)}</svg>
      {view.items.map(item => <div key={item.id} data-note-item={item.id} className={`note-canvas-item kind-${item.kind} ${selected?.id === item.id ? 'is-selected' : ''}`} style={{ left: `${item.x / doc.width * 100}%`, top: `${item.y / doc.height * 100}%`, width: `${item.width / doc.width * 100}%`, height: `${item.height / doc.height * 100}%` }} tabIndex={!readOnly && tool === 'select' ? 0 : undefined} role="group" aria-label={item.kind === 'image' ? item.label : item.kind === 'diagram' ? item.diagram.title : item.text.slice(0, 80) || t('Texto', 'Text')} onFocus={event => { if (event.target === event.currentTarget && !readOnly && tool === 'select') setSelected({ kind: 'item', id: item.id }); }} onPointerDown={event => beginItem(event, item)}>
        {item.kind === 'image' ? <img src={item.src} alt={item.label} draggable={false} /> : item.kind === 'text' ? selected?.id === item.id && !readOnly
          ? <EditableText audioScope={`note:${liveDocumentId ?? 'notebook'}:${item.id}:text`} english={english} item={item} scale={scale} readOnly={readOnly} onEnd={() => { history.current.group = null; }} onCommit={text => { const latest = current.current; commit({ ...latest, items: latest.items.map(value => value.id === item.id && value.kind === 'text' ? { ...value, text } : value) }, latest, `text:${item.id}`); }} />
          : <div className="note-canvas-text" style={{ color: item.color, fontSize: Math.max(10, item.fontSize * scale) }}>{item.text || t('Texto…', 'Text…')}</div>
          : <DiagramView diagram={item.diagram} values={item.values} english={english} onParameter={readOnly ? undefined : (id, value) => commit({ ...doc, items: doc.items.map(candidate => candidate.id === item.id ? { ...item, values: { ...item.values, [id]: value } } : candidate) })} />}
        {selected?.id === item.id && !readOnly && <>
          <button type="button" className="note-canvas-move" aria-label={t('Mover objeto', 'Move object')} title={t('Mover objeto', 'Move object')} onPointerDown={event => beginItem(event, item)}><Glyph name="move" /></button>
          <button type="button" className="note-canvas-resize" aria-label={t('Redimensionar objeto', 'Resize object')} title={t('Redimensionar objeto', 'Resize object')} onPointerDown={event => beginItem(event, item, 'resize')}><Glyph name="resize" /></button>
          <button type="button" className="note-canvas-remove" aria-label={t('Remover objeto', 'Remove object')} title={t('Remover objeto', 'Remove object')} onPointerDown={event => event.stopPropagation()} onClick={remove}><Glyph name="remove" /></button>
        </>}
      </div>)}
    </div>
    </div>
  </section>;
}
