import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExpandedChrome } from './ExpandedChrome';

let host: HTMLDivElement, root: Root;
const restore = vi.fn();
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); restore.mockClear();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
function render(expanded = true, portal?: HTMLElement) {
  act(() => root.render(<ExpandedChrome expanded={expanded} label="Sketch" onRestore={restore}>
    <input aria-label="Title" defaultValue="Preserved" />
    <button onClick={restore}>Restore</button>
    {portal && createPortal(<input aria-label="Dialog input" />, portal)}
  </ExpandedChrome>));
}
const trigger = () => host.querySelector<HTMLButtonElement>('[aria-label="Mostrar controles"]')!;
const title = () => host.querySelector<HTMLInputElement>('[aria-label="Title"]')!;
const hidden = () => !!title().closest('[hidden]');
const pointer = (target: Element) => act(() => target.dispatchEvent(new Event('pointerdown', { bubbles: true })));

it('keeps the same controls and typed values mounted across expansion', () => {
  render(false); const original = title(); original.value = 'Draft';
  expect(hidden()).toBe(false); expect(trigger().hidden).toBe(true);
  render(true); expect(hidden()).toBe(true); expect(title()).toBe(original);
  act(() => trigger().click()); expect(hidden()).toBe(false);
  render(false); expect(title()).toBe(original); expect(title().value).toBe('Draft'); expect(hidden()).toBe(false);
});
it('reveals on mouse hover and hides on leaving without focused controls', () => {
  render();
  act(() => Simulate.pointerEnter(trigger().parentElement!, { pointerType: 'mouse' } as never)); expect(hidden()).toBe(false);
  act(() => Simulate.pointerLeave(trigger().parentElement!)); expect(hidden()).toBe(true);
});
it('opens on touch activation and closes when touching the content outside', () => {
  render();
  act(() => Simulate.pointerEnter(trigger().parentElement!, { pointerType: 'touch' } as never)); expect(hidden()).toBe(true);
  act(() => trigger().click()); expect(hidden()).toBe(false);
  pointer(document.body); expect(hidden()).toBe(true);
});
it('hides after hover even when the collapsed handle retained focus from maximizing', () => {
  render(false); act(() => title().focus()); render(true);
  act(() => Simulate.pointerEnter(trigger().parentElement!, { pointerType: 'mouse' } as never)); expect(hidden()).toBe(false);
  act(() => Simulate.pointerLeave(trigger().parentElement!)); expect(hidden()).toBe(true);
});
it('lets a minimized popup stay in the DOM without blocking Escape', () => {
  const popup = document.createElement('section'); popup.setAttribute('role', 'dialog'); popup.hidden = true; document.body.append(popup);
  try {
    render(); act(() => trigger().click());
    act(() => trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(hidden()).toBe(true); expect(restore).not.toHaveBeenCalled();
  } finally { popup.remove(); }
});
it('reveals on keyboard focus and dismisses with Escape before restoring', () => {
  render(); act(() => trigger().focus()); expect(hidden()).toBe(false);
  act(() => title().focus());
  const escape = () => act(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  escape(); expect(hidden()).toBe(true); expect(document.activeElement).toBe(trigger()); expect(restore).not.toHaveBeenCalled();
  escape(); expect(restore).toHaveBeenCalledOnce();
});
it('moves focus out of hidden controls on expansion, leaving editor selection untouched', () => {
  render(false); const input = title(); act(() => input.focus()); input.setSelectionRange(2, 5);
  render(true); expect(hidden()).toBe(true); expect(document.activeElement).toBe(trigger()); expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
  render(false); expect(document.activeElement).toBe(input);
});
it('does not reveal or consume Escape from a portaled dialog', () => {
  const portal = document.createElement('div'); portal.setAttribute('role', 'dialog'); document.body.append(portal);
  try {
    render(true, portal);
    const input = portal.querySelector<HTMLInputElement>('input')!;
    act(() => input.focus()); expect(hidden()).toBe(true);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => input.dispatchEvent(event)); expect(event.defaultPrevented).toBe(false); expect(restore).not.toHaveBeenCalled();
  } finally { portal.remove(); }
});
