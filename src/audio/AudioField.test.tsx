import { act, createRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hasActiveDataIngestions } from '@/cloud/activity';
import { useLocaleStore } from '@/i18n';
import { AudioTextarea, AudioTextInput } from './AudioField';
import { createAudioRecording, type AudioRecording } from './recording';
import { DEFAULT_AUDIO_MODEL, transcribeAudio } from './transcription';

vi.mock('./recording', () => ({ createAudioRecording: vi.fn() }));
vi.mock('./transcription', async () => ({ ...await vi.importActual('./limits'), transcribeAudio: vi.fn() }));
let root: Root, host: HTMLDivElement, source: AudioRecording;
const clip = () => new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: 'audio/webm' });
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ locale: 'pt-BR' });
  vi.mocked(createAudioRecording).mockReset(); vi.mocked(transcribeAudio).mockReset();
  source = { mimeType: 'audio/webm', stop: vi.fn(async () => [clip()]), cancel: vi.fn() };
  vi.mocked(createAudioRecording).mockResolvedValue(source);
  vi.mocked(transcribeAudio).mockResolvedValue({ text: 'ditado', model: DEFAULT_AUDIO_MODEL });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  expect(hasActiveDataIngestions()).toBe(false);
});
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const original = () => host.querySelector<HTMLTextAreaElement | HTMLInputElement>('[data-audio-input]')!;
const panel = () => host.querySelector<HTMLElement>('.audio-field-popup')!;
async function record() { await act(async () => button('Ditar texto').click()); }
async function confirm(text = 'ditado') {
  vi.mocked(transcribeAudio).mockResolvedValue({ text, model: DEFAULT_AUDIO_MODEL });
  await act(async () => button('Confirmar ditado').click());
}
function type(input: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

it('starts from the microphone without configuration, player or automatic transmission', async () => {
  act(() => root.render(<AudioTextarea defaultValue="" />));
  expect(createAudioRecording).not.toHaveBeenCalled(); expect(button('Ditar texto')?.type).toBe('button');
  await record(); expect(createAudioRecording).toHaveBeenCalledOnce();
  expect(host.querySelector('select, audio, input[type=file], [data-audio-result]')).toBeNull();
  expect(transcribeAudio).not.toHaveBeenCalled(); expect(hasActiveDataIngestions()).toBe(true);
  act(() => vi.mocked(createAudioRecording).mock.calls[0][0].onDuration?.(65));
  expect(panel().textContent).toContain('1:05');
});
it('confirms and inserts once at the original selection with correct caret in onChange without form submission', async () => {
  const changes = vi.fn(), submit = vi.fn(), ref = createRef<HTMLTextAreaElement>();
  function Editor() { const [value, setValue] = useState('Antes antigo depois'); return <form onSubmit={event => { event.preventDefault(); submit(); }}><AudioTextarea ref={ref} value={value} onChange={event => { changes(event.target.value, event.target.selectionStart); setValue(event.target.value); }} /></form>; }
  act(() => root.render(<Editor />)); original().setSelectionRange(6, 12); await record(); await confirm('voz revisada');
  expect(changes).toHaveBeenCalledExactlyOnceWith('Antes voz revisada depois', 18);
  expect(ref.current?.value).toBe('Antes voz revisada depois'); expect(ref.current?.selectionStart).toBe(18);
  expect(submit).not.toHaveBeenCalled(); expect(panel()).toBeNull();
});
it('keeps inline editors mounted when focus moves through dictation controls', async () => {
  const ref = createRef<HTMLTextAreaElement>(), committed = vi.fn();
  function Editor() { const [editing, setEditing] = useState(true); return <>{editing && <AudioTextarea ref={ref} defaultValue="Rascunho" onBlur={event => { committed(event.currentTarget.value); setEditing(false); }} />}<button data-outside>Fora</button></>; }
  act(() => root.render(<Editor />)); act(() => ref.current!.focus()); await record();
  act(() => button('Confirmar ditado').focus()); act(() => button('Cancelar ditado').focus());
  expect(ref.current).not.toBeNull(); expect(committed).not.toHaveBeenCalled();
  act(() => host.querySelector<HTMLButtonElement>('[data-outside]')!.focus());
  expect(committed).toHaveBeenCalledExactlyOnceWith('Rascunho'); expect(ref.current).toBeNull();
});
it('restores field focus after confirmation without prematurely committing', async () => {
  const committed = vi.fn();
  act(() => root.render(<><AudioTextarea defaultValue="" onBlur={event => committed(event.currentTarget.value)} /><button data-outside>Fora</button></>));
  act(() => original().focus()); await record(); act(() => button('Confirmar ditado').focus()); await confirm();
  expect(document.activeElement).toBe(original()); expect(committed).not.toHaveBeenCalled();
  act(() => host.querySelector<HTMLButtonElement>('[data-outside]')!.focus()); expect(committed).toHaveBeenCalledExactlyOnceWith('ditado');
});
it.each([{ disabled: true }, { readOnly: true }])('preserves native refs and excludes blocked controls (%j)', props => {
  const ref = createRef<HTMLInputElement>(); act(() => root.render(<AudioTextInput ref={ref} maxLength={160} value="Meu título" {...props} />));
  expect(ref.current?.value).toBe('Meu título'); expect(ref.current?.maxLength).toBe(160); expect(button('Ditar texto')).toBeNull();
});
it('retains the transcript without overwriting a field changed during transcription', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof transcribeAudio>>) => void;
  vi.mocked(transcribeAudio).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  function Editor() { const [value, setValue] = useState('Primeiro'); return <AudioTextarea value={value} onChange={event => setValue(event.target.value)} />; }
  act(() => root.render(<Editor />)); original().setSelectionRange(0, 8); await record();
  await act(async () => button('Confirmar ditado').click()); act(() => type(original(), 'Mudança local'));
  await act(async () => resolve({ text: 'novo', model: DEFAULT_AUDIO_MODEL }));
  expect(original().value).toBe('Mudança local'); expect(host.querySelector('[role=alert]')?.textContent).toContain('campo mudou');
  expect(button('Copiar texto')).not.toBeNull(); expect(transcribeAudio).toHaveBeenCalledOnce(); expect(button('Tentar novamente')).toBeNull();
});
it('preserves the draft on maxLength failure without truncating or paying again', async () => {
  act(() => root.render(<AudioTextarea defaultValue="abcXYZdef" maxLength={10} />)); original().setSelectionRange(3, 6);
  await record(); await confirm('12345'); expect(original().value).toBe('abcXYZdef');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('limite'); expect(button('Copiar texto')).not.toBeNull();
  expect(transcribeAudio).toHaveBeenCalledOnce(); expect(button('Tentar novamente')).toBeNull();
});
it('retries transcription only through an explicit action and retains the original recording', async () => {
  act(() => root.render(<AudioTextarea defaultValue="" />)); await record();
  vi.mocked(transcribeAudio).mockRejectedValueOnce(new Error('Sem conexão.'));
  await act(async () => button('Confirmar ditado').click()); expect(host.querySelector('[role=alert]')?.textContent).toBe('Sem conexão.');
  expect(transcribeAudio).toHaveBeenCalledOnce(); await act(async () => button('Tentar novamente').click());
  expect(transcribeAudio).toHaveBeenCalledTimes(2); expect(original().value).toBe('ditado'); expect(panel()).toBeNull();
});
it('prevents rapid confirmation from stopping or transcribing twice', async () => {
  act(() => root.render(<AudioTextarea defaultValue="" />)); await record();
  vi.mocked(transcribeAudio).mockImplementation(() => new Promise(() => {}));
  await act(async () => { button('Confirmar ditado').click(); button('Confirmar ditado').click(); });
  expect(source.stop).toHaveBeenCalledOnce(); expect(transcribeAudio).toHaveBeenCalledOnce();
});
it('aborts transcription on scope change and ignores late results', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof transcribeAudio>>) => void;
  vi.mocked(transcribeAudio).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  act(() => root.render(<AudioTextarea audioScope="project-1:field" value="Antigo" onChange={() => {}} />)); await record();
  await act(async () => button('Confirmar ditado').click()); const signal = vi.mocked(transcribeAudio).mock.calls[0][1]?.signal;
  act(() => root.render(<AudioTextarea audioScope="project-2:field" value="Novo" onChange={() => {}} />)); expect(signal?.aborted).toBe(true);
  await act(async () => resolve({ text: 'resultado antigo', model: DEFAULT_AUDIO_MODEL })); expect(original().value).toBe('Novo'); expect(panel()).toBeNull();
});
it('cancels acquisition and releases a recorder arriving after dismissal', async () => {
  let resolve!: (value: AudioRecording) => void;
  vi.mocked(createAudioRecording).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  act(() => root.render(<AudioTextarea defaultValue="" />)); await record(); const signal = vi.mocked(createAudioRecording).mock.calls[0][0].signal;
  act(() => button('Cancelar ditado').click()); expect(signal?.aborted).toBe(true);
  await act(async () => resolve(source)); expect(source.cancel).toHaveBeenCalledOnce(); expect(panel()).toBeNull();
});
it('cancels when the field becomes readonly', async () => {
  act(() => root.render(<AudioTextarea audioScope="note:field" defaultValue="Texto" />)); await record();
  act(() => root.render(<AudioTextarea audioScope="note:field" defaultValue="Texto" readOnly />));
  expect(panel()).toBeNull(); expect(button('Ditar texto')).toBeNull(); expect(source.cancel).toHaveBeenCalledOnce();
});
it('opens only one microphone request for immediate double activation', () => {
  vi.mocked(createAudioRecording).mockImplementationOnce(() => new Promise(() => {})); act(() => root.render(<AudioTextarea />));
  act(() => { button('Ditar texto').click(); button('Ditar texto').click(); }); expect(createAudioRecording).toHaveBeenCalledOnce();
});
it('stops at the time limit but requires confirmation before transcription', async () => {
  act(() => root.render(<AudioTextarea />)); await record(); await act(async () => vi.mocked(createAudioRecording).mock.calls[0][0].onLimit?.());
  expect(source.stop).toHaveBeenCalledOnce(); expect(transcribeAudio).not.toHaveBeenCalled();
  await confirm(); expect(source.stop).toHaveBeenCalledOnce(); expect(original().value).toBe('ditado');
});
it('permits an explicit retry after microphone permission denial', async () => {
  vi.mocked(createAudioRecording).mockRejectedValueOnce(new DOMException('Blocked', 'NotAllowedError'));
  act(() => root.render(<AudioTextarea />)); await record(); expect(host.querySelector('[role=alert]')?.textContent).toContain('Permita');
  await act(async () => button('Tentar novamente').click()); expect(createAudioRecording).toHaveBeenCalledTimes(2); expect(button('Confirmar ditado')).not.toBeNull();
});
it('contains Escape from the native field while dictating and leaves the draft untouched', async () => {
  const key = vi.fn(); act(() => root.render(<div onKeyDown={key}><AudioTextarea defaultValue="Texto" /></div>)); await record();
  act(() => original().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(source.cancel).toHaveBeenCalledOnce(); expect(key).not.toHaveBeenCalled(); expect(panel()).toBeNull(); expect(original().value).toBe('Texto');
});
it('handles dictation Escape before an inline field can revert or unmount its editor', async () => {
  const fieldKey = vi.fn();
  act(() => root.render(<AudioTextarea defaultValue="Texto" onKeyDown={fieldKey} />)); await record();
  act(() => original().focus());
  act(() => original().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(source.cancel).toHaveBeenCalledOnce(); expect(fieldKey).not.toHaveBeenCalled(); expect(panel()).toBeNull();
});
it('contains Enter on confirmation without sending the form or invoking editor shortcuts', async () => {
  const key = vi.fn(), submit = vi.fn(); act(() => root.render(<form onKeyDown={key} onSubmit={event => { event.preventDefault(); submit(); }}><AudioTextarea /></form>)); await record();
  act(() => button('Confirmar ditado').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  await confirm(); expect(submit).not.toHaveBeenCalled(); expect(key).not.toHaveBeenCalled();
});
it('releases capture and activity on unmount', async () => {
  act(() => root.render(<AudioTextarea />)); await record(); act(() => root.render(null));
  expect(source.cancel).toHaveBeenCalledOnce(); expect(hasActiveDataIngestions()).toBe(false);
});
it('normalizes line breaks for input and leaves text editable in the original field', async () => {
  const change = vi.fn(); function Editor() { const [value, setValue] = useState(''); return <AudioTextInput value={value} onChange={event => { change(event.target.value); setValue(event.target.value); }} />; }
  act(() => root.render(<Editor />)); await record(); await confirm('Título\nfalado');
  expect(change).toHaveBeenCalledExactlyOnceWith('Título falado'); act(() => type(original(), 'Título revisado')); expect(original().value).toBe('Título revisado');
});
it('does not start during native composition and chains composition handlers', async () => {
  const start = vi.fn(), end = vi.fn(); act(() => root.render(<AudioTextarea onCompositionStart={start} onCompositionEnd={end} />));
  act(() => original().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await record(); expect(createAudioRecording).not.toHaveBeenCalled(); expect(start).toHaveBeenCalledOnce();
  act(() => original().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await record(); expect(createAudioRecording).toHaveBeenCalledOnce(); expect(end).toHaveBeenCalledOnce();
});
