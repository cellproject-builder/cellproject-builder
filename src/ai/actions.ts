// Actual in-flight calls live outside the graph store so graph resets cannot
// release another project's context while an old callback is still running.
const activeActions = new Set<symbol>();
export function registerAIAction(): () => void {
  const id = Symbol('ai-action');
  activeActions.add(id);
  return () => { activeActions.delete(id); };
}
export const hasActiveAIActions = () => activeActions.size > 0;
