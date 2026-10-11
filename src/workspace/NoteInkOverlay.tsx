import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { nanoid } from 'nanoid';
import { Pencil1Icon, EraserIcon, LassoSelectIcon, RulerHorizontalIcon, ResetIcon, RedoIcon, TrashIcon, CloseIcon, PlusIcon, MinusIcon } from '@/components/ui/SoftIcons';
import { InkToolbar } from '@/ink/InkToolbar';
import { InkPalette } from '@/ink/InkPalette';
import { calculateInkViewport, InkPointerRouter, type InkScreenPoint, type InkViewport } from '@/ink/pointerGestures';
import { useLiveInk } from '@/ink/live';
import { registerDataIngestion } from '@/cloud/activity';
import { InkStroke } from '@/ink/InkStroke';
import { createInkSettings, type InkPoint } from '@/ink/model';
import { inkStrokeIntersectsPolygon, inkStrokeNearPath, sampleInkPoint } from '@/ink/geometry';
import { useWorkspaceStore } from './store';
import type { Note } from './types';
import { createNoteInk, noteInkSchema, type NoteInkAnchor, type NoteInkDocument, type NoteInkStroke } from './noteInkModel';

interface Props {
  note: Note; bodyRef: RefObject<HTMLDivElement>; toolsRef: RefObject<HTMLDivElement>;
  drawing: boolean; onDrawingChange(value: boolean): void; english?: boolean;
}
type Mode = 'draw' | 'erase' | 'select';
type Layout = { height: number; scale: number; anchors: Map<string, NoteInkAnchor> };
type Operation = { before: NoteInkDocument; after: NoteInkDocument };
type Gesture = { pointer: number; base: NoteInkDocument; preview: NoteInkDocument; start: InkPoint; layout: Layout } & (
  { kind: 'draw'; stroke: NoteInkStroke; finish(cancelled: boolean): void } | { kind: 'erase'; last: InkPoint } |
  { kind: 'lasso'; points: InkPoint[] } | { kind: 'move'; strokes: Array<{ stroke: NoteInkStroke; factor: number }>; bounds: { minX: number; minY: number; maxX: number; maxY: number; minDx: number; minDy: number; maxDx: number; maxDy: number } }
);
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Only the strokes touched by a gesture are changed, even after another action saved the note. */
function rebaseInk(before: NoteInkDocument, after: NoteInkDocument, current: NoteInkDocument): NoteInkDocument {
  const from = new Map(before.strokes.map(stroke => [stroke.id, stroke])), to = new Map(after.strokes.map(stroke => [stroke.id, stroke]));
  const strokes = current.strokes.filter(stroke => !from.has(stroke.id) || to.has(stroke.id)).map(stroke => {
    const old = from.get(stroke.id), next = to.get(stroke.id);
    if (!old || !next || old === next) return stroke;
    return { ...stroke, ...Object.fromEntries(Object.keys(next).filter(key => old[key as keyof NoteInkStroke] !== next[key as keyof NoteInkStroke]).map(key => [key, next[key as keyof NoteInkStroke]])) };
  });
  for (const stroke of after.strokes) if (!from.has(stroke.id) && !strokes.some(value => value.id === stroke.id)) strokes.push(stroke);
  return { ...current, height: Math.max(current.height, after.height), strokes };
}
function liveStroke(stroke: NoteInkStroke, layout: Layout): NoteInkStroke {
  const live = stroke.anchor && layout.anchors.get(stroke.anchor.id);
  if (!live || !stroke.anchor) return stroke;
  const factor = live.width / stroke.anchor.width;
  return { ...stroke, anchor: live, width: stroke.width * factor, points: stroke.points.map(point => ({ ...point, x: live.x + (point.x - stroke.anchor!.x) * factor, y: live.y + (point.y - stroke.anchor!.y) * factor })) };
}
const AnchoredStroke = memo(function AnchoredStroke({ stroke, layout, selected, selectable }: { stroke: NoteInkStroke; layout: Layout; selected: boolean; selectable: boolean }) {
  const live = stroke.anchor && layout.anchors.get(stroke.anchor.id), anchor = stroke.anchor;
  const transform = live && anchor ? `translate(${live.x} ${live.y}) scale(${live.width / anchor.width}) translate(${-anchor.x} ${-anchor.y})` : undefined;
  return <g transform={transform} style={{ pointerEvents: selectable ? 'visiblePainted' : 'none' }}><InkStroke stroke={stroke} legacyMode="note" selected={selected} data-note-ink-stroke={stroke.id} /></g>;
});

