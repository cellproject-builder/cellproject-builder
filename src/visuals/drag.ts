import type { ImageReference } from './types';
import { containedImageRect, type Rect } from './rendering/geometry';

export const REFERENCE_DRAG_TYPE = 'application/x-cellproject-reference';
export interface ReferenceDragAnchor { x: number; y: number }
export interface ReferenceDragPayload {
  projectId: string;
  reference: ImageReference;
  /** Normalized point within the visible image, excluding thumbnail letterboxing. */
  anchor?: ReferenceDragAnchor;
}

const center: ReferenceDragAnchor = { x: .5, y: .5 };
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function imageDragAnchor(rect: Rect, imageWidth: number, imageHeight: number, point: { x: number; y: number }): ReferenceDragAnchor {
  if (![rect.x, rect.y, rect.width, rect.height, imageWidth, imageHeight, point.x, point.y].every(Number.isFinite)
    || rect.width <= 0 || rect.height <= 0 || imageWidth <= 0 || imageHeight <= 0) return { ...center };
  const content = containedImageRect(rect, imageWidth, imageHeight);
  return { x: clamp((point.x - content.x) / content.width), y: clamp((point.y - content.y) / content.height) };
}

/** Uses already loaded pixels: dragging never requests another copy of the source. */
export function createImageDragPreview(image: HTMLImageElement, anchor: ReferenceDragAnchor): {
  element: HTMLCanvasElement; offsetX: number; offsetY: number; dispose: () => void;
} | null {
  if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return null;
  const rect = image.getBoundingClientRect();
  const scale = Math.min(1, 160 / image.naturalWidth, 160 / image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  try {
    const context = canvas.getContext('2d');
    if (!context) return null;
    const radius = Number.parseFloat(getComputedStyle(image).getPropertyValue('--ws-radius-panel')) || 12;
    context.beginPath();
    context.roundRect(0, 0, canvas.width, canvas.height, Math.min(radius, canvas.width / 2, canvas.height / 2));
    context.clip();
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  } catch { return null; }
  canvas.className = 'visual-reference-drag-preview';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${canvas.width}px`, height: `${canvas.height}px`, pointerEvents: 'none', zIndex: '2147483647' });
  document.body.append(canvas);
  let frame: number | null = null;
  const dispose = () => { if (frame !== null) cancelAnimationFrame(frame); frame = null; canvas.remove(); };
  // The browser snapshots the drag bitmap synchronously during dragstart.
  frame = requestAnimationFrame(dispose);
  return { element: canvas, offsetX: Math.round(canvas.width * clamp(anchor.x)), offsetY: Math.round(canvas.height * clamp(anchor.y)), dispose };
}
