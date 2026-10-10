import { z } from 'zod';

/** Frozen /1 benchmark grammar, independent of the richer production renderer. */
const coordinate = z.number().finite().min(-10000).max(10000);
const triple = z.tuple([coordinate, coordinate, coordinate]);
const scale = z.number().finite().positive().max(10000);
const types = ['box', 'sphere', 'cylinder', 'cone', 'torus'] as const;
export const sceneSchema = z.object({ version: z.literal(1), label: z.string().trim().min(1).max(160), objects: z.array(z.object({
  id: z.string().min(1).max(100), type: z.enum(types), position: triple, rotation: triple,
  scale: z.tuple([scale, scale, scale]), color: z.string().regex(/^#[\da-fA-F]{6}$/),
}).strict()).min(1).max(128).refine(objects => new Set(objects.map(o => o.id)).size === objects.length, 'duplicateObjectId') }).strict();
const generationTriple = z.array(z.number());
export const generationSceneSchema = z.object({ version: z.literal(1), label: z.string(), objects: z.array(z.object({
  id: z.string(), type: z.enum(types), position: generationTriple, rotation: generationTriple, scale: generationTriple, color: z.string(),
}).strict()) }).strict();
