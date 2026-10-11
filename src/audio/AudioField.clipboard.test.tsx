import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLocaleStore } from '@/i18n';
import { hasActiveDataIngestions } from '@/cloud/activity';
import { AudioTextarea } from './AudioField';
import { createAudioRecording } from './recording';
import { DEFAULT_AUDIO_MODEL, transcribeAudio } from './transcription';

vi.mock('./recording', () => ({ createAudioRecording: vi.fn() }));
vi.mock('./transcription', async () => ({ ...await vi.importActual('./limits'), transcribeAudio: vi.fn() }));

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ locale: 'pt-BR' });
  vi.clearAllMocks();
  vi.mocked(createAudioRecording).mockReset();
  vi.mocked(transcribeAudio).mockReset();
  vi.mocked(createAudioRecording).mockResolvedValue({
    mimeType: 'audio/wav', cancel: vi.fn(),
    stop: vi.fn(async () => [new Blob(['RIFF0000WAVEdata'], { type: 'audio/wav' })]),
  });
  vi.mocked(transcribeAudio).mockResolvedValue({ text: 'ditado', model: DEFAULT_AUDIO_MODEL });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
async function confirmDictation() {
  await act(async () => button('Ditar texto').click());
  await act(async () => button('Confirmar ditado').click());
}
const capturedClip = () => new Blob(['RIFF0000WAVEdata'], { type: 'audio/wav' });

it('keeps completed clips after interruption and transcribes them in order only after confirmation', async () => {
  const clips = [capturedClip(), capturedClip()];
  vi.mocked(transcribeAudio)
    .mockResolvedValueOnce({ text: 'trecho um', model: DEFAULT_AUDIO_MODEL })
    .mockResolvedValueOnce({ text: 'trecho dois', model: DEFAULT_AUDIO_MODEL });
  act(() => root.render(<AudioTextarea defaultValue="Antes antigo depois" />));
  const field = host.querySelector<HTMLTextAreaElement>('[data-audio-input]')!;
  field.setSelectionRange(6, 12);
  await act(async () => button('Ditar texto').click());
  const capture = vi.mocked(createAudioRecording).mock.calls[0][0];
  act(() => capture.onError?.(new Error('O microfone foi desconectado.'), clips));
  expect(capture.signal?.aborted).toBe(true);
  expect(button('Confirmar ditado')).not.toBeNull();
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Confirme para transcrever');
  expect(field.value).toBe('Antes antigo depois');
  expect(transcribeAudio).not.toHaveBeenCalled();
  await act(async () => button('Confirmar ditado').click());
  expect(field.value).toBe('Antes trecho um trecho dois depois');
  expect(vi.mocked(transcribeAudio).mock.calls.map(call => call[0])).toEqual(clips);
  expect(hasActiveDataIngestions()).toBe(false);
});

it('cancels recovered clips without starting transcription or changing the draft', async () => {
  act(() => root.render(<AudioTextarea defaultValue="Rascunho" />));
  await act(async () => button('Ditar texto').click());
  act(() => vi.mocked(createAudioRecording).mock.calls[0][0].onError?.(new Error('Interrompida'), [capturedClip()]));
  expect(button('Confirmar ditado')).not.toBeNull();
  act(() => button('Cancelar ditado').click());
  expect(host.querySelector('[role=dialog]')).toBeNull();
  expect(host.querySelector<HTMLTextAreaElement>('[data-audio-input]')!.value).toBe('Rascunho');
  expect(transcribeAudio).not.toHaveBeenCalled();
  expect(hasActiveDataIngestions()).toBe(false);
});

it('discards recovered clips and late interruption callbacks when their field scope changes', async () => {
  act(() => root.render(<AudioTextarea audioScope="project-A:field" value="Antigo" onChange={() => {}} />));
  await act(async () => button('Ditar texto').click());
  const capture = vi.mocked(createAudioRecording).mock.calls[0][0];
  act(() => capture.onError?.(new Error('Interrompida'), [capturedClip()]));
  expect(button('Confirmar ditado')).not.toBeNull();
  act(() => root.render(<AudioTextarea audioScope="project-B:field" value="Novo" onChange={() => {}} />));
  act(() => capture.onError?.(new Error('Resposta tardia'), [capturedClip()]));
  expect(host.querySelector('[role=dialog]')).toBeNull();
  expect(host.querySelector<HTMLTextAreaElement>('[data-audio-input]')!.value).toBe('Novo');
  expect(transcribeAudio).not.toHaveBeenCalled();
  expect(hasActiveDataIngestions()).toBe(false);
});

