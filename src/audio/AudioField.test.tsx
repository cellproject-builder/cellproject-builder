import { act, createRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hasActiveDataIngestions } from '@/cloud/activity';
import { useLocaleStore } from '@/i18n';
import { AudioTextarea, AudioTextInput } from './AudioField';
import { createAudioRecording, type AudioRecording } from './recording';
import { DEFAULT_AUDIO_MODEL, MAX_AUDIO_BYTES, transcribeAudio } from './transcription';

vi.mock('./recording', () => ({ createAudioRecording: vi.fn() }));
vi.mock('./transcription', async () => ({ ...await vi.importActual('./limits'), transcribeAudio: vi.fn() }));

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ locale: 'pt-BR' });
  vi.clearAllMocks();
  const NativeURL = URL;
  vi.stubGlobal('URL', class extends NativeURL { static createObjectURL = vi.fn(() => 'blob:audio-test'); static revokeObjectURL = vi.fn(); });
  vi.mocked(transcribeAudio).mockResolvedValue({ text: 'ditado', model: DEFAULT_AUDIO_MODEL });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const original = () => host.querySelector<HTMLTextAreaElement | HTMLInputElement>('[data-audio-input]')!;
const result = () => host.querySelector<HTMLTextAreaElement>('[data-audio-result]')!;
const clip = () => new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], 'voz.webm', { type: 'audio/webm' });
function type(input: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
async function importAudio(file = clip()) {
  act(() => button('Adicionar áudio').click());
  const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
  await act(async () => { Object.defineProperty(input, 'files', { value: [file], configurable: true }); input.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function transcript(text = 'ditado') {
  vi.mocked(transcribeAudio).mockResolvedValue({ text, model: DEFAULT_AUDIO_MODEL });
  await act(async () => button('Transcrever áudio').click());
}

it('opens audio explicitly without submitting and holds activity until Escape closes it', () => {
  const submit = vi.fn();
  act(() => root.render(<form onSubmit={event => { event.preventDefault(); submit(); }}><AudioTextarea aria-label="Pedido" defaultValue="Texto" /></form>));
  expect(button('Adicionar áudio')).not.toBeNull();
  expect(button('Adicionar áudio').type).toBe('button');
  act(() => button('Adicionar áudio').click());
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  expect(hasActiveDataIngestions()).toBe(true);
  act(() => host.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(hasActiveDataIngestions()).toBe(false);
  expect(submit).not.toHaveBeenCalled();
});

it('keeps the editor mounted when keyboard focus moves into audio controls and commits on leaving the wrapper', () => {
  const ref = createRef<HTMLTextAreaElement>(), committed = vi.fn();
  function Editor() {
    const [editing, setEditing] = useState(true);
    return <>{editing && <AudioTextarea ref={ref} defaultValue="Rascunho" onBlur={event => { committed(event.currentTarget.value); setEditing(false); }} />}<button data-outside>Fora</button></>;
  }
  act(() => root.render(<Editor />));
  expect(button('Adicionar áudio')).not.toBeNull();
  act(() => ref.current!.focus());
  act(() => button('Adicionar áudio').focus());
  expect(ref.current).not.toBeNull(); expect(committed).not.toHaveBeenCalled();
  act(() => host.querySelector<HTMLButtonElement>('[data-outside]')!.focus());
  expect(committed).toHaveBeenCalledExactlyOnceWith('Rascunho'); expect(ref.current).toBeNull();
});

it('preserves native refs and excludes disabled or readonly controls from audio', () => {
  const ref = createRef<HTMLInputElement>();
  act(() => root.render(<AudioTextInput ref={ref} aria-label="Título" maxLength={160} value="Meu título" readOnly />));
  expect(ref.current?.value).toBe('Meu título'); expect(ref.current?.maxLength).toBe(160);
  expect(button('Adicionar áudio')).toBeNull();
});

it('previews an imported clip before explicit transcription and inserts editable text through React onChange at the original selection', async () => {
  const changes = vi.fn(), submit = vi.fn(), ref = createRef<HTMLTextAreaElement>();
  function Editor() { const [value, setValue] = useState('Antes antigo depois'); return <form onSubmit={event => { event.preventDefault(); submit(); }}><AudioTextarea ref={ref} aria-label="Texto" value={value} onChange={event => { changes(event.target.value); setValue(event.target.value); }} /></form>; }
  act(() => root.render(<Editor />));
  original().setSelectionRange(6, 12);
  await importAudio();
  expect(host.querySelector('audio')?.getAttribute('src')).toBe('blob:audio-test'); expect(transcribeAudio).not.toHaveBeenCalled();
  await transcript('primeiro');
  act(() => type(result(), 'voz revisada'));
  act(() => button('Inserir texto').click());
  expect(changes).toHaveBeenCalledExactlyOnceWith('Antes voz revisada depois');
  expect(ref.current?.value).toBe('Antes voz revisada depois'); expect(ref.current?.selectionStart).toBe(18);
  expect(submit).not.toHaveBeenCalled(); expect(hasActiveDataIngestions()).toBe(false);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:audio-test');
});

it('keeps the editable result mounted after clearing the complete transcript', async () => {
  act(() => root.render(<AudioTextarea defaultValue="" />)); await importAudio(); await transcript();
  act(() => type(result(), ''));
  expect(result()).not.toBeNull();
  act(() => type(result(), 'revisto')); act(() => button('Inserir texto').click());
  expect(original().value).toBe('revisto');
});

it('rejects stale insertion until the user explicitly selects the current insertion position', async () => {
  function Editor() { const [value, setValue] = useState('Primeiro'); return <AudioTextarea value={value} onChange={event => setValue(event.target.value)} />; }
  act(() => root.render(<Editor />)); original().setSelectionRange(0, 8); await importAudio(); await transcript('novo');
  act(() => type(original(), 'Mudança local')); act(() => button('Inserir texto').click());
  expect(original().value).toBe('Mudança local'); expect(host.querySelector('[role=alert]')?.textContent).toContain('campo mudou');
  act(() => original().setSelectionRange(13, 13));
  act(() => [...host.querySelectorAll('button')].find(item => item.textContent === 'Usar seleção atual')!.click());
  act(() => button('Inserir texto').click()); expect(original().value).toBe('Mudança localnovo');
});

it('enforces maxLength without truncating or modifying text outside the selected range', async () => {
  act(() => root.render(<AudioTextarea defaultValue="abcXYZdef" maxLength={10} />)); original().setSelectionRange(3, 6);
  await importAudio(); await transcript('12345'); act(() => button('Inserir texto').click());
  expect(original().value).toBe('abcXYZdef'); expect(host.querySelector('[role=alert]')?.textContent).toContain('limite');
  act(() => type(result(), '12')); act(() => button('Inserir texto').click()); expect(original().value).toBe('abc12def');
});

it('keeps the clip after a network failure and permits only an explicit retry', async () => {
  act(() => root.render(<AudioTextarea defaultValue="" />)); await importAudio();
  vi.mocked(transcribeAudio).mockRejectedValueOnce(new Error('Sem conexão.'));
  await act(async () => button('Transcrever áudio').click());
  expect(host.querySelector('[role=alert]')?.textContent).toBe('Sem conexão.'); expect(host.querySelector('audio')).not.toBeNull(); expect(transcribeAudio).toHaveBeenCalledTimes(1);
  await transcript('recuperado'); expect(transcribeAudio).toHaveBeenCalledTimes(2); expect(result().value).toBe('recuperado');
});

it('prevents two immediate transcription clicks from issuing two paid operations', async () => {
  act(() => root.render(<AudioTextarea defaultValue="" />)); await importAudio();
  vi.mocked(transcribeAudio).mockImplementation(() => new Promise(() => {}));
  act(() => { button('Transcrever áudio').click(); button('Transcrever áudio').click(); });
  expect(transcribeAudio).toHaveBeenCalledTimes(1);
});

it('aborts transcription and revokes preview when scope changes, ignoring its late result', async () => {
  let resolve!: (value: { text: string; model: typeof DEFAULT_AUDIO_MODEL }) => void;
  vi.mocked(transcribeAudio).mockImplementation(() => new Promise(done => { resolve = done; }));
  act(() => root.render(<AudioTextarea audioScope="project-1:field" value="Antigo" readOnly={false} onChange={() => {}} />)); await importAudio();
  act(() => button('Transcrever áudio').click()); const signal = vi.mocked(transcribeAudio).mock.calls[0][1]?.signal;
  act(() => root.render(<AudioTextarea audioScope="project-2:field" value="Novo" onChange={() => {}} />));
  expect(signal?.aborted).toBe(true); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:audio-test'); expect(hasActiveDataIngestions()).toBe(false);
  await act(async () => resolve({ text: 'resultado antigo', model: DEFAULT_AUDIO_MODEL }));
  expect(original().value).toBe('Novo'); expect(host.querySelector('[role=dialog]')).toBeNull();
});

it('cancels and releases activity when the field becomes readonly', async () => {
  act(() => root.render(<AudioTextarea audioScope="note:field" defaultValue="Texto" />)); await importAudio();
  act(() => root.render(<AudioTextarea audioScope="note:field" defaultValue="Texto" readOnly />));
  expect(host.querySelector('[role=dialog]')).toBeNull(); expect(button('Adicionar áudio')).toBeNull(); expect(hasActiveDataIngestions()).toBe(false); expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
});

it('records only after a gesture, then stops into a playable preview without auto transcription', async () => {
  const source: AudioRecording = { mimeType: 'audio/webm', stop: vi.fn(async () => clip()), cancel: vi.fn() };
  vi.mocked(createAudioRecording).mockResolvedValue(source);
  act(() => root.render(<AudioTextarea defaultValue="" />)); act(() => button('Adicionar áudio').click()); expect(createAudioRecording).not.toHaveBeenCalled();
  await act(async () => button('Gravar áudio').click()); expect(button('Parar gravação')).not.toBeNull();
  act(() => vi.mocked(createAudioRecording).mock.calls[0][0].onDuration?.(65)); expect(host.querySelector('[role=status]')?.textContent).toContain('1:05');
  await act(async () => button('Parar gravação').click()); expect(source.stop).toHaveBeenCalledOnce(); expect(host.querySelector('audio')).not.toBeNull(); expect(transcribeAudio).not.toHaveBeenCalled();
});

it('opens only one microphone request for two immediate record activations', () => {
  vi.mocked(createAudioRecording).mockImplementation(() => new Promise(() => {}));
  act(() => root.render(<AudioTextarea />)); act(() => button('Adicionar áudio').click());
  act(() => { button('Gravar áudio').click(); button('Gravar áudio').click(); });
  expect(createAudioRecording).toHaveBeenCalledTimes(1);
});

it('collects a duration-limited recording once even when Stop is also activated immediately', async () => {
  let resolve!: (value: Blob) => void;
  const source: AudioRecording = { mimeType: 'audio/webm', stop: vi.fn(() => new Promise<Blob>(done => { resolve = done; })), cancel: vi.fn() };
  vi.mocked(createAudioRecording).mockResolvedValue(source);
  act(() => root.render(<AudioTextarea />)); act(() => button('Adicionar áudio').click()); await act(async () => button('Gravar áudio').click());
  act(() => { vi.mocked(createAudioRecording).mock.calls[0][0].onLimit?.(); button('Parar gravação').click(); });
  expect(source.stop).toHaveBeenCalledTimes(1);
  await act(async () => resolve(clip())); expect(host.querySelector('audio')).not.toBeNull(); expect(transcribeAudio).not.toHaveBeenCalled();
});

it('allows an explicit recording retry after microphone permission is denied', async () => {
  const source: AudioRecording = { mimeType: 'audio/webm', stop: vi.fn(), cancel: vi.fn() };
  vi.mocked(createAudioRecording).mockRejectedValueOnce(new DOMException('Blocked', 'NotAllowedError')).mockResolvedValueOnce(source);
  act(() => root.render(<AudioTextarea />)); act(() => button('Adicionar áudio').click());
  await act(async () => button('Gravar áudio').click()); expect(host.querySelector('[role=alert]')?.textContent).toContain('Permita');
  await act(async () => button('Gravar áudio').click()); expect(createAudioRecording).toHaveBeenCalledTimes(2); expect(button('Parar gravação')).not.toBeNull();
});

it('preserves the blur edit session while focus moves through the popup and editable result', async () => {
  const committed = vi.fn();
  act(() => root.render(<><AudioTextarea defaultValue="Rascunho" onBlur={event => committed(event.currentTarget.value)} /><button data-outside>Fora</button></>));
  act(() => original().focus()); await importAudio();
  expect(document.activeElement).toBe(host.querySelector('[role=dialog]'));
  act(() => button('Gravar áudio').focus());
  act(() => host.querySelector<HTMLSelectElement>('select')!.focus());
  await transcript(); act(() => result().focus());
  expect(committed).not.toHaveBeenCalled();
  act(() => host.querySelector<HTMLButtonElement>('[data-outside]')!.focus());
  expect(committed).toHaveBeenCalledExactlyOnceWith('Rascunho');
});

it('cancels a recorder that resolves after its permission prompt was dismissed', async () => {
  let resolve!: (value: AudioRecording) => void;
  vi.mocked(createAudioRecording).mockImplementation(() => new Promise(done => { resolve = done; }));
  const source: AudioRecording = { mimeType: 'audio/webm', stop: vi.fn(), cancel: vi.fn() };
  act(() => root.render(<AudioTextarea defaultValue="" />)); act(() => button('Adicionar áudio').click()); act(() => button('Gravar áudio').click());
  const signal = vi.mocked(createAudioRecording).mock.calls[0][0].signal;
  act(() => button('Cancelar áudio').click()); expect(signal?.aborted).toBe(true); expect(hasActiveDataIngestions()).toBe(false);
  await act(async () => resolve(source)); expect(source.cancel).toHaveBeenCalledOnce(); expect(host.querySelector('[role=dialog]')).toBeNull();
});

it('stops active recording and contains Escape without invoking the editor shortcut', async () => {
  const source: AudioRecording = { mimeType: 'audio/webm', stop: vi.fn(), cancel: vi.fn() }, key = vi.fn();
  vi.mocked(createAudioRecording).mockResolvedValue(source);
  act(() => root.render(<div onKeyDown={key}><AudioTextarea defaultValue="Texto" /></div>)); act(() => button('Adicionar áudio').click()); await act(async () => button('Gravar áudio').click());
  act(() => button('Parar gravação').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(source.cancel).toHaveBeenCalledOnce(); expect(key).not.toHaveBeenCalled(); expect(hasActiveDataIngestions()).toBe(false);
});

it('releases capture, preview and activity when unmounted', async () => {
  const source: AudioRecording = { mimeType: 'audio/webm', stop: vi.fn(), cancel: vi.fn() };
  vi.mocked(createAudioRecording).mockResolvedValue(source);
  act(() => root.render(<AudioTextarea />)); await importAudio(); await act(async () => button('Gravar áudio').click());
  act(() => root.unmount()); expect(source.cancel).toHaveBeenCalledOnce(); expect(URL.revokeObjectURL).toHaveBeenCalledOnce(); expect(hasActiveDataIngestions()).toBe(false);
});

it('rejects unsupported and oversized imports before preview or transcription', async () => {
  act(() => root.render(<AudioTextarea />)); await importAudio(new File(['bad'], 'secret.txt', { type: 'text/plain' }));
  expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(transcribeAudio).not.toHaveBeenCalled();
  const input = host.querySelector<HTMLInputElement>('input[type=file]')!, large = clip(); Object.defineProperty(large, 'size', { value: MAX_AUDIO_BYTES + 1 });
  act(() => { Object.defineProperty(input, 'files', { configurable: true, value: [large] }); input.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.querySelector('[role=alert]')?.textContent).toContain('12 MiB'); expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it('normalizes transcript line breaks for opt-in single-line text fields', async () => {
  const change = vi.fn();
  function Editor() { const [value, setValue] = useState(''); return <AudioTextInput value={value} onChange={event => { change(event.target.value); setValue(event.target.value); }} />; }
  act(() => root.render(<Editor />)); await importAudio(); await transcript('Título\nfalado'); act(() => button('Inserir texto').click());
  expect(change).toHaveBeenCalledExactlyOnceWith('Título falado'); expect(original().value).toBe('Título falado');
});
