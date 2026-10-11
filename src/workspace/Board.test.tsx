import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { Board } from './Board';
import { TASK_DRAG_TYPE } from './TaskCard';
import { taskReference } from './TaskPresentation';
import { useWorkspaceStore as store, flushWorkspacePersistence } from './store';

const VIEW_KEY = 'dynamic_diary:task-view';
let root: Root;
let host: HTMLDivElement;
let projectId: string;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ locale: 'en' });
  localStorage.removeItem(VIEW_KEY);
  await store.persist.rehydrate();
  store.setState({ projects: {}, tasks: {}, comments: {}, sprints: {}, notes: {}, folders: {} });
  projectId = store.getState().createProject('Product launch');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  act(() => root.unmount());
  host.remove();
  localStorage.removeItem(VIEW_KEY);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await flushWorkspacePersistence();
});

const renderBoard = async (onEdit = vi.fn(), onAdd = vi.fn()) => {
  await act(async () => {
    root.render(<Board projectId={projectId} onEdit={onEdit} onAdd={onAdd} />);
    await flushWorkspacePersistence();
  });
};

const button = (name: string, container: ParentNode = host) => {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => (candidate.getAttribute('aria-label') ?? candidate.textContent?.trim()) === name);
  expect(found, `Button: ${name}`).toBeDefined();
  return found!;
};

const group = (name: string) => {
  const found = Array.from(host.querySelectorAll('section')).find((section) => {
    const toggleLabel = section.querySelector('button[aria-expanded]')?.getAttribute('aria-label');
    return section.getAttribute('aria-label') === name || toggleLabel === `Collapse ${name}` || toggleLabel === `Expand ${name}`;
  });
  expect(found, `Task group: ${name}`).toBeDefined();
  return found!;
};

const visibleTaskTitles = () => Array.from(host.querySelectorAll<HTMLSelectElement>('select[aria-label^="Status: "]'))
  .filter((select) => !select.closest('[hidden]'))
  .map((select) => select.getAttribute('aria-label')!.slice('Status: '.length)).sort();

const changeFilter = (label: string, value: string) => {
  const control = host.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
  expect(control).not.toBeNull();
  act(() => {
    control.value = value;
    Simulate.change(control, { target: { value } } as never);
  });
};

