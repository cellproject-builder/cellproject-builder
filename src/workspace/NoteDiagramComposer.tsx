import { AudioTextarea } from '@/audio/AudioField';
import { useEffect, useRef, useState } from 'react';
import { getActiveConfig, useConfigStore } from '@/config/store';
import { DiagramView } from '@/visuals/diagram/DiagramView';
import { parseDiagram, type DiagramV1 } from '@/visuals/diagram/model';
import { generateNoteDiagram, noteDiagramSignature } from './noteDiagram';
import { useWorkspaceStore } from './store';
import { requestWorkspaceUI } from './uiRequests';
import { Icon } from './ui';
import './note-diagram.css';

const pt = {
  title: 'Diagrama com IA', prompt: 'Descreva um diagrama…', content: 'Usar conteúdo da nota', generate: 'Gerar', again: 'Gerar novamente',
  insert: 'Inserir na nota', cancel: 'Cancelar', close: 'Fechar diagrama', working: 'Criando diagrama…', configure: 'Configurar IA', noKey: 'Configure a IA para gerar.',
  changed: 'A nota mudou. Gere novamente com o contexto atual.', invalid: 'O diagrama recebido é inválido. Tente ajustar o pedido.', incomplete: 'O diagrama veio incompleto. Tente um pedido menor.',
  diagramLabelsMissing: 'O desenho veio sem nomes ou legendas visíveis. Gere novamente para obter um diagrama explicativo.',
  failure: 'Não foi possível gerar. Confira a conexão e tente novamente.', insertFailure: 'Não foi possível inserir. A prévia está preservada; tente novamente.',
};
const en: typeof pt = {
  title: 'AI diagram', prompt: 'Describe a diagram…', content: 'Use note content', generate: 'Generate', again: 'Generate again',
  insert: 'Insert in note', cancel: 'Cancel', close: 'Close diagram', working: 'Creating diagram…', configure: 'Configure AI', noKey: 'Configure AI to generate.',
  changed: 'The note changed. Generate again with its current content.', invalid: 'The returned diagram is invalid. Try adjusting the request.', incomplete: 'The diagram was incomplete. Try a smaller request.',
  diagramLabelsMissing: 'The drawing came without visible names or labels. Generate again to get an explanatory diagram.',
  failure: 'Could not generate. Check your connection and try again.', insertFailure: 'Could not insert. Your preview is preserved; try again.',
};
type Context = { noteId: string; useContent: boolean; signature: string; changed: boolean };

