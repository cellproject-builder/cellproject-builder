import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { useConfigStore } from '@/config/store';
import { useWorkspaceStore as store, flushWorkspacePersistence } from './store';
import { Notes } from './Notes';

const rewrite = vi.hoisted(() => vi.fn());
vi.mock('@/ai/noteRewrite', () => ({ rewriteNoteText: rewrite }));
let root: Root, host: HTMLDivElement, noteId: string;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent === label || b.querySelector('span')?.textContent === label)!;
const body = () => host.querySelector<HTMLTextAreaElement>('[data-block="paragraph"]')!;
async function openAI(start = 0, end = 0) {
  act(() => { body().focus(); body().setSelectionRange(start, end); Simulate.select(body()); Simulate.click(button('Editar com IA')); });
}
async function generate() {
  const instruction = document.querySelector<HTMLTextAreaElement>('[aria-label="Como a IA deve modificar o texto?"]')!;
  act(() => Simulate.change(instruction, { target: { value: 'Deixe mais claro' } } as never));
  await act(async () => { Simulate.submit(instruction.closest('form')!); });
}
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ locale: 'pt-BR' });
  await store.persist.rehydrate();
  store.setState({ projects: {}, tasks: {}, notes: {}, folders: {} });
  useConfigStore.setState({ activeProvider: 'openai', providers: { openai: { apiKey: 'test-only', mainModel: 'test-model', kbModel: 'test-model' } } });
  noteId = store.getState().createNote({ title: 'Minha nota' });
  store.getState().updateNote(noteId, { blocks: [
    { id: 'paragraph', type: 'text', text: 'Antes texto original depois.' },
    { id: 'other', type: 'check', text: 'Preservar este bloco', checked: true },
  ] });
  await flushWorkspacePersistence();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  rewrite.mockReset(); rewrite.mockResolvedValue('texto revisado');
  await act(async () => { root.render(<Notes initialNoteId={noteId} />); await flushWorkspacePersistence(); });
});
afterEach(async () => { act(() => root.unmount()); host.remove(); await flushWorkspacePersistence(); vi.restoreAllMocks(); });

describe('contextual note actions', () => {
  it('formats the paragraph belonging to the contextual toolbar', () => {
    const toolbar = body().closest('.ws-note-block')!.querySelector('[aria-label="Formatar parágrafo"]')!;
    act(() => Simulate.click(toolbar.querySelector('[aria-label="Negrito"]')!));
    expect(store.getState().notes[noteId].blocks[0].bold).toBe(true);
    expect(store.getState().notes[noteId].blocks[1]).toEqual({ id: 'other', type: 'check', text: 'Preservar este bloco', checked: true });
  });

  it('previews and applies only the selected text without changing other blocks', async () => {
    await openAI(6, 20);
    expect(document.querySelector('.ws-note-ai-source')?.textContent).toBe('texto original');
    await generate();
    expect(store.getState().notes[noteId].blocks[0].text).toBe('Antes texto original depois.');
    act(() => Simulate.click(button('Aplicar alteração')));
    expect(store.getState().notes[noteId].blocks[0].text).toBe('Antes texto revisado depois.');
    expect(store.getState().notes[noteId].blocks[1].checked).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('uses the full paragraph without a selection and can discard the preview', async () => {
    await openAI();
    expect(document.querySelector('.ws-note-ai-source')?.textContent).toBe('Antes texto original depois.');
    await generate();
    act(() => Simulate.click(button('Descartar')));
    expect(store.getState().notes[noteId].blocks[0].text).toBe('Antes texto original depois.');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('preserves the spaces around a selected phrase', async () => {
    await openAI(5, 21); await generate();
    act(() => Simulate.click(button('Aplicar alteração')));
    expect(store.getState().notes[noteId].blocks[0].text).toBe('Antes texto revisado depois.');
  });

  it('ignores an old selection after focus has moved to another field', async () => {
    await openAI(6, 20);
    act(() => Simulate.click(button('Cancelar')));
    act(() => { host.querySelector<HTMLTextAreaElement>('[aria-label="Título da nota"]')!.focus(); Simulate.click(button('Editar com IA')); });
    expect(document.querySelector('.ws-note-ai-source')?.textContent).toBe('Antes texto original depois.');
  });

  it('refuses to overwrite text changed while the AI preview was open', async () => {
    await openAI(6, 20); await generate();
    act(() => { store.getState().updateNote(noteId, { blocks: [{ id: 'paragraph', type: 'text', text: 'Uma edição mais recente' }] }); });
    act(() => Simulate.click(button('Aplicar alteração')));
    expect(store.getState().notes[noteId].blocks[0].text).toBe('Uma edição mais recente');
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/mudou/);
  });

  it('aborts the request when the dialog is dismissed without applying late output', async () => {
    let resolve!: (text: string) => void, signal!: AbortSignal;
    rewrite.mockImplementation((input: { signal: AbortSignal }) => { signal = input.signal; return new Promise<string>((done) => { resolve = done; }); });
    await openAI(); await generate();
    act(() => Simulate.click(button('Cancelar')));
    expect(signal.aborted).toBe(true);
    await act(async () => resolve('Resposta atrasada'));
    expect(store.getState().notes[noteId].blocks[0].text).toBe('Antes texto original depois.');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows a provider failure without changing the note', async () => {
    rewrite.mockRejectedValue(Object.assign(new Error('Too many requests'), { statusCode: 429 }));
    await openAI(); await generate();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(store.getState().notes[noteId].blocks[0].text).toBe('Antes texto original depois.');
    expect(button('Aplicar alteração')).toBeUndefined();
  });

  it('hides contextual editing for a note in trash', async () => {
    act(() => { store.getState().trashNote(noteId); Simulate.click(button('Apagadas recentemente')); });
    expect(host.querySelector('[aria-label="Formatar parágrafo"]')).toBeNull();
  });
});
