import { expect, it } from 'vitest';
import { hasPendingPlannerEdits, registerPendingPlannerEdit } from './plannerEdits';

it('keeps independent dirty editors registered until their own owners clear them', () => {
  const first = registerPendingPlannerEdit({ planId: 'plan-A', nodeId: 'same-node', field: 'notes' });
  const second = registerPendingPlannerEdit({ planId: 'plan-A', nodeId: 'same-node', field: 'notes' });
  const other = registerPendingPlannerEdit({ planId: 'plan-B', nodeId: 'same-node', field: 'name' });
  try {
    expect(hasPendingPlannerEdits('plan-A')).toBe(true);
    expect(hasPendingPlannerEdits('plan-C')).toBe(false);
    first(); first();
    expect(hasPendingPlannerEdits('plan-A')).toBe(true);
    expect(hasPendingPlannerEdits('plan-B')).toBe(true);
    second();
    expect(hasPendingPlannerEdits('plan-A')).toBe(false);
    expect(hasPendingPlannerEdits('plan-B')).toBe(true);
  } finally { first(); second(); other(); }
  expect(hasPendingPlannerEdits('plan-B')).toBe(false);
});
