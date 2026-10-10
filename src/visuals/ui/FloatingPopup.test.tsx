import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { FloatingPopup } from './FloatingPopup';

let host: HTMLDivElement, root: Root;
const close = vi.fn(), minimize = vi.fn();
async function render(minimized = false) {
  await act(async () => root.render(<FloatingPopup kind="search" onClose={close} onMinimize={minimize} minimized={minimized}><textarea defaultValue="Keep this draft" /></FloatingPopup>));
}
async function pointer(target: Element, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  await act(async () => { target.dispatchEvent(event); });
}
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await useLocaleStore.persist.rehydrate(); useLocaleStore.setState({ locale: 'en' });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  close.mockClear(); minimize.mockClear(); await render();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('fits above a virtual keyboard without saving temporary dimensions or replacing the draft', async () => {
  vi.stubGlobal('innerWidth', 390); vi.stubGlobal('innerHeight', 844);
  const viewport = Object.assign(new EventTarget(), { width:390, height:844, offsetLeft:0, offsetTop:0 });
  vi.stubGlobal('visualViewport', viewport);
  const frame = { x:10, y:110, width:360, height:620 }, change = vi.fn();
  await act(async () => root.render(<FloatingPopup key="keyboard" kind="model" frame={frame} onFrameChange={change} onClose={close} onMinimize={minimize}><textarea defaultValue="Keep the mobile draft" /></FloatingPopup>));
  const panel = host.querySelector<HTMLElement>('[data-visual-popup]')!, draft = host.querySelector('textarea')!;
  expect(panel.style.height).toBe('620px');
  await act(async () => { viewport.height = 320; viewport.dispatchEvent(new Event('resize')); });
  expect(parseFloat(panel.style.top) + parseFloat(panel.style.height)).toBeLessThanOrEqual(312);
  expect(change).not.toHaveBeenCalled();
  expect(host.querySelector('textarea')).toBe(draft);
  await act(async () => { viewport.offsetTop = 30; viewport.dispatchEvent(new Event('scroll')); });
  expect(parseFloat(panel.style.top)).toBeGreaterThanOrEqual(38);
  const header = host.querySelector('header')!;
  await pointer(header, 'pointerdown', 40, 50); await pointer(header, 'pointermove', 50, 70); await pointer(header, 'pointerup', 50, 70);
  expect(change.mock.calls.at(-1)?.[0]).toMatchObject({ width:360, height:620 });
  await act(async () => { viewport.height = 844; viewport.offsetTop = 0; viewport.dispatchEvent(new Event('resize')); });
  expect(panel.style.height).toBe('620px'); expect(panel.style.top).toBe('110px');
  expect(draft.value).toBe('Keep the mobile draft');
});

