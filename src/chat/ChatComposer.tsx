import { AudioTextarea } from '@/audio/AudioField';
import { useId, useRef, useState, type RefObject } from 'react';
import { useGraphStore } from '@/store';
import { useWorkspaceStore } from '@/workspace/store';
import { Icon } from '@/workspace/ui';
import { CHAT_REFERENCE_LIMIT, listChatReferences, type ChatReferenceTarget } from './references';
import { FileAttachments } from '@/attachments/FileAttachments';
import type { PlanFile } from '@/attachments/files';

interface Props {
  text: string; onText: (text: string) => void;
  references: ChatReferenceTarget[]; onReferences: (references: ChatReferenceTarget[]) => void;
  projectId: string | null; inputRef: RefObject<HTMLTextAreaElement>;
  english: boolean; placeholder: string; sendLabel: string; stopLabel: string;
  disabled: boolean; canSend: boolean; running: boolean; onSubmit: () => void; onStop: () => void;
  files?: PlanFile[]; onFiles?: (files: PlanFile[]) => void; onFilesBusy?: (busy: boolean) => void; scopeKey?: string;
}
export function ChatComposer(props: Props) {
  const { text, onText, references, onReferences, projectId, inputRef, english } = props;
  // Keep metadata suggestions current when a note, node or pasted photo changes.
  useWorkspaceStore(state => state.notes); useWorkspaceStore(state => state.projects); useGraphStore(state => state.project);
  const [mention, setMention] = useState<{ start: number; end: number; query: string } | null>(null);
  const [selected, setSelected] = useState(0);
  const composing = useRef(false), menuId = useId(), hintId = useId();
  let candidates: ChatReferenceTarget[] = [];
  try {
    if (mention && references.length < CHAT_REFERENCE_LIMIT) candidates = listChatReferences(mention.query, projectId).filter(target => !references.some(ref => ref.id === target.id && ref.kind === target.kind && ref.projectId === target.projectId)).slice(0, 8);
  } catch { /* A deleted project is reported at submit, never substituted with another plan. */ }
  function findMention(value: string, caret: number) {
    const match = /(?:^|\s)@([^@\n]*)$/.exec(value.slice(0, caret));
    setMention(match ? { start: caret - match[1].length - 1, end: caret, query: match[1] } : null); setSelected(0);
  }
  function choose(target: ChatReferenceTarget) {
    if (!mention || references.length >= CHAT_REFERENCE_LIMIT) return;
    onText(text.slice(0, mention.start) + text.slice(mention.end));
    onReferences([...references, target]); setMention(null); inputRef.current?.focus();
  }
  const kind = (value: ChatReferenceTarget['kind']) => ({ file: english ? 'File' : 'Arquivo', note: english ? 'Note' : 'Nota', node: english ? 'Part' : 'Parte', image: english ? 'Photo' : 'Foto', project: english ? 'Project' : 'Projeto', board: 'Board', diagram: english ? 'Diagram' : 'Diagrama', model: '3D' })[value];
  return <form className="dd-chat-composer" onSubmit={event => { event.preventDefault(); if (mention) { if (candidates.length) choose(candidates[Math.min(selected, candidates.length - 1)]); } else props.onSubmit(); }}>
    {references.length > 0 && <div className="dd-chat-reference-chips" aria-label={english ? 'Selected references' : 'Referências selecionadas'}>
      {references.map(ref => <span className="dd-chat-reference-chip" data-reference-id={ref.id} key={`${ref.kind}:${ref.projectId}:${ref.id}`}>
        <small>{kind(ref.kind)}</small><span title={`${ref.label} · ${ref.detail}`}>{ref.label}</span><button type="button" aria-label={`${english ? 'Remove reference' : 'Remover referência'} ${ref.label}`} onClick={() => onReferences(references.filter(item => item !== ref))}>×</button>
      </span>)}
    </div>}
      <AudioTextarea audioScope={`chat:${projectId ?? 'personal'}:${props.scopeKey ?? 'composer'}`} audioLanguage={english ? 'en' : 'pt'} ref={inputRef} value={text} placeholder={props.placeholder} aria-label={props.placeholder} aria-describedby={hintId} rows={2} maxLength={16000} disabled={props.disabled}
        aria-autocomplete="list" aria-expanded={!!mention} aria-controls={mention ? menuId : undefined}
        aria-activedescendant={mention && candidates.length ? `${menuId}-${Math.min(selected, candidates.length - 1)}` : undefined}
        onChange={event => { onText(event.target.value); findMention(event.target.value, event.target.selectionStart ?? event.target.value.length); }}
        onClick={event => findMention(event.currentTarget.value, event.currentTarget.selectionStart)}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) { event.stopPropagation(); return; }
          if (mention) {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMention(null); return; }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSelected(index => Math.max(0, Math.min(candidates.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))); return; }
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (candidates.length) choose(candidates[Math.min(selected, candidates.length - 1)]); return; }
          }
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); props.onSubmit(); }
        }} />
    {props.onFiles && <FileAttachments files={props.files ?? []} onChange={props.onFiles} onBusy={props.onFilesBusy} english={english} compact disabled={props.disabled || props.running} scopeKey={props.scopeKey ?? projectId ?? 'personal'} />}
    <button type="button" className="dd-chat-mention-button" aria-label={english ? 'Mention a reference' : 'Referenciar com @'} title={english ? 'Projects, notes, boards and artifacts' : 'Projetos, notas, boards e artefatos'} disabled={props.disabled || references.length >= CHAT_REFERENCE_LIMIT || text.length >= 15998} onClick={() => {
      const caret = inputRef.current?.selectionStart ?? text.length, token = caret > 0 && !/\s/.test(text[caret - 1]) ? ' @' : '@';
      const value = text.slice(0, caret) + token + text.slice(caret); onText(value); findMention(value, caret + token.length); inputRef.current?.focus();
    }}>@</button>
    {props.running ? <button type="button" onClick={props.onStop} aria-label={props.stopLabel} title={props.stopLabel} className="dd-chat-send stop"><span /></button> : <button disabled={!props.canSend} aria-label={props.sendLabel} title={props.sendLabel} className="dd-chat-send"><Icon name="arrow" size={18} /></button>}
    {mention && <div className="dd-chat-mention-menu" id={menuId} role="listbox" aria-label={english ? 'References' : 'Referências'}>
      <div className="dd-chat-mention-heading">{english ? 'Add a reference' : 'Adicionar uma referência'}<span>{references.length}/{CHAT_REFERENCE_LIMIT}</span></div>
      {candidates.length ? candidates.map((target, index) => <button type="button" role="option" aria-selected={index === selected} id={`${menuId}-${index}`} key={`${target.kind}:${target.projectId}:${target.planId}:${target.id}`} onMouseDown={event => event.preventDefault()} onClick={() => choose(target)}>
        <span className="dd-chat-reference-symbol" aria-hidden="true">{target.kind === 'image' ? '▧' : target.kind === 'node' ? '◇' : '≡'}</span><span><strong>{target.label}</strong><small>{kind(target.kind)} · {target.detail}</small></span>
      </button>) : <p>{references.length >= CHAT_REFERENCE_LIMIT ? (english ? 'Reference limit reached.' : 'Limite de referências atingido.') : (english ? 'No references in this context.' : 'Nenhuma referência neste contexto.')}</p>}
    </div>}
    <small id={hintId} className="sr-only">{english ? 'Attach files or use @ for notes, parts, photos and files' : 'Anexe arquivos ou use @ para notas, partes, fotos e anexos'}</small>
  </form>;
}
