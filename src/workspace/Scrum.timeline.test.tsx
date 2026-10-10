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
    store.getState().createTask(projectId, { title: 'Delivered work', sprintId, status: 'done' });
    store.getState().completeSprint(sprintId);
    await act(async () => { root.render(<Scrum projectId={projectId} onEdit={() => {}} onAdd={() => {}} />); await flushWorkspacePersistence(); });
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
  });
});
