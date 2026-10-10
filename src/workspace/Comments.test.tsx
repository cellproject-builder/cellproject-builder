import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { useWorkspaceStore as store, flushWorkspacePersistence } from './store';
import { TaskEditor } from './TaskEditor';

let root: Root;
let host: HTMLDivElement;
let project: string;
let task: string;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ locale: 'pt-BR' });
  await store.persist.rehydrate();
  store.setState({ projects: {}, tasks: {}, comments: {}, sprints: {}, notes: {}, folders: {} });
  project = store.getState().createProject('Projeto');
  task = store.getState().createTask(project, { title: 'Título original' });
  await flushWorkspacePersistence();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  await flushWorkspacePersistence().catch(() => {});
});

const editor = async (onClose = vi.fn()) => {
  await act(async () => {
    root.render(<TaskEditor projectId={project} task={store.getState().tasks[task]} onClose={onClose} onSource={() => {}} />);
    await flushWorkspacePersistence();
  });
  return document.querySelector<HTMLElement>('[role="dialog"]')!;
};

describe('task comments in the editor', () => {
  it('posts a comment without submitting or overwriting the unsaved task draft', async () => {
    const onClose = vi.fn();
    const dialog = await editor(onClose);
    const title = dialog.querySelector<HTMLInputElement>('input[maxlength="240"]')!;
    act(() => Simulate.change(title, { target: { value: 'Título em edição' } } as never));
    const body = dialog.querySelector<HTMLTextAreaElement>('[aria-label="Adicionar comentário"]');
    expect(body).not.toBeNull();
    expect(body!.form).not.toBe(title.form);
    expect(dialog.querySelector('form form')).toBeNull();
    await act(async () => {
      Simulate.change(body!, { target: { value: 'Contexto publicado' } } as never);
    });
    await act(async () => { Simulate.submit(body!.form!); await flushWorkspacePersistence(); });
    expect(Object.values(store.getState().comments).map((comment) => comment.body)).toEqual(['Contexto publicado']);
    expect(store.getState().tasks[task].title).toBe('Título original');
    expect(title.value).toBe('Título em edição');
    expect(body!.value).toBe('');
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { Simulate.submit(title.form!); await flushWorkspacePersistence(); });
    expect(store.getState().tasks[task].title).toBe('Título em edição');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows only this task’s comments and supports editing, cancelling and deleting', async () => {
    const id = store.getState().addComment(task, 'Próximo passo', 'assistant');
    const other = store.getState().createTask(project, { title: 'Outra tarefa' });
    store.getState().addComment(other, 'Comentário de outra tarefa');
    const dialog = await editor();
    expect(dialog.textContent).toContain('Assistente IA');
    expect(dialog.textContent).not.toContain('Comentário de outra tarefa');
    act(() => Simulate.click(dialog.querySelector('[aria-label="Editar comentário"]')!));
    const draft = dialog.querySelector<HTMLTextAreaElement>('[aria-label="Editar comentário"]')!;
    act(() => Simulate.change(draft, { target: { value: 'Alteração cancelada' } } as never));
    act(() => Simulate.click(draft.form!.querySelector('button[type="button"]')!));
    expect(store.getState().comments[id].body).toBe('Próximo passo');
    act(() => Simulate.click(dialog.querySelector('[aria-label="Editar comentário"]')!));
    const edit = dialog.querySelector<HTMLTextAreaElement>('[aria-label="Editar comentário"]')!;
    act(() => Simulate.change(edit, { target: { value: 'Decisão atualizada' } } as never));
    await act(async () => { Simulate.submit(edit.form!); await flushWorkspacePersistence(); });
    expect(store.getState().comments[id].body).toBe('Decisão atualizada');
    expect(store.getState().comments[id].author).toBe('assistant');
    await act(async () => { Simulate.click(dialog.querySelector('[aria-label="Excluir comentário"]')!); await flushWorkspacePersistence(); });
    expect(store.getState().comments[id]).toBeUndefined();
    expect(Object.values(store.getState().comments)).toHaveLength(1);
  });

  it('reports a failed comment save and retries it without duplicating the comment', async () => {
    const dialog = await editor();
    const body = dialog.querySelector<HTMLTextAreaElement>('[aria-label="Adicionar comentário"]');
    expect(body).not.toBeNull();
    const write = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new DOMException('Storage full', 'QuotaExceededError'); });
    act(() => Simulate.change(body!, { target: { value: 'Comentário importante' } } as never));
    await act(async () => {
      Simulate.submit(body!.form!);
      await flushWorkspacePersistence().catch(() => {});
    });
    expect(dialog.querySelector('[role="status"]')?.textContent).toBe('Não salvo');
    write.mockRestore();
    await act(async () => { Simulate.click(dialog.querySelector('[aria-label="Tentar salvar novamente"]')!); await flushWorkspacePersistence(); });
    expect(dialog.querySelector('[role="status"]')?.textContent).toBe('Salvo');
    expect(Object.values(store.getState().comments).map((comment) => comment.body)).toEqual(['Comentário importante']);
  });
});
