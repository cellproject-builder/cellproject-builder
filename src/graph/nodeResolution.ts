import type { ConceptNodeData, Project } from '@/types';
import { childrenByParent } from './treeIndex';

/** A recorded open failure always keeps the result pending, including legacy flags. */
export const hasOpenFailure = (node: ConceptNodeData): boolean => Boolean(node.failureContext);
export const isSelfResolved = (node: ConceptNodeData): boolean =>
  !hasOpenFailure(node) && Boolean(node.confirmado || node.takenAsKnown);

/** Shared by sequencing and canvas presentation; resolve each subtree without recursion. */
export function nodeResolution(project: Project, byParent = childrenByParent(project), startIds = Object.keys(project.nodes)): ReadonlyMap<string, boolean> {
  const resolved = new Map<string, boolean>();
  for (const nodeId of startIds) {
    if (resolved.has(nodeId)) continue;
    const active = new Set<string>(), stack = [{ id: nodeId, exiting: false }];
    while (stack.length) {
      const frame = stack.pop()!, current = project.nodes[frame.id];
      if (frame.exiting) {
        active.delete(frame.id);
        if (!resolved.has(frame.id)) resolved.set(frame.id, (byParent.get(frame.id) ?? []).every(child => resolved.get(child.id) === true));
        continue;
      }
      if (resolved.has(frame.id)) continue;
      if (!current || hasOpenFailure(current)) { resolved.set(frame.id, false); continue; }
      if (current.takenAsKnown) { resolved.set(frame.id, true); continue; }
      if (active.has(frame.id)) { resolved.set(frame.id, false); continue; }
      const kids = byParent.get(frame.id) ?? [];
      if (!kids.length) { resolved.set(frame.id, isSelfResolved(current)); continue; }
      active.add(frame.id); stack.push({ id: frame.id, exiting: true });
      for (let index = kids.length - 1; index >= 0; index--) stack.push({ id: kids[index].id, exiting: false });
    }
  }
  return resolved;
}
