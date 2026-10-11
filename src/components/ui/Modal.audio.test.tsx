import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AudioTextarea } from '@/audio/AudioField';
import { createAudioRecording, type AudioRecording } from '@/audio/recording';
import { hasActiveDataIngestions } from '@/cloud/activity';
import { useLocaleStore } from '@/i18n';
import { Modal } from './Modal';

vi.mock('@/audio/recording', () => ({ createAudioRecording: vi.fn() }));

let host: HTMLDivElement, root: Root;
let recording: AudioRecording;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ locale: 'en' });
  recording = { mimeType: 'audio/wav', stop: vi.fn(async () => [new Blob(['RIFF0000WAVEdata'], { type: 'audio/wav' })]), cancel: vi.fn() };
  vi.mocked(createAudioRecording).mockReset().mockResolvedValue(recording);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.restoreAllMocks();
  expect(hasActiveDataIngestions()).toBe(false);
});

it('cancels the nested dictation strip with Escape before closing the owning modal', async () => {
  const close = vi.fn();
  act(() => root.render(<Modal open title="Edit note" onClose={close}>
    <AudioTextarea aria-label="Note content" value="Review notes" onChange={() => {}} />
  </Modal>));
  const field = document.querySelector<HTMLTextAreaElement>('[aria-label="Note content"]')!;
  act(() => field.focus());
  const mic = document.querySelector<HTMLButtonElement>('.audio-field-mic')!;
  expect(mic.getAttribute('aria-label')).toBe('Dictate text');
  await act(async () => mic.click());
  expect(createAudioRecording).toHaveBeenCalledOnce();
  const popup = document.querySelector<HTMLElement>('.audio-field-popup')!;
  expect(popup).not.toBeNull();
  act(() => popup.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(document.querySelector('.audio-field-popup')).toBeNull();
  expect(recording.cancel).toHaveBeenCalledOnce();
  expect(recording.stop).not.toHaveBeenCalled();
  expect(hasActiveDataIngestions()).toBe(false);
  expect(close).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(field);
  act(() => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(close).toHaveBeenCalledOnce();
});
