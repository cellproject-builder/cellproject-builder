import { describe, expect, it } from 'vitest';
import { inkGeometry, inkStrokeIntersectsPolygon, inkStrokeNearPath, nearInkStroke, pointInPolygon, sampleInkPoint } from './geometry';
import { createInkSettings, type InkStrokeData } from './model';

const stroke: InkStrokeData = { color: '#abcdef', width: 6, points: [{ x: 10, y: 20, pressure: .1 }, { x: 50, y: 20, pressure: .9 }] };

describe('shared vector ink', () => {
  it('hit tests the whole swept eraser path between sparse and bent samples', () => {
    const line = { ...stroke, points: [{ x: 50, y: 10 }, { x: 50, y: 30 }] };
    expect(inkStrokeNearPath(line, [{ x: 0, y: 20 }, { x: 100, y: 20 }], 0)).toBe(true);
    expect(inkStrokeNearPath(line, [{ x: 0, y: 20 }, { x: 100, y: 20 }, { x: 0, y: 80 }], 0)).toBe(true);
    expect(inkStrokeNearPath(line, [{ x: 0, y: 40 }, { x: 100, y: 40 }], 0)).toBe(false);
    expect(inkStrokeNearPath(line, [], 2)).toBe(false);
    expect(inkStrokeNearPath({ ...line, points: [] }, [{ x: 0, y: 20 }], 2)).toBe(false);
  });

  it('uses the visible brush width, pressure and legacy mode along a swept path', () => {
    const line = { ...stroke, width: 10, points: [{ x: 10, y: 20, pressure: 0 }, { x: 50, y: 20, pressure: 0 }] };
    const path = [{ x: 20, y: 24 }, { x: 40, y: 24 }];
    expect(inkStrokeNearPath(line, path, 0, 'note')).toBe(false);
    expect(inkStrokeNearPath(line, path, 0, 'board')).toBe(true);
    expect(inkStrokeNearPath({ ...line, tool: 'pen' }, path, 0)).toBe(false);
    expect(inkStrokeNearPath({ ...line, tool: 'highlighter' }, path, 0)).toBe(true);
    expect(inkStrokeNearPath({ ...line, points: [{ x: 30, y: 20 }] }, [{ x: 0, y: 20 }, { x: 100, y: 20 }], 0)).toBe(true);
  });
  it('handles a maximum-sized stroke without mutating its points or the eraser samples', () => {
    const points = Array.from({ length: 4096 }, (_, x) => Object.freeze({ x, y: 20 }));
    const path = [Object.freeze({ x: 4095, y: 0 }), Object.freeze({ x: 4095, y: 40 })];
    Object.freeze(points); Object.freeze(path);
    expect(inkStrokeNearPath({ ...stroke, points }, path, 0)).toBe(true);
    expect(points).toHaveLength(4096);
    expect(path).toHaveLength(2);
  });
  it('retains exact legacy paths and notebook pressure averages', () => {
    expect(inkGeometry(stroke, 'note')).toMatchObject({ d: 'M10,20 L50,20', strokeWidth: 5.4, fill: 'none', opacity: 1 });
    expect(inkGeometry(stroke, 'board')).toMatchObject({ d: 'M10,20 L50,20', strokeWidth: 6, fill: 'none' });
  });

  it('changes pen geometry with local pressure and keeps monoline width constant', () => {
    const even = { ...stroke, points: stroke.points.map(point => ({ ...point, pressure: .5 })) };
    expect(inkGeometry({ ...stroke, tool: 'pen' }).d).not.toEqual(inkGeometry({ ...even, tool: 'pen' }).d);
    expect(inkGeometry({ ...stroke, tool: 'monoline' })).toEqual(inkGeometry({ ...even, tool: 'monoline' }));
    expect(inkGeometry({ ...stroke, tool: 'pen' }).fill).toBe(stroke.color);
  });

  it('uses an oblique fountain nib whose width changes with stroke direction and pressure', () => {
    const base = { color: '#abcdef', width: 10, tool: 'fountain' as const };
    const thin = inkGeometry({ ...base, points: [{ x: 10, y: 10, pressure: .5 }, { x: 50, y: 50, pressure: .5 }] });
    const broad = inkGeometry({ ...base, points: [{ x: 50, y: 10, pressure: .5 }, { x: 10, y: 50, pressure: .5 }] });
    // Fixed 45° nib has a 1.6-unit minor radius and a 7.5-unit major radius here.
    expect(thin.d).toMatch(/^M8\.869,11\.131/);
    expect(broad.d).toMatch(/^M44\.697,4\.697/);
    expect(thin.d).toContain('A7.5,1.6 45');
    expect(inkGeometry({ ...base, points: [{ x: 10, y: 10, pressure: .9 }, { x: 50, y: 50, pressure: .9 }] }).d).not.toBe(thin.d);
  });

  it('smooths a changing line and uses a single translucent highlighter shape', () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 30, y: 5 }];
    expect(inkGeometry({ ...stroke, points, tool: 'monoline' }).d).toContain('Q');
    expect(inkGeometry({ ...stroke, points, tool: 'highlighter', opacity: .3 })).toMatchObject({ fill: stroke.color, stroke: 'none', opacity: .3 });
    expect(inkGeometry({ ...stroke, tool: 'pencil' }).opacity).toBeLessThan(1);
  });

  it.each(['pen', 'monoline', 'pencil', 'highlighter', 'fountain'] as const)('renders single-point %s marks without nonfinite geometry', tool => {
    const geometry = inkGeometry({ ...stroke, tool, points: [{ x: 20, y: 30, pressure: 0 }] });
    expect(geometry.d.length).toBeGreaterThan(0);
    expect(geometry.d).not.toMatch(/NaN|Infinity/);
  });

  it('hit tests segments between distant samples including pressure width', () => {
    expect(nearInkStroke(stroke, { x: 30, y: 20 }, 0, 'board')).toBe(true);
    expect(nearInkStroke(stroke, { x: 30, y: 30 }, 2, 'board')).toBe(false);
    expect(nearInkStroke({ ...stroke, tool: 'pen' }, { x: 49, y: 24 }, 0)).toBe(true);
    expect(nearInkStroke({ ...stroke, points: [{ x: 10, y: 20 }] }, { x: 10, y: 22 }, 0)).toBe(true);
  });

  it('tests lasso interior and boundary consistently', () => {
    const polygon = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    expect(pointInPolygon({ x: 50, y: 50 }, polygon)).toBe(true);
    expect(pointInPolygon({ x: 0, y: 50 }, polygon)).toBe(true);
    expect(pointInPolygon({ x: 120, y: 50 }, polygon)).toBe(false);
    expect(pointInPolygon({ x: 0, y: 0 }, [])).toBe(false);
  });

  it('selects sparse strokes that cross a lasso or touch it with their visible width', () => {
    const polygon = [{ x: 40, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 30 }, { x: 40, y: 30 }];
    expect(inkStrokeIntersectsPolygon({ ...stroke, points: [{ x: 0, y: 20 }, { x: 100, y: 20 }] }, polygon)).toBe(true);
    expect(inkStrokeIntersectsPolygon({ ...stroke, points: [{ x: 0, y: 8 }, { x: 100, y: 8 }] }, polygon)).toBe(true);
    expect(inkStrokeIntersectsPolygon({ ...stroke, points: [{ x: 0, y: 2 }, { x: 100, y: 2 }] }, polygon)).toBe(false);
    expect(inkStrokeIntersectsPolygon(stroke, [])).toBe(false);
  });

  it('captures pen pressure with safe mouse and touch fallbacks', () => {
    expect(sampleInkPoint({ x: 2, y: 3, pressure: .8, pointerType: 'pen' })).toEqual({ x: 2, y: 3, pressure: .8 });
    expect(sampleInkPoint({ x: 2, y: 3, pressure: 2, pointerType: 'pen' }).pressure).toBe(1);
    expect(sampleInkPoint({ x: 2, y: 3, pressure: 0, pointerType: 'mouse' })).toEqual({ x: 2, y: 3 });
    expect(sampleInkPoint({ x: 2, y: 3, pressure: NaN, pointerType: 'pen' })).toEqual({ x: 2, y: 3 });
  });

  it('creates independent tool defaults with a broad translucent highlighter', () => {
    const pen = createInkSettings(), marker = createInkSettings('highlighter');
    expect(pen).toMatchObject({ tool: 'pen', opacity: 1 });
    expect(marker.width).toBeGreaterThan(pen.width);
    expect(marker.opacity).toBeLessThan(pen.opacity);
    pen.width = 12;
    expect(createInkSettings().width).not.toBe(12);
  });
});
