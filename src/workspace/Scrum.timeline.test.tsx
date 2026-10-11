import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { useWorkspaceStore as store, flushWorkspacePersistence } from './store';
import { Scrum } from './Scrum';

let root: Root;
let host: HTMLDivElement;
let projectId: string;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ locale: 'en' });
  await store.persist.rehydrate();
  store.setState({ projects: {}, tasks: {}, sprints: {}, notes: {}, folders: {}, comments: {} });
  projectId = store.getState().createProject('Timeline project');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe('Scrum timeline navigation', () => {
  it('opens completed history and focuses the selected sprint without changing its data', async () => {
    const sprintId = store.getState().createSprint(projectId, { name: 'Completed cycle', goal: '', startDate: '2026-10-01', endDate: '2026-10-05' });
    store.getState().startSprint(sprintId);
    const taskId = store.getState().createTask(projectId, { title: 'Delivered work', sprintId, status: 'done' });
    store.getState().completeSprint(sprintId);
    const onEdit = vi.fn();
    await act(async () => { root.render(<Scrum projectId={projectId} onEdit={onEdit} onAdd={() => {}} />); await flushWorkspacePersistence(); });
    const history = host.querySelector<HTMLDetailsElement>('details')!;
    const scroll = vi.fn(); history.scrollIntoView = scroll;
    expect(history.open).toBe(false);
    expect(host.textContent).not.toContain('Your first cycle starts here');
    const timelineButton = host.querySelector<HTMLButtonElement>('.ws-timeline-row')!;
    expect(timelineButton.getAttribute('aria-label')).toContain('Completed cycle');
    expect(timelineButton.getAttribute('aria-label')).toContain('Completed');
    act(() => Simulate.click(timelineButton));
    expect(history.open).toBe(true);
    expect(document.activeElement).toBe(history.querySelector('summary'));
    expect(scroll).toHaveBeenCalledOnce();
    expect(store.getState().sprints[sprintId].status).toBe('completed');
    expect(history.textContent).toContain('Delivered work');
    expect(history.querySelector('select')).toBeNull();
    expect(history.querySelector('[aria-label="Status: Done"]')).not.toBeNull();
    act(() => Simulate.click(history.querySelector<HTMLButtonElement>('button')!));
    expect(onEdit).toHaveBeenCalledWith(store.getState().tasks[taskId]);
  });

  it('keeps task assignment editable and updates sprint progress from the shared task status', async () => {
    const sprintId = store.getState().createSprint(projectId, { name: 'Delivery cycle', goal: '', startDate: '2026-10-08', endDate: '2026-10-22' });
    store.getState().createTask(projectId, { title: 'Delivered work', sprintId, status: 'done' });
    const taskId = store.getState().createTask(projectId, { title: 'Next delivery' });
    await act(async () => { root.render(<Scrum projectId={projectId} onEdit={() => {}} onAdd={() => {}} />); await flushWorkspacePersistence(); });
    const progress = host.querySelector<HTMLProgressElement>('progress[aria-label="Delivery cycle: Completed"]')!;
    expect(progress.value).toBe(1);
    expect(progress.max).toBe(1);

    const assignment = host.querySelector<HTMLSelectElement>('select[aria-label="Assign sprint: Next delivery"]')!;
    act(() => { assignment.value = sprintId; Simulate.change(assignment); });
    expect(store.getState().tasks[taskId].sprintId).toBe(sprintId);
    expect(progress.value).toBe(1);
    expect(progress.max).toBe(2);

    const status = host.querySelector<HTMLSelectElement>('select[aria-label="Status: Next delivery"]')!;
    act(() => { status.value = 'done'; Simulate.change(status); });
    expect(store.getState().tasks[taskId].status).toBe('done');
    expect(progress.value).toBe(2);
    expect(progress.getAttribute('aria-valuetext')).toBe('2/2 completed');
  });
});
