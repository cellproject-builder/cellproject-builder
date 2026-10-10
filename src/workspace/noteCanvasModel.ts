import { z } from 'zod';
import { diagramSchema, type DiagramV1 } from '@/visuals/diagram/model';
import { inkPointSchema, inkStyleShape, type InkPoint, type InkStrokeData } from '@/ink/model';
export type NotePoint = InkPoint;
export interface NoteStroke extends InkStrokeData { id: string }
interface NoteItemBase { id: string; x: number; y: number; width: number; height: number }
export type NoteCanvasItem = NoteItemBase & ({ kind: 'image'; src: string; label: string } | { kind: 'text'; text: string; color: string; fontSize: number } | { kind: 'diagram'; diagram: DiagramV1; values: Record<string, number> });
export interface NoteCanvasDocument { version: 1; width: number; height: number; paper: 'plain' | 'dots' | 'grid' | 'lines'; strokes: NoteStroke[]; items: NoteCanvasItem[] }
export function createNoteCanvas(): NoteCanvasDocument { return { version: 1, width: 1200, height: 900, paper: 'plain', strokes: [], items: [] }; }
const id = z.string().regex(/^[\w-]{1,100}$/).refine(value => !['constructor', 'prototype', '__proto__'].includes(value));
const coordinate = z.number().finite().min(0).max(10000);
const color = z.string().regex(/^#[\da-fA-F]{6}$/);
const stroke = z.object({ id, color, width: z.number().finite().min(.25).max(24), points: z.array(inkPointSchema).min(1).max(4096), ...inkStyleShape }).strict();
const base = { id, x: coordinate, y: coordinate, width: z.number().finite().min(24).max(10000), height: z.number().finite().min(24).max(10000) };
/** Raster-only embedded media: never render generated SVG, remote markup or executable URLs. */
export const noteImageSourceSchema = z.string().max(2 * 1024 * 1024).refine(src => {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(src);
  if (!match || match[2].length % 4 !== 0) return false;
  try {
    const prefix = atob(match[2].slice(0, 32));
    if (match[1] === 'png') return prefix.startsWith('\x89PNG\r\n\x1a\n');
    if (match[1] === 'jpeg') return prefix.startsWith('\xff\xd8\xff');
    return prefix.startsWith('RIFF') && prefix.slice(8, 12) === 'WEBP';
  } catch { return false; }
}, 'noteImageInvalid');
const item = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('image'), src: noteImageSourceSchema, label: z.string().max(300) }).strict(),
  z.object({ ...base, kind: z.literal('text'), text: z.string().max(20000), color, fontSize: z.number().finite().min(10).max(96) }).strict(),
  z.object({ ...base, kind: z.literal('diagram'), diagram: diagramSchema, values: z.record(id, z.number().finite()).refine(values => Object.keys(values).length <= 6) }).strict(),
]);
export const noteCanvasSchema = z.object({
  version: z.literal(1), width: z.number().finite().min(320).max(5000), height: z.number().finite().min(300).max(10000),
  paper: z.enum(['plain', 'dots', 'grid', 'lines']), strokes: z.array(stroke).max(2000), items: z.array(item).max(100),
}).strict().superRefine((doc, context) => {
  const ids = [...doc.strokes, ...doc.items].map(value => value.id);
  const invalid = (message: string) => context.addIssue({ code: 'custom', message });
  if (new Set(ids).size !== ids.length) invalid('noteCanvasDuplicateId');
  if (doc.strokes.reduce((sum, line) => sum + line.points.length, 0) > 100000) invalid('noteCanvasPointBudget');
  if (doc.items.reduce((sum, value) => sum + (value.kind === 'image' ? value.src.length : 0), 0) > 6 * 1024 * 1024) invalid('noteCanvasImageBudget');
  for (const line of doc.strokes) if (line.points.some(value => value.x > doc.width || value.y > doc.height)) invalid('noteCanvasBounds');
  for (const value of doc.items) {
    if (value.x + value.width > doc.width + .001 || value.y + value.height > doc.height + .001) invalid('noteCanvasBounds');
    if (value.kind === 'diagram' && Object.entries(value.values).some(([key, number]) => {
      const parameter = value.diagram.parameters.find(p => p.id === key);
      return !parameter || number < parameter.min || number > parameter.max;
    })) invalid('noteDiagramParameterInvalid');
  }
});
