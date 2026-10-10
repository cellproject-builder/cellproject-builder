import { inkDefaults, type InkPoint, type InkStrokeData } from './model';

export type InkLegacyMode = 'note' | 'board';
export interface InkGeometry { d: string; fill: string; stroke: string; strokeWidth: number; opacity: number }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const number = (value: number) => String(Math.round(value * 1000) / 1000);
const position = (point: InkPoint) => `${number(point.x)},${number(point.y)}`;
const midpoint = (a: InkPoint, b: InkPoint): InkPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Coordinates are already in the caller's logical space. Mouse/touch pressure is ignored. */
export function sampleInkPoint(input: InkPoint & { pointerType?: string }): InkPoint {
  return { x: input.x, y: input.y, ...(input.pointerType === 'pen' && Number.isFinite(input.pressure)
    ? { pressure: clamp(input.pressure!, 0, 1) } : {}) };
}

function legacyWidth(stroke: InkStrokeData, legacyMode: InkLegacyMode): number {
  if (legacyMode === 'board') return stroke.width;
  const average = stroke.points.reduce((sum, point) => sum + (point.pressure ?? .6), 0) / (stroke.points.length || 1);
  return stroke.width * (.4 + average);
}

function nibAxes(stroke: InkStrokeData, point: InkPoint): { major: number; minor: number } {
  const pressure = .45 + 1.1 * clamp(point.pressure ?? .5, 0, 1);
  return { major: stroke.width * .75 * pressure, minor: stroke.width * .16 * pressure };
}

function radius(stroke: InkStrokeData, point: InkPoint, legacyMode: InkLegacyMode, direction?: { dx: number; dy: number }): number {
  if (!stroke.tool) return legacyWidth(stroke, legacyMode) / 2;
  const pressure = clamp(point.pressure ?? .5, 0, 1);
  if (stroke.tool === 'pen') return stroke.width * (.35 + 1.3 * pressure) / 2;
  if (stroke.tool === 'pencil') return stroke.width * (.3 + pressure) * .8 / 2;
  if (stroke.tool === 'fountain') {
    const { major, minor } = nibAxes(stroke, point);
    if (!direction) return major;
    const length = Math.hypot(direction.dx, direction.dy) || 1;
    const nx = -direction.dy / length, ny = direction.dx / length;
    return Math.hypot(major * (nx + ny) / Math.SQRT2, minor * (ny - nx) / Math.SQRT2);
  }
  return stroke.width / 2;
}

/** Support vector of an elliptical nib, fixed at 45°, swept along a line's local normal. */
function nibOffset(stroke: InkStrokeData, point: InkPoint, dx: number, dy: number): InkPoint {
  const length = Math.hypot(dx, dy) || 1, nx = -dy / length, ny = dx / length;
  const { major, minor } = nibAxes(stroke, point);
  const u = (nx + ny) / Math.SQRT2, v = (ny - nx) / Math.SQRT2;
  const support = Math.hypot(major * u, minor * v) || 1;
  return { x: (major * major * u - minor * minor * v) / Math.SQRT2 / support, y: (major * major * u + minor * minor * v) / Math.SQRT2 / support };
}

function cap(stroke: InkStrokeData, point: InkPoint, legacyMode: InkLegacyMode): string {
  if (stroke.tool === 'fountain') {
    const { major, minor } = nibAxes(stroke, point);
    return `${number(major)},${number(minor)} 45`;
  }
  const r = number(radius(stroke, point, legacyMode));
  return `${r},${r} 0`;
}

function smoothPath(points: InkPoint[]): string {
  if (!points.length) return '';
  let path = `M${position(points[0])}`;
  if (points.length === 1) return `${path}l.01,0`;
  for (let index = 1; index < points.length - 1; index++) path += ` Q${position(points[index])} ${position(midpoint(points[index], points[index + 1]))}`;
  return `${path} L${position(points.at(-1)!)}`;
}

function sidePath(points: InkPoint[]): string {
  let path = '';
  for (let index = 1; index < points.length - 1; index++) path += ` Q${position(points[index])} ${position(midpoint(points[index], points[index + 1]))}`;
  return `${path} L${position(points.at(-1)!)}`;
}

/** A single filled outline prevents highlighter alpha from accumulating at every sample. */
function outline(stroke: InkStrokeData, legacyMode: InkLegacyMode): string {
  const points = stroke.points.filter((point, index) => !index || point.x !== stroke.points[index - 1].x || point.y !== stroke.points[index - 1].y);
  if (!points.length) return '';
  if (points.length === 1) {
    const point = points[0], r = radius(stroke, point, legacyMode);
    const dx = stroke.tool === 'fountain' ? r / Math.SQRT2 : r, dy = stroke.tool === 'fountain' ? r / Math.SQRT2 : 0;
    const start = position({ x: point.x - dx, y: point.y - dy }), end = position({ x: point.x + dx, y: point.y + dy });
    return `M${start} A${cap(stroke, point, legacyMode)} 1 0 ${end} A${cap(stroke, point, legacyMode)} 1 0 ${start} Z`;
  }
  const left: InkPoint[] = [], right: InkPoint[] = [];
  points.forEach((point, index) => {
    const before = points[Math.max(0, index - 1)], after = points[Math.min(points.length - 1, index + 1)];
    let dx = after.x - before.x, dy = after.y - before.y;
    // A reversal can make the centered tangent vanish. Fall back to its incoming segment.
    if (!dx && !dy) { dx = point.x - before.x; dy = point.y - before.y; }
    const length = Math.hypot(dx, dy) || 1, r = radius(stroke, point, legacyMode);
    const offset = stroke.tool === 'fountain' ? nibOffset(stroke, point, dx, dy) : { x: -dy / length * r, y: dx / length * r };
    const nx = offset.x, ny = offset.y;
    left.push({ x: point.x + nx, y: point.y + ny }); right.push({ x: point.x - nx, y: point.y - ny });
  });
  right.reverse();
  return `M${position(left[0])}${sidePath(left)} A${cap(stroke, points.at(-1)!, legacyMode)} 0 0 ${position(right[0])}${sidePath(right)} A${cap(stroke, points[0], legacyMode)} 0 0 ${position(left[0])} Z`;
}

