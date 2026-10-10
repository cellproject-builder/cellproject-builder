import { tool } from 'ai';
import { z } from 'zod';
import { readPlanner } from '@/workspace/planner';
import { requestWorkspaceUI } from '@/workspace/uiRequests';
import { findMentionTarget, getVisualWorkspace, listMentionTargets, saveVisualDraft, resolveVisualContext } from '@/visuals/domain';
import { useGraphStore } from '@/store';
import { runVisualGeneration, runVisualSearch, type VisualSearchDetails } from '@/visuals/controller';
import { collectProjectSearchContext, chatImageSearchRevision } from '@/visuals/projectSearchContext';
import { assessImageProjectFit } from '@/visuals/componentFit';
import { useVisualPopupStore } from '@/visuals/ui/uiStore';
import type { VisualPromptInput } from '@/visuals/types';

export const visualActionSchema = z.object({
  action: z.enum(['list_references', 'search_images', 'generate_model', 'generate_diagram']),
  projectId: z.string().min(1).max(100), text: z.string().max(12_000),
  references: z.array(z.object({ kind: z.enum(['note', 'node', 'image']), id: z.string().min(1).max(200) }).strict()).max(20),
}).strict();

export async function executeVisualAction(raw: unknown, signal: AbortSignal, beforeRequest?: () => Promise<void>, humanRequest = '') {
  const input = visualActionSchema.parse(raw); signal.throwIfAborted();
  const planner = readPlanner(input.projectId);
  if (!planner.project) throw new Error('Create or choose a plan before using its visual canvas.');
  requestWorkspaceUI({ surface: 'planner', projectId: input.projectId }); signal.throwIfAborted();
  const targets = listMentionTargets(input.action === 'list_references' ? input.text : '');
  if (input.action === 'list_references') return { applied: false, references: targets };
  const mentions = input.references.map(reference => {
    const target = findMentionTarget(reference.id, reference.kind);
    if (!target) throw new Error('The selected reference is missing or belongs to another project.');
    return target;
  });
  const prompt = { text: input.text, mentions, attachments: [] };
  if (input.action === 'search_images') {
    const context = collectProjectSearchContext(input.projectId), contextRevision = chatImageSearchRevision(input.projectId, prompt);
    const assertCurrent = () => { signal.throwIfAborted(); if (chatImageSearchRevision(input.projectId, prompt) !== contextRevision) throw new Error('visualSearchContextChanged'); };
    const before = async () => { await beforeRequest?.(); assertCurrent(); };
    let details: VisualSearchDetails = { targetMatches: {} };
    const results = (await runVisualSearch(prompt, { signal, beforeRequest: before, openPopup: false, projectBackground: JSON.stringify(context), onDetails: value => { details = value; } })).slice(0, 12).map(reference => ({
      id: reference.id.slice(0, 200), sessionId: reference.sessionId?.slice(0, 200),
      title: reference.title.slice(0, 1000), description: reference.description.slice(0, 1200),
      imageUrl: reference.imageUrl.slice(0, 4000), sourcePageUrl: reference.sourcePageUrl.slice(0, 4000),
      credit: reference.credit?.slice(0, 2000) ?? null, license: reference.license?.slice(0, 2000) ?? null,
      width: reference.width, height: reference.height,
      ...(reference.assessment ? { assessment: reference.assessment } : {}),
    }));
    assertCurrent();
    const selected = JSON.parse(resolveVisualContext(prompt).text).selected as Array<{ kind: string; label: string; text: string }>;
    let selectedBudget = 8000;
    const selectedSources = selected.filter(source => source.kind !== 'image').map((source, index) => {
      const text = source.text.slice(0, Math.min(2000, selectedBudget)); selectedBudget -= text.length;
      return { id: `selected:${index}`, label: source.label, kind: 'selected', text, truncated: text.length < source.text.length };
    });
    // Agent-written search text is an instruction, never a new project requirement.
    const fitContext = { ...context, partial: context.partial || humanRequest.length > 4000 || selectedSources.some(source => source.truncated), sources: [...(humanRequest ? [{ id: 'request', label: 'Pedido atual', kind: 'request', text: humanRequest.slice(0, 4000), truncated: humanRequest.length > 4000 }] : []), ...selectedSources, ...context.sources] };
    const groups = details.intent?.targets?.map((target, index) => ({ id: `${index}`, label: target.aliases[0], imageIds: results.filter(image => details.targetMatches[image.id]?.includes(index) || details.intent?.targets?.length === 1).map(image => image.id) })) ?? [];
    const fits = await assessImageProjectFit(results, fitContext, input.text, { signal, beforeRequest: before, groups });
    assertCurrent();
    return { version: 2, applied: false, projectId: input.projectId, planId: planner.project.id, contextRevision, count: results.length, input: prompt, imageReferences: results, groups, fits, contextPartial: fitContext.partial, searchUncertainty: details.intent?.uncertainty ?? '', review: details.review, message: 'Image results are grouped by the requested list in the chat. Missing groups and documented fit checks are visible. Fit assessments are limited documentary comparisons, not proof of physical compatibility. The user chooses each reference; searching inserts nothing.',
      references: results.map(item => ({ id: item.id, title: item.title, sourcePageUrl: item.sourcePageUrl })) };
  }
  const humanDraft = getVisualWorkspace(useGraphStore.getState().project).drafts.model;
  const artifactKind = input.action === 'generate_diagram' ? 'diagram' : 'model';
  const modelPrompt: VisualPromptInput = { ...prompt, artifactKind, generationMode: 'standard', ...(humanDraft.analyzeImages && mentions.some(target => target.kind === 'image') ? { analyzeImages: true } : {}) };
  saveVisualDraft('model', { ...modelPrompt, ...(humanDraft.analyzeImages !== undefined ? { analyzeImages: humanDraft.analyzeImages } : {}) }); useVisualPopupStore.getState().open('model');
  const proposal = await runVisualGeneration(modelPrompt, { signal, beforeRequest });
  const applied = proposal.status === 'applied';
  return { applied, projectId: input.projectId, requiresApproval: proposal.status === 'ready', proposalId: proposal.id, status: proposal.status, imageAnalysis: modelPrompt.analyzeImages ? 'pixels' : 'metadata',
    message: applied ? `${artifactKind === 'diagram' ? 'Exploratory diagram' : 'Illustrative model'} applied to the canvas.` : proposal.status === 'ready' ? 'Artifact prepared. The user must apply the proposal in the visual studio.' : 'References changed; the artifact was not applied.' };
}

