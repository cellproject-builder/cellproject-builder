import { describe, expect, it } from 'vitest';
import { createCanvasInk, canvasInkSchema, positionedInk } from './canvasModel';
import { normalizeVisualWorkspace, EMPTY_VISUAL_WORKSPACE } from '@/visuals/normalize';

describe('planner ink document', () => {
  it('keeps world position separate from positive local stroke coordinates and roundtrips', () => {
    const stroke = positionedInk([{ x: -40, y: 20, pressure: .2 }, { x: 80, y: 60, pressure: .8 }], { tool: 'pen', color: '#abcdef', width: 3, opacity: .8 }, 'stroke-1');
    expect(stroke).toMatchObject({ x: -40, y: 20, points: [{ x: 0, y: 0, pressure: .2 }, { x: 120, y: 40, pressure: .8 }] });
    const ink = { ...createCanvasInk(), strokes: [stroke] };
    expect(canvasInkSchema.parse(JSON.parse(JSON.stringify(ink)))).toEqual(ink);
    expect(normalizeVisualWorkspace({ ...EMPTY_VISUAL_WORKSPACE, ink }).ink).toEqual(ink);
  });
  it('preserves legacy workspaces without adding an ink property', () => {
    expect(normalizeVisualWorkspace(EMPTY_VISUAL_WORKSPACE)).toEqual(EMPTY_VISUAL_WORKSPACE);
    expect('ink' in normalizeVisualWorkspace(EMPTY_VISUAL_WORKSPACE)).toBe(false);
  });
  it('refuses invalid and excessive strokes without silently ignoring data', () => {
    const stroke = positionedInk([{ x: 0, y: 0 }], { tool: 'pen', color: '#abcdef', width: 3, opacity: 1 }, 's');
    expect(canvasInkSchema.safeParse({ ...createCanvasInk(), strokes: [stroke, stroke] }).success).toBe(false);
    expect(() => normalizeVisualWorkspace({ ...EMPTY_VISUAL_WORKSPACE, ink: { version: 9 } })).toThrow();
    expect(canvasInkSchema.safeParse({ ...createCanvasInk(), strokes: [{ ...stroke, x: Infinity }] }).success).toBe(false);
  });
});
