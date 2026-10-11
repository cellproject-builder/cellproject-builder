import { sourceFingerprint } from '@/attachments/files';
import type { ChatTurnContext } from '@/chat/turnContext';
import { hasPendingPlannerEdits } from '@/chat/plannerEdits';
import { readPlanner } from '@/workspace/planner';

/** Private conflict token. Never include this in model messages or stored chat. */
export interface PlannerEditBaseline {
  projectId: string; planId: string | null; revision: string; wholeRevision: string;
  nodeRevisions: Record<string, string>;
}

export function readPlannerEditBaseline(projectId: string): PlannerEditBaseline {
  const { project, objectiveDraft, drafts, pendingSuggestions, parkedSuggestions, archivedProject, archivedPending } = readPlanner(projectId);
  const revision = sourceFingerprint(JSON.stringify({ project, objectiveDraft, drafts, pendingSuggestions, parkedSuggestions, archivedProject, archivedPending }));
  const nodeRevisions = Object.fromEntries(Object.values(project?.nodes ?? {}).map(node => [node.id,
    sourceFingerprint(JSON.stringify({ node, draft: drafts[node.id],
      pending: pendingSuggestions?.parentId === node.id ? pendingSuggestions : null, parked: parkedSuggestions[node.id] })),
  ]));
  return { projectId, planId: project?.id ?? null, revision, wholeRevision: revision, nodeRevisions };
}

export function capturePlannerEditBaseline(context: ChatTurnContext, projectId = context.projectId): PlannerEditBaseline | null {
  if (!projectId) return null;
  try {
    const baseline = readPlannerEditBaseline(projectId);
    // A supplied focus describes the submitted plan, even if an import replaced
    // the singleton before this capture. Reading a replacement cannot retarget it.
    if (context.surface === 'planner' && context.visibleProjectId === projectId && context.planId) return { ...baseline, planId: context.planId };
    return baseline;
  } catch { return null; }
}

export function assertPlannerEditsCommitted(projectId: string) {
  const planId = readPlanner(projectId).project?.id;
  if (planId && hasPendingPlannerEdits(planId)) throw new Error('plannerDraftPending: Finish or cancel the current field edit before changing the plan through chat.');
}

export function assertPlannerEditBaseline(baseline: PlannerEditBaseline, scope: { nodeIds?: string[]; whole?: boolean } = {}) {
  assertPlannerEditsCommitted(baseline.projectId);
  const current = readPlannerEditBaseline(baseline.projectId);
  if (current.planId !== baseline.planId || current.revision !== baseline.revision ||
    scope.whole && current.revision !== baseline.wholeRevision ||
    scope.nodeIds?.some(id => current.nodeRevisions[id] !== baseline.nodeRevisions[id])) throw new Error('planChanged');
  return current;
}
