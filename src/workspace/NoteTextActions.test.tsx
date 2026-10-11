import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { flushChatPersistence, useChatStore } from '@/chat/store';
import { useChatReferenceHandoff } from '@/references/chatHandoff';
import { useWorkspaceStore as store, flushWorkspacePersistence } from './store';
import { Notes } from './Notes';

let root: Root, host: HTMLDivElement, noteId: string, projectId: string;
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent === label || b.querySelector('span')?.textContent === label)!;
const body = () => host.querySelector<HTMLTextAreaElement>('[data-block="paragraph"]')!;
function openAI(start = 0, end = 0) {
  act(() => { body().focus(); body().setSelectionRange(start, end); Simulate.select(body()); Simulate.click(button('Editar com IA')); });
}
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ locale: 'pt-BR' });
  await store.persist.rehydrate();
  await useChatStore.persist.rehydrate();
  store.setState({ projects: {}, tasks: {}, notes: {}, folders: {}, activeProjectId: null, surface: 'notes' });
  useChatStore.setState({ messages: [], open: false, hydrated: true, loadFailed: false, running: false, archivedAt: null, deletedAt: null });
  useChatReferenceHandoff.setState({ pending: null });
  projectId = store.getState().createProject('Robô');
  noteId = store.getState().createNote({ title: 'Minha nota', projectId });
  store.getState().updateNote(noteId, { blocks: [
    { id: 'paragraph', type: 'text', text: 'Antes texto original depois.' },
    { id: 'other', type: 'check', text: 'Preservar este bloco', checked: true },
  ] });
  store.setState({ activeProjectId: null, surface: 'notes' });
  await flushWorkspacePersistence();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<Notes initialNoteId={noteId} />); await flushWorkspacePersistence(); });
});
afterEach(async () => { act(() => root.unmount()); host.remove(); await flushWorkspacePersistence(); await flushChatPersistence(); vi.restoreAllMocks(); });

describe('contextual note actions', () => {
  it('formats the paragraph belonging to the contextual toolbar', () => {
    const toolbar = body().closest('.ws-note-block')!.querySelector('[aria-label="Formatar parágrafo"]')!;
    act(() => Simulate.click(toolbar.querySelector('[aria-label="Negrito"]')!));
    expect(store.getState().notes[noteId].blocks[0].bold).toBe(true);
    expect(store.getState().notes[noteId].blocks[1]).toEqual({ id: 'other', type: 'check', text: 'Preservar este bloco', checked: true });
  });

  it('opens the shared chat with only the selected passage and the explicit note reference', () => {
    const before = store.getState().notes[noteId];
    openAI(6, 20);
    const pending = useChatReferenceHandoff.getState().pending;
    expect(pending?.projectId).toBe(projectId);
    expect(pending?.references).toEqual([{ id: noteId, kind: 'note', label: 'Minha nota', detail: '', fingerprint: '', noteSelection: { blockId: 'paragraph', start: 6, end: 20, original: 'Antes texto original depois.' } }]);
    expect(pending?.composerText).toBe('Revise este trecho da nota "Minha nota":\n\ntexto original\n\nAjuste desejado: ');
    expect(useChatStore.getState().open).toBe(true);
    expect(useChatStore.getState().messages).toHaveLength(0);
    expect(store.getState().notes[noteId]).toBe(before);
    expect(store.getState().surface).toBe('notes');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('uses the full paragraph without a selection', () => {
    openAI();
    expect(useChatReferenceHandoff.getState().pending?.composerText).toBe('Revise este trecho da nota "Minha nota":\n\nAntes texto original depois.\n\nAjuste desejado: ');
    expect(useChatReferenceHandoff.getState().pending?.references[0].noteSelection).toEqual({ blockId: 'paragraph', start: 0, end: 28, original: 'Antes texto original depois.' });
    expect(store.getState().notes[noteId].blocks[1].checked).toBe(true);
  });

  it('preserves spaces in the selected passage for the editable chat request', () => {
    openAI(5, 21);
    expect(useChatReferenceHandoff.getState().pending?.composerText).toContain('\n\n texto original \n\n');
  });

  it('ignores an old selection after focus has moved to another field', () => {
    act(() => { body().focus(); body().setSelectionRange(6, 20); Simulate.select(body()); });
    act(() => { host.querySelector<HTMLTextAreaElement>('[aria-label="Título da nota"]')!.focus(); Simulate.click(button('Editar com IA')); });
    expect(useChatReferenceHandoff.getState().pending?.composerText).toContain('\n\nAntes texto original depois.\n\n');
  });

  it('hides contextual editing for a note in trash', () => {
    act(() => { store.getState().trashNote(noteId); Simulate.click(button('Apagadas recentemente')); });
    expect(host.querySelector('[aria-label="Formatar parágrafo"]')).toBeNull();
  });
});
