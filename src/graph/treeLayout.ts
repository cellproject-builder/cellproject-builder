import type { ConceptNodeData, Project } from '@/types';
import { childrenByParent } from './treeIndex';

// Persisted initial layout; adaptive viewport layout remains in autoLayout.ts.
export const LAYOUT_X_GAP = 340;
export const LAYOUT_Y_GAP = 300;
const LEAF_GRID_MIN = 4;
const LEAF_GRID_HALF = 190;
export const LEAF_GRID_ROW = 280;

export const isLeafGridParent = (byParent: Map<string, ConceptNodeData[]>, id: string): boolean => {
  const kids = byParent.get(id) ?? [];
  return kids.length >= LEAF_GRID_MIN && kids.every((k) => (byParent.get(k.id) ?? []).length === 0);
};

export function computeTreeLayout(project: Project): Record<string, { x: number; y: number }> {
  const byParent = childrenByParent(project);
  const widths = new Map<string, number>();
  const active = new Set<string>();
  const widthStack = [{ id: project.rootId, exiting: false }];
  while (widthStack.length > 0) {
    const { id, exiting } = widthStack.pop()!;
    if (widths.has(id)) continue;
    const kids = byParent.get(id) ?? [];
    if (exiting) {
      widths.set(id, kids.reduce((sum, kid) => sum + widths.get(kid.id)!, 0));
      active.delete(id);
      continue;
    }
    if (active.has(id)) throw new Error('Árvore de decomposição inválida: ciclo detectado.');
    if (kids.length === 0 || isLeafGridParent(byParent, id)) {
      widths.set(id, kids.length === 0 ? 1 : 2);
      continue;
    }
    active.add(id);
    widthStack.push({ id, exiting: true });
    for (let i = kids.length - 1; i >= 0; i--) {
      widthStack.push({ id: kids[i].id, exiting: false });
    }
  }
  const positions: Record<string, { x: number; y: number }> = {};
  const placementStack = [{ id: project.rootId, depth: 0, left: 0 }];
  while (placementStack.length > 0) {
    const { id, depth, left } = placementStack.pop()!;
    positions[id] = { x: (left + widths.get(id)! / 2) * LAYOUT_X_GAP, y: depth * LAYOUT_Y_GAP };
    if (isLeafGridParent(byParent, id)) {
      const px = positions[id].x;
      (byParent.get(id) ?? []).forEach((kid, i) => {
        positions[kid.id] = {
          x: px + (i % 2 === 0 ? -LEAF_GRID_HALF : LEAF_GRID_HALF),
          y: (depth + 1) * LAYOUT_Y_GAP + Math.floor(i / 2) * LEAF_GRID_ROW,
        };
      });
      continue;
    }
    // Push in reverse so the explicit stack keeps the original sibling order.
    const kids = byParent.get(id) ?? [];
    let cursor = left + widths.get(id)!;
    for (let i = kids.length - 1; i >= 0; i--) {
      const kid = kids[i];
      cursor -= widths.get(kid.id)!;
      placementStack.push({ id: kid.id, depth: depth + 1, left: cursor });
    }
  }
  const shift = positions[project.rootId]?.x ?? 0;
  for (const pos of Object.values(positions)) pos.x -= shift;
  return positions;
}
