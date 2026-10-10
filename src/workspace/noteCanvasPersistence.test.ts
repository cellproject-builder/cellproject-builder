import { describe, expect, it } from 'vitest';
import { createNoteCanvas, noteCanvasSchema } from './noteCanvasModel';
import { validatePersistedNoteCanvases } from './noteCanvasPersistence';

describe('persisted notebook boundary', () => {
  it('preserves valid notebooks and legacy notes exactly', () => {
    const notes = {
      legacy: { title: 'Antes', blocks: [{ text: 'Conteúdo legado' }] },
      visual: { title: 'Depois', canvas: { ...createNoteCanvas(), items: [{ id: 'text', kind: 'text', x: 20, y: 30, width: 150, height: 100, color: '#abcdef', fontSize: 18, text: 'Preservar' }] } },
    };
    const original = structuredClone(notes);
    expect(() => validatePersistedNoteCanvases(notes)).not.toThrow();
    expect(notes).toEqual(original);
    expect(() => validatePersistedNoteCanvases(undefined)).not.toThrow();
  });

  it.each([null, { version: 9 }, { ...createNoteCanvas(), items: [{ id: 'image', kind: 'image', x: 0, y: 0, width: 100, height: 100, label: 'Inválida', src: 'javascript:alert(1)' }] }])('rejects an invalid canvas without modifying its source: %j', canvas => {
    const notes = { bad: { title: 'Guardar', canvas }, good: { canvas: createNoteCanvas() } };
    const original = structuredClone(notes);
    expect(() => validatePersistedNoteCanvases(notes)).toThrow('dados originais foram preservados');
    expect(notes).toEqual(original);
  });

  it('rejects the aggregate image budget even when each notebook fits its own limits', () => {
    // Valid raster signature; repeated payload measures persisted character limits without decoding pixels.
    const src = 'data:image/png;base64,iVBORw0KGgoA' + 'A'.repeat(1536 * 1024);
    const canvas = { ...createNoteCanvas(), items: Array.from({ length: 3 }, (_, i) => ({ id: `image-${i}`, kind: 'image' as const, x: i * 150, y: 0, width: 100, height: 100, label: '', src })) };
    expect(noteCanvasSchema.safeParse(canvas).success).toBe(true);
    const notes = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`note-${i}`, { canvas }]));
    expect(() => validatePersistedNoteCanvases(notes)).toThrow('limite do workspace');
    expect(notes['note-0'].canvas).toBe(canvas);
  });
});
