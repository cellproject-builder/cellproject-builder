import { useEffect, useRef, useState } from 'react';
import { useLocaleStore } from '@/i18n';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { useConfigStore } from '@/config/store';
import { useAIAction } from '@/hooks/useAIAction';
import { rewriteNoteText } from '@/ai/noteRewrite';
import { useWorkspaceStore } from './store';
import { requestWorkspaceUI } from './uiRequests';
import { attempt } from './ui';
import { noteTextEn, noteTextPt } from './noteTextMessages';

export interface NoteTextTarget {
  noteId: string;
  blockId: string;
  original: string;
  start: number;
  end: number;
}

export function NoteRewriteDialog({ target, onClose }: { target: NoteTextTarget; onClose: () => void }) {
  const tr = useLocaleStore((s) => s.locale) === 'en' ? noteTextEn : noteTextPt;
  const provider = useConfigStore((s) => s.activeProvider);
  const providers = useConfigStore((s) => s.providers);
  const ready = !!(provider && providers[provider]?.apiKey);
  const [instruction, setInstruction] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const inFlight = useRef(false);
  const source = target.original.slice(target.start, target.end);
  const action = useAIAction((signal: AbortSignal, request: string) => rewriteNoteText({ text: source, instruction: request, signal }));
  const { cancel } = action;
  useEffect(() => () => cancel(), [cancel]);
  const close = () => { cancel(); onClose(); };
  const generate = async () => {
    if (inFlight.current || !ready || !instruction.trim() || !source.trim()) return;
    inFlight.current = true;
    setResult(null);
    try {
      const text = await action.run(instruction.trim());
      if (text !== undefined) setResult(text);
    } finally { inFlight.current = false; }
  };
  const apply = () => {
    if (result === null) return;
    const state = useWorkspaceStore.getState();
    const note = state.notes[target.noteId];
    const block = note?.blocks.find((b) => b.id === target.blockId);
    if (!note || note.deletedAt !== null || !block || block.text !== target.original) { setConflict(true); return; }
    // Preserve the selected phrase's separators even when the provider trims its output.
    const leading = source.match(/^\s*/)?.[0] ?? '';
    const trailing = source.match(/\s*$/)?.[0] ?? '';
    const replacement = target.original.slice(0, target.start) + leading + result.trim() + trailing + target.original.slice(target.end);
    const applied = attempt(() => {
      state.updateNote(note.id, { blocks: note.blocks.map((b) => b.id === block.id ? { ...b, text: replacement } : b) });
      return true;
    });
    if (!applied) return;
    toast.show({ message: tr.applied, action: { label: tr.undo, onClick: () => {
      const current = useWorkspaceStore.getState().notes[note.id];
      const currentBlock = current?.blocks.find((b) => b.id === block.id);
      if (!current || current.deletedAt !== null || currentBlock?.text !== replacement) { toast.show({ message: tr.conflict, tone: 'warn' }); return; }
      attempt(() => useWorkspaceStore.getState().updateNote(note.id, { blocks: current.blocks.map((b) => b.id === block.id ? { ...b, text: target.original } : b) }));
    } } });
    close();
  };
  return <Modal open title={tr.title} onClose={close} className="max-w-xl ws-note-ai-dialog">
    <form className="ws-form ws-note-ai-form" onSubmit={(e) => { e.preventDefault(); void generate(); }}>
      <div className="ws-note-ai-context"><span>{target.start === 0 && target.end === target.original.length ? tr.paragraph : tr.selection}</span><p className="ws-note-ai-source">{source}</p><small>{tr.hint}</small></div>
      <label>{tr.instruction}<textarea aria-label={tr.instruction} value={instruction} placeholder={tr.placeholder} rows={3} maxLength={4000} disabled={action.running} onChange={(e) => { setInstruction(e.target.value); setResult(null); action.reset(); }} /></label>
      {!ready && <div className="ws-note-ai-error"><p>{tr.noKey}</p><button type="button" className="ws-button" onClick={() => { close(); requestWorkspaceUI({ settings: true }); }}>{tr.configure}</button></div>}
      {action.error && <p className="ws-note-ai-error" role="alert">{action.error.detail?.includes('incompleteAIRewrite') ? tr.incomplete : action.error.detail?.includes('emptyAIRewrite') ? tr.empty : `${action.error.title}. ${action.error.hint}`}</p>}
      {conflict && <p className="ws-note-ai-error" role="alert">{tr.conflict}</p>}
      {action.running && <p className="ws-note-ai-working" role="status">{tr.generating}</p>}
      {result !== null && <label>{tr.result}<textarea className="ws-note-ai-result" aria-label={tr.result} value={result} rows={5} onChange={(e) => setResult(e.target.value)} /></label>}
      <div className="ws-form-actions">
        <button type="button" className="ws-button" onClick={close}>{result !== null ? tr.discard : tr.cancel}</button>
        {!action.running && <button className={`ws-button ${result === null ? 'primary' : ''}`} disabled={!ready || !instruction.trim() || !source.trim() || conflict}>{result === null ? tr.generate : tr.again}</button>}
        {result !== null && <button type="button" className="ws-button primary" disabled={!result.trim() || conflict} onClick={apply}>{tr.apply}</button>}
      </div>
    </form>
  </Modal>;
}
