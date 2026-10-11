import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { ExecutionHeader, type ExecutionView } from './ExecutionHeader';

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ locale: 'en' });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const button = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const renderHeader = () => {
  const changeView = vi.fn();
  const addTask = vi.fn();
  act(() => root.render(<ExecutionHeader title="Kanban" view="board" onViewChange={changeView}
    search={<input aria-label="Task search field" />} filters={<select aria-label="Priority"><option>All</option></select>}
    actions={<button aria-label="New task" onClick={addTask}>New task</button>} />));
  return { changeView, addTask };
};
const markCompactTriggerVisible = () => {
  const trigger = button('View and filter options');
  vi.spyOn(trigger, 'getClientRects').mockReturnValue([{ width: 44, height: 44 }] as unknown as DOMRectList);
  return trigger;
};

describe('compact execution header interactions', () => {
  it('opens search in place and focuses its single input', () => {
    renderHeader();
    const toggle = button('Search tasks');
    act(() => Simulate.click(toggle));
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(host.querySelector('input'));
    expect(host.querySelectorAll('input')).toHaveLength(1);
    act(() => Simulate.click(toggle));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('selects a view and restores focus before hiding the compact menu', () => {
    const { changeView } = renderHeader();
    const trigger = markCompactTriggerVisible();
    act(() => Simulate.click(trigger));
    const list = button('List view');
    list.focus();
    act(() => Simulate.click(list));
    expect(changeView).toHaveBeenCalledExactlyOnceWith('list');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    expect(button('Board view').getAttribute('aria-pressed')).toBe('true');
  });

  it('closes with Escape without changing a view or removing the filter', () => {
    const { changeView } = renderHeader();
    const trigger = markCompactTriggerVisible();
    act(() => Simulate.click(trigger));
    const filter = host.querySelector('select')!;
    filter.focus();
    act(() => Simulate.keyDown(filter, { key: 'Escape' }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    expect(changeView).not.toHaveBeenCalled();
    expect(host.querySelectorAll('select')).toHaveLength(1);
  });

  it('dismisses outside and leaves the independent create action usable', () => {
    const { changeView, addTask } = renderHeader();
    const trigger = button('View and filter options');
    act(() => Simulate.click(trigger));
    act(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    act(() => Simulate.click(button('New task')));
    expect(addTask).toHaveBeenCalledOnce();
    expect(changeView).not.toHaveBeenCalled();
  });

  it('does not focus a hidden desktop menu trigger when switching views', () => {
    const { changeView } = renderHeader();
    const scrum = button('Scrum');
    scrum.focus();
    act(() => Simulate.click(scrum));
    expect(changeView).toHaveBeenCalledExactlyOnceWith('scrum');
    expect(document.activeElement).toBe(scrum);
  });

  it('restores focus on the destination after a surface remount', () => {
    let afterCommit: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { afterCommit = callback; return 1; });
    function Views() {
      const [view, setView] = useState<ExecutionView>('board');
      return <ExecutionHeader key={view} title={view} view={view} onViewChange={setView} actions={<button>New</button>} />;
    }
    act(() => root.render(<Views />));
    const oldScrum = button('Scrum');
    oldScrum.focus();
    act(() => Simulate.click(oldScrum));
    expect(oldScrum.isConnected).toBe(false);
    act(() => afterCommit?.(0));
    expect(document.activeElement).toBe(button('Scrum'));
    expect(button('Scrum').getAttribute('aria-pressed')).toBe('true');
  });
});
