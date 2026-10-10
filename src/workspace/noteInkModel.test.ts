import { describe, expect, it } from 'vitest';
import { createNoteInk, noteInkSchema } from './noteInkModel';
import { validatePersistedNoteCanvases } from './noteCanvasPersistence';

const stroke = { id: 'ink-1', tool: 'highlighter' as const, color: '#ffee99', width: 18, opacity: .28, points: [{ x: 20, y: 30, pressure: .7 }, { x: 80, y: 50 }], anchor: { id: 'block:paragraph-1', x: 0, y: 20, width: 1200 } };
describe('free note ink persistence contract', () => {
  it('roundtrips anchored translucent ink without creating a notebook', () => {
    const ink = { ...createNoteInk(), strokes: [stroke] };
    expect(noteInkSchema.parse(JSON.parse(JSON.stringify(ink)))).toEqual(ink);
    const notes = { n: { title: 'Texto preservado', blocks: [{ id: 'paragraph-1', text: 'Premissa' }], ink } };
    const before = structuredClone(notes);
    expect(() => validatePersistedNoteCanvases(notes)).not.toThrow();
    expect(notes).toEqual(before);
    expect('canvas' in notes.n).toBe(false);
  });
  it.each([
    { version: 2 }, null,
    { ...createNoteInk(), strokes: [{ ...stroke, opacity: 1.1 }] },
    { ...createNoteInk(), strokes: [{ ...stroke, points: [{ x: Number.NaN, y: 0 }] }] },
    { ...createNoteInk(), strokes: [{ ...stroke, anchor: { ...stroke.anchor, width: 0 } }] },
    { ...createNoteInk(), strokes: [{ ...stroke, points: [{ x: 1201, y: 0 }] }] },
    { ...createNoteInk(), strokes: [stroke, stroke] },
  ])('rejects invalid overlay without silently dropping original content %#', ink => {
    const notes = { n: { title: 'Preservar', ink } };
    const before = structuredClone(notes);
    expect(() => validatePersistedNoteCanvases(notes)).toThrow('dados originais foram preservados');
    expect(notes).toEqual(before);
  });
  it('rejects excessive points while each stroke fits its individual limit', () => {
    const ink = { ...createNoteInk(), strokes: Array.from({ length: 25 }, (_, i) => ({ ...stroke, id: `s-${i}`, points: Array.from({ length: 4096 }, () => ({ x: 2, y: 3 })) })) };
    expect(noteInkSchema.safeParse(ink).success).toBe(false);
  });
});
