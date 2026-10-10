import { BaseEdge, useStore, type EdgeProps, type InternalNode } from '@xyflow/react';

type Point = { x: number; y: number };

function bounds(node: InternalNode) {
  const width = Math.max(1, node.measured.width ?? node.width ?? 1);
  const height = Math.max(1, node.measured.height ?? node.height ?? 1);
  return { ...node.internals.positionAbsolute, width, height };
}

type Bounds = ReturnType<typeof bounds>;
const center = (rect: Bounds): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
const contains = (rect: Bounds, point: Point) =>
  point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;

// References can approach either object from any side, independently of its handles.
function boundary(rect: Bounds, toward: Point) {
  const origin = center(rect);
  const dx = toward.x - origin.x, dy = toward.y - origin.y;
  const ratio = Math.max(Math.abs(dx) / (rect.width / 2), Math.abs(dy) / (rect.height / 2));
  return ratio > 0 ? { x: origin.x + dx / ratio, y: origin.y + dy / ratio } : origin;
}

export function VisualLinkEdge({ id, source, target, style }: EdgeProps) {
  const sourceNode = useStore(state => state.nodeLookup.get(source));
  const targetNode = useStore(state => state.nodeLookup.get(target));
  if (!sourceNode || !targetNode) return null;
  const sourceBounds = bounds(sourceNode), targetBounds = bounds(targetNode);
  if (sourceBounds.x <= targetBounds.x + targetBounds.width && targetBounds.x <= sourceBounds.x + sourceBounds.width
    && sourceBounds.y <= targetBounds.y + targetBounds.height && targetBounds.y <= sourceBounds.y + sourceBounds.height) return null;

  const start = boundary(sourceBounds, center(targetBounds));
  const end = boundary(targetBounds, center(sourceBounds));
  const dx = end.x - start.x, dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return null;
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const bend = Math.min(72, distance * .18);
  let control = { x: midpoint.x - dy / distance * bend, y: midpoint.y + dx / distance * bend };
  // Keep the curve's tangents outside large cards, even when objects are close.
  if (contains(sourceBounds, control) || contains(targetBounds, control)) control = midpoint;
  const from = boundary(sourceBounds, control), to = boundary(targetBounds, control);
  return <BaseEdge id={id} path={`M ${from.x},${from.y} Q ${control.x},${control.y} ${to.x},${to.y}`} style={style} interactionWidth={0} />;
}
