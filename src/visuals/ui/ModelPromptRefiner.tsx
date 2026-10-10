import { useEffect, useRef, useState } from 'react';
import type { ModelRefinement, ModelRefinementKind, ModelRefinementRequest } from '../refinement';
import type { MentionTarget, VisualAttachment, VisualPromptInput, VisualWorkspace } from '../types';
import { ModelReferencePreview } from './ModelReferencePreview';
import { PromptComposer } from './PromptComposer';
import { useVisualStrings, visualError } from './strings';
import type { VisualToolActivity } from './uiStore';
import './model-editing.css';

export interface ModelPromptRefinerProps {
  input: VisualPromptInput;
  audioScope?: string;
  workspace: VisualWorkspace;
  listMentions: (query: string) => MentionTarget[];
  onAttach: (file: File, signal?: AbortSignal) => Promise<VisualAttachment>;
  onMedia: (id: string) => Promise<Blob | null>;
  onChange: (input: VisualPromptInput) => void;
  onRefine: (input: VisualPromptInput, request: ModelRefinementRequest, signal: AbortSignal) => Promise<ModelRefinement>;
  isCurrent?: (input: VisualPromptInput, result: ModelRefinement) => boolean;
  onUse: (input: VisualPromptInput) => void;
  onFindReferences: (input: VisualPromptInput) => void;
  onClose: () => void;
  onActivity?: (activity: VisualToolActivity) => void;
}

export function ModelPromptRefiner(props: ModelPromptRefinerProps) {
  const s = useVisualStrings(), en = s.generate === 'Generate model';
  const updateLabel = en ? 'Update request' : 'Atualizar pedido';
  const [kind, setKind] = useState<ModelRefinementKind>('existing');
  const [result, setResult] = useState<ModelRefinement | null>(null);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const latest = useRef(props); latest.current = props;
  const signature = JSON.stringify(props.input), signatureRef = useRef(signature); signatureRef.current = signature;
  function cancel() { controller.current?.abort(); controller.current = null; setBusy(false); }
  function reset() { cancel(); setResult(null); setFeedback(''); setError(''); }
  useEffect(() => { reset(); }, [signature]);
  useEffect(() => () => { controller.current?.abort(); latest.current.onActivity?.({ state: 'idle', label: '' }); }, []);
  useEffect(() => { props.onActivity?.({ state: busy ? 'running' : error ? 'error' : result ? 'ready' : 'idle', label: busy ? s.refining : '' }); }, [busy, error, result, s.refining, props.onActivity]);
  function current(candidate: ModelRefinement) { try { return latest.current.isCurrent?.(latest.current.input, candidate) ?? true; } catch { return false; } }
  async function refine() {
    const input = latest.current.input; if (!input.text.trim() && !input.mentions.length && !input.attachments.length) return;
    cancel(); const operation = new AbortController(); controller.current = operation;
    const sent = JSON.stringify(input), request: ModelRefinementRequest = { kind, feedback, ...(result && current(result) ? { previous: result } : {}) };
    setBusy(true); setError('');
    const active = () => !operation.signal.aborted && controller.current === operation && sent === signatureRef.current;
    try { const next = await latest.current.onRefine(input, request, operation.signal); if (active()) { setResult(next); setFeedback(''); } }
    catch (reason) { if (active()) setError(visualError(reason, s)); }
    finally { if (active()) { controller.current = null; setBusy(false); } }
  }
  const fresh = result ? current(result) : false;
  const needsUpdate = !result || !fresh || !!feedback.trim() || result.questions.length > 0;
  const canSubmit = result ? (needsUpdate ? !!feedback.trim() || !fresh : true) : !!(props.input.text.trim() || props.input.mentions.length || props.input.attachments.length);
  function submit() {
    if (busy || !canSubmit) return;
    if (needsUpdate) { void refine(); return; }
    if (!result || !current(result)) { setError(s.refinementOutdated); return; }
    try { props.onUse({ ...props.input, text: result.suggestedPrompt }); } catch (reason) { setError(visualError(reason, s)); }
  }
  function change(input: VisualPromptInput) {
    if (!result) { props.onChange(input); return; }
    const referencesChanged = JSON.stringify([input.mentions, input.attachments, input.analyzeImages]) !== JSON.stringify([props.input.mentions, props.input.attachments, props.input.analyzeImages]);
    if (referencesChanged) props.onChange({ ...input, text: `${props.input.text}${input.text.trim() ? `\n${input.text.trim()}` : ''}` });
    else setFeedback(input.text);
  }
  return <section className="visual-refinement visual-refinement-conversation" aria-label={s.refineWithAI}>
    <div className="visual-refinement-heading"><span aria-hidden="true">✧</span><strong>{s.refineWithAI}</strong><button type="button" className="visual-icon-button" aria-label={s.directGeneration} onClick={props.onClose}>×</button></div>
    <div className="visual-segmented visual-refinement-intent" aria-label={s.understoodObject}>{(['existing', 'concept'] as const).map(value => <button type="button" key={value} aria-pressed={kind === value} disabled={busy} onClick={() => { if (kind !== value) { reset(); setKind(value); } }}>{value === 'existing' ? s.existingObject : s.originalConcept}</button>)}</div>
    <ModelReferencePreview input={props.input} workspace={props.workspace} onMedia={props.onMedia}/>
    {result && <div className="visual-refinement-answer"><strong>{result.subject}</strong><p>{result.interpretation.length > 300 ? result.interpretation.slice(0, 300) + '…' : result.interpretation}</p>{result.questions.length > 0 && <ul className="visual-refinement-questions">{result.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>}<details><summary>{en ? 'Request, references and limits' : 'Pedido, referências e limites'}</summary><p>{result.suggestedPrompt}</p><ul>{[...result.referenceSummary, ...result.assumptions].map((text, i) => <li key={i}>{text}</li>)}</ul></details></div>}
    <PromptComposer audioScope={`${props.audioScope ?? 'model-refiner'}:${result ? 'feedback' : 'request'}`} kind="model" value={result ? { ...props.input, text: feedback } : props.input} onChange={change} listMentions={props.listMentions} onAttach={props.onAttach} busy={busy} onSubmit={submit} onCancel={cancel} rows={2} canSubmit={canSubmit} submitLabel={needsUpdate ? updateLabel : s.generate} inputLabel={result ? (en ? 'Reply or adjust' : 'Responda ou ajuste') : s.generate} placeholder={result ? (en ? 'Answer the question or describe an adjustment… use @ for references' : 'Responda ou descreva um ajuste… use @ para referências') : s.modelPlaceholder}/>
    {busy && <p className="visual-progress" role="status"><span className="visual-spinner" aria-hidden="true"/>{s.refining}</p>}
    {error && <p className="visual-error" role="alert">{error}</p>}
    {result && !fresh && <p className="visual-error" role="alert">{s.refinementOutdated}</p>}
    <button className="visual-refinement-find" type="button" aria-label={s.findModelReference} disabled={busy} onClick={() => props.onFindReferences({ ...props.input, text: result && fresh ? result.subject : props.input.text })}><span aria-hidden="true">▧</span>{s.findModelReference}</button>
  </section>;
}
