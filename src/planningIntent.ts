import type { PlanningIntent } from './types';

/** Optional metadata; a human reference description never verifies the source. */
export function normalizePlanningIntent(raw: unknown): PlanningIntent {
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    planApproach: input.planApproach === 'reverse_engineering' || input.planApproach === 'new_creation' ? input.planApproach : undefined,
    referenceTarget: typeof input.referenceTarget === 'string' && input.referenceTarget.length <= 2000 ? input.referenceTarget.trim() || undefined : undefined,
  };
}
