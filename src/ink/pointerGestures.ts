export interface InkPointerSample { pointerId: number; pointerType: string; clientX: number; clientY: number; button?: number; isPrimary?: boolean }
export interface InkScreenPoint { pointerId: number; x: number; y: number }
export type InkPointerAction = { kind: 'draw-start' | 'draw-move' | 'draw-end'; pointer: InkPointerSample } | { kind: 'draw-cancel'; pointerId: number } | { kind: 'navigate-start' | 'navigate-move'; points: InkScreenPoint[] } | { kind: 'navigate-end'; cancelled: boolean };
export interface InkPointerResult { handled: boolean; actions: InkPointerAction[] }
export interface InkViewport { x: number; y: number; zoom: number }
/** Owns pointer intent independently of canvas coordinates and persistence. */
export class InkPointerRouter {
  private touches = new Map<number, InkScreenPoint>();
  private drawing: { pointerId: number; pointerType: string } | null = null;
  private navigating = false;
  private suppressTouches = false;
  private fingerNavigation = false;
  constructor(private fingerDrawing: () => boolean = () => false) {}
  hasPointer(pointerId: number) { return this.drawing?.pointerId === pointerId || this.touches.has(pointerId); }
  private points() { return [...this.touches.values()].slice(0, 2).map(value => ({ ...value })); }
  private clearTouchFlags() { if (!this.touches.size) { this.suppressTouches = false; this.fingerNavigation = false; } }
  down(pointer: InkPointerSample): InkPointerResult {
    if (!valid(pointer) || (pointer.button !== undefined && pointer.button !== 0)) return result(false);
    if (this.hasPointer(pointer.pointerId)) return result(true);
    const actions: InkPointerAction[] = [];
    if (pointer.pointerType === 'touch') {
      this.touches.set(pointer.pointerId, point(pointer));
      if (this.drawing && this.drawing.pointerType !== 'touch') this.suppressTouches = true;
      if (this.suppressTouches) return result(true);
      if (this.drawing) {
        actions.push({ kind: 'draw-cancel', pointerId: this.drawing.pointerId });
        this.drawing = null; this.fingerNavigation = true;
      } else if (this.touches.size === 1 && this.fingerDrawing() && !this.fingerNavigation) {
        this.drawing = { pointerId: pointer.pointerId, pointerType: pointer.pointerType };
        return result(true, [{ kind: 'draw-start', pointer }]);
      }
      this.navigating = true;
      actions.push({ kind: 'navigate-start', points: this.points() });
      return result(true, actions);
    }
    // Pen preempts touch navigation; held contacts remain palms until lifted.
    if (this.drawing) {
      if (pointer.pointerType !== 'pen' || this.drawing.pointerType !== 'touch') return result(true);
      actions.push({ kind: 'draw-cancel', pointerId: this.drawing.pointerId });
    }
    if (this.navigating) actions.push({ kind: 'navigate-end', cancelled: true });
    this.navigating = false; this.suppressTouches = this.touches.size > 0;
    this.drawing = { pointerId: pointer.pointerId, pointerType: pointer.pointerType };
    actions.push({ kind: 'draw-start', pointer }); return result(true, actions);
  }
  move(pointer: InkPointerSample): InkPointerResult {
    if (!valid(pointer)) return result(false);
    if (this.touches.has(pointer.pointerId)) this.touches.set(pointer.pointerId, point(pointer));
    if (this.drawing?.pointerId === pointer.pointerId) return result(true, [{ kind: 'draw-move', pointer }]);
    if (!this.touches.has(pointer.pointerId)) return result(false);
    return result(true, this.navigating ? [{ kind: 'navigate-move', points: this.points() }] : []);
  }
  up(pointer: InkPointerSample, cancelled = false): InkPointerResult {
    if (this.drawing?.pointerId === pointer.pointerId) {
      this.drawing = null; this.touches.delete(pointer.pointerId); this.clearTouchFlags();
      return result(true, [cancelled ? { kind: 'draw-cancel', pointerId: pointer.pointerId } : { kind: 'draw-end', pointer }]);
    }
    if (!this.touches.delete(pointer.pointerId)) return result(false);
    const actions: InkPointerAction[] = [];
    if (this.navigating) {
      if (cancelled || !this.touches.size) {
        actions.push({ kind: 'navigate-end', cancelled }); this.navigating = false;
        if (cancelled) this.suppressTouches = true;
      } else actions.push({ kind: 'navigate-start', points: this.points() });
    }
    this.clearTouchFlags(); return result(true, actions);
  }
  reset(): InkPointerResult {
    const actions: InkPointerAction[] = [];
    if (this.drawing) actions.push({ kind: 'draw-cancel', pointerId: this.drawing.pointerId });
    if (this.navigating) actions.push({ kind: 'navigate-end', cancelled: true });
    this.drawing = null; this.navigating = false; this.touches.clear(); this.clearTouchFlags();
    return result(actions.length > 0, actions);
  }
}
const result = (handled: boolean, actions: InkPointerAction[] = []): InkPointerResult => ({ handled, actions });
const valid = (p: InkPointerSample) => Number.isFinite(p.pointerId) && Number.isFinite(p.clientX) && Number.isFinite(p.clientY) && ['pen', 'mouse', 'touch'].includes(p.pointerType);
const point = (p: InkPointerSample): InkScreenPoint => ({ pointerId: p.pointerId, x: p.clientX, y: p.clientY });

/** Pan or focal pinch from a fixed start viewport, without accumulated rounding. */
export function calculateInkViewport(base: InkViewport, initial: readonly InkScreenPoint[], points: readonly InkScreenPoint[], bounds: { left: number; top: number }, limits: { minZoom: number; maxZoom: number }): InkViewport {
  const pairs = initial.slice(0, 2).map(start => ({ start, end: points.find(p => p.pointerId === start.pointerId) })).filter(pair => pair.end && [pair.start.x, pair.start.y, pair.end.x, pair.end.y].every(Number.isFinite));
  if (!pairs.length || ![base.x, base.y, base.zoom, bounds.left, bounds.top, limits.minZoom, limits.maxZoom].every(Number.isFinite) || base.zoom <= 0 || limits.minZoom <= 0 || limits.maxZoom < limits.minZoom) return base;
  const center = (side: 'start' | 'end') => ({ x: pairs.reduce((sum, pair) => sum + pair[side]!.x, 0) / pairs.length, y: pairs.reduce((sum, pair) => sum + pair[side]!.y, 0) / pairs.length });
  const start = center('start'), end = center('end');
  let ratio = 1;
  if (pairs.length === 2) {
    const distance = (side: 'start' | 'end') => Math.hypot(pairs[1][side]!.x - pairs[0][side]!.x, pairs[1][side]!.y - pairs[0][side]!.y);
    const initialDistance = distance('start'); if (initialDistance > .001) ratio = distance('end') / initialDistance;
  }
  const zoom = Math.min(limits.maxZoom, Math.max(limits.minZoom, base.zoom * ratio));
  return { x: end.x - bounds.left - (start.x - bounds.left - base.x) * zoom / base.zoom, y: end.y - bounds.top - (start.y - bounds.top - base.y) * zoom / base.zoom, zoom };
}
