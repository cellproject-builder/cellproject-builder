import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { requestWorkspaceUI } from '@/workspace/uiRequests';
import { registerAIAction } from '@/ai/actions';
import { searchVisualImages } from './search';
import { generateVisualModel } from './generation';
import { generateVisualDiagram } from './diagram/generation';
import { applyVisualProposal, currentVisualScope, findMentionTarget, getVisualWorkspace, saveVisualDraft, updateVisualArtifact, watchVisualScope } from './domain';
import { addReferenceImage } from './media';
import { useVisualPopupStore } from './ui/uiStore';
import type { ImageReference, VisualPromptInput, VisualProposal, VisualSearchReview } from './types';
import type { ImageSearchIntent } from './searchIntent';
import { chatImageSearchRevision } from './projectSearchContext';

export interface VisualSearchResult { id: string; projectId: string; input: VisualPromptInput; results: ImageReference[]; intent?: ImageSearchIntent; review?: VisualSearchReview }
export interface VisualSearchDetails { intent?: ImageSearchIntent; review?: VisualSearchReview; targetMatches: Record<string, number[]> }
export const useVisualSearchStore = create<{ search: VisualSearchResult | null }>(() => ({ search: null }));
export interface VisualGenerationResult { id: string; proposal: VisualProposal }
export const useVisualGenerationStore = create<{ generation: VisualGenerationResult | null }>(() => ({ generation: null }));
let placementResolver: (() => { x: number; y: number }) | null = null;
export function setVisualPlacementResolver(resolve: (() => { x: number; y: number }) | null) { placementResolver = resolve; }
export function visualPlacement() {
  if (placementResolver) return placementResolver();
  const project = useGraphStore.getState().project, root = project?.nodes[project.rootId];
  return { x: (root?.position.x ?? 0) + 360, y: (root?.position.y ?? 0) + 80 };
}
export async function runVisualSearch(input: VisualPromptInput, options: { signal: AbortSignal; beforeRequest?: () => Promise<void>; openPopup?: boolean; projectBackground?: string; onDetails?: (details: VisualSearchDetails) => void }): Promise<ImageReference[]> {
  const guard = watchVisualScope();
  let intent: ImageSearchIntent | undefined;
  let review: VisualSearchReview | undefined;
  let targetMatches: Record<string, number[]> = {};
  try {
    const results = await searchVisualImages(input, { ...options, onIntent: resolved => {
      options.signal.throwIfAborted(); guard.assert();
      intent = resolved;
    }, onReview: resolved => {
      options.signal.throwIfAborted(); guard.assert();
      review = resolved;
    }, onTargets: matches => { targetMatches = matches; } });
    options.signal.throwIfAborted(); guard.assert();
    options.onDetails?.({ intent, review, targetMatches });
    if (options.openPopup !== false) {
      useVisualSearchStore.setState({ search: { id: nanoid(), projectId: guard.scope.projectId, input, results, intent, review } });
      const tools = useVisualPopupStore.getState();
      if (!tools.searchMinimized) tools.open('search');
    }
    return results;
  } finally { guard.dispose(); }
}
/** A human's carousel choice is the only insertion step; search never inserts. */
export async function addChatImageReference(reference: ImageReference, projectId: string, options: { useAs3D?: boolean; linkedNodeId?: string | null; expectedPlanId?: string; expectedContextRevision?: string; searchInput?: VisualPromptInput } = {}) {
  if (useWorkspaceStore.getState().activeProjectId !== projectId) throw new Error('visualProjectChanged');
  if (options.expectedPlanId && useGraphStore.getState().project?.id !== options.expectedPlanId) throw new Error('visualProjectChanged');
  requestWorkspaceUI({ projectId, surface: 'planner' });
  const guard = watchVisualScope();
  const assertContext = () => {
    if (options.expectedContextRevision && (!options.searchInput || chatImageSearchRevision(projectId, options.searchInput) !== options.expectedContextRevision)) throw new Error('visualSearchContextChanged');
  };
  try {
    assertContext();
    const workspace = getVisualWorkspace(useGraphStore.getState().project);
    const existing = workspace.artifacts.find(artifact => artifact.kind === 'image' && artifact.source && (
      (artifact.source.id === reference.id && artifact.source.sessionId === reference.sessionId) || artifact.source.imageUrl === reference.imageUrl
    ));
    if (options.useAs3D && workspace.drafts.model.mentions.length >= 20 && !workspace.drafts.model.mentions.some(target => target.kind === 'image' && target.id === existing?.id)) throw new Error('visualInputLimit');
    const artifact = existing ?? await addReferenceImage(reference, visualPlacement(), undefined, { center: true, linkedNodeId: options.linkedNodeId ?? null, ...(options.expectedContextRevision ? { beforeInsert: assertContext } : {}) });
    guard.assert();
    assertContext();
    if (useWorkspaceStore.getState().activeProjectId !== projectId) throw new Error('visualProjectChanged');
    if (options.useAs3D) {
      const target = findMentionTarget(artifact.id, 'image');
      if (!target) throw new Error('visualSourceMissing');
      const draft = getVisualWorkspace(useGraphStore.getState().project).drafts.model;
      if (!draft.mentions.some(item => item.kind === 'image' && item.id === target.id)) saveVisualDraft('model', { ...draft, mentions: [...draft.mentions, target] });
      useVisualPopupStore.getState().useAsBase(target);
    }
    return artifact;
  } finally { guard.dispose(); }
}
export function applyModelAtViewport(id: string) {
  const wasApplied = useGraphStore.getState().project?.visuals?.proposals.find(p => p.id === id)?.status === 'applied';
  const artifact = applyVisualProposal(id);
  if (!wasApplied) { const point = visualPlacement(); updateVisualArtifact(artifact.id, { x: point.x - artifact.width / 2, y: point.y - artifact.height / 2 }); }
  return artifact;
}
export async function runVisualGeneration(input: VisualPromptInput, options: { signal: AbortSignal; beforeRequest?: () => Promise<void>; onProgress?: (message: string) => void; openPopup?: boolean }) {
  const scope = currentVisualScope(), finish = registerAIAction();
  try {
    const proposal = input.artifactKind === 'diagram' ? await generateVisualDiagram(input, options) : await generateVisualModel(input, options);
    if (proposal.status === 'applied' && useGraphStore.getState().project?.id === scope.projectId) {
      const artifact = useGraphStore.getState().project!.visuals!.artifacts.find(a => a.id === `model-${proposal.id}`);
      if (artifact) { const point = visualPlacement(); updateVisualArtifact(artifact.id, { x: point.x - artifact.width / 2, y: point.y - artifact.height / 2 }); }
    }
    const tools = useVisualPopupStore.getState();
    if (options.openPopup !== false) {
      useVisualGenerationStore.setState({ generation: { id: nanoid(), proposal } });
      if (!tools.modelMinimized) tools.open('model');
    }
    return proposal;
  } finally { finish(); }
}