function compactVisualToolOutput(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const { imageReferences: _images, input: _input, ...summary } = value as Record<string, unknown>;
  // Saving failures wrap the original output inside another result envelope.
  // Keep failure flags and messages, while excluding the same UI payload there.
  return 'result' in summary ? { ...summary, result: compactVisualToolOutput(summary.result) } : summary;
}

export function createVisualTools(signal: AbortSignal, execute: (name: string, fn: (input: unknown) => unknown | Promise<unknown>) => (input: unknown) => Promise<unknown>, beforeRequest?: () => Promise<void>, humanRequest = '') {
  return { visual_action: tool({ description: 'Find real images grouped by the requested items in this chat and compare retrieved specifications with current project requirements, or generate illustrative Three.js models (generate_model), bounded interactive SVG diagrams (generate_diagram), or list reference IDs. Diagrams illustrate a relationship with optional exploratory parameters and links to existing nodes, never execute code or prove physical correctness. Preserve the whole requested list in text, including lists from previous assistant replies. Search up to 8 distinct items per call; split longer lists explicitly across calls without omitting items. Only use selected references relevant to the request. Project records are included automatically; no need to attach every node. Fit checks can be supported/conflict/unknown, with quotes and missing specifications; relevance is not technical compatibility. list_references returns labels, not bodies. Searching never inserts images or opens a popup: the human chooses. Generation follows human approval/automatic mode; ready proposals need Apply. Never claim physical validation or change policy. references required, [] without selected sources.', inputSchema: visualActionSchema, execute: execute('visual_action', input => executeVisualAction(input, signal, beforeRequest, humanRequest)),
    toModelOutput: ({ output }) => {
      // Candidate URLs are UI state, not material for the model to repeat or cache.
      return { type: 'text', value: JSON.stringify(compactVisualToolOutput(output)) };
    },
  }) };
}
