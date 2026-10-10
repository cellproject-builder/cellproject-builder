import type { ConceptNodeData, Project } from '@/types';

export type Orientation = 'horizontal' | 'vertical';
export type GraphLayoutMode = 'auto' | Orientation | 'manual';
export interface NodeDimensions { width: number; height: number }
export type LayoutPositions = Record<string, { x: number; y: number }>;
export type LayoutDimensions = Readonly<Record<string, Partial<NodeDimensions> | undefined>>;

export const DEFAULT_NODE_DIMENSIONS: Readonly<NodeDimensions> = { width: 300, height: 160 };
const MAIN_GAP = 80;
const CROSS_GAP = 44;
const ORIENTATION_HYSTERESIS = 0.08;
const LEAF_GRID_MIN = 4;

/** Hidden/unfinished measurements keep the last orientation. Around a square
 * canvas, an 8% band prevents panels and scrollbars from flipping the layout. */
export function resolveOrientation(width: number, height: number, current?: Orientation): Orientation {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return current ?? 'vertical';
  const ratio = width / height;
  if (current === 'horizontal') return ratio < 1 - ORIENTATION_HYSTERESIS ? 'vertical' : current;
  if (current === 'vertical') return ratio > 1 + ORIENTATION_HYSTERESIS ? 'horizontal' : current;
  return width > height ? 'horizontal' : 'vertical';
}

interface Subtree {
  span: number;
  children: ConceptNodeData[];
  lanes?: [number, number];
}

/** Presentation-only tidy tree. Sibling slots use cross-axis card dimensions;
 * complete layers use the largest main-axis dimension at that depth. Groups of
 * four or more leaf siblings use two lanes to keep wide plans readable.
 * Measurements may enlarge the standard card envelope, never shrink it.
 * Invalid parents and disconnected cycles are attached to a known anchor only
 * for presentation. Neither saved positions nor project fields are modified. */
export function computeAdaptiveTreeLayout(project: Project, orientation: Orientation, dimensions: LayoutDimensions = {}): LayoutPositions {
  const compare = (a: ConceptNodeData, b: ConceptNodeData) => a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const nodes = Object.values(project.nodes).sort(compare);
  const anchor = project.nodes[project.rootId] ?? nodes.find((node) => node.kind === 'root') ?? nodes[0];
  if (!anchor) return {};
  const vertical = orientation === 'vertical';
  const rawChildren = new Map<string, ConceptNodeData[]>();
  for (const node of nodes) {
    if (node.id === anchor.id) continue;
    const parentId = node.parentId && project.nodes[node.parentId] ? node.parentId : anchor.id;
    const siblings = rawChildren.get(parentId) ?? [];
    siblings.push(node);
    rawChildren.set(parentId, siblings);
  }
  const childrenByParent = new Map<string, ConceptNodeData[]>();
  const preorder: ConceptNodeData[] = [];
  const seen = new Set<string>();
  const visit = (node: ConceptNodeData, parentId?: string) => {
    const pending = [{ node, parentId }];
    while (pending.length) {
      const current = pending.pop()!;
      if (seen.has(current.node.id)) continue;
      seen.add(current.node.id);
      preorder.push(current.node);
      if (current.parentId) {
        const siblings = childrenByParent.get(current.parentId) ?? [];
        siblings.push(current.node);
        childrenByParent.set(current.parentId, siblings);
      }
      const children = rawChildren.get(current.node.id) ?? [];
      for (let i = children.length - 1; i >= 0; i--) pending.push({ node: children[i], parentId: current.node.id });
    }
  };
  visit(anchor);
  for (const node of nodes) {
    if (!seen.has(node.id)) visit(node, anchor.id);
  }
  for (const siblings of childrenByParent.values()) siblings.sort(compare);

  const sizeOf = (id: string, axis: keyof NodeDimensions) => {
    const measured = dimensions[id]?.[axis];
    return typeof measured === 'number' && Number.isFinite(measured) && measured > 0
      ? Math.max(DEFAULT_NODE_DIMENSIONS[axis], measured)
      : DEFAULT_NODE_DIMENSIONS[axis];
  };
  const crossSize = (id: string) => sizeOf(id, vertical ? 'width' : 'height');
  const mainSize = (id: string) => sizeOf(id, vertical ? 'height' : 'width');
  const subtrees = new Map<string, Subtree>();
  for (let index = preorder.length - 1; index >= 0; index--) {
    const id = preorder[index].id;
    const children = childrenByParent.get(id) ?? [];
    const childSpans = children.map((child) => subtrees.get(child.id)!.span);
    const grid = children.length >= LEAF_GRID_MIN && children.every((child) => !childrenByParent.get(child.id)?.length);
    let contentSpan = childSpans.reduce((sum, span) => sum + span, 0) + Math.max(0, children.length - 1) * CROSS_GAP;
    let lanes: [number, number] | undefined;
    if (grid) {
      lanes = [0, 0];
      childSpans.forEach((span, i) => { const lane = i % 2; lanes![lane] = Math.max(lanes![lane], span); });
      contentSpan = lanes[0] + CROSS_GAP + lanes[1];
    }
    const subtree = { span: Math.max(crossSize(id), contentSpan), children, lanes };
    subtrees.set(id, subtree);
  }

  const slots = new Map<string, { cross: number; layer: number }>();
  const layerSizes: number[] = [];
  const pendingSlots = [{ id: anchor.id, layer: 0, left: 0 }];
  while (pendingSlots.length) {
    const { id, layer, left } = pendingSlots.pop()!;
    const subtree = subtrees.get(id)!;
    slots.set(id, { cross: left + (subtree.span - crossSize(id)) / 2, layer });
    layerSizes[layer] = Math.max(layerSizes[layer] ?? 0, mainSize(id));
    const childSlots: typeof pendingSlots = [];
    if (subtree.lanes) {
      const [first, second] = subtree.lanes;
      const start = left + (subtree.span - first - second - CROSS_GAP) / 2;
      subtree.children.forEach((child, i) => {
        const lane = i % 2;
        const laneStart = start + (lane ? first + CROSS_GAP : 0);
        childSlots.push({ id: child.id, layer: layer + 1 + Math.floor(i / 2), left: laneStart + (subtree.lanes![lane] - crossSize(child.id)) / 2 });
      });
    } else {
      const contentSpan = subtree.children.reduce((sum, child) => sum + subtrees.get(child.id)!.span, 0) + Math.max(0, subtree.children.length - 1) * CROSS_GAP;
      let cursor = left + (subtree.span - contentSpan) / 2;
      for (const child of subtree.children) {
        childSlots.push({ id: child.id, layer: layer + 1, left: cursor });
        cursor += subtrees.get(child.id)!.span + CROSS_GAP;
      }
    }
    for (let i = childSlots.length - 1; i >= 0; i--) pendingSlots.push(childSlots[i]);
  }

  const layerStarts = [0];
  for (let i = 1; i < layerSizes.length; i++) layerStarts[i] = layerStarts[i - 1] + layerSizes[i - 1] + MAIN_GAP;
  const rootCross = slots.get(anchor.id)!.cross;
  const positions: LayoutPositions = {};
  for (const [id, slot] of slots) {
    const cross = slot.cross - rootCross, main = layerStarts[slot.layer];
    positions[id] = vertical ? { x: cross, y: main } : { x: main, y: cross };
  }
  return positions;
}
