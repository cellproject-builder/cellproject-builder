import type { MentionTarget, VisualPromptInput, VisualWorkspace } from './types';

/** Recover legacy drafts without hiding missing notes or changing proposal history. */
export function reconcileVisualImageReferences(input: VisualPromptInput, workspace: VisualWorkspace): { input: VisualPromptInput; removed: MentionTarget[] } {
  const imageIds = new Set(workspace.artifacts.filter(artifact => artifact.kind === 'image').map(artifact => artifact.id));
  const removed = input.mentions.filter(target => target.kind === 'image' && !imageIds.has(target.id));
  if (!removed.length) return { input, removed };
  return { input: { ...input, mentions: input.mentions.filter(target => target.kind !== 'image' || imageIds.has(target.id)) }, removed };
}
