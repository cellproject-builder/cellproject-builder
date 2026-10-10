import { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type ForwardedRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useLocaleStore } from '@/i18n';
import { registerDataIngestion } from '@/cloud/activity';
import { createAudioRecording, type AudioRecording } from './recording';
import { AUDIO_MODELS, DEFAULT_AUDIO_MODEL, MAX_AUDIO_BYTES, transcribeAudio } from './transcription';
import './audio-field.css';

interface AudioOptions { audioScope?: string; audioLanguage?: 'pt' | 'en'; audioWrapperClassName?: string }
export type AudioTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & AudioOptions;
export type AudioTextInputProps = InputHTMLAttributes<HTMLInputElement> & AudioOptions;
type Field = HTMLInputElement | HTMLTextAreaElement;
type NativeProps = TextareaHTMLAttributes<HTMLTextAreaElement> | InputHTMLAttributes<HTMLInputElement>;
type Stage = 'idle' | 'requesting' | 'recording' | 'stopping' | 'ready' | 'transcribing';
const pt = {
  add: 'Adicionar áudio', title: 'Áudio para texto', record: 'Gravar áudio', stop: 'Parar gravação', import: 'Importar áudio', close: 'Fechar áudio', cancel: 'Cancelar áudio',
  waiting: 'Aguardando o microfone…', recording: 'Gravando', stopping: 'Preparando gravação…', transcribing: 'Transcrevendo…', transcribe: 'Transcrever áudio', insert: 'Inserir texto',
  listen: 'Ouvir gravação', result: 'Transcrição editável', model: 'Modelo de transcrição', language: 'Idioma do áudio', hint: 'Ouça antes de transcrever. Só o texto que você inserir será salvo; o áudio fica nesta prévia.',
  stale: 'O campo mudou durante a operação. Confira a seleção atual antes de inserir.', refresh: 'Usar seleção atual', limit: 'O texto ultrapassa o limite deste campo. Reduza a transcrição antes de inserir.',
  file: 'Use um arquivo de áudio WAV, MP3, MP4/M4A, WebM, Ogg, FLAC ou AAC de até 12 MiB.', failure: 'Não foi possível preparar o áudio. Tente novamente.', permission: 'Permita o microfone no navegador para gravar.',
  cost: 'Custo informado', alternative: 'alternativo',
};
const en: typeof pt = {
  add: 'Add audio', title: 'Audio to text', record: 'Record audio', stop: 'Stop recording', import: 'Import audio', close: 'Close audio', cancel: 'Cancel audio',
  waiting: 'Waiting for microphone…', recording: 'Recording', stopping: 'Preparing recording…', transcribing: 'Transcribing…', transcribe: 'Transcribe audio', insert: 'Insert text',
  listen: 'Listen to recording', result: 'Editable transcript', model: 'Transcription model', language: 'Audio language', hint: 'Listen before transcribing. Only the text you insert is saved; audio stays in this preview.',
  stale: 'The field changed during this operation. Review the current selection before inserting.', refresh: 'Use current selection', limit: 'The text exceeds this field’s limit. Shorten the transcript before inserting.',
  file: 'Use a WAV, MP3, MP4/M4A, WebM, Ogg, FLAC or AAC audio file up to 12 MiB.', failure: 'Could not prepare audio. Please try again.', permission: 'Allow microphone access in your browser to record.',
  cost: 'Reported cost', alternative: 'alternative',
};
const audioAccept = '.wav,.mp3,.mp4,.m4a,.webm,.ogg,.oga,.flac,.aac,audio/wav,audio/mpeg,audio/mp4,audio/webm,audio/ogg,audio/flac,audio/aac';
const permittedFile = (file: File) => /\.(wav|mp3|mp4|m4a|webm|ogg|oga|flac|aac)$/i.test(file.name) || /^audio\/(wav|wave|x-wav|mpeg|mp3|mp4|x-m4a|webm|ogg|flac|x-flac|aac)(?:;|$)/i.test(file.type);

