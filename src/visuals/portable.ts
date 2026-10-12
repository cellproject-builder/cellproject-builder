import type { Project } from '@/types';
import { importedProjectTreeError, parseImportedProject } from '@/store';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { getPlannerOwnerId } from '@/workspace/planner';
import { normalizeVisualWorkspace } from './normalize';
import { exportVisualMedia, importVisualMedia, type PortableVisualMedia } from './media';
import { collectVisualMediaIds } from './references';
export { collectVisualMediaIds } from './references';

export interface PortableVisualPlan { format: 'cellproject-visual-plan'; version: 1; project: Project; media: PortableVisualMedia[] }

/** File decoding/import may await IndexedDB while the user navigates to another plan. */
export function watchVisualImportContext() {
  const read = () => [useGraphStore.getState().project?.id ?? null, getPlannerOwnerId(), useWorkspaceStore.getState().activeProjectId] as const;
  const initial = read(); let changed = false;
  const check = () => { if (read().some((value, index) => value !== initial[index])) changed = true; };
  const offGraph = useGraphStore.subscribe(check), offWorkspace = useWorkspaceStore.subscribe(check);
  return { assert: () => { check(); if (changed) throw new Error('visualImportContextChanged'); }, dispose: () => { offGraph(); offWorkspace(); } };
}

/** A frozen snapshot keeps bytes paired with the exact plan that the user exported. */
export async function exportVisualPlan(project: Project): Promise<Project | PortableVisualPlan> {
  const snapshot = JSON.parse(JSON.stringify(project)) as Project;
  if (snapshot.visuals === undefined) return snapshot;
  snapshot.visuals = normalizeVisualWorkspace(snapshot.visuals);
  return { format: 'cellproject-visual-plan', version: 1, project: snapshot, media: await exportVisualMedia(collectVisualMediaIds(snapshot)) };
}

/** Validates concepts and every scene before media writes; does not replace the editor. */
export async function prepareVisualPlanImport(raw: unknown): Promise<Project> {
  if (typeof raw === 'string') raw = JSON.parse(raw) as unknown;
  const envelope = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const wrapped = envelope?.format === 'cellproject-visual-plan';
  if (wrapped && (envelope.version !== 1 || !Array.isArray(envelope.media) || Object.keys(envelope).some(key => !['format', 'version', 'project', 'media'].includes(key)))) throw new Error('visualPlanInvalid');
  const project = parseImportedProject(wrapped ? envelope.project : raw);
  if (!project) throw new Error(importedProjectTreeError(wrapped ? envelope.project : raw) ?? 'visualPlanInvalid');
  const ids = collectVisualMediaIds(project);
  const media = wrapped ? envelope.media as PortableVisualMedia[] : [];
  if (ids.some(id => !media.some(record => record?.id === id))) throw new Error('visualMediaMissing');
  if (media.some(record => !ids.includes(record?.id))) throw new Error('visualMediaUnexpected');
  await importVisualMedia(media, project.id);
  return project;
}
