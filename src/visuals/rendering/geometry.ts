export interface Rect { x: number; y: number; width: number; height: number }

export function artifactScreenRect(rect: Rect, viewport: { x: number; y: number; zoom: number }): Rect {
  return { x: rect.x * viewport.zoom + viewport.x, y: rect.y * viewport.zoom + viewport.y,
    width: rect.width * viewport.zoom, height: rect.height * viewport.zoom };
}

export function containedImageRect(rect: Rect, width: number, height: number): Rect {
  const scale = Math.min(rect.width / width, rect.height / height);
  const w = width * scale, h = height * scale;
  return { x: rect.x + (rect.width - w) / 2, y: rect.y + (rect.height - h) / 2, width: w, height: h };
}

export function viewportPass(rect: Rect, width: number, height: number): { viewport: Rect; scissor: Rect } | null {
  const left = Math.max(0, rect.x), right = Math.min(width, rect.x + rect.width);
  const top = Math.max(0, rect.y), bottom = Math.min(height, rect.y + rect.height);
  if (right <= left || bottom <= top) return null;
  return { viewport: { ...rect, y: height - rect.y - rect.height },
    scissor: { x: left, y: height - bottom, width: right - left, height: bottom - top } };
}
