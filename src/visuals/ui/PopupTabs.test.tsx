import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { PopupTabs, type PopupTab } from './PopupTabs';

let host: HTMLDivElement, root: Root, pointDescriptor: PropertyDescriptor | undefined;
const select = vi.fn(), add = vi.fn(), close = vi.fn(), detach = vi.fn(), move = vi.fn();
const tabs: PopupTab[] = [
  { id: 'a', label: 'Arduino references', kind: 'search', activity: { state: 'running', label: 'Searching Arduino' } },
  { id: 'b', label: 'Servo geometry', kind: 'model', activity: { state: 'ready', label: 'Ready to review' } },
  { id: 'c', label: 'Torque diagram', kind: 'model', artifactKind: 'diagram', activity: { state: 'idle', label: '' } },
];
async function render(activeTabId = 'a') { await act(async () => root.render(<PopupTabs windowId="w1" tabs={tabs} activeTabId={activeTabId} onSelect={select} onNew={add} onClose={close} onDetach={detach} onMove={move} />)); }
async function key(target: Element, value: string) { await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })); }); await act(async () => { await new Promise(resolve => window.requestAnimationFrame(resolve)); }); }
async function pointer(target: EventTarget, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }); Object.defineProperty(event, 'pointerId', { value: 7 });
  await act(async () => { target.dispatchEvent(event); });
}
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await useLocaleStore.persist.rehydrate(); useLocaleStore.setState({ locale: 'en' });
  pointDescriptor = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  [select, add, close, detach, move].forEach(mock => mock.mockClear()); await render();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); if (pointDescriptor) Object.defineProperty(document, 'elementFromPoint', pointDescriptor); else Reflect.deleteProperty(document, 'elementFromPoint'); });

it('connects tabs to their panels, exposes progress and navigates with roving keyboard focus', async () => {
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  expect(buttons).toHaveLength(3); expect(buttons[0].id).toBe('visual-tab-a'); expect(buttons[0].getAttribute('aria-controls')).toBe('visual-panel-a');
  expect(buttons.map(button => button.tabIndex)).toEqual([0, -1, -1]); expect(buttons[0].getAttribute('aria-selected')).toBe('true');
  expect(buttons[0].getAttribute('aria-label')).toContain('Searching Arduino');
  await key(buttons[0], 'ArrowRight'); expect(select).toHaveBeenLastCalledWith('b'); expect(document.activeElement).toBe(buttons[1]);
  await key(buttons[1], 'End'); expect(select).toHaveBeenLastCalledWith('c');
  await key(buttons[2], 'Home'); expect(select).toHaveBeenLastCalledWith('a');
  await render('c'); expect(host.querySelector('#visual-tab-c')?.getAttribute('aria-selected')).toBe('true');
});

it('offers new, close and keyboard-accessible detach without treating the buttons as tab drags', async () => {
  const byLabel = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  await act(async () => { byLabel('New tab').click(); byLabel('Close tab: Servo geometry').click(); byLabel('Detach tab: Arduino references').click(); });
  expect(add).toHaveBeenCalledOnce(); expect(close).toHaveBeenLastCalledWith('b'); expect(detach).toHaveBeenLastCalledWith('a');
  detach.mockClear();
  await pointer(byLabel('Close tab: Servo geometry'), 'pointerdown', 30, 20); await pointer(window, 'pointermove', 500, 500); await pointer(window, 'pointerup', 500, 500);
  expect(detach).not.toHaveBeenCalled(); expect(move).not.toHaveBeenCalled();
});

it('detaches only a deliberate off-strip drag and keeps the original pointer position', async () => {
  const bar = host.querySelector<HTMLElement>('.visual-popup-tabs')!;
  vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ left: 10, right: 410, top: 10, bottom: 50, width: 400, height: 40, x: 10, y: 10, toJSON() {} });
  const tab = host.querySelector('#visual-tab-a')!;
  await pointer(tab, 'pointerdown', 40, 25); await pointer(window, 'pointermove', 43, 26); await pointer(window, 'pointerup', 43, 26);
  expect(detach).not.toHaveBeenCalled();
  await pointer(tab, 'pointerdown', 40, 25); await pointer(window, 'pointermove', 500, 200); await pointer(window, 'pointerup', 500, 200);
  expect(detach).toHaveBeenLastCalledWith('a', { x: 500, y: 200 }); expect(move).not.toHaveBeenCalled();
});