/** Inline note tool: review before inserting, with no modal or active-plan dependency. */
export function NoteDiagramComposer({ noteId, onInsert, onClose, english = false }: {
  noteId: string; onInsert: (diagram: DiagramV1) => void; onClose: () => void; english?: boolean;
}) {
  const tr = english ? en : pt;
  const ready = useConfigStore(() => Boolean(getActiveConfig()?.config.apiKey.trim()));
  const [prompt, setPrompt] = useState(''), [useContent, setUseContent] = useState(true);
  const [diagram, setDiagram] = useState<DiagramV1 | null>(null), [values, setValues] = useState<Record<string, number>>({});
  const [running, setRunning] = useState(false), [error, setError] = useState<string | null>(null), [stale, setStale] = useState(false);
  const controller = useRef<AbortController | null>(null), sequence = useRef(0), context = useRef<Context | null>(null);

  useEffect(() => {
    setPrompt(''); setUseContent(true); setDiagram(null); setValues({}); setRunning(false); setError(null); setStale(false);
    context.current = null;
    const off = useWorkspaceStore.subscribe(() => {
      const source = context.current;
      if (!source || source.noteId !== noteId || source.changed) return;
      try { if (noteDiagramSignature(noteId, source.useContent) === source.signature) return; } catch { /* Missing/trashed notes invalidate the request. */ }
      source.changed = true; setStale(true); controller.current?.abort();
    });
    return () => { off(); sequence.current++; controller.current?.abort(); controller.current = null; context.current = null; };
  }, [noteId]);

  const clearResult = () => { context.current = null; setDiagram(null); setValues({}); setError(null); setStale(false); };
  const cancel = () => { sequence.current++; controller.current?.abort(); controller.current = null; context.current = null; setRunning(false); };
  const close = () => { cancel(); onClose(); };
  const generate = async () => {
    if (controller.current || !ready || !prompt.trim()) return;
    clearResult();
    let signature: string;
    try { signature = noteDiagramSignature(noteId, useContent); } catch { setStale(true); return; }
    const source: Context = { noteId, useContent, signature, changed: false };
    context.current = source;
    const call = new AbortController(), generation = ++sequence.current;
    controller.current = call; setRunning(true);
    try {
      const generated = await generateNoteDiagram({ noteId, prompt, useContent }, { signal: call.signal });
      if (generation !== sequence.current || controller.current !== call) return;
      if (source.changed || noteDiagramSignature(noteId, useContent) !== signature) { setStale(true); return; }
      setDiagram(generated);
    } catch (reason) {
      if (generation !== sequence.current || controller.current !== call) return;
      if (source.changed || (reason instanceof Error && reason.message.includes('noteDiagramContextChanged'))) setStale(true);
      else if (!call.signal.aborted && reason instanceof Error && reason.message === 'diagramLabelsMissing') setError(tr.diagramLabelsMissing);
      else if (!call.signal.aborted) setError(reason instanceof Error && reason.message.includes('noteDiagramIncomplete') ? tr.incomplete : reason instanceof Error && reason.message.includes('noteDiagramInvalid') ? tr.invalid : tr.failure);
    } finally {
      if (generation === sequence.current && controller.current === call) { controller.current = null; setRunning(false); }
    }
  };
  const insert = () => {
    const source = context.current;
    if (!diagram || !source || stale || source.changed || source.noteId !== noteId) return;
    try {
      if (noteDiagramSignature(noteId, source.useContent) !== source.signature) { source.changed = true; setStale(true); return; }
      // Keep the explored slider values as the inserted diagram's defaults.
      onInsert(parseDiagram({ ...diagram, parameters: diagram.parameters.map(parameter => ({ ...parameter, value: values[parameter.id] ?? parameter.value })) }, []));
      close();
    } catch { setError(tr.insertFailure); }
  };

  return <section className="ws-note-diagram-composer" aria-label={tr.title} onKeyDownCapture={event => {
    if (event.key === 'Escape' && !(event.target as Element).closest('.audio-field-popup')) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <form onSubmit={event => { event.preventDefault(); void generate(); }}>
      <div className="ws-note-diagram-prompt">
        <AudioTextarea audioScope={`note:${noteId}:diagram-prompt`} audioLanguage={english ? 'en' : 'pt'} autoFocus aria-label={tr.title} placeholder={tr.prompt} rows={1} maxLength={4000} value={prompt} disabled={running}
          onChange={event => { setPrompt(event.target.value); clearResult(); }}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void generate(); } }} />
        <button type="button" className="ws-icon-button" aria-label={tr.close} title={tr.close} onClick={close}><Icon name="close" size={15} /></button>
      </div>
      <div className="ws-note-diagram-actions">
        <label title={english ? 'Only this note’s text and labels are shared with AI.' : 'Apenas textos e legendas desta nota são compartilhados com a IA.'}>
          <input type="checkbox" checked={useContent} disabled={running} onChange={event => { setUseContent(event.target.checked); clearResult(); }} />{tr.content}
        </label>
        {running ? <><span role="status">{tr.working}</span><button type="button" className="ws-button small" onClick={cancel}>{tr.cancel}</button></> :
          <button className="ws-button small" disabled={!ready || !prompt.trim()}>{diagram ? tr.again : tr.generate}<Icon name="arrow" size={13} /></button>}
      </div>
      {!ready && <div className="ws-note-diagram-message"><span>{tr.noKey}</span><button type="button" className="ws-button small" onClick={() => requestWorkspaceUI({ settings: true })}>{tr.configure}</button></div>}
      {(stale || error) && <p className="ws-note-diagram-error" role="alert">{stale ? tr.changed : error}</p>}
    </form>
    {diagram && <>
      <div className={`ws-note-diagram-preview${stale ? ' is-stale' : ''}`}><DiagramView diagram={diagram} values={values} english={english} onParameter={(id, value) => setValues(current => ({ ...current, [id]: value }))} /></div>
      <div className="ws-note-diagram-insert"><button type="button" className="ws-button small primary" data-note-diagram-insert disabled={stale} onClick={insert}>{tr.insert}<Icon name="plus" size={13} /></button></div>
    </>}
  </section>;
}
