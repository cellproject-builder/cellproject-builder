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
  const widthOf = (id: string): number => {
    const cached = widths.get(id);
    if (cached !== undefined) return cached;
    const kids = byParent.get(id) ?? [];
    const w =
      kids.length === 0
        ? 1
        : isLeafGridParent(byParent, id)
        ? 2
        : kids.reduce((acc, k) => acc + widthOf(k.id), 0);
    widths.set(id, w);
    return w;
  };
  const positions: Record<string, { x: number; y: number }> = {};
  const place = (id: string, depth: number, left: number) => {
    positions[id] = { x: (left + widthOf(id) / 2) * LAYOUT_X_GAP, y: depth * LAYOUT_Y_GAP };
    if (isLeafGridParent(byParent, id)) {
      const px = positions[id].x;
      (byParent.get(id) ?? []).forEach((kid, i) => {
        positions[kid.id] = {
          x: px + (i % 2 === 0 ? -LEAF_GRID_HALF : LEAF_GRID_HALF),
          y: (depth + 1) * LAYOUT_Y_GAP + Math.floor(i / 2) * LEAF_GRID_ROW,
        };
      });
      return;
    }
    let cursor = left;
    for (const kid of byParent.get(id) ?? []) {
      place(kid.id, depth + 1, cursor);
      cursor += widthOf(kid.id);
    }
  };
  place(project.rootId, 0, 0);
  const shift = positions[project.rootId]?.x ?? 0;
  for (const pos of Object.values(positions)) pos.x -= shift;
  return positions;
}
