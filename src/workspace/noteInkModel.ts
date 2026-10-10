import { z } from 'zod';
import { inkPointSchema, inkStyleShape } from '@/ink/model';
import type { NoteStroke } from './noteCanvasModel';

/** A section rectangle captured in document coordinates, with points as fallback. */
export interface NoteInkAnchor { id: string; x: number; y: number; width: number }
export interface NoteInkStroke extends NoteStroke { anchor?: NoteInkAnchor }
export interface NoteInkDocument { version: 1; width: number; height: number; strokes: NoteInkStroke[] }
export function createNoteInk(): NoteInkDocument { return { version: 1, width: 1200, height: 900, strokes: [] }; }

const coordinate = z.number().finite().min(0).max(10000);
const id = z.string().regex(/^[\w-]{1,100}$/).refine(value => !['constructor', 'prototype', '__proto__'].includes(value));
const anchor = z.object({
  id: z.string().regex(/^(title|document|block:[\w-]{1,100})$/),
  x: coordinate, y: coordinate, width: z.number().finite().min(1).max(10000),
}).strict();
export const noteInkSchema = z.object({
  version: z.literal(1), width: z.number().finite().min(320).max(5000), height: z.number().finite().min(300).max(10000),
  strokes: z.array(z.object({
    id, color: z.string().regex(/^#[\da-fA-F]{6}$/), width: z.number().finite().min(.25).max(24),
    points: z.array(inkPointSchema).min(1).max(4096), ...inkStyleShape, anchor: anchor.optional(),
  }).strict()).max(2000),
}).strict().superRefine((doc, context) => {
  const invalid = (message: string) => context.addIssue({ code: 'custom', message });
  if (new Set(doc.strokes.map(line => line.id)).size !== doc.strokes.length) invalid('noteInkDuplicateId');
  if (doc.strokes.reduce((count, line) => count + line.points.length, 0) > 100000) invalid('noteInkPointBudget');
  for (const line of doc.strokes) {
    if (line.points.some(point => point.x > doc.width || point.y > doc.height)) invalid('noteInkBounds');
    if (line.anchor && (line.anchor.x + line.anchor.width > doc.width + .001 || line.anchor.y > doc.height)) invalid('noteInkAnchorBounds');
  }
});