it('moves to the hit window and insertion point instead of detaching, and cancellation does nothing', async () => {
  const targetBar = document.createElement('div'); targetBar.className = 'visual-popup-tabs'; targetBar.dataset.windowId = 'w2';
  const target = document.createElement('button'); target.dataset.tabId = 'other'; target.setAttribute('role', 'tab'); targetBar.append(target); host.append(targetBar);
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ left: 400, right: 600, top: 10, bottom: 50, width: 200, height: 40, x: 400, y: 10, toJSON() {} });
  const tab = host.querySelector('#visual-tab-a')!;
  await pointer(tab, 'pointerdown', 40, 25); await pointer(window, 'pointermove', 430, 25); await pointer(window, 'pointerup', 430, 25);
  expect(move).toHaveBeenLastCalledWith('a', 'w2', 'other'); expect(detach).not.toHaveBeenCalled();
  move.mockClear(); await pointer(tab, 'pointerdown', 40, 25); await pointer(window, 'pointermove', 500, 200); await pointer(window, 'pointercancel', 500, 200);
  expect(move).not.toHaveBeenCalled(); expect(detach).not.toHaveBeenCalled();
});

it('reorders within the same strip at either side of a tab and appends when dropped at its end', async () => {
  const source = host.querySelector('#visual-tab-a')!, target = host.querySelector<HTMLElement>('#visual-tab-b')!;
  let hit: Element = target;
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => hit });
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 200, top: 10, bottom: 50, width: 100, height: 40, x: 100, y: 10, toJSON() {} });
  await pointer(source, 'pointerdown', 40, 25); await pointer(window, 'pointermove', 110, 25); await pointer(window, 'pointerup', 110, 25);
  expect(move).toHaveBeenLastCalledWith('a', 'w1', 'b');
  await pointer(source, 'pointerdown', 40, 25); await pointer(window, 'pointermove', 180, 25); await pointer(window, 'pointerup', 180, 25);
  expect(move).toHaveBeenLastCalledWith('a', 'w1', 'c');
  hit = host.querySelector('.visual-popup-tabs')!;
  await pointer(source, 'pointerdown', 40, 25); await pointer(window, 'pointermove', 350, 25); await pointer(window, 'pointerup', 350, 25);
  expect(move).toHaveBeenLastCalledWith('a', 'w1', undefined); expect(detach).not.toHaveBeenCalled();
});

it('restores keyboard focus to the newly mounted strip when selecting a tab moves its presentation', async () => {
  function Sessions() {
    const [active, setActive] = useState('a');
    return <>{tabs.map(tab => <section key={tab.id} hidden={active !== tab.id} data-session={tab.id}>
      {active === tab.id && <PopupTabs windowId="w1" tabs={tabs} activeTabId={active} onSelect={setActive} onNew={add} onClose={close} onDetach={detach} onMove={move} />}
    </section>)}</>;
  }
  await act(async () => root.render(<Sessions />));
  const original = host.querySelector<HTMLButtonElement>('#visual-tab-a')!;
  original.focus(); await key(original, 'ArrowRight');
  const current = host.querySelector<HTMLButtonElement>('#visual-tab-b')!;
  expect(original.isConnected).toBe(false); expect(current.getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(current);
  await key(current, 'End'); expect(document.activeElement).toBe(host.querySelector('#visual-tab-c'));
});

it('does not activate an inactive tab before its drag finishes', async () => {
  const inactive = host.querySelector('#visual-tab-b')!;
  await pointer(inactive, 'pointerdown', 40, 25); await pointer(window, 'pointermove', 500, 200);
  expect(select).not.toHaveBeenCalled(); expect(detach).not.toHaveBeenCalled();
  await pointer(window, 'pointerup', 500, 200);
  expect(detach).toHaveBeenLastCalledWith('b', { x: 500, y: 200 });
});