it('shrinks and grows the panel from its corner, clamps its bounds and supports keyboard resizing', async () => {
  const panel = host.querySelector<HTMLElement>('[data-visual-popup]')!;
  const handle = host.querySelector<HTMLElement>('[data-resize="se"]');
  expect(handle).not.toBeNull();
  const width = parseFloat(panel.style.width), height = parseFloat(panel.style.height);
  await pointer(handle!, 'pointerdown', 500, 600); await pointer(handle!, 'pointermove', 420, 520); await pointer(handle!, 'pointerup', 420, 520);
  expect(parseFloat(panel.style.width)).toBe(width - 80);
  expect(parseFloat(panel.style.height)).toBe(height - 80);
  await pointer(handle!, 'pointerdown', 420, 520); await pointer(handle!, 'pointermove', -2000, -2000); await pointer(handle!, 'pointerup', -2000, -2000);
  expect(parseFloat(panel.style.width)).toBe(320); expect(parseFloat(panel.style.height)).toBe(240);
  await act(async () => { handle!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
  expect(parseFloat(panel.style.width)).toBe(330);
  await pointer(handle!, 'pointerdown', 420, 520); await pointer(handle!, 'pointermove', 5000, 5000); await pointer(handle!, 'pointerup', 5000, 5000);
  expect(parseFloat(panel.style.left) + parseFloat(panel.style.width)).toBeLessThanOrEqual(window.innerWidth - 8);
  expect(parseFloat(panel.style.top) + parseFloat(panel.style.height)).toBeLessThanOrEqual(window.innerHeight - 8);
});

it('keeps the body mounted, its edited contents and its geometry while minimized', async () => {
  const panel = host.querySelector<HTMLElement>('[data-visual-popup]')!;
  const textarea = host.querySelector('textarea')!; textarea.value = 'An edited draft';
  const handle = host.querySelector<HTMLElement>('[data-resize="se"]'); expect(handle).not.toBeNull();
  await pointer(handle!, 'pointerdown', 500, 600); await pointer(handle!, 'pointermove', 450, 550); await pointer(handle!, 'pointerup', 450, 550);
  const geometry = panel.getAttribute('style');
  await render(true); expect(panel.hidden).toBe(true); expect(host.querySelector('textarea')).toBe(textarea);
  await render(false); expect(panel.hidden).toBe(false); expect(textarea.value).toBe('An edited draft');
  expect(panel.getAttribute('style')).toBe(geometry); expect(close).not.toHaveBeenCalled();
});

it('resizes from the opposite corner, keeps dragging available and fits a smaller viewport', async () => {
  const panel = host.querySelector<HTMLElement>('[data-visual-popup]')!;
  const opposite = host.querySelector('[data-resize="nw"]')!;
  const right = parseFloat(panel.style.left) + parseFloat(panel.style.width);
  await pointer(opposite, 'pointerdown', 20, 110); await pointer(opposite, 'pointermove', 60, 150); await pointer(opposite, 'pointerup', 60, 150);
  expect(parseFloat(panel.style.left)).toBe(60); expect(parseFloat(panel.style.top)).toBe(150);
  expect(parseFloat(panel.style.left) + parseFloat(panel.style.width)).toBe(right);
  const header = host.querySelector('header')!;
  await pointer(header, 'pointerdown', 100, 170); await pointer(header, 'pointermove', -500, -500); await pointer(header, 'pointerup', -500, -500);
  expect(parseFloat(panel.style.left)).toBe(8); expect(parseFloat(panel.style.top)).toBe(8);
  vi.stubGlobal('innerWidth', 390); vi.stubGlobal('innerHeight', 300);
  await act(async () => { window.dispatchEvent(new Event('resize')); });
  expect(parseFloat(panel.style.width)).toBe(374); expect(parseFloat(panel.style.height)).toBe(284);
});

it('uses a window-owned frame and reports drag, resize and viewport changes without swallowing tab content', async () => {
  const change = vi.fn(), focus = vi.fn();
  const frame = { x: 80, y: 90, width: 400, height: 400 };
  await act(async () => root.render(<FloatingPopup kind="model" frame={frame} onFrameChange={change} onFocus={focus} zIndex={88} windowId="w2" tabId="t2" tabs={<button data-tab-action>Model tab</button>} onClose={close} onMinimize={minimize}><div>Window contents</div></FloatingPopup>));
  const panel = host.querySelector<HTMLElement>('[data-visual-window="w2"]')!;
  expect(panel).not.toBeNull(); expect(panel.dataset.visualTab).toBe('t2');
  expect(panel.style.left).toBe('80px'); expect(panel.style.zIndex).toBe('88');
  expect(host.querySelector('[data-tab-action]')).not.toBeNull();
  await pointer(host.querySelector('header')!, 'pointerdown', 100, 100);
  await pointer(host.querySelector('header')!, 'pointermove', 130, 140);
  await pointer(host.querySelector('header')!, 'pointerup', 130, 140);
  expect(change).toHaveBeenLastCalledWith({ ...frame, x: 110, y: 130 });
  expect(focus).toHaveBeenCalled(); expect(panel.style.left).toBe('80px');
  await act(async () => { host.querySelector('[data-resize="se"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
  expect(change).toHaveBeenLastCalledWith({ ...frame, width: 390 });
  vi.stubGlobal('innerWidth', 390); vi.stubGlobal('innerHeight', 300);
  await act(async () => { window.dispatchEvent(new Event('resize')); });
  expect(change).toHaveBeenLastCalledWith({ x: 8, y: 8, width: 374, height: 284 });
});

it('does not start a window drag from header buttons', async () => {
  const change = vi.fn();
  await act(async () => root.render(<FloatingPopup kind="search" frame={{ x: 80, y: 90, width: 400, height: 400 }} onFrameChange={change} onClose={close} onMinimize={minimize}><p>Body</p></FloatingPopup>));
  const button = host.querySelector('header button')!;
  await pointer(button, 'pointerdown', 100, 100); await pointer(button, 'pointermove', 150, 150); await pointer(button, 'pointerup', 150, 150);
  expect(change).not.toHaveBeenCalled();
});

it('supports surface-specific action labels while preserving existing defaults', async () => {
  expect(host.querySelector('[aria-label="Minimize image search"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Close image search"]')).not.toBeNull();
  await act(async () => root.render(<FloatingPopup kind="model" title="Diagram" actionLabels={{ minimize: 'Minimize: Diagram', close: 'Close: Diagram' }} onClose={close} onMinimize={minimize}><p>Diagram</p></FloatingPopup>));
  const minimizeButton = host.querySelector<HTMLButtonElement>('[aria-label="Minimize: Diagram"]')!;
  expect(minimizeButton.title).toBe('Minimize: Diagram');
  expect(host.querySelector('[aria-label="Close: Diagram"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Close 3D studio"]')).toBeNull();
  await act(async () => { minimizeButton.click(); host.querySelector<HTMLButtonElement>('[aria-label="Close: Diagram"]')!.click(); });
  expect(minimize).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
});