describe('shared Kanban and list task views', () => {
  it('opens Scrum from the shared view switch without changing tasks or the saved collection view', async () => {
    const taskId = store.getState().createTask(projectId, { title: 'Keep execution context', status: 'review' });
    await renderBoard();
    act(() => Simulate.click(button('List view')));
    act(() => Simulate.click(button('Scrum')));
    expect(store.getState().surface).toBe('scrum');
    expect(localStorage.getItem(VIEW_KEY)).toBe('list');
    expect(store.getState().tasks[taskId]).toMatchObject({ title: 'Keep execution context', status: 'review', projectId });
  });

  it('keeps the same project tasks and combined filters when switching views', async () => {
    const release = store.getState().createTask(projectId, { title: 'Release website', priority: 'high', description: 'Ship the landing page' });
    store.getState().createTask(projectId, { title: 'Release announcement', priority: 'low', status: 'doing' });
    store.getState().createTask(projectId, { title: 'Review analytics', priority: 'high', status: 'review' });
    const otherProject = store.getState().createProject('Other project');
    store.getState().createTask(otherProject, { title: 'Release another product', priority: 'high' });
    await renderBoard();
    expect(visibleTaskTitles()).toEqual(['Release announcement', 'Release website', 'Review analytics']);

    changeFilter('Search tasks', 'release');
    changeFilter('Priority', 'high');
    expect(visibleTaskTitles()).toEqual(['Release website']);
    act(() => Simulate.click(button('List view')));
    expect(visibleTaskTitles()).toEqual(['Release website']);
    expect(host.querySelector<HTMLInputElement>('[aria-label="Search tasks"]')!.value).toBe('release');
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Priority"]')!.value).toBe('high');

    changeFilter('Search tasks', taskReference(store.getState().tasks[release]));
    expect(visibleTaskTitles()).toEqual(['Release website']);
    act(() => Simulate.click(button('Board view')));
    expect(visibleTaskTitles()).toEqual(['Release website']);
    changeFilter('Search tasks', 'no matching task');
    expect(visibleTaskTitles()).toEqual([]);
    changeFilter('Search tasks', '');
    changeFilter('Priority', '');
    expect(visibleTaskTitles()).toEqual(['Release announcement', 'Release website', 'Review analytics']);
  });

  it('restores the selected task view after remounting', async () => {
    store.getState().createTask(projectId, { title: 'Keep the chosen view' });
    await renderBoard();
    act(() => Simulate.click(button('List view')));
    expect(localStorage.getItem(VIEW_KEY)).toBe('list');
    act(() => root.unmount());
    root = createRoot(host);
    await renderBoard();
    expect(button('List view').getAttribute('aria-pressed')).toBe('true');
    expect(button('Board view').getAttribute('aria-pressed')).toBe('false');
    expect(button('Collapse To do').getAttribute('aria-expanded')).toBe('true');
    expect(visibleTaskTitles()).toEqual(['Keep the chosen view']);
  });

  it('collapses and expands list groups and opens the selected task for editing', async () => {
    const todo = store.getState().createTask(projectId, { title: 'Plan the release' });
    store.getState().createTask(projectId, { title: 'Build the release', status: 'doing' });
    const onEdit = vi.fn();
    await renderBoard(onEdit);
    act(() => Simulate.click(button('List view')));
    const collapse = button('Collapse To do');
    const content = document.getElementById(collapse.getAttribute('aria-controls')!)!;
    act(() => Simulate.click(collapse));
    expect(content.hidden).toBe(true);
    expect(button('Expand To do').getAttribute('aria-expanded')).toBe('false');
    expect(visibleTaskTitles()).toEqual(['Build the release']);
    act(() => Simulate.click(button('Expand To do')));
    expect(content.hidden).toBe(false);
    act(() => Simulate.click(button('Plan the release')));
    expect(onEdit).toHaveBeenCalledExactlyOnceWith(store.getState().tasks[todo]);
    expect(store.getState().tasks[todo].status).toBe('todo');
  });

  it('updates a task inline and shows the persisted status in either view', async () => {
    const taskId = store.getState().createTask(projectId, { title: 'Finish onboarding', description: 'Preserve context', priority: 'high' });
    await renderBoard();
    act(() => Simulate.click(button('List view')));
    changeFilter('Status: Finish onboarding', 'done');
    await act(async () => { await flushWorkspacePersistence(); });
    expect(store.getState().tasks[taskId]).toMatchObject({ status: 'done', description: 'Preserve context', priority: 'high' });
    expect(group('Done').textContent).toContain('Finish onboarding');
    expect(group('To do').textContent).not.toContain('Finish onboarding');
    act(() => Simulate.click(button('Board view')));
    expect(group('Done').textContent).toContain('Finish onboarding');
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Status: Finish onboarding"]')!.value).toBe('done');
    changeFilter('Status: Finish onboarding', 'doing');
    act(() => Simulate.click(button('List view')));
    expect(group('In progress').textContent).toContain('Finish onboarding');
    expect(store.getState().tasks[taskId].status).toBe('doing');
  });

  it.each(['board', 'list'])('keeps keyboard focus on the task when a status change moves it in %s view', async (view) => {
    store.getState().createTask(projectId, { title: 'Move with the keyboard' });
    let restoreFocus: FrameRequestCallback | undefined;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => { restoreFocus = callback; return 1; });
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    await renderBoard();
    if (view === 'list') act(() => Simulate.click(button('List view')));
    const previous = host.querySelector<HTMLSelectElement>('[aria-label="Status: Move with the keyboard"]')!;
    previous.focus();
    expect(document.activeElement).toBe(previous);
    changeFilter('Status: Move with the keyboard', 'doing');
    const moved = host.querySelector<HTMLSelectElement>('[aria-label="Status: Move with the keyboard"]')!;
    expect(moved).not.toBe(previous);
    expect(previous.isConnected).toBe(false);
    expect(moved.value).toBe('doing');
    expect(requestFrame).toHaveBeenCalledOnce();
    act(() => restoreFocus!(0));
    expect(document.activeElement).toBe(moved);
  });

  it('focuses the destination group when a keyboard status change moves a task into a collapsed group', async () => {
    store.getState().createTask(projectId, { title: 'Finish with the keyboard' });
    let restoreFocus: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { restoreFocus = callback; return 1; }));
    await renderBoard();
    act(() => Simulate.click(button('List view')));
    act(() => Simulate.click(button('Collapse Done')));
    const control = host.querySelector<HTMLSelectElement>('[aria-label="Status: Finish with the keyboard"]')!;
    control.focus();
    changeFilter('Status: Finish with the keyboard', 'done');
    expect(restoreFocus).toBeDefined();
    act(() => restoreFocus!(0));
    expect(document.activeElement).toBe(button('Expand Done'));
    expect(button('Expand Done').getAttribute('aria-expanded')).toBe('false');
    expect(visibleTaskTitles()).toEqual([]);
  });

  it('passes the chosen group status when adding work from either view', async () => {
    const onAdd = vi.fn();
    await renderBoard(vi.fn(), onAdd);
    act(() => Simulate.click(button('New task')));
    expect(onAdd).toHaveBeenLastCalledWith();
    const boardAdd = group('In progress').querySelector<HTMLButtonElement>('button[aria-label^="Add task"]')!;
    act(() => Simulate.click(boardAdd));
    expect(onAdd).toHaveBeenLastCalledWith('doing');
    act(() => Simulate.click(button('List view')));
    const listAdd = group('In review').querySelector<HTMLButtonElement>('button[aria-label^="Add task"]')!;
    act(() => Simulate.click(listAdd));
    expect(onAdd).toHaveBeenLastCalledWith('review');
    expect(onAdd).toHaveBeenCalledTimes(3);
    expect(Object.keys(store.getState().tasks)).toHaveLength(0);
  });

  it('moves a dragged task within this project and rejects a task from another project', async () => {
    const ownTask = store.getState().createTask(projectId, { title: 'Move this task' });
    const otherProject = store.getState().createProject('Separate project');
    const foreignTask = store.getState().createTask(otherProject, { title: 'Keep separate' });
    await renderBoard();
    const payload = new Map<string, string>();
    const transfer = {
      types: [TASK_DRAG_TYPE],
      getData: (type: string) => payload.get(type) ?? '',
      setData: (type: string, value: string) => { payload.set(type, value); },
      effectAllowed: 'none', dropEffect: 'none',
    };
    const card = button('Move this task').closest('article')!;
    act(() => Simulate.dragStart(card, { dataTransfer: transfer } as never));
    expect(payload.get(TASK_DRAG_TYPE)).toBe(ownTask);
    expect(transfer.effectAllowed).toBe('move');
    act(() => Simulate.dragOver(group('In progress'), { dataTransfer: transfer } as never));
    expect(transfer.dropEffect).toBe('move');
    await act(async () => {
      Simulate.drop(group('In progress'), { dataTransfer: transfer } as never);
      await flushWorkspacePersistence();
    });
    expect(store.getState().tasks[ownTask].status).toBe('doing');
    expect(group('In progress').textContent).toContain('Move this task');

    payload.set(TASK_DRAG_TYPE, foreignTask);
    await act(async () => {
      Simulate.drop(group('Done'), { dataTransfer: transfer } as never);
      await flushWorkspacePersistence();
    });
    expect(store.getState().tasks[foreignTask].status).toBe('todo');
    expect(store.getState().tasks[ownTask].status).toBe('doing');
    expect(visibleTaskTitles()).toEqual(['Move this task']);
  });
});