/** Pen/pencil use local pressure; the 45° fountain nib also responds to stroke direction. */
export function inkGeometry(stroke: InkStrokeData, legacyMode: InkLegacyMode = 'board'): InkGeometry {
  const opacity = stroke.opacity ?? (stroke.tool ? inkDefaults[stroke.tool].opacity : 1);
  if (!stroke.tool) return {
    d: stroke.points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ') + (stroke.points.length === 1 ? 'l.01,0' : ''),
    fill: 'none', stroke: stroke.color, strokeWidth: legacyWidth(stroke, legacyMode), opacity,
  };
  if (stroke.tool === 'monoline') return { d: smoothPath(stroke.points), fill: 'none', stroke: stroke.color, strokeWidth: stroke.width, opacity };
  return { d: outline(stroke, legacyMode), fill: stroke.color, stroke: 'none', strokeWidth: 0, opacity };
}

function segmentProjection(point: InkPoint, a: InkPoint, b: InkPoint): { distance: number; t: number } {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return { distance: Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy), t };
}

/** Stroke, test point and tolerance must use the same local or world coordinate space. */
export function nearInkStroke(stroke: InkStrokeData, point: InkPoint, tolerance: number, legacyMode: InkLegacyMode = 'board'): boolean {
  return stroke.points.some((a, index) => {
    const b = stroke.points[index + 1] ?? a, projection = segmentProjection(point, a, b);
    const direction = { dx: b.x - a.x, dy: b.y - a.y };
    const start = radius(stroke, a, legacyMode, direction), end = radius(stroke, b, legacyMode, direction);
    return projection.distance <= Math.max(0, tolerance) + start + (end - start) * projection.t;
  });
}

/** Inclusive polygon hit test for lasso selection, including points on its boundary. */
export function pointInPolygon(point: InkPoint, polygon: InkPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[previous], b = polygon[index];
    if (segmentProjection(point, a, b).distance < .001) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segmentsCross(a: InkPoint, b: InkPoint, c: InkPoint, d: InkPoint): boolean {
  const cross = (p: InkPoint, q: InkPoint, r: InkPoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0
    || segmentProjection(a, c, d).distance < .001 || segmentProjection(b, c, d).distance < .001
    || segmentProjection(c, a, b).distance < .001 || segmentProjection(d, a, b).distance < .001;
}

/** Tests the swept eraser, including unsampled crossings, in the stroke's coordinate space. */
export function inkStrokeNearPath(stroke: InkStrokeData, path: InkPoint[], tolerance: number, legacyMode: InkLegacyMode = 'board'): boolean {
  if (!path.length || !stroke.points.length) return false;
  const padding = Math.max(0, tolerance), legacyRadius = stroke.tool ? 0 : legacyWidth(stroke, legacyMode) / 2;
  const project = (point: InkPoint, a: InkPoint, b: InkPoint): InkPoint => {
    const { t } = segmentProjection(point, a, b);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  return stroke.points.some((a, index) => {
    const b = stroke.points[index + 1] ?? a, direction = { dx: b.x - a.x, dy: b.y - a.y };
    const start = stroke.tool ? radius(stroke, a, legacyMode, direction) : legacyRadius;
    const end = stroke.tool ? radius(stroke, b, legacyMode, direction) : legacyRadius;
    const hit = (point: InkPoint) => {
      const { distance, t } = segmentProjection(point, a, b);
      return distance <= padding + start + (end - start) * t;
    };
    return path.some((c, edge) => {
      const d = path[edge + 1] ?? c;
      return segmentsCross(a, b, c, d) || hit(c) || hit(d) || hit(project(a, c, d)) || hit(project(b, c, d));
    });
  });
}

/** Lasso hits include sparse segments crossing its boundary and the visible brush footprint. */
export function inkStrokeIntersectsPolygon(stroke: InkStrokeData, polygon: InkPoint[], legacyMode: InkLegacyMode = 'board'): boolean {
  if (polygon.length < 3 || !stroke.points.length) return false;
  if (stroke.points.some(point => pointInPolygon(point, polygon)) || polygon.some(point => nearInkStroke(stroke, point, 0, legacyMode))) return true;
  return stroke.points.some((a, index) => {
    const b = stroke.points[index + 1] ?? a;
    return polygon.some((c, edge) => {
      const d = polygon[(edge + 1) % polygon.length];
      return segmentsCross(a, b, c, d)
        || segmentProjection(a, c, d).distance <= radius(stroke, a, legacyMode)
        || segmentProjection(b, c, d).distance <= radius(stroke, b, legacyMode);
    });
  });
}
