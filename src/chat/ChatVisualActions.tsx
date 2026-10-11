import { memo, useEffect, useMemo, useState } from 'react';
import type { AssistantActionEvent } from '@/ai/workspaceTools';
import { aiRevealGraceEnd, useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { requestWorkspaceUI } from '@/workspace/uiRequests';
import { componentFitSchema } from '@/visuals/componentFit';
import { chatImageSearchRevision } from '@/visuals/projectSearchContext';
import type { ImageReference, VisualPromptInput } from '@/visuals/types';
import { useVisualPopupStore } from '@/visuals/ui/uiStore';
import { ChatImageCarousel, type ChatImageGroup } from './ChatImageCarousel';

function parseImageSearchResult(value: object) {
  const result = value as { projectId?: unknown; planId?: unknown; imageReferences?: unknown; input?: VisualPromptInput; contextRevision?: unknown; groups?: unknown; fits?: unknown; searchUncertainty?: unknown; contextPartial?: unknown };
  if (typeof result.projectId !== 'string' || !Array.isArray(result.imageReferences)) return null;
  if (!result.imageReferences.every(item => item && typeof item === 'object' && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.imageUrl === 'string' && typeof item.sourcePageUrl === 'string')) return null;
  const images = result.imageReferences as ImageReference[];
  const groups = Array.isArray(result.groups) ? result.groups.slice(0, 8).filter((group): group is ChatImageGroup => group && typeof group.id === 'string' && typeof group.label === 'string' && group.label.length <= 200 && Array.isArray(group.imageIds) && group.imageIds.length <= 12 && group.imageIds.every((id: unknown) => typeof id === 'string' && images.some(image => image.id === id))) : [];
  const fits = Array.isArray(result.fits) ? result.fits.slice(0, 12).flatMap(value => { const parsed = componentFitSchema.safeParse(value); return parsed.success && images.some(image => image.id === parsed.data.imageId) ? [parsed.data] : []; }) : [];
  return { projectId: result.projectId, planId: typeof result.planId === 'string' ? result.planId : undefined, images, input: result.input, groups, fits, contextRevision: typeof result.contextRevision === 'string' ? result.contextRevision : undefined, searchUncertainty: typeof result.searchUncertainty === 'string' ? result.searchUncertainty.slice(0, 300) : '', contextPartial: result.contextPartial === true };
}

type ImageSearchResult = NonNullable<ReturnType<typeof parseImageSearchResult>>;
// Persisted action results are immutable. Weak keys also release old conversations.
const imageSearchResults = new WeakMap<object, ImageSearchResult | null>();
function imageSearchResult(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  if (imageSearchResults.has(value)) return imageSearchResults.get(value)!;
  const result = parseImageSearchResult(value);
  imageSearchResults.set(value, result);
  return result;
}

export type ChatImageChooser = (image: ImageReference, projectId: string, options: { useAs3D: boolean }, linkedNodeId?: string, expectedPlanId?: string, searchContext?: { expectedContextRevision: string; searchInput: VisualPromptInput }) => Promise<void>;

const ChatImageSearch = memo(function ChatImageSearch({ result, english, disabled, onChoose }: {
  result: ImageSearchResult; english: boolean; disabled: boolean; onChoose: ChatImageChooser;
}) {
  const managed = useWorkspaceStore(state => state.projects[result.projectId]);
  const projectId = useWorkspaceStore(state => state.activeProjectId);
  const notes = useWorkspaceStore(state => state.notes), tasks = useWorkspaceStore(state => state.tasks);
  const plan = useGraphStore(state => state.project);
  const [criterionTime, setCriterionTime] = useState(0);
  // Chat drafts and streamed text do not change these immutable source identities.
  // The insertion controller still checks the live revision again when choosing.
  const contextChanged = useMemo(() => {
    if (!result.contextRevision || !result.input || !managed || projectId !== result.projectId || result.planId && plan?.id !== result.planId) return false;
    try { return chatImageSearchRevision(result.projectId, result.input) !== result.contextRevision; } catch { return true; }
  }, [result, managed, projectId, plan, notes, tasks, criterionTime]);
  // A referenced criterion can become visible without replacing its node.
  // Recheck at that boundary rather than polling or hashing on every keystroke.
  useEffect(() => {
    if (contextChanged || !result.contextRevision || !result.input || !managed || projectId !== result.projectId || !plan || result.planId && plan.id !== result.planId) return;
    const mentioned = new Set(Array.isArray(result.input.mentions) ? result.input.mentions.filter(mention => mention?.kind === 'node').map(mention => mention.id) : []);
    const advanced = result.input.generationMode === 'advanced';
    if (!advanced && !mentioned.size) return;
    const now = Date.now(); let next = Infinity;
    for (const node of Object.values(plan.nodes)) {
      if (!advanced && !mentioned.has(node.id)) continue;
      const end = aiRevealGraceEnd(node);
      if (end > now && end < next) next = end;
    }
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => setCriterionTime(Date.now()), Math.min(2_147_483_647, next - now));
    return () => clearTimeout(timer);
  }, [result, managed, projectId, plan, contextChanged, criterionTime]);
  const linkedNodeId = Array.isArray(result.input?.mentions) ? result.input.mentions.find(mention => mention?.kind === 'node' && typeof mention.id === 'string')?.id : undefined;
  return <ChatImageCarousel results={result.images} projectId={result.projectId} english={english} disabled={disabled}
    groups={result.groups} fits={result.fits} searchUncertainty={result.searchUncertainty} contextPartial={result.contextPartial}
    unavailable={!managed ? 'projectRemoved' : projectId !== result.projectId ? 'projectChanged' : result.planId && result.planId !== plan?.id ? 'planChanged' : contextChanged ? 'contextChanged' : undefined}
    onChoose={(image, options) => onChoose(image, result.projectId, options, linkedNodeId, result.planId, result.contextRevision && result.input ? { expectedContextRevision: result.contextRevision, searchInput: result.input } : undefined)}
    onOpenProject={managed ? () => requestWorkspaceUI({ surface: 'planner', projectId: result.projectId }) : undefined} />;
});

export const ChatVisualActions = memo(function ChatVisualActions({ actions, english, disabled, onChoose, onClose }: {
  actions?: AssistantActionEvent[]; english: boolean; disabled: boolean; onChoose: ChatImageChooser; onClose: () => void;
}) {
  const projects = useWorkspaceStore(state => state.projects);
  const visualActions = useMemo(() => actions?.filter(action => action.name === 'visual_action').map(action => ({ action, result: action.action === 'search_images' ? imageSearchResult(action.result) : null })) ?? [], [actions]);
  return <>
    {visualActions.filter(({ action, result }) => action.action === 'search_images' && action.status === 'done' && result).map(({ action, result }) => <ChatImageSearch key={action.id} result={result!} english={english} disabled={disabled} onChoose={onChoose} />)}
    {visualActions.filter(({ action, result }) => (action.action === 'generate_model' || action.action === 'search_images' && !result) && ['done', 'awaiting_approval'].includes(action.status)).slice(-1).map(({ action }) => {
      const result = action.result as { projectId?: string } | undefined;
      return result?.projectId && projects[result.projectId] ? <button key={action.id} className="ws-button" onClick={() => {
        requestWorkspaceUI({ surface: 'planner', projectId: result.projectId });
        useVisualPopupStore.getState().open(action.action === 'search_images' ? 'search' : 'model'); onClose();
      }}>{english ? 'Open on canvas' : 'Abrir no canvas'}</button> : null;
    })}
  </>;
});
