import {
  forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState,
  type CompositionEvent, type FocusEvent, type ForwardedRef,
  type InputHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { useLocaleStore } from '@/i18n';
import { registerDataIngestion } from '@/cloud/activity';
import { createAudioRecording, type AudioRecording } from './recording';
import { DictationTranscription } from './dictation';
import './audio-field.css';

interface AudioOptions {
  audioScope?: string;
  audioLanguage?: 'pt' | 'en';
  audioWrapperClassName?: string;
}
export type AudioTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & AudioOptions;
export type AudioTextInputProps = InputHTMLAttributes<HTMLInputElement> & AudioOptions;
export interface AudioDictationButtonProps extends Pick<AudioOptions, 'audioScope' | 'audioLanguage'> {
  target: () => HTMLTextAreaElement | null;
  disabled?: boolean;
  label?: string;
  className?: string;
}
type Field = HTMLInputElement | HTMLTextAreaElement;
type NativeProps = TextareaHTMLAttributes<HTMLTextAreaElement> | InputHTMLAttributes<HTMLInputElement>;
type Stage = 'idle' | 'requesting' | 'recording' | 'stopping' | 'ready' | 'transcribing' | 'error';
const pt = {
  dictate: 'Ditar texto', title: 'Ditado', cancel: 'Cancelar ditado', confirm: 'Confirmar ditado',
  retry: 'Tentar novamente', copy: 'Copiar texto', copied: 'Texto copiado.', copyText: 'Texto ditado para copiar',
  waiting: 'Aguardando o microfone…', recording: 'Gravando', stopping: 'Preparando gravação…',
  ready: 'Gravação pronta. Confirme para transcrever.', transcribing: 'Transcrevendo…',
  interrupted: 'A gravação foi interrompida. Confirme para transcrever os trechos capturados.',
  stale: 'O campo mudou durante o ditado. Copie o texto para preservar sua edição.',
  limit: 'O texto ultrapassa o limite deste campo. Copie o texto para usar um trecho menor.',
  composing: 'Aguarde a conclusão da digitação. Você pode copiar o texto ditado.',
  failure: 'Não foi possível preparar o áudio. Tente novamente.',
  permission: 'Permita o microfone no navegador para gravar.',
};
const en: typeof pt = {
  dictate: 'Dictate text', title: 'Dictation', cancel: 'Cancel dictation', confirm: 'Confirm dictation',
  retry: 'Try again', copy: 'Copy text', copied: 'Text copied.', copyText: 'Dictated text to copy',
  waiting: 'Waiting for microphone…', recording: 'Recording', stopping: 'Preparing recording…',
  ready: 'Recording ready. Confirm to transcribe.', transcribing: 'Transcribing…',
  interrupted: 'Recording was interrupted. Confirm to transcribe the captured parts.',
  stale: 'The field changed during dictation. Copy the text to preserve your edits.',
  limit: 'The text exceeds this field’s limit. Copy the text to use a shorter passage.',
  composing: 'Wait for typing to finish. You can copy the dictated text.',
  failure: 'Could not prepare audio. Please try again.',
  permission: 'Allow microphone access in your browser to record.',
};

function AudioField({
  kind, native, forwardedRef, audioScope, audioLanguage, audioWrapperClassName, externalTarget, label, buttonClassName,
}: AudioOptions & {
  kind: 'textarea' | 'input' | 'external'; native: NativeProps; forwardedRef: ForwardedRef<Field>;
  externalTarget?: () => HTMLTextAreaElement | null; label?: string; buttonClassName?: string;
}) {
  const locale = useLocaleStore(state => state.locale);
  const english = audioLanguage ? audioLanguage === 'en' : locale === 'en';
  const tr = english ? en : pt;
  const field = useRef<Field | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const copyField = useRef<HTMLTextAreaElement>(null);
  const recording = useRef<AudioRecording | null>(null);
  const captureAbort = useRef<AbortController | null>(null);
  const transcriptionAbort = useRef<AbortController | null>(null);
  const stoppingRecording = useRef(false);
  const transcriber = useRef<DictationTranscription | null>(null);
  const guard = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  const generation = useRef(0);
  const opened = useRef(false);
  const composing = useRef(false);
  const externalCompositions = useRef(new WeakSet<HTMLTextAreaElement>());
  const resolveTarget = useRef(externalTarget);
  resolveTarget.current = externalTarget;
  const limitReached = useRef(false);
  const language = useRef<'pt' | 'en'>(audioLanguage ?? (english ? 'en' : 'pt'));
  const selection = useRef<{ baseline: string; start: number; end: number; scope: string | undefined } | null>(null);
  const latest = useRef({ audioScope, disabled: native.disabled, readOnly: native.readOnly });
  latest.current = { audioScope, disabled: native.disabled, readOnly: native.readOnly };
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>('idle');
  const [duration, setDuration] = useState(0);
  const [level, setLevel] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const [copyFallback, setCopyFallback] = useState(false);
  const [copied, setCopied] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8, width: 360, maxHeight: 500 });
  const id = useId();
  const stopRef = useRef<() => void>(() => {});

  const assignField = useCallback((node: Field | null) => {
    field.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);
  const dispose = useCallback(() => {
    generation.current++;
    opened.current = false;
    captureAbort.current?.abort();
    captureAbort.current = null;
    transcriptionAbort.current?.abort();
    transcriptionAbort.current = null;
    recording.current?.cancel();
    recording.current = null;
    stoppingRecording.current = false;
    transcriber.current = null;
    limitReached.current = false;
    guard.current?.();
    guard.current = null;
    selection.current = null;
  }, []);
  const close = useCallback((restore = true) => {
    dispose();
    if (!alive.current) return;
    // Restore focus before removing its control so blur-based editors keep one session.
    if (restore && field.current?.isConnected && !field.current.disabled) {
      field.current.focus({ preventScroll: true });
    }
    setOpen(false);
    setStage('idle');
    setDuration(0);
    setLevel(0);
    setTranscript('');
    setError('');
    setCopyFallback(false);
    setCopied(false);
  }, [dispose]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; dispose(); };
  }, [dispose]);
  useEffect(() => {
    if (open && (native.disabled || native.readOnly || selection.current?.scope !== audioScope)) close(false);
  }, [audioScope, native.disabled, native.readOnly, open, close]);
  useEffect(() => {
    if (kind !== 'external') return;
    const composition = (event: Event) => {
      const input = event.target;
      if (!(input instanceof HTMLTextAreaElement)) return;
      const started = event.type === 'compositionstart';
      if (started) externalCompositions.current.add(input);
      else externalCompositions.current.delete(input);
      if (!opened.current || input !== field.current) return;
      composing.current = started;
      setIsComposing(started);
    };
    document.addEventListener('compositionstart', composition, true);
    document.addEventListener('compositionend', composition, true);
    return () => {
      document.removeEventListener('compositionstart', composition, true);
      document.removeEventListener('compositionend', composition, true);
    };
  }, [kind]);
  useEffect(() => {
    if (kind !== 'external' || !open || !field.current) return;
    const input = field.current;
    const validate = () => {
      if (!input.isConnected || input.disabled || input.readOnly) close(false);
    };
    const escape = (event: Event) => {
      if (!(event instanceof KeyboardEvent) || event.key !== 'Escape' || event.isComposing || composing.current) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    input.addEventListener('keydown', escape, true);
    validate();
    const observer = new MutationObserver(validate);
    observer.observe(document, { childList: true, subtree: true });
    observer.observe(input, { attributes: true, attributeFilter: ['disabled', 'readonly'] });
    return () => {
      input.removeEventListener('keydown', escape, true);
      observer.disconnect();
    };
  }, [kind, open, close]);

  const active = (token: number) => alive.current && opened.current && token === generation.current
    && selection.current?.scope === latest.current.audioScope
    && !latest.current.disabled && !latest.current.readOnly
    && (kind !== 'external' || (!!field.current?.isConnected && !field.current.disabled && !field.current.readOnly));
  const message = (reason: unknown) => {
    if (reason instanceof Error || reason instanceof DOMException) {
      return reason.name === 'NotAllowedError' ? tr.permission : reason.message || tr.failure;
    }
    return tr.failure;
  };

  useLayoutEffect(() => {
    if (!open || !popup.current) return;
    const node = popup.current;
    // The top layer escapes transformed canvas ancestors while retaining wrapper ancestry.
    try { node.showPopover?.(); } catch { /* Fixed-position fallback. */ }
    node.focus({ preventScroll: true });
    return () => { try { node.hidePopover?.(); } catch { /* Already removed. */ } };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const input = kind === 'external' ? wrapper.current : field.current, panel = popup.current;
      if (!input || !panel) return;
      const viewport = window.visualViewport;
      const vw = viewport?.width ?? window.innerWidth, vh = viewport?.height ?? window.innerHeight;
      const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0;
      const width = Math.max(1, Math.min(360, vw - 16)), maxHeight = Math.max(1, vh - 16);
      const anchor = input.getBoundingClientRect(), height = Math.min(panel.scrollHeight || 80, maxHeight);
      const left = Math.max(x + 8, Math.min(anchor.right - width, x + vw - width - 8));
      const below = anchor.bottom + 8;
      const top = below + height <= y + vh - 8 ? below
        : Math.max(y + 8, Math.min(anchor.top - height - 8, y + vh - height - 8));
      setPosition({ left, top, width, maxHeight });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (popup.current) observer?.observe(popup.current);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
      observer?.disconnect();
    };
  }, [kind, open, stage, error, copyFallback]);
  useLayoutEffect(() => {
    if (copyFallback) {
      copyField.current?.focus({ preventScroll: true });
      copyField.current?.select();
    }
  }, [copyFallback]);

  function insert(text: string, token: number) {
    const input = field.current, original = selection.current;
    if (!active(token) || !input?.isConnected || !original) return;
    const refuse = (reason: string) => {
      setTranscript(text);
      setError(reason);
      setStage('error');
    };
    if (input.value !== original.baseline) { refuse(tr.stale); return; }
    if (composing.current) { refuse(tr.composing); return; }
    const added = kind === 'input' ? text.replace(/\r?\n/g, ' ') : text;
    const next = original.baseline.slice(0, original.start) + added + original.baseline.slice(original.end);
    if (input.maxLength >= 0 && next.length > input.maxLength) { refuse(tr.limit); return; }
    const prototype = kind === 'input' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, next);
    const caret = original.start + added.length;
    // Mention-aware callers read the selection synchronously in their onChange handler.
    input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    close();
    if (input.isConnected) input.setSelectionRange(caret, caret);
  }
  async function transcribe() {
    const source = transcriber.current;
    if (!source || transcriptionAbort.current || captureAbort.current || recording.current) return;
    const token = generation.current, controller = new AbortController();
    transcriptionAbort.current = controller;
    setError('');
    setStage('transcribing');
    try {
      const text = await source.transcribe(controller.signal);
      if (!active(token) || controller.signal.aborted || transcriptionAbort.current !== controller) return;
      insert(text, token);
    } catch (reason) {
      if (active(token) && !controller.signal.aborted && transcriptionAbort.current === controller) {
        setError(message(reason));
        setStage('error');
      }
    } finally {
      if (transcriptionAbort.current === controller) transcriptionAbort.current = null;
    }
  }
  async function stopRecording(confirm: boolean) {
    const source = recording.current;
    if (!source || stoppingRecording.current) return;
    const token = generation.current;
    stoppingRecording.current = true;
    setStage('stopping');
    try {
      const clips = await source.stop();
      if (!active(token)) return;
      if (!clips.length || clips.some(clip => !clip.size)) throw new Error(tr.failure);
      recording.current = null;
      captureAbort.current = null;
      transcriber.current = new DictationTranscription(clips, language.current);
      stoppingRecording.current = false;
      setLevel(0);
      setStage('ready');
      if (confirm) await transcribe();
    } catch (reason) {
      if (active(token)) {
        source.cancel();
        recording.current = null;
        captureAbort.current = null;
        if (transcriber.current) {
          // onError may have recovered complete files before this stop rejected.
          setStage('ready');
        } else {
          setError(message(reason));
          setStage('error');
        }
      }
    } finally {
      if (active(token)) stoppingRecording.current = false;
    }
  }
  stopRef.current = () => { void stopRecording(false); };

  async function startRecording() {
    if (captureAbort.current || transcriptionAbort.current || stoppingRecording.current) return;
    const token = generation.current, controller = new AbortController();
    captureAbort.current = controller;
    limitReached.current = false;
    setError('');
    setDuration(0);
    setLevel(0);
    setStage('requesting');
    try {
      const result = await createAudioRecording({
        signal: controller.signal,
        onDuration: seconds => { if (active(token) && !controller.signal.aborted) setDuration(seconds); },
        onLevel: value => {
          if (active(token) && !controller.signal.aborted) setLevel(Math.max(0, Math.min(1, value)));
        },
        onLimit: () => {
          if (active(token) && !controller.signal.aborted) {
            limitReached.current = true;
            stopRef.current();
          }
        },
        onError: (reason, clips) => {
          if (!active(token) || controller.signal.aborted) return;
          recording.current?.cancel();
          recording.current = null;
          controller.abort();
          captureAbort.current = null;
          stoppingRecording.current = false;
          setLevel(0);
          if (clips?.length) {
            transcriber.current = new DictationTranscription(clips, language.current);
            setError(tr.interrupted);
            setStage('ready');
          } else {
            setError(message(reason));
            setStage('error');
          }
        },
      });
      if (!active(token) || controller.signal.aborted) { result.cancel(); return; }
      recording.current = result;
      setStage('recording');
      if (limitReached.current) stopRef.current();
    } catch (reason) {
      if (active(token) && !controller.signal.aborted) {
        captureAbort.current = null;
        setError(message(reason));
        setStage('error');
      }
    }
  }
  function confirm() {
    if (recording.current) void stopRecording(true);
    else if (!stoppingRecording.current) void transcribe();
  }
  function activate() {
    if (native.disabled || native.readOnly) return;
    if (opened.current) {
      if (recording.current) confirm();
      popup.current?.focus({ preventScroll: true });
      return;
    }
    if (kind === 'external') {
      field.current = resolveTarget.current?.() ?? null;
      composing.current = field.current instanceof HTMLTextAreaElement && externalCompositions.current.has(field.current);
      setIsComposing(composing.current);
    }
    const input = field.current;
    if (!input?.isConnected || input.disabled || input.readOnly || composing.current) return;
    selection.current = {
      baseline: input.value, start: input.selectionStart ?? input.value.length,
      end: input.selectionEnd ?? input.value.length, scope: audioScope,
    };
    generation.current++;
    opened.current = true;
    language.current = audioLanguage ?? (english ? 'en' : 'pt');
    guard.current?.();
    guard.current = registerDataIngestion();
    setTranscript('');
    setCopyFallback(false);
    setCopied(false);
    setOpen(true);
    void startRecording();
  }
  async function copyTranscript() {
    const token = generation.current;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(transcript);
      if (active(token)) setCopied(true);
    } catch {
      if (active(token)) setCopyFallback(true);
    }
  }

  const pending = stage === 'requesting' || stage === 'stopping' || stage === 'transcribing';
  const canConfirm = stage === 'recording' || stage === 'ready';
  const status = stage === 'recording' ? `${tr.recording} · ${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}`
    : stage === 'requesting' ? tr.waiting : stage === 'stopping' ? tr.stopping
      : stage === 'transcribing' ? tr.transcribing : stage === 'ready' ? tr.ready : tr.title;
  const { onBlur, onCompositionStart, onCompositionEnd, ...rest } = native;
  const inputProps = {
    ...rest, ref: assignField, 'data-audio-input': 'true',
    onCompositionStart: (event: CompositionEvent<Field>) => {
      composing.current = true;
      setIsComposing(true);
      (onCompositionStart as ((value: CompositionEvent<Field>) => void) | undefined)?.(event);
    },
    onCompositionEnd: (event: CompositionEvent<Field>) => {
      composing.current = false;
      setIsComposing(false);
      (onCompositionEnd as ((value: CompositionEvent<Field>) => void) | undefined)?.(event);
    },
  };
  return <div ref={wrapper}
    className={`audio-field ${kind === 'external' ? 'audio-dictation-control' : `audio-${kind === 'textarea' ? 'textarea' : 'text-input'}`} ${audioWrapperClassName ?? ''}`}
    data-audio-scope={audioScope} data-audio-enabled={!native.disabled && !native.readOnly} data-audio-active={open}
    onKeyDownCapture={event => {
      if (open && event.key === 'Escape' && !event.nativeEvent.isComposing && !composing.current) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    }}
    onBlur={event => {
      if (event.relatedTarget instanceof Node && wrapper.current?.contains(event.relatedTarget)) return;
      const target = field.current;
      if (!target || !onBlur) return;
      const adapted = Object.assign(Object.create(Object.getPrototypeOf(event)), event, { target, currentTarget: target });
      (onBlur as (value: FocusEvent<Field>) => void)(adapted);
    }}>
    {kind === 'external' ? null : kind === 'textarea'
      ? <textarea {...inputProps as TextareaHTMLAttributes<HTMLTextAreaElement>} ref={assignField} />
      : <input {...inputProps as InputHTMLAttributes<HTMLInputElement>} ref={assignField} />}
    {(kind === 'external' || (!native.disabled && !native.readOnly)) && <button type="button" className={`audio-field-mic ${buttonClassName ?? ''}`}
      aria-label={label ?? tr.dictate} title={label ?? tr.dictate} aria-expanded={open} aria-controls={open ? id : undefined}
      disabled={native.disabled || pending || (kind !== 'external' && isComposing)} tabIndex={open ? -1 : undefined} onClick={activate}
      onMouseDown={kind === 'external' ? event => event.preventDefault() : undefined}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="9" y="3" width="6" height="12" rx="3" />
        <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" />
      </svg>
    </button>}
    {open && <div ref={popup} id={id} role="dialog" aria-modal="false" aria-label={tr.title} tabIndex={-1}
      className="audio-field-popup" data-recording={stage === 'recording'} {...{ popover: 'manual' }} style={position}
      onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); close(); }
      }}>
      <div className="audio-field-strip">
        <span className="audio-field-level" aria-hidden="true">
          {[0.5, 0.8, 1, 0.8, 0.5].map((weight, index) => <span key={index}
            style={{ transform: `scaleY(${stage === 'recording' ? Math.max(0.15, Math.min(1, level * 8) * weight) : 0.15})` }} />)}
        </span>
        <p role="status">{copied ? tr.copied : status}</p>
      </div>
      {error && <p role="alert">{error}</p>}
      {copyFallback && <textarea ref={copyField} className="audio-field-copy-text" aria-label={tr.copyText}
        rows={3} readOnly value={transcript} onFocus={event => event.currentTarget.select()} />}
      <div className="audio-field-actions">
        <button type="button" className="audio-field-icon" aria-label={tr.cancel} title={tr.cancel} onClick={() => close()}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
        {canConfirm && <button type="button" className="audio-field-confirm audio-field-icon" aria-label={tr.confirm} title={tr.confirm} onClick={confirm}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
        </button>}
        {stage === 'error' && !transcript && <button type="button" className="audio-field-confirm" aria-label={tr.retry}
          onClick={() => { if (transcriber.current) void transcribe(); else void startRecording(); }}>{tr.retry}</button>}
        {stage === 'error' && transcript && <button type="button" className="audio-field-confirm" aria-label={tr.copy}
          onClick={() => void copyTranscript()}>{tr.copy}</button>}
      </div>
    </div>}
  </div>;
}

export const AudioTextarea = forwardRef<HTMLTextAreaElement, AudioTextareaProps>(function AudioTextarea({ audioScope, audioLanguage, audioWrapperClassName, ...props }, ref) {
  return <AudioField kind="textarea" native={props} forwardedRef={ref as ForwardedRef<Field>} audioScope={audioScope} audioLanguage={audioLanguage} audioWrapperClassName={audioWrapperClassName} />;
});
export const AudioTextInput = forwardRef<HTMLInputElement, AudioTextInputProps>(function AudioTextInput({ audioScope, audioLanguage, audioWrapperClassName, ...props }, ref) {
  return <AudioField kind="input" native={props} forwardedRef={ref as ForwardedRef<Field>} audioScope={audioScope} audioLanguage={audioLanguage} audioWrapperClassName={audioWrapperClassName} />;
});
export function AudioDictationButton({ target, audioScope, audioLanguage, disabled, label, className }: AudioDictationButtonProps) {
  return <AudioField kind="external" native={{ disabled }} forwardedRef={null} externalTarget={target}
    audioScope={audioScope} audioLanguage={audioLanguage} label={label} buttonClassName={className} />;
}