function AudioField({ kind, native, forwardedRef, audioScope, audioLanguage, audioWrapperClassName }: AudioOptions & { kind: 'textarea' | 'input'; native: NativeProps; forwardedRef: ForwardedRef<Field> }) {
  const locale = useLocaleStore(state => state.locale), english = audioLanguage ? audioLanguage === 'en' : locale === 'en', tr = english ? en : pt;
  const field = useRef<Field | null>(null), wrapper = useRef<HTMLDivElement>(null), popup = useRef<HTMLDivElement>(null), fileInput = useRef<HTMLInputElement>(null);
  const recording = useRef<AudioRecording | null>(null), captureAbort = useRef<AbortController | null>(null), transcriptionAbort = useRef<AbortController | null>(null), stoppingRecording = useRef(false);
  const guard = useRef<(() => void) | null>(null), objectUrl = useRef<string | null>(null), alive = useRef(true), generation = useRef(0);
  const selection = useRef<{ baseline: string; start: number; end: number; scope: string | undefined } | null>(null);
  const latest = useRef({ audioScope, disabled: native.disabled, readOnly: native.readOnly }); latest.current = { audioScope, disabled: native.disabled, readOnly: native.readOnly };
  const [open, setOpen] = useState(false), [stage, setStage] = useState<Stage>('idle'), [duration, setDuration] = useState(0);
  const [clip, setClip] = useState<Blob | null>(null), [url, setUrl] = useState(''), [text, setText] = useState(''), [hasTranscript, setHasTranscript] = useState(false), [error, setError] = useState(''), [stale, setStale] = useState(false);
  const [model, setModel] = useState<string>(DEFAULT_AUDIO_MODEL), [language, setLanguage] = useState<'pt' | 'en'>(audioLanguage ?? (english ? 'en' : 'pt'));
  const [cost, setCost] = useState<number | undefined>(), [position, setPosition] = useState({ left: 8, top: 8, width: 360, maxHeight: 500 });
  const id = useId(), stopRef = useRef<() => void>(() => {});
  const assignField = useCallback((node: Field | null) => {
    field.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node); else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);
  const dispose = useCallback(() => {
    generation.current++; captureAbort.current?.abort(); captureAbort.current = null;
    transcriptionAbort.current?.abort(); transcriptionAbort.current = null;
    recording.current?.cancel(); recording.current = null; stoppingRecording.current = false;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = null;
    guard.current?.(); guard.current = null; selection.current = null;
  }, []);
  const close = useCallback((restore = true) => {
    dispose();
    if (!alive.current) return;
    // Restore focus before removing the focused popup control, keeping one edit session.
    if (restore && field.current?.isConnected && !field.current.disabled) field.current.focus({ preventScroll: true });
    setOpen(false); setStage('idle'); setClip(null); setUrl(''); setText(''); setHasTranscript(false); setError(''); setStale(false); setCost(undefined);
  }, [dispose]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; dispose(); }; }, [dispose]);
  useEffect(() => {
    if (open && (native.disabled || native.readOnly || selection.current?.scope !== audioScope)) close(false);
  }, [audioScope, native.disabled, native.readOnly, open, close]);
  const active = (token: number) => alive.current && token === generation.current && selection.current?.scope === latest.current.audioScope && !latest.current.disabled && !latest.current.readOnly;
  function snapshot() {
    const input = field.current; if (!input) return;
    selection.current = { baseline: input.value, start: input.selectionStart ?? input.value.length, end: input.selectionEnd ?? input.value.length, scope: audioScope };
  }
  function show() {
    if (native.disabled || native.readOnly) return;
    snapshot(); guard.current?.(); guard.current = registerDataIngestion(); generation.current++;
    setError(''); setStale(false); setOpen(true);
  }
  useLayoutEffect(() => {
    if (!open || !popup.current) return;
    const node = popup.current;
    // Top-layer enhancement escapes transformed canvas ancestors without a portal.
    try { node.showPopover?.(); } catch { /* Fixed-position fallback. */ }
    node.focus({ preventScroll: true });
    return () => { try { node.hidePopover?.(); } catch { /* Already removed. */ } };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const input = field.current, panel = popup.current; if (!input || !panel) return;
      const viewport = window.visualViewport, vw = viewport?.width ?? window.innerWidth, vh = viewport?.height ?? window.innerHeight;
      const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0, width = Math.max(1, Math.min(380, vw - 16)), maxHeight = Math.max(1, vh - 16);
      const anchor = input.getBoundingClientRect(), height = Math.min(panel.scrollHeight || 400, maxHeight);
      const left = Math.max(x + 8, Math.min(anchor.right - width, x + vw - width - 8));
      const below = anchor.bottom + 8, top = below + height <= y + vh - 8 ? below : Math.max(y + 8, Math.min(anchor.top - height - 8, y + vh - height - 8));
      setPosition({ left, top, width, maxHeight });
    };
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place); window.visualViewport?.addEventListener('scroll', place);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place); if (popup.current) observer?.observe(popup.current);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place); observer?.disconnect(); };
  }, [open, stage, clip, text, error, stale]);
  const message = (reason: unknown) => (reason instanceof Error || reason instanceof DOMException) ? reason.name === 'NotAllowedError' ? tr.permission : reason.message || tr.failure : tr.failure;
  function useClip(blob: Blob) {
    if (!blob.size || blob.size > MAX_AUDIO_BYTES) { setError(tr.file); setStage('idle'); return; }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    const next = URL.createObjectURL(blob); objectUrl.current = next;
    setClip(blob); setUrl(next); setText(''); setHasTranscript(false); setCost(undefined); setError(''); setStage('ready');
  }
  async function startRecording() {
    if (captureAbort.current || transcriptionAbort.current) return;
    const token = generation.current, controller = new AbortController(); captureAbort.current = controller;
    setError(''); setDuration(0); setStage('requesting');
    try {
      const result = await createAudioRecording({ signal: controller.signal,
        onDuration: seconds => { if (active(token) && !controller.signal.aborted) setDuration(seconds); },
        onLimit: () => { if (active(token) && !controller.signal.aborted) stopRef.current(); },
        onError: reason => { if (active(token) && !controller.signal.aborted) { recording.current?.cancel(); recording.current = null; controller.abort(); captureAbort.current = null; stoppingRecording.current = false; setError(message(reason)); setStage(clip ? 'ready' : 'idle'); } },
      });
      if (!active(token) || controller.signal.aborted) { result.cancel(); return; }
      recording.current = result; setStage('recording');
    } catch (reason) { if (active(token) && !controller.signal.aborted) { captureAbort.current = null; setError(message(reason)); setStage(clip ? 'ready' : 'idle'); } }
  }
  async function stopRecording() {
    const source = recording.current; if (!source || stoppingRecording.current) return;
    const token = generation.current; stoppingRecording.current = true; setStage('stopping');
    try {
      const blob = await source.stop();
      if (!active(token)) return;
      recording.current = null; captureAbort.current = null; useClip(blob);
    } catch (reason) { if (active(token)) { source.cancel(); recording.current = null; captureAbort.current = null; setError(message(reason)); setStage(clip ? 'ready' : 'idle'); } }
    finally { if (active(token)) stoppingRecording.current = false; }
  }
  stopRef.current = () => { void stopRecording(); };
  async function transcribe() {
    if (!clip || transcriptionAbort.current || captureAbort.current) return;
    const controller = new AbortController(); transcriptionAbort.current = controller;
    const token = generation.current; setError(''); setStage('transcribing');
    try {
      const chosen = AUDIO_MODELS.find(candidate => candidate.id === model)?.id ?? DEFAULT_AUDIO_MODEL;
      const result = await transcribeAudio(clip, { model: chosen, language, signal: controller.signal });
      if (!active(token) || controller.signal.aborted || transcriptionAbort.current !== controller) return;
      setText(result.text); setHasTranscript(true); setCost(result.costUsd); setStage('ready');
    } catch (reason) { if (active(token) && !controller.signal.aborted && transcriptionAbort.current === controller) { setError(message(reason)); setStage('ready'); } }
    finally { if (transcriptionAbort.current === controller) transcriptionAbort.current = null; }
  }
  function insert() {
    const input = field.current, original = selection.current;
    if (!input || !original || !input.isConnected || native.disabled || native.readOnly || original.scope !== audioScope) return;
    if (input.value !== original.baseline) { setStale(true); setError(tr.stale); return; }
    const added = kind === 'input' ? text.replace(/\r?\n/g, ' ') : text;
    const next = original.baseline.slice(0, original.start) + added + original.baseline.slice(original.end);
    if (input.maxLength >= 0 && next.length > input.maxLength) { setError(tr.limit); return; }
    const prototype = kind === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    close();
    if (input.isConnected) input.setSelectionRange(original.start + added.length, original.start + added.length);
  }
  const busy = ['requesting', 'recording', 'stopping', 'transcribing'].includes(stage);
  const { onBlur, ...rest } = native;
  const inputProps = { ...rest, ref: assignField, 'data-audio-input': 'true' };
  return <div ref={wrapper} className={`audio-field audio-${kind === 'textarea' ? 'textarea' : 'text-input'} ${audioWrapperClassName ?? ''}`} data-audio-scope={audioScope} data-audio-enabled={!native.disabled && !native.readOnly}
    onBlur={event => {
      if (event.relatedTarget instanceof Node && wrapper.current?.contains(event.relatedTarget)) return;
      const target = field.current; if (!target || !onBlur) return;
      // A popup button can be the blurred DOM target; callers still receive their field.
      const adapted = Object.assign(Object.create(Object.getPrototypeOf(event)), event, { target, currentTarget: target });
      (onBlur as (value: FocusEvent<Field>) => void)(adapted);
    }}>
    {kind === 'textarea' ? <textarea {...inputProps as TextareaHTMLAttributes<HTMLTextAreaElement>} ref={assignField} /> : <input {...inputProps as InputHTMLAttributes<HTMLInputElement>} ref={assignField} />}
    {!native.disabled && !native.readOnly && <button type="button" className="audio-field-mic" aria-label={tr.add} title={tr.add} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => open ? close() : show()}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg>
    </button>}
    {open && <div ref={popup} id={id} role="dialog" aria-modal="false" aria-label={tr.title} tabIndex={-1} className="audio-field-popup" {...{ popover: 'manual' }} style={position}
      onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
      onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
      <header><strong>{tr.title}</strong><button type="button" aria-label={tr.close} onClick={() => close()}>×</button></header>
      <div className="audio-field-actions">
        {stage === 'recording' ? <button type="button" className="is-recording" aria-label={tr.stop} onClick={() => void stopRecording()}>{tr.stop}</button> : <button type="button" aria-label={tr.record} disabled={busy} onClick={() => void startRecording()}>{tr.record}</button>}
        <button type="button" aria-label={tr.import} disabled={busy} onClick={() => fileInput.current?.click()}>{tr.import}</button>
        <input ref={fileInput} type="file" accept={audioAccept} hidden aria-label={tr.import} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (!file) return;
          if (!permittedFile(file) || !file.size || file.size > MAX_AUDIO_BYTES) { setError(tr.file); return; }
          useClip(file);
        }} />
      </div>
      {busy && <p role="status">{stage === 'recording' ? `${tr.recording} · ${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}` : stage === 'requesting' ? tr.waiting : stage === 'stopping' ? tr.stopping : tr.transcribing}</p>}
      {clip && <>
        <audio controls src={url} preload="metadata" aria-label={tr.listen} />
        <div className="audio-field-options"><label>{tr.model}<select aria-label={tr.model} value={model} disabled={busy} onChange={event => setModel(event.target.value)}>{AUDIO_MODELS.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.label}{candidate.id !== DEFAULT_AUDIO_MODEL ? ` (${tr.alternative})` : ''}</option>)}</select></label><label>{tr.language}<select aria-label={tr.language} value={language} disabled={busy} onChange={event => setLanguage(event.target.value as 'pt' | 'en')}><option value="pt">Português</option><option value="en">English</option></select></label></div>
        <button type="button" className="audio-field-transcribe" aria-label={tr.transcribe} disabled={busy} onClick={() => void transcribe()}>{tr.transcribe}</button>
      </>}
      {hasTranscript && <label className="audio-field-result-label">{tr.result}<textarea className="audio-field-result" data-audio-result="true" aria-label={tr.result} rows={4} value={text} disabled={busy} onChange={event => { setText(event.target.value); setError(''); }} /></label>}
      {cost !== undefined && Number.isFinite(cost) && <small>{tr.cost}: ${cost.toFixed(cost > 0 && cost < 0.0001 ? 8 : 4)}</small>}
      {error && <p role="alert">{error}</p>}
      {stale && <button type="button" onClick={() => { snapshot(); setStale(false); setError(''); }}>{tr.refresh}</button>}
      <p className="audio-field-hint">{tr.hint}</p>
      <footer><button type="button" aria-label={tr.cancel} onClick={() => close()}>{tr.cancel}</button><button type="button" className="audio-field-insert" aria-label={tr.insert} disabled={!text.trim() || busy || stale} onClick={insert}>{tr.insert}</button></footer>
    </div>}
  </div>;
}

export const AudioTextarea = forwardRef<HTMLTextAreaElement, AudioTextareaProps>(function AudioTextarea({ audioScope, audioLanguage, audioWrapperClassName, ...props }, ref) {
  return <AudioField kind="textarea" native={props} forwardedRef={ref as ForwardedRef<Field>} audioScope={audioScope} audioLanguage={audioLanguage} audioWrapperClassName={audioWrapperClassName} />;
});
export const AudioTextInput = forwardRef<HTMLInputElement, AudioTextInputProps>(function AudioTextInput({ audioScope, audioLanguage, audioWrapperClassName, ...props }, ref) {
  return <AudioField kind="input" native={props} forwardedRef={ref as ForwardedRef<Field>} audioScope={audioScope} audioLanguage={audioLanguage} audioWrapperClassName={audioWrapperClassName} />;
});
