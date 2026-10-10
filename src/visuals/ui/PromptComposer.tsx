import { AudioTextarea } from '@/audio/AudioField';
import { useEffect, useId, useRef, useState } from 'react';
import type { MentionTarget, VisualAttachment, VisualPromptInput } from '../types';
import { useVisualStrings, visualError } from './strings';

export interface PromptComposerProps {
  value: VisualPromptInput;
  onChange: (input: VisualPromptInput) => void;
  listMentions: (query: string) => MentionTarget[];
  onAttach: (file: File, signal?: AbortSignal) => Promise<VisualAttachment>;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
  kind: 'search' | 'model';
  submitLabel?: string;
  canSubmit?: boolean;
  inputLabel?: string;
  placeholder?: string;
  rows?: number;
  audioScope?: string;
}
export function PromptComposer({ value, onChange, listMentions, onAttach, onSubmit, onCancel, busy, kind, submitLabel, canSubmit, inputLabel, placeholder, rows, audioScope }: PromptComposerProps) {
  const s = useVisualStrings();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const latest = useRef(value); latest.current = value;
  const attachController = useRef<AbortController | null>(null);
  const [mention, setMention] = useState<{ start: number; end: number; query: string } | null>(null);
  const [selected, setSelected] = useState(0);
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState('');
  const composing = useRef(false);
  const menuId = useId();
  const candidates = mention && value.mentions.length < 20 ? listMentions(mention.query).filter((item) => !value.mentions.some((m) => m.id === item.id && m.kind === item.kind)).slice(0, 8) : [];
  useEffect(() => () => attachController.current?.abort(), []);
  function findMention(text: string, caret: number) {
    const match = /(?:^|\s)@([^@\n]*)$/.exec(text.slice(0, caret));
    setMention(match ? { start: caret - match[1].length - 1, end: caret, query: match[1] } : null); setSelected(0);
  }
  function choose(target: MentionTarget) {
    if (!mention) return;
    const text = value.text.slice(0, mention.start) + value.text.slice(mention.end);
    onChange({ ...value, text, mentions: [...value.mentions, target] });
    setMention(null); textarea.current?.focus();
  }
  async function attach(files: File[]) {
    const controller = new AbortController(); attachController.current = controller; setError(''); setAttaching(true);
    try {
      for (const file of files) {
        if (latest.current.attachments.length >= 8) throw new Error('visualInputLimit');
        if (!/\.(png|jpe?g|webp|pdf|txt|md)$/i.test(file.name)) throw new Error(s.invalidFile);
        const attachment = await onAttach(file, controller.signal);
        if (controller.signal.aborted) return;
        const next = { ...latest.current, attachments: [...latest.current.attachments, attachment] };
        latest.current = next; onChange(next);
      }
    } catch (reason) { if (!controller.signal.aborted) setError(visualError(reason, s)); }
    finally { if (!controller.signal.aborted) setAttaching(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  const canSend = canSubmit ?? Boolean(value.text.trim() || value.mentions.length || value.attachments.length);
  return <div className="visual-composer">
    {(value.mentions.length > 0 || value.attachments.length > 0) && <div className="visual-chips">
      {value.mentions.map((item) => <span className="visual-chip" key={`${item.kind}:${item.id}`} title={item.detail}>
        <span className="visual-chip-kind">{s[item.kind]}</span><span>{item.label}</span>
        <button type="button" aria-label={`${s.remove} ${item.label}`} onClick={() => onChange({ ...value, mentions: value.mentions.filter((m) => m !== item) })}>×</button>
      </span>)}
      {value.attachments.map((item) => <span className="visual-chip" key={item.id} title={`${item.mime} · ${Math.ceil(item.byteLength / 1024)} KB`}>
        <span aria-hidden="true">↳</span><span>{item.name}</span><button type="button" aria-label={`${s.remove} ${item.name}`} onClick={() => onChange({ ...value, attachments: value.attachments.filter((a) => a.id !== item.id) })}>×</button>
      </span>)}
    </div>}
    <div className="visual-input-wrap">
      <AudioTextarea audioScope={audioScope ?? `visual:${kind}`} audioLanguage={s.generate === 'Generate model' ? 'en' : 'pt'} ref={textarea} value={value.text} maxLength={12000} placeholder={placeholder ?? (kind === 'search' ? s.searchPlaceholder : s.modelPlaceholder)}
        aria-label={inputLabel ?? (kind === 'search' ? s.search : s.generate)} rows={rows ?? (kind === 'search' ? 2 : 3)}
        aria-expanded={Boolean(mention)} aria-controls={mention ? menuId : undefined} aria-autocomplete="list"
        aria-activedescendant={mention && candidates.length ? `${menuId}-${Math.min(selected, candidates.length - 1)}` : undefined}
        onChange={(e) => { onChange({ ...value, text: e.target.value }); findMention(e.target.value, e.target.selectionStart); }}
        onClick={(e) => findMention(e.currentTarget.value, e.currentTarget.selectionStart)}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || composing.current || e.keyCode === 229) return;
          if (mention) {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMention(null); return; }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSelected((index) => Math.max(0, Math.min(candidates.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))); return; }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (candidates.length) choose(candidates[Math.min(selected, candidates.length - 1)]); return; }
          }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canSend && !busy && !attaching) onSubmit(); }
        }} />
      {mention && <div className="visual-mention-menu" id={menuId} role="listbox" aria-label={s.mention}>
        {candidates.length === 0 ? <div className="visual-muted">{s.noMentions}</div> : candidates.map((item, index) => <button type="button" role="option" id={`${menuId}-${index}`} key={`${item.kind}:${item.id}`} aria-selected={index === selected}
          onMouseDown={(e) => e.preventDefault()} onClick={() => choose(item)}>
          <span className="visual-mention-icon" aria-hidden="true">{item.kind === 'image' ? '▧' : item.kind === 'node' ? '◇' : '≡'}</span>
          <span><strong>{item.label}</strong><small>{s[item.kind]} · {item.detail}</small></span>
        </button>)}
      </div>}
    </div>
    <div className="visual-composer-toolbar">
      <div className="visual-composer-tools">
        <button type="button" className="visual-icon-button" aria-label={s.attach} title={s.attach} disabled={attaching} onClick={() => fileInput.current?.click()}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m9 12 6-6a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L13 2"/><path d="m6 15 9-9"/></svg></button>
        <button type="button" className="visual-icon-button" aria-label={s.mention} title={s.mention} disabled={value.mentions.length >= 20 || value.text.length > 11998} onClick={() => { const caret = textarea.current?.selectionStart ?? value.text.length; const text = value.text.slice(0, caret) + (caret > 0 && !/\s/.test(value.text[caret - 1]) ? ' @' : '@') + value.text.slice(caret); onChange({ ...value, text }); const end = text.length - (value.text.length - caret); findMention(text, end); textarea.current?.focus(); }}>@</button>
        <input type="file" ref={fileInput} multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.md,image/png,image/jpeg,image/webp,application/pdf,text/plain,text/markdown" hidden onChange={(e) => { if (e.target.files?.length) void attach(Array.from(e.target.files)); }} />
        <span className="visual-key-hint">{attaching ? s.attaching : s.sendHint}</span>
      </div>
      {busy ? <button type="button" className="visual-button" onClick={onCancel}>{s.cancel}</button> : <button type="button" className="visual-button visual-primary" aria-label={submitLabel ?? (kind === 'search' ? s.search : s.generate)} disabled={!canSend || attaching} onClick={onSubmit}>{submitLabel ?? (kind === 'search' ? s.search : s.generate)}<span aria-hidden="true">↗</span></button>}
    </div>
    {kind === 'model' && <label className="visual-vision-choice"><input type="checkbox" aria-label={s.analyzeImagePixels} checked={value.analyzeImages === true} disabled={busy || attaching}
      onChange={event => onChange({ ...value, analyzeImages: event.currentTarget.checked })} /><span>{s.analyzeImagePixels}<small>{s.analyzeImagePixelsHint}</small></span></label>}
    {error && <p role="alert" className="visual-error">{error}</p>}
    {value.attachments.length > 0 && <p className="visual-local-hint">{s.localHint}</p>}
  </div>;
}
