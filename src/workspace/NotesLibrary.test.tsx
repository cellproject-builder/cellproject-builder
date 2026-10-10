import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { Notes } from './Notes';
import { flushWorkspacePersistence, useWorkspaceStore as store } from './store';

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ locale: 'pt-BR' });
  await store.persist.rehydrate();
  store.setState({ projects: {}, tasks: {}, comments: {}, sprints: {}, notes: {}, folders: {} });
  await flushWorkspacePersistence();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => {
    await flushWorkspacePersistence();
    root.unmount();
  });
  host.remove();
  vi.restoreAllMocks();
});

const addNote = (title: string, options: {
  folderId?: string | null;
  projectId?: string | null;
  text?: string;
  pinned?: boolean;
  deleted?: boolean;
} = {}) => {
  const id = store.getState().createNote({ title, folderId: options.folderId ?? null, projectId: options.projectId ?? null });
  store.getState().updateNote(id, { blocks: [{ id: `body-${id}`, type: 'text', text: options.text ?? '' }], pinned: options.pinned ?? false });
  if (options.deleted) store.getState().trashNote(id);
  return id;
};

const renderNotes = async (projectId?: string) => {
  await act(async () => {
    root.render(<Notes projectId={projectId} />);
    await flushWorkspacePersistence();
  });
};

const library = () => {
  const found = host.querySelector<HTMLElement>('aside.ws-note-library');
  expect(found, 'The unified note library').not.toBeNull();
  return found!;
};

const button = (name: string, parent: ParentNode = library()) => {
  const found = Array.from(parent.querySelectorAll<HTMLButtonElement>('button')).find((candidate) =>
    candidate.getAttribute('aria-label') === name || candidate.textContent?.trim() === name || candidate.querySelector('span')?.textContent === name);
  expect(found, `Button: ${name}`).toBeDefined();
  return found!;
};

const findGroup = (name: string) => Array.from(library().querySelectorAll<HTMLElement>('section.ws-note-group'))
  .find((section) => section.querySelector('h3')?.textContent?.startsWith(name));

const group = (name: string) => {
  const found = findGroup(name);
  expect(found, `Note group: ${name}`).toBeDefined();
  return found!;
};

const toggle = (name: string) => {
  const found = group(name).querySelector<HTMLButtonElement>('h3 > button.ws-note-group-toggle');
  expect(found, `Group toggle: ${name}`).not.toBeNull();
  return found!;
};

const previewTitles = (parent: ParentNode = library()) => Array.from(parent.querySelectorAll<HTMLButtonElement>('button.ws-note-preview'))
  .filter((preview) => !preview.closest('[hidden]'))
  .map((preview) => preview.querySelector('strong')!.textContent).sort();

const preview = (title: string) => {
  const found = Array.from(library().querySelectorAll<HTMLButtonElement>('button.ws-note-preview'))
    .find((candidate) => candidate.querySelector('strong')?.textContent === title);
  expect(found, `Note preview: ${title}`).toBeDefined();
  return found!;
};

const search = (value: string) => {
  const input = library().querySelector<HTMLInputElement>('[aria-label="Buscar notas"]')!;
  expect(input).not.toBeNull();
  act(() => Simulate.change(input, { target: { value } } as never));
};

