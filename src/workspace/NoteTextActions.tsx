import { useRef } from 'react';
import { MagicWandIcon } from '@/components/ui/SoftIcons';
import { useLocaleStore, useT } from '@/i18n';
import type { NoteBlock } from './types';
import { requestChatReferences } from '@/references/chatHandoff';
import { useWorkspaceStore } from './store';
import { noteTextEn, noteTextPt } from './noteTextMessages';
import { NoteActionMenu } from './NoteActionMenu';
import './NoteTextActions.css';

export function NoteTextActions({ noteId, block, input, onFormat }: {
  noteId: string;
  block: NoteBlock;
  input: () => HTMLTextAreaElement | null | undefined;
  onFormat: (patch: Partial<NoteBlock>) => void;
}) {
  const tr = useT().workspace;
  const english = useLocaleStore((s) => s.locale) === 'en';
  const copy = english ? noteTextEn : noteTextPt;
  const actionsRef = useRef<HTMLDivElement>(null);
  const editWithAI = () => {
    const note = useWorkspaceStore.getState().notes[noteId];
    if (!note || note.deletedAt !== null) return;
    const field = input();
    const start = field?.selectionStart ?? 0, end = field?.selectionEnd ?? 0;
    const selected = end > start && (field === document.activeElement || actionsRef.current?.contains(document.activeElement));
    const noteSelection = { blockId: block.id, start: selected ? start : 0, end: selected ? end : block.text.length, original: block.text };
    const text = block.text.slice(noteSelection.start, noteSelection.end);
    const label = note.title || (english ? 'Untitled note' : 'Nota sem título');
    const composerText = english ? `Revise this passage from the note "${label}":\n\n${text}\n\nDesired change: ` : `Revise este trecho da nota "${label}":\n\n${text}\n\nAjuste desejado: `;
    requestChatReferences(note.projectId, [{ id: note.id, kind: 'note', label, detail: '', fingerprint: '', noteSelection }], composerText);
  };
  return <NoteActionMenu label={english ? 'Paragraph actions' : 'Ações do parágrafo'} className="ws-note-paragraph-options" returnFocus={input}>
    <div className="ws-note-actions" ref={actionsRef} role="group" aria-label={copy.format}>
      <select aria-label={copy.format} title={copy.format} value={block.type} onChange={(e) => onFormat({ type: e.target.value as NoteBlock['type'] })}>
        {(['text', 'heading', 'bullet', 'check'] as const).map((type) => <option key={type} value={type}>{type === 'check' ? tr.checklist : tr[type]}</option>)}
      </select>
      <button type="button" className="ws-icon-button note-bold" aria-label={tr.bold} title={tr.bold} aria-pressed={!!block.bold} onMouseDown={(e) => e.preventDefault()} onClick={() => onFormat({ bold: !block.bold })}>B</button>
      <button type="button" className="ws-icon-button note-italic" aria-label={tr.italic} title={tr.italic} aria-pressed={!!block.italic} onMouseDown={(e) => e.preventDefault()} onClick={() => onFormat({ italic: !block.italic })}>I</button>
      <button type="button" className="ws-note-ai-trigger" aria-label={copy.ai} title={copy.ai} disabled={!block.text.trim()} onMouseDown={(e) => e.preventDefault()} onClick={editWithAI}><MagicWandIcon aria-hidden="true" /></button>
    </div>
  </NoteActionMenu>;
}
