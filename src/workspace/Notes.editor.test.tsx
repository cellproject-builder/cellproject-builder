import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { Notes } from './Notes';
import { flushWorkspacePersistence, useWorkspaceStore as store } from './store';
import { createNoteCanvas } from './noteCanvasModel';

let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ locale: 'pt-BR' });
  await store.persist.rehydrate();
  store.setState({ projects: {}, tasks: {}, notes: {}, folders: {}, activeProjectId: null, surface: 'notes' });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { act(() => root.unmount()); host.remove(); await flushWorkspacePersistence(); });
async function open(id: string) { await act(async () => { root.render(<Notes initialNoteId={id} />); await flushWorkspacePersistence(); }); }

describe('quiet notebook editor', () => {
  it('invites writing in the editor once, without repeating that invitation in the library', async () => {
    const id = store.getState().createNote(); await open(id);
    const first = host.querySelector<HTMLTextAreaElement>('[data-block]')!;
    expect(first.placeholder).toBeTruthy();
    expect(host.querySelector('.ws-note-library')?.textContent).not.toContain(first.placeholder);
    expect(host.querySelectorAll('.ws-note-block textarea')).toHaveLength(1);
  });

  it('keeps legacy blank paragraphs and drawings without showing several empty writing invitations', async () => {
    const id = store.getState().createNote();
    const blocks = [{ id: 'one', type: 'text' as const, text: '' }, { id: 'two', type: 'text' as const, text: '' }];
    const canvas = { ...createNoteCanvas(), strokes: [{ id: 'stroke', color: '#a896c9', width: 2, points: [{ x: 10, y: 20 }] }] };
    store.getState().updateNote(id, { blocks, canvas });
    const before = store.getState().notes[id]; await open(id);
    expect([...host.querySelectorAll<HTMLTextAreaElement>('[data-block]')].filter(field => field.placeholder)).toHaveLength(1);
    expect(store.getState().notes[id]).toBe(before);
    expect(store.getState().notes[id].canvas).toEqual(canvas);
  });

  it('adds a paragraph with a compact accessible control and puts the caret in it', async () => {
    const id = store.getState().createNote(); await open(id);
    const initial = store.getState().notes[id].blocks[0].id;
    const add = host.querySelector<HTMLButtonElement>('[aria-label="Adicionar um bloco"]');
    expect(add).not.toBeNull(); expect(add?.textContent?.trim()).toBe('');
    act(() => Simulate.click(add!));
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
    const blocks = store.getState().notes[id].blocks;
    expect(blocks).toHaveLength(2); expect(blocks[0].id).toBe(initial);
    expect(document.activeElement).toBe(host.querySelector(`[data-block="${blocks[1].id}"]`));
  });

  it('keeps secondary note actions behind one disclosure and leaves writing tools available', async () => {
    const id = store.getState().createNote({ title: 'Bancada' }); await open(id);
    const options = host.querySelector<HTMLElement>('[aria-label="Opções da nota"]');
    expect(options?.tagName).toBe('SUMMARY');
    const menu = options!.closest('details')!; expect(menu.open).toBe(false);
    act(() => options!.click()); expect(menu.open).toBe(true);
    act(() => Simulate.click(menu.querySelector('[aria-label="Fixar nota"]')!));
    expect(store.getState().notes[id].pinned).toBe(true);
    expect(host.querySelectorAll('.ws-note-editor [aria-label="Ditar na nota"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="Desenhar na nota"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Adicionar imagem à nota"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Pedir à IA sobre esta nota"]')).not.toBeNull();
  });

  it('opens paragraph actions explicitly and returns to the same paragraph on Escape', async () => {
    const id = store.getState().createNote();
    store.getState().updateNote(id, { blocks: [{ id: 'body', type: 'text', text: 'Observação preservada.' }] });
    await open(id);
    const field = host.querySelector<HTMLTextAreaElement>('[data-block="body"]')!;
    const menu = field.closest('.ws-note-block')!.querySelector<HTMLDetailsElement>('details');
    expect(menu).not.toBeNull(); expect(menu!.open).toBe(false);
    act(() => { field.focus(); field.setSelectionRange(3, 8); menu!.querySelector('summary')!.click(); });
    expect(menu!.open).toBe(true);
    act(() => Simulate.click(menu!.querySelector('[aria-label="Negrito"]')!));
    expect(store.getState().notes[id].blocks[0]).toMatchObject({ id: 'body', text: 'Observação preservada.', bold: true });
    act(() => menu!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(menu!.open).toBe(false); expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([3, 8]);
  });
});
