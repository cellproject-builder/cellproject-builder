import { z } from 'zod';
import { inkPointSchema, inkStyleShape, type InkPoint, type InkSettings, type InkStrokeData } from './model';

export interface CanvasInkStroke extends InkStrokeData { id: string; x: number; y: number }
export interface CanvasInkDocument { version: 1; strokes: CanvasInkStroke[] }
export function createCanvasInk(): CanvasInkDocument { return { version: 1, strokes: [] }; }
export const canvasInkStrokeSchema = z.object({
  id: z.string().regex(/^[\w-]{1,100}$/).refine(value => !['constructor', 'prototype', '__proto__'].includes(value)),
  x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000),
  color: z.string().regex(/^#[\da-fA-F]{6}$/), width: z.number().finite().min(.25).max(24),
  points: z.array(inkPointSchema).min(1).max(4096), ...inkStyleShape,
}).strict();
export const canvasInkSchema = z.object({ version: z.literal(1), strokes: z.array(canvasInkStrokeSchema).max(2000) }).strict().superRefine((doc, context) => {
  const invalid = (message: string) => context.addIssue({ code: 'custom', message });
  if (new Set(doc.strokes.map(line => line.id)).size !== doc.strokes.length) invalid('canvasInkDuplicateId');
  if (doc.strokes.reduce((sum, line) => sum + line.points.length, 0) > 100000) invalid('canvasInkPointBudget');
  if (doc.strokes.some(line => line.points.some(point => Math.abs(line.x + point.x) > 100000 || Math.abs(line.y + point.y) > 100000))) invalid('canvasInkBounds');
});

/** Store a world-space trace as a positioned object with positive local geometry. */
export function positionedInk(points: InkPoint[], settings: InkSettings, id: string): CanvasInkStroke {
  const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y));
  return canvasInkStrokeSchema.parse({ id, x, y, ...settings, points: points.map(point => ({ ...point, x: point.x - x, y: point.y - y })) });
}

/** Apply a reversible stroke operation while retaining unrelated concurrent work. */
export function rebaseInk(from: CanvasInkStroke[], to: CanvasInkStroke[], latest: CanvasInkStroke[]): CanvasInkStroke[] {
  const old = new Map(from.map(stroke => [stroke.id, stroke])), next = new Map(to.map(stroke => [stroke.id, stroke]));
  const result = latest.filter(stroke => !old.has(stroke.id) || next.has(stroke.id)).map(stroke => {
    const before = old.get(stroke.id), after = next.get(stroke.id);
    return before && after && before !== after ? after : stroke;
  });
  for (const stroke of to) if (!old.has(stroke.id) && !result.some(value => value.id === stroke.id)) result.push(stroke);
  return result;
}
