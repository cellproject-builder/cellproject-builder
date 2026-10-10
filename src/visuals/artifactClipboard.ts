import { z } from 'zod';
import { nanoid } from 'nanoid';
import { useGraphStore } from '@/store';
import { currentVisualScope, getVisualWorkspace, mutateVisualWorkspace, watchVisualScope } from './domain';
import { artifactSchema } from './normalize';
import { readVisualMedia } from './media';
import { useVisualViewStore } from './rendering/viewStore';
import type { VisualArtifact } from './types';

export const ARTIFACT_CLIPBOARD_TYPE = 'application/x-cellproject-visual-artifact';
const PREFIX = 'cellproject-visual-artifact:v1\n';
const MAX_CHARACTERS = 2_000_000;
const snapshotSchema = z.object({
  version: z.literal(1), projectId: z.string().min(1).max(100), ownerId: z.string().min(1).max(200).nullable(),
  artifact: artifactSchema,
  view: z.object({ yaw: z.number().finite(), pitch: z.number().finite().min(-Math.PI / 2).max(Math.PI / 2),
    zoom: z.number().finite().min(.4).max(4).optional(),
    explosion: z.number().finite().min(0).max(1), selectedPart: z.string().max(200).nullable(),
  }).strict(),
}).strict();
export type ArtifactSnapshot = z.infer<typeof snapshotSchema>;

/** Native clipboard data contains an immutable snapshot, never runnable Three.js code. */
export function copyArtifactSnapshot(id: string): string {
  const scope = currentVisualScope();
  const artifact = getVisualWorkspace(useGraphStore.getState().project).artifacts.find(a => a.id === id);
  if (!artifact) throw new Error('visualArtifactMissing');
  const view = useVisualViewStore.getState();
  const snapshot = snapshotSchema.parse({ version: 1, ...scope, artifact,
    view: { yaw: view.angles[id] ?? 0, pitch: view.pitches[id] ?? 0, zoom: view.zooms[id] ?? 1, explosion: view.explosions[id] ?? 0, selectedPart: view.selectedParts[id] ?? null },
  });
  const text = PREFIX + JSON.stringify(snapshot);
  if (text.length > MAX_CHARACTERS) throw new Error('visualClipboardLimit');
  return text;
}

export function parseArtifactClipboard(text: string): ArtifactSnapshot | null {
  if (!text.startsWith(PREFIX)) return null;
  if (text.length > MAX_CHARACTERS) throw new Error('visualClipboardLimit');
  try { return snapshotSchema.parse(JSON.parse(text.slice(PREFIX.length))); }
  catch { throw new Error('visualClipboardInvalid'); }
}

/** New identity, mutable geometry/history and inspection state; immutable image bytes can be shared. */
export async function pasteArtifactSnapshot(snapshot: ArtifactSnapshot): Promise<VisualArtifact> {
  const guard = watchVisualScope();
  try {
    const parsed = snapshotSchema.safeParse(snapshot);
    if (!parsed.success) throw new Error('visualClipboardInvalid');
    const { artifact: source, view, projectId, ownerId } = parsed.data;
    if (projectId !== guard.scope.projectId || ownerId !== guard.scope.ownerId) throw new Error('visualProjectChanged');
    if (source.kind === 'image' && !(await readVisualMedia(source.mediaId!))) throw new Error('visualMediaMissing');
    guard.assert();
    const project = useGraphStore.getState().project!, workspace = getVisualWorkspace(project);
    if (workspace.artifacts.length >= 512) throw new Error('visualArtifactLimit');
    let step = 32;
    const position = () => ({ x: source.x + step * (source.x > 80000 ? -1 : 1), y: source.y + step * (source.y > 80000 ? -1 : 1) });
    while (workspace.artifacts.some(a => Math.abs(a.x - position().x) < 1 && Math.abs(a.y - position().y) < 1)) step += 32;
    const artifact = artifactSchema.parse({ ...source, id: nanoid(), ...position(),
      ...(source.linkedNodeId && !Object.hasOwn(project.nodes, source.linkedNodeId) ? { linkedNodeId: null } : {}),
    });
    mutateVisualWorkspace(w => ({ ...w, artifacts: [...w.artifacts, artifact] }), guard.scope);
    useVisualViewStore.setState(state => ({
      angles: { ...state.angles, [artifact.id]: view.yaw }, pitches: { ...state.pitches, [artifact.id]: view.pitch },
      zooms: { ...state.zooms, [artifact.id]: view.zoom ?? 1 },
      explosions: { ...state.explosions, [artifact.id]: view.explosion }, selectedParts: { ...state.selectedParts, [artifact.id]: view.selectedPart },
    }));
    return artifact;
  } finally { guard.dispose(); }
}
