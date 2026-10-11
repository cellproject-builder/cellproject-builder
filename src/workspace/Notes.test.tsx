import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { useWorkspaceStore as store, flushWorkspacePersistence } from './store';
import { Notes } from './Notes';
import { createSelectiveJSONStorage, isDeferredJSONStorage } from '@/data/selectiveJSONStorage';

let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ locale: 'pt-BR' });
  await store.persist.rehydrate();
  store.setState({ projects: {}, tasks: {}, notes: {}, folders: {} });
  await flushWorkspacePersistence();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe('note editing', () => {
  it('does not scan full note bodies when no search is requested', async () => {
    const noteId = store.getState().createNote({ title: 'Pesquisa' });
    store.getState().updateNote(noteId, { blocks: [{ id: 'body', type: 'text', text: 'CORPO_UNICO_LARGO preservado' }] });
    const lowercase = vi.spyOn(String.prototype, 'toLocaleLowerCase');
    await act(async () => { root.render(<Notes initialNoteId={noteId} />); await flushWorkspacePersistence(); });
    expect(lowercase.mock.contexts.some(value => String(value).includes('CORPO_UNICO_LARGO'))).toBe(false);
    act(() => Simulate.change(host.querySelector('[aria-label="Buscar notas"]')!, { target: { value: 'preservado' } } as never));
    expect(lowercase.mock.contexts.some(value => String(value).includes('CORPO_UNICO_LARGO'))).toBe(true);
    expect(host.querySelector('.ws-note-preview')?.textContent).toContain('Pesquisa');
  });

  it('observes deferred save acknowledgement without flushing on every edit', async () => {
    const original = store.persist.getOptions().storage;
    let finish!: () => void;
    const write = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const storage = createSelectiveJSONStorage(() => ({ getItem: () => null, setItem: write, removeItem: () => {} }), { deferMs: 200 })!;
    if (!isDeferredJSONStorage(storage)) throw new Error('deferred adapter missing');
    // Rendering speed must not decide whether the adapter's scheduling timer fires.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const flush = vi.spyOn(storage, 'flush');
    store.persist.setOptions({ storage });
    try {
      const noteId = store.getState().createNote({ title: 'Original' });
      await act(async () => { root.render(<Notes initialNoteId={noteId} />); });
      expect(flush).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(host.querySelector('[role="status"]')?.textContent).toBe('Salvando…');
      let saving!: Promise<void>; await act(async () => { saving = storage.flush(); await Promise.resolve(); });
      expect(host.querySelector('[role="status"]')?.textContent).toBe('Salvando…');
      await act(async () => { finish(); await saving; });
      expect(host.querySelector('[role="status"]')?.textContent).toBe('Salvo');
      flush.mockClear();
      act(() => Simulate.change(host.querySelector('[aria-label="Título da nota"]')!, { target: { value: 'Mais uma edição' } } as never));
      expect(flush).not.toHaveBeenCalled();
      expect(write).toHaveBeenCalledOnce();
      expect(host.querySelector('[role="status"]')?.textContent).toBe('Salvando…');
      await act(async () => { const last = storage.flush(); await Promise.resolve(); finish(); await last; });
      expect(host.querySelector('[role="status"]')?.textContent).toBe('Salvo');
    } finally {
      write.mockImplementation(() => Promise.resolve()); finish?.();
      await storage.flush().catch(() => {});
      store.persist.setOptions({ storage: original });
      vi.useRealTimers();
    }
  });

  it('maximizes and restores the same editor without losing text, selection or library search', async () => {
    const noteId = store.getState().createNote({ title: 'Reunião de revisão' });
    const blocks = store.getState().notes[noteId].blocks.map((block) => ({ ...block, text: 'Um parágrafo em edição.' }));
    store.getState().updateNote(noteId, { blocks });
    await act(async () => { root.render(<Notes initialNoteId={noteId} />); await flushWorkspacePersistence(); });
    const search = host.querySelector<HTMLInputElement>('[aria-label="Buscar notas"]')!;
    act(() => Simulate.change(search, { target: { value: 'Reunião' } } as never));
    const editor = host.querySelector('.ws-note-editor');
    const paragraph = host.querySelector<HTMLTextAreaElement>('[data-block]')!;
    paragraph.setSelectionRange(3, 12);
    const maximize = host.querySelector<HTMLButtonElement>('[aria-label="Maximizar editor"]');
    expect(maximize).not.toBeNull();
    act(() => Simulate.click(maximize!));
    const restore = host.querySelector<HTMLButtonElement>('[aria-label="Restaurar editor"]');
    expect(restore?.getAttribute('aria-pressed')).toBe('true');
    expect(restore?.closest('[hidden]')).not.toBeNull();
    expect(host.querySelector('.ws-note-editor')).toBe(editor);
    expect(paragraph.value).toBe('Um parágrafo em edição.');
    expect([paragraph.selectionStart, paragraph.selectionEnd]).toEqual([3, 12]);
    act(() => Simulate.click(host.querySelector('[aria-label="Mostrar controles"]')!));
    expect(restore?.closest('[hidden]')).toBeNull();
    act(() => Simulate.click(restore!));
    expect(host.querySelector('.ws-note-editor')).toBe(editor);
    expect(search.value).toBe('Reunião');
    expect(store.getState().notes[noteId].blocks).toEqual(blocks);
    act(() => Simulate.click(host.querySelector('[aria-label="Maximizar editor"]')!));
    act(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.querySelector('[aria-label="Maximizar editor"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Restaurar editor"]')).toBeNull();
  });

  it('closes an AI dialog with Escape while leaving the editor maximized', async () => {
    const noteId = store.getState().createNote({ title: 'Contexto preservado' });
    store.getState().updateNote(noteId, { blocks: store.getState().notes[noteId].blocks.map((block) => ({ ...block, text: 'Texto para revisar.' })) });
    await act(async () => { root.render(<Notes initialNoteId={noteId} />); await flushWorkspacePersistence(); });
    const maximize = host.querySelector<HTMLButtonElement>('[aria-label="Maximizar editor"]');
    expect(maximize).not.toBeNull();
    act(() => Simulate.click(maximize!));
    act(() => Simulate.click(host.querySelector('[aria-label="Editar com IA"]')!));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    act(() => dialog!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('[aria-label="Restaurar editor"]')).not.toBeNull();
  });

  it('keeps the active search result open when its text stops matching', async () => {
    store.getState().createNote({ title: 'termo A' });
    store.getState().createNote({ title: 'termo B' });
    await act(async () => { root.render(<Notes />); await flushWorkspacePersistence(); });
    const search = host.querySelector<HTMLInputElement>('[aria-label="Buscar notas"]')!;
    act(() => Simulate.change(search, { target: { value: 'termo' } } as never));
    const title = host.querySelector<HTMLTextAreaElement>('[aria-label="Título da nota"]')!;
    act(() => { Simulate.focus(title); Simulate.change(title, { target: { value: 'Sem correspondência' } } as never); });
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Título da nota"]')!.value).toBe('Sem correspondência');
    await act(async () => { await flushWorkspacePersistence(); });
  });

  it('shows a failed save and lets the user retry instead of claiming it is saved', async () => {
    store.getState().createNote({ title: 'Original' });
    await act(async () => { root.render(<Notes />); await flushWorkspacePersistence(); });
    const write = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new DOMException('Storage full', 'QuotaExceededError'); });
    const title = host.querySelector<HTMLTextAreaElement>('[aria-label="Título da nota"]')!;
    await act(async () => {
      Simulate.change(title, { target: { value: 'Texto ainda na memória' } } as never);
      await flushWorkspacePersistence().catch(() => {});
    });
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Não salvo');
    write.mockRestore();
    await act(async () => { Simulate.click(host.querySelector('[aria-label="Tentar salvar novamente"]')!); await flushWorkspacePersistence(); });
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Salvo');
  });
});
