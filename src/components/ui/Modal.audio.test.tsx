import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AudioTextarea } from '@/audio/AudioField';
import { Modal } from './Modal';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it('closes the nested audio popup with Escape before the owning modal', () => {
  const close = vi.fn();
  act(() => root.render(<Modal open title="Edit note" onClose={close}>
    <AudioTextarea aria-label="Note content" value="Review notes" onChange={() => {}} />
  </Modal>));
  const field = document.querySelector<HTMLTextAreaElement>('[aria-label="Note content"]')!;
  act(() => field.focus());
  act(() => document.querySelector<HTMLButtonElement>('.audio-field-mic')!.click());
  const popup = document.querySelector<HTMLElement>('.audio-field-popup')!;
  expect(popup).not.toBeNull();
  act(() => popup.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(document.querySelector('.audio-field-popup')).toBeNull();
  expect(close).not.toHaveBeenCalled();
  act(() => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(close).toHaveBeenCalledOnce();
});
