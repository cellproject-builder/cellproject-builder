import { describe, expect, it } from 'vitest';
import { artifactScreenRect, containedImageRect, viewportPass } from './geometry';

describe('visual compositor coordinates', () => {
  it('uses current canvas pan/zoom in CSS pixels without applying device scale', () => {
    expect(artifactScreenRect({ x: 100, y: -20, width: 240, height: 160 }, { x: 30, y: 40, zoom: .5 }))
      .toEqual({ x: 80, y: 30, width: 120, height: 80 });
  });
  it('clips an offscreen artifact without stretching its camera viewport', () => {
    expect(viewportPass({ x: -20, y: 10, width: 100, height: 60 }, 200, 120))
      .toEqual({ viewport: { x: -20, y: 50, width: 100, height: 60 }, scissor: { x: 0, y: 50, width: 80, height: 60 } });
    expect(viewportPass({ x: 250, y: 10, width: 30, height: 30 }, 200, 120)).toBeNull();
  });
  it('contains images while preserving their aspect ratio', () => {
    expect(containedImageRect({ x: 0, y: 0, width: 200, height: 200 }, 400, 200))
      .toEqual({ x: 0, y: 50, width: 200, height: 100 });
  });
});
