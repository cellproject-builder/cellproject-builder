import { afterEach, describe, expect, it, vi } from 'vitest';
import { createImageDragPreview, imageDragAnchor } from './drag';

afterEach(() => { vi.restoreAllMocks(); document.querySelectorAll('.visual-reference-drag-preview').forEach(element => element.remove()); });

describe('image reference drag geometry', () => {
  it('keeps the picked point within contained image pixels rather than thumbnail letterboxing', () => {
    const rect = { x: 10, y: 20, width: 120, height: 88 };
    expect(imageDragAnchor(rect, 400, 200, { x: 40, y: 64 })).toEqual({ x: .25, y: .5 });
    expect(imageDragAnchor(rect, 200, 400, { x: 70, y: 42 })).toEqual({ x: .5, y: .25 });
  });

  it('clamps letterbox clicks and uses a stable center if the image has not loaded', () => {
    const rect = { x: 10, y: 20, width: 120, height: 88 };
    expect(imageDragAnchor(rect, 400, 200, { x: -10, y: 5 })).toEqual({ x: 0, y: 0 });
    expect(imageDragAnchor(rect, 400, 200, { x: 400, y: 400 })).toEqual({ x: 1, y: 1 });
    expect(imageDragAnchor(rect, 0, 0, { x: 40, y: 40 })).toEqual({ x: .5, y: .5 });
    expect(imageDragAnchor(rect, 400, 200, { x: Number.NaN, y: 40 })).toEqual({ x: .5, y: .5 });
  });

  it('draws a bounded image-only bitmap from loaded pixels and removes its temporary element', () => {
    const image = document.createElement('img');
    Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 2400 }, naturalHeight: { value: 1200 } });
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage, beginPath: vi.fn(), roundRect: vi.fn(), clip: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 7);
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const preview = createImageDragPreview(image, { x: .25, y: .75 })!;
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 160, 80);
    expect(preview.offsetX).toBe(40); expect(preview.offsetY).toBe(60);
    expect(preview.element.isConnected).toBe(true);
    expect(preview.element.getAttribute('aria-hidden')).toBe('true');
    preview.dispose(); preview.dispose();
    expect(cancel).toHaveBeenCalledOnce();
    expect(preview.element.isConnected).toBe(false);
  });

  it('does not request or draw unavailable image pixels', () => {
    const image = document.createElement('img');
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    expect(createImageDragPreview(image, { x: .5, y: .5 })).toBeNull();
    expect(context).not.toHaveBeenCalled();
  });
});
