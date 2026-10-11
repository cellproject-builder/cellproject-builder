import type { ChatTurnContext } from '@/chat/turnContext';
import { useWorkspaceStore } from '@/workspace/store';
import type { Note } from '@/workspace/types';

/** Private compare-and-set state. Never include it in a model prompt or persisted chat. */
export interface NoteEditBaseline { noteId: string; createdAt: number; textSnapshot: string }
export const noteTextSnapshot = (note: Pick<Note, 'title' | 'blocks'>) => JSON.stringify([note.title, note.blocks]);
export function captureNoteEditBaseline(context: Pick<ChatTurnContext, 'surface' | 'noteId'>): NoteEditBaseline | null {
  const note = context.surface === 'notes' && context.noteId ? useWorkspaceStore.getState().notes[context.noteId] : undefined;
  return note?.deletedAt === null ? Object.freeze({ noteId: note.id, createdAt: note.createdAt, textSnapshot: noteTextSnapshot(note) }) : null;
}