it('keeps recovered clips ready when the pending stop rejects after reporting an interruption', async () => {
  vi.mocked(createAudioRecording).mockResolvedValueOnce({
    mimeType: 'audio/wav', cancel: vi.fn(),
    stop: vi.fn(async () => {
      vi.mocked(createAudioRecording).mock.calls[0][0].onError?.(new Error('Interrompida'), [capturedClip()]);
      throw new Error('O microfone foi desconectado.');
    }),
  });
  act(() => root.render(<AudioTextarea defaultValue="" />));
  await confirmDictation();
  expect(button('Confirmar ditado')).not.toBeNull();
  expect(button('Tentar novamente')).toBeNull();
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Confirme para transcrever');
  expect(transcribeAudio).not.toHaveBeenCalled();
  await act(async () => button('Confirmar ditado').click());
  expect(host.querySelector<HTMLTextAreaElement>('[data-audio-input]')!.value).toBe('ditado');
  expect(transcribeAudio).toHaveBeenCalledOnce();
});

it('requires a new explicit recording attempt after an interruption without completed clips', async () => {
  act(() => root.render(<AudioTextarea defaultValue="" />));
  await act(async () => button('Ditar texto').click());
  act(() => vi.mocked(createAudioRecording).mock.calls[0][0].onError?.(new Error('O microfone foi desconectado.')));
  expect(button('Confirmar ditado')).toBeNull();
  expect(button('Tentar novamente')).not.toBeNull();
  expect(transcribeAudio).not.toHaveBeenCalled();
  await act(async () => button('Tentar novamente').click());
  expect(createAudioRecording).toHaveBeenCalledTimes(2);
  expect(button('Confirmar ditado')).not.toBeNull();
});

it('keeps paid transcription retry on the explicit retry button after a failure', async () => {
  vi.mocked(transcribeAudio).mockRejectedValueOnce(new Error('Sem conexão.'));
  act(() => root.render(<AudioTextarea defaultValue="Rascunho" />));
  await confirmDictation();
  expect(button('Tentar novamente')).not.toBeNull();
  await act(async () => button('Ditar texto').click());
  expect(transcribeAudio).toHaveBeenCalledTimes(1);
  expect(host.querySelector<HTMLTextAreaElement>('[data-audio-input]')!.value).toBe('Rascunho');
  await act(async () => button('Tentar novamente').click());
  expect(transcribeAudio).toHaveBeenCalledTimes(2);
});

it('copies a transcript rejected by maxLength without replacing the draft or transcribing again', async () => {
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  act(() => root.render(<AudioTextarea defaultValue="a" maxLength={2} />));
  await confirmDictation();
  await act(async () => button('Copiar texto').click());
  expect(writeText).toHaveBeenCalledExactlyOnceWith('ditado');
  expect(host.querySelector('[role=status]')?.textContent).toBe('Texto copiado.');
  expect(host.querySelector<HTMLTextAreaElement>('[data-audio-input]')!.value).toBe('a');
  expect(transcribeAudio).toHaveBeenCalledOnce();
  expect(host.querySelector('.audio-field-copy-text')).toBeNull();
});

it('offers selected text for manual copying when the clipboard rejects access', async () => {
  const writeText = vi.fn(async () => { throw new DOMException('Denied', 'NotAllowedError'); });
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  act(() => root.render(<AudioTextarea defaultValue="a" maxLength={2} />));
  await confirmDictation();
  await act(async () => button('Copiar texto').click());
  const fallback = host.querySelector<HTMLTextAreaElement>('.audio-field-copy-text')!;
  expect(fallback.value).toBe('ditado');
  expect(fallback.readOnly).toBe(true);
  expect(document.activeElement).toBe(fallback);
  expect(fallback.selectionStart).toBe(0);
  expect(fallback.selectionEnd).toBe('ditado'.length);
  expect(host.querySelector<HTMLTextAreaElement>('[data-audio-input]')!.value).toBe('a');
  expect(transcribeAudio).toHaveBeenCalledOnce();
});