/** A transparent, document-anchored ink layer. The editor below remains mounted and editable. */
export function NoteInkOverlay({ note, bodyRef, drawing, onDrawingChange, english = false }: Props) {
  const live = useLiveInk({ surface: 'note', documentId: note.id });
  const releaseActivity = useRef<(() => void) | null>(null);
  const blank = useRef(createNoteInk()), stage = useRef<HTMLDivElement>(null), mounted = useRef(false);
  const current = useRef(note); current.current = note;
  const doc = note.ink ?? blank.current, readOnly = note.deletedAt !== null;
  const gesture = useRef<Gesture | null>(null), history = useRef<{ past: Operation[]; future: Operation[] }>({ past: [], future: [] });
  const [preview, setPreview] = useState<NoteInkDocument | null>(null), [, setHistoryVersion] = useState(0);
  const [settings, setSettings] = useState(createInkSettings), [mode, setMode] = useState<Mode>('draw'), [ruler, setRuler] = useState(false);
  const [fingerDrawing, setFingerDrawing] = useState(false), fingerRef = useRef(false); fingerRef.current = fingerDrawing;
  const pointers = useRef(new InkPointerRouter(() => fingerRef.current)), captures = useRef(new Set<number>());
  const navigation = useRef<{ viewport: InkViewport; points: InkScreenPoint[]; latest: InkViewport; origin: { x: number; y: number } } | null>(null);
  const [zoom, setZoom] = useState(1), zoomRef = useRef(1);
  const [paletteHost, setPaletteHost] = useState<HTMLElement | null>(null), [paletteBounds, setPaletteBounds] = useState({ top: 0, left: 0, width: 0, height: 0 });
  const [selection, setSelection] = useState<Set<string>>(new Set()), [lasso, setLasso] = useState<InkPoint[]>([]), [error, setError] = useState('');
  const [layout, setLayout] = useState<Layout>({ height: doc.height, scale: 1, anchors: new Map() });
  const t = (pt: string, en: string) => english ? en : pt;
  const documentBody = () => bodyRef.current ?? stage.current?.closest<HTMLDivElement>('.ws-note-document') ?? null;
  const measure = (): Layout => {
    const body = documentBody(), bounds = body?.getBoundingClientRect();
    const scale = bounds?.width ? doc.width / bounds.width : 1;
    const anchors = new Map<string, NoteInkAnchor>();
    if (body && bounds) for (const element of body.querySelectorAll<HTMLElement>('[data-ink-anchor]')) {
      const rect = element.getBoundingClientRect(), x = clamp((rect.left - bounds.left) * scale, 0, doc.width - 1);
      if (!rect.width) continue;
      anchors.set(element.dataset.inkAnchor!, { id: element.dataset.inkAnchor!, x, y: clamp((rect.top - bounds.top) * scale, 0, 10000), width: clamp(rect.width * scale, 1, doc.width - x) });
    }
    const measured = Math.max((bounds?.height ?? 0) * scale, (body?.scrollHeight ?? 0) * scale, doc.height);
    return { height: clamp(measured, 300, 10000), scale, anchors };
  };
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; pointers.current.reset(); navigation.current = null; const action = gesture.current; if (action?.kind === 'draw') action.finish(true); gesture.current = null; releaseActivity.current?.(); releaseActivity.current = null; }; }, []);
  useLayoutEffect(() => {
    const body = documentBody(), paper = body?.closest<HTMLElement>('.ws-note-paper'), editor = body?.closest<HTMLElement>('.ws-note-editor');
    if (!body || !paper || !editor) return;
    const previous = { width: body.style.width, zoom: body.style.zoom };
    setPaletteHost(editor);
    const update = () => {
      const computed = getComputedStyle(paper), width = paper.clientWidth - (parseFloat(computed.paddingLeft) || 0) - (parseFloat(computed.paddingRight) || 0);
      // Keep the pre-zoom line wrapping. Text and its ink scale as one document.
      if (width > 0) body.style.width = `${width}px`;
      body.style.zoom = String(zoomRef.current);
      const paperRect = paper.getBoundingClientRect(), editorRect = editor.getBoundingClientRect();
      setPaletteBounds({ top: paperRect.top - editorRect.top, left: paperRect.left - editorRect.left, width: paperRect.width, height: paperRect.height });
    };
    update(); window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update); observer?.observe(paper);
    return () => { window.removeEventListener('resize', update); observer?.disconnect(); body.style.width = previous.width; body.style.zoom = previous.zoom; };
  }, [bodyRef, note.id]);
  useLayoutEffect(() => {
    const body = documentBody(); if (!body) return;
    const update = () => {
      const next = measure();
      const minHeight = note.ink || drawing ? `${doc.height / (next.scale * zoom)}px` : '';
      if (body.style.minHeight !== minHeight) body.style.minHeight = minHeight;
      setLayout(previous => previous.height === next.height && previous.scale === next.scale && JSON.stringify([...previous.anchors]) === JSON.stringify([...next.anchors]) ? previous : next);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update); observer.observe(body);
    for (const anchor of body.querySelectorAll('[data-ink-anchor]')) observer.observe(anchor);
    return () => observer.disconnect();
  }, [bodyRef, doc.width, doc.height, note.title, note.blocks, !!note.ink, drawing, zoom]);
  const cancelInk = () => {
    const action = gesture.current; gesture.current = null; if (action?.kind === 'draw') action.finish(true);
    releaseActivity.current?.(); releaseActivity.current = null; setPreview(null); setLasso([]);
    if (action && !pointers.current.hasPointer(action.pointer)) try { if (stage.current?.hasPointerCapture?.(action.pointer)) stage.current.releasePointerCapture(action.pointer); } catch { /* Already released. */ }
  };
  const cancel = () => {
    pointers.current.reset(); navigation.current = null; cancelInk();
    for (const id of captures.current) try { if (stage.current?.hasPointerCapture?.(id)) stage.current.releasePointerCapture(id); } catch { /* Already released. */ }
    captures.current.clear();
  };
  useEffect(() => { const blur = () => cancel(); window.addEventListener('blur', blur); return () => window.removeEventListener('blur', blur); }, []);
  useEffect(() => {
    cancel(); zoomRef.current = 1; setZoom(1); history.current = { past: [], future: [] }; setSelection(new Set());
    const body = documentBody(), paper = body?.closest<HTMLElement>('.ws-note-paper'); if (body) body.style.zoom = '1'; if (paper) { paper.scrollLeft = 0; paper.scrollTop = 0; }
  }, [note.id]);
  useEffect(() => { if (!drawing || readOnly) { cancel(); setSelection(new Set()); } }, [drawing, readOnly]);
  const latestDocument = () => {
    const latest = useWorkspaceStore.getState().notes[note.id];
    return mounted.current && current.current.id === note.id && latest?.deletedAt === null ? latest.ink ?? blank.current : null;
  };
  const save = (before: NoteInkDocument, after: NoteInkDocument, record = true) => {
    const latest = latestDocument(); if (!latest || readOnly) return false;
    const next = rebaseInk(before, after, latest);
    if (!noteInkSchema.safeParse(next).success) { setError(t('Limite de tinta da nota atingido. Reduza os traços antes de continuar.', 'Note ink limit reached. Reduce the strokes before continuing.')); return false; }
    try { useWorkspaceStore.getState().updateNote(note.id, { ink: next }); }
    catch { setError(t('Não foi possível salvar a tinta desta nota.', 'Could not save this note’s ink.')); return false; }
    if (record) { history.current.past.push({ before: latest, after: next }); if (history.current.past.length > 50) history.current.past.shift(); history.current.future = []; }
    setHistoryVersion(value => value + 1); setError(''); return true;
  };
  const navigate = (direction: 'past' | 'future') => {
    if (gesture.current || !drawing || readOnly) return;
    const operation = history.current[direction].at(-1); if (!operation) return;
    if (!save(direction === 'past' ? operation.after : operation.before, direction === 'past' ? operation.before : operation.after, false)) return;
    history.current[direction].pop(); history.current[direction === 'past' ? 'future' : 'past'].push(operation); setSelection(new Set());
  };
  const point = (event: { clientX: number; clientY: number; pressure?: number; pointerType?: string }, measured: Layout): InkPoint => {
    const bounds = bodyRef.current!.getBoundingClientRect();
    return sampleInkPoint({ x: clamp((event.clientX - bounds.left) * measured.scale, 0, doc.width), y: clamp((event.clientY - bounds.top) * measured.scale, 0, measured.height), pressure: event.pressure, pointerType: event.pointerType });
  };
  const capture = (event: PointerEvent) => { stage.current?.focus({ preventScroll: true }); try { stage.current?.setPointerCapture(event.pointerId); } catch { /* Synthetic events have no active pointer. */ } };
  const erase = (base: NoteInkDocument, path: InkPoint[], measured: Layout) => ({ ...base, strokes: base.strokes.filter(stroke => !inkStrokeNearPath(liveStroke(stroke, measured), path, 10 * measured.scale, 'note')) });
  const begin = (event: PointerEvent<HTMLDivElement>) => {
    if (!drawing || readOnly || event.button !== 0 || gesture.current || !latestDocument()) return;
    event.preventDefault(); capture(event);
    const measured = measure(), start = point(event, measured), base = latestDocument()!;
    setLayout(measured); setError('');
    if (mode === 'select') { releaseActivity.current = registerDataIngestion(); gesture.current = { kind: 'lasso', pointer: event.pointerId, start, base, preview: base, points: [start], layout: measured }; setLasso([start]); setSelection(new Set()); return; }
    setSelection(new Set());
    if (mode === 'erase') { releaseActivity.current = registerDataIngestion(); const next = erase(base, [start], measured); gesture.current = { kind: 'erase', pointer: event.pointerId, start, last: start, base, preview: next, layout: measured }; setPreview(next); return; }
    if (base.strokes.length >= 2000 || base.strokes.reduce((count, stroke) => count + stroke.points.length, 0) >= 100000) { setError(t('Limite de tinta da nota atingido.', 'Note ink limit reached.')); return; }
    const anchor = [...measured.anchors.values()].find(value => { const element = bodyRef.current?.querySelector<HTMLElement>(`[data-ink-anchor="${value.id}"]`); const bounds = element?.getBoundingClientRect(); return bounds && event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom; });
    const stroke: NoteInkStroke = { id: nanoid(12), ...settings, points: [start], ...(anchor ? { anchor } : {}) };
    const next = { ...base, height: measured.height, strokes: [...base.strokes, stroke] };
    releaseActivity.current = registerDataIngestion(); gesture.current = { kind: 'draw', pointer: event.pointerId, start, base, preview: next, stroke, layout: measured, finish: cancelled => live.finish(stroke.id, cancelled) }; setPreview(next); live.preview(stroke.id, stroke);
  };
  const beginMove = (event: PointerEvent<SVGPathElement>, stroke: NoteInkStroke) => {
    if (!drawing || readOnly || mode !== 'select' || event.button !== 0 || gesture.current) return;
    event.preventDefault(); event.stopPropagation(); capture(event);
    const base = latestDocument(); if (!base) return;
    const measured = measure(), ids = selection.has(stroke.id) ? selection : new Set([stroke.id]);
    setSelection(ids); setLayout(measured);
    const strokes = base.strokes.filter(value => ids.has(value.id)).map(stroke => ({ stroke, factor: stroke.anchor && measured.anchors.has(stroke.anchor.id) ? measured.anchors.get(stroke.anchor.id)!.width / stroke.anchor.width : 1 }));
    const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, minDx: -Infinity, minDy: -Infinity, maxDx: Infinity, maxDy: Infinity };
    for (const { stroke: source, factor } of strokes) {
      for (const at of liveStroke(source, measured).points) { bounds.minX = Math.min(bounds.minX, at.x); bounds.minY = Math.min(bounds.minY, at.y); bounds.maxX = Math.max(bounds.maxX, at.x); bounds.maxY = Math.max(bounds.maxY, at.y); }
      for (const at of source.points) { bounds.minDx = Math.max(bounds.minDx, -at.x * factor); bounds.minDy = Math.max(bounds.minDy, -at.y * factor); bounds.maxDx = Math.min(bounds.maxDx, (doc.width - at.x) * factor); bounds.maxDy = Math.min(bounds.maxDy, (measured.height - at.y) * factor); }
    }
    releaseActivity.current = registerDataIngestion(); gesture.current = { kind: 'move', pointer: event.pointerId, start: point(event, measured), base, preview: base, layout: measured, strokes, bounds };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const action = gesture.current; if (!action || action.pointer !== event.pointerId || !drawing || readOnly) return;
    event.preventDefault(); const at = point(event, action.layout);
    if (action.kind === 'lasso') { if (action.points.length < 4096 && Math.hypot(at.x - action.points.at(-1)!.x, at.y - action.points.at(-1)!.y) > 1) action.points.push(at); setLasso([...action.points]); return; }
    if (action.kind === 'draw') {
      const budget = Math.min(4096, 100000 - action.base.strokes.reduce((count, stroke) => count + stroke.points.length, 0));
      if (ruler && budget >= 2) action.stroke = { ...action.stroke, points: [action.start, at] };
      else if (!ruler) {
        const native = event.nativeEvent;
        const samples = typeof native?.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
        const points = [...action.stroke.points];
        for (const sample of [...samples, event]) {
          const next = point(sample, action.layout), previous = points.at(-1)!;
          if (points.length >= budget) break;
          if (Math.hypot(next.x - previous.x, next.y - previous.y) >= .5) points.push(next);
        }
        if (points.length !== action.stroke.points.length) action.stroke = { ...action.stroke, points };
      }
      action.preview = { ...action.preview, strokes: [...action.base.strokes, action.stroke] };
      live.preview(action.stroke.id, action.stroke);
    } else if (action.kind === 'erase') {
      const path = [action.last, ...(event.nativeEvent?.getCoalescedEvents?.() ?? []).map(sample => point(sample, action.layout)), at];
      action.preview = erase(action.preview, path, action.layout); action.last = at;
    }
    else {
      const dx = clamp(at.x - action.start.x, Math.max(-action.bounds.minX, action.bounds.minDx), Math.min(doc.width - action.bounds.maxX, action.bounds.maxDx)), dy = clamp(at.y - action.start.y, Math.max(-action.bounds.minY, action.bounds.minDy), Math.min(action.layout.height - action.bounds.maxY, action.bounds.maxDy));
      if (!dx && !dy) action.preview = action.base;
      else {
        const moved = new Map(action.strokes.map(({ stroke, factor }) => [stroke.id, { ...stroke, points: stroke.points.map(value => ({ ...value, x: value.x + dx / factor, y: value.y + dy / factor })) }]));
        action.preview = { ...action.base, height: action.layout.height, strokes: action.base.strokes.map(stroke => moved.get(stroke.id) ?? stroke) };
      }
    }
    setPreview(action.preview);
  };
  const finish = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const action = gesture.current; if (!action || action.pointer !== event.pointerId) return;
    if (!cancelled) move(event);
    gesture.current = null; setPreview(null); setLasso([]);
    try { if (stage.current?.hasPointerCapture(event.pointerId)) stage.current.releasePointerCapture(event.pointerId); } catch { /* The browser may release first. */ }
    let saved = false;
    try {
      if (cancelled || !mounted.current || !drawing || readOnly) return;
      if (action.kind === 'lasso') { if (action.points.length > 2) setSelection(new Set(action.base.strokes.filter(stroke => inkStrokeIntersectsPolygon(liveStroke(stroke, action.layout), action.points, 'note')).map(stroke => stroke.id))); return; }
      if (action.kind === 'erase' && action.preview.strokes.length === action.base.strokes.length) return;
      if (action.kind === 'move' && action.preview === action.base) return;
      saved = save(action.base, action.preview);
    } finally { if (action.kind === 'draw') action.finish(!saved); releaseActivity.current?.(); releaseActivity.current = null; }
  };
  const route = (event: PointerEvent<HTMLDivElement | SVGPathElement>, phase: 'down' | 'move' | 'up', cancelled = false, stroke?: NoteInkStroke) => {
    if (!drawing || readOnly) return;
    const result = phase === 'down' ? pointers.current.down(event) : phase === 'move' ? pointers.current.move(event) : pointers.current.up(event, cancelled);
    if (!result.handled) return;
    event.preventDefault(); event.stopPropagation();
    if (phase === 'down') { captures.current.add(event.pointerId); capture(event); }
    for (const action of result.actions) {
      if (action.kind === 'draw-start') { if (stroke && mode === 'select') beginMove(event as PointerEvent<SVGPathElement>, stroke); else begin(event as PointerEvent<HTMLDivElement>); }
      else if (action.kind === 'draw-move') move(event as PointerEvent<HTMLDivElement>);
      else if (action.kind === 'draw-end') finish(event as PointerEvent<HTMLDivElement>);
      else if (action.kind === 'draw-cancel') cancelInk();
      else if (action.kind === 'navigate-start') {
        const body = bodyRef.current, paper = body?.closest<HTMLElement>('.ws-note-paper');
        if (!body || !paper) continue;
        const bounds = body.getBoundingClientRect(), frame = paper.getBoundingClientRect();
        const origin = { x: bounds.left - frame.left + paper.scrollLeft, y: bounds.top - frame.top + paper.scrollTop };
        const view = navigation.current?.latest ?? { x: bounds.left - frame.left, y: bounds.top - frame.top, zoom: zoomRef.current };
        navigation.current = { viewport: { ...view }, latest: { ...view }, points: action.points, origin };
      } else if (action.kind === 'navigate-move' && navigation.current) {
        const body = bodyRef.current, paper = body?.closest<HTMLElement>('.ws-note-paper'); if (!body || !paper) continue;
        const nav = navigation.current, next = calculateInkViewport(nav.viewport, nav.points, action.points, paper.getBoundingClientRect(), { minZoom: 1, maxZoom: 3 });
        body.style.zoom = String(next.zoom); zoomRef.current = next.zoom; setZoom(next.zoom);
        paper.scrollLeft = Math.max(0, nav.origin.x - next.x); paper.scrollTop = Math.max(0, nav.origin.y - next.y);
        nav.latest = { x: nav.origin.x - paper.scrollLeft, y: nav.origin.y - paper.scrollTop, zoom: next.zoom };
      } else if (action.kind === 'navigate-end') navigation.current = null;
    }
    if (phase === 'up') { captures.current.delete(event.pointerId); try { if (stage.current?.hasPointerCapture?.(event.pointerId)) stage.current.releasePointerCapture(event.pointerId); } catch { /* Already released. */ } }
  };
  const changeZoom = (delta: number) => {
    cancel(); const next = clamp(zoomRef.current + delta, 1, 3); zoomRef.current = next; if (bodyRef.current) bodyRef.current.style.zoom = String(next); setZoom(next);
  };
  const remove = () => { const base = latestDocument(); if (base && selection.size && save(base, { ...base, strokes: base.strokes.filter(stroke => !selection.has(stroke.id)) })) setSelection(new Set()); };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!drawing || readOnly) return;
    if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) { event.preventDefault(); navigate(event.key.toLowerCase() === 'y' || event.shiftKey ? 'future' : 'past'); }
    else if (['Delete', 'Backspace'].includes(event.key) && selection.size) { event.preventDefault(); remove(); }
    else if (event.key === 'Escape') { event.preventDefault(); cancel(); setSelection(new Set()); onDrawingChange(false); }
  };
  const changeMode = (next: Mode) => { cancel(); setMode(next); setSelection(new Set()); };
  const view = preview && gesture.current ? rebaseInk(gesture.current.base, preview, doc) : doc;
  const lassoPath = useMemo(() => lasso.map((at, index) => `${index ? 'L' : 'M'}${at.x},${at.y}`).join(' ') + (lasso.length > 2 ? 'Z' : ''), [lasso]);
  const tools = drawing && !readOnly && <InkPalette label={t('Ferramentas de tinta da nota', 'Note ink tools')} english={english} className="note-ink-palette" preview={mode === 'erase' ? <EraserIcon /> : mode === 'select' ? <LassoSelectIcon /> : <Pencil1Icon />}>
    <div className="note-ink-actions">
      <button type="button" aria-label={t('Desenhar livremente na nota', 'Draw freely in note')} aria-pressed={mode === 'draw'} onClick={() => changeMode('draw')}><Pencil1Icon /></button>
      <button type="button" aria-label={t('Borracha na nota', 'Note eraser')} aria-pressed={mode === 'erase'} onClick={() => changeMode('erase')}><EraserIcon /></button>
      <button type="button" aria-label={t('Laço de seleção na nota', 'Note selection lasso')} aria-pressed={mode === 'select'} onClick={() => changeMode('select')}><LassoSelectIcon /></button>
      <button type="button" aria-label={t('Régua — traço reto na nota', 'Note ruler — straight line')} aria-pressed={ruler} onClick={() => { cancel(); setRuler(!ruler); setMode('draw'); }}><RulerHorizontalIcon /></button>
      <button type="button" aria-label={t('Desfazer tinta', 'Undo ink')} disabled={!history.current.past.length} onClick={() => navigate('past')}><ResetIcon /></button>
      <button type="button" aria-label={t('Refazer tinta', 'Redo ink')} disabled={!history.current.future.length} onClick={() => navigate('future')}><RedoIcon /></button>
      <button type="button" aria-label={t('Apagar tinta selecionada', 'Delete selected ink')} disabled={!selection.size} onClick={remove}><TrashIcon /></button>
      <button type="button" aria-label={t('Voltar ao texto', 'Back to text')} onClick={() => { cancel(); onDrawingChange(false); }}><CloseIcon /></button>
      <button type="button" aria-label={t('Reduzir nota', 'Zoom out note')} disabled={zoom <= 1} onClick={() => changeZoom(-.5)}><MinusIcon /></button>
      <button type="button" aria-label={t('Ampliar nota', 'Zoom in note')} disabled={zoom >= 3} onClick={() => changeZoom(.5)}><PlusIcon /></button>
    </div>
    <InkToolbar value={settings} onChange={value => { cancel(); setSettings(value); setMode('draw'); }} english={english} disabled={!!gesture.current} />
    <label className="ink-finger-option"><input type="checkbox" aria-label={t('Desenhar com dedo', 'Draw with finger')} checked={fingerDrawing} onChange={event => { cancel(); setFingerDrawing(event.target.checked); }} />{t('Desenhar com dedo', 'Draw with finger')}</label>
    {error && <span className="note-ink-error" role="status">{error}</span>}
  </InkPalette>;
  return <>
    {paletteHost && createPortal(<div className="note-ink-palette-viewport" style={paletteBounds}>{tools}</div>, paletteHost)}
    <div ref={stage} data-note-ink className={`note-ink-overlay mode-${mode}`} tabIndex={drawing && !readOnly ? 0 : -1} role="group" aria-label={t('Desenho sobre a nota inteira', 'Draw over the entire note')} style={{ height: `${Math.max(view.height, layout.height) / (layout.scale * zoom)}px`, bottom: 'auto', pointerEvents: drawing && !readOnly ? 'auto' : 'none', touchAction: drawing && !readOnly ? 'none' : 'auto' }} onPointerDown={event => route(event, 'down')} onPointerMove={event => route(event, 'move')} onPointerUp={event => route(event, 'up')} onPointerCancel={event => route(event, 'up', true)} onLostPointerCapture={event => { if (pointers.current.hasPointer(event.pointerId)) route(event, 'up', true); }} onKeyDown={keyboard}>
      <svg viewBox={`0 0 ${doc.width} ${Math.max(view.height, layout.height)}`} preserveAspectRatio="none" aria-hidden="true" onPointerDown={event => {
        const id = event.target instanceof Element ? event.target.closest('[data-note-ink-stroke]')?.getAttribute('data-note-ink-stroke') : null;
        const stroke = id ? view.strokes.find(value => value.id === id) : undefined;
        if (stroke) route(event as unknown as PointerEvent<SVGPathElement>, 'down', false, stroke);
      }}>
        {view.strokes.map(stroke => <AnchoredStroke key={stroke.id} stroke={stroke} layout={gesture.current?.layout ?? layout} selected={selection.has(stroke.id)} selectable={drawing && !readOnly && mode === 'select'} />)}
        {live.remote.filter(value => !view.strokes.some(stroke => stroke.id === (value.stroke.id ?? value.gestureId))).map(value => <g key={`${value.sender}:${value.gestureId}`} data-remote-ink style={{ pointerEvents: 'none' }}><AnchoredStroke stroke={{ ...value.stroke, id: value.stroke.id ?? value.gestureId }} layout={layout} selected={false} selectable={false} /></g>)}
        {lassoPath && <path d={lassoPath} fill="#b69be51a" stroke="#b69be5" strokeWidth={layout.scale} strokeDasharray={`${4 * layout.scale} ${4 * layout.scale}`} />}
      </svg>
    </div>
  </>;
}
