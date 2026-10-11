import type { Project } from '@/types';
import { normalizeVisualWorkspace } from './normalize';

export function collectVisualMediaIds(project: Project): string[] {
  if (project.visuals === undefined) return [];
  const workspace = normalizeVisualWorkspace(project.visuals), ids = new Set<string>();
  const add = (id: string | null) => { if (id) ids.add(id); };
  for (const resource of workspace.attachments?.resources ?? []) add(resource.mediaId);
  for (const artifact of workspace.artifacts) {
    add(artifact.mediaId);
    for (const revision of artifact.revisions) {
      add(revision.mediaId);
      for (const attachment of revision.input?.attachments ?? []) add(attachment.mediaId);
      for (const id of revision.referencedMediaIds ?? []) add(id);
    }
    for (const id of artifact.origin?.imageMediaIds ?? []) add(id);
  }
  for (const proposal of workspace.proposals) {
    for (const attachment of proposal.input.attachments) add(attachment.mediaId);
    for (const id of proposal.referencedMediaIds ?? []) add(id);
  }
  for (const input of Object.values(workspace.drafts)) for (const attachment of input.attachments) add(attachment.mediaId);
  return [...ids];
}
