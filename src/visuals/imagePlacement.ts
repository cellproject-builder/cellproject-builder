import type { ReferenceDragAnchor } from './drag';

/** Places the grabbed point of the visible (contained) image under the flow cursor. */
export function anchoredImagePosition(
  point: { x: number; y: number },
  frame: { width: number; height: number },
  natural?: { width: number | null; height: number | null },
  anchor: ReferenceDragAnchor = { x: .5, y: .5 },
) {
  const x = Number.isFinite(anchor.x) ? Math.max(0, Math.min(1, anchor.x)) : .5;
  const y = Number.isFinite(anchor.y) ? Math.max(0, Math.min(1, anchor.y)) : .5;
  const aspect = natural?.width && natural?.height && Number.isFinite(natural.width) && Number.isFinite(natural.height) && natural.width > 0 && natural.height > 0
    ? natural.width / natural.height : frame.width / frame.height;
  const width = Math.min(frame.width, frame.height * aspect);
  const height = width / aspect;
  return {
    x: point.x - (frame.width - width) / 2 - width * x,
    y: point.y - (frame.height - height) / 2 - height * y,
  };
}
