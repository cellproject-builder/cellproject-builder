import { z } from 'zod';
import { diagramSchema } from '@/visuals/diagram/model';
import { sceneSchema, validDiagramValues } from '@/visuals/normalize';
import { noteImageSourceSchema } from '@/workspace/noteCanvasModel';
import { inkPointSchema, inkStyleShape } from '@/ink/model';
import { canvasAttachmentsSchema } from '@/attachments/canvasModel';

const id = z.string().regex(/^[\w-]{1,100}$/).refine(value => !['constructor', 'prototype', '__proto__'].includes(value));
const coordinate = z.number().finite().min(-100_000).max(100_000);
const size = z.number().finite().min(1).max(10_000);
const color = z.string().regex(/^#[\da-fA-F]{6}$/);
const base = { id, x: coordinate, y: coordinate, width: size, height: size };
const text = { text: z.string().max(20_000), color, fontSize: z.number().finite().min(10).max(96) };
export const boardItemSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('card'), ...text }).strict(),
  z.object({ ...base, kind: z.literal('text'), ...text }).strict(),
  z.object({ ...base, kind: z.literal('image'), src: noteImageSourceSchema, label: z.string().max(300) }).strict(),
  z.object({ ...base, kind: z.literal('diagram'), diagram: diagramSchema, values: z.record(id, z.number().finite()).refine(values => Object.keys(values).length <= 6) }).strict(),
  z.object({ ...base, kind: z.literal('model'), scene: sceneSchema.refine(scene => scene.objects.length <= 128, 'boardModelObjectBudget') }).strict(),
  z.object({ ...base, kind: z.literal('drawing'), points: z.array(inkPointSchema).min(1).max(4096), color, widthStroke: z.number().finite().min(.25).max(24), ...inkStyleShape }).strict(),
]);
export const boardEdgeSchema = z.object({ id, source: id, target: id }).strict();
export const boardDocumentSchema = z.object({
  version: z.literal(1), items: z.array(boardItemSchema).max(200), edges: z.array(boardEdgeSchema).max(500),
  viewport: z.object({ x: coordinate, y: coordinate, zoom: z.number().finite().min(.05).max(8) }).strict(),
}).strict().superRefine((document, context) => {
  const invalid = (message: string) => context.addIssue({ code: 'custom', message });
  const items = new Set(document.items.map(item => item.id));
  if (items.size !== document.items.length || new Set(document.edges.map(edge => edge.id)).size !== document.edges.length) invalid('boardDuplicateId');
  if (document.edges.some(edge => !items.has(edge.source) || !items.has(edge.target))) invalid('boardUnknownItem');
  if (document.items.reduce((sum, item) => sum + (item.kind === 'drawing' ? item.points.length : 0), 0) > 100_000) invalid('boardDrawingPointBudget');
  if (document.items.reduce((sum, item) => sum + (item.kind === 'image' ? item.src.length : 0), 0) > 6 * 1024 * 1024) invalid('boardImageBudget');
  for (const item of document.items) {
    if (item.kind === 'drawing' && item.points.some(point => point.x > item.width || point.y > item.height)) invalid('boardDrawingBounds');
    if (item.kind === 'diagram' && !validDiagramValues(item.diagram, item.values)) invalid('boardDiagramParameterInvalid');
  }
});
export const boardRecordSchema = z.object({
  attachments: canvasAttachmentsSchema.optional(),
  id, title: z.string().trim().min(1).max(240), document: boardDocumentSchema, archived: z.boolean(),
  createdAt: z.number().finite().nonnegative().max(8.64e15), updatedAt: z.number().finite().nonnegative().max(8.64e15),
}).strict();
export type BoardItem = z.infer<typeof boardItemSchema>;
export type BoardEdge = z.infer<typeof boardEdgeSchema>;
export type BoardDocument = z.infer<typeof boardDocumentSchema>;
export type BoardRecord = z.infer<typeof boardRecordSchema>;
export function createBoardDocument(): BoardDocument { return { version: 1, items: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }; }

const collectionSchema = z.record(id, boardRecordSchema).refine(boards => Object.entries(boards).every(([key, board]) => key === board.id), 'boardCollectionIdMismatch');
function notebookImageChars(notes: unknown): number {
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) return 0;
  return Object.values(notes).reduce<number>((sum, note) => {
    const items = (note as { canvas?: { items?: unknown[] } } | null)?.canvas?.items;
    return sum + (Array.isArray(items) ? items.reduce<number>((count, item) => {
      const image = item as { kind?: unknown; src?: unknown } | null;
      return count + (image?.kind === 'image' && typeof image.src === 'string' ? image.src.length : 0);
    }, 0) : 0);
  }, 0);
}
/** Boards and notebook raster images share the protected workspace envelope and its image budget. */
export function assertBoardWorkspaceImageBudget(boards: Record<string, BoardRecord>, notes?: unknown): void {
  const boardChars = Object.values(boards).reduce((sum, board) => sum + board.document.items.reduce((count, item) => count + (item.kind === 'image' ? item.src.length : 0), 0), 0);
  if (boardChars + notebookImageChars(notes) > 16 * 1024 * 1024) throw new Error('As imagens dos quadros e cadernos ultrapassam o limite do workspace. Os dados originais foram preservados.');
}
/** Missing collection is a supported legacy workspace. Invalid new data is never silently discarded. */
export function validatePersistedBoards(boards: unknown, notes?: unknown): void {
  if (boards === undefined) { assertBoardWorkspaceImageBudget({}, notes); return; }
  const result = collectionSchema.safeParse(boards);
  if (!result.success) throw new Error('Um quadro inválido ou incompatível foi encontrado. Os dados originais foram preservados. Restaure uma cópia válida e tente novamente.');
  assertBoardWorkspaceImageBudget(result.data, notes);
}
