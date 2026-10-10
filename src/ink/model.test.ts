import { describe, expect, it } from 'vitest';
import { createNoteCanvas, noteCanvasSchema } from '@/workspace/noteCanvasModel';
import { boardDocumentSchema, createBoardDocument } from '@/boards/model';

const legacy = { id: 'ink', color: '#abcdef', width: 3, points: [{ x: 5, y: 8 }, { x: 30, y: 25, pressure: .8 }] };
const drawing = { id: 'ink', kind: 'drawing' as const, color: '#abcdef', widthStroke: 3, x: -50, y: 10, width: 40, height: 30, points: legacy.points };

describe('compatible shared ink persistence', () => {
  it('round trips notebook tools and opacity without rewriting legacy strokes', () => {
    const document = { ...createNoteCanvas(), strokes: [legacy, { ...legacy, id: 'modern', tool: 'highlighter', opacity: .28 }] };
    expect(noteCanvasSchema.safeParse(document).success).toBe(true);
    expect(noteCanvasSchema.parse(document)).toEqual(document);
    expect(noteCanvasSchema.parse(document).strokes[0]).not.toHaveProperty('tool');
  });

  it('round trips board pressure and brush properties without adding defaults', () => {
    const old = { ...drawing, points: [{ x: 5, y: 8 }] };
    const document = { ...createBoardDocument(), items: [old, { ...drawing, id: 'modern', tool: 'pencil', opacity: .65 }] };
    expect(boardDocumentSchema.safeParse(document).success).toBe(true);
    expect(boardDocumentSchema.parse(document)).toEqual(document);
    expect(boardDocumentSchema.parse(document).items[0]).not.toHaveProperty('tool');
  });

  it.each([
    { tool: 'script' }, { opacity: 0 }, { opacity: 1.01 }, { opacity: NaN },
    { tool: 'pen', executable: true }, { points: [{ x: 5, y: 8, pressure: -1 }] },
    { points: [{ x: 5, y: 8, pressure: Infinity }] },
  ])('rejects invalid ink properties %j on both surfaces', patch => {
    expect(noteCanvasSchema.safeParse({ ...createNoteCanvas(), strokes: [{ ...legacy, ...patch }] }).success).toBe(false);
    expect(boardDocumentSchema.safeParse({ ...createBoardDocument(), items: [{ ...drawing, ...patch }] }).success).toBe(false);
  });
});
