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
