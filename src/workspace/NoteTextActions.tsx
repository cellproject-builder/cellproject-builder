import { useRef, useState } from 'react';
import { MagicWandIcon } from '@/components/ui/SoftIcons';
import { useLocaleStore, useT } from '@/i18n';
import type { NoteBlock } from './types';
import { NoteRewriteDialog, type NoteTextTarget } from './NoteRewriteDialog';
import { noteTextEn, noteTextPt } from './noteTextMessages';
import './NoteTextActions.css';

export function NoteTextActions({ noteId, block, input, onFormat }: {
  noteId: string;
  block: NoteBlock;
  input: () => HTMLTextAreaElement | null | undefined;
  onFormat: (patch: Partial<NoteBlock>) => void;
}) {
  const tr = useT().workspace;
  const copy = useLocaleStore((s) => s.locale) === 'en' ? noteTextEn : noteTextPt;
  const [target, setTarget] = useState<NoteTextTarget | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const editWithAI = () => {
    const field = input();
    const start = field?.selectionStart ?? 0, end = field?.selectionEnd ?? 0;
    const selected = end > start && (field === document.activeElement || actionsRef.current?.contains(document.activeElement));
    setTarget({ noteId, blockId: block.id, original: block.text, start: selected ? start : 0, end: selected ? end : block.text.length });
  };
  return <>
    <div className="ws-note-actions" ref={actionsRef} role="group" aria-label={copy.format}>
      <select aria-label={copy.format} title={copy.format} value={block.type} onChange={(e) => onFormat({ type: e.target.value as NoteBlock['type'] })}>
        {(['text', 'heading', 'bullet', 'check'] as const).map((type) => <option key={type} value={type}>{type === 'check' ? tr.checklist : tr[type]}</option>)}
      </select>
      <button type="button" className="ws-icon-button note-bold" aria-label={tr.bold} title={tr.bold} aria-pressed={!!block.bold} onMouseDown={(e) => e.preventDefault()} onClick={() => onFormat({ bold: !block.bold })}>B</button>
      <button type="button" className="ws-icon-button note-italic" aria-label={tr.italic} title={tr.italic} aria-pressed={!!block.italic} onMouseDown={(e) => e.preventDefault()} onClick={() => onFormat({ italic: !block.italic })}>I</button>
      <button type="button" className="ws-note-ai-trigger" aria-label={copy.ai} title={copy.ai} disabled={!block.text.trim()} onMouseDown={(e) => e.preventDefault()} onClick={editWithAI}><MagicWandIcon aria-hidden="true" /></button>
    </div>
    {target && <NoteRewriteDialog target={target} onClose={() => setTarget(null)} />}
  </>;
}