describe('unified note library', () => {
  it('shows folders and their notes together and lets each group collapse independently', async () => {
    const folderId = store.getState().createFolder('Trabalho');
    addNote('Registro pessoal');
    addNote('Decisões do projeto', { folderId });
    await renderNotes();
    expect(host.querySelectorAll('aside')).toHaveLength(1);
    expect(library().querySelector('[aria-label="Buscar notas"]')).not.toBeNull();
    expect(button('Todas as notas')).toBeDefined();
    expect(button('Fixadas')).toBeDefined();
    expect(button('Apagadas recentemente')).toBeDefined();
    expect(previewTitles(group('Sem pasta'))).toEqual(['Registro pessoal']);
    expect(previewTitles(group('Trabalho'))).toEqual(['Decisões do projeto']);
    const workToggle = toggle('Trabalho');
    const content = document.getElementById(workToggle.getAttribute('aria-controls')!)!;
    expect(content).not.toBeNull();
    expect(workToggle.getAttribute('aria-expanded')).toBe('true');
    act(() => Simulate.click(workToggle));
    expect(content.hidden).toBe(true);
    expect(workToggle.getAttribute('aria-expanded')).toBe('false');
    expect(previewTitles()).toEqual(['Registro pessoal']);
    act(() => Simulate.click(workToggle));
    expect(content.hidden).toBe(false);
    expect(previewTitles()).toEqual(['Decisões do projeto', 'Registro pessoal']);
  });

  it('creates a note directly in its folder and creates a general note without a folder', async () => {
    const folderId = store.getState().createFolder('Ideias');
    await renderNotes();
    act(() => Simulate.click(button('Nova nota: Ideias')));
    await act(async () => { await flushWorkspacePersistence(); });
    const folderNote = Object.values(store.getState().notes)[0];
    expect(folderNote).toMatchObject({ folderId, projectId: null, deletedAt: null });
    expect(previewTitles(group('Ideias'))).toEqual(['Nova nota']);
    expect(host.querySelector('[aria-label="Título da nota"]')).not.toBeNull();
    act(() => Simulate.click(button('Nova nota')));
    await act(async () => { await flushWorkspacePersistence(); });
    const generalNote = Object.values(store.getState().notes).find((note) => note.id !== folderNote.id)!;
    expect(Object.values(store.getState().notes)).toHaveLength(2);
    expect(generalNote).toMatchObject({ folderId: null, projectId: null, deletedAt: null });
    expect(previewTitles(group('Sem pasta'))).toEqual(['Nova nota']);
  });

  it('creates a folder through the dialog and deleting it preserves its notes without a folder', async () => {
    await renderNotes();
    act(() => Simulate.click(button('Nova pasta')));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    const name = dialog.querySelector<HTMLInputElement>('input[required]')!;
    act(() => Simulate.change(name, { target: { value: 'Pesquisa' } } as never));
    await act(async () => { Simulate.submit(name.form!); await flushWorkspacePersistence(); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const folderId = Object.values(store.getState().folders).find((folder) => folder.name === 'Pesquisa')!.id;
    act(() => Simulate.click(button('Nova nota: Pesquisa')));
    const note = Object.values(store.getState().notes)[0];
    act(() => { store.getState().updateNote(note.id, { title: 'Observações preservadas', blocks: [{ id: 'research', type: 'text', text: 'Conteúdo importante' }] }); });
    await act(async () => { Simulate.click(button('Excluir pasta: Pesquisa')); await flushWorkspacePersistence(); });
    expect(store.getState().folders[folderId]).toBeUndefined();
    expect(store.getState().notes[note.id]).toMatchObject({ folderId: null, title: 'Observações preservadas', blocks: [{ id: 'research', type: 'text', text: 'Conteúdo importante' }] });
    expect(findGroup('Pesquisa')).toBeUndefined();
    expect(previewTitles(group('Sem pasta'))).toEqual(['Observações preservadas']);
  });

  it('searches titles and body text across folders and reveals matches in a collapsed group', async () => {
    const titleFolder = store.getState().createFolder('Decisões');
    const bodyFolder = store.getState().createFolder('Reuniões');
    const otherFolder = store.getState().createFolder('Outros');
    addNote('Resultado do protótipo', { folderId: titleFolder });
    addNote('Encontro semanal', { folderId: bodyFolder, text: 'Precisamos validar o protótipo antes do lançamento.' });
    addNote('Lista de compras', { folderId: otherFolder });
    addNote('Diário sem correspondência');
    await renderNotes();
    act(() => Simulate.click(toggle('Decisões')));
    expect(toggle('Decisões').getAttribute('aria-expanded')).toBe('false');
    search('protótipo');
    expect(previewTitles()).toEqual(['Encontro semanal', 'Resultado do protótipo']);
    expect(toggle('Decisões').getAttribute('aria-expanded')).toBe('true');
    expect(findGroup('Outros')).toBeUndefined();
    expect(findGroup('Sem pasta')).toBeUndefined();
    expect(library().querySelectorAll('section.ws-note-group')).toHaveLength(2);
  });

  it('keeps pinned and recently deleted filters separate without changing the notes', async () => {
    const folderId = store.getState().createFolder('Arquivo');
    const pinned = addNote('Decisão fixada', { folderId, pinned: true });
    addNote('Nota comum');
    const deleted = addNote('Nota removida', { folderId, pinned: true, deleted: true });
    await renderNotes();
    expect(previewTitles()).toEqual(['Decisão fixada', 'Nota comum']);
    await act(async () => { Simulate.click(button('Fixadas')); await flushWorkspacePersistence(); });
    expect(previewTitles()).toEqual(['Decisão fixada']);
    await act(async () => { Simulate.click(button('Apagadas recentemente')); await flushWorkspacePersistence(); });
    expect(previewTitles()).toEqual(['Nota removida']);
    await act(async () => { Simulate.click(button('Todas as notas')); await flushWorkspacePersistence(); });
    expect(previewTitles()).toEqual(['Decisão fixada', 'Nota comum']);
    expect(store.getState().notes[pinned].pinned).toBe(true);
    expect(store.getState().notes[deleted].deletedAt).not.toBeNull();
  });

  it('opens the selected preview and keeps its editor open after an edit stops matching the search', async () => {
    const folderId = store.getState().createFolder('Produto');
    const noteId = addNote('Protótipo escolhido', { folderId });
    addNote('Protótipo alternativo');
    await renderNotes();
    search('protótipo');
    act(() => Simulate.click(preview('Protótipo escolhido')));
    const title = host.querySelector<HTMLTextAreaElement>('[aria-label="Título da nota"]')!;
    expect(title.value).toBe('Protótipo escolhido');
    act(() => {
      Simulate.focus(title);
      Simulate.change(title, { target: { value: 'Decisão final' } } as never);
    });
    await act(async () => { await flushWorkspacePersistence(); });
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Título da nota"]')!.value).toBe('Decisão final');
    expect(store.getState().notes[noteId].title).toBe('Decisão final');
    expect(previewTitles()).toEqual(['Protótipo alternativo']);
  });

  it('limits every filter and search to the current project and creates notes in that project', async () => {
    const projectId = store.getState().createProject('Projeto atual');
    const otherProjectId = store.getState().createProject('Outro projeto');
    const folderId = store.getState().createFolder('Compartilhada');
    addNote('Atual fixada', { projectId, folderId, pinned: true, text: 'termo de busca' });
    addNote('Atual comum', { projectId });
    addNote('Atual apagada', { projectId, deleted: true });
    addNote('Outra fixada', { projectId: otherProjectId, folderId, pinned: true, text: 'termo de busca' });
    addNote('Outra apagada', { projectId: otherProjectId, deleted: true });
    addNote('Pessoal fixada', { pinned: true, text: 'termo de busca' });
    addNote('Pessoal apagada', { deleted: true });
    await renderNotes(projectId);
    expect(previewTitles()).toEqual(['Atual comum', 'Atual fixada']);
    search('termo de busca');
    expect(previewTitles()).toEqual(['Atual fixada']);
    search('');
    act(() => Simulate.click(button('Fixadas')));
    expect(previewTitles()).toEqual(['Atual fixada']);
    act(() => Simulate.click(button('Apagadas recentemente')));
    expect(previewTitles()).toEqual(['Atual apagada']);
    act(() => Simulate.click(button('Todas as notas')));
    const previousIds = new Set(Object.keys(store.getState().notes));
    act(() => Simulate.click(button('Nova nota: Compartilhada')));
    const created = Object.values(store.getState().notes).filter((note) => !previousIds.has(note.id));
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ projectId, folderId, deletedAt: null });
  });
});
