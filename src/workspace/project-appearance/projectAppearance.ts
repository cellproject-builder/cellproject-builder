import { z } from 'zod';

/** Store stable export IDs, never component code or catalog indexes. Future IDs remain portable. */
export const projectAppearanceSchema = z.object({
  icon: z.string().regex(/^(?:planner|[A-Za-z][A-Za-z0-9]{0,63}Icon)$/),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
}).strict();

export type ProjectAppearance = z.infer<typeof projectAppearanceSchema>;

export const DEFAULT_PROJECT_APPEARANCE: Readonly<ProjectAppearance> = Object.freeze({
  icon: 'planner', color: '#60a5fa',
});
