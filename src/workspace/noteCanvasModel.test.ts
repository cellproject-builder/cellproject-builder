import { describe, expect, it } from 'vitest';
import { torqueDiagram } from '@/visuals/diagram/fixture';
import { createNoteCanvas, noteCanvasSchema } from './noteCanvasModel';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1EAAAAASUVORK5CYII=';
const image = { id: 'image-1', kind: 'image' as const, x: 10, y: 10, width: 100, height: 100, src: png, label: 'Referência' };
describe('note canvas document', () => {
  it('creates an independent empty notebook with logical coordinates', () => {
    const one = createNoteCanvas(), two = createNoteCanvas();
    expect(noteCanvasSchema.parse(one)).toEqual({ version: 1, width: 1200, height: 900, paper: 'plain', strokes: [], items: [] });
    expect(one.items).not.toBe(two.items);
  });
  it('accepts raster images, text, pressure strokes and validated interactive diagrams', () => {
    const doc = createNoteCanvas();
    doc.items = [image, { id: 'text-1', kind: 'text', x: 200, y: 20, width: 240, height: 60, text: 'Esboço', color: '#eeeeee', fontSize: 20 }, { id: 'diagram-1', kind: 'diagram', x: 30, y: 250, width: 600, height: 450, diagram: torqueDiagram(), values: { mass: .3 } }];
    doc.strokes = [{ id: 'stroke-1', color: '#eeeeee', width: 2, points: [{ x: 1, y: 2, pressure: .6 }, { x: 10, y: 11 }] }];
    expect(noteCanvasSchema.safeParse(doc).success).toBe(true);
  });
  it('rejects active images, external URLs, mismatched raster signatures and extra properties', () => {
    for (const src of ['javascript:alert(1)', 'https://example.com/picture.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg;base64,iVBORw0KGgo=']) {
      expect(noteCanvasSchema.safeParse({ ...createNoteCanvas(), items: [{ ...image, src }] }).success).toBe(false);
    }
    expect(noteCanvasSchema.safeParse({ ...createNoteCanvas(), items: [{ ...image, onload: 'alert(1)' }] }).success).toBe(false);
  });
  it('rejects duplicate IDs across strokes and items and off-page geometry', () => {
    const stroke = { id: image.id, color: '#eeeeee', width: 2, points: [{ x: 1, y: 2 }] };
    expect(noteCanvasSchema.safeParse({ ...createNoteCanvas(), items: [image], strokes: [stroke] }).success).toBe(false);
    expect(noteCanvasSchema.safeParse({ ...createNoteCanvas(), items: [{ ...image, x: 1190 }] }).success).toBe(false);
    expect(noteCanvasSchema.safeParse({ ...createNoteCanvas(), strokes: [{ ...stroke, points: [{ x: Infinity, y: 2 }] }] }).success).toBe(false);
  });
  it('rejects diagram overrides outside declared parameters and malformed diagrams', () => {
    const item = { id: 'diagram-1', kind: 'diagram', x: 0, y: 0, width: 600, height: 400, diagram: torqueDiagram(), values: { mass: 200 } };
    expect(noteCanvasSchema.safeParse({ ...createNoteCanvas(), items: [item] }).success).toBe(false);
    expect(noteCanvasSchema.safeParse({ ...createNoteCanvas(), items: [{ ...item, values: { undeclared: 1 } }] }).success).toBe(false);
  });
});
