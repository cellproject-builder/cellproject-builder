import { canConcludeNode, isActionableKind } from '@/store';
import type { Project } from '@/types';
import { childrenByParent } from './treeIndex';

export interface NodePresentation { childCount: number; edgeCount: number; blocked: boolean; stepNo: number | null; canConclude: boolean }

const cached = new WeakMap<Project['nodes'], WeakMap<Project['edges'], ReadonlyMap<string, NodePresentation>>>();

/** Canvas metadata depends on immutable node/edge records, not drafts, viewport or selection. */
export function nodePresentation(project: Project): ReadonlyMap<string, NodePresentation> {
  const previous = cached.get(project.nodes)?.get(project.edges);
  if (previous) return previous;
  const nodes = Object.values(project.nodes), children = childrenByParent(project), resolved = new Map<string, boolean>();
  // Resolve each subtree once. The iterative walk also keeps deep imported plans
  // safe, and a cycle stays unresolved unless a taken-as-known node cuts it.
  for (const node of nodes) {
    if (resolved.has(node.id)) continue;
    const active = new Set<string>(), stack = [{ id: node.id, exiting: false }];
    while (stack.length) {
      const frame = stack.pop()!, current = project.nodes[frame.id];
      if (frame.exiting) {
        active.delete(frame.id);
        if (!resolved.has(frame.id)) resolved.set(frame.id, (children.get(frame.id) ?? []).every(child => resolved.get(child.id) === true));
        continue;
      }
      if (resolved.has(frame.id)) continue;
      if (!current) { resolved.set(frame.id, false); continue; }
      if (current.takenAsKnown) { resolved.set(frame.id, true); continue; }
      if (active.has(frame.id)) { resolved.set(frame.id, false); continue; }
      const kids = children.get(frame.id) ?? [];
      if (!kids.length) { resolved.set(frame.id, current.confirmado); continue; }
      active.add(frame.id); stack.push({ id: frame.id, exiting: true });
      for (let index = kids.length - 1; index >= 0; index--) stack.push({ id: kids[index].id, exiting: false });
    }
  }
  const steps = new Map<string, { blocked: boolean; stepNo: number }>();
  for (const siblings of children.values()) {
    const ordered = siblings.filter(node => node.kind === 'passo').sort((a, b) => a.order - b.order || (a.history[0]?.timestamp ?? 0) - (b.history[0]?.timestamp ?? 0) || a.name.localeCompare(b.name));
    let blocked = false;
    ordered.forEach((node, index) => {
      steps.set(node.id, { blocked, stepNo: index + 1 });
      if (!resolved.get(node.id)) blocked = true;
    });
  }
  const edgeCounts = new Map<string, number>();
  for (const edge of Object.values(project.edges)) {
    edgeCounts.set(edge.source, (edgeCounts.get(edge.source) ?? 0) + 1);
    edgeCounts.set(edge.target, (edgeCounts.get(edge.target) ?? 0) + 1);
  }
  const result = new Map(nodes.map(node => {
    const childCount = children.get(node.id)?.length ?? 0, step = steps.get(node.id), blocked = step?.blocked ?? false;
    return [node.id, { childCount, edgeCount: edgeCounts.get(node.id) ?? 0, blocked, stepNo: step?.stepNo ?? null,
      canConclude: isActionableKind(node.kind) && !childCount && !node.confirmado && canConcludeNode(project, node.id, blocked).ready }];
  }));
  let byEdges = cached.get(project.nodes);
  if (!byEdges) { byEdges = new WeakMap(); cached.set(project.nodes, byEdges); }
  byEdges.set(project.edges, result);
  return result;
}
