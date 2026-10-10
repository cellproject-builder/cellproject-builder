import { noteCanvasSchema } from './noteCanvasModel';
import { noteInkSchema } from './noteInkModel';
import { assertNoteImageBudget } from './noteImages';

/** Validate new notebook content without rewriting or discarding legacy notes. */
export function validatePersistedNoteCanvases(notes: unknown): void {
  if (!notes || typeof notes !== 'object' || Array.isArray(notes)) return;
  const visualNotes = [];
  for (const note of Object.values(notes)) {
    if (!note || typeof note !== 'object') continue;
    if ('ink' in note && note.ink !== undefined && !noteInkSchema.safeParse(note.ink).success) {
      throw new Error('Uma nota contém desenho livre inválido ou incompatível. Os dados originais foram preservados. Restaure uma cópia válida e tente novamente.');
    }
    if (!('canvas' in note) || note.canvas === undefined) continue;
    const result = noteCanvasSchema.safeParse(note.canvas);
    if (!result.success) {
      throw new Error('Uma nota contém um caderno inválido ou incompatível. Os dados originais foram preservados. Restaure uma cópia válida e tente novamente.');
    }
    visualNotes.push({ canvas: result.data });
  }
  try {
    assertNoteImageBudget(visualNotes, {}, []);
  } catch {
    throw new Error('As imagens dos cadernos ultrapassam o limite do workspace. Os dados originais foram preservados. Restaure uma cópia dentro do limite e tente novamente.');
  }
}
