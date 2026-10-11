import { act, createRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hasActiveDataIngestions } from '@/cloud/activity';
import { useLocaleStore } from '@/i18n';
import { AudioDictationButton } from './AudioField';
import { createAudioRecording, type AudioRecording } from './recording';
import { DEFAULT_AUDIO_MODEL, transcribeAudio } from './transcription';

vi.mock('./recording', () => ({ createAudioRecording: vi.fn() }));
vi.mock('./transcription', async () => ({ ...await vi.importActual('./limits'), transcribeAudio: vi.fn() }));

let root: Root, host: HTMLDivElement, source: AudioRecording;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ locale: 'pt-BR' });
  vi.mocked(createAudioRecording).mockReset();
  vi.mocked(transcribeAudio).mockReset();
  source = {
    mimeType: 'audio/webm', cancel: vi.fn(),
    stop: vi.fn(async () => [new Blob(['recorded audio'], { type: 'audio/webm' })]),
  };
  vi.mocked(createAudioRecording).mockResolvedValue(source);
  vi.mocked(transcribeAudio).mockResolvedValue({ text: 'voz revisada', model: DEFAULT_AUDIO_MODEL });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  expect(hasActiveDataIngestions()).toBe(false);
});

const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const panel = () => host.querySelector('[role=dialog]');
async function record() { await act(async () => button('Ditar texto').click()); }
async function confirm() { await act(async () => button('Confirmar ditado').click()); }
function type(input: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

it('uses one toolbar microphone and inserts in the captured native selection with a caret visible to onChange', async () => {
  const ref = createRef<HTMLTextAreaElement>(), changes = vi.fn();
  function Editor() {
    const [value, setValue] = useState('Antes antigo depois');
    return <><textarea ref={ref} value={value} onChange={event => {
      changes(event.target.value, event.target.selectionStart);
      setValue(event.target.value);
    }} /><textarea defaultValue="Outro bloco" />
      <AudioDictationButton target={() => ref.current} audioScope="note:one" /></>;
  }
  act(() => root.render(<Editor />));
  expect(host.querySelectorAll('textarea')).toHaveLength(2);
  expect(host.querySelectorAll('button')).toHaveLength(1);
  ref.current!.setSelectionRange(6, 12);
  await record();
  await confirm();
  expect(changes).toHaveBeenCalledExactlyOnceWith('Antes voz revisada depois', 18);
  expect(ref.current!.value).toBe('Antes voz revisada depois');
  expect(ref.current!.selectionStart).toBe(18);
  expect(document.activeElement).toBe(ref.current);
  expect(panel()).toBeNull();
});

it('keeps the concrete target after focus and the target resolver move to another native field', async () => {
  const first = createRef<HTMLTextAreaElement>(), second = createRef<HTMLTextAreaElement>();
  let current: HTMLTextAreaElement | null = null;
  act(() => root.render(<><textarea ref={first} defaultValue="Primeiro" /><textarea ref={second} defaultValue="Segundo" />
    <AudioDictationButton target={() => current} audioScope="note:one" /></>));
  current = first.current;
  first.current!.setSelectionRange(0, 8);
  await record();
  act(() => second.current!.focus());
  current = second.current;
  await confirm();
  expect(first.current!.value).toBe('voz revisada');
  expect(second.current!.value).toBe('Segundo');
});

it('retains the transcript for copying when the native target changes during transcription', async () => {
  let resolve!: (result: Awaited<ReturnType<typeof transcribeAudio>>) => void;
  vi.mocked(transcribeAudio).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const ref = createRef<HTMLTextAreaElement>();
  act(() => root.render(<><textarea ref={ref} defaultValue="Original" /><AudioDictationButton target={() => ref.current} audioScope="note:one" /></>));
  await record();
  await confirm();
  act(() => type(ref.current!, 'Edição local'));
  await act(async () => resolve({ text: 'resultado atrasado', model: DEFAULT_AUDIO_MODEL }));
  expect(ref.current!.value).toBe('Edição local');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('campo mudou');
  expect(button('Copiar texto')).not.toBeNull();
});

it('cancels the old note transcription on scope change and ignores a late result on a reused textarea', async () => {
  let resolve!: (result: Awaited<ReturnType<typeof transcribeAudio>>) => void;
  vi.mocked(transcribeAudio).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const ref = createRef<HTMLTextAreaElement>();
  const editor = (scope: string, value: string) => <><textarea ref={ref} value={value} onChange={() => {}} />
    <AudioDictationButton target={() => ref.current} audioScope={scope} /></>;
  act(() => root.render(editor('note:one', 'Antiga')));
  await record();
  await confirm();
  const signal = vi.mocked(transcribeAudio).mock.calls[0][1]?.signal;
  act(() => root.render(editor('note:two', 'Nova')));
  expect(signal?.aborted).toBe(true);
  expect(panel()).toBeNull();
  await act(async () => resolve({ text: 'da nota anterior', model: DEFAULT_AUDIO_MODEL }));
  expect(ref.current!.value).toBe('Nova');
  expect(hasActiveDataIngestions()).toBe(false);
});

it('cancels capture if the native target is removed and never inserts into its replacement', async () => {
  const ref = createRef<HTMLTextAreaElement>();
  const editor = (replacement: boolean) => <><textarea key={String(replacement)} ref={ref} defaultValue={replacement ? 'Novo bloco' : 'Bloco antigo'} />
    <AudioDictationButton target={() => ref.current} audioScope="note:one" /></>;
  act(() => root.render(editor(false)));
  await record();
  await act(async () => root.render(editor(true)));
  expect(panel()).toBeNull();
  expect(ref.current!.value).toBe('Novo bloco');
  expect(source.cancel).toHaveBeenCalledOnce();
  expect(hasActiveDataIngestions()).toBe(false);
});

it('tracks composition from native fields before activation and permits dictation after composition ends', async () => {
  const ref = createRef<HTMLTextAreaElement>();
  act(() => root.render(<><textarea ref={ref} /><AudioDictationButton target={() => ref.current} /></>));
  act(() => ref.current!.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await record();
  expect(panel()).toBeNull();
  expect(createAudioRecording).not.toHaveBeenCalled();
  act(() => ref.current!.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await record();
  expect(panel()).not.toBeNull();
});

it('allows a different native field to dictate when the previous field never ends its composition', async () => {
  const first = createRef<HTMLTextAreaElement>(), second = createRef<HTMLTextAreaElement>();
  let current: HTMLTextAreaElement | null = null;
  act(() => root.render(<><textarea ref={first} /><textarea ref={second} defaultValue="Segundo" />
    <AudioDictationButton target={() => current} /></>));
  current = first.current;
  act(() => first.current!.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  current = second.current;
  second.current!.setSelectionRange(0, 7);
  await record();
  expect(panel()).not.toBeNull();
  await confirm();
  expect(second.current!.value).toBe('voz revisada');
});

it('keeps the native focus and selection while pressing the toolbar microphone', async () => {
  const ref = createRef<HTMLTextAreaElement>();
  act(() => root.render(<><textarea ref={ref} defaultValue="Antes antigo depois" />
    <AudioDictationButton target={() => document.activeElement instanceof HTMLTextAreaElement ? document.activeElement : null} /></>));
  act(() => ref.current!.focus());
  ref.current!.setSelectionRange(6, 12);
  const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  act(() => button('Ditar texto').dispatchEvent(press));
  expect(press.defaultPrevented).toBe(true);
  await record();
  await confirm();
  expect(ref.current!.value).toBe('Antes voz revisada depois');
});

it('cancels from Escape in the external field before editor keyboard shortcuts run', async () => {
  const ref = createRef<HTMLTextAreaElement>(), shortcut = vi.fn();
  act(() => root.render(<div onKeyDown={shortcut}><textarea ref={ref} defaultValue="Rascunho" />
    <AudioDictationButton target={() => ref.current} /></div>));
  await record();
  act(() => ref.current!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(panel()).toBeNull();
  expect(ref.current!.value).toBe('Rascunho');
  expect(shortcut).not.toHaveBeenCalled();
  expect(source.cancel).toHaveBeenCalledOnce();
});

it('preserves an in-progress native composition when transcription completes', async () => {
  let resolve!: (result: Awaited<ReturnType<typeof transcribeAudio>>) => void;
  vi.mocked(transcribeAudio).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const ref = createRef<HTMLTextAreaElement>();
  act(() => root.render(<><textarea ref={ref} defaultValue="Rascunho" /><AudioDictationButton target={() => ref.current} /></>));
  await record();
  await confirm();
  act(() => ref.current!.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await act(async () => resolve({ text: 'ditado', model: DEFAULT_AUDIO_MODEL }));
  expect(ref.current!.value).toBe('Rascunho');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('conclusão da digitação');
  expect(button('Copiar texto')).not.toBeNull();
});

it('does not acquire the microphone for a missing or readonly target and exposes a disabled toolbar button', async () => {
  const ref = createRef<HTMLTextAreaElement>();
  act(() => root.render(<AudioDictationButton target={() => null} />));
  await record();
  expect(panel()).toBeNull();
  act(() => root.render(<><textarea ref={ref} readOnly /><AudioDictationButton target={() => ref.current} /></>));
  await record();
  expect(panel()).toBeNull();
  act(() => root.render(<AudioDictationButton target={() => null} disabled />));
  expect(button('Ditar texto').disabled).toBe(true);
  expect(createAudioRecording).not.toHaveBeenCalled();
});

it('cancels pending capture on unmount and releases a recorder that arrives late', async () => {
  let resolve!: (recording: AudioRecording) => void;
  vi.mocked(createAudioRecording).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const ref = createRef<HTMLTextAreaElement>();
  act(() => root.render(<><textarea ref={ref} /><AudioDictationButton target={() => ref.current} /></>));
  await record();
  const signal = vi.mocked(createAudioRecording).mock.calls[0][0].signal;
  act(() => root.render(null));
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve(source));
  expect(source.cancel).toHaveBeenCalledOnce();
  expect(hasActiveDataIngestions()).toBe(false);
});
