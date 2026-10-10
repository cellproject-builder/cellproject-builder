import { z } from 'zod';

export const inkTools = ['pen', 'fountain', 'monoline', 'pencil', 'highlighter'] as const;
export type InkTool = typeof inkTools[number];
export interface InkPoint { x: number; y: number; pressure?: number }
/** Optional style fields distinguish modern ink without rewriting saved legacy strokes. */
export interface InkStrokeData { color: string; width: number; points: InkPoint[]; tool?: InkTool; opacity?: number }
export interface InkSettings { tool: InkTool; color: string; width: number; opacity: number }

export const inkPointSchema = z.object({
  x: z.number().finite().min(0).max(10_000),
  y: z.number().finite().min(0).max(10_000),
  pressure: z.number().finite().min(0).max(1).optional(),
}).strict();
/** No defaults or transforms: parsing an older document keeps its original shape. */
export const inkStyleShape = {
  tool: z.enum(inkTools).optional(),
  opacity: z.number().finite().min(.05).max(1).optional(),
};

export const inkDefaults: Readonly<Record<InkTool, Readonly<Pick<InkSettings, 'width' | 'opacity'>>>> = {
  pen: { width: 3, opacity: 1 },
  fountain: { width: 5, opacity: 1 },
  monoline: { width: 3, opacity: 1 },
  pencil: { width: 2, opacity: .65 },
  highlighter: { width: 18, opacity: .28 },
};

/** Each editor owns its tool preferences; changing them never mutates existing strokes. */
export function createInkSettings(tool: InkTool = 'pen'): InkSettings {
  return { tool, color: '#a78bfa', ...inkDefaults[tool] };
}
