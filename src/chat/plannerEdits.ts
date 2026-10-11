export interface PlannerEditTarget { planId: string; nodeId: string; field: string }

// Ephemeral ownership only: unsaved prose remains inside its editor component.
const pendingEdits = new Map<symbol, PlannerEditTarget>();
export function registerPendingPlannerEdit(target: PlannerEditTarget) {
  const owner = Symbol('planner-editor');
  pendingEdits.set(owner, { ...target });
  return () => { pendingEdits.delete(owner); };
}
export function hasPendingPlannerEdits(planId: string) {
  for (const target of pendingEdits.values()) if (target.planId === planId) return true;
  return false;
}
